const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

const MAX_FB_PHOTO_BYTES = 3_900_000;
const FB_PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/tiff"]);

type DriveFile = { id: string; name: string; mimeType?: string; thumbnailLink?: string };

function driveHeaders() {
  const lovKey = process.env.LOVABLE_API_KEY;
  const gKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lovKey || !gKey) throw new Error("Conexão com Google Drive não configurada");
  return {
    Authorization: `Bearer ${lovKey}`,
    "X-Connection-Api-Key": gKey,
  };
}

function imageTypeFromName(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "webp") return "image/webp";
  return null;
}

function normalizeImageBlob(blob: Blob, filename: string, fallbackType?: string | null) {
  const inferred = imageTypeFromName(filename);
  const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : (fallbackType ?? inferred ?? blob.type);
  return type && type !== blob.type ? new Blob([blob], { type }) : blob;
}

function thumbnailUrl(url: string) {
  if (/=s\d+/.test(url)) return url.replace(/=s\d+[^&]*/, "=s1600");
  return url;
}

function extractDriveFileId(parsed: URL): string | null {
  if (!parsed.hostname.includes("drive.google.com")) return null;
  const byPath = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1];
  return byPath ?? parsed.searchParams.get("id");
}

async function findDriveFile(filename: string) {
  const q = encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and trashed = false`);
  const fields = "files(id,name,mimeType,thumbnailLink)";
  const url = `${GATEWAY}/files?q=${q}&fields=${fields}&pageSize=5&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  const r = await fetch(url, { headers: driveHeaders() });
  if (!r.ok) throw new Error(`Drive search ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  return (j.files ?? [])[0] as DriveFile | undefined;
}

async function getDriveFile(fileId: string): Promise<DriveFile> {
  const fields = "id,name,mimeType,thumbnailLink";
  const r = await fetch(`${GATEWAY}/files/${fileId}?fields=${fields}&supportsAllDrives=true`, { headers: driveHeaders() });
  if (!r.ok) throw new Error(`Drive metadata ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function downloadDriveFile(file: DriveFile, fallbackName: string) {
  const filename = file.name || fallbackName;
  const dl = await fetch(`${GATEWAY}/files/${file.id}?alt=media&supportsAllDrives=true`, { headers: driveHeaders() });
  if (!dl.ok) throw new Error(`Drive download ${dl.status}: ${await dl.text()}`);
  const raw = await dl.blob();
  const blob = normalizeImageBlob(raw, filename, dl.headers.get("content-type") || file.mimeType);
  if (isFacebookSafePhoto(blob, filename) || !file.thumbnailLink) return { blob, filename };

  const thumb = await fetch(thumbnailUrl(file.thumbnailLink));
  if (!thumb.ok) return { blob, filename };
  const thumbBlob = normalizeImageBlob(await thumb.blob(), `${filename.replace(/\.[^.]+$/, "")}.jpg`, "image/jpeg");
  return isFacebookSafePhoto(thumbBlob, filename) ? { blob: thumbBlob, filename: `${filename.replace(/\.[^.]+$/, "")}.jpg` } : { blob, filename };
}

export function isFacebookSafePhoto(blob: Blob, filename: string) {
  const type = blob.type || imageTypeFromName(filename) || "";
  return blob.size > 0 && blob.size <= MAX_FB_PHOTO_BYTES && FB_PHOTO_TYPES.has(type.toLowerCase());
}

export function isFacebookPhotoUploadFileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /1366046|can't read files|can.t read files|requires upload file|photos should|invalid parameter/i.test(message);
}

export async function fetchMediaAsBlob(mediaUrl: string): Promise<{ blob: Blob; filename: string }> {
  const parsed = new URL(mediaUrl);
  const filename = decodeURIComponent(parsed.pathname.split("/").pop() || `media-${Date.now()}.jpg`);

  const driveFileId = extractDriveFileId(parsed);
  if (driveFileId) return downloadDriveFile(await getDriveFile(driveFileId), filename);

  if (parsed.pathname.includes("/api/public/drive/")) {
    const file = await findDriveFile(filename);
    if (!file) throw new Error(`Arquivo não encontrado no Drive: ${filename}`);
    return downloadDriveFile(file, filename);
  }

  const r = await fetch(mediaUrl);
  if (!r.ok) throw new Error(`Imagem inacessível (${r.status})`);
  const blob = normalizeImageBlob(await r.blob(), filename, r.headers.get("content-type"));
  if (blob.type.includes("text/html")) throw new Error(`URL retornou HTML em vez de imagem: ${mediaUrl}`);
  return { blob, filename };
}