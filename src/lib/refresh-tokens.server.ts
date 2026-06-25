import { fbGet, fbGetWithUsage } from "@/lib/fb-graph";

export type RefreshResult = {
  ok: boolean;
  total: number;
  debugged: number;
  refreshed: number;
  invalidated: number;
  canExtend: boolean;
  errors: { pageId: string; error: string }[];
};

// Limit concurrent Graph calls so we don't blow rate limits but stay well under the 60s gateway.
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

export async function runRefreshTokens(opts: { force?: boolean } = {}): Promise<RefreshResult> {
  const force = !!opts.force;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("fb_pages")
    .select("id, user_id, fb_page_id, name, access_token");
  if (error) throw new Error(error.message);

  // Per-user FB App credentials (fallback to global env vars).
  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  const { data: profiles } = userIds.length
    ? await supabaseAdmin.from("profiles").select("id, fb_app_id, fb_app_secret").in("id", userIds)
    : { data: [] as any[] };
  const credsByUser = new Map<string, { appId?: string; appSecret?: string }>();
  for (const p of profiles ?? []) {
    credsByUser.set(p.id, { appId: p.fb_app_id ?? undefined, appSecret: p.fb_app_secret ?? undefined });
  }
  const envAppId = process.env.FB_APP_ID;
  const envAppSecret = process.env.FB_APP_SECRET;
  const canExtendAny = !!(envAppId && envAppSecret) || (profiles ?? []).some((p) => p.fb_app_id && p.fb_app_secret);


  let debugged = 0;
  let refreshed = 0;
  let invalidated = 0;
  const errors: { pageId: string; error: string }[] = [];

  await mapWithConcurrency(rows ?? [], 6, async (row) => {
    const update: Record<string, any> = {
      token_last_debugged_at: new Date().toISOString(),
    };
    let isValid = false;
    let expiresAt: number | null = null;

    try {
      const r = await fbGet<any>("/debug_token", {
        input_token: row.access_token,
        access_token: row.access_token,
      });
      const d = r?.data ?? {};
      isValid = !!d.is_valid;
      expiresAt = typeof d.expires_at === "number" ? d.expires_at : null;
      update.token_expires_at =
        expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
      update.token_data_access_expires_at =
        typeof d.data_access_expires_at === "number" && d.data_access_expires_at > 0
          ? new Date(d.data_access_expires_at * 1000).toISOString()
          : null;
      update.token_scopes = Array.isArray(d.scopes) ? d.scopes : [];
      update.token_debug_error = d.error?.message ?? null;
      update.is_active = isValid;
      debugged++;
    } catch (e: any) {
      update.token_debug_error = e?.message ?? "erro";
      update.is_active = false;
      errors.push({ pageId: row.id, error: e?.message ?? "erro" });
    }

    // Pick this user's credentials, falling back to global env.
    const userCreds = credsByUser.get(row.user_id);
    const appId = userCreds?.appId || envAppId;
    const appSecret = userCreds?.appSecret || envAppSecret;
    const canExtend = !!(appId && appSecret);

    // Manual "Renovar agora" → force exchange on every valid token.
    // Cron monthly → only when expiry is within 20 days (avoids app-level rate quota).
    const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;
    const withinWindow =
      expiresAt !== null && expiresAt > 0 && expiresAt * 1000 - Date.now() < TWENTY_DAYS_MS;
    const needsExchange = isValid && canExtend && (force || withinWindow);

    if (needsExchange) {
      try {
        const r = await fbGet<any>("/oauth/access_token", {
          grant_type: "fb_exchange_token",
          client_id: appId!,
          client_secret: appSecret!,
          fb_exchange_token: row.access_token,
        });

        if (r?.access_token && r.access_token !== row.access_token) {
          update.access_token = r.access_token;
          update.token_last_refreshed_at = new Date().toISOString();
          update.token_expires_at =
            typeof r.expires_in === "number" && r.expires_in > 0
              ? new Date(Date.now() + r.expires_in * 1000).toISOString()
              : null;
          refreshed++;
        }
      } catch (e: any) {
        console.warn(`[refresh-tokens] exchange failed for ${row.fb_page_id}:`, e?.message);
        errors.push({ pageId: row.id, error: `exchange: ${e?.message ?? "erro"}` });
      }
    }

    if (!isValid) invalidated++;

    const { error: updErr } = await supabaseAdmin
      .from("fb_pages")
      .update(update as any)
      .eq("id", row.id);
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
        name: row.name,
        is_valid: isValid,
        expires_at: update.token_expires_at,
        extended: !!update.access_token,
      },
      status: isValid ? "ok" : "error",
    });
  });

  return { ok: true, total: rows?.length ?? 0, debugged, refreshed, invalidated, canExtend: canExtendAny, errors };
}
