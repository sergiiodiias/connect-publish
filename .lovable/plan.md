## Diagnóstico

Na data de hoje (27/06) ainda há 147 itens do dia 26 aparecendo na agenda:

- **137 `post_targets` com status `publishing`** e **sem `fb_post_id`** → o cron marcou como "publicando", a chamada ao Facebook estourou tempo/erro silencioso e nunca foi revertido. Ficam presos para sempre porque o cron só pega `pending`.
- **10 `post_targets` com status `pending`** mas **com `fb_post_id`** → já estavam agendados nativamente no Facebook; só faltou a verificação confirmar como `published`.
- Como reflexo, **47 `posts` continuam `scheduled`** e **54 `publishing`** com data passada.

## O que vou fazer

### 1. Limpeza imediata dos dados do dia 26 (passado)
- Para os 10 `pending` que já têm `fb_post_id`: marcar `post_targets.status = 'published'` (eles foram publicados nativamente pelo FB).
- Para os 137 `publishing` sem `fb_post_id`: marcar como `failed` com `error = 'Travado em publishing (limpeza automática)'`. Assim somem da agenda e ficam auditáveis em "Falhas".
- Recalcular `posts.status` para os posts afetados: vira `published` se todos os targets viraram published, `partial` se mistura, `failed` se nenhum publicou.

### 2. Salvaguarda no cron para nunca mais ficar preso
Em `src/routes/api/public/cron/scheduler.ts`, antes de processar a fila, adicionar um passo "stale reaper":
- `post_targets` em `publishing` há mais de 15 min sem `fb_post_id` → voltam para `pending` (para o cron tentar de novo) se ainda dentro da janela de agendamento, ou viram `failed` se a data já passou há mais de 1 hora.

### 3. (opcional, se você quiser) Limpar também os 47 posts `scheduled` do dia 26 cujos targets já foram todos publicados — só atualização cosmética do status do post-pai.

## Detalhes técnicos

- A limpeza dos dados é feita via SQL (`UPDATE` em `post_targets` e `posts` filtrando `scheduled_at::date = '2026-06-26'` e `user_id = <seu>`).
- O reaper roda dentro do handler do cron, antes do "Step 1", limitado a 500 linhas por execução para não estourar.
- Nenhuma mudança visual; a aba **Agenda** simplesmente deixa de listar os fantasmas do dia 26.

Confirma que posso executar a limpeza + adicionar o reaper?