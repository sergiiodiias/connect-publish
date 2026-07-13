// Diversifica mensagens de auto_comments pendentes que estão todas iguais.
// Roda no início do cron: qualquer grupo (post_id, mensagem) com N>=2 rows
// recebe N frases diferentes (via generateLinkComments) mantendo o LINK original.
// Fallback determinístico já garante variação mesmo sem chave de IA.

import { generateLinkComments } from "./ai-variants.server";
import { fetchLinkContext } from "./link-context.server";

type SupabaseLike = any;

function extractUrl(msg: string): string | null {
  const m = msg?.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function diversifyPendingComments(
  supabaseAdmin: SupabaseLike,
  opts: { maxRows?: number; maxGroups?: number } = {},
): Promise<{ diversified: number; groups: number }> {
  const maxRows = opts.maxRows ?? 400;
  const maxGroups = opts.maxGroups ?? 20;

  // Pega comentários pendentes já instanciados (target_id != null) e ainda não postados.
  const { data: rows } = await supabaseAdmin
    .from("auto_comments")
    .select("id, message, post_id")
    .eq("status", "pending")
    .not("target_id", "is", null)
    .is("fb_comment_id", null)
    .limit(maxRows);

  if (!rows?.length) return { diversified: 0, groups: 0 };

  // Agrupa por (post_id, message) — mesmo post + mesmo texto = duplicidade real.
  type Group = { key: string; postId: string; message: string; ids: string[] };
  const groups = new Map<string, Group>();
  for (const r of rows as any[]) {
    const key = `${r.post_id}::${r.message}`;
    const g = groups.get(key) ?? { key, postId: r.post_id, message: r.message, ids: [] };
    g.ids.push(r.id);
    groups.set(key, g);
  }

  let diversified = 0;
  let processedGroups = 0;

  for (const g of groups.values()) {
    if (processedGroups >= maxGroups) break;
    if (g.ids.length < 2) continue;

    const url = extractUrl(g.message);
    if (!url) continue;

    processedGroups++;

    let ctx: { url: string; domain: string; title: string; description: string };
    try {
      ctx = await fetchLinkContext(url);
    } catch {
      let domain = "";
      try { domain = new URL(url).hostname; } catch {}
      ctx = { url, domain, title: "", description: "" };
    }

    const phrases = shuffle(await generateLinkComments(ctx, g.ids.length));
    // Precisa ter pelo menos 2 frases distintas para valer a pena atualizar.
    const distinct = new Set(phrases.map((p) => p.trim().toLowerCase())).size;
    if (distinct < 2) continue;

    const shuffledIds = shuffle(g.ids);
    for (let i = 0; i < shuffledIds.length; i++) {
      const phrase = phrases[i % phrases.length];
      const newMsg = `${phrase}\n${url}`;
      if (newMsg === g.message) continue;
      const { error } = await supabaseAdmin
        .from("auto_comments")
        .update({ message: newMsg })
        .eq("id", shuffledIds[i]);
      if (!error) diversified++;
    }
  }

  return { diversified, groups: processedGroups };
}
