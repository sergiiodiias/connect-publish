# Refator da tela /sheets — Upload em Massa com Rotação

Mantém o modelo atual (Facebook Graph + tabela `fb_pages` + `page_groups`). Substitui a importação atual por um fluxo mais robusto, com leitura via CSV público do Google Sheets, drag & drop de mídias locais, upload ao Storage, rotação de páginas e job em background.

## 1. Importação por CSV público (sem conector)

- `src/lib/sheets-csv.functions.ts` (novo) — server fn `importSheetCsv({ url })`:
  - Extrai `spreadsheetId` (3 regex) e `gid` (`?gid=`/`&gid=`/`#gid=`, default 0).
  - Baixa `https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID}`. Detecta resposta HTML → erro pedindo compartilhamento "qualquer pessoa com o link".
  - Parser CSV próprio (aspas duplas escapadas, vírgulas em aspas, `\r\n`).
  - Detecta header (rejeita se 1ª célula é número/path/URL/data).
  - Match de colunas por sinônimos (mídia / conteúdo / comentário / data / hora).
  - Parsing BR→UTC (`DD/MM/YYYY [HH:mm]`, `YYYY-MM-DD`, fração decimal do Sheets), default 10:00 com warning, rejeita passado em horário de Brasília.
  - Valida extensões: `jpg|jpeg|png|gif|webp|mp4|mov|avi|mkv|webm`.
  - Retorna `{ posts, errors, warnings, hasCustomDates, totalRows }`.

- Remove dependência da função atual `readSheet`/conector Google Sheets nesta tela (mantém o arquivo para outros usos, mas /sheets passa a usar a nova fn).

## 2. Drag & drop e casamento local

- Componente `<MediaDropzone />` em `src/components/bulk/`:
  - Aceita arquivos e pastas (`webkitGetAsEntry`).
  - Filtra: descarta arquivos cujo `name.toLowerCase()` não bate com nenhum `mediaFileName` da planilha.
  - Estado por linha: `matched | missing | duplicated`. Bloqueia avanço com `missing`.
  - Previews lazy via `URL.createObjectURL` (IntersectionObserver). Vídeos = ícone.

## 3. Upload ao Storage antes de publicar

- Reusa bucket privado `post-media` já criado (signed URL 1 ano).
- Concurrency = 20, retry exponencial (3x).
- Substitui o caminho local pela URL assinada antes de criar o post.
- Tabela `upload_jobs` (nova migração) acompanha progresso e habilita Realtime.

## 4. Motor de rotação

- `src/lib/rotation.ts` (novo) — `useMediaRotation({ posts, groups, startDate, intervalMinutes, useSpreadsheetDates, rotationMode })`:
  - Slot por hora `h`: usa `posts[h].scheduledAt` se `useSpreadsheetDates`, senão `startDate + h*interval`.
  - **group**: `mediaIndex = (h + groupIndex) % totalMedias`.
  - **page**: `mediaIndex = (h + pageIndex) % totalMedias` (pageIndex achatado).
  - Stagger Late-like: a cada 10 páginas, +2 min no slot (rate-limit guard).
- Componentes `<GroupOrderSelector />`, `<RotationMatrixPreview />` (paginação obrigatória), `<RateLimitValidator />`.
- Validações: 0 grupos → erro; <2 grupos → warning; `totalMedias < count` → warning.

## 5. Execução em background

- Server route `src/routes/api/public/bulk/run.ts`:
  - Cria `upload_jobs` (status=pending), recebe payload completo, devolve `jobId`.
  - Dispara processamento auto-invocando-se via `fetch(self_url)` para escapar do timeout.
  - Worker lê `upload_jobs.payload`, percorre slots em chunks (3×200), 300ms entre posts, 2s entre lotes de 15, chama `publishFacebookPost` (já existente) e atualiza contadores via RPC.
  - Cabeçalho `apikey` = `SUPABASE_PUBLISHABLE_KEY` (sem secret novo).
- RPC `increment_job_counts(job_id, success_inc, error_inc, processed, should_complete)`.
- Front escuta `upload_jobs` via Realtime.

## 6. Migrações

```sql
create table public.upload_jobs (...);  -- conforme spec, grants + RLS user_id=auth.uid()
alter publication supabase_realtime add table public.upload_jobs;
create function public.increment_job_counts(...);
```

(Já existem: bucket `post-media`, `page_groups`, `fb_pages`. Não criamos `account_groups`.)

## 7. Tela /sheets

Reescrita do componente `ImportPage`:
1. URL da planilha + botão importar → resumo `<ParseValidationSummary />` (totais, erros por linha, warnings).
2. Toggle "Usar datas da planilha" vs "Recalcular pelo intervalo" + `<ScheduleCalculator />`.
3. `<MediaDropzone />` com status por linha.
4. `<GroupOrderSelector />` + toggle distribuição (`mass` | `distribution`) + `<RotationMatrixPreview />`.
5. Botão "Publicar" → upload em massa → cria `upload_jobs` → mostra progresso Realtime.

## Princípios mantidos

- Facebook Graph (sem Late API).
- Mídias sempre via Storage antes da publicação.
- TZ Brasília na UI, UTC na borda.
- Datas no passado rejeitadas; hora omissa → 10:00 + warning.
- Conteúdo opcional (Facebook recebe caractere invisível se vazio).

## Detalhes técnicos relevantes

- A regra "1 conta = 1 grupo" do prompt não se aplica: `page_groups`/`page_group_members` permitem múltiplos grupos por página. Mantemos como está; o motor só usa a ordem escolhida.
- "Perfil-mestre" não existe na stack atual — toda página tem seu próprio `access_token` em `fb_pages`. Removido.
- Stagger de 2 min a cada 10 páginas substitui o limite "15 posts/h por conta" da Late.

## Fora de escopo

- Late API, perfil-mestre, `account_groups`/`account_group_members`, webhook Late, cron Late.
- EXIF strip e re-encode de vídeo (Facebook aceita direto via `source`).

## Riscos / pontos de atenção

- O motor de rotação pode gerar milhares de slots → o `bulk-run` precisa paginar o insert de `post_targets`.
- Self-invocation via `fetch(self_url)` em TanStack Start (Workers) tem que respeitar o limite de 50 sub-requests; chunks de 200 estão dentro.
- Tela ficará grande — separar em `src/components/bulk/*` ajuda na manutenção.