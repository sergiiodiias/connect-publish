import { fbGet, fbGetWithUsage, type AppUsage } from "@/lib/fb-graph";
import { USAGE_THRESHOLD, buildUsageEntry, type UsageMap } from "@/lib/fb-app-creds";

export type PageRefreshOutcome = {
  pageId: string;
  fbPageId: string;
  name: string;
  isValid: boolean;
  extended: boolean;
  skipped?: "quota_high" | "outside_window" | "fresh" | null;
  previousExpiresAt: string | null;
  newExpiresAt: string | null;
  appSlot: 1 | 2 | null;
  needsReconnect?: boolean;
  reconnectReason?: string;
  debugError?: string;
  exchangeError?: string;
};

/** Subcódigos do Facebook (code=190) que indicam que o token foi revogado pelo usuário
 *  e exige reconexão manual (não adianta tentar de novo). */
const RECONNECT_SUBCODES: Record<number, string> = {
  458: "App removido pelo usuário",
  459: "Usuário fez checkpoint de segurança",
  460: "Senha do usuário foi trocada",
  463: "Token expirado",
  464: "Usuário não confirmado",
  466: "Token revogado pelo usuário",
  467: "Token inválido",
  490: "Sessão invalidada",
  492: "Sessão inválida",
};

export type RefreshResult = {
  ok: boolean;
  total: number;
  debugged: number;
  refreshed: number;
  invalidated: number;
  skipped: number;
  canExtend: boolean;
  economyMode: boolean;
  errors: { pageId: string; error: string }[];
  results: PageRefreshOutcome[];
};

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type RefreshOptions = {
  force?: boolean;
  /** Renova só páginas com expiração em até X dias (manual UX). */
  withinDays?: number;
  /** Se origem é cron (true) ou ação manual do usuário (false). */
  fromCron?: boolean;
};

