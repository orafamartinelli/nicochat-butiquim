#!/usr/bin/env node
// Relatório O Butiquim — lê as variáveis Lista do NicoChat, envia via Z-API, reseta semanalmente.
// Roda IGUAL local e na nuvem: credenciais vêm de env var (nuvem) OU dos arquivos locais (teste).
//
//   node relatorio.mjs dados                  -> imprime JSON dos números (pra IA compor o texto)
//   node relatorio.mjs enviar "<texto>"       -> envia o texto pro WhatsApp destino
//   node relatorio.mjs reset [--confirmar]    -> zera as 12 variáveis (simulação sem --confirmar)
//
// Env vars (nuvem): NICOCHAT_API_KEY, ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN,
//                   ZAPI_BASE_URL (opcional), WHATSAPP_DEST
// Fallback local: credentials.json (NicoChat) e ../z-api/.env (Z-API).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readEnvFile(path) {
  try {
    return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.trim().startsWith("#"))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  } catch { return {}; }
}

// ---- credenciais: .env do repo > .env do z-api local > env vars do sistema ----
const ENV = {
  ...readEnvFile(join(__dirname, ".env")),
  ...readEnvFile(join(__dirname, "..", "z-api", ".env")),
  ...process.env,
};
function nicochatKey() {
  if (ENV.NICOCHAT_API_KEY) return { key: ENV.NICOCHAT_API_KEY, base: ENV.NICOCHAT_BASE_URL || "https://app.nicochat.com.br/api" };
  const c = JSON.parse(readFileSync(join(__dirname, "credentials.json"), "utf8")).clients.butiquim;
  return { key: c.api_key, base: c.base_url };
}
function zapi() {
  return {
    base: ENV.ZAPI_BASE_URL || "https://api.z-api.io",
    instance: ENV.ZAPI_INSTANCE_ID, token: ENV.ZAPI_TOKEN, clientToken: ENV.ZAPI_CLIENT_TOKEN,
    dest: ENV.WHATSAPP_DEST || "",
  };
}

const NC = nicochatKey();
const ncHeaders = { Authorization: `Bearer ${NC.key}`, "Content-Type": "application/json", Accept: "application/json" };

// ---- as 12 variáveis Lista, em ordem de operação (Qua -> Véspera) ----
const NOITES = [
  { key: "QUA",  label: "Quarta",  alerta: "QUA",                geral: "Total Lista QUA",      fem: "Total Lista QUA FEM" },
  { key: "QUI",  label: "Quinta",  alerta: "QUI",                geral: "Total Lista QUI",      fem: "Total Lista QUI FEM" },
  { key: "SEX",  label: "Sexta",   alerta: "SEX",                geral: "03 - Total Lista SEX", fem: "03 - Total Lista SEX FEM" },
  { key: "SAB",  label: "Sábado",  alerta: "SAB",                geral: "04 - Total Lista SAB", fem: "04 - Total Lista SAB FEM" },
  { key: "DOM",  label: "Domingo", alerta: "DOM",                geral: "05 - Total Lista DOM", fem: "05 - Total Lista DOM FEM" },
  { key: "VESP", label: "Véspera", alerta: "Véspera / Feriado",  geral: "Total Lista VESP",     fem: "Total Lista VESP FEM" },
];

// monta o texto do alerta diário (determinístico, sem total semanal)
async function textoAlerta() {
  const { noites } = await coletar();
  const linhas = ["📋🟢 Listas da Semana — AGORA:", ""];
  for (const n of noites) {
    const fem = `${n.fem} ${n.fem === 1 ? "Mulher" : "Mulheres"}${n.fem > 0 ? " 💃" : ""}`;
    const masc = `${n.masc} ${n.masc === 1 ? "Homem" : "Homens"}${n.masc > 0 ? " 🕺" : ""}`;
    linhas.push(`${n.alerta}:`, `${n.total} cadastrados`, `Sendo: ${fem} · ${masc}`, "");
  }
  return linhas.join("\n").trimEnd();
}

// monta o fechamento semanal (por dia em citação + totais + comentário da IA)
async function textoFechamento(comentario) {
  const { noites, totais } = await coletar();
  const pct = (n) => (totais.total ? Math.round((n / totais.total) * 100) : 0);
  const linhas = ["🏁 *Fechamento da Semana — O Butiquim*", ""];
  for (const n of noites) {
    linhas.push(`${n.alerta}: ${n.total}`, `> - (${n.fem} 💃 / ${n.masc} 🕺)`, "");
  }
  linhas.push(`*TOTAL: ${totais.total} cadastrados*`, `👩 ${totais.fem} (${pct(totais.fem)}%)  ·  👨 ${totais.masc} (${pct(totais.masc)}%)`, "");
  if (comentario && comentario.trim()) linhas.push(`💬 _${comentario.trim()}_`, "");
  linhas.push("♻️ _Contadores zerados para a próxima semana._");
  return linhas.join("\n");
}

async function botFieldsMap() {
  const map = {};
  let page = 1, last = 1;
  do {
    const r = await fetch(`${NC.base}/flow/bot-fields?limit=100&page=${page}`, { headers: ncHeaders });
    const j = await r.json();
    if (!r.ok) throw new Error(`NicoChat ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    for (const f of j.data || []) map[f.name] = f.value;
    last = j.meta?.last_page || page; page++;
  } while (page <= last);
  return map;
}

async function coletar() {
  const map = await botFieldsMap();
  const noites = NOITES.map(n => {
    const total = parseInt(map[n.geral] ?? "0", 10) || 0;
    const fem = parseInt(map[n.fem] ?? "0", 10) || 0;
    return { ...n, total, fem, masc: Math.max(0, total - fem) };
  });
  const sum = (f) => noites.reduce((a, n) => a + n[f], 0);
  return { noites, totais: { total: sum("total"), fem: sum("fem"), masc: sum("masc") } };
}

async function enviar(texto) {
  const z = zapi();
  if (!z.instance || !z.token) throw new Error("Z-API sem credenciais (ZAPI_INSTANCE_ID/ZAPI_TOKEN).");
  if (!z.dest) throw new Error("WHATSAPP_DEST não definido (número de destino).");
  const url = `${z.base}/instances/${z.instance}/token/${z.token}/send-text`;
  const r = await fetch(url, { method: "POST", headers: { "Client-Token": z.clientToken, "Content-Type": "application/json" }, body: JSON.stringify({ phone: z.dest, message: texto }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Z-API ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

async function reset(confirmar) {
  const alvos = NOITES.flatMap(n => [n.geral, n.fem]);
  console.log(`[${confirmar ? "EXECUTANDO" : "SIMULAÇÃO"}] zerar ${alvos.length} variáveis Lista:`);
  for (const name of alvos) {
    if (!confirmar) { console.log(`  (sim) ${name} -> "0"`); continue; }
    const r = await fetch(`${NC.base}/flow/set-bot-field-by-name`, { method: "PUT", headers: ncHeaders, body: JSON.stringify({ name, value: "0" }) });
    const j = await r.json().catch(() => ({}));
    console.log(`  ${r.ok ? "✓" : "✗"} ${name} -> 0${r.ok ? "" : "  " + r.status + " " + JSON.stringify(j)}`);
  }
  if (!confirmar) console.log("  → simulação. Use --confirmar pra zerar de verdade.");
}

// ---- CLI ----
const [cmd, arg] = process.argv.slice(2);
const confirmar = process.argv.includes("--confirmar");
try {
  if (cmd === "dados") {
    console.log(JSON.stringify(await coletar(), null, 2));
  } else if (cmd === "enviar") {
    if (!arg) throw new Error('uso: enviar "<texto>"');
    console.log(JSON.stringify(await enviar(arg)));
  } else if (cmd === "enviar-file") {
    if (!arg) throw new Error("uso: enviar-file <caminho>");
    console.log(JSON.stringify(await enviar(readFileSync(arg, "utf8"))));
  } else if (cmd === "alerta") {
    console.log(await textoAlerta());
  } else if (cmd === "enviar-alerta") {
    console.log(JSON.stringify(await enviar(await textoAlerta())));
  } else if (cmd === "fechamento") {
    console.log(await textoFechamento(arg ? readFileSync(arg, "utf8") : ""));
  } else if (cmd === "enviar-fechamento") {
    console.log(JSON.stringify(await enviar(await textoFechamento(arg ? readFileSync(arg, "utf8") : ""))));
  } else if (cmd === "reset") {
    await reset(confirmar);
  } else {
    console.log("uso: relatorio.mjs <dados|enviar \"texto\"|reset [--confirmar]>");
  }
} catch (e) { console.error("ERRO:", e.message); process.exit(1); }
