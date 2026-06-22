import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet } from "./fb-graph";

type Metrics = {
  likes: number;
  comments: number;
  shares: number;
  reactions: number;
  video_views: number | null;
  reach: number | null;
  impressions: number | null;
};

function computeScore(m: Metrics): number {
  return (
    m.likes * 1 +
    m.reactions * 1 +
    m.comments * 3 +
    m.shares * 5 +
    Math.floor((m.video_views ?? 0) / 10)
  );
}

async function fetchMetrics(fbPostId: string, pageToken: string): Promise<Metrics> {
  // Core engagement
  const fields = [
    "likes.summary(true).limit(0)",
    "comments.summary(true).limit(0)",
    "reactions.summary(true).limit(0)",
    "shares",
  ].join(",");

  const data: any = await fbGet(`/${fbPostId}`, {
    fields,
    access_token: pageToken,
  });

  const likes = Number(data?.likes?.summary?.total_count ?? 0);
  const reactions = Number(data?.reactions?.summary?.total_count ?? likes);
  const comments = Number(data?.comments?.summary?.total_count ?? 0);
  const shares = Number(data?.shares?.count ?? 0);

  // Insights (impressions, reach, video views) — may fail for some post types
  let video_views: number | null = null;
  let reach: number | null = null;
  let impressions: number | null = null;
  try {
    const ins: any = await fbGet(`/${fbPostId}/insights`, {
      metric: "post_impressions,post_impressions_unique,post_video_views",
      access_token: pageToken,
    });
    for (const row of ins?.data ?? []) {
      const v = Number(row?.values?.[0]?.value ?? 0);
      if (row.name === "post_impressions") impressions = v;
      else if (row.name === "post_impressions_unique") reach = v;
      else if (row.name === "post_video_views") video_views = v;
    }
  } catch {
    // some posts (older, certain types) won't return insights — silently ignore
  }

  return { likes, comments, shares, reactions, video_views, reach, impressions };
}

// -------- Capture metrics for a list of targets (or a single post) --------

export const captureInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { postId?: string; targetIds?: string[]; snapshotType?: "manual" | "24h" }) => input,
  )
  .handler(async ({ data, context }) => {
    const snapshotType = data.snapshotType ?? "manual";
    const { supabase, userId } = context;

    // Resolve target list
    let q = supabase
      .from("post_targets")
      .select("id, post_id, page_id, fb_post_id, status, user_id, fb_pages!inner(access_token)")
      .eq("user_id", userId)
      .not("fb_post_id", "is", null);

    if (data.postId) q = q.eq("post_id", data.postId);
    if (data.targetIds?.length) q = q.in("id", data.targetIds);

    const { data: targets, error } = await q;
    if (error) throw new Error(error.message);

    const results: Array<{ targetId: string; ok: boolean; error?: string }> = [];

    for (const t of targets ?? []) {
      const token = (t as any).fb_pages?.access_token as string | undefined;
      if (!token || !t.fb_post_id) {
        results.push({ targetId: t.id, ok: false, error: "missing token or fb id" });
        continue;
      }
      try {
        const m = await fetchMetrics(t.fb_post_id, token);
        const score = computeScore(m);
        const { error: upErr } = await supabase.from("post_insights").upsert(
          {
            user_id: userId,
            post_target_id: t.id,
            post_id: t.post_id,
            page_id: t.page_id,
            fb_post_id: t.fb_post_id,
            snapshot_type: snapshotType,
            captured_at: new Date().toISOString(),
            likes: m.likes,
            comments: m.comments,
            shares: m.shares,
            reactions: m.reactions,
            video_views: m.video_views,
            reach: m.reach,
            impressions: m.impressions,
            engagement_score: score,
            raw: m as any,
          },
          snapshotType === "24h"
            ? { onConflict: "post_target_id", ignoreDuplicates: true }
            : undefined,
        );
        if (upErr) throw new Error(upErr.message);
        results.push({ targetId: t.id, ok: true });
      } catch (e: any) {
        results.push({ targetId: t.id, ok: false, error: e.message ?? String(e) });
      }
    }

    return {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  });
