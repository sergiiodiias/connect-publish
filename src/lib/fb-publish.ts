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
    try {
      const media = await fetchMediaAsBlob(mediaUrls[0]);
      if (isFacebookSafePhoto(media.blob, media.filename)) {
        const form = new FormData();
        form.set("access_token", pageToken);
        form.set("caption", message);
        form.set("source", media.blob, media.filename);
        const r = await fbPostMultipart<any>(`/${fbPageId}/photos`, form);
        return r.post_id ?? r.id;
      }
      throw new Error("A imagem não está em um formato/tamanho aceito pelo Facebook");
    } catch (error) {
      if (!message.trim() || !isFacebookPhotoUploadFileError(error)) throw error;
      return publishFeed({ message, linkUrl, fbPageId, pageToken });
    }
  }

  if (type === "video" && mediaUrls[0]) {
    const r = await fbPost<any>(`/${fbPageId}/videos`, {
      access_token: pageToken,
      file_url: mediaUrls[0],
      description: message,
    });
    return r.post_id ?? r.id;
  }

  return publishFeed({ message, linkUrl, fbPageId, pageToken });
}