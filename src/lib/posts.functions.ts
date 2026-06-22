import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { publishFacebookPost } from "@/lib/fb-publish";

const PostInput = z.object({
  type: z.enum(["text", "photo", "video", "link"]),
  message: z.string().max(60000).optional().default(""),
  linkUrl: z.string().url().optional(),
  mediaUrls: z.array(z.string().url()).default([]),
  pageIds: z.array(z.string().uuid()).min(1),
  scheduledAt: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).default([]),
  autoComment: z.object({
    message: z.string().min(1),
    delaySeconds: z.number().int().min(0).max(86400),
  }).nullable().optional(),
});

// Facebook requires scheduled_publish_time to be between 10 min and 6 months from now.
const FB_MIN_SCHEDULE_MS = 10 * 60 * 1000 + 30_000; // small buffer
const FB_MAX_SCHEDULE_MS = 75 * 24 * 60 * 60 * 1000; // 75 days (FB hard cap is 6mo; stay safer)

// Push existing scheduled posts to Facebook's native scheduler.
// Targets that already have fb_post_id are skipped.
export const migrateScheduledToFacebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const BATCH = 10;            // targets per invocation
    const CONCURRENCY = 5;       // parallel FB calls
    const maxIso = new Date(Date.now() + FB_MAX_SCHEDULE_MS).toISOString();
    const minIso = new Date(Date.now() + 10 * 60 * 1000 + 30_000).toISOString();

    // Query targets directly so we don't miss posts whose status is
    // publishing/partial/failed/draft but still have unsent targets.
    const { data: targetsRaw, error: terr } = await supabase
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

    if (terr) throw new Error(terr.message);

    type Job = {
      target: { id: string; page_id: string };
      post: { id: string; type: string; message: string | null; link_url: string | null; media_urls: string[] | null };
      scheduledUnix: number;
    };
    const jobs: Job[] = [];
    for (const t of (targetsRaw ?? []) as any[]) {
      const sched = t.posts?.scheduled_at;
      if (!sched) continue;
      const ts = new Date(sched).getTime();
      if (ts - Date.now() < 10 * 60 * 1000 + 30_000) continue;
      jobs.push({
        target: { id: t.id, page_id: t.page_id },
        post: t.posts,
        scheduledUnix: Math.floor(ts / 1000),
      });
    }

    // Resolve all page tokens in one query (avoid N round-trips to PG).
    const pageIds = [...new Set(jobs.map((j) => j.target.page_id))];
    const { data: pages } = pageIds.length
      ? await supabase.from("fb_pages")
          .select("id, fb_page_id, access_token, is_active, name")
          .in("id", pageIds)
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
        try {
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
          scheduled++;
        } catch (e: any) {
          failed++;
          const msg = e?.message ?? String(e);
          errors.push(`${pg.name}: ${msg}`);
          await supabase.from("post_targets")
            .update({ error: `FB schedule: ${msg}` })
            .eq("id", j.target.id);
        }
      }
    }));

    return { ok: true, scheduled, skipped, failed, errors: errors.slice(0, 20), batchSize: jobs.length };
  });


export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => PostInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const status = data.scheduledAt ? "scheduled" : "draft";

    const { data: post, error } = await supabase.from("posts").insert({
      user_id: userId,
      type: data.type,
      message: data.message ?? "",
      link_url: data.linkUrl ?? null,
      media_urls: data.mediaUrls,
      status,
      scheduled_at: data.scheduledAt ?? null,
      tags: data.tags,
    }).select().single();
    if (error || !post) throw new Error(error?.message ?? "Falha ao salvar");

    const targets = data.pageIds.map((pid) => ({
      post_id: post.id, page_id: pid, user_id: userId, status: "pending" as const,
    }));
    const { data: insertedTargets, error: terr } = await supabase.from("post_targets").insert(targets).select("id, page_id");
    if (terr) throw new Error(terr.message);

    if (data.autoComment) {
      await supabase.from("auto_comments").insert({
        user_id: userId, post_id: post.id,
        message: data.autoComment.message, delay_seconds: data.autoComment.delaySeconds,
      });
    }

    // Try to schedule natively on Facebook for each target.
    // If the scheduledAt is within FB's allowed window, push as draft+scheduled_publish_time.
    // Successful targets get fb_post_id set, so the cron skips them and FB publishes natively.
    // Failures leave the target as plain pending — the cron will retry at scheduled_at as fallback.
    let fbScheduled = 0;
    const fbErrors: string[] = [];
    if (data.scheduledAt) {
      const ts = new Date(data.scheduledAt).getTime();
      const delta = ts - Date.now();
      if (delta >= FB_MIN_SCHEDULE_MS && delta <= FB_MAX_SCHEDULE_MS) {
        const scheduledUnix = Math.floor(ts / 1000);
        for (const t of insertedTargets ?? []) {
          const { data: pg } = await supabase.from("fb_pages")
            .select("fb_page_id, access_token, is_active, name")
            .eq("id", t.page_id).single();
          if (!pg || pg.is_active === false) continue;
          try {
            const fbId = await publishFacebookPost({
              type: data.type as any,
              message: data.message ?? "",
              linkUrl: data.linkUrl,
              mediaUrls: data.mediaUrls,
              fbPageId: pg.fb_page_id,
              pageToken: pg.access_token,
              scheduledUnix,
            });
            await supabase.from("post_targets")
              .update({ fb_post_id: fbId, error: null })
              .eq("id", t.id);
            fbScheduled++;
          } catch (e: any) {
            fbErrors.push(`${pg.name}: ${e?.message ?? String(e)}`);
            await supabase.from("post_targets")
              .update({ error: `agendamento FB falhou — fallback no cron: ${e?.message ?? ""}` })
              .eq("id", t.id);
          }
        }
      }
    }

    return { ok: true, postId: post.id, status, fbScheduled, fbErrors };
  });


