// Gera variações de mensagem via Lovable AI Gateway, preservando o significado.
// Usado pelo bulk-upload para criar automaticamente títulos/comentários variados
// por blocos de páginas, sem exigir que o usuário escreva spintax manual.

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

function stripJsonFence(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return t;
}

/** Gera `count` variações da mensagem base. Retorna array com [original, ...variações]. */
export async function generateMessageVariants(
  base: string,
  count: number,
  kind: "post" | "comment" = "post",
): Promise<string[]> {
  const original = (base ?? "").trim();
  if (!original || count <= 1) return [original];

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return [original];

  const need = Math.max(1, Math.min(count - 1, 40));
  const kindHint =
    kind === "comment"
      ? "É um comentário curto de Facebook (mantenha links intactos)."
      : "É uma legenda/post de Facebook.";

  const system =
    "Você gera variações naturais do mesmo texto para postar em várias páginas do Facebook sem cair em detecção de duplicidade. " +
    "Preserve o significado, o idioma (pt-BR se aplicável), emojis e QUALQUER URL/link exatamente como está. " +
    "Varie a ordem das frases, sinônimos, pontuação leve e emojis. Não invente informações novas. Não use hashtags a mais. " +
    "Responda SOMENTE com JSON válido no formato {\"variants\":[\"...\",\"...\"]}, sem markdown.";

  const user =
    `${kindHint}\nTexto base:\n"""${original}"""\n\n` +
    `Gere ${need} variações diferentes entre si e diferentes do texto base. Nenhuma pode alterar links, preços ou dados.`;

  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.warn(`[ai-variants] status ${res.status}`);
      return [original];
    }
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(stripJsonFence(String(content)));
    const raw = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const cleaned = raw
      .map((v: any) => (typeof v === "string" ? v.trim() : ""))
      .filter((v: string) => v.length > 0);
    // Dedup mantendo o original na frente.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of [original, ...cleaned]) {
      const key = v.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= count) break;
    }
    return out.length ? out : [original];
  } catch (e: any) {
    console.warn(`[ai-variants] erro: ${e?.message ?? e}`);
    return [original];
  }
}
