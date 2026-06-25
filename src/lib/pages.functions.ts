import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet, fbGetWithUsage, fbPost } from "@/lib/fb-graph";
import { getAppCredsForUser, recordAppUsage } from "@/lib/fb-app-creds";

// Connect a page by pasting either a Page Access Token directly,
// or a User Access Token containing pages — we'll list and pick the matching one.
export const connectPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accessToken: z.string().min(20),
      pageId: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // First try as a page token: /me returns the Page object if so
    let pageId = data.pageId;
    let pageToken = data.accessToken;
    let me: any;
    try {
      me = await fbGet("/me", { access_token: data.accessToken, fields: "id,name,category" });
    } catch (e: any) {
      const message = e?.message ?? "não foi possível validar o token";
      return {
        ok: false,
        error: message.toLowerCase().includes("session has expired")
          ? "Token expirado. Gere um novo token da página e tente novamente."
          : `Token inválido: ${message}`,
      };
    }

    if (me.category) {
      // It IS a page token
      pageId = me.id;
    } else {
      // It's a user token — try to find pages
      let pages: { data: any[] };
      try {
        pages = await fbGet<{ data: any[] }>("/me/accounts", { access_token: data.accessToken, fields: "id,name,category,access_token" });
      } catch (e: any) {
        return { ok: false, error: `Não consegui listar páginas com esse token: ${e?.message ?? "erro desconhecido"}` };
      }
      const chosen = pageId ? pages.data.find((p) => p.id === pageId) : pages.data[0];
      if (!chosen) return { ok: false, error: "Nenhuma página encontrada para esse token" };
      pageId = chosen.id;
      pageToken = chosen.access_token;
      me = chosen;
    }

    // Picture
    let picture_url: string | null = null;
    try {
      const pic = await fbGet<any>(`/${pageId}/picture`, { access_token: pageToken!, redirect: "false", type: "large" });
      picture_url = pic?.data?.url ?? null;
    } catch {}

    const { data: upserted, error } = await supabase
      .from("fb_pages")
      .upsert({
        user_id: userId,
        fb_page_id: pageId!,
        name: me.name,
        category: me.category ?? null,
        access_token: pageToken!,
        picture_url,
        is_active: true,
        last_checked_at: new Date().toISOString(),
      }, { onConflict: "user_id,fb_page_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("activity_logs").insert({
      user_id: userId, action: "page.connected", entity: "fb_page", entity_id: upserted.id,
      metadata: { name: me.name }, status: "ok",
    });

    return { ok: true, page: upserted };
  });

export const testPageToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("fb_pages").select("*").eq("id", data.pageId).eq("user_id", userId).single();
    if (error || !row) throw new Error("Página não encontrada");
    try {
      await fbGet(`/${row.fb_page_id}`, { access_token: row.access_token, fields: "id,name" });
      await supabase.from("fb_pages").update({ is_active: true, last_checked_at: new Date().toISOString() }).eq("id", row.id);
      return { ok: true };
    } catch (e: any) {
      await supabase.from("fb_pages").update({ is_active: false, last_checked_at: new Date().toISOString() }).eq("id", row.id);
      return { ok: false, error: e.message };
    }
  });

export const deletePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("fb_pages").delete().eq("id", data.pageId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageIds: z.array(z.string().uuid()).optional(), all: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("fb_pages").delete({ count: "exact" }).eq("user_id", userId);
    if (!data.all) {
      if (!data.pageIds || data.pageIds.length === 0) return { ok: true, deleted: 0 };
      q = q.in("id", data.pageIds);
    }
    const { error, count } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });

export const updatePageToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ pageId: z.string().uuid(), accessToken: z.string().min(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: rowErr } = await supabase
      .from("fb_pages").select("id, fb_page_id").eq("id", data.pageId).eq("user_id", userId).single();
    if (rowErr || !row) throw new Error("Página não encontrada");

    // Validate the new token belongs to this page
    let me: any;
    try {
      me = await fbGet("/me", { access_token: data.accessToken, fields: "id,name,category" });
    } catch (e: any) {
      return { ok: false as const, error: `Token inválido: ${e?.message ?? "erro"}` };
    }
    if (me.id !== row.fb_page_id) {
      return {
        ok: false as const,
        error: `Este token pertence à página ${me.name ?? me.id} (ID ${me.id}), não à página atual (ID ${row.fb_page_id}).`,
      };
    }

    const { error } = await supabase
      .from("fb_pages")
      .update({
        access_token: data.accessToken,
        is_active: true,
        needs_reconnect: false,
        reconnect_reason: null,
        token_debug_error: null,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", data.pageId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    await supabase.from("activity_logs").insert({
      user_id: userId, action: "page.token_updated", entity: "fb_page", entity_id: data.pageId,
      metadata: { name: me.name }, status: "ok",
    });

    return { ok: true as const };
  });

