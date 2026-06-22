# Plano: SaaS de Publicação em Páginas do Facebook

## Visão geral
Aplicação para conectar Páginas do Facebook via Access Token (Graph API), publicar em massa, agendar, rotacionar conteúdo, comentar automaticamente e gerenciar grupos de páginas.

## Fase 1 — Fundação (esta entrega)
Vou começar pelo núcleo funcional. Recursos avançados (webhooks, API interna, rotação por tipo) ficam para fases seguintes para evitar um build gigante e instável.

1. **Backend (Lovable Cloud)**
   - Habilitar Lovable Cloud (banco + auth + storage + server functions).
   - Tabelas: `profiles`, `user_roles` (admin/user), `fb_pages` (token criptografado por env), `page_groups`, `page_group_members`, `posts` (rascunho/agendado/publicado/falhou), `post_targets` (post × página + fb_post_id), `auto_comments` (com delay), `media_assets`, `activity_logs`.
   - RLS por `auth.uid()` em todas as tabelas; `has_role()` security definer.
   - Bucket `media` (privado) para imagens/vídeos.

2. **Auth**
   - Email/senha + Google (broker Lovable).
   - Rota `/auth`, `/reset-password`, layout `_authenticated`.

3. **Integração Graph API** (server functions, nunca no cliente)
   - `connectPage` — valida token via `GET /me/accounts` ou `/{page-id}?fields=access_token,name`.
   - `publishToPage` — texto, foto (`/photos`), vídeo (`/videos`), link.
   - `schedulePost` — `scheduled_publish_time` + `published=false`.
   - `commentOnPost` — `/{post-id}/comments` com delay via fila.
   - `bulkPublish` — fan-out para N páginas.
   - Tratamento de erros Graph (rate limit, token expirado).

4. **Agendador**
   - Server route `/api/public/cron/run-scheduler` protegida por `CRON_SECRET`, chamada por pg_cron a cada minuto.
   - Processa `posts` com `scheduled_at <= now()` e `auto_comments` pendentes respeitando delay.

5. **UI (tema escuro, moderno)**
   - Dashboard: contadores em tempo real (agendados, publicados hoje, falhas).
   - Páginas conectadas: listar, conectar nova (modal cola token), testar token, remover.
   - Grupos de páginas: criar grupo e selecionar membros (publicação simultânea).
   - Composer: texto + upload de mídia + seleção de páginas/grupos + agendar + auto-comentário com delay.
   - Fila/Agenda: calendário + lista filtrável (status, página, tag, data).
   - Histórico/Logs: tabela com busca global e filtros.
   - Configurações: perfil, secrets.

## Fase 2 (depois)
Rotação automática de conteúdo (texto/imagem/vídeo separados), upload múltiplo de vídeos, webhooks de saída, API interna com chaves, sistema de tags avançado, painel admin.

## Detalhes técnicos
- Stack: TanStack Start + React 19 + Tailwind v4 + shadcn + Lovable Cloud (Supabase).
- Access Tokens armazenados criptografados (pgcrypto) com chave em secret `FB_TOKEN_ENC_KEY`.
- Todas as chamadas Graph em `createServerFn` com `requireSupabaseAuth`; nunca expor token no browser.
- Fila implementada como tabela + cron (sem dependência externa).
- Versão da Graph API fixada (ex.: `v21.0`).

## Perguntas antes de implementar
1. **Escopo desta entrega**: começo pela Fase 1 completa (auth + conectar páginas + publicar + agendar + auto-comentário + grupos + dashboard)? Ou prefere ainda menor (só conectar página + publicar agora)?
2. **Autenticação dos usuários**: email/senha + Google, ou só email/senha?
3. **Como o usuário fornecerá o token da Página?** Colar Page Access Token de longa duração manualmente (mais simples, sem OAuth Facebook), ou quer login OAuth via Facebook (exige App revisado pela Meta — fora do escopo do Lovable Cloud nativo, requer config manual no Supabase)?
4. **Tema visual**: dark moderno tipo Linear/Vercel (cinzas + um accent), ou tem paleta/branding específico em mente?

Responda essas e eu ajusto e parto para a implementação.