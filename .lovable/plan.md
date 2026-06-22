## Objetivo
Adicionar uma etapa de **prévia + validação** antes de importar as linhas selecionadas da planilha, para que você veja exatamente o que vai ser criado e evite erros (foto quebrada, sem páginas, data inválida, texto vazio, etc.).

## Fluxo novo do botão Importar

Hoje: clicar em Importar → cria tudo direto no banco.

Novo: clicar em Importar → abre **modal de prévia** → revisar/corrigir → confirmar → cria no banco.

```text
[Selecionar linhas] → [Importar] → [Modal: Prévia + Validação] → [Confirmar importação] → posts criados
```

## O que aparece no modal de prévia

Para cada linha selecionada, um card mostrando:
- Miniatura da foto (carregada via `/api/public/drive/...` — se 404, mostra aviso vermelho "foto não encontrada no Drive")
- Tipo final do post (photo / text)
- Título (com contador de caracteres)
- Data/hora agendada formatada em pt-BR, ou badge "Publicar como rascunho"
- Link do auto-comentário + delay
- Páginas de destino selecionadas (contador)

No topo do modal, um resumo:
- Total a importar / com foto OK / com foto faltando / agendadas / com auto-comentário
- Lista de avisos por linha (ex.: "linha 5: título vazio", "linha 8: foto 246.jpg não encontrada no Drive")

## Validações aplicadas

Bloqueiam a importação (linha fica desmarcada automaticamente e listada em "erros"):
- Título vazio
- Nenhuma página de destino selecionada (validação global)
- Data agendada no passado
- Tipo `photo` mas foto inválida e nem texto → vira texto automaticamente (aviso amarelo, não bloqueia)

Avisos (não bloqueiam, só destacam):
- Título > 60.000 caracteres (limite do Facebook)
- Foto local não resolvida no Drive
- Mais de uma linha com mesmo `numero`

## Verificação opcional de fotos no Drive

Botão "Verificar fotos no Drive" dentro do modal: faz um HEAD em cada `/api/public/drive/<nome>` em paralelo e marca cada card como ✓ encontrada / ✗ não encontrada. Isso evita importar 200 posts e descobrir depois que metade das fotos não existe.

## Confirmação

- Botão **Confirmar e importar N** (desabilitado se houver erro bloqueante ou 0 páginas)
- Botão **Cancelar** fecha o modal sem criar nada
- Durante a importação: barra de progresso (X de N) e lista de resultados como já existe hoje

## Detalhes técnicos

- Novo componente `ImportPreviewDialog` em `src/routes/_authenticated/sheets.tsx` (ou arquivo separado) usando o `Dialog` do shadcn já presente no projeto
- Nova server function `checkDriveFiles` em `src/lib/sheets.functions.ts` que recebe `string[]` de nomes de arquivo e devolve `Record<string, boolean>` (existe no Drive ou não) — usa a mesma busca por `name = '...'` já implementada em `drive.$.ts`
- Schema de validação por linha com `zod` reaproveitando `PostInput` de `posts.functions.ts` para garantir mesma regra do servidor
- A função `createPost` no servidor **não muda** — toda a checagem extra é UX

## Fora de escopo
- Edição inline dos campos da planilha (você corrige no Google Sheets e recarrega)
- Publicação imediata no Facebook a partir da importação (segue indo para fila como hoje)
