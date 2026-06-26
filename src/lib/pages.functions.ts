import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet, fbPost } from "@/lib/fb-graph";
import { recordAppUsage } from "@/lib/fb-app-creds";
import { debugFacebookToken, normalizeFacebookExpiresAt, reconnectReasonFromDebugError } from "@/lib/fb-token-debug";
import { tryExtendToken, loadAppCredsForExtend } from "@/lib/fb-extend-token";

// Connect a page by pasting either a Page Access Token directly,
// or a User Access Token containing pages — we'll list and pick the matching one.
// Considera um token "ainda válido" e portanto preservável quando:
// - a página está ativa, não está marcada para reconectar
// - e não tem expiração conhecida OU expira em mais de 7 dias
function isStoredTokenStillValid(row: any): boolean {
  if (!row) return false;
  if (row.is_active === false) return false;
  if (row.needs_reconnect === true) return false;
  if (!row.token_expires_at) return true; // sem expiry = permanente / desconhecido válido
  const ms = new Date(row.token_expires_at).getTime() - Date.now();
  return ms > 7 * 24 * 3600 * 1000;
}

export const connectPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accessToken: z.string().min(20),
      pageId: z.string().optional(),
      overwriteExisting: z.boolean().optional(), // default false: preserva token já validado
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Carrega creds (para estender tokens automaticamente)
    const creds = await loadAppCredsForExtend(supabase, userId);

    // First try as a page token: /me returns the Page object if so
    let pageId = data.pageId;
    let pageToken = data.accessToken;
    let tokenExpiresAt: number | null = null; // epoch seconds; 0 = não expira
    let extendedNow = false;
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
      // It IS a page token — tenta estender direto
      pageId = me.id;
      const ex = await tryExtendToken(data.accessToken, creds);
      if (ex.extended) {
        pageToken = ex.token;
        tokenExpiresAt = ex.expiresAt;
        extendedNow = true;
      }
    } else {
      // It's a user token — estende primeiro para garantir Page Tokens permanentes
      let userToken = data.accessToken;
      const exUser = await tryExtendToken(userToken, creds);
      if (exUser.extended) { userToken = exUser.token; extendedNow = true; }

      let pages: { data: any[] };
      try {
        pages = await fbGet<{ data: any[] }>("/me/accounts", { access_token: userToken, fields: "id,name,category,access_token" });
      } catch (e: any) {
        return { ok: false, error: `Não consegui listar páginas com esse token: ${e?.message ?? "erro desconhecido"}` };
      }
      const chosen = pageId ? pages.data.find((p) => p.id === pageId) : pages.data[0];
      if (!chosen) return { ok: false, error: "Nenhuma página encontrada para esse token" };
      pageId = chosen.id;
      pageToken = chosen.access_token;
      tokenExpiresAt = 0; // Page Tokens derivados de User Token long-lived são permanentes
      me = chosen;
    }

    // Preserva token já validado se a página já existe
    if (!data.overwriteExisting) {
      const { data: existing } = await supabase
        .from("fb_pages")
        .select("id, fb_page_id, name, is_active, needs_reconnect, token_expires_at")
        .eq("user_id", userId)
        .eq("fb_page_id", pageId!)
        .maybeSingle();
      if (existing && isStoredTokenStillValid(existing)) {
        return { ok: true, page: existing, skipped: true as const, reason: "Token existente ainda válido — preservado" };
      }
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
        needs_reconnect: false,
        reconnect_reason: null,
        token_debug_error: null,
        token_last_refreshed_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        token_expires_at: tokenExpiresAt && tokenExpiresAt > 0
          ? new Date(tokenExpiresAt * 1000).toISOString()
          : tokenExpiresAt === 0 ? null : undefined,
        // Limpa cache de debug pra forçar reverificação no próximo "Verificar validade"
        token_last_debugged_at: null,
      }, { onConflict: "user_id,fb_page_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("activity_logs").insert({
      user_id: userId, action: "page.connected", entity: "fb_page", entity_id: upserted.id,
      metadata: { name: me.name, extended: extendedNow }, status: "ok",
    });

    return { ok: true, page: upserted, skipped: false as const, extended: extendedNow };
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

