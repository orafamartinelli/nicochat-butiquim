---
name: butiquim-relatorio
description: Gera e envia ao WhatsApp os relatórios da lista do Butiquim (NicoChat→Z-API). Use em modo "alerta" (total atual, várias vezes ao dia) ou "fechamento" (resumo semanal + reset das variáveis). Acionada pelas routines agendadas.
---

# Relatório da lista — O Butiquim

Skill para as routines agendadas. O prompt da routine diz qual **modo** rodar: `alerta` ou `fechamento`.

Pré-requisitos no ambiente (env vars da routine): `NICOCHAT_API_KEY`, `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `WHATSAPP_DEST`. Node 18+. Os comandos rodam a partir da raiz do repo.

## Passo 1 — ler os números (sempre)
```
node relatorio.mjs dados
```
Retorna JSON: `noites[]` (cada uma com `label`, `total`, `fem`, `masc`) e `totais` (`total`, `fem`, `masc`). Cobertura Qua→Véspera. Masculino = total − feminino.

## Passo 2 — compor a mensagem (você, com comentário próprio)
Formato WhatsApp (use `*negrito*`, `_itálico_`, emojis com moderação). O **comentário** é uma frase curta sua, lendo os números (qual noite domina, % feminino, ritmo) — varie, não repita template.

**Modo `alerta`** (rápido, "onde a lista está agora"):
```
📋 *Lista O Butiquim* — agora

Total na lista: *{totais.total}*
👩 Feminino: {fem}  ·  👨 Masculino: {masc}

Por noite: {noites ordenadas por total desc, "Label N"}

💬 _{comentário curto da IA}_
```

**Modo `fechamento`** (segunda, resumo da semana):
```
🏁 *Fechamento da semana — O Butiquim*

Total: *{totais.total}*  ·  👩 {fem} ({fem%})  ·  👨 {masc} ({masc%})

{para cada noite com total>0: "Label: total (fem 👩)"}

💬 _{comentário da IA: leitura da semana}_

♻️ _Contadores zerados para a próxima semana._
```

## Passo 3 — enviar
```
node relatorio.mjs enviar "<mensagem composta>"
```
(Passe a mensagem inteira, com quebras de linha, como um argumento.)

## Passo 4 — SÓ no modo `fechamento`: resetar
Depois de confirmar que o envio retornou ok, zere os contadores da semana:
```
node relatorio.mjs reset --confirmar
```
Isso zera as 12 variáveis Lista (sem deletá-las). **Nunca** rode o reset no modo `alerta`.

## Regras
- Modo `alerta`: passos 1→2→3. **Sem reset.**
- Modo `fechamento`: passos 1→2→3→4 (reset por último, só após envio ok).
- Se `dados` ou `enviar` falhar, não prossiga pro reset; reporte o erro.
