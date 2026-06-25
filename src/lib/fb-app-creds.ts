// Helper para escolher entre o App #1 e o App #2 do Facebook configurados no perfil,
// com base no uso reportado pelo header X-App-Usage (Facebook Platform Rate Limits).
// O slot com menor uso (abaixo do limite) é preferido. Atualiza o JSON `fb_app_usage`
// no perfil após cada chamada que retorna usage — agora com granularidade
// (call_count, total_time, total_cputime) além do máximo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUsage } from "@/lib/fb-graph";

export const USAGE_THRESHOLD = 80; // %
export type AppSlot = 1 | 2;
export type AppCreds = { slot: AppSlot; appId: string; appSecret: string } | null;

export type UsageEntry = {
  pct: number;          // == max (compat com versão antiga)
  call_count?: number;
  total_time?: number;
  total_cputime?: number;
  ts: number;
};
export type UsageMap = Partial<Record<"app1" | "app2", UsageEntry>>;

export async function getAppCredsForUser(
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<AppCreds> {
  const { data: p } = await supabase
    .from("profiles")
    .select("fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2, fb_app_usage")
    .eq("id", userId)
    .single();

  const slots: { slot: AppSlot; appId: string; appSecret: string; usage: number }[] = [];
  const usage = (p?.fb_app_usage ?? {}) as UsageMap;
  if (p?.fb_app_id && p.fb_app_secret) {
    slots.push({ slot: 1, appId: p.fb_app_id, appSecret: p.fb_app_secret, usage: usage.app1?.pct ?? 0 });
  }
  if (p?.fb_app_id_2 && p.fb_app_secret_2) {
    slots.push({ slot: 2, appId: p.fb_app_id_2, appSecret: p.fb_app_secret_2, usage: usage.app2?.pct ?? 0 });
  }
  if (slots.length === 0) {
    const envId = process.env.FB_APP_ID;
    const envSecret = process.env.FB_APP_SECRET;
    if (envId && envSecret) return { slot: 1, appId: envId, appSecret: envSecret };
    return null;
  }
  const below = slots.filter((s) => s.usage < USAGE_THRESHOLD);
  const pool = below.length ? below : slots;
  pool.sort((a, b) => a.usage - b.usage);
  return { slot: pool[0].slot, appId: pool[0].appId, appSecret: pool[0].appSecret };
}

// True quando TODOS os apps configurados estão ≥ threshold (modo econômico).
export function allAppsSaturated(usage: UsageMap, hasApp1: boolean, hasApp2: boolean, threshold = USAGE_THRESHOLD): boolean {
  const apps: number[] = [];
  if (hasApp1) apps.push(usage.app1?.pct ?? 0);
  if (hasApp2) apps.push(usage.app2?.pct ?? 0);
  if (apps.length === 0) return false;
  return apps.every((p) => p >= threshold);
}

export function buildUsageEntry(u: AppUsage | null): UsageEntry | null {
  if (!u) return null;
  return { pct: u.max, call_count: u.call_count, total_time: u.total_time, total_cputime: u.total_cputime, ts: Date.now() };
}

export async function recordAppUsage(
  supabase: SupabaseClient<any>,
  userId: string,
  slot: AppSlot,
  usage: AppUsage | null,
): Promise<void> {
  const entry = buildUsageEntry(usage);
  if (!entry) return;
  const { data: p } = await supabase
    .from("profiles").select("fb_app_usage").eq("id", userId).single();
  const next = { ...(p?.fb_app_usage ?? {}) } as UsageMap;
  const key = slot === 1 ? "app1" : "app2";
  next[key] = entry;
  await supabase.from("profiles").update({ fb_app_usage: next }).eq("id", userId);
}