// Reconecta páginas em lote usando um User Access Token (long-lived ou short-lived).
// Chama /me/accounts paginando, e atualiza o access_token de cada página correspondente.
// Resolve o problema dos tokens de página degradados sem precisar atualizar uma por uma.
export const reconnectAllWithUserToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      userAccessToken: z.string().min(20),
      onlyNeedsReconnect: z.boolean().optional(),
      overwriteValid: z.boolean().optional(), // default false: preserva tokens ainda válidos
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Tenta estender o User Token para long-lived (se houver app configurado)
    let userToken = data.userAccessToken;
    let extendedUserToken = false;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2")
        .eq("id", userId)
        .single();
      const creds: Array<{ id: string; secret: string }> = [];
      if (profile?.fb_app_id && profile.fb_app_secret) creds.push({ id: profile.fb_app_id, secret: profile.fb_app_secret });
      if (profile?.fb_app_id_2 && profile.fb_app_secret_2) creds.push({ id: profile.fb_app_id_2, secret: profile.fb_app_secret_2 });
      if (process.env.FB_APP_ID && process.env.FB_APP_SECRET) creds.push({ id: process.env.FB_APP_ID, secret: process.env.FB_APP_SECRET });
      for (const c of creds) {
        try {
          const r = await fbGet<{ access_token: string }>("/oauth/access_token", {
            grant_type: "fb_exchange_token",
            client_id: c.id,
            client_secret: c.secret,
            fb_exchange_token: userToken,
          });
          if (r?.access_token) {
            userToken = r.access_token;
            extendedUserToken = true;
            break;
          }
        } catch { /* tenta próximo app */ }
      }
    } catch { /* segue com o token original */ }

    // 2) Lista todas as páginas do User Token (paginação manual via fetch)
    type PageItem = { id: string; name: string; access_token: string; category?: string };
    const allPages: PageItem[] = [];
    try {
      let next: string | null = `https://graph.facebook.com/v21.0/me/accounts?fields=${encodeURIComponent("id,name,category,access_token")}&limit=200&access_token=${encodeURIComponent(userToken)}`;
      while (next) {
        const r: any = await (await fetch(next)).json();
        if (r?.error) throw new Error(r.error.message);
        if (Array.isArray(r?.data)) allPages.push(...r.data);
        next = r?.paging?.next ?? null;
      }
    } catch (e: any) {
      return { ok: false as const, error: `Falha ao listar páginas do User Token: ${e?.message ?? "erro"}` };
    }

    if (allPages.length === 0) {
      return { ok: false as const, error: "Nenhuma página encontrada para este User Token. Verifique se os scopes pages_show_list e pages_manage_posts foram concedidos." };
    }

    // 3) Carrega páginas locais para fazer match por fb_page_id
    let q = supabase
      .from("fb_pages")
      .select("id, fb_page_id, name, is_active, needs_reconnect, token_expires_at")
      .eq("user_id", userId);
    if (data.onlyNeedsReconnect) q = q.eq("needs_reconnect", true);
    const { data: localPages, error: lpErr } = await q;
    if (lpErr) throw new Error(lpErr.message);

    const byFbId = new Map(allPages.map((p) => [p.id, p]));
    let updated = 0;
    let skipped = 0;
    let notFound = 0;
    const updatedNames: string[] = [];
    const skippedNames: string[] = [];
    const notFoundNames: string[] = [];

    for (const lp of localPages ?? []) {
      const remote = byFbId.get(lp.fb_page_id);
      if (!remote) {
        notFound++;
        notFoundNames.push(lp.name);
        continue;
      }
      // Preserva token já validado a menos que o usuário peça para sobrescrever
      if (!data.overwriteValid && isStoredTokenStillValid(lp)) {
        skipped++;
        skippedNames.push(lp.name);
        continue;
      }
      const { error: updErr } = await supabase
        .from("fb_pages")
        .update({
          access_token: remote.access_token,
          is_active: true,
          needs_reconnect: false,
          reconnect_reason: null,
          token_debug_error: null,
          token_last_refreshed_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
          // Limpa expiry para forçar redebug na próxima verificação
          token_last_debugged_at: null,
        })
        .eq("id", lp.id)
        .eq("user_id", userId);
      if (!updErr) {
        updated++;
        updatedNames.push(lp.name);
      }
    }

    await supabase.from("activity_logs").insert({
      user_id: userId,
      action: "pages.bulk_reconnected",
      entity: "fb_page",
      entity_id: null,
      metadata: { updated, skipped, notFound, extendedUserToken, totalRemote: allPages.length },
      status: "ok",
    });

    return {
      ok: true as const,
      updated,
      skipped,
      notFound,
      totalRemote: allPages.length,
      extendedUserToken,
      updatedNames,
      skippedNames,
      notFoundNames,
    };
  });

