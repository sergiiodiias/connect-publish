// Centralized Graph API helpers — server-only side effects, but pure helpers.
export const FB_GRAPH = "https://graph.facebook.com/v21.0";

export type FbErr = { message: string; type?: string; code?: number; error_subcode?: number };

function fmtErr(json: any, fallback: string): string {
  const e = json?.error;
  if (!e) return fallback;
  const tag = [e.code, e.error_subcode].filter(Boolean).join("/");
  return tag ? `[${tag}] ${e.message ?? fallback}` : (e.message ?? fallback);
}

export async function fbGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph GET ${path} ${res.status}`));
  return json;
}

export async function fbPost<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(FB_GRAPH + path, { method: "POST", body });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph POST ${path} ${res.status}`));
  return json;
}

export async function fbPostMultipart<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(FB_GRAPH + path, { method: "POST", body: form });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph multipart POST ${path} ${res.status}`));
  return json;
}
