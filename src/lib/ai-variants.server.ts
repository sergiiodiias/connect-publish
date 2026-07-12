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

/**
 * Gera `count` textos curtos de comentário relacionados ao conteúdo de um link.
 * Retorna apenas o TEXTO (sem a URL) — o chamador concatena "<texto>\n<link>".
 * Se a IA falhar, cai num pool determinístico de frases neutras.
 */
export async function generateLinkComments(
  ctx: { url: string; domain: string; title: string; description: string },
  count: number,
): Promise<string[]> {
  const need = Math.max(1, Math.min(count, 40));
  const apiKey = process.env.LOVABLE_API_KEY;
  const fallback = buildFallbackLinkComments(ctx, need);
  if (!apiKey) return fallback;

  const contextBlock = [
    ctx.title ? `Título: ${ctx.title}` : "",
    ctx.description ? `Descrição: ${ctx.description}` : "",
    ctx.domain ? `Domínio: ${ctx.domain}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "Você escreve chamadas curtas em pt-BR (1 a 2 linhas) para acompanhar um LINK no primeiro comentário de posts do Facebook. " +
    "Regras: nunca inclua nenhuma URL, nunca invente dados, sem hashtags, sem promessas exageradas (nada de 'garantido', 'imperdível', 'clique já'). " +
    "Varie estrutura, sinônimos, ordem das frases e emojis (no máximo 2 por frase, opcionais). " +
    "As frases devem ter a ver com o assunto do link. Se o assunto for desconhecido, escreva algo neutro e curioso. " +
    "Responda SOMENTE com JSON válido {\"variants\":[\"...\",\"...\"]}, sem markdown.";

  const user =
    `Contexto do link (para inspiração — NÃO cite a URL):\n${contextBlock || "(sem metadados)"}\n\n` +
    `Gere ${need} frases diferentes entre si, no máximo 180 caracteres cada. ` +
    `A frase deve fazer sentido antes de aparecer o link em uma nova linha.`;

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
    if (!res.ok) return fallback;
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(stripJsonFence(String(content)));
    const raw = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const cleaned = raw
      .map((v: any) => (typeof v === "string" ? v.trim() : ""))
      // remove qualquer URL que a IA tenha inventado
      .map((v: string) => v.replace(/https?:\/\/\S+/gi, "").trim())
      .filter((v: string) => v.length > 0 && v.length <= 220);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of cleaned) {
      const key = v.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= need) break;
    }
    if (out.length < need) {
      for (const f of fallback) {
        const key = f.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
        if (out.length >= need) break;
      }
    }
    return out.length ? out : fallback;
  } catch (e: any) {
    console.warn(`[ai-variants] link-comments erro: ${e?.message ?? e}`);
    return fallback;
  }
}

function buildFallbackLinkComments(
  ctx: { title: string; domain: string },
  count: number,
): string[] {
  const subject = ctx.title || ctx.domain || "isso";
  const base = [
    `Achei interessante e deixo aqui pra quem quiser conferir 👇`,
    `Dá uma olhada nisso: ${subject} 👇`,
    `Vale a leitura, tá bem completo 👀`,
    `Segue o link pra quem quiser se aprofundar 🔎`,
    `Compartilhando pra ajudar quem procura sobre ${subject} 💡`,
    `Encontrei esse material sobre ${subject}, olha só 👇`,
    `Deixando registrado aqui embaixo pra conferirem 📌`,
    `Achei útil, pode ser que sirva pra vocês também ✨`,
    `Passando pra deixar essa referência 👇`,
    `Se interessou? Tá tudo aqui embaixo 👇`,
  ];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(base[i % base.length]);
  return out;
}

