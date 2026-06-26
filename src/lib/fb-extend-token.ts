// Tenta estender um Access Token (User OU Page) para a versão long-lived
// usando os Apps configurados no perfil do usuário. Como `fb_exchange_token`
// só funciona com o App emissor do token, tentamos todos os apps configurados
// e ficamos com o primeiro resultado que voltar com expires_in > 60 dias
// (ou simplesmente que voltar válido — Page Tokens emitidos a partir de um
// User Token long-lived NÃO expiram, e o /oauth/access_token nem sempre
// devolve expires_in nesses casos).
//
// Retorna o token estendido + a data de expiração (epoch seconds, 0 = permanente).
import type { SupabaseClient } from "@supabase/supabase-js";
import { fbGet } from "@/lib/fb-graph";

export type ExtendResult = {
  token: string;
  extended: boolean;
  expiresAt: number | null; // epoch seconds; 0 = não expira; null = desconhecido
  error?: string;
};

export async function loadAppCredsForExtend(
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<Array<{ id: string; secret: string }>> {
  const creds: Array<{ id: string; secret: string }> = [];
  const { data: p } = await supabase
    .from("profiles")
    .select("fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2")
    .eq("id", userId)
    .single();
  if (p?.fb_app_id && p.fb_app_secret) creds.push({ id: p.fb_app_id, secret: p.fb_app_secret });
  if (p?.fb_app_id_2 && p.fb_app_secret_2) creds.push({ id: p.fb_app_id_2, secret: p.fb_app_secret_2 });
  if (process.env.FB_APP_ID && process.env.FB_APP_SECRET) {
    if (!creds.some((c) => c.id === process.env.FB_APP_ID)) {
      creds.push({ id: process.env.FB_APP_ID!, secret: process.env.FB_APP_SECRET! });
    }
  }
  return creds;
}

export async function tryExtendToken(
  inputToken: string,
  creds: Array<{ id: string; secret: string }>,
): Promise<ExtendResult> {
  if (creds.length === 0) {
    return { token: inputToken, extended: false, expiresAt: null, error: "Nenhum App configurado em Ajustes" };
  }
  let lastErr = "";
  for (const c of creds) {
    try {
      const r = await fbGet<{ access_token: string; expires_in?: number; token_type?: string }>(
        "/oauth/access_token",
        {
          grant_type: "fb_exchange_token",
          client_id: c.id,
          client_secret: c.secret,
          fb_exchange_token: inputToken,
        },
      );
      if (r?.access_token) {
        const expSec = typeof r.expires_in === "number" && r.expires_in > 0
          ? Math.floor(Date.now() / 1000) + r.expires_in
          : 0; // sem expires_in → tratamos como long-lived/permanente
        return { token: r.access_token, extended: true, expiresAt: expSec };
      }
    } catch (e: any) {
      lastErr = e?.message ?? "falha";
      // Tenta próximo App — só o emissor consegue estender.
    }
  }
  return { token: inputToken, extended: false, expiresAt: null, error: lastErr || "nenhum App emissor encontrado" };
}
