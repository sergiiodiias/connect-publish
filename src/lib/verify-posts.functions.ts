import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet } from "@/lib/fb-graph";

export type VerifyResult = {
  targetId: string;
  pageName: string;
  fbPostId: string | null;
  status: "verified" | "missing" | "skipped" | "error";
  permalink?: string;
  message?: string;
};

export const verifyPostPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: post } = await supabase
      .from("posts")
      .select("id, status")
      .eq("id", data.postId)
      .eq("user_id", userId)
      .single();
    if (!post) throw new Error("Post não encontrado");

    const { data: targets } = await supabase
      .from("post_targets")
      .select("id, status, fb_post_id, page_id, fb_pages(name, access_token)")
      .eq("post_id", data.postId);

    const results: VerifyResult[] = [];
    let verified = 0, missing = 0, skipped = 0, errored = 0;

    for (const t of targets ?? []) {
      const pageName = (t.fb_pages as any)?.name ?? "(página removida)";
      const pageToken = (t.fb_pages as any)?.access_token as string | undefined;

      if (!t.fb_post_id) {
        results.push({ targetId: t.id, pageName, fbPostId: null, status: "skipped", message: "Sem fb_post_id (não publicado)" });
        skipped++;
        continue;
      }
      if (!pageToken) {
        results.push({ targetId: t.id, pageName, fbPostId: t.fb_post_id, status: "error", message: "Token da página ausente" });
        errored++;
        continue;
      }

      try {
        const r: any = await fbGet(`/${t.fb_post_id}`, {
          access_token: pageToken,
          fields: "id,permalink_url,created_time",
        });
        results.push({
          targetId: t.id,
          pageName,
          fbPostId: t.fb_post_id,
          status: "verified",
          permalink: r.permalink_url,
        });
        await supabase.from("post_targets")
          .update({ status: "published", error: null })
          .eq("id", t.id);
        verified++;
      } catch (e: any) {
        const msg = e?.message ?? "erro";
        // Code 100/803 → não existe / removido
        const isMissing = /\b100\b|\b803\b|does not exist|Unsupported get request/i.test(msg);
        results.push({
          targetId: t.id,
          pageName,
          fbPostId: t.fb_post_id,
          status: isMissing ? "missing" : "error",
          message: msg,
        });
        if (isMissing) {
          await supabase.from("post_targets")
            .update({ status: "missing", error: `Verificação: ${msg}` })
            .eq("id", t.id);
          missing++;
        } else {
          errored++;
        }
      }
    }

    // Recalcula status do post
    const total = (targets ?? []).length;
    const publishedCount = verified + skipped; // skipped = ainda agendado/pendente
    let newStatus: "published" | "partial" | "failed" | null = null;
    if (total > 0 && verified === total) newStatus = "published";
    else if (verified > 0 && (missing > 0 || errored > 0)) newStatus = "partial";
    else if (verified === 0 && (missing > 0 || errored > 0)) newStatus = "failed";

    if (newStatus) {
      await supabase.from("posts").update({
        status: newStatus,
        error: missing + errored > 0 ? `Verificação: ${verified}/${total} confirmadas` : null,
      }).eq("id", data.postId);
    }

    return {
      total,
      verified,
      missing,
      skipped,
      errored,
      results,
      newStatus: newStatus ?? post.status,
    };
  });
