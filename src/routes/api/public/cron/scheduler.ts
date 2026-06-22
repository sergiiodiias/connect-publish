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
        const { fbPost } = await import("@/lib/fb-graph");
        const { publishFacebookPost } = await import("@/lib/fb-publish");

        const nowIso = new Date().toISOString();
        let processed = 0, failed = 0, comments = 0;

        // Budget the whole run so a single invocation doesn't starve the next cron tick.
        const startedAt = Date.now();
        const MAX_RUN_MS = 45_000;
        const outOfTime = () => Date.now() - startedAt > MAX_RUN_MS;

        const CONCURRENCY = 5;
        const chunk = <T,>(arr: T[], size: number): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };
        let rateLimitHit = false;

        // 1) Auto-comments due — process FIRST so they don't starve behind the publish loop.
        const { data: dueComments } = await supabaseAdmin
          .from("auto_comments").select("*").eq("status", "pending").not("target_id", "is", null).lte("run_at", nowIso).limit(60);

        async function postComment(c: any) {
          const { data: target } = await supabaseAdmin.from("post_targets").select("fb_post_id, page_id").eq("id", c.target_id!).single();
          if (!target?.fb_post_id) { await supabaseAdmin.from("auto_comments").update({ status: "failed", error: "post não publicado" }).eq("id", c.id); return; }
          const { data: pg } = await supabaseAdmin.from("fb_pages").select("access_token").eq("id", target.page_id).single();
          if (!pg) { await supabaseAdmin.from("auto_comments").update({ status: "failed", error: "página ausente" }).eq("id", c.id); return; }
          try {
            const r: any = await fbPost(`/${target.fb_post_id}/comments`, { access_token: pg.access_token, message: c.message });
            await supabaseAdmin.from("auto_comments").update({ status: "posted", fb_comment_id: r.id, posted_at: new Date().toISOString() }).eq("id", c.id);
            comments++;
          } catch (e: any) {
            const msg = e?.message ?? "";
            await supabaseAdmin.from("auto_comments").update({ status: "failed", error: msg }).eq("id", c.id);
            if (/limit|#4|#17|#32|#613/i.test(msg)) rateLimitHit = true;
          }
        }

        for (const group of chunk(dueComments ?? [], CONCURRENCY)) {
          if (outOfTime() || rateLimitHit) break;
          await Promise.all(group.map(postComment));
        }


        // 2) Scheduled posts whose time has come.
        // Atomic claim: only pick posts still 'scheduled' and flip them to 'publishing' in one update,
        // so concurrent cron ticks never grab the same post.
        const { data: dueIds } = await supabaseAdmin
          .from("posts").select("id").eq("status", "scheduled").lte("scheduled_at", nowIso).limit(10);
        const due: any[] = [];
        for (const row of dueIds ?? []) {
          const { data: claimed } = await supabaseAdmin
            .from("posts").update({ status: "publishing" })
            .eq("id", row.id).eq("status", "scheduled").select("*").maybeSingle();
          if (claimed) due.push(claimed);
        }

        for (const post of due) {
          if (outOfTime()) {
            // Hand back so another tick can resume.
            await supabaseAdmin.from("posts").update({ status: "scheduled" }).eq("id", post.id);
            break;
          }
          // Only pending targets — published/publishing/failed are skipped.
          const { data: targets } = await supabaseAdmin
            .from("post_targets").select("id,page_id").eq("post_id", post.id).eq("status", "pending");
          let ok = 0, fl = 0;
          for (const t of targets ?? []) {
            if (outOfTime()) break;
            // Atomic claim of this target — prevents another tick from re-publishing it.
            const { data: claimedT } = await supabaseAdmin
              .from("post_targets").update({ status: "publishing" })
              .eq("id", t.id).eq("status", "pending").select("id").maybeSingle();
            if (!claimedT) continue; // already taken by another tick

            const { data: pg } = await supabaseAdmin.from("fb_pages").select("fb_page_id, access_token").eq("id", t.page_id).single();
            if (!pg) { await supabaseAdmin.from("post_targets").update({ status: "failed", error: "página ausente" }).eq("id", t.id); fl++; continue; }
            try {
              const fbId = await publishFacebookPost({
                type: post.type as any,
                message: post.message ?? "",
                linkUrl: post.link_url ?? undefined,
                mediaUrls: post.media_urls ?? [],
                fbPageId: pg.fb_page_id,
                pageToken: pg.access_token,
              });
              await supabaseAdmin.from("post_targets").update({ status: "published", fb_post_id: fbId, published_at: new Date().toISOString() }).eq("id", t.id);
              const { data: tmpl } = await supabaseAdmin.from("auto_comments").select("*").eq("post_id", post.id).is("target_id", null).eq("status", "pending");
              for (const c of tmpl ?? []) {
                await supabaseAdmin.from("auto_comments").insert({
                  user_id: post.user_id, post_id: post.id, target_id: t.id,
                  message: c.message, delay_seconds: c.delay_seconds,
                  run_at: new Date(Date.now() + c.delay_seconds * 1000).toISOString(),
                });
              }
              ok++;
            } catch (e: any) {
              const msg = e?.message ?? "";
              await supabaseAdmin.from("post_targets").update({ status: "failed", error: msg }).eq("id", t.id);
              fl++;
              if (/limit|#4|#17|#32|#613/i.test(msg)) break;
            }
            await new Promise((r) => setTimeout(r, 800));
          }
          // Finalize: are there still pending/publishing targets?
          const { data: remaining } = await supabaseAdmin.from("post_targets").select("status").eq("post_id", post.id);
          const stillPending = (remaining ?? []).some((r) => r.status === "pending" || r.status === "publishing");
          if (!stillPending) {
            const failedCount = (remaining ?? []).filter((r) => r.status === "failed").length;
            const okCount = (remaining ?? []).filter((r) => r.status === "published").length;
            await supabaseAdmin.from("posts").update({
              status: failedCount === 0 ? "published" : (okCount === 0 ? "failed" : "partial"),
              published_at: new Date().toISOString(), error: failedCount ? `${failedCount} falha(s)` : null,
            }).eq("id", post.id);
          } else {
            // Reset any orphan 'publishing' targets back to 'pending' so next tick retries them,
            // then hand the post back to 'scheduled'.
            await supabaseAdmin.from("post_targets").update({ status: "pending" }).eq("post_id", post.id).eq("status", "publishing");
            await supabaseAdmin.from("posts").update({ status: "scheduled" }).eq("id", post.id);
          }
          processed++; failed += fl;
        }


        return Response.json({ ok: true, processed, failed, comments, pendingComments: (dueComments ?? []).length });
      },
    },
  },
});
