## Problema
A aba **Agenda** mostra `failed` mas não exibe o motivo. O backend já grava o erro em `posts.error` e em `post_targets.error` (por página), mas a UI ignora esses campos — então você não consegue saber se foi token vencido, foto inacessível, página sem permissão etc.

## Plano

### 1. Mostrar o motivo do erro na Agenda
- Em `src/routes/_authenticated/queue.tsx`:
  - Trazer `error` na query de `posts`.
  - Quando `status === "failed"`, exibir o texto de `posts.error` em vermelho abaixo do título.
  - Adicionar um botão **"ver detalhes"** ao lado do badge de status para os posts com falha ou parciais.

### 2. Painel de detalhes por página
- Ao clicar em "ver detalhes", abrir um `Dialog` que busca os `post_targets` daquele post:
  - Nome da página (`fb_pages.name`)
  - Status do target (`pending` / `publishing` / `published` / `failed`)
  - Erro retornado pelo Facebook (`post_targets.error`)
  - `fb_post_id` quando publicado (com link clicável)
- Isso já isola se a falha é de uma página específica (token expirado, sem permissão de post) ou global (mídia inacessível).

### 3. Mensagens de erro mais úteis no servidor
- Em `src/lib/posts.functions.ts` (`publishOneTarget`) e em `src/routes/api/public/cron/scheduler.ts`:
  - Quando o Facebook devolver erro, incluir também `error.code` e `error.error_subcode` no texto salvo em `post_targets.error`. Hoje só salvamos `error.message`, que às vezes vem genérico.
  - Em `src/lib/fb-graph.ts`, montar mensagem `"[code/subcode] message"` para facilitar diagnóstico.

### 4. Botão "Tentar novamente"
- Para posts/targets com status `failed`, adicionar botão **"Tentar novamente"** na Agenda que chama `publishPostNow` de novo (reaproveita lógica existente, que repostará apenas nos targets ainda não publicados — ajustar `publishPostNow` para pular targets com `status='published'`).

### 5. Diagnóstico imediato do erro atual
- Depois do deploy das mudanças acima, abrir a Agenda → clicar em "ver detalhes" no post que falhou → me mandar o texto exato do erro. Aí eu corrijo a causa raiz (ex.: regenerar token da página, foto não acessível publicamente, tipo de conteúdo bloqueado, etc.).

## Fora de escopo
- Renovação automática de tokens de página
- Reprocessamento em massa de falhas
