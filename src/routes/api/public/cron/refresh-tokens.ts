import { createFileRoute } from "@tanstack/react-router";
import { fbGet } from "@/lib/fb-graph";

export const Route = createFileRoute("/api/public/cron/refresh-tokens")({
  server: {
    handlers: {
      POST: async () => runRefresh(),
      GET: async () => runRefresh(),
    },
  },
});

async function runRefresh() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("fb_pages")
    .select("id, user_id, fb_page_id, name, access_token");
  if (error) {
    console.error("[refresh-tokens] list error", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  const canExtend = !!(appId && appSecret);

  let debugged = 0;
  let refreshed = 0;
  let invalidated = 0;
  const errors: { pageId: string; error: string }[] = [];

  await Promise.all(
    (rows ?? []).map(async (row) => {
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
        update.token_expires_at = expiresAt && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
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

      // Try to extend to a long-lived token when app credentials are available
      // and the current token still has time left (Facebook only allows exchange of valid tokens).
      if (isValid && canExtend) {
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
            if (typeof r.expires_in === "number" && r.expires_in > 0) {
              update.token_expires_at = new Date(Date.now() + r.expires_in * 1000).toISOString();
            } else {
              update.token_expires_at = null;
            }
            refreshed++;
          }
        } catch (e: any) {
          console.warn(`[refresh-tokens] exchange failed for ${row.fb_page_id}:`, e?.message);
        }
      }

      if (!isValid) invalidated++;

      const { error: updErr } = await supabaseAdmin
        .from("fb_pages")
        .update(update)
        .eq("id", row.id);
      if (updErr) {
        console.error(`[refresh-tokens] update error for ${row.id}:`, updErr);
        errors.push({ pageId: row.id, error: updErr.message });
      }

      // Activity log
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
    }),
  );

  return Response.json({
    ok: true,
    total: rows?.length ?? 0,
    debugged,
    refreshed,
    invalidated,
    canExtend,
    errors,
  });
}