export const listPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fb_pages")
      .select("id, fb_page_id, name, category, picture_url, is_active, last_checked_at, created_at, token_expires_at, token_data_access_expires_at, token_scopes, token_last_debugged_at, token_last_refreshed_at, token_debug_error, needs_reconnect, reconnect_reason")
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

// Renovação 1-a-1: processa apenas uma página. Usa a mesma rotina,
// com filtro por pageId + userId — só 1-2 chamadas de Graph API por clique.
export const refreshOnePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid(), force: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { runRefreshTokens } = await import("@/lib/refresh-tokens.server");
    return runRefreshTokens({
      pageIds: [data.pageId],
      userId: context.userId,
      force: data.force ?? true, // botão individual: sempre força
    });
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
  .inputValidator((d) => z.object({ force: z.boolean().optional() }).optional().parse(d) ?? {})
  .handler(async ({ data, context }) => {
    const { withApiCallTracking } = await import("@/lib/fb-api-tracker.server");
    return withApiCallTracking(context.userId, async () => {
    const force = !!data?.force;
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("fb_pages")
      .select("id, access_token, token_last_debugged_at, token_expires_at, token_data_access_expires_at, token_scopes, is_active, token_debug_error")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    // Carrega TODAS as creds configuradas e indexa por app_id.
    // Exchange só funciona com o App que EMITIU o token — não dá pra rotacionar.
    const { data: profile } = await supabase
      .from("profiles")
      .select("fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2")
      .eq("id", userId)
      .single();
    type Slot = { slot: 1 | 2; appId: string; appSecret: string };
    const credsByAppId = new Map<string, Slot>();
    const configuredCreds: Slot[] = [];
    const addCred = (cred: Slot) => {
      if (!credsByAppId.has(cred.appId)) configuredCreds.push(cred);
      credsByAppId.set(cred.appId, cred);
    };
    if (profile?.fb_app_id && profile.fb_app_secret) addCred({ slot: 1, appId: profile.fb_app_id, appSecret: profile.fb_app_secret });
    if (profile?.fb_app_id_2 && profile.fb_app_secret_2) addCred({ slot: 2, appId: profile.fb_app_id_2, appSecret: profile.fb_app_secret_2 });
    const envAppId = process.env.FB_APP_ID;
    const envAppSecret = process.env.FB_APP_SECRET;
    if (envAppId && envAppSecret && !credsByAppId.has(envAppId)) {
      addCred({ slot: 1, appId: envAppId, appSecret: envAppSecret });
    }
    const canExtendAny = credsByAppId.size > 0;
    const usageBySlot = new Map<1 | 2, import("@/lib/fb-graph").AppUsage>();
    const mergeUsageForSlot = (slot: 1 | 2, u: import("@/lib/fb-graph").AppUsage | null) => {
      if (!u) return;
      const cur = usageBySlot.get(slot);
      if (!cur) { usageBySlot.set(slot, u); return; }
      usageBySlot.set(slot, {
        call_count: Math.max(cur.call_count, u.call_count),
        total_time: Math.max(cur.total_time, u.total_time),
        total_cputime: Math.max(cur.total_cputime, u.total_cputime),
        max: Math.max(cur.max, u.max),
      });
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
      cached?: boolean;
    }> = {};

    // Cache: pula debug_token se já verificamos nas últimas 6h.
    // Evita estourar quota quando o usuário clica "Verificar validade" várias vezes.
    const CACHE_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();

    // Processa em pequenos lotes (3 simultâneos) em vez de bursting tudo.
    const tasks = (rows ?? []).map((row) => async () => {
      const lastDebug = row.token_last_debugged_at ? new Date(row.token_last_debugged_at).getTime() : 0;
      const isFresh = !force && lastDebug && now - lastDebug < CACHE_MS;

      if (isFresh) {
        const expSec = row.token_expires_at ? Math.floor(new Date(row.token_expires_at).getTime() / 1000) : (row.is_active ? 0 : null);
        const dataExpSec = row.token_data_access_expires_at ? Math.floor(new Date(row.token_data_access_expires_at).getTime() / 1000) : null;
        out[row.id] = {
          isValid: !!row.is_active,
          expiresAt: expSec,
          dataAccessExpiresAt: dataExpSec,
          scopes: Array.isArray(row.token_scopes) ? row.token_scopes as string[] : [],
          accessToken: row.access_token,
          longLivedToken: row.access_token,
          longLivedExpiresAt: expSec,
          error: row.token_debug_error ?? undefined,
          extendError: canExtendAny ? "Use Renovar agora para estender este token." : undefined,
          cached: true,
        };
        return;
      }

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
        debugError: null as any,
      };

      let issuerAppId: string | null = null;
      try {
        const r = await debugFacebookToken(row.access_token, configuredCreds);
        const d = r.data ?? {};
        if (r.slot) mergeUsageForSlot(r.slot, r.usage);
        base.isValid = !!d.is_valid;
        base.expiresAt = normalizeFacebookExpiresAt(d);
        base.dataAccessExpiresAt = typeof d.data_access_expires_at === "number" ? d.data_access_expires_at : null;
        base.scopes = Array.isArray(d.scopes) ? d.scopes : [];
        base.error = d.error?.message;
        base.debugError = d.error ?? null;
        issuerAppId = r.appId ?? (d.app_id ? String(d.app_id) : null);
      } catch (e: any) {
        base.error = e?.message ?? "erro";
      }

      const matchedCreds = issuerAppId ? credsByAppId.get(issuerAppId) ?? null : null;

      if (base.expiresAt === 0) {
        base.longLivedToken = row.access_token;
        base.longLivedExpiresAt = 0;
      } else if (matchedCreds) {
        base.longLivedToken = null;
        base.longLivedExpiresAt = base.expiresAt;
        base.extendError = "Use Renovar agora para estender este token.";
      } else if (canExtendAny && issuerAppId) {
        base.longLivedToken = row.access_token;
        base.longLivedExpiresAt = base.expiresAt;
        base.extendError = `Token emitido pelo App ${issuerAppId}, não configurado em Ajustes.`;
      } else {
        base.longLivedToken = row.access_token;
        base.longLivedExpiresAt = base.expiresAt;
      }

      out[row.id] = base;

      const upd: Record<string, any> = {
        token_last_debugged_at: new Date().toISOString(),
        is_active: base.isValid,
        token_debug_error: base.error ?? null,
        token_scopes: base.scopes,
      };
      const reconnectReason = reconnectReasonFromDebugError(base.debugError);
      if (reconnectReason) {
        upd.needs_reconnect = true;
        upd.reconnect_reason = reconnectReason;
      } else if (base.isValid) {
        upd.needs_reconnect = false;
        upd.reconnect_reason = null;
      }
      upd.token_expires_at = base.expiresAt && base.expiresAt > 0
        ? new Date(base.expiresAt * 1000).toISOString()
        : null;
      upd.token_data_access_expires_at = base.dataAccessExpiresAt && base.dataAccessExpiresAt > 0
        ? new Date(base.dataAccessExpiresAt * 1000).toISOString()
        : null;
      await supabase.from("fb_pages").update(upd as any).eq("id", row.id).eq("user_id", userId);
    });

    // Concorrência limitada a 3 (vs Promise.all que disparava tudo de uma vez)
    const CONCURRENCY = 3;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        await tasks[i]();
      }
    }));

    for (const [slot, usage] of usageBySlot.entries()) {
      await recordAppUsage(supabase, userId, slot, usage);
    }

    return out;
    });
  });


