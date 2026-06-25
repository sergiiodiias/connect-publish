import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { allAppsSaturated, USAGE_THRESHOLD, type UsageMap } from "@/lib/fb-app-creds";

export type EndpointStat = { endpoint: string; count: number; last_at: string | null };
export type ApiUsageStats = {
  today: EndpointStat[];
  last7d: EndpointStat[];
  totals: { today: number; last7d: number };
  apps: {
    app1: { configured: boolean; pct: number; call_count?: number; total_time?: number; total_cputime?: number; ts?: number };
    app2: { configured: boolean; pct: number; call_count?: number; total_time?: number; total_cputime?: number; ts?: number };
  };
  economyMode: boolean;
  threshold: number;
};

const ENDPOINT_LABELS: Record<string, string> = {
  debug_token: "Verificar token (debug_token)",
  exchange_token: "Renovar token (oauth/access_token)",
  publish_feed: "Publicar texto/link (/feed)",
  publish_photo: "Publicar foto (/photos)",
  publish_video: "Publicar vídeo (/videos)",
  publish_comment: "Comentário (/comments)",
  delete: "Deletar post (DELETE)",
  insights: "Métricas (/insights)",
  read_post: "Ler post",
  list_posts: "Listar posts (/posts)",
  list_photos: "Listar fotos",
  list_videos: "Listar vídeos",
  list_scheduled: "Listar agendados",
  list_comments: "Listar comentários",
  page_meta: "Dados da página (/me, /picture)",
  me_accounts: "Listar páginas (/me/accounts)",
  other: "Outras chamadas",
};

export function labelForEndpoint(endpoint: string): string {
  return ENDPOINT_LABELS[endpoint] ?? endpoint;
}

export const getApiCallStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApiUsageStats> => {
    const { supabase, userId } = context;

    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: rows } = await (supabase as any)
      .from("fb_api_calls")
      .select("day, endpoint, count, last_at")
      .gte("day", since)
      .eq("user_id", userId);

    const todayMap = new Map<string, EndpointStat>();
    const weekMap = new Map<string, EndpointStat>();
    let todayTotal = 0;
    let weekTotal = 0;
    for (const r of (rows ?? []) as any[]) {
      const entry = weekMap.get(r.endpoint) ?? { endpoint: r.endpoint, count: 0, last_at: null };
      entry.count += r.count;
      if (!entry.last_at || (r.last_at && r.last_at > entry.last_at)) entry.last_at = r.last_at;
      weekMap.set(r.endpoint, entry);
      weekTotal += r.count;
      if (r.day === today) {
        const t = todayMap.get(r.endpoint) ?? { endpoint: r.endpoint, count: 0, last_at: null };
        t.count += r.count;
        if (!t.last_at || (r.last_at && r.last_at > t.last_at)) t.last_at = r.last_at;
        todayMap.set(r.endpoint, t);
        todayTotal += r.count;
      }
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2, fb_app_usage")
      .eq("id", userId)
      .single();
    const usage = (profile?.fb_app_usage ?? {}) as UsageMap;
    const hasApp1 = !!(profile?.fb_app_id && profile?.fb_app_secret);
    const hasApp2 = !!(profile?.fb_app_id_2 && profile?.fb_app_secret_2);
    const economyMode = allAppsSaturated(usage, hasApp1, hasApp2);

    return {
      today: Array.from(todayMap.values()).sort((a, b) => b.count - a.count),
      last7d: Array.from(weekMap.values()).sort((a, b) => b.count - a.count),
      totals: { today: todayTotal, last7d: weekTotal },
      apps: {
        app1: { configured: hasApp1, pct: usage.app1?.pct ?? 0, ...usage.app1 },
        app2: { configured: hasApp2, pct: usage.app2?.pct ?? 0, ...usage.app2 },
      },
      economyMode,
      threshold: USAGE_THRESHOLD,
    };
  });
