// Delay adaptativo: lê o pior x-app-usage observado recentemente (por usuário
// ou global) e devolve um multiplicador para escalar cooldowns/intervalos.
//
// Regras:
// - < 60%  → 1x  (normal)
// - 60-80% → 2x  (cautela)
// - 80-90% → 4x  (freio)
// - >= 90% → 8x + throttle=true  (praticamente pausa; scheduler pula publicação
//   agressiva e só processa comentários já em fila)

export type AdaptiveState = {
  pct: number;
  multiplier: number;
  throttle: boolean;
  hardStop: boolean; // true quando >= 95% — evitar QUALQUER chamada não-crítica
};

export function multiplierFor(pct: number): AdaptiveState {
  if (!Number.isFinite(pct) || pct < 0) pct = 0;
  if (pct >= 95) return { pct, multiplier: 12, throttle: true, hardStop: true };
  if (pct >= 90) return { pct, multiplier: 8, throttle: true, hardStop: false };
  if (pct >= 80) return { pct, multiplier: 4, throttle: false, hardStop: false };
  if (pct >= 60) return { pct, multiplier: 2, throttle: false, hardStop: false };
  return { pct, multiplier: 1, throttle: false, hardStop: false };
}

/** Consulta o pior x-app-usage global (todos os usuários) atualizado nos últimos 15 min. */
export async function getGlobalAdaptiveState(): Promise<AdaptiveState> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data } = await (supabaseAdmin as any)
      .from("fb_app_usage")
      .select("max_pct")
      .gte("updated_at", cutoff)
      .order("max_pct", { ascending: false })
      .limit(1);
    const pct = data?.[0]?.max_pct ?? 0;
    return multiplierFor(pct);
  } catch {
    return multiplierFor(0);
  }
}
