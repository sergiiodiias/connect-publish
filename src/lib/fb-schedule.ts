// Shared helper that pushes pending post_targets to Facebook's native scheduler.
// Used by both `migrateScheduledToFacebook` and `createBulkJob` so the bulk
// importer can publish directly to FB without relying on the cron worker.
import { publishFacebookPost } from "@/lib/fb-publish";
import { fbGet } from "@/lib/fb-graph";

const FB_MIN_SCHEDULE_MS = 10 * 60 * 1000 + 30_000;
const FB_MAX_SCHEDULE_MS = 75 * 24 * 60 * 60 * 1000;
const FB_SCHEDULE_MATCH_WINDOW_SECONDS = 90;

function normalizeFbText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function findExistingScheduledFacebookPost(opts: {
  fbPageId: string;
  pageToken: string;
  message: string;
  scheduledUnix: number;
}) {
  const wanted = normalizeFbText(opts.message || "");
  if (!wanted) return null;
  const scheduled: any = await fbGet(`/${opts.fbPageId}/scheduled_posts`, {
    access_token: opts.pageToken,
    fields: "id,message,scheduled_publish_time",
    limit: "100",
  });
  const match = (scheduled?.data ?? []).find((item: any) => {
    if (normalizeFbText(item?.message ?? "") !== wanted) return false;
    const fbTime = Number(item?.scheduled_publish_time ?? 0);
    return Math.abs(fbTime - opts.scheduledUnix) <= FB_SCHEDULE_MATCH_WINDOW_SECONDS;
  });
  return match?.id ? String(match.id) : null;
}

export type ScheduleResult = {
  scheduled: number;
  skipped: number;
  failed: number;
  errors: string[];
  processed: number;
};

