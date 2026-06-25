// Centralized Graph API helpers — server-only side effects, but pure helpers.
export const FB_GRAPH = "https://graph.facebook.com/v21.0";

export type FbErr = { message: string; type?: string; code?: number; error_subcode?: number };
const FB_TIMEOUT_MS = 25_000;

// Códigos do Facebook que indicam rate-limit / throttling temporário.
// https://developers.facebook.com/docs/graph-api/overview/rate-limiting
const RATE_LIMIT_CODES = new Set([1, 2, 4, 17, 32, 368, 613]);
const MAX_RETRIES = 3;

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

function isRateLimit(json: any, status: number): boolean {
  if (status === 429) return true;
  const code = json?.error?.code;
  return typeof code === "number" && RATE_LIMIT_CODES.has(code);
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Fetch com retry exponencial em rate-limit (1s, 2s, 4s + jitter ±20%).
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempt = 0,
): Promise<{ res: Response; json: any }> {
  const res = await fetch(url, init);
  let json: any = null;
  try { json = await res.json(); } catch { json = {}; }
  if (res.ok && !json?.error) return { res, json };
  if (attempt < MAX_RETRIES && isRateLimit(json, res.status)) {
    const base = 1000 * Math.pow(2, attempt);
    const jitter = base * (0.8 + Math.random() * 0.4);
    console.warn(`[fb] rate-limit (status=${res.status} code=${json?.error?.code}), retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(jitter)}ms`);
    await sleep(jitter);
    return fetchWithRetry(url, init, attempt + 1);
  }
  return { res, json };
}

export type AppUsage = {
  call_count: number;
  total_time: number;
  total_cputime: number;
  max: number;
};

export function parseAppUsage(headers: Headers): AppUsage | null {
  const raw = headers.get("x-app-usage");
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    const call = typeof u.call_count === "number" ? u.call_count : 0;
    const time = typeof u.total_time === "number" ? u.total_time : 0;
    const cpu = typeof u.total_cputime === "number" ? u.total_cputime : 0;
    if (call === 0 && time === 0 && cpu === 0 && !("call_count" in u)) return null;
    return { call_count: call, total_time: time, total_cputime: cpu, max: Math.max(call, time, cpu) };
  } catch { return null; }
}

export async function fbGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const { res, json } = await fetchWithRetry(url.toString(), { signal: timeoutSignal() });
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph GET ${path} ${res.status}`));
  return json;
}

export async function fbGetWithUsage<T = any>(path: string, params: Record<string, string>): Promise<{ data: T; usage: AppUsage | null }> {
  const url = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const { res, json } = await fetchWithRetry(url.toString(), { signal: timeoutSignal() });
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
  const { res, json } = await fetchWithRetry(FB_GRAPH + path, { method: "POST", body, signal: timeoutSignal() });
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph POST ${path} ${res.status}`));
  return json;
}

export async function fbPostMultipart<T = any>(path: string, form: FormData): Promise<T> {
  // multipart não retorna JSON consistente em erro de rate-limit; chamada única sem retry.
  const res = await fetch(FB_GRAPH + path, { method: "POST", body: form, signal: timeoutSignal(45_000) });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph multipart POST ${path} ${res.status}`));
  return json;
}

export async function fbDelete<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = FB_GRAPH + path + "?" + new URLSearchParams(params).toString();
  const { res, json } = await fetchWithRetry(url, { method: "DELETE", signal: timeoutSignal() });
  if (!res.ok || json.error) throw new Error(fmtErr(json, `Graph DELETE ${path} ${res.status}`));
  return json;
}
