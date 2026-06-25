# Melhorias: Resiliência, UX e Segurança dos Tokens

## 1. Resiliência

### 1.1 Backoff exponencial para rate-limit
- Em `src/lib/fb-graph.ts`, criar `fetchWithRetry` que detecta os códigos de rate-limit do Facebook (`1`, `2`, `4`, `17`, `32`, `613`, `368`) e refaz a chamada com espera **1s → 2s → 4s → 8s** (máx. 3 retentativas, com jitter aleatório de ±20%).
- `fbGet`, `fbGetWithUsage`, `fbPost`, `fbDelete` passam a usar esse helper.
- Erros que NÃO são rate-limit (token inválido, permissão, etc.) continuam falhando imediatamente.

### 1.2 X-App-Usage granular
- `parseAppUsage` passa a retornar `{ call_count, total_time, total_cputime, max }` em vez de só o máximo.
- `fb_app_usage` no perfil guarda as três métricas por slot:
  ```
  { app1: { call:42, time:55, cpu:18, max:55, ts:... }, app2: {...} }
  ```
- A UI de Ajustes mostra três barrinhas (CPU / Tempo / Chamadas) por App.

### 1.3 Modo econômico quando ambos Apps estão saturados
- Em `refresh-tokens.server.ts`, se TODOS os apps disponíveis estão ≥ 80%:
  - Pular tokens que ainda têm mais de **7 dias** de validade.
  - Marcar essas páginas no relatório como `"adiado: quota alta"`.
- Cron diário continua executando, mas processa só os urgentes nesse modo.

## 2. UX no Relatório

### 2.1 Delta de validade
- `PageRefreshOutcome` ganha `previousExpiresAt`. O relatório mostra `"expirava em 5d → agora 60d"` (ou `"sem mudança"`).

### 2.2 Renovar só os que expiram em <N dias
- Novo parâmetro opcional `withinDays` em `refreshTokensNow`.
- Botão extra ao lado de "Renovar agora": **"Renovar prestes a expirar"** (dropdown com 7/15/30 dias).

### 2.3 Histórico de relatórios
- Nova tabela `refresh_reports` (id, user_id, created_at, summary jsonb, results jsonb).
- Após cada renovação (manual ou cron) salvamos o relatório.
- Nova aba/seção em `/pages` com os **últimos 10 relatórios**, expansíveis para ver os detalhes.

## 3. Segurança: criptografar `access_token` no banco

### Abordagem
- Usar `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) com chave-mestra guardada no **Supabase Vault** (`vault.secrets`).
- Nova coluna `fb_pages.access_token_enc bytea`.
- Funções `SECURITY DEFINER`:
  - `public.encrypt_fb_token(plain text) returns bytea`
  - `public.decrypt_fb_token(enc bytea) returns text`
  Ambas leem a chave do Vault — usuários comuns NÃO podem chamar `decrypt_fb_token`; só `service_role`.
- Migração de dados: trigger `BEFORE INSERT/UPDATE` em `fb_pages` que criptografa automaticamente para `access_token_enc` e zera `access_token`. Backfill executa uma vez para registros existentes.
- Server functions passam a obter o token via RPC (`select decrypt_fb_token(access_token_enc) ...`), nunca via SELECT direto.
- Após o backfill rodar e o código novo estar publicado: nova migração que **dropa** a coluna `access_token` em texto puro.

### Por que pgcrypto e não pgsodium puro
- `pgsodium` está em "soft deprecation" no Supabase; o caminho recomendado hoje é Vault + pgcrypto.
- Vault armazena UMA chave-mestra (não cada token), o que escala bem para milhares de páginas.

## Detalhes técnicos

**Arquivos a editar:**
- `src/lib/fb-graph.ts` — `fetchWithRetry`, `parseAppUsage` granular.
- `src/lib/fb-app-creds.ts` — `recordAppUsage` aceita objeto granular; novo `allAppsSaturated()`.
- `src/lib/refresh-tokens.server.ts` — usa modo econômico, `withinDays`, salva `previousExpiresAt`, persiste relatório.
- `src/lib/pages.functions.ts` — `refreshTokensNow` aceita `{ withinDays? }`; novo `listRefreshReports`; helpers para ler token decifrado.
- `src/lib/profile.functions.ts` — retorna usage granular.
- `src/routes/_authenticated/pages.tsx` — botão dropdown, delta, aba "Histórico de renovação".
- `src/routes/_authenticated/settings.tsx` — três barras por App.

**Novas migrações (3):**
1. `refresh_reports` (tabela + RLS + GRANT).
2. `fb_pages.access_token_enc` + funções de criptografia + trigger + backfill.
3. (após validação) `DROP COLUMN access_token`.

**Riscos / cuidados:**
- O segredo no Vault precisa existir ANTES da migração das funções. Vou criar `FB_TOKEN_ENC_KEY` via `vault.create_secret` na própria migração (valor gerado aleatoriamente).
- O backfill precisa ser idempotente (só criptografa se `access_token_enc IS NULL`).
- A migração final que dropa a coluna em texto puro só roda depois que o usuário confirmar que tudo está funcionando — fica como passo separado.

## Ordem de execução proposta
1. Backoff + parseUsage granular + modo econômico (1 levas de edits, sem migração).
2. Tabela `refresh_reports` + persistência + histórico na UI.
3. Delta de validade + botão "renovar próximos a expirar".
4. Criptografia: migração 1 (encrypt coluna + funções + trigger + backfill), atualizar código pra ler via RPC.
5. Após validação manual sua: migração 2 que dropa `access_token` em texto puro.

Confirma que posso seguir nessa ordem? Se quiser pular algum passo (ex.: deixar a criptografia pra depois) me diz antes de eu começar.
