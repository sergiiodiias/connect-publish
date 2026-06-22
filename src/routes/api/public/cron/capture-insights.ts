import { createFileRoute } from "@tanstack/react-router";

async function run() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fbGet } = await import("@/lib/fb-graph");

    // Find published targets older than 24h that don't yet have a '24h' snapshot
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: targets, error } = await supabaseAdmin
      .from("post_targets")
      .select("id, user_id, post_id, page_id, fb_post_id, published_at, fb_pages!inner(access_token)")
      .eq("status", "published")
      .not("fb_post_id", "is", null)
      .lte("published_at", cutoff)
      .limit(200);

    if (error) throw error;

    const existing = new Set<string>();
    if ((targets ?? []).length) {
      const { data: ex } = await supabaseAdmin
        .from("post_insights")
        .select("post_target_id")
        .eq("snapshot_type", "24h")
        .in("post_target_id", (targets ?? []).map((t) => t.id));
      for (const r of ex ?? []) existing.add(r.post_target_id as string);
    }

    const todo = (targets ?? []).filter((t) => !existing.has(t.id));
    const out: any[] = [];

    for (const t of todo) {
      const token = (t as any).fb_pages?.access_token as string | undefined;
      if (!token || !t.fb_post_id) continue;
      try {
        const data: any = await fbGet(`/${t.fb_post_id}`, {
          fields:
            "likes.summary(true).limit(0),comments.summary(true).limit(0),reactions.summary(true).limit(0),shares",
          access_token: token,
        });
        const likes = Number(data?.likes?.summary?.total_count ?? 0);
        const reactions = Number(data?.reactions?.summary?.total_count ?? likes);
        const comments = Number(data?.comments?.summary?.total_count ?? 0);
        const shares = Number(data?.shares?.count ?? 0);

        let video_views: number | null = null;
        let reach: number | null = null;
        let impressions: number | null = null;
        try {
          const ins: any = await fbGet(`/${t.fb_post_id}/insights`, {
            metric: "post_impressions,post_impressions_unique,post_video_views",
            access_token: token,
          });
          for (const row of ins?.data ?? []) {
            const v = Number(row?.values?.[0]?.value ?? 0);
            if (row.name === "post_impressions") impressions = v;
            else if (row.name === "post_impressions_unique") reach = v;
            else if (row.name === "post_video_views") video_views = v;
          }
        } catch {}

        const score =
          likes + reactions + comments * 3 + shares * 5 + Math.floor((video_views ?? 0) / 10);

        await supabaseAdmin.from("post_insights").upsert(
          {
            user_id: t.user_id,
            post_target_id: t.id,
            post_id: t.post_id,
            page_id: t.page_id,
            fb_post_id: t.fb_post_id,
            snapshot_type: "24h",
            likes,
            comments,
            shares,
            reactions,
            video_views,
            reach,
            impressions,
            engagement_score: score,
          },
          { onConflict: "post_target_id", ignoreDuplicates: true },
        );
        out.push({ targetId: t.id, ok: true });
      } catch (e: any) {
        out.push({ targetId: t.id, ok: false, error: e?.message ?? String(e) });
      }
    }

    return Response.json({
      ok: true,
      candidates: (targets ?? []).length,
      processed: out.length,
      failed: out.filter((x) => !x.ok).length,
    });
  } catch (e: any) {
    console.error("[cron/capture-insights]", e);
    return Response.json({ ok: false, error: e?.message ?? "erro" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/capture-insights")({
  server: {
    handlers: {
      POST: () => run(),
      GET: () => run(),
    },
  },
});
