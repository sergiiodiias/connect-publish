## Objetivo

Depurar todos os tokens das páginas usando o endpoint oficial `/debug_token` do Facebook, **uma vez por mês**, e tentar pegar o token estendido (longa duração) automaticamente.

## Como funciona

### 1. Endpoint cron público
`src/routes/api/public/cron/refresh-tokens.ts` (POST), protegido pelo `apikey` header (anon key — padrão `/api/public/*`).

Para cada página em `fb_pages`:
1. **Depura** via `GET /debug_token?input_token=<token>&access_token=<token>` → lê `is_valid`, `expires_at`, `data_access_expires_at`, `scopes`, `error`.
2. **Renova** (se possível): `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=FB_APP_ID&client_secret=FB_APP_SECRET&fb_exchange_token=<token>` → recebe o token de longa duração e substitui o `access_token` no banco.
3. Marca `is_active=false` se o token virar inválido.
4. Grava em `activity_logs`.

### 2. Persistência
Migração adiciona em `fb_pages`:
- `token_expires_at` (timestamptz, null = não expira)
- `token_data_access_expires_at` (timestamptz)
- `token_scopes` (text[])
- `token_last_debugged_at` (timestamptz)
- `token_last_refreshed_at` (timestamptz)
- `token_debug_error` (text)

Assim a UI mostra a validade **direto do banco**, sem precisar consultar a API toda vez.

### 3. Agendamento mensal (pg_cron)
Via insert tool (SQL fora de migration), agendamos:

```sql
select cron.schedule(
  'refresh-fb-tokens-monthly',
  '0 3 1 * *',  -- dia 1 de cada mês, 03:00 UTC
  $$ select net.http_post(
       url := 'https://project--4a56b795-e3ab-42a9-8eee-4ca48e008280.lovable.app/api/public/cron/refresh-tokens',
       headers := '{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
```

### 4. UI em /pages
- Badge de validade lê os campos persistidos (já carregado, sem clique).
- Botão **"Renovar agora"** dispara o mesmo cron sob demanda.
- Banner no topo se houver tokens expirando em <7 dias ou inválidos.

## Credenciais do app Facebook

Para a renovação automática (passo 2), preciso de:
- `FB_APP_ID` — ID do seu app em developers.facebook.com → Configurações → Básico
- `FB_APP_SECRET` — App Secret no mesmo lugar (clique em "Mostrar")

Vou pedir via `add_secret` quando você aprovar o plano. Sem eles, o cron ainda roda e mantém o depurador atualizado, mas a troca pelo token estendido fica manual (botão 🔑 que já existe).

⚠️ Importante: o Facebook só permite **trocar um token por outro de longa duração se o token original ainda for válido**. Por isso a verificação mensal é segura — page tokens derivados de user tokens de longa duração duram ~60 dias, então 1×/mês deixa margem confortável para renovar antes de expirar.

## Arquivos

- `supabase/migrations/<ts>_fb_pages_token_debug_fields.sql` — novas colunas
- `src/routes/api/public/cron/refresh-tokens.ts` — endpoint do cron
- `src/lib/pages.functions.ts` — `refreshTokensNow` (botão manual) + `listPages` retornando novos campos
- `src/routes/_authenticated/pages.tsx` — banner + botão "Renovar agora" + badge lendo dados persistidos
- SQL via insert tool — agenda `pg_cron` mensal
