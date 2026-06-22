import { fbGet } from "@/lib/fb-graph";

export type RefreshResult = {
  ok: boolean;
  total: number;
  debugged: number;
  refreshed: number;
  invalidated: number;
  canExtend: boolean;
  errors: { pageId: string; error: string }[];
};

export async function runRefreshTokens(opts: { force?: boolean } = {}): Promise<RefreshResult> {
  const force = !!opts.force;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("fb_pages")
    .select("id, user_id, fb_page_id, name, access_token");
  if (error) throw new Error(error.message);

  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  const canExtend = !!(appId && appSecret);

  let debugged = 0;
  let refreshed = 0;
  let invalidated = 0;
  const errors: { pageId: string; error: string }[] = [];

  // Serial loop with small delay — avoids Graph API "Application request limit reached" (#4)
  for (const row of rows ?? []) {
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

      // Only attempt token exchange when it's actually needed:
      // - Token must be valid
      // - App credentials must exist
      // - Either no known expiry (long-lived/never expires shouldn't be refreshed)
      //   OR expiry is within the next 20 days
      // This avoids hammering Facebook's app-level rate limit (200 calls/h × users)
      // because /oauth/access_token uses app context and DOES count toward that quota,
      // unlike /debug_token called with the page token itself.
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
          // Extra spacing after a heavy app-context call
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e: any) {
          console.warn(`[refresh-tokens] exchange failed for ${row.fb_page_id}:`, e?.message);
          // If we got rate-limited, back off significantly
          if (/limit|#4|#17|#32/i.test(e?.message ?? "")) {
            await new Promise((r) => setTimeout(r, 60_000));
          }
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

    await new Promise((r) => setTimeout(r, 1000));
  }

  return { ok: true, total: rows?.length ?? 0, debugged, refreshed, invalidated, canExtend, errors };
}
