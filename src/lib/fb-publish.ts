import { fbPost, fbPostMultipart } from "@/lib/fb-graph";
import { fetchMediaAsBlob, isFacebookSafePhoto } from "@/lib/media-fetch";

type PublishType = "text" | "photo" | "video" | "link";

function applySchedule(form: FormData | Record<string, string>, scheduledUnix?: number) {
  if (!scheduledUnix) return;
  if (form instanceof FormData) {
    form.set("published", "false");
    form.set("scheduled_publish_time", String(scheduledUnix));
  } else {
    form.published = "false";
    form.scheduled_publish_time = String(scheduledUnix);
  }
}

async function publishFeed(opts: { message: string; linkUrl?: string; fbPageId: string; pageToken: string; scheduledUnix?: number }) {
  const params: Record<string, string> = { access_token: opts.pageToken, message: opts.message };
  if (opts.linkUrl) params.link = opts.linkUrl;
  applySchedule(params, opts.scheduledUnix);
  const r = await fbPost<any>(`/${opts.fbPageId}/feed`, params);
  return r.id as string;
}

export async function publishFacebookPost(opts: {
  type: PublishType;
  message: string;
  linkUrl?: string;
  mediaUrls: string[];
  fbPageId: string;
  pageToken: string;
  /** Unix seconds. When set, posts as draft + scheduled_publish_time (Facebook publishes it natively). */
  scheduledUnix?: number;
}): Promise<string> {
  const { type, message, linkUrl, mediaUrls, fbPageId, pageToken, scheduledUnix } = opts;

  if (type === "photo" && mediaUrls[0]) {
    const media = await fetchMediaAsBlob(mediaUrls[0]);
    if (!isFacebookSafePhoto(media.blob, media.filename)) {
      throw new Error(
        `Imagem inválida para o Facebook (${media.filename}, ${(media.blob.size / 1024 / 1024).toFixed(2)}MB, ${media.blob.type || "tipo desconhecido"}). Use JPEG/PNG/GIF até ~3.9MB.`,
      );
    }
    const form = new FormData();
    form.set("access_token", pageToken);
    form.set("caption", message);
    form.set("source", media.blob, media.filename);
    applySchedule(form, scheduledUnix);
    const r = await fbPostMultipart<any>(`/${fbPageId}/photos`, form);
    return r.post_id ?? r.id;
  }

  if (type === "video" && mediaUrls[0]) {
    const media = await fetchMediaAsBlob(mediaUrls[0]);
    const form = new FormData();
    form.set("access_token", pageToken);
    form.set("description", message);
    form.set("source", media.blob, media.filename);
    applySchedule(form, scheduledUnix);
    const r = await fbPostMultipart<any>(`/${fbPageId}/videos`, form);
    return r.post_id ?? r.id;
  }

  return publishFeed({ message, linkUrl, fbPageId, pageToken, scheduledUnix });
}
