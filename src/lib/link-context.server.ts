// Faz um GET curto no link para extrair título/descrição (og:title, og:description, <title>).
// Usado para dar contexto à IA gerar comentários variados relacionados ao conteúdo.
// Cache in-memory por URL durante a mesma execução para não repetir fetch no mesmo job.

export type LinkContext = {
  url: string;
  domain: string;
  title: string;
  description: string;
};

const cache = new Map<string, Promise<LinkContext>>();

function pickMeta(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim()).slice(0, 300);
  }
  return "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export async function fetchLinkContext(rawUrl: string): Promise<LinkContext> {
  const url = rawUrl.trim();
  const cached = cache.get(url);
  if (cached) return cached;

  const domain = safeDomain(url);
  const promise = (async (): Promise<LinkContext> => {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; LovableLinkBot/1.0; +https://lovable.dev)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return { url, domain, title: "", description: "" };
      const html = (await res.text()).slice(0, 200_000);
      const title =
        pickMeta(html, [
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
          /<title[^>]*>([^<]+)<\/title>/i,
        ]) || "";
      const description = pickMeta(html, [
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
      ]);
      return { url, domain, title, description };
    } catch {
      return { url, domain, title: "", description: "" };
    }
  })();

  cache.set(url, promise);
  return promise;
}

export function isUrlOnly(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  // sem espaços = considerado URL pura
  return !/\s/.test(t);
}

export function safeDomain(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
