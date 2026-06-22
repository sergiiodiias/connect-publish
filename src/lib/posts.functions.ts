import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbPost } from "@/lib/fb-graph";

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

async function publishOneTarget(opts: {
  type: "text" | "photo" | "video" | "link";
  message: string;
  linkUrl?: string;
  mediaUrls: string[];
  fbPageId: string;
  pageToken: string;
}): Promise<string> {
  const { type, message, linkUrl, mediaUrls, fbPageId, pageToken } = opts;
  if (type === "photo" && mediaUrls[0]) {
    const r = await fbPost<any>(`/${fbPageId}/photos`, {
      access_token: pageToken, url: mediaUrls[0], caption: message,
    });
    return r.post_id ?? r.id;
  }
  if (type === "video" && mediaUrls[0]) {
    const r = await fbPost<any>(`/${fbPageId}/videos`, {
      access_token: pageToken, file_url: mediaUrls[0], description: message,
    });
    return r.post_id ?? r.id;
  }
  // text or link
  const params: Record<string, string> = { access_token: pageToken, message };
  if (linkUrl) params.link = linkUrl;
  const r = await fbPost<any>(`/${fbPageId}/feed`, params);
  return r.id;
}

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
    const { error: terr } = await supabase.from("post_targets").insert(targets);
    if (terr) throw new Error(terr.message);

    if (data.autoComment) {
      await supabase.from("auto_comments").insert({
        user_id: userId, post_id: post.id,
        message: data.autoComment.message, delay_seconds: data.autoComment.delaySeconds,
      });
    }

    return { ok: true, postId: post.id, status };
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
    for (const t of targets) {
      const { data: pg } = await supabase.from("fb_pages").select("fb_page_id, access_token").eq("id", t.page_id).single();
      if (!pg) {
        await supabase.from("post_targets").update({ status: "failed", error: "página ausente" }).eq("id", t.id);
        failCount++; continue;
      }
      try {
        await supabase.from("post_targets").update({ status: "publishing" }).eq("id", t.id);
        const fbId = await publishOneTarget({
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

    const finalStatus = failCount === 0 ? "published" : (okCount === 0 ? "failed" : "published");
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
    const { error } = await context.supabase.from("posts").update({ status: "draft", scheduled_at: null })
      .eq("id", data.postId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("posts").delete().eq("id", data.postId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
