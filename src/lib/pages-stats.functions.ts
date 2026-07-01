import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet } from "@/lib/fb-graph";

// Busca followers/fan_count + insights de 28d de cada página.
// Permissões necessárias no Page Access Token:
//   - pages_show_list (padrão)
//   - pages_read_engagement  -> followers_count, fan_count, insights básicos
//   - read_insights          -> métricas de insights (page_impressions, etc)
async function fetchStatsForPage(fbPageId: string, token: string) {
  // 1) followers_count + fan_count
  const basic: any = await fbGet(`/${fbPageId}`, {
    fields: "followers_count,fan_count",
    access_token: token,
  });
  const followers_count = Number(basic?.followers_count ?? 0) || null;
  const fan_count = Number(basic?.fan_count ?? 0) || null;

  // 2) insights 28d (podem falhar em páginas pequenas / sem permissão)
  let impressions_28d: number | null = null;
  let reach_28d: number | null = null;
  let engaged_users_28d: number | null = null;
  let post_engagements_28d: number | null = null;
  try {
    const ins: any = await fbGet(`/${fbPageId}/insights`, {
      metric: "page_impressions,page_impressions_unique,page_post_engagements,page_engaged_users",
      period: "days_28",
      access_token: token,
    });
    for (const row of ins?.data ?? []) {
      const values = row?.values ?? [];
      const last = values[values.length - 1];
      const v = Number(last?.value ?? 0);
      if (row.name === "page_impressions") impressions_28d = v;
      else if (row.name === "page_impressions_unique") reach_28d = v;
      else if (row.name === "page_engaged_users") engaged_users_28d = v;
      else if (row.name === "page_post_engagements") post_engagements_28d = v;
    }
  } catch { /* mantém null */ }

  return { followers_count, fan_count, impressions_28d, reach_28d, engaged_users_28d, post_engagements_28d };
}

export const syncPageStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      pageIds: z.array(z.string()).optional(), // se vazio, todas ativas
      limit: z.number().int().positive().max(500).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let query = supabase
      .from("fb_pages")
      .select("id, fb_page_id, name, access_token, is_active, needs_reconnect")
      .eq("user_id", userId);
    if (data.pageIds?.length) query = query.in("id", data.pageIds);
    else query = query.eq("is_active", true).eq("needs_reconnect", false);

    const { data: pages, error } = await query.limit(data.limit ?? 500);
    if (error) throw new Error(error.message);

    const results: Array<{ pageId: string; name: string; ok: boolean; error?: string }> = [];
    let ok = 0, failed = 0;

    for (const p of pages ?? []) {
      try {
        const stats = await fetchStatsForPage(p.fb_page_id, p.access_token);
        const { error: upErr } = await supabase
          .from("fb_pages")
          .update({
            ...stats,
            stats_updated_at: new Date().toISOString(),
            stats_error: null,
          })
          .eq("id", p.id);
        if (upErr) throw new Error(upErr.message);
        results.push({ pageId: p.id, name: p.name, ok: true });
        ok++;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        await supabase
          .from("fb_pages")
          .update({ stats_updated_at: new Date().toISOString(), stats_error: msg.slice(0, 500) })
          .eq("id", p.id);
        results.push({ pageId: p.id, name: p.name, ok: false, error: msg });
        failed++;
      }
      // pequeno jitter pra não estourar quota
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
    }

    return { total: (pages ?? []).length, ok, failed, results };
  });
