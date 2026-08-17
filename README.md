# PageFlow Pro

Crie uma aplicação SaaS completa para gerenciamento, agendamento e publicação de conteúdo em páginas do Facebook utilizando a Facebook Graph API.

OBJETIVO PRINCIPAL

Permitir que usuários conectem suas páginas do Facebook através de Access Tokens válidos da Graph API e realizem publicações em massa, agendamentos, rotação automática de conteúdo, comentários automáticos com atraso configurável e gerenciamento de grupos de páginas.

TECNOLOGIAS

- Frontend: React + TypeScript
- Backend: Supabase
- Banco de Dados: PostgreSQL (Supabase)
- Autenticação: Supabase Auth
- Interface: Tailwind CSS + Shadcn/UI
- Agendamentos: Edge Functions + Cron Jobs
- Upload de mídia: Supabase Storage
- Logs em tempo real
- Dashboard responsivo

MÓDULOS DO SISTEMA

====================================
1. DASHBOARD PRINCIPAL
====================================

Exibir:

- Total de páginas conectadas
- Total de grupos criados
- Postagens agendadas
- Postagens publicadas hoje
- Postagens com erro
- Próximas publicações
- Últimos logs
- Status da API

Widgets:

- Calendário de publicações
- Gráfico de publicações diárias
- Gráfico de sucesso/falha
- Contador de publicações por página

====================================
2. GERENCIAMENTO DE PÁGINAS
====================================

Cadastrar páginas através de:

- Nome da página
- Page ID
- Access Token
- Data de validade do token

Funções:

- Adicionar página
- Editar página
- Remover página
- Verificar token
- Renovar token
- Testar conexão

Exibir:

- Foto da página
- Nome
- ID
- Status
- Token válido/inválido

Sistema deve validar automaticamente os tokens.

====================================
3. GRUPOS DE PÁGINAS
====================================

Permitir criar grupos personalizados.

Exemplos:

Grupo Receitas
Grupo Saúde
Grupo Notícias
Grupo Testes

Funções:

- Criar grupo
- Editar grupo
- Excluir grupo
- Adicionar páginas ao grupo
- Remover páginas do grupo

Cada página pode pertencer a vários grupos.

====================================
4. CRIAÇÃO DE POSTAGENS
====================================

Tipos:

- Texto
- Imagem
- Vídeo
- Link
- Carrossel de imagens

Editor:

- Campo de texto
- Emojis
- Contador de caracteres
- Variáveis dinâmicas

Uploads:

- Múltiplas imagens
- Vídeos MP4
- Miniatura personalizada

Pré-visualização da postagem.

====================================
5. AGENDAMENTO
====================================

Permitir:

- Publicação imediata
- Agendamento único
- Agendamento recorrente

Recorrências:

- A cada hora
- A cada 2 horas
- A cada 4 horas
- Diário
- Semanal
- Personalizado

Configurações:

- Data inicial
- Data final
- Fuso horário
- Intervalo entre publicações

Calendário visual.

====================================
6. ROTAÇÃO DE POSTAGENS
====================================

Sistema de rotação automática.

O usuário poderá criar uma biblioteca de conteúdo.

Exemplo:

Post 1
Post 2
Post 3
Post 4
Post 5

A plataforma deverá:

- Publicar em sequência
- Reiniciar ao chegar ao final
- Escolher aleatoriamente
- Evitar repetir o mesmo post consecutivamente

Modos:

- Sequencial
- Aleatório
- Inteligente

====================================
7. BIBLIOTECA DE CONTEÚDO
====================================

Armazenar:

- Textos
- Imagens
- Vídeos
- Links

Funções:

- Upload em massa
- Edição
- Duplicação
- Exclusão

Filtros:

- Data
- Grupo
- Categoria
- Tipo

====================================
8. COMENTÁRIO AUTOMÁTICO COM DELAY
====================================

Após a publicação:

Permitir adicionar automaticamente um comentário na postagem.

Configurações:

- Comentário único
- Comentários rotativos

Delay:

- 30 segundos
- 1 minuto
- 2 minutos
- 5 minutos
- 10 minutos
- Personalizado

Exemplo:

Post publicado

Após 3 minutos:

"Confira o artigo completo aqui:"
"https://meusite.com"

O sistema deve registrar se o comentário foi publicado ou não.

====================================
9. PUBLICAÇÃO EM MASSA
====================================

Selecionar:

- Páginas individuais
- Grupos de páginas

Opções:

- Publicar em todas
- Publicar em páginas específicas

Controle:

- Delay entre páginas
- Limite de publicações simultâneas
- Retry automático

====================================
10. VÍDEOS
====================================

Suporte completo para vídeos.

Permitir:

- Upload de vídeos
- Biblioteca de vídeos
- Agendamento de vídeos
- Rotação de vídeos

Exibir:

- Thumbnail
- Duração
- Tamanho

Compatibilidade:

- MP4
- MOV

Monitorar processamento do Facebook.

====================================
11. LOGS E MONITORAMENTO
====================================

Registrar:

- Publicação criada
- Publicação agendada
- Publicação enviada
- Comentário enviado
- Falha de API
- Token inválido

Filtros:

- Página
- Grupo
- Data
- Status

Exportação CSV.

====================================
12. NOTIFICAÇÕES
====================================

Notificações em tempo real.

Eventos:

- Publicação realizada
- Publicação falhou
- Token expirado
- Comentário enviado
- Vídeo processado

Mostrar:

- Toast
- Painel de notificações

====================================
13. FILA DE PROCESSAMENTO
====================================

Criar fila interna para:

- Publicações
- Comentários
- Upload de vídeos

Status:

- Pendente
- Processando
- Concluído
- Falhou

Retry automático até 3 tentativas.

====================================
14. RELATÓRIOS
====================================

Relatórios de:

- Publicações por período
- Páginas mais ativas
- Taxa de sucesso
- Taxa de falha

Exportação:

- Excel
- CSV
- PDF

====================================
15. CONFIGURAÇÕES
====================================

Configurações gerais:

- Fuso horário
- Intervalo padrão
- Delay padrão
- Quantidade máxima de retries

====================================
BANCO DE DADOS
====================================

Tabelas:

users
pages
groups
group_pages
posts
scheduled_posts
post_media
comments
logs
notifications
settings
queue_jobs

====================================
SEGURANÇA
====================================

- Criptografar tokens no banco
- Controle por usuário
- Logs de auditoria
- Rate limit
- Proteção contra duplicidade
- Backup automático

====================================
EXTRAS IMPORTANTES
====================================

Adicionar:

- Duplicar campanha
- Importar páginas em massa
- Exportar páginas em massa
- Clonar agendamentos
- Histórico completo
- Modo escuro
- Busca global
- Dashboard em tempo real
- Sistema de tags
- Filtro avançado
- API interna para futuras integrações
- Webhooks
- Upload múltiplo de vídeos
- Publicação simultânea em dezenas de páginas
- Controle de fila inteligente
- Rotação separada para textos, imagens e vídeos

A interface deve ser moderna, profissional, extremamente rápida e otimizada para gerenciamento de centenas de páginas do Facebook simultaneamente.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://connect-publish.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4a56b795-e3ab-42a9-8eee-4ca48e008280).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
