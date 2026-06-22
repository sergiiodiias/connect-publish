Nenhuma alteração no código. Você pediu apenas a explicação, que já dei no chat:

- **ativa / inativa** → estado da página. "inativa" significa que o token está inválido/expirado e o agendador não vai publicar nela até você atualizar o token (botão 🔑) ou clicar em "Renovar agora".
- **não expira** → token de longa duração, sem data de vencimento. É o estado desejado.
- **expira em X** → tempo restante (verde/amarelo/vermelho conforme proximidade).
- **expirado** → token venceu, precisa de um novo.

Se quiser, posso depois adicionar tooltips ou uma legenda visível em `/pages` — mas por ora não faço nenhuma mudança.