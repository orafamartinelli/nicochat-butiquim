# Design — Automação de relatórios NicoChat (O Butiquim) via Claude Routines

Data: 2026-05-31 · Cliente: O Butiquim · Status: aprovado, aguardando pré-requisitos

## Objetivo
Enviar automaticamente para o WhatsApp do Rafa (`5544984232574`):
- **Alertas diários** com o total atual da lista (durante a operação).
- **Resumo semanal** (fechamento) toda segunda.
- **Reset semanal** das variáveis de contagem (zera sem deletar) logo após o fechamento.
Tudo com **comentário curto gerado pela IA**, rodando na **nuvem** (não depende do PC ligado).

## Arquitetura
**Claude Routines (cloud, always-on)** → cada cron abre uma sessão Claude que executa a **skill** `butiquim-relatorio`, que lê a API do NicoChat, monta texto + comentário e envia via **Z-API HTTP**.

Restrições confirmadas dos Routines (docs oficiais):
- Roda em VM remota: **sem acesso ao filesystem local** → tudo via **repo git privado** clonado.
- **MCP local não aparece** (Z-API foi adicionado via `claude mcp add`) → envio por **Z-API HTTP**, não pelo MCP.
- **Skills precisam estar commitadas** no repo (`.claude/skills/`).
- **Secrets = variáveis de ambiente** no painel da routine (não criptografadas — atenção).
- **Intervalo mínimo 1h** (ok, nossos horários respeitam) e **jitter de alguns minutos**.
- **Timezone local** (horário de parede, convertido automaticamente).

## Componentes
### 1. Repo git privado `nicochat`
- `nicochat.mjs` (CLI já existente) + helpers.
- `.claude/skills/butiquim-relatorio/SKILL.md` (a skill).
- **NÃO commitar** `credentials.json`. Chaves vão como env vars da routine.

### 2. Skill `butiquim-relatorio` (2 modos)
- **modo `alerta`**: lê as 12 variáveis Lista (Qua→VESP), soma o total atual, escreve 1 linha de comentário, envia pro WhatsApp.
- **modo `fechamento`**: monta o resumo da semana (Total/Fem/Masc por noite + totais) + comentário, envia, e **depois** zera as 12 variáveis via `PUT /flow/set-bot-field-by-name` (value `"0"`).
- Lê env vars: `NICOCHAT_API_KEY`, `ZAPI_*`, `WHATSAPP_DEST`.

### 3. Variáveis (cobertura Qua→VESP)
| Geral | Feminino |
|---|---|
| Total Lista QUA / QUI / VESP | + FEM de cada |
| 03 - Total Lista SEX | 03 - Total Lista SEX FEM |
| 04 - Total Lista SAB | 04 - Total Lista SAB FEM |
| 05 - Total Lista DOM | 05 - Total Lista DOM FEM |
(12 no total. Masculino = Total − FEM.)

### 4. Crons (horário local)
| Cron | Quando | Modo |
|---|---|---|
| `0 11 * * *` | todo dia 11h00 | alerta |
| `3 15 * * *` | todo dia 15h03 | alerta |
| `4 20 * * *` | todo dia 20h04 | alerta |
| `0 23 * * *` | todo dia 23h00 | alerta |
| `33 11 * * 1` | segunda 11h33 | **fechamento + reset (no mesmo run)** |

> Decisão: resumo semanal (11h33) e reset (11h35 pedido) foram **unificados num único run** de segunda 11h33 — o gap de 2 min era arriscado por causa do jitter (reset podia rodar antes do resumo). O run faz fechamento → depois zera.
> A confirmar: alertas diários rodam **todo dia** ou só **Qua→Dom** (noites de operação)? Fora da operação a lista está zerada.

## Pré-requisitos (do Rafa)
1. **Z-API HTTP**: instance ID + token (+ client-token se houver) da instância conectada. Necessário pro envio na nuvem.
2. **GitHub**: conta/repo onde hospedar (privado). Verificar `gh` autenticado.
3. **Env vars na routine** (painel claude.ai/code/routines): `NICOCHAT_API_KEY`, `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `WHATSAPP_DEST=5544984232574`.

## Fora de escopo (depois)
- MCP server interativo (uso ad-hoc / multi-cliente).
- Outros clientes NicoChat.
- Envio de mensagens a contatos (janela 24h / templates).
