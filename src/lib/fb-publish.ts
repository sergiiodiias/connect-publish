import { fbPost, fbPostMultipart } from "@/lib/fb-graph";
import { fetchMediaAsBlob, isFacebookPhotoUploadFileError, isFacebookSafePhoto } from "@/lib/media-fetch";

type PublishType = "text" | "photo" | "video" | "link";

async function publishFeed(opts: { message: string; linkUrl?: string; fbPageId: string; pageToken: string }) {
  const params: Record<string, string> = { access_token: opts.pageToken, message: opts.message };
  if (opts.linkUrl) params.link = opts.linkUrl;
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
}): Promise<string> {
  const { type, message, linkUrl, mediaUrls, fbPageId, pageToken } = opts;

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
    const r = await fbPostMultipart<any>(`/${fbPageId}/photos`, form);
    return r.post_id ?? r.id;
  }

  if (type === "video" && mediaUrls[0]) {
    const media = await fetchMediaAsBlob(mediaUrls[0]);
    const form = new FormData();
    form.set("access_token", pageToken);
    form.set("description", message);
    form.set("source", media.blob, media.filename);
    const r = await fbPostMultipart<any>(`/${fbPageId}/videos`, form);
    return r.post_id ?? r.id;
  }

  return publishFeed({ message, linkUrl, fbPageId, pageToken });
}