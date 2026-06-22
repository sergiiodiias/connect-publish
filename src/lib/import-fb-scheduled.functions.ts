import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet } from "@/lib/fb-graph";

type FbAttachment = {
  type?: string;
  url?: string;
  media?: { image?: { src?: string } };
  subattachments?: { data?: FbAttachment[] };
  target?: { url?: string };
};

type FbScheduled = {
  id: string;
  message?: string;
  scheduled_publish_time?: number; // unix seconds
  created_time?: string;
  permalink_url?: string;
  attachments?: { data?: FbAttachment[] };
};

function classify(att?: FbAttachment): {
  type: "text" | "photo" | "video" | "link";
  mediaUrls: string[];
  linkUrl: string | null;
} {
  if (!att) return { type: "text", mediaUrls: [], linkUrl: null };
  const t = (att.type || "").toLowerCase();
  const subs = att.subattachments?.data ?? [];
  if (t.includes("video")) {
    const url = att.media?.image?.src ?? "";
    return { type: "video", mediaUrls: url ? [url] : [], linkUrl: null };
  }
  if (t.includes("photo") || t.includes("album")) {
    const urls = subs.length
      ? subs.map((s) => s.media?.image?.src).filter(Boolean) as string[]
      : ([att.media?.image?.src].filter(Boolean) as string[]);
    return { type: "photo", mediaUrls: urls, linkUrl: null };
  }
  if (t.includes("share") || t.includes("link")) {
    return { type: "link", mediaUrls: [], linkUrl: att.target?.url ?? att.url ?? null };
  }
  return { type: "text", mediaUrls: [], linkUrl: null };
}

export const importFbScheduled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let q = supabase.from("fb_pages").select("id, fb_page_id, name, access_token, is_active").eq("user_id", userId).eq("is_active", true);
    if (data.pageId) q = q.eq("id", data.pageId);
    const { data: pages, error: perr } = await q;
    if (perr) throw new Error(perr.message);
    if (!pages || pages.length === 0) return { ok: true, imported: 0, skipped: 0, pages: 0, errors: [] as string[] };

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const pg of pages) {
      try {
        const res = await fbGet<{ data: FbScheduled[] }>(`/${pg.fb_page_id}/scheduled_posts`, {
          access_token: pg.access_token,
          fields: "id,message,scheduled_publish_time,created_time,permalink_url,attachments{type,url,media,target,subattachments{type,media,url,target}}",
          limit: "100",
        });
        const items = res.data ?? [];

        // existing fb_post_ids on this page → skip
        const fbIds = items.map((i) => i.id);
        const { data: existing } = fbIds.length
          ? await supabase.from("post_targets").select("fb_post_id").eq("page_id", pg.id).in("fb_post_id", fbIds)
          : { data: [] as { fb_post_id: string | null }[] };
        const existingSet = new Set((existing ?? []).map((e) => e.fb_post_id));

        for (const it of items) {
          if (existingSet.has(it.id)) { skipped++; continue; }
          if (!it.scheduled_publish_time) { skipped++; continue; }

          const att = it.attachments?.data?.[0];
          const { type, mediaUrls, linkUrl } = classify(att);
          const scheduledAt = new Date(it.scheduled_publish_time * 1000).toISOString();

          const { data: post, error: pErr } = await supabase.from("posts").insert({
            user_id: userId,
            type,
            message: it.message ?? "",
            link_url: linkUrl,
            media_urls: mediaUrls,
            status: "scheduled",
            scheduled_at: scheduledAt,
            tags: ["imported_fb"],
          }).select("id").single();
          if (pErr || !post) { errors.push(`${pg.name}: ${pErr?.message ?? "post insert failed"}`); continue; }

          const { error: tErr } = await supabase.from("post_targets").insert({
            post_id: post.id,
            page_id: pg.id,
            user_id: userId,
            status: "pending",
            fb_post_id: it.id,
          });
          if (tErr) { errors.push(`${pg.name}: ${tErr.message}`); continue; }
          imported++;
        }
      } catch (e: any) {
        errors.push(`${pg.name}: ${e?.message ?? String(e)}`);
      }
    }

    return { ok: true, imported, skipped, pages: pages.length, errors };
  });
