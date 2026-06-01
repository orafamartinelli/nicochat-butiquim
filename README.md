# NicoChat CLI

Acesso à API do NicoChat (whitelabel UChat) pelo terminal. **v1: leitura, resumo, criação e alteração de leads.** Envio de mensagens/broadcast fica pra próxima sessão.

## Setup
- Node 18+ (testado com v24).
- Chaves ficam em `credentials.json` (git-ignored), por cliente:
  ```json
  { "clients": { "butiquim": { "label": "O Butiquim", "api_key": "...", "base_url": "https://app.nicochat.com.br/api" } }, "default_client": "butiquim" }
  ```
- Pra adicionar outro cliente: cole mais uma entrada em `clients`.

## Leitura (executa direto)
```bash
node nicochat.mjs resumo --top 10          # total, por status, por tag, mais recentes
node nicochat.mjs listar --limit 100       # lista crua (opcional: --tag <tag_ns>)
node nicochat.mjs info --user_ns f71825u... # dados completos de 1 contato
node nicochat.mjs descobrir                 # mapa de endpoints da API (Swagger)
```

## Escrita (SIMULAÇÃO por padrão — só aplica com `--confirmar`)
```bash
node nicochat.mjs criar  --phone 5544... --email a@b.com --name "Nome"   # API obriga phone+email
node nicochat.mjs editar --user_ns XXX --name "Novo Nome" --email novo@b.com
node nicochat.mjs campo  --user_ns XXX --field "Nome do Campo" --value "valor"
node nicochat.mjs tag-add --user_ns XXX --tag "Nome da Tag"
node nicochat.mjs tag-rem --user_ns XXX --tag "Nome da Tag"
node nicochat.mjs deletar --user_ns XXX
# adicione --confirmar no fim pra executar de verdade na base ao vivo
```

Trocar de cliente em qualquer comando: `--client <nome>`.

## Notas da API
- Contato identificado por `user_ns` (não pelo telefone).
- `GET /subscribers`: `limit` máx 100, paginação Laravel (`meta.last_page`).
- `status` = estado da conversa (`open`/`done`), não assinatura.
- `allow_send_message` indica janela de 24h do WhatsApp (relevante pro envio futuro).
- Swagger completo: `https://app.nicochat.com.br/api-docs`.
- `criar` exige `phone` **e** `email`; o validador recusa domínios de teste (ex.: `@example.com`).
- `tag-add`/`tag-rem` **by-name** exigem que a tag **já exista** na workspace (a API não cria tag nova). Pra criar tag nova, use o painel ou descubra o endpoint via `descobrir`.
- Criar contato via API **não** dispara o fluxo principal do bot (testado: contato nasce com `status: done`).
- Atenção no Git Bash (Windows): caminhos com `/` em `raw` podem ser convertidos em path do Windows. Os subcomandos (`criar`, `tag-add`, etc.) montam o caminho internamente e não sofrem disso.
