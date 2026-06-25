// Rastreador de chamadas à Graph API, categorizadas por endpoint.
// Usa AsyncLocalStorage para acumular contadores durante o lifecycle de
// uma server fn / rota de cron, e faz flush no final via RPC bump_fb_api_call.
//
// Server-only: importa node:async_hooks (não vai pro bundle do cliente).
import { AsyncLocalStorage } from "node:async_hooks";

export type ApiCallCategory =
  | "debug_token"
  | "exchange_token"
  | "publish_feed"
  | "publish_photo"
  | "publish_video"
  | "publish_comment"
  | "delete"
  | "insights"
  | "read_post"
  | "list_posts"
  | "list_photos"
  | "list_videos"
  | "list_scheduled"
  | "list_comments"
  | "page_meta"
  | "me_accounts"
  | "other";

type Bucket = Map<ApiCallCategory, number>;
type Ctx = { bucket: Bucket; userId: string };

const als = new AsyncLocalStorage<Ctx>();

export function categorizeEndpoint(path: string, method: "GET" | "POST" | "DELETE" | "MULTIPART"): ApiCallCategory {
  // path começa com "/", pode ter querystring removida antes.
  const p = path.split("?")[0];
  if (p === "/debug_token") return "debug_token";
  if (p === "/oauth/access_token") return "exchange_token";
  if (p === "/me") return "page_meta";
  if (p === "/me/accounts") return "me_accounts";
  if (method === "DELETE") return "delete";
  // /{id}/feed, /{id}/photos, /{id}/videos, /{id}/comments, /{id}/insights, /{id}/scheduled_posts, /{id}/posts
  const seg = p.split("/").filter(Boolean);
  const last = seg[seg.length - 1] ?? "";
  if (method === "POST" || method === "MULTIPART") {
    if (last === "feed") return "publish_feed";
    if (last === "photos") return "publish_photo";
    if (last === "videos") return "publish_video";
    if (last === "comments") return "publish_comment";
  }
  if (method === "GET") {
    if (last === "posts") return "list_posts";
    if (last === "photos") return "list_photos";
    if (last === "videos") return "list_videos";
    if (last === "scheduled_posts") return "list_scheduled";
    if (last === "comments") return "list_comments";
    if (last === "insights") return "insights";
    // /{post_id} sem subpath é um read individual
    if (seg.length === 1 && /^\d+(_\d+)?$/.test(last)) return "read_post";
    if (last === "picture") return "page_meta";
  }
  return "other";
}

export function bumpCurrent(category: ApiCallCategory, n = 1) {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.bucket.set(category, (ctx.bucket.get(category) ?? 0) + n);
}

export async function withApiCallTracking<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: Ctx = { userId, bucket: new Map() };
  try {
    return await als.run(ctx, fn);
  } finally {
    // Flush em background; não bloqueia a resposta nem propaga erros.
    flushBucket(ctx).catch((e) => console.warn("[fb-api-tracker] flush failed:", e?.message));
  }
}

async function flushBucket(ctx: Ctx) {
  if (ctx.bucket.size === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await Promise.all(Array.from(ctx.bucket.entries()).map(([endpoint, count]) =>
    (supabaseAdmin as any).rpc("bump_fb_api_call", {
      p_user_id: ctx.userId,
      p_endpoint: endpoint,
      p_inc: count,
    }),
  ));
}