// Publish now: looks up the post + targets, posts to each, updates statuses, schedules auto-comments.
export const publishPostNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: post } = await supabase.from("posts").select("*").eq("id", data.postId).eq("user_id", userId).single();
    if (!post) throw new Error("Post não encontrado");
    const { data: allTargets } = await supabase.from("post_targets").select("id,page_id,status").eq("post_id", post.id);
    if (!allTargets?.length) throw new Error("Sem páginas-alvo");
    const targets = allTargets.filter((t) => t.status !== "published");
    if (!targets.length) throw new Error("Nada a publicar — todos os targets já foram publicados");

    await supabase.from("posts").update({ status: "publishing" }).eq("id", post.id);

    let okCount = 0, failCount = 0;
    let processedInBatch = 0;
    for (const t of targets) {
      if (processedInBatch > 0 && processedInBatch % 10 === 0) {
        await new Promise((r) => setTimeout(r, 30000));
      }
      processedInBatch++;
      const { data: pg } = await supabase.from("fb_pages").select("fb_page_id, access_token").eq("id", t.page_id).single();
      if (!pg) {
        await supabase.from("post_targets").update({ status: "failed", error: "página ausente" }).eq("id", t.id);
        failCount++; continue;
      }
      try {
        await supabase.from("post_targets").update({ status: "publishing" }).eq("id", t.id);
        const fbId = await publishFacebookPost({
          type: post.type as any, message: post.message ?? "", linkUrl: post.link_url ?? undefined,
          mediaUrls: post.media_urls ?? [], fbPageId: pg.fb_page_id, pageToken: pg.access_token,
        });
        await supabase.from("post_targets").update({
          status: "published", fb_post_id: fbId, published_at: new Date().toISOString(), error: null,
        }).eq("id", t.id);

        // Schedule any auto-comments per target
        const { data: comments } = await supabase.from("auto_comments")
          .select("id, delay_seconds").eq("post_id", post.id).is("target_id", null).eq("status", "pending");
        if (comments?.length) {
          for (const c of comments) {
            await supabase.from("auto_comments").insert({
              user_id: userId, post_id: post.id, target_id: t.id,
              message: (await supabase.from("auto_comments").select("message").eq("id", c.id).single()).data?.message ?? "",
              delay_seconds: c.delay_seconds,
              run_at: new Date(Date.now() + c.delay_seconds * 1000).toISOString(),
            });
          }
        }
        okCount++;
      } catch (e: any) {
        await supabase.from("post_targets").update({ status: "failed", error: e.message }).eq("id", t.id);
        failCount++;
      }
    }

    const finalStatus = failCount === 0 ? "published" : (okCount === 0 ? "failed" : "partial");
    await supabase.from("posts").update({
      status: finalStatus, published_at: new Date().toISOString(),
      error: failCount > 0 ? `${failCount} falha(s)` : null,
    }).eq("id", post.id);

    await supabase.from("activity_logs").insert({
      user_id: userId, action: "post.publish", entity: "post", entity_id: post.id,
      metadata: { okCount, failCount }, status: failCount ? "partial" : "ok",
    });

    return { ok: true, okCount, failCount };
  });

export const cancelScheduled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await deleteFbScheduledForPost(context.supabase, context.userId, data.postId);
    const { error } = await context.supabase.from("posts")
      .update({ status: "draft", scheduled_at: null })
      .eq("id", data.postId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    await context.supabase.from("post_targets")
      .update({ fb_post_id: null, status: "pending", error: null } as any)
      .eq("post_id", data.postId);
    return { ok: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await deleteFbScheduledForPost(context.supabase, context.userId, data.postId);
    const { error } = await context.supabase.from("posts").delete().eq("id", data.postId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Helper: deletes any FB scheduled posts (targets with fb_post_id but not yet published) for a given post.
async function deleteFbScheduledForPost(supabase: any, userId: string, postId: string) {
  const { fbDelete } = await import("@/lib/fb-graph");
  const { data: targets } = await supabase.from("post_targets")
    .select("id, fb_post_id, page_id, status")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .not("fb_post_id", "is", null)
    .neq("status", "published");
  for (const t of targets ?? []) {
    const { data: pg } = await supabase.from("fb_pages").select("access_token").eq("id", t.page_id).single();
    if (!pg?.access_token || !t.fb_post_id) continue;
    try { await fbDelete(`/${t.fb_post_id}`, { access_token: pg.access_token }); } catch { /* ignore */ }
  }
}


export const deleteAllPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ status: z.enum(["all", "draft", "scheduled", "publishing", "published", "failed"]).default("all") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("posts").delete({ count: "exact" }).eq("user_id", userId);
    if (data.status !== "all") q = q.eq("status", data.status as any);
    const { error, count } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, count: count ?? 0 };
  });

export const getPostDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: post } = await supabase.from("posts")
      .select("id, error, status, message")
      .eq("id", data.postId).eq("user_id", userId).single();
    if (!post) throw new Error("Post não encontrado");
    const { data: targets } = await supabase.from("post_targets")
      .select("id, status, error, fb_post_id, published_at, page_id, fb_pages(name, fb_page_id)")
      .eq("post_id", data.postId);
    return { post, targets: targets ?? [] };
  });
