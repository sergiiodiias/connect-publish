import { createFileRoute } from "@tanstack/react-router";

// Called by pg_cron every minute. Auth: Supabase anon "apikey" header.
export const Route = createFileRoute("/api/public/cron/scheduler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { fbGet, fbPost } = await import("@/lib/fb-graph");
        const { publishFacebookPost } = await import("@/lib/fb-publish");
        const { withApiCallTracking } = await import("@/lib/fb-api-tracker.server");
        const { expandSpintax, hasSpintax } = await import("@/lib/message-variants");

        const nowIso = new Date().toISOString();
        // Give Facebook's native scheduler time to publish before using our fallback.
        // This prevents a native scheduled post and our cron fallback from posting together.
        const FALLBACK_GRACE_MS = 10 * 60_000;
        // Cooldown por página no fallback: 2-3 min entre publicações da mesma página.
        const PAGE_FALLBACK_COOLDOWN_MIN_MS = 2 * 60_000;
        const PAGE_FALLBACK_COOLDOWN_JITTER_MS = 60_000; // +0-60s → total 2-3 min
        const pageFallbackCooldownMs = () =>
          PAGE_FALLBACK_COOLDOWN_MIN_MS + Math.floor(Math.random() * PAGE_FALLBACK_COOLDOWN_JITTER_MS);
        // Compat com o restante do código que usava a constante fixa: mantemos como valor médio (2.5min).
        const PAGE_FALLBACK_COOLDOWN_MS = PAGE_FALLBACK_COOLDOWN_MIN_MS + PAGE_FALLBACK_COOLDOWN_JITTER_MS / 2;
        const FB_EXISTING_WINDOW_MS = 30 * 60_000;
        const fallbackReadyIso = new Date(Date.now() - FALLBACK_GRACE_MS).toISOString();
        // Limite duro: publicar no máximo 10 páginas por execução do cron
        // para nunca estourar limites da App.
        const MAX_PAGES_PER_RUN = 10;
        let processed = 0,
          failed = 0,
          comments = 0;

        // Budget the whole run so a single invocation doesn't starve the next cron tick.
        const startedAt = Date.now();
        const MAX_RUN_MS = 45_000;
        const outOfTime = () => Date.now() - startedAt > MAX_RUN_MS;

        const CONCURRENCY = 5;
        // Comentários: o erro #368 é por PÁGINA. Para nunca estourar, processamos
        // no máximo 1 comentário por página por execução do cron, com concorrência
        // baixa entre páginas distintas e jitter entre cada chamada.
        const COMMENT_CONCURRENCY = 1;
        const COMMENT_BATCH_LIMIT = 120;
        // 3-5 min entre comentários da mesma página (era 20 min fixo).
        const COMMENT_PAGE_COOLDOWN_MIN_MS = 3 * 60_000;
        const COMMENT_PAGE_COOLDOWN_JITTER_MS = 2 * 60_000; // +0-2min → total 3-5 min
        const commentPageCooldownMs = () =>
          COMMENT_PAGE_COOLDOWN_MIN_MS + Math.floor(Math.random() * COMMENT_PAGE_COOLDOWN_JITTER_MS);
        // Compat com o restante do código: valor médio (4min) para queries de "recente".
        const COMMENT_PAGE_COOLDOWN_MS = COMMENT_PAGE_COOLDOWN_MIN_MS + COMMENT_PAGE_COOLDOWN_JITTER_MS / 2;
        const COMMENT_PAGE_STAGGER_MS = 4 * 60_000;
        const COMMENT_PAGE_STAGGER_JITTER_MS = 2 * 60_000;
        const COMMENT_INTER_DELAY_MS = 800; // pausa mínima entre comentários
        const COMMENT_INTER_JITTER_MS = 1700; // + jitter aleatório
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const chunk = <T>(arr: T[], size: number): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };
        const normalizeComment = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
        let rateLimitHit = false;
        const fallbackPublishedPages = new Set<string>();
        const commentTouchedPages = new Set<string>();


        async function findMatchingFacebookPost(
          pg: { fb_page_id: string; access_token: string },
          message: string,
          scheduledAt?: string | null,
        ): Promise<{ id: string; kind: "published" | "scheduled" } | null> {
          const wanted = normalizeComment(message ?? "");
          if (wanted.length < 8) return null;
          const scheduledMs = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
          const since = Math.floor((scheduledMs - FB_EXISTING_WINDOW_MS) / 1000);
          const until = Math.floor((Date.now() + FB_EXISTING_WINDOW_MS) / 1000);

          try {
            const existing: any = await fbGet(`/${pg.fb_page_id}/posts`, {
              access_token: pg.access_token,
              fields: "id,message,created_time",
              since: String(since),
              until: String(until),
              limit: "25",
            });
            const match = (existing?.data ?? []).find(
              (item: any) => normalizeComment(item?.message ?? "") === wanted,
            );
            if (match?.id) return { id: match.id, kind: "published" };
          } catch {
            // Best-effort guard only; if Facebook search fails, keep the normal fallback flow.
          }

          try {
            const existingPhotos: any = await fbGet(`/${pg.fb_page_id}/photos`, {
              access_token: pg.access_token,
              fields: "id,name,created_time",
              type: "uploaded",
              limit: "50",
            });
            const match = (existingPhotos?.data ?? []).find((item: any) => {
              if (normalizeComment(item?.name ?? "") !== wanted) return false;
              const createdMs = item?.created_time ? new Date(item.created_time).getTime() : scheduledMs;
              return Math.abs(createdMs - scheduledMs) <= FB_EXISTING_WINDOW_MS;
            });
            if (match?.id) return { id: match.id, kind: "published" };
          } catch {
            // Photo posts are not always returned by /posts; this extra guard prevents duplicates.
          }

          try {
            const scheduled: any = await fbGet(`/${pg.fb_page_id}/scheduled_posts`, {
              access_token: pg.access_token,
              fields: "id,message,scheduled_publish_time",
              limit: "50",
            });
            const match = (scheduled?.data ?? []).find((item: any) => {
              if (normalizeComment(item?.message ?? "") !== wanted) return false;
              const fbTime = item?.scheduled_publish_time
                ? Number(item.scheduled_publish_time) * 1000
                : scheduledMs;
              return Math.abs(fbTime - scheduledMs) <= FB_EXISTING_WINDOW_MS;
            });
            if (match?.id) return { id: match.id, kind: "scheduled" };
          } catch {
            // Some page tokens cannot read scheduled_posts; ignore and continue safely.
          }

          return null;
        }

        // -3) Reaper: solta targets travados em "publishing" sem fb_post_id.
        // Causa: cron anterior marcou publishing, chamada ao FB estourou tempo e nunca reverteu.
        // Regra: >15min em publishing sem fb_post_id → volta a 'pending' se ainda dentro
        // da janela útil; vira 'failed' se o agendamento já passou há mais de 1h.
        {
          const staleCutoffIso = new Date(Date.now() - 15 * 60_000).toISOString();
          const expiredCutoffIso = new Date(Date.now() - 60 * 60_000).toISOString();
          const { data: stale } = await supabaseAdmin
            .from("post_targets")
            .select("id, updated_at, posts!inner(scheduled_at)")
            .eq("status", "publishing")
            .is("fb_post_id", null)
            .lt("updated_at", staleCutoffIso)
            .limit(500);
          const toFail: string[] = [];
          const toRequeue: string[] = [];
          for (const row of (stale ?? []) as any[]) {
            const sched = row.posts?.scheduled_at as string | undefined;
            if (sched && sched < expiredCutoffIso) toFail.push(row.id);
            else toRequeue.push(row.id);
          }
          if (toFail.length) {
            await supabaseAdmin
              .from("post_targets")
              .update({ status: "failed", error: "Travado em publishing (reaper automático)" } as any)
              .in("id", toFail);
          }
          if (toRequeue.length) {
            await supabaseAdmin
              .from("post_targets")
              .update({ status: "pending", error: null } as any)
              .in("id", toRequeue);
          }
        }

        // -2) Reconcilia targets que já foram agendados nativamente no Facebook.
        // Qualquer target com fb_post_id NÃO deve ser publicado de novo pelo cron.
        const { data: nativeScheduledPosts } = await supabaseAdmin
          .from("posts")
          .select("id")
          .in("status", ["scheduled", "publishing"] as any)
          .lte("scheduled_at", nowIso)
          .limit(100);
        for (const p of nativeScheduledPosts ?? []) {
          const { data: rows } = await supabaseAdmin
            .from("post_targets")
            .select("id, fb_post_id, status")
            .eq("post_id", p.id);
          if (!rows?.length) continue;
          await supabaseAdmin
            .from("post_targets")
            .update({ status: "published", published_at: nowIso, error: null } as any)
            .eq("post_id", p.id)
            .not("fb_post_id", "is", null)
            .neq("status", "published");
          const allNative = rows.every((r) => !!r.fb_post_id);
          const hasUnsentPending = rows.some(
            (r) => !r.fb_post_id && (r.status === "pending" || r.status === "publishing"),
          );
          if (allNative || !hasUnsentPending) {
            const failedCount = rows.filter((r) => !r.fb_post_id && r.status === "failed").length;
            await supabaseAdmin
              .from("posts")
              .update({
                status: failedCount ? "partial" : "published",
                published_at: nowIso,
                error: failedCount ? `${failedCount} falha(s)` : null,
              })
              .eq("id", p.id);
          }
        }

        // -1) Auto-recuperação de comentários travados
        // Resetar 'publishing' parado há mais de 5min (worker crashou no meio)
        const stuckPublishingCutoff = new Date(Date.now() - 3 * 60_000).toISOString();
        await supabaseAdmin
          .from("auto_comments")
          .update({ status: "pending", error: "auto-recuperado de publishing travado" } as any)
          .eq("status", "publishing" as any)
          .lt("updated_at", stuckPublishingCutoff);
        // Re-tentar failed com mensagens transitórias (limite/rate/timeout) até 3x
        const { data: retryable } = await supabaseAdmin
          .from("auto_comments")
          .select("id, attempts, error")
          .eq("status", "failed")
          .not("target_id", "is", null)
          .is("fb_comment_id", null)
          .limit(100);
        const throttleRe = /#368\b|#4\b|#17\b|#32\b|#613\b|limit|rate|frequência|frequency|aguardando intervalo/i;
        const transientRe = /timeout|temporar|unexpected|retry|network|fetch failed|socket|ETIMEDOUT|ECONNRESET/i;
        let retryOffset = 0;
        for (const r of (retryable ?? []) as any[]) {
          const att = r.attempts ?? 0;
          if (att >= 3) continue;
          const errText = r.error ?? "";
          const isThrottle = throttleRe.test(errText);
          if (!isThrottle && !transientRe.test(errText)) continue;
          const delayMs = isThrottle
            ? (90 + Math.floor(Math.random() * 91) + retryOffset * 3) * 60_000
            : (5 + retryOffset) * 60_000;
          await supabaseAdmin
            .from("auto_comments")
            .update({
              status: "pending",
              run_at: new Date(Date.now() + delayMs).toISOString(),
              attempts: att + 1,
            } as any)
            .eq("id", r.id);
          retryOffset++;
        }

        // 0) Heal orphan comment templates: for any pending template (target_id IS NULL)
        // whose post was scheduled natively on FB (targets have fb_post_id), instantiate
        // per-target rows with run_at = post.scheduled_at + delay_seconds.
        const { data: orphanTmpls } = await supabaseAdmin
          .from("auto_comments")
          .select("id, user_id, post_id, message, delay_seconds")
          .eq("status", "pending")
          .is("target_id", null)
          .limit(100);
        for (const tmpl of orphanTmpls ?? []) {
          const { data: tgts } = await supabaseAdmin
            .from("post_targets")
            .select("id, fb_post_id")
            .eq("post_id", tmpl.post_id)
            .not("fb_post_id", "is", null);
          if (!tgts?.length) continue;
          const { data: pst } = await supabaseAdmin
            .from("posts")
            .select("scheduled_at")
            .eq("id", tmpl.post_id)
            .single();
          const baseMs = pst?.scheduled_at ? new Date(pst.scheduled_at).getTime() : Date.now();
          const rows: any[] = [];
          for (const t of tgts) {
            const { data: ex } = await supabaseAdmin
              .from("auto_comments")
              .select("id")
              .eq("target_id", t.id)
              .eq("post_id", tmpl.post_id)
              .limit(1);
            if (ex && ex.length) continue;
            rows.push({
              user_id: tmpl.user_id,
              post_id: tmpl.post_id,
              target_id: t.id,
              message: tmpl.message,
              delay_seconds: tmpl.delay_seconds,
              run_at: new Date(baseMs + (tmpl.delay_seconds ?? 0) * 1000).toISOString(),
            });
          }
          if (rows.length) await supabaseAdmin.from("auto_comments").insert(rows);
          // Mark template as instantiated so we don't keep healing it
          await supabaseAdmin
            .from("auto_comments")
            .update({ status: "posted", posted_at: new Date().toISOString() })
            .eq("id", tmpl.id);
        }

        // 1) Auto-comments due — process FIRST so they don't starve behind the publish loop.
        const { data: dueCommentsRaw } = await supabaseAdmin
          .from("auto_comments")
          .select("*, post_targets!inner(page_id)")
          .eq("status", "pending")
          .not("target_id", "is", null)
          .is("fb_comment_id", null)
          .lte("run_at", nowIso)
          .order("run_at", { ascending: true, nullsFirst: false })
          .limit(COMMENT_BATCH_LIMIT);

        // Round-robin por página: garante que páginas diferentes alternem entre si,
        // de forma que nenhuma página receba 2 comentários seguidos na mesma execução.
        const byPage = new Map<string, any[]>();
        for (const c of (dueCommentsRaw ?? []) as any[]) {
          const pid = c.post_targets?.page_id ?? "_unknown";
          const arr = byPage.get(pid) ?? [];
          arr.push(c);
          byPage.set(pid, arr);
        }
        const dueComments: any[] = [];
        const queues = Array.from(byPage.values());
        let qIdx = 0;
        while (queues.some((q) => q.length)) {
          const q = queues[qIdx % queues.length];
          if (q.length) dueComments.push(q.shift());
          qIdx++;
          if (qIdx > 100000) break;
        }

        async function deferComment(c: any, delayMs: number, reason: string) {
          await supabaseAdmin
            .from("auto_comments")
            .update({
              status: "pending",
              error: reason,
              run_at: new Date(Date.now() + delayMs).toISOString(),
            } as any)
            .eq("id", c.id);
        }

        async function hasRecentPageCommentActivity(pageId: string, currentCommentId: string) {
          const cutoff = new Date(Date.now() - COMMENT_PAGE_COOLDOWN_MS).toISOString();
          const { data: recent } = await supabaseAdmin
            .from("auto_comments")
            .select("id, post_targets!inner(page_id)")
            .neq("id", currentCommentId)
            .not("target_id", "is", null)
            .in("status", ["posted", "publishing"] as any)
            .or(`posted_at.gte.${cutoff},updated_at.gte.${cutoff}`)
            .eq("post_targets.page_id", pageId)
            .limit(1);
          return !!recent?.length;
        }

        async function deferPendingCommentsForPage(
          pageId: string,
          delayMs: number,
          reason: string,
          currentCommentId?: string,
        ) {
          if (currentCommentId) {
            await supabaseAdmin
              .from("auto_comments")
              .update({
                status: "pending",
                error: reason,
                run_at: new Date(Date.now() + delayMs + Math.floor(Math.random() * COMMENT_PAGE_STAGGER_JITTER_MS)).toISOString(),
              } as any)
              .eq("id", currentCommentId);
          }

          const { data: pendingForPage, error: pendingError } = await supabaseAdmin
            .from("auto_comments")
            .select("id, run_at, post_targets!inner(page_id)")
            .not("target_id", "is", null)
            .in("status", ["pending", "publishing"] as any)
            .is("fb_comment_id", null)
            .eq("post_targets.page_id", pageId)
            .order("run_at", { ascending: true, nullsFirst: false })
            .limit(600);

          if (pendingError) return;

          let offsetMs = delayMs;
          for (const row of pendingForPage ?? []) {
            if (currentCommentId && row.id === currentCommentId) continue;
            const jitter = Math.floor(Math.random() * COMMENT_PAGE_STAGGER_JITTER_MS);
            await supabaseAdmin
              .from("auto_comments")
              .update({
                status: "pending",
                error: reason,
                run_at: new Date(Date.now() + offsetMs + jitter).toISOString(),
              } as any)
              .eq("id", row.id);
            offsetMs += COMMENT_PAGE_STAGGER_MS;
          }
        }

        // Backoff exponencial para limite #368 por página.
        // Conta hits consecutivos (reseta após 6h sem hits) e escala o cooldown:
        // hit 1: 60min, 2: 120min, 3: 240min, 4: 480min, 5+: 720min (cap).
        // O cooldown é gravado em fb_pages.comment_cooldown_until e respeitado
        // por todas as próximas execuções do cron, evitando reprocessar em massa.
        const PAGE_368_RESET_MS = 6 * 60 * 60_000;
        const PAGE_368_BASE_MIN = 60;
        const PAGE_368_MAX_MIN = 720;
        async function escalate368ForPage(pageId: string): Promise<number> {
          const { data: row } = await supabaseAdmin
            .from("fb_pages")
            .select("comment_368_count, comment_368_last_at")
            .eq("id", pageId)
            .single();
          const lastAt = (row as any)?.comment_368_last_at
            ? new Date((row as any).comment_368_last_at).getTime()
            : 0;
          const prevCount = (row as any)?.comment_368_count ?? 0;
          const shouldReset = !lastAt || Date.now() - lastAt > PAGE_368_RESET_MS;
          const nextCount = shouldReset ? 1 : prevCount + 1;
          const baseMin = Math.min(
            PAGE_368_BASE_MIN * Math.pow(2, nextCount - 1),
            PAGE_368_MAX_MIN,
          );
          const jitterMin = Math.floor(baseMin * (Math.random() * 0.2)); // até +20%
          const cooldownMin = Math.floor(baseMin + jitterMin);
          const cooldownUntil = new Date(Date.now() + cooldownMin * 60_000).toISOString();
          await supabaseAdmin
            .from("fb_pages")
            .update({
              comment_368_count: nextCount,
              comment_368_last_at: new Date().toISOString(),
              comment_cooldown_until: cooldownUntil,
            } as any)
            .eq("id", pageId);
          return cooldownMin;
        }
        async function clearCommentCooldownIfStale(pageId: string) {
          // Após um comentário bem-sucedido, se o último hit foi há mais de 6h,
          // zera o contador para que um novo estouro recomece em 60min, não em 720min.
          await supabaseAdmin
            .from("fb_pages")
            .update({ comment_368_count: 0, comment_cooldown_until: null } as any)
            .eq("id", pageId)
            .lt("comment_368_last_at", new Date(Date.now() - PAGE_368_RESET_MS).toISOString());
        }

        async function postComment(c: any) { return withApiCallTracking(c.user_id, async () => {
          if (c.fb_comment_id) {
            await supabaseAdmin
              .from("auto_comments")
              .update({ status: "posted", error: null })
              .eq("id", c.id);
            return;
          }
          const { data: target } = await supabaseAdmin
            .from("post_targets")
            .select("fb_post_id, page_id")
            .eq("id", c.target_id!)
            .single();
          if (!target?.fb_post_id) {
            await supabaseAdmin
              .from("auto_comments")
              .update({ status: "failed", error: "post não publicado" })
              .eq("id", c.id);
            return;
          }

          // Backoff #368: se a página está em cooldown, reagenda sem chamar a API.
          {
            const { data: pgCool } = await supabaseAdmin
              .from("fb_pages")
              .select("comment_cooldown_until")
              .eq("id", target.page_id)
              .single();
            const until = (pgCool as any)?.comment_cooldown_until
              ? new Date((pgCool as any).comment_cooldown_until).getTime()
              : 0;
            if (until && until > Date.now()) {
              const delayMs = until - Date.now() + Math.floor(Math.random() * 60_000);
              await deferComment(
                c,
                delayMs,
                `página em backoff #368 até ${new Date(until).toISOString()}`,
              );
              return;
            }
          }

          const pageJitterMs = (60 + Math.floor(Math.random() * 180)) * 1000;
          if (commentTouchedPages.has(target.page_id)) {
            await deferComment(
              c,
              COMMENT_PAGE_COOLDOWN_MS + pageJitterMs,
              "aguardando intervalo da página para evitar limite de comentários",
            );
            return;
          }
          if (await hasRecentPageCommentActivity(target.page_id, c.id)) {
            await deferComment(
              c,
              COMMENT_PAGE_COOLDOWN_MS + pageJitterMs,
              "aguardando intervalo da página para evitar limite de comentários",
            );
            return;
          }
          commentTouchedPages.add(target.page_id);

          // Atomic claim: only one cron tick can flip pending -> publishing.
          const { data: claimed } = await supabaseAdmin
            .from("auto_comments")
            .update({ status: "publishing" } as any)
            .eq("id", c.id)
            .eq("status", "pending")
            .is("fb_comment_id", null)
            .select("id")
            .maybeSingle();
          if (!claimed) return;
          const { data: pg } = await supabaseAdmin
            .from("fb_pages")
            .select("access_token, fb_page_id")
            .eq("id", target.page_id)
            .single();
          if (!pg) {
            await supabaseAdmin
              .from("auto_comments")
              .update({ status: "failed", error: "página ausente" })
              .eq("id", c.id);
            return;
          }
          const { data: postForComment } = await supabaseAdmin
            .from("posts")
            .select("type, message")
            .eq("id", c.post_id)
            .single();
          try {
            // Expande spintax {a|b|c} da mensagem — cada envio gera uma variação para
            // evitar detecção de duplicidade e reduzir estouros de #368.
            const rawMsg = c.message ?? "";
            const spinSeed = Math.floor(Math.random() * 1_000_000);
            const finalMsg = hasSpintax(rawMsg) ? expandSpintax(rawMsg, spinSeed) : rawMsg;
            const wanted = normalizeComment(finalMsg);
            const commentObjectIds = [String(target.fb_post_id)];

            if (postForComment?.type === "video") {
              try {
                const videos: any = await fbGet(`/${pg.fb_page_id}/videos`, {
                  access_token: pg.access_token,
                  fields: "id,post_id,description,created_time",
                  limit: "100",
                });
                const postMessage = normalizeComment(postForComment.message ?? "");
                const matchedVideo = (videos?.data ?? []).find((item: any) => {
                  const desc = normalizeComment(item?.description ?? "");
                  return desc && postMessage && (desc === postMessage || desc.includes(postMessage.slice(0, 80)));
                });
                if (matchedVideo?.id && !commentObjectIds.includes(String(matchedVideo.id))) {
                  commentObjectIds.push(String(matchedVideo.id));
                  await supabaseAdmin
                    .from("post_targets")
                    .update({ fb_post_id: String(matchedVideo.id) } as any)
                    .eq("id", c.target_id!);
                }
              } catch {
                // If video lookup fails, still try the stored ids below.
              }
            }
            if (!String(target.fb_post_id).includes("_")) {
              // Videos often return only the video id. Comments must be posted on PAGEID_VIDEOID.
              commentObjectIds.push(`${pg.fb_page_id}_${target.fb_post_id}`);
            }
            let lastCommentError = "";
            let alreadyPosted = false;

            // Helper: scan known object ids for an existing matching comment from this page.
            const findExistingComment = async (): Promise<string | null> => {
              for (const oid of commentObjectIds) {
                try {
                  const existing: any = await fbGet(`/${oid}/comments`, {
                    access_token: pg.access_token,
                    fields: "id,message,from{name,id}",
                    limit: "25",
                    order: "reverse_chronological",
                  });
                  const hit = (existing?.data ?? []).find(
                    (item: any) =>
                      normalizeComment(item?.message ?? "") === wanted &&
                      (!item?.from?.id || item.from.id === pg.fb_page_id),
                  );
                  if (hit?.id) return hit.id;
                } catch {}
              }
              return null;
            };

            // Check once before posting. Calling /comments repeatedly for every candidate
            // object was multiplying Graph calls and making limits arrive faster.
            const shouldCheckExistingFirst =
              (c.attempts ?? 0) > 0 ||
              /timeout|network|fetch failed|socket|ETIMEDOUT|ECONNRESET|auto-recuperado|duplic|já existia/i.test(
                c.error ?? "",
              );
            if (shouldCheckExistingFirst) {
              const existingId = await findExistingComment();
              if (existingId) {
                await supabaseAdmin
                  .from("auto_comments")
                  .update({
                    status: "posted",
                    fb_comment_id: existingId,
                    posted_at: new Date().toISOString(),
                    error: "comentário já existia no Facebook; não repostado",
                  })
                  .eq("id", c.id);
                comments++;
                alreadyPosted = true;
              }
            }

            for (const objectId of commentObjectIds) {
              if (alreadyPosted) break;

              try {
                const r: any = await fbPost(`/${objectId}/comments`, {
                  access_token: pg.access_token,
                  message: finalMsg,
                });

                await supabaseAdmin
                  .from("auto_comments")
                  .update({
                    status: "posted",
                    fb_comment_id: r.id,
                    posted_at: new Date().toISOString(),
                    error: null,
                  })
                  .eq("id", c.id);
                comments++;
                alreadyPosted = true;
                // Sucesso: se a página acumulou hits #368 antigos (>6h), reseta o contador.
                await clearCommentCooldownIfStale(target.page_id);
                break;
              } catch (e: any) {
                lastCommentError = e?.message ?? String(e);
                if (/limit|#4\b|#17\b|#32\b|#368\b|#613/i.test(lastCommentError)) throw e;
                // On timeout/network error, FB may still have accepted — re-check before next id.
                if (/timeout|network|fetch failed|socket|ETIMEDOUT|ECONNRESET/i.test(lastCommentError)) {
                  await new Promise((r) => setTimeout(r, 1500));
                  const recoveredId = await findExistingComment();
                  if (recoveredId) {
                    await supabaseAdmin
                      .from("auto_comments")
                      .update({
                        status: "posted",
                        fb_comment_id: recoveredId,
                        posted_at: new Date().toISOString(),
                        error: "comentário confirmado após timeout; não duplicado",
                      })
                      .eq("id", c.id);
                    comments++;
                    alreadyPosted = true;
                    break;
                  }
                }
                if (!/does not exist|missing permissions|does not support|nonexisting field \(comments\)|Tried accessing nonexisting field \(comments\)|#100\b/i.test(lastCommentError)) break;
              }
            }

            if (!alreadyPosted) throw new Error(lastCommentError || "não foi possível comentar no post");
          } catch (e: any) {
            const msg = e?.message ?? "";
            // Rate-limit por página (#368): backoff exponencial (60→120→240→480→720min).
            if (/#368\b|Limitamos a frequência|frequency limit/i.test(msg)) {
              const cooldownMin = await escalate368ForPage(target.page_id);
              await deferPendingCommentsForPage(
                target.page_id,
                cooldownMin * 60_000,
                `rate-limit da página (#368) — backoff exponencial: pausa de ${cooldownMin}min`,
                c.id,
              );
              rateLimitHit = true;
              return;
            }
            if (/limit|#4\b|#17\b|#32\b|#613/i.test(msg)) {
              const cooldownMin = 45 + Math.floor(Math.random() * 46); // 45–90min
              await deferComment(
                c,
                cooldownMin * 60_000,
                `limite geral da API — comentário pausado por ${cooldownMin}min`,
              );
              rateLimitHit = true;
              return;
            }
            await supabaseAdmin
              .from("auto_comments")
              .update({ status: "failed", error: msg })
              .eq("id", c.id);
            if (/limit|#4|#17|#32|#613/i.test(msg)) rateLimitHit = true;
          }
        }); }


        for (const group of chunk(dueComments ?? [], COMMENT_CONCURRENCY)) {
          if (outOfTime() || rateLimitHit) break;
          await Promise.all(group.map(postComment));
          // pausa entre lotes para suavizar a curva de chamadas
          await sleep(COMMENT_INTER_DELAY_MS + Math.floor(Math.random() * COMMENT_INTER_JITTER_MS));
        }

        // 1.5) Empurrar targets futuros para o agendador NATIVO do Facebook.
        // Sem isso, posts importados em massa ficam só no nosso DB e dependem
        // do cron publicar na hora, fazendo o usuário ver "1 só agendado" no FB.
        try {
          const { scheduleTargetsNative } = await import("@/lib/fb-schedule");
          const { data: userRows } = await supabaseAdmin
            .from("post_targets")
            .select("user_id")
            .is("fb_post_id", null)
            .in("status", ["pending", "failed"])
            .limit(200);
          const uniqueUsers = [...new Set((userRows ?? []).map((r: any) => r.user_id).filter(Boolean))];
          for (const uid of uniqueUsers) {
            if (outOfTime() || rateLimitHit) break;
            try {
              const res = await scheduleTargetsNative({
                supabase: supabaseAdmin,
                userId: uid,
                batchSize: 40,
                concurrency: 5,
              });
              if (res.errors.some((e) => /limit|#4|#17|#32|#613/i.test(e))) {
                rateLimitHit = true;
                break;
              }
            } catch {
              // best-effort; continua para o passo de publicação
            }
          }
        } catch {
          // se o módulo falhar, segue o fluxo normal
        }

        // 2) Scheduled posts whose time has come.
        // Atomic claim: only pick posts still 'scheduled' and flip them to 'publishing' in one update,
        // so concurrent cron ticks never grab the same post.
        const { data: dueIds } = await supabaseAdmin
          .from("posts")
          .select("id")
          .eq("status", "scheduled")
          .lte("scheduled_at", fallbackReadyIso)
          .limit(10);

        const due: any[] = [];
        for (const row of dueIds ?? []) {
          const { count: unsentTargets } = await supabaseAdmin
            .from("post_targets")
            .select("id", { count: "exact", head: true })
            .eq("post_id", row.id)
            .is("fb_post_id", null)
            .eq("status", "pending")
            .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`);
          if (!unsentTargets) continue;
          const { data: claimed } = await supabaseAdmin
            .from("posts")
            .update({ status: "publishing" })
            .eq("id", row.id)
            .eq("status", "scheduled")
            .select("*")
            .maybeSingle();
          if (claimed) due.push(claimed);
        }

        for (const post of due) {
          if (outOfTime() || fallbackPublishedPages.size >= MAX_PAGES_PER_RUN) {
            // Hand back so another tick can resume.
            await supabaseAdmin.from("posts").update({ status: "scheduled" }).eq("id", post.id);
            break;
          }

          // Only pending targets ready for (re)try. Skip targets whose next_retry_at is still in the future.
          // Also skip targets with an fb_post_id (imported FB-scheduled posts — FB publishes them itself).
          const { data: targets } = await supabaseAdmin
            .from("post_targets")
            .select("id,page_id,attempts")
            .eq("post_id", post.id)
            .eq("status", "pending")
            .is("fb_post_id", null)
            .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`);

          const candidateTargets: any[] = [];
          for (const target of targets ?? []) {
            const nextCooldownIso = new Date(Date.now() + pageFallbackCooldownMs()).toISOString();

            if (fallbackPublishedPages.has(target.page_id)) {
              await supabaseAdmin
                .from("post_targets")
                .update({ next_retry_at: nextCooldownIso } as any)
                .eq("id", target.id);
              continue;
            }
            const { data: recentForPage } = await supabaseAdmin
              .from("post_targets")
              .select("id")
              .eq("page_id", target.page_id)
              .eq("status", "published")
              .gte("published_at", new Date(Date.now() - PAGE_FALLBACK_COOLDOWN_MS).toISOString())
              .limit(1);
            if (recentForPage?.length) {
              await supabaseAdmin
                .from("post_targets")
                .update({ next_retry_at: nextCooldownIso } as any)
                .eq("id", target.id);
              continue;
            }
            candidateTargets.push(target);
          }

          const MAX_ATTEMPTS = 3;
          // Backoff between attempts (minutes): after attempt 1 -> 1m, after 2 -> 5m, after 3 -> 15m (unused, marked failed)
          const BACKOFF_MIN = [1, 5, 15];

          async function publishTarget(t: { id: string; page_id: string; attempts: number }) { return withApiCallTracking(post.user_id, async () => {
            if (fallbackPublishedPages.has(t.page_id)) return;
            const nowStamp = new Date().toISOString();
            // Atomic claim — prevents another tick from re-publishing it.
            const { data: claimedT } = await supabaseAdmin
              .from("post_targets")
              .update({ status: "publishing", last_attempt_at: nowStamp } as any)
              .eq("id", t.id)
              .eq("status", "pending")
              .select("id,attempts")
              .maybeSingle();
            if (!claimedT) return;

            const nextAttempt = (claimedT.attempts ?? 0) + 1;
            const pageCooldownIso = new Date(Date.now() - PAGE_FALLBACK_COOLDOWN_MS).toISOString();
            const nextCooldownIso = new Date(Date.now() + pageFallbackCooldownMs()).toISOString();
            const { data: competingTargets } = await supabaseAdmin
              .from("post_targets")
              .select("id,last_attempt_at")
              .eq("page_id", t.page_id)
              .eq("status", "publishing")
              .gte("last_attempt_at", pageCooldownIso)
              .neq("id", t.id);
            const earlierCompetingTarget = (competingTargets ?? []).some((row: any) => {
              const otherStamp = row.last_attempt_at ?? "";
              return otherStamp < nowStamp || (otherStamp === nowStamp && row.id < t.id);
            });
            const { data: recentPublishedTarget } = await supabaseAdmin
              .from("post_targets")
              .select("id")
              .eq("page_id", t.page_id)
              .eq("status", "published")
              .gte("published_at", pageCooldownIso)
              .neq("id", t.id)
              .limit(1);
            if (earlierCompetingTarget || recentPublishedTarget?.length) {
              await supabaseAdmin
                .from("post_targets")
                .update({ status: "pending", next_retry_at: nextCooldownIso } as any)
                .eq("id", t.id);
              return;
            }
            const { data: pg } = await supabaseAdmin
              .from("fb_pages")
              .select("fb_page_id, access_token, is_active")
              .eq("id", t.page_id)
              .single();
            if (!pg) {
              await supabaseAdmin
                .from("post_targets")
                .update({
                  status: "failed",
                  error: "página ausente",
                  attempts: nextAttempt,
                  last_attempt_at: nowStamp,
                  next_retry_at: null,
                })
                .eq("id", t.id);
              return;
            }
            if (pg.is_active === false) {
              await supabaseAdmin
                .from("post_targets")
                .update({
                  status: "failed",
                  error: "página inativa (token inválido)",
                  attempts: nextAttempt,
                  last_attempt_at: nowStamp,
                  next_retry_at: null,
                })
                .eq("id", t.id);
              return;
            }
            try {
              const existingFbPost = await findMatchingFacebookPost(
                pg,
                post.message ?? "",
                post.scheduled_at,
              );
              if (existingFbPost) {
                await supabaseAdmin
                  .from("post_targets")
                  .update({
                    status: existingFbPost.kind === "published" ? "published" : "pending",
                    fb_post_id: existingFbPost.id,
                    published_at: existingFbPost.kind === "published" ? nowStamp : null,
                    attempts: nextAttempt,
                    last_attempt_at: nowStamp,
                    error:
                      existingFbPost.kind === "published"
                        ? "post já existia no Facebook; fallback não repostou"
                        : "post agendado no Facebook; fallback não repostou",
                    next_retry_at: null,
                  } as any)
                  .eq("id", t.id);
                if (existingFbPost.kind === "published") fallbackPublishedPages.add(t.page_id);
                return;
              }

              const fbId = await publishFacebookPost({
                type: post.type as any,
                message: post.message ?? "",
                linkUrl: post.link_url ?? undefined,
                mediaUrls: post.media_urls ?? [],
                fbPageId: pg.fb_page_id,
                pageToken: pg.access_token,
              });
              await supabaseAdmin
                .from("post_targets")
                .update({
                  status: "published",
                  fb_post_id: fbId,
                  published_at: nowStamp,
                  attempts: nextAttempt,
                  last_attempt_at: nowStamp,
                  error: null,
                  next_retry_at: null,
                })
                .eq("id", t.id);
              fallbackPublishedPages.add(t.page_id);
              const { data: tmpl } = await supabaseAdmin
                .from("auto_comments")
                .select("*")
                .eq("post_id", post.id)
                .is("target_id", null)
                .eq("status", "pending");
              for (const c of tmpl ?? []) {
                const { data: existing } = await supabaseAdmin
                  .from("auto_comments")
                  .select("id")
                  .eq("post_id", post.id)
                  .eq("target_id", t.id)
                  .eq("message", c.message)
                  .limit(1);
                if (existing && existing.length) continue;
                await supabaseAdmin.from("auto_comments").insert({
                  user_id: post.user_id,
                  post_id: post.id,
                  target_id: t.id,
                  message: c.message,
                  delay_seconds: c.delay_seconds,
                  run_at: new Date(Date.now() + c.delay_seconds * 1000).toISOString(),
                });
              }
              // NÃO marcar template como posted aqui — outros targets do mesmo post
              // ainda precisam encontrar o template para instanciar seus comentários.
              // O template é marcado posted na finalização do post (quando todos targets terminam).
            } catch (e: any) {
              const msg = e?.message ?? "";
              const isRate = /limit|#4|#17|#32|#613/i.test(msg);
              if (isRate) rateLimitHit = true;
              // Permanent errors — don't waste retries
              const isPermanent = /invalid|expired|permission|#10|#190|#200|#368|OAuth/i.test(msg);
              if (nextAttempt >= MAX_ATTEMPTS || isPermanent) {
                await supabaseAdmin
                  .from("post_targets")
                  .update({
                    status: "failed",
                    error: msg,
                    attempts: nextAttempt,
                    last_attempt_at: nowStamp,
                    next_retry_at: null,
                  })
                  .eq("id", t.id);
              } else {
                const waitMin = BACKOFF_MIN[Math.min(nextAttempt - 1, BACKOFF_MIN.length - 1)];
                const nextRetry = new Date(Date.now() + waitMin * 60_000).toISOString();
                await supabaseAdmin
                  .from("post_targets")
                  .update({
                    status: "pending",
                    error: msg,
                    attempts: nextAttempt,
                    last_attempt_at: nowStamp,
                    next_retry_at: nextRetry,
                  })
                  .eq("id", t.id);
              }
            }
          }); }

          for (const group of chunk(candidateTargets, CONCURRENCY)) {
            if (outOfTime() || rateLimitHit) break;
            if (fallbackPublishedPages.size >= MAX_PAGES_PER_RUN) break;
            await Promise.all(group.map(publishTarget));
            // Espaça 2-3 min entre grupos de páginas na mesma execução.
            // Como MAX_RUN_MS=45s, geralmente só um grupo roda por tick — o restante
            // fica com next_retry_at ~2-3min, respeitando o intervalo entre páginas.

          }

          // Finalize: are there still pending/publishing targets?
          const { data: remaining } = await supabaseAdmin
            .from("post_targets")
            .select("status")
            .eq("post_id", post.id);
          const stillPending = (remaining ?? []).some(
            (r) => r.status === "pending" || r.status === "publishing",
          );
          if (!stillPending) {
            const failedCount = (remaining ?? []).filter((r) => r.status === "failed").length;
            const okCount = (remaining ?? []).filter((r) => r.status === "published").length;
            await supabaseAdmin
              .from("posts")
              .update({
                status: failedCount === 0 ? "published" : okCount === 0 ? "failed" : "partial",
                published_at: new Date().toISOString(),
                error: failedCount ? `${failedCount} falha(s)` : null,
              })
              .eq("id", post.id);
            // Agora sim marcar templates de comentário como posted (todos os targets foram processados)
            await supabaseAdmin
              .from("auto_comments")
              .update({ status: "posted", posted_at: new Date().toISOString() })
              .eq("post_id", post.id)
              .is("target_id", null)
              .eq("status", "pending");
          } else {
            // Reset any orphan 'publishing' targets back to 'pending' so next tick retries them,
            // then hand the post back to 'scheduled'.
            await supabaseAdmin
              .from("post_targets")
              .update({ status: "pending" })
              .eq("post_id", post.id)
              .eq("status", "publishing");
            await supabaseAdmin.from("posts").update({ status: "scheduled" }).eq("id", post.id);
          }
          processed++;
          if (rateLimitHit) break;
        }

        return Response.json({
          ok: true,
          processed,
          failed,
          comments,
          pendingComments: (dueComments ?? []).length,
        });
      },
    },
  },
});
