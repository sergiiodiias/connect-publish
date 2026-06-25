import { fbGetWithUsage, type AppUsage } from "@/lib/fb-graph";
import { USAGE_THRESHOLD, buildUsageEntry, type UsageMap } from "@/lib/fb-app-creds";
import { debugFacebookToken, normalizeFacebookExpiresAt, reconnectReasonFromDebugError } from "@/lib/fb-token-debug";

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

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  concurrency: number,
  pauseMs: number,
  fn: (item: T) => Promise<R>,
  shouldAbort?: () => boolean,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += batchSize) {
    if (shouldAbort?.()) break;
    const batch = items.slice(start, start + batchSize);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= batch.length) return;
        out[start + i] = await fn(batch[i]);
      }
    });
    await Promise.all(workers);
    if (start + batchSize < items.length && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
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
    .select("id, user_id, fb_page_id, name, access_token, token_expires_at, token_last_debugged_at, token_last_refreshed_at, token_scopes, token_data_access_expires_at, is_active, needs_reconnect");
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

  function pickCreds(userId: string, issuerAppId: string | null): { slot: 1 | 2; appId: string; appSecret: string } | null {
    const u = appsByUser.get(userId);
    // Se sabemos qual App emitiu o token, USAR esse App. Tokens só podem ser estendidos
    // pelo App que os emitiu — rotacionar para outro retorna "does not belong to application".
    if (issuerAppId) {
      const match = u?.apps.find((a) => a.appId === issuerAppId);
      if (match) return { slot: match.slot, appId: match.appId, appSecret: match.appSecret };
      if (envAppId && envAppId === issuerAppId && envAppSecret) return { slot: 1, appId: envAppId, appSecret: envAppSecret };
      // Não temos creds do App que emitiu — não dá pra estender.
      return null;
    }
    // Fallback: nenhum app_id detectado → escolhe pelo menor uso
    if (!u || u.apps.length === 0) {
      if (envAppId && envAppSecret) return { slot: 1, appId: envAppId, appSecret: envAppSecret };
      return null;
    }
    const below = u.apps.filter((a) => a.usage < USAGE_THRESHOLD);
    const pool = below.length ? below : u.apps;
    pool.sort((a, b) => a.usage - b.usage);
    return { slot: pool[0].slot, appId: pool[0].appId, appSecret: pool[0].appSecret };
  }

  function debugCredsForUser(userId: string): { slot: 1 | 2; appId: string; appSecret: string }[] {
    const creds = [...(appsByUser.get(userId)?.apps ?? []).map((a) => ({ slot: a.slot, appId: a.appId, appSecret: a.appSecret }))];
    if (envAppId && envAppSecret && !creds.some((a) => a.appId === envAppId)) creds.push({ slot: 1, appId: envAppId, appSecret: envAppSecret });
    return creds;
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

  const { withApiCallTracking } = await import("@/lib/fb-api-tracker.server");
  await mapWithConcurrency(rows ?? [], 3, async (row) => withApiCallTracking(row.user_id, async () => {
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

    // Skip total para páginas marcadas como "precisa reconectar" — não gasta quota
    // até o usuário enviar um novo token válido. Force ignora esse atalho.
    if (row.needs_reconnect && !force) {
      outcome.skipped = "fresh"; // reusa o tipo existente
      outcome.debugError = "precisa reconectar (skip)";
      skippedCount++;
      results.push(outcome);
      return;
    }

    const update: Record<string, any> = { token_last_debugged_at: new Date().toISOString() };
    let isValid = false;
    let expiresAt: number | null = null;

    let issuerAppId: string | null = null;

    // Cache de debug_token: se já verificamos nas últimas 24h E o token ainda tem >7d de validade,
    // pula a chamada de debug_token e reutiliza os dados do banco. Economiza muita quota.
    const lastDebug = row.token_last_debugged_at ? new Date(row.token_last_debugged_at).getTime() : 0;
    const debugCacheMs = 24 * 60 * 60 * 1000;
    const prevExpMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
    const stillValid = prevExpMs === null ? row.is_active : (prevExpMs - Date.now() > 7 * 24 * 60 * 60 * 1000);
    const debugFresh = !force && lastDebug && (Date.now() - lastDebug < debugCacheMs) && row.is_active && stillValid;

    if (debugFresh) {
      isValid = !!row.is_active;
      expiresAt = prevExpMs ? Math.floor(prevExpMs / 1000) : (row.is_active ? 0 : null);
      // não atualiza token_last_debugged_at — mantemos o original
      delete update.token_last_debugged_at;
      debugged++;
    } else {
      try {
        const r = await debugFacebookToken(row.access_token, debugCredsForUser(row.user_id));
        if (r.slot) noteUsage(row.user_id, r.slot, r.usage);
        const d = r.data ?? {};
        isValid = !!d.is_valid;
        expiresAt = normalizeFacebookExpiresAt(d);
        issuerAppId = r.appId ?? (d.app_id ? String(d.app_id) : null);
        update.token_expires_at = expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
        update.token_data_access_expires_at =
          typeof d.data_access_expires_at === "number" && d.data_access_expires_at > 0
            ? new Date(d.data_access_expires_at * 1000).toISOString() : null;
        update.token_scopes = Array.isArray(d.scopes) ? d.scopes : [];
        update.token_debug_error = d.error?.message ?? null;
        update.is_active = isValid;
        debugged++;
        if (d.error?.message) outcome.debugError = d.error.message;

        const reconnectReason = reconnectReasonFromDebugError(d.error);
        if (!isValid && reconnectReason) {
          update.needs_reconnect = true;
          update.reconnect_reason = reconnectReason;
          outcome.needsReconnect = true;
          outcome.reconnectReason = update.reconnect_reason;
        } else if (isValid) {
          update.needs_reconnect = false;
          update.reconnect_reason = null;
        }
      } catch (e: any) {
        update.token_debug_error = e?.message ?? "erro";
        update.is_active = false;
        errors.push({ pageId: row.id, error: e?.message ?? "erro" });
        outcome.debugError = e?.message ?? "erro";
      }
    }
    outcome.isValid = isValid;
    outcome.newExpiresAt = update.token_expires_at ?? null;


    const creds = pickCreds(row.user_id, issuerAppId);
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
    // Inteligente: pula exchange se já renovamos recentemente.
    // - Se há expiry conhecida >30d: pula (regra original).
    // - Se NÃO há expiry (token longa-duração) E foi renovado nos últimos 7 dias: pula.
    //   Sem isso, 122 páginas sem expiry batem exchange a cada cron.
    const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
    const RECENT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
    const lastRefreshMs = row.token_last_refreshed_at ? new Date(row.token_last_refreshed_at).getTime() : 0;
    const recentlyRefreshed = lastRefreshMs && (Date.now() - lastRefreshMs < RECENT_REFRESH_MS);
    if (shouldExchange && !force && withinDaysMs === null) {
      if (msToExpiry !== null && msToExpiry >= FRESH_MS) {
        shouldExchange = false;
        outcome.skipped = "fresh";
      } else if (msToExpiry === null && recentlyRefreshed) {
        shouldExchange = false;
        outcome.skipped = "fresh";
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
          // Só sobrescreve token_expires_at se o Facebook devolveu expires_in.
          // Page tokens derivados de long-lived user tokens não retornam expires_in
          // (não expiram) — nesse caso mantemos o valor que veio do debug_token.
          if (typeof r.expires_in === "number" && r.expires_in > 0) {
            update.token_expires_at = new Date(Date.now() + r.expires_in * 1000).toISOString();
          }
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
      outcome.exchangeError = issuerAppId
        ? `Token emitido pelo App ${issuerAppId} — adicione esse App em Ajustes para poder renovar.`
        : "App ID/Secret não configurado em Ajustes";
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
  }));

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