export async function scheduleTargetsNative(opts: {
  supabase: any;
  userId: string;
  targetIds?: string[];
  batchSize?: number;
  concurrency?: number;
}): Promise<ScheduleResult> {
  const { supabase, userId } = opts;
  const BATCH = opts.batchSize ?? 10;
  const CONCURRENCY = opts.concurrency ?? 5;
  const maxIso = new Date(Date.now() + FB_MAX_SCHEDULE_MS).toISOString();
  const minIso = new Date(Date.now() + FB_MIN_SCHEDULE_MS).toISOString();

  let q = supabase
    .from("post_targets")
    .select(`
      id, page_id, status, fb_post_id, post_id,
      posts!inner(id, type, message, link_url, media_urls, scheduled_at, user_id)
    `)
    .eq("user_id", userId)
    .is("fb_post_id", null)
    .in("status", ["pending", "failed"])
    .gte("posts.scheduled_at", minIso)
    .lte("posts.scheduled_at", maxIso)
    .order("scheduled_at", { foreignTable: "posts", ascending: true })
    .limit(BATCH);
  if (opts.targetIds && opts.targetIds.length) q = q.in("id", opts.targetIds);

  const { data: targetsRaw, error: terr } = await q;
  if (terr) throw new Error(terr.message);

  type Job = {
    target: { id: string; page_id: string };
    post: { id: string; type: string; message: string | null; link_url: string | null; media_urls: string[] | null };
    scheduledUnix: number;
    scheduledAtIso: string;
  };
  const jobs: Job[] = [];
  for (const t of (targetsRaw ?? []) as any[]) {
    const sched = t.posts?.scheduled_at;
    if (!sched) continue;
    const ts = new Date(sched).getTime();
    if (ts - Date.now() < FB_MIN_SCHEDULE_MS) continue;
    jobs.push({
      target: { id: t.id, page_id: t.page_id },
      post: t.posts,
      scheduledUnix: Math.floor(ts / 1000),
      scheduledAtIso: sched,
    });
  }

  const postIdSet = [...new Set(jobs.map((j) => j.post.id))];
  const { data: tmplRows } = postIdSet.length
    ? await supabase.from("auto_comments")
        .select("id, post_id, message, delay_seconds")
        .in("post_id", postIdSet)
        .is("target_id", null)
    : { data: [] as any[] };
  const tmplByPost = new Map<string, any[]>();
  for (const r of (tmplRows ?? []) as any[]) {
    const arr = tmplByPost.get(r.post_id) ?? [];
    arr.push(r);
    tmplByPost.set(r.post_id, arr);
  }

  const pageIds = [...new Set(jobs.map((j) => j.target.page_id))];
  const { data: pages } = pageIds.length
    ? await supabase.from("fb_pages").select("id, fb_page_id, access_token, is_active, name").in("id", pageIds)
    : { data: [] as any[] };
  const pageMap = new Map((pages ?? []).map((p: any) => [p.id, p]));

  let scheduled = 0, skipped = 0, failed = 0;
  const errors: string[] = [];
  let cursor = 0;

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const j = jobs[i];
      const pg = pageMap.get(j.target.page_id);
      if (!pg || pg.is_active === false) {
        skipped++;
        await supabase.from("post_targets")
          .update({ error: pg ? "página inativa" : "página não encontrada" })
          .eq("id", j.target.id);
        continue;
      }
      const { data: claimed } = await supabase
        .from("post_targets")
        .update({ status: "publishing" } as any)
        .eq("id", j.target.id)
        .eq("status", "pending")
        .is("fb_post_id", null)
        .select("id")
        .maybeSingle();
      if (!claimed) { skipped++; continue; }
      try {
        const existingFbId = await findExistingScheduledFacebookPost({
          fbPageId: pg.fb_page_id,
          pageToken: pg.access_token,
          message: j.post.message ?? "",
          scheduledUnix: j.scheduledUnix,
        });
        if (existingFbId) {
          await supabase.from("post_targets")
            .update({ fb_post_id: existingFbId, status: "pending", error: "agendamento já existia no Facebook; não duplicado", next_retry_at: null } as any)
            .eq("id", j.target.id);
          skipped++;
          continue;
        }
        const fbId = await publishFacebookPost({
          type: j.post.type as any,
          message: j.post.message ?? "",
          linkUrl: j.post.link_url ?? undefined,
          mediaUrls: j.post.media_urls ?? [],
          fbPageId: pg.fb_page_id,
          pageToken: pg.access_token,
          scheduledUnix: j.scheduledUnix,
        });
        await supabase.from("post_targets")
          .update({ fb_post_id: fbId, status: "pending", error: null, next_retry_at: null } as any)
          .eq("id", j.target.id);

        const tmpls = tmplByPost.get(j.post.id) ?? [];
        if (tmpls.length) {
          const baseMs = new Date(j.scheduledAtIso).getTime();
          const rows = tmpls.map((c) => ({
            user_id: userId,
            post_id: j.post.id,
            target_id: j.target.id,
            message: c.message,
            delay_seconds: c.delay_seconds,
            run_at: new Date(baseMs + (c.delay_seconds ?? 0) * 1000).toISOString(),
          }));
          const { data: existing } = await supabase
            .from("auto_comments")
            .select("id, post_id, target_id, message")
            .eq("target_id", j.target.id)
            .eq("post_id", j.post.id);
          const existingKeys = new Set((existing ?? []).map((r: any) => `${r.post_id}::${r.target_id}::${r.message}`));
          const missingRows = rows.filter((r) => !existingKeys.has(`${r.post_id}::${r.target_id}::${r.message}`));
          if (missingRows.length) await supabase.from("auto_comments").insert(missingRows);
        }
        scheduled++;
      } catch (e: any) {
        try {
          const existingFbId = await findExistingScheduledFacebookPost({
            fbPageId: pg.fb_page_id,
            pageToken: pg.access_token,
            message: j.post.message ?? "",
            scheduledUnix: j.scheduledUnix,
          });
          if (existingFbId) {
            await supabase.from("post_targets")
              .update({ fb_post_id: existingFbId, status: "pending", error: "agendamento confirmado após retorno instável do Facebook", next_retry_at: null } as any)
              .eq("id", j.target.id);
            scheduled++;
            continue;
          }
        } catch {}
        failed++;
        const msg = e?.message ?? String(e);
        errors.push(`${pg.name}: ${msg}`);
        await supabase.from("post_targets")
          .update({ status: "pending", error: `FB schedule: ${msg}` } as any)
          .eq("id", j.target.id);
      }
    }
  }));

  return { scheduled, skipped, failed, errors, processed: jobs.length };
}
