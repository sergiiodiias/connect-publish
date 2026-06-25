// Centralized Graph API helpers — server-only side effects, but pure helpers.
export const FB_GRAPH = "https://graph.facebook.com/v21.0";

export type FbErr = { message: string; type?: string; code?: number; error_subcode?: number };
const FB_TIMEOUT_MS = 25_000;

function timeoutSignal(ms = FB_TIMEOUT_MS) {
  const timeout = (AbortSignal as any).timeout as ((ms: number) => AbortSignal) | undefined;
  if (timeout) return timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function fmtErr(json: any, fallback: string): string {
  const e = json?.error;
  if (!e) return fallback;
  const tag = [e.code, e.error_subcode].filter(Boolean).join("/");
  return tag ? `[${tag}] ${e.message ?? fallback}` : (e.message ?? fallback);
}

export function parseAppUsage(headers: Headers): number | null {
  const raw = headers.get("x-app-usage");
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    const vals = [u.call_count, u.total_cputime, u.total_time].filter((n) => typeof n === "number");
    if (!vals.length) return null;
    return Math.max(...vals);
  } catch { return null; }
}

export async function fbGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: timeoutSignal() });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph GET ${path} ${res.status}`));
  return json;
}

export async function fbGetWithUsage<T = any>(path: string, params: Record<string, string>): Promise<{ data: T; usage: number | null }> {
  const url = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: timeoutSignal() });
  const json: any = await res.json();
  const usage = parseAppUsage(res.headers);
  if (!res.ok || json.error) {
    const err: any = new Error(fmtErr(json, `Graph GET ${path} ${res.status}`));
    err.usage = usage;
    throw err;
  }
  return { data: json as T, usage };
}

export async function fbPost<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(FB_GRAPH + path, { method: "POST", body, signal: timeoutSignal() });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph POST ${path} ${res.status}`));
  return json;
}

export async function fbPostMultipart<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(FB_GRAPH + path, { method: "POST", body: form, signal: timeoutSignal(45_000) });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph multipart POST ${path} ${res.status}`));
  return json;
}

export async function fbDelete<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = FB_GRAPH + path + "?" + new URLSearchParams(params).toString();
  const res = await fetch(url, { method: "DELETE", signal: timeoutSignal() });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph DELETE ${path} ${res.status}`));
  return json;
}
