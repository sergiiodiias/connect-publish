import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scheduleTargetsNative } from "@/lib/fb-schedule";

const SlotSchema = z.object({
  pageId: z.string().uuid(),
  mediaUrl: z.string().url(),
  mediaFileName: z.string(),
  type: z.enum(["photo", "video"]),
  message: z.string().default(""),
  commentLink: z.string().nullable().optional(),
  scheduledAt: z.string().datetime(),
});

type Slot = z.infer<typeof SlotSchema>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const createBulkJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      slots: z.array(SlotSchema).min(1).max(10000),
      commentDelaySeconds: z.number().int().min(0).max(86400).default(60),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const commentDelaySeconds = data.commentDelaySeconds ?? 60;


    const { data: job, error: jerr } = await supabase
      .from("upload_jobs")
      .insert({
        user_id: userId,
        status: "running",
        total_count: data.slots.length,
        payload: { slots: data.slots.length } as any,
      })
      .select("id")
      .single();
    if (jerr || !job) throw new Error(jerr?.message ?? "Falha ao criar job");

    // Agrupa por "post lógico" para reusar 1 post para várias páginas
    type Group = { sample: Slot; pageIds: string[] };
    const groups = new Map<string, Group>();
    for (const s of data.slots) {
      const k = `${s.mediaUrl}|${s.message}|${s.commentLink ?? ""}|${s.scheduledAt}|${s.type}`;
      const g = groups.get(k);
      if (g) g.pageIds.push(s.pageId);
      else groups.set(k, { sample: s, pageIds: [s.pageId] });
    }

    const groupList = Array.from(groups.values());
    const errors: string[] = [];
    let success = 0;

    // Insere posts em lote (chunks de 200)
    const postRows = groupList.map((g) => ({
      user_id: userId,
      type: g.sample.type,
      message: g.sample.message || "\u200B",
      media_urls: [g.sample.mediaUrl],
      status: "scheduled" as const,
      scheduled_at: g.sample.scheduledAt,
      tags: [] as string[],
    }));

    const insertedPostIds: string[] = [];
    for (const part of chunk(postRows, 200)) {
      const { data: ins, error } = await supabase
        .from("posts")
        .insert(part)
        .select("id");
      if (error || !ins) {
        errors.push(`posts insert: ${error?.message ?? "vazio"}`);
        // continua para próximos chunks; estes não terão targets
        for (let i = 0; i < part.length; i++) insertedPostIds.push("");
        continue;
      }
      for (const r of ins) insertedPostIds.push(r.id);
    }

    // Monta targets e auto_comments
    const targetRows: any[] = [];
    const commentRows: any[] = [];
    groupList.forEach((g, i) => {
      const pid = insertedPostIds[i];
      if (!pid) return;
      for (const pageId of g.pageIds) {
        targetRows.push({ post_id: pid, page_id: pageId, user_id: userId, status: "pending" });
      }
      if (g.sample.commentLink) {
        commentRows.push({
          user_id: userId, post_id: pid, message: g.sample.commentLink, delay_seconds: commentDelaySeconds,
        });
      }

    });

    const insertedTargetIds: string[] = [];
    for (const part of chunk(targetRows, 500)) {
      const { data: ins, error } = await supabase.from("post_targets").insert(part).select("id");
      if (error) errors.push(`targets: ${error.message}`);
      else {
        success += part.length;
        for (const r of (ins ?? []) as any[]) insertedTargetIds.push(r.id);
      }
    }

    if (commentRows.length) {
      for (const part of chunk(commentRows, 500)) {
        const { error } = await supabase.from("auto_comments").insert(part);
        if (error) errors.push(`comments: ${error.message}`);
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

    return { jobId: job.id, success, failed: data.slots.length - success, errors: errors.slice(0, 5) };
  });
