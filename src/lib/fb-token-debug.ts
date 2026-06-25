import { fbGetWithUsage, type AppUsage } from "@/lib/fb-graph";

export type FacebookDebugCred = { slot: 1 | 2; appId: string; appSecret: string };

export type FacebookTokenDebugResult = {
  data: any;
  appId: string | null;
  slot: 1 | 2 | null;
  usage: AppUsage | null;
  errors: string[];
};

const RECONNECT_SUBCODES: Record<number, string> = {
  458: "App removido pelo usuário",
  459: "Usuário fez checkpoint de segurança",
  460: "Senha do usuário foi trocada",
  463: "Token expirado",
  464: "Usuário não confirmado",
  466: "Token revogado pelo usuário",
  467: "Token inválido",
  490: "Sessão invalidada",
  492: "Sessão inválida",
};

export function normalizeFacebookExpiresAt(debugData: any): number | null {
  if (typeof debugData?.expires_at === "number") return debugData.expires_at;
  // Para Page Tokens, o Facebook muitas vezes não devolve expires_at; se o token
  // está válido, tratamos como longa duração para não ficar "desconhecido".
  if (debugData?.is_valid) return 0;
  return null;
}

export function reconnectReasonFromDebugError(error: any): string | null {
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode = typeof error?.subcode === "number" ? error.subcode : typeof error?.error_subcode === "number" ? error.error_subcode : null;
  if (code === 190 && subcode && RECONNECT_SUBCODES[subcode]) return RECONNECT_SUBCODES[subcode];
  return null;
}

export async function debugFacebookToken(inputToken: string, creds: FacebookDebugCred[]): Promise<FacebookTokenDebugResult> {
  const uniqueCreds = creds.filter((cred, index, all) => cred.appId && cred.appSecret && all.findIndex((x) => x.appId === cred.appId) === index);
  const errors: string[] = [];
  let firstResult: FacebookTokenDebugResult | null = null;

  for (const cred of uniqueCreds) {
    try {
      const { data, usage } = await fbGetWithUsage<any>("/debug_token", {
        input_token: inputToken,
        access_token: `${cred.appId}|${cred.appSecret}`,
      });
      const d = data?.data ?? {};
      const result = { data: d, appId: d.app_id ? String(d.app_id) : cred.appId, slot: cred.slot, usage, errors };
      if (d.is_valid) return result;
      firstResult ??= result;
    } catch (e: any) {
      errors.push(`App ${cred.slot}: ${e?.message ?? "falha ao verificar"}`);
    }
  }

  if (firstResult) return firstResult;

  try {
    const { data, usage } = await fbGetWithUsage<any>("/debug_token", {
      input_token: inputToken,
      access_token: inputToken,
    });
    const d = data?.data ?? {};
    return { data: d, appId: d.app_id ? String(d.app_id) : null, slot: null, usage, errors };
  } catch (e: any) {
    errors.push(e?.message ?? "falha ao verificar");
    const err: any = new Error(errors.join(" | "));
    err.debugErrors = errors;
    throw err;
  }
}