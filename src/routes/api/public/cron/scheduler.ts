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

        // 1) Scheduled posts whose time has come
        const { data: due } = await supabaseAdmin
          .from("posts").select("*").eq("status", "scheduled").lte("scheduled_at", nowIso).limit(25);

        for (const post of due ?? []) {
          await supabaseAdmin.from("posts").update({ status: "publishing" }).eq("id", post.id);
          const { data: targets } = await supabaseAdmin.from("post_targets").select("id,page_id").eq("post_id", post.id);
          let ok = 0, fl = 0;
          let batchCount = 0;
          for (const t of targets ?? []) {
            // Throttle: pause every 10 targets to respect Facebook rate limits
            if (batchCount > 0 && batchCount % 10 === 0) {
              await new Promise((r) => setTimeout(r, 30000));
            }
            batchCount++;
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
              // schedule auto-comments
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
              // Heavy backoff if Facebook signals rate limit
              if (/limit|#4|#17|#32|#613/i.test(msg)) {
                await new Promise((r) => setTimeout(r, 60000));
              }
            }
            // Small spacing between every publish to avoid bursts
            await new Promise((r) => setTimeout(r, 1500));
          }
          await supabaseAdmin.from("posts").update({
            status: fl === 0 ? "published" : (ok === 0 ? "failed" : "partial"),
            published_at: new Date().toISOString(), error: fl ? `${fl} falha(s) de ${(targets ?? []).length}` : null,
          }).eq("id", post.id);
          processed++; failed += fl;
        }

        // 2) Auto-comments due
        const { data: dueComments } = await supabaseAdmin
          .from("auto_comments").select("*").eq("status", "pending").not("target_id", "is", null).lte("run_at", nowIso).limit(50);
        let commentBatch = 0;
        for (const c of dueComments ?? []) {
          if (commentBatch > 0 && commentBatch % 10 === 0) {
            await new Promise((r) => setTimeout(r, 30000));
          }
          commentBatch++;
          const { data: target } = await supabaseAdmin.from("post_targets").select("fb_post_id, page_id").eq("id", c.target_id!).single();
          if (!target?.fb_post_id) { await supabaseAdmin.from("auto_comments").update({ status: "failed", error: "post não publicado" }).eq("id", c.id); continue; }
          const { data: pg } = await supabaseAdmin.from("fb_pages").select("access_token").eq("id", target.page_id).single();
          if (!pg) { await supabaseAdmin.from("auto_comments").update({ status: "failed", error: "página ausente" }).eq("id", c.id); continue; }
          try {
            const r: any = await fbPost(`/${target.fb_post_id}/comments`, { access_token: pg.access_token, message: c.message });
            await supabaseAdmin.from("auto_comments").update({ status: "posted", fb_comment_id: r.id, posted_at: new Date().toISOString() }).eq("id", c.id);
            comments++;
          } catch (e: any) {
            const msg = e?.message ?? "";
            await supabaseAdmin.from("auto_comments").update({ status: "failed", error: msg }).eq("id", c.id);
            if (/limit|#4|#17|#32|#613/i.test(msg)) {
              await new Promise((r) => setTimeout(r, 60000));
            }
          }
          await new Promise((r) => setTimeout(r, 1500));
        }

        return Response.json({ ok: true, processed, failed, comments });
      },
    },
  },
});
