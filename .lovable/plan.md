## Diagnóstico atual

- **354 posts agendados** × ~23 páginas = ~8.000 publicações + 8.000 comentários na fila
- **368 comentários pendentes**, **2.716 targets pending**
- **0 de 23 páginas ativas** (todos os tokens ainda bloqueados pelo limite do FB)
- Cron drena ~50 ações/min → ~5h para esvaziar a fila atual
- 4 posts ainda travados em `publishing` (resíduo antes da trava atômica)
- Arquivos grandes sem refatoração: `sheets.tsx` (455), `extract.tsx` (341), `pages.tsx` (310)

## Melhorias priorizadas

### P0 — Escalabilidade da fila (maior impacto)

1. **Paralelizar publicação por página** (concorrência 4-6). Hoje processa 1 por vez com 800ms entre cada — limite do FB é por token, não global, então dá pra paralelizar com segurança.
   - Tempo para 23 páginas cai de ~30s para ~6s por post.
2. **Índices ausentes** (queries que rodam a cada minuto):
   ```text
   posts(status, scheduled_at)
   post_targets(post_id, status)
   post_targets(status) WHERE status='pending'
   auto_comments(status, run_at) WHERE status='pending'
   ```
3. **Constraint UNIQUE `(post_id, page_id)` em `post_targets`** — defesa extra contra duplicação no banco.
4. **Limpar resíduo**: resetar 4 posts em `publishing` órfãos.

### P1 — Confiabilidade

5. **Retry automático de targets `failed` transitórios** (5xx, timeout) com backoff exponencial — coluna `attempts` + `next_retry_at`. Erros permanentes (token inválido, conteúdo bloqueado) ficam em `failed` definitivo.
6. **Health-check do cron**: tabela `cron_runs(started_at, ended_at, processed, failed, comments)` populada a cada execução. UI mostra "última execução há Xs" — alerta se >3 min.
7. **Página inativa = pular target** já no SELECT do scheduler (hoje tenta publicar e falha). Reduz desperdício de chamadas.

### P2 — UX

8. **Dashboard com métricas em tempo real**: posts/hora publicados, taxa de sucesso por página, comentários pendentes, próximo agendado.
9. **Tela `/queue` com filtros e ações em lote**: cancelar, reagendar, duplicar. Hoje só lista.
10. **Badge de saúde por página** (já discutido) + tooltip explicando estados.
11. **Visualização do calendário** de agendamentos (mês/semana) — hoje só lista.

### P3 — Manutenibilidade

12. **Quebrar `sheets.tsx` (455 linhas)** em `SheetsList`, `SheetImport`, `SheetMapping`.
13. **Quebrar `extract.tsx` (341 linhas)** em sub-componentes por etapa.
14. **Centralizar tipos** de status (`PostStatus`, `TargetStatus`, `CommentStatus`) em `src/lib/types.ts` — hoje strings espalhadas.

### P4 — Funcionalidades novas (oportunidades)

15. **Preview real do post** antes de agendar (renderiza como FB).
16. **Templates de mensagem** com variáveis (`{nome_pagina}`, `{data}`).
17. **Agendamento recorrente** (todo dia às 9h, etc.).
18. **A/B de copy** — duas mensagens, FB escolhe melhor.
19. **Webhook de comentários recebidos** — responder automático ou notificar.
20. **Análise de engajamento**: puxar likes/comentários/shares 24h depois e mostrar ranking de posts/páginas.
21. **Billing/planos** (Stripe) — limite de páginas e posts/mês por plano.

## Detalhes técnicos

### Paralelização (P0.1) — esboço

No scheduler, trocar o loop sequencial por:
```typescript
const CONCURRENCY = 5;
const chunks = chunk(targets, CONCURRENCY);
for (const group of chunks) {
  if (outOfTime()) break;
  await Promise.all(group.map(t => publishOne(t)));
}
```
`publishOne` mantém o claim atômico já implementado.

### Índices (P0.2) — migration

```sql
CREATE INDEX IF NOT EXISTS idx_posts_status_sched ON posts(status, scheduled_at) WHERE status='scheduled';
CREATE INDEX IF NOT EXISTS idx_targets_post_status ON post_targets(post_id, status);
CREATE INDEX IF NOT EXISTS idx_targets_pending ON post_targets(status) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_comments_due ON auto_comments(status, run_at) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_target_post_page ON post_targets(post_id, page_id);
```

### Retry com backoff (P1.5) — schema

```sql
ALTER TABLE post_targets ADD COLUMN attempts int DEFAULT 0;
ALTER TABLE post_targets ADD COLUMN next_retry_at timestamptz;
```
Scheduler também seleciona `status='failed' AND next_retry_at<=now() AND attempts<5` com erros transitórios marcados.

### Health-check (P1.6) — schema

```sql
CREATE TABLE cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  processed int DEFAULT 0,
  failed int DEFAULT 0,
  comments int DEFAULT 0
);
GRANT SELECT ON cron_runs TO authenticated;
GRANT ALL ON cron_runs TO service_role;
```

## Sugestão de execução

Recomendo começar por **P0 (1-4) em um único ciclo** — é o que destrava a fila atual e evita duplicação definitivamente. Em seguida P1 conforme prioridade que você der. P2-P4 podem ser por demanda.

**Qual escopo você quer aprovar agora?**
- (A) Só P0 (paralelização + índices + UNIQUE + limpeza)
- (B) P0 + P1 (adiciona retry, health-check, skip inativas)
- (C) Tudo (P0 → P4, escopo grande)
- (D) Quero escolher itens específicos — me diga quais
