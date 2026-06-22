import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SlotSchema = z.object({
  pageId: z.string().uuid(),
  mediaUrl: z.string().url(),
  mediaFileName: z.string(),
  type: z.enum(["photo", "video"]),
  message: z.string().default(""),
  commentLink: z.string().nullable().optional(),
  scheduledAt: z.string().datetime(),
});

export const createBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      slots: z.array(SlotSchema).min(1).max(10000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job, error } = await supabase.from("upload_jobs").insert({
      user_id: userId,
      status: "pending",
      total_count: data.slots.length,
      payload: { slots: data.slots } as any,
    }).select("id").single();
    if (error || !job) throw new Error(error?.message ?? "Falha ao criar job");

    // Agrupa slots por "post lógico" (mediaUrl+message+commentLink+scheduledAt) para reuso
    type Key = string;
    const groups = new Map<Key, { sample: typeof data.slots[number]; pageIds: string[] }>();
    for (const s of data.slots) {
      const k = `${s.mediaUrl}||${s.message}||${s.commentLink ?? ""}||${s.scheduledAt}||${s.type}`;
      const g = groups.get(k);
      if (g) g.pageIds.push(s.pageId);
      else groups.set(k, { sample: s, pageIds: [s.pageId] });
    }

    let success = 0;
    const errors: string[] = [];
    for (const { sample, pageIds } of groups.values()) {
      try {
        const { data: post, error: perr } = await supabase.from("posts").insert({
          user_id: userId,
          type: sample.type,
          message: sample.message || "\u200B",
          media_urls: [sample.mediaUrl],
          status: "scheduled",
          scheduled_at: sample.scheduledAt,
          tags: [],
        }).select("id").single();
        if (perr || !post) throw new Error(perr?.message ?? "post insert failed");

        const targets = pageIds.map((pid) => ({
          post_id: post.id, page_id: pid, user_id: userId, status: "pending" as const,
        }));
        const { error: terr } = await supabase.from("post_targets").insert(targets);
        if (terr) throw new Error(terr.message);

        if (sample.commentLink) {
          await supabase.from("auto_comments").insert({
            user_id: userId, post_id: post.id, message: sample.commentLink, delay_seconds: 60,
          });
        }
        success += pageIds.length;
      } catch (e: any) {
        errors.push(`${sample.mediaFileName}: ${e?.message ?? "erro"}`);
      }
    }

    await supabase.from("upload_jobs").update({
      status: errors.length && success === 0 ? "failed" : "completed",
      processed_count: data.slots.length,
      success_count: success,
      error_count: data.slots.length - success,
      errors: errors as any,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);

    return { jobId: job.id, success, failed: data.slots.length - success };
  });
