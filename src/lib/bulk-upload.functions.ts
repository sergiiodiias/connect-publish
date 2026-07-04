import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scheduleTargetsNative } from "@/lib/fb-schedule";
import { rotateMessage } from "@/lib/message-variants";


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
      commentDelaySeconds: z.number().int().min(0).max(86400).default(240),
      // Escalonamento para evitar limites do Facebook:
      // - batchSize: nº de páginas publicando com o mesmo horário base (default 1 = escalonamento máximo)
      // - batchIntervalMinutes: minutos entre CADA página (default 2 min → 2-3 com jitter)
      // - commentJitterSeconds: segundos somados entre comentários da mesma página (default 240 = 4 min)
      // - rotateEveryPages: a cada quantas páginas trocar variação de mensagem (spintax) — default 10
      batchSize: z.number().int().min(1).max(500).default(1),
      batchIntervalMinutes: z.number().int().min(0).max(720).default(2),
      commentJitterSeconds: z.number().int().min(0).max(7200).default(240),
      rotateEveryPages: z.number().int().min(1).max(1000).default(10),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const commentDelaySeconds = data.commentDelaySeconds ?? 240;
    const batchSize = Math.max(1, data.batchSize ?? 1);
    const batchIntervalMs = Math.max(0, data.batchIntervalMinutes ?? 2) * 60_000;
    const commentJitterMs = Math.max(0, data.commentJitterSeconds ?? 240) * 1000;
    const rotateEvery = Math.max(1, data.rotateEveryPages ?? 10);
    // Jitter aleatório extra em cima do intervalo base — soma 0..60s para não ficar exato demais.
    const PAGE_JITTER_MS = 60_000;
    // Jitter aleatório dos comentários — soma 0..60s para variar entre páginas.
    const COMMENT_JITTER_MS = 60_000;


    const { data: job, error: jerr } = await supabase
      .from("upload_jobs")
      .insert({
        user_id: userId,
        status: "running",
        total_count: data.slots.length,
        payload: { slots: data.slots.length, batchSize, batchIntervalMinutes: data.batchIntervalMinutes, commentJitterSeconds: data.commentJitterSeconds, rotateEveryPages: rotateEvery } as any,
      })
      .select("id")
      .single();
    if (jerr || !job) throw new Error(jerr?.message ?? "Falha ao criar job");

    // Agrupa por "post lógico" (mesma criativa + horário base) para 1 post servir várias páginas.
    type Group = { sample: Slot; pageIds: string[] };
    const groups = new Map<string, Group>();
    for (const s of data.slots) {
      const k = `${s.mediaUrl}|${s.message}|${s.commentLink ?? ""}|${s.scheduledAt}|${s.type}`;
      const g = groups.get(k);
      if (g) g.pageIds.push(s.pageId);
      else groups.set(k, { sample: s, pageIds: [s.pageId] });
    }

    // Divide cada grupo em sub-lotes de páginas; cada sub-lote ganha um horário
    // deslocado para evitar tempestade de chamadas (limite por App e por página).
    type SubBatch = {
      sample: Slot;
      pageIds: string[];
      scheduledAtIso: string;
      batchIndex: number;
    };
    const subBatches: SubBatch[] = [];
    for (const g of groups.values()) {
      const baseMs = new Date(g.sample.scheduledAt).getTime();
      const parts = chunk(g.pageIds, batchSize);
      parts.forEach((pageIds, i) => {
        const jitter = Math.floor(Math.random() * PAGE_JITTER_MS);
        const newIso = new Date(baseMs + i * batchIntervalMs + jitter).toISOString();
        subBatches.push({ sample: g.sample, pageIds, scheduledAtIso: newIso, batchIndex: i });
      });
    }

    const errors: string[] = [];
    let success = 0;

    // 1) Para cada mensagem/comentário base único, gera N variações via IA (Lovable AI Gateway).
    //    N = ceil(maxSubBatches / rotateEvery) — uma variação por bloco de páginas.
    //    O usuário não precisa escrever nada extra: usamos o próprio texto como base.
    const { generateMessageVariants } = await import("@/lib/ai-variants.server");
    const groupSubBatchCount = new Map<string, number>();
    for (const b of subBatches) {
      const k = `${b.sample.mediaUrl}|${b.sample.message}|${b.sample.commentLink ?? ""}|${b.sample.type}`;
      groupSubBatchCount.set(k, (groupSubBatchCount.get(k) ?? 0) + 1);
    }
    const postVariantsByMsg = new Map<string, string[]>();
    const commentVariantsByMsg = new Map<string, string[]>();
    // Gera variações em paralelo (uma requisição por mensagem única).
    const uniqueMessages = new Map<string, { message: string; commentLink: string | null; blocks: number }>();
    for (const b of subBatches) {
      const k = `${b.sample.message}||${b.sample.commentLink ?? ""}`;
      const prev = uniqueMessages.get(k);
      const groupKey = `${b.sample.mediaUrl}|${b.sample.message}|${b.sample.commentLink ?? ""}|${b.sample.type}`;
      const blocks = Math.max(1, Math.ceil((groupSubBatchCount.get(groupKey) ?? 1) / rotateEvery));
      if (!prev || prev.blocks < blocks) {
        uniqueMessages.set(k, { message: b.sample.message ?? "", commentLink: b.sample.commentLink ?? null, blocks });
      }
    }
    await Promise.all(
      [...uniqueMessages.values()].map(async (u) => {
        const jobs: Promise<void>[] = [];
        if (u.message?.trim()) {
          jobs.push(
            generateMessageVariants(u.message, u.blocks, "post").then((v) => {
              postVariantsByMsg.set(u.message, v);
            }),
          );
        }
        if (u.commentLink?.trim()) {
          jobs.push(
            generateMessageVariants(u.commentLink, u.blocks, "comment").then((v) => {
              commentVariantsByMsg.set(u.commentLink!, v);
            }),
          );
        }
        await Promise.all(jobs);
      }),
    );

    const pickVariant = (
      cache: Map<string, string[]>,
      base: string,
      blockIndex: number,
    ): string => {
      const list = cache.get(base);
      if (!list || list.length === 0) return rotateMessage(base, blockIndex);
      return list[blockIndex % list.length];
    };

    // 2) Insere 1 linha em posts por sub-lote. Cada bloco de `rotateEvery` páginas
    //    recebe uma variação diferente da mensagem gerada pela IA.
    const postRows = subBatches.map((b) => {
      const blockIndex = Math.floor(b.batchIndex / rotateEvery);
      const rotated = pickVariant(postVariantsByMsg, b.sample.message ?? "", blockIndex);
      return {
        user_id: userId,
        type: b.sample.type,
        message: rotated || "\u200B",
        media_urls: [b.sample.mediaUrl],
        status: "scheduled" as const,
        scheduled_at: b.scheduledAtIso,
        tags: [] as string[],
      };
    });


    const insertedPostIds: string[] = [];
    for (const part of chunk(postRows, 200)) {
      const { data: ins, error } = await supabase.from("posts").insert(part).select("id");
      if (error || !ins) {
        errors.push(`posts insert: ${error?.message ?? "vazio"}`);
        for (let i = 0; i < part.length; i++) insertedPostIds.push("");
        continue;
      }
      for (const r of ins) insertedPostIds.push(r.id);
    }

    // 3) Monta targets e comentários por target já com jitter entre comentários do mesmo lote.
    type TargetSeed = { post_id: string; page_id: string; user_id: string; status: "pending"; _commentRunAt?: string; _commentMessage?: string };
    const targetSeeds: TargetSeed[] = [];
    subBatches.forEach((b, i) => {
      const pid = insertedPostIds[i];
      if (!pid) return;
      const baseMs = new Date(b.scheduledAtIso).getTime();
      b.pageIds.forEach((pageId, posInBatch) => {
        const seed: TargetSeed = { post_id: pid, page_id: pageId, user_id: userId, status: "pending" };
        if (b.sample.commentLink) {
          const jitter = Math.floor(Math.random() * COMMENT_JITTER_MS);
          const offsetMs = commentDelaySeconds * 1000 + posInBatch * commentJitterMs + jitter;
          seed._commentRunAt = new Date(baseMs + offsetMs).toISOString();
          // Rotaciona a mensagem do comentário a cada bloco usando as variações da IA.
          const blockIndex = Math.floor(b.batchIndex / rotateEvery);
          seed._commentMessage = pickVariant(commentVariantsByMsg, b.sample.commentLink, blockIndex);
        }
        targetSeeds.push(seed);
      });

    });


    const insertedTargetIds: string[] = [];
    const commentRows: any[] = [];
    for (const part of chunk(targetSeeds, 500)) {
      const insertRows = part.map(({ _commentRunAt, _commentMessage, ...row }) => row);
      const { data: ins, error } = await supabase
        .from("post_targets")
        .insert(insertRows)
        .select("id");
      if (error) {
        errors.push(`targets: ${error.message}`);
        continue;
      }
      success += part.length;
      (ins ?? []).forEach((r: any, idx) => {
        insertedTargetIds.push(r.id);
        const seed = part[idx];
        if (seed._commentMessage && seed._commentRunAt) {
          commentRows.push({
            user_id: userId,
            post_id: seed.post_id,
            target_id: r.id,
            message: seed._commentMessage,
            delay_seconds: commentDelaySeconds,
            run_at: seed._commentRunAt,
          });
        }
      });
    }

    if (commentRows.length) {
      for (const part of chunk(commentRows, 500)) {
        const { error } = await supabase.from("auto_comments").insert(part);
        if (error) errors.push(`comments: ${error.message}`);
      }
    }

    // Publica direto no agendador nativo do Facebook em lotes, sem depender do cron.
    let fbScheduled = 0, fbFailed = 0;
    const fbErrors: string[] = [];
    try {
      const startedAt = Date.now();
      const MAX_MS = 50_000;
      let remaining = [...insertedTargetIds];
      while (remaining.length && Date.now() - startedAt < MAX_MS) {
        const slice = remaining.slice(0, 50);
        const res = await scheduleTargetsNative({
          supabase, userId, targetIds: slice, batchSize: slice.length, concurrency: 5,
        });
        fbScheduled += res.scheduled;
        fbFailed += res.failed;
        fbErrors.push(...res.errors);
        if (!res.processed) break;
        remaining = remaining.slice(slice.length);
      }
    } catch (e: any) {
      fbErrors.push(`fb schedule: ${e?.message ?? String(e)}`);
    }

    await supabase.from("upload_jobs").update({
      status: errors.length && success === 0 ? "failed" : "completed",
      processed_count: data.slots.length,
      success_count: success,
      error_count: data.slots.length - success,
      errors: [...errors, ...fbErrors] as any,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);

    return {
      jobId: job.id,
      success,
      failed: data.slots.length - success,
      errors: [...errors, ...fbErrors].slice(0, 8),
      batches: subBatches.length,
      fb: { scheduled: fbScheduled, failed: fbFailed, pendingCron: Math.max(0, insertedTargetIds.length - fbScheduled - fbFailed) },
    };
  });