export const listPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fb_pages")
      .select("id, fb_page_id, name, category, picture_url, is_active, last_checked_at, created_at, token_expires_at, token_data_access_expires_at, token_scopes, token_last_debugged_at, token_last_refreshed_at, token_debug_error")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

// Triggers the same monthly debug+refresh routine on demand.
export const refreshTokensNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    withinDays: z.number().int().positive().max(365).optional(),
    force: z.boolean().optional(),
  }).optional().parse(d) ?? {})
  .handler(async ({ data }) => {
    const { runRefreshTokens } = await import("@/lib/refresh-tokens.server");
    // Por padrão (force=false): pula tokens com >30d de validade para economizar quota.
    // Usuário pode forçar tudo passando force=true.
    return runRefreshTokens({ force: data?.force ?? false, withinDays: data?.withinDays });
  });


export const listRefreshReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("refresh_reports")
      .select("id, created_at, source, summary, results")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; created_at: string; source: string;
      summary: any; results: any[];
    }>;
  });

export const inspectTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("fb_pages")
      .select("id, access_token")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const creds = await getAppCredsForUser(supabase, userId);
    const canExtend = !!creds;
    let maxUsage: import("@/lib/fb-graph").AppUsage | null = null;
    const mergeUsage = (u: import("@/lib/fb-graph").AppUsage | null) => {
      if (!u) return;
      if (!maxUsage) { maxUsage = u; return; }
      maxUsage = {
        call_count: Math.max(maxUsage.call_count, u.call_count),
        total_time: Math.max(maxUsage.total_time, u.total_time),
        total_cputime: Math.max(maxUsage.total_cputime, u.total_cputime),
        max: Math.max(maxUsage.max, u.max),
      };
    };

    const out: Record<string, {
      isValid: boolean;
      expiresAt: number | null;
      dataAccessExpiresAt: number | null;
      scopes: string[];
      accessToken: string;
      longLivedToken: string | null;
      longLivedExpiresAt: number | null;
      extendError?: string;
      error?: string;
    }> = {};

    await Promise.all((rows ?? []).map(async (row) => {
      const base = {
        isValid: false as boolean,
        expiresAt: null as number | null,
        dataAccessExpiresAt: null as number | null,
        scopes: [] as string[],
        accessToken: row.access_token as string,
        longLivedToken: null as string | null,
        longLivedExpiresAt: null as number | null,
        extendError: undefined as string | undefined,
        error: undefined as string | undefined,
      };

      try {
        const r = await fbGet<any>("/debug_token", {
          input_token: row.access_token,
          access_token: row.access_token,
        });
        const d = r?.data ?? {};
        base.isValid = !!d.is_valid;
        base.expiresAt = typeof d.expires_at === "number" ? d.expires_at : null;
        base.dataAccessExpiresAt = typeof d.data_access_expires_at === "number" ? d.data_access_expires_at : null;
        base.scopes = Array.isArray(d.scopes) ? d.scopes : [];
        base.error = d.error?.message;
      } catch (e: any) {
        base.error = e?.message ?? "erro";
      }

      if (base.expiresAt === 0) {
        base.longLivedToken = row.access_token;
        base.longLivedExpiresAt = 0;
      } else if (canExtend && creds) {
        try {
          const { data: r, usage } = await fbGetWithUsage<any>("/oauth/access_token", {
            grant_type: "fb_exchange_token",
            client_id: creds.appId,
            client_secret: creds.appSecret,
            fb_exchange_token: row.access_token,
          });
          mergeUsage(usage);
          if (r?.access_token) {
            base.longLivedToken = r.access_token;
            base.longLivedExpiresAt = typeof r.expires_in === "number"
              ? Math.floor(Date.now() / 1000) + r.expires_in
              : 0;
          }
        } catch (e: any) {
          if (e?.usage) mergeUsage(e.usage);
          base.extendError = e?.message ?? "falha ao estender";
        }
      } else {
        base.longLivedToken = row.access_token;
        base.longLivedExpiresAt = base.expiresAt;
      }

      out[row.id] = base;

      // Persiste o resultado do debug_token no banco para que a listagem mostre
      // a expiração sem precisar reabrir a página.
      const upd: Record<string, any> = {
        token_last_debugged_at: new Date().toISOString(),
        is_active: base.isValid,
        token_debug_error: base.error ?? null,
        token_scopes: base.scopes,
      };
      // expires_at = 0 (Facebook) significa "não expira" — gravamos NULL e
      // tratamos no UI via token_last_debugged_at.
      upd.token_expires_at = base.expiresAt && base.expiresAt > 0
        ? new Date(base.expiresAt * 1000).toISOString()
        : null;
      upd.token_data_access_expires_at = base.dataAccessExpiresAt && base.dataAccessExpiresAt > 0
        ? new Date(base.dataAccessExpiresAt * 1000).toISOString()
        : null;
      await supabase.from("fb_pages").update(upd as any).eq("id", row.id).eq("user_id", userId);
    }));


    if (creds) await recordAppUsage(supabase, userId, creds.slot, maxUsage);

    return out;
  });
