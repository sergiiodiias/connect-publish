# Plano — Reduzir limitações em comentários e títulos

## Objetivo
Parar de postar o mesmo link "pelado" repetido em N páginas (principal gatilho dos erros #368) e girar títulos/comentários por grupo, sem exigir que você escreva variações manualmente.

## 1. Comentário = texto contextual + link (não só link)

Hoje `commentLink` é usado como se fosse o texto do comentário, então o Facebook vê N páginas comentando exatamente a mesma URL. Vamos:

- Detectar automaticamente se `commentLink` é apenas uma URL.
- Se for, chamar a IA (Lovable AI Gateway, `google/gemini-2.5-flash-lite`) uma vez por link para:
  1. Baixar o título/descrição do link (fetch + parse `<title>` e `<meta og:*>`), com timeout curto e fallback pro domínio.
  2. Gerar N frases curtas (1-2 linhas, pt-BR, com emojis leves) **relacionadas ao conteúdo** do link — N = nº de blocos de páginas.
- Montar cada comentário como `"<frase variada>\n<link>"` (link sempre íntegro, nunca reescrito).
- Se `commentLink` já for texto+link, mantemos o fluxo atual (só variamos o texto ao redor, preservando qualquer URL).

Arquivos: novo `src/lib/link-context.server.ts` (fetch + og-scrape), ajuste em `src/lib/ai-variants.server.ts` (novo modo `"comment-with-link"` recebendo `{ link, context }`), e em `src/lib/bulk-upload.functions.ts` para chamar esse caminho quando o input for URL pura.

## 2. Rotação de títulos por grupo

Já geramos variações por bloco de `rotateEveryPages` (default 10). Vamos:

- Reduzir default para **5 páginas por variação** (mais seguro contra deduplicação do FB).
- Garantir que cada bloco receba variação **diferente do bloco anterior** (dedupe por hash antes de escolher).
- Expor `rotateEveryPages` como campo no importador (se ainda não estiver visível) com valores sugeridos 5/10/20.

## 3. Salvaguardas por página (runtime, no scheduler)

No `src/routes/api/public/cron/scheduler.ts`:

- **Máx. 1 comentário por página a cada 30 min** (hoje é 3-5 min). Página que acabou de comentar entra em cooldown maior.
- **Máx. 20 comentários/página/dia** por padrão (configurável). Ao atingir, pula pro próximo dia.
- Ao pegar erro #368 numa página, **cooldown escalonado**: 1ª ocorrência 2h, 2ª 12h, 3ª 24h (hoje já tem `comment_368_count`, vamos usar).
- Nunca postar o **mesmo link** na mesma página em menos de 24h (checar `auto_comments` publicados recentes por `page_id` + `link`).

## 4. Sugestões extras (aplico se aprovar)

- **Warm-up de páginas novas**: página com <7 dias no sistema fica limitada a 5 comentários/dia.
- **Alternar tipos de post** (foto/vídeo/link) automaticamente por bloco — variedade reduz sinal de spam.
- **Delay adaptativo**: se `x-app-usage` do FB passar de 70%, dobra automaticamente os intervalos até a próxima janela.
- **Painel "Saúde das páginas"** simples em `/pages` mostrando: cooldown ativo, últimos #368, comentários hoje.

## Detalhes técnicos

- Fetch de metadados do link com `AbortSignal.timeout(4000)`, User-Agent de browser, cache in-memory por hostname+path para não repetir dentro do mesmo job.
- Prompt da IA recebe título + descrição + domínio do link e instrui: "gere N frases curtas em pt-BR relacionadas a esse conteúdo, sem repetir a URL, sem hashtags, sem promessas exageradas".
- Validação: se a IA gerar frase que contenha URL diferente da original, descarta.
- Todo o cálculo de cooldown/limites por página fica no scheduler (afeta os 6k+ itens já agendados, não só novos).

## Arquivos afetados

- `src/lib/link-context.server.ts` (novo)
- `src/lib/ai-variants.server.ts` (novo modo)
- `src/lib/bulk-upload.functions.ts` (montagem texto+link, rotateEvery=5)
- `src/routes/api/public/cron/scheduler.ts` (cooldown 30min, cap diário, dedupe de link/página, backoff #368 escalonado)
- Migração SQL adicionando colunas `daily_comment_count`, `daily_comment_reset_at` em `fb_pages` se necessário
- (Opcional) `src/routes/_authenticated/pages.tsx` — coluna de saúde

## Confirmar antes de implementar

1. **Cap diário por página**: 20/dia OK ou prefere outro valor?
2. **Cooldown entre comentários da mesma página**: 30 min OK?
3. Implemento também as **Sugestões extras** (warm-up, alternância de tipo, delay adaptativo, painel de saúde) ou só o núcleo (1-3)?
