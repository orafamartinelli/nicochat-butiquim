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

// ---- credenciais: env var primeiro, depois arquivos locais ----
function nicochatKey() {
  if (process.env.NICOCHAT_API_KEY) return { key: process.env.NICOCHAT_API_KEY, base: process.env.NICOCHAT_BASE_URL || "https://app.nicochat.com.br/api" };
  const c = JSON.parse(readFileSync(join(__dirname, "credentials.json"), "utf8")).clients.butiquim;
  return { key: c.api_key, base: c.base_url };
}
function zapi() {
  const e = { ...readEnvFile(join(__dirname, "..", "z-api", ".env")), ...process.env };
  return {
    base: e.ZAPI_BASE_URL || "https://api.z-api.io",
    instance: e.ZAPI_INSTANCE_ID, token: e.ZAPI_TOKEN, clientToken: e.ZAPI_CLIENT_TOKEN,
    dest: e.WHATSAPP_DEST || "5544984232574",
  };
}

const NC = nicochatKey();
const ncHeaders = { Authorization: `Bearer ${NC.key}`, "Content-Type": "application/json", Accept: "application/json" };

// ---- as 12 variáveis Lista, em ordem de operação (Qua -> Véspera) ----
const NOITES = [
  { key: "QUA",  label: "Quarta",  geral: "Total Lista QUA",         fem: "Total Lista QUA FEM" },
  { key: "QUI",  label: "Quinta",  geral: "Total Lista QUI",         fem: "Total Lista QUI FEM" },
  { key: "SEX",  label: "Sexta",   geral: "03 - Total Lista SEX",    fem: "03 - Total Lista SEX FEM" },
  { key: "SAB",  label: "Sábado",  geral: "04 - Total Lista SAB",    fem: "04 - Total Lista SAB FEM" },
  { key: "DOM",  label: "Domingo", geral: "05 - Total Lista DOM",    fem: "05 - Total Lista DOM FEM" },
  { key: "VESP", label: "Véspera", geral: "Total Lista VESP",        fem: "Total Lista VESP FEM" },
];

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
  } else if (cmd === "reset") {
    await reset(confirmar);
  } else {
    console.log("uso: relatorio.mjs <dados|enviar \"texto\"|reset [--confirmar]>");
  }
} catch (e) { console.error("ERRO:", e.message); process.exit(1); }