export async function runRefreshTokens(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const force = !!opts.force;
  const withinDaysMs = typeof opts.withinDays === "number" ? opts.withinDays * 24 * 60 * 60 * 1000 : null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("fb_pages")
    .select("id, user_id, fb_page_id, name, access_token, token_expires_at");
  if (error) throw new Error(error.message);

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  const { data: profiles } = userIds.length
    ? await supabaseAdmin.from("profiles").select("id, fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2, fb_app_usage").in("id", userIds)
    : { data: [] as any[] };

  type UserApps = {
    apps: { slot: 1 | 2; appId: string; appSecret: string; usage: number }[];
    usageMap: UsageMap;
    hasApp1: boolean;
    hasApp2: boolean;
    saturated: boolean;
  };
  const appsByUser = new Map<string, UserApps>();
  for (const p of profiles ?? []) {
    const usageMap = (p.fb_app_usage ?? {}) as UsageMap;
    const apps: UserApps["apps"] = [];
    const hasApp1 = !!(p.fb_app_id && p.fb_app_secret);
    const hasApp2 = !!(p.fb_app_id_2 && p.fb_app_secret_2);
    if (hasApp1) apps.push({ slot: 1, appId: p.fb_app_id!, appSecret: p.fb_app_secret!, usage: usageMap.app1?.pct ?? 0 });
    if (hasApp2) apps.push({ slot: 2, appId: p.fb_app_id_2!, appSecret: p.fb_app_secret_2!, usage: usageMap.app2?.pct ?? 0 });
    const configured = apps.length > 0 ? apps.map((a) => a.usage) : [];
    const saturated = configured.length > 0 && configured.every((u) => u >= USAGE_THRESHOLD);
    appsByUser.set(p.id, { apps, usageMap, hasApp1, hasApp2, saturated });
  }
  const envAppId = process.env.FB_APP_ID;
  const envAppSecret = process.env.FB_APP_SECRET;
  const canExtendAny = !!(envAppId && envAppSecret) || (profiles ?? []).some((p) => (p.fb_app_id && p.fb_app_secret) || (p.fb_app_id_2 && p.fb_app_secret_2));

  // Modo econômico: TODOS os usuários com apps configurados estão saturados.
  // (Quando há usuários não-saturados, só os saturados entram em economy mode.)
  function isEconomy(userId: string): boolean {
    const u = appsByUser.get(userId);
    return !!u && u.saturated;
  }

  function pickCreds(userId: string): { slot: 1 | 2; appId: string; appSecret: string } | null {
    const u = appsByUser.get(userId);
    if (!u || u.apps.length === 0) {
      if (envAppId && envAppSecret) return { slot: 1, appId: envAppId, appSecret: envAppSecret };
      return null;
    }
    const below = u.apps.filter((a) => a.usage < USAGE_THRESHOLD);
    const pool = below.length ? below : u.apps;
    pool.sort((a, b) => a.usage - b.usage);
    return { slot: pool[0].slot, appId: pool[0].appId, appSecret: pool[0].appSecret };
  }
  function noteUsage(userId: string, slot: 1 | 2, usage: AppUsage | null) {
    const entry = buildUsageEntry(usage);
    if (!entry) return;
    const u = appsByUser.get(userId);
    if (!u) return;
    const key = slot === 1 ? "app1" : "app2";
    u.usageMap[key] = entry;
    const a = u.apps.find((x) => x.slot === slot);
    if (a) a.usage = entry.pct;
    // Recalcula saturação após a atualização
    const configured = u.apps.map((x) => x.usage);
    u.saturated = configured.length > 0 && configured.every((p) => p >= USAGE_THRESHOLD);
  }

  let debugged = 0;
  let refreshed = 0;
  let invalidated = 0;
  let skippedCount = 0;
  const errors: { pageId: string; error: string }[] = [];
  const results: PageRefreshOutcome[] = [];
  let economyTriggered = false;

  await mapWithConcurrency(rows ?? [], 6, async (row) => {
    const previousExpiresAt = row.token_expires_at ?? null;
    const outcome: PageRefreshOutcome = {
      pageId: row.id,
      fbPageId: row.fb_page_id,
      name: row.name,
      isValid: false,
      extended: false,
      skipped: null,
      previousExpiresAt,
      newExpiresAt: previousExpiresAt,
      appSlot: null,
    };

    const update: Record<string, any> = { token_last_debugged_at: new Date().toISOString() };
    let isValid = false;
    let expiresAt: number | null = null;

    try {
      const r = await fbGet<any>("/debug_token", { input_token: row.access_token, access_token: row.access_token });
      const d = r?.data ?? {};
      isValid = !!d.is_valid;
      expiresAt = typeof d.expires_at === "number" ? d.expires_at : null;
      update.token_expires_at = expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
      update.token_data_access_expires_at =
        typeof d.data_access_expires_at === "number" && d.data_access_expires_at > 0
          ? new Date(d.data_access_expires_at * 1000).toISOString() : null;
      update.token_scopes = Array.isArray(d.scopes) ? d.scopes : [];
      update.token_debug_error = d.error?.message ?? null;
      update.is_active = isValid;
      debugged++;
      if (d.error?.message) outcome.debugError = d.error.message;
    } catch (e: any) {
      update.token_debug_error = e?.message ?? "erro";
      update.is_active = false;
      errors.push({ pageId: row.id, error: e?.message ?? "erro" });
      outcome.debugError = e?.message ?? "erro";
    }
    outcome.isValid = isValid;
    outcome.newExpiresAt = update.token_expires_at ?? null;

    const creds = pickCreds(row.user_id);
    if (creds) outcome.appSlot = creds.slot;

    // Decidir se deve tentar estender
    const economy = isEconomy(row.user_id);
    if (economy) economyTriggered = true;
    const URGENT_MS = 7 * 24 * 60 * 60 * 1000;
    const msToExpiry = expiresAt && expiresAt > 0 ? expiresAt * 1000 - Date.now() : null;
    const isUrgent = msToExpiry !== null && msToExpiry < URGENT_MS;

    let shouldExchange = isValid && !!creds;

    // withinDays (filtro manual): só renova se está dentro da janela
    if (shouldExchange && withinDaysMs !== null) {
      if (msToExpiry === null || msToExpiry >= withinDaysMs) {
        shouldExchange = false;
        outcome.skipped = "outside_window";
      }
    }
    // Modo econômico: só renova urgentes
    if (shouldExchange && economy && !isUrgent && !force) {
      shouldExchange = false;
      outcome.skipped = "quota_high";
    }

    if (shouldExchange && creds) {
      try {
        const { data: r, usage } = await fbGetWithUsage<any>("/oauth/access_token", {
          grant_type: "fb_exchange_token",
          client_id: creds.appId,
          client_secret: creds.appSecret,
          fb_exchange_token: row.access_token,
        });
        noteUsage(row.user_id, creds.slot, usage);

        if (r?.access_token && r.access_token !== row.access_token) {
          update.access_token = r.access_token;
          update.token_last_refreshed_at = new Date().toISOString();
          update.token_expires_at =
            typeof r.expires_in === "number" && r.expires_in > 0
              ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null;
          refreshed++;
          outcome.extended = true;
          outcome.newExpiresAt = update.token_expires_at ?? null;
        }
      } catch (e: any) {
        if (e?.usage) noteUsage(row.user_id, creds.slot, e.usage as AppUsage);
        console.warn(`[refresh-tokens] exchange failed for ${row.fb_page_id}:`, e?.message);
        errors.push({ pageId: row.id, error: `exchange: ${e?.message ?? "erro"}` });
        outcome.exchangeError = e?.message ?? "erro";
      }
    } else if (!creds) {
      outcome.exchangeError = "App ID/Secret não configurado em Ajustes";
    }

    if (outcome.skipped) skippedCount++;
    if (!isValid) invalidated++;

    const { error: updErr } = await supabaseAdmin.from("fb_pages").update(update as any).eq("id", row.id);
    if (updErr) {
      console.error(`[refresh-tokens] update error for ${row.id}:`, updErr);
      errors.push({ pageId: row.id, error: updErr.message });
    }

    await supabaseAdmin.from("activity_logs").insert({
      user_id: row.user_id,
      action: update.access_token ? "page.token_refreshed" : "page.token_debug",
      entity: "fb_page",
      entity_id: row.id,
      metadata: {
        name: row.name, is_valid: isValid,
        expires_at: update.token_expires_at, extended: !!update.access_token,
        skipped: outcome.skipped ?? null,
      },
      status: isValid ? "ok" : "error",
    });

    results.push(outcome);
  });

  // Persiste o uso por app de cada usuário
  await Promise.all(Array.from(appsByUser.entries()).map(([userId, u]) =>
    supabaseAdmin.from("profiles").update({ fb_app_usage: u.usageMap }).eq("id", userId),
  ));

  results.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const summary = {
    total: rows?.length ?? 0,
    debugged, refreshed, invalidated, skipped: skippedCount,
    canExtend: canExtendAny, economyMode: economyTriggered,
    withinDays: opts.withinDays ?? null,
    fromCron: !!opts.fromCron,
  };

  // Persiste relatório por usuário (agrupado).
  try {
    const byUser = new Map<string, PageRefreshOutcome[]>();
    for (const r of results) {
      const userId = (rows ?? []).find((x) => x.id === r.pageId)?.user_id;
      if (!userId) continue;
      const arr = byUser.get(userId) ?? [];
      arr.push(r);
      byUser.set(userId, arr);
    }
    await Promise.all(Array.from(byUser.entries()).map(([userId, userResults]) => {
      const userSummary = {
        ...summary,
        total: userResults.length,
        debugged: userResults.filter((r) => r.isValid || r.debugError).length,
        refreshed: userResults.filter((r) => r.extended).length,
        invalidated: userResults.filter((r) => !r.isValid).length,
        skipped: userResults.filter((r) => r.skipped).length,
      };
      return (supabaseAdmin as any).from("refresh_reports").insert({
        user_id: userId, summary: userSummary, results: userResults,
        source: opts.fromCron ? "cron" : "manual",
      });
    }));
  } catch (e: any) {
    console.warn("[refresh-tokens] failed to persist report:", e?.message);
  }

  return {
    ok: true, total: rows?.length ?? 0,
    debugged, refreshed, invalidated, skipped: skippedCount,
    canExtend: canExtendAny, economyMode: economyTriggered,
    errors, results,
  };
}
