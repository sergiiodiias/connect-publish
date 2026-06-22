// Centralized Graph API helpers — server-only side effects, but pure helpers.
export const FB_GRAPH = "https://graph.facebook.com/v21.0";

export type FbErr = { message: string; type?: string; code?: number };

export async function fbGet<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Graph GET ${path} ${res.status}`);
  return json;
}

export async function fbPost<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(FB_GRAPH + path, { method: "POST", body });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Graph POST ${path} ${res.status}`);
  return json;
}
