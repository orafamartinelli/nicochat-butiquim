#!/usr/bin/env node
// NicoChat CLI (whitelabel UChat) — v1: leitura, resumo, criação e alteração de leads.
// Endpoints confirmados via Swagger (https://app.nicochat.com.br/api-docs).
//
// LEITURA:
//   node nicochat.mjs resumo [--top N]                 -> total, por status, por tag, N mais recentes
//   node nicochat.mjs listar [--tag NS] [--limit N]    -> lista crua de contatos
//   node nicochat.mjs info --user_ns XXX               -> dados completos de 1 contato
//   node nicochat.mjs descobrir                        -> mapa de endpoints da API
//
// ESCRITA (modo simulação por padrão; use --confirmar pra executar de verdade):
//   node nicochat.mjs criar --phone 5544... --email a@b.com [--name "Nome"] [--first F] [--last L]
//   node nicochat.mjs editar --user_ns XXX [--name N] [--phone P] [--email E] [--first F] [--last L]
//   node nicochat.mjs campo  --user_ns XXX --field "Nome do Campo" --value "valor"
//   node nicochat.mjs tag-add --user_ns XXX --tag "Nome da Tag"
//   node nicochat.mjs tag-rem --user_ns XXX --tag "Nome da Tag"
//   node nicochat.mjs deletar --user_ns XXX
//
//   raw:  node nicochat.mjs raw <METHOD> <path> [jsonBody]
//   global: --client <nome>   (default: default_client do credentials.json)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- credenciais ----------
async function loadClient(clientName) {
  let creds;
  try {
    creds = JSON.parse(await readFile(join(__dirname, "credentials.json"), "utf8"));
  } catch (e) {
    fail(`Não consegui ler credentials.json: ${e.message}`);
  }
  const name = clientName || creds.default_client;
  const c = creds.clients?.[name];
  if (!c) fail(`Cliente "${name}" não encontrado. Disponíveis: ${Object.keys(creds.clients || {}).join(", ")}`);
  if (!c.api_key) fail(`Cliente "${name}" não tem api_key.`);
  return { name, ...c };
}

// ---------- HTTP ----------
async function api(client, method, path, body) {
  const base = client.base_url || "https://app.nicochat.com.br/api";
  const url = base + (path.startsWith("/") ? path : "/" + path);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${client.api_key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    fail(`Falha de rede em ${url}: ${e.message}. Confira a conexão / domínio liberado.`);
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) explainHttp(res.status, url, json);
  return { ok: res.ok, status: res.status, json };
}

function explainHttp(status, url, body) {
  const hint = {
    401: "401 — chave inválida/expirada (Suas configurações → Chaves de API).",
    403: "403 — sem permissão pra esse recurso com essa chave.",
    404: "404 — rota não encontrada. Rode `descobrir` e confira o caminho.",
    422: "422 — payload inválido (campos errados) ou regra de negócio (ex.: janela 24h).",
    429: "429 — rate limit. Espere e tente de novo.",
  }[status];
  console.error(`! ${hint || `HTTP ${status}`}\n  URL: ${url}\n  Resp: ${typeof body === "string" ? body.slice(0, 600) : JSON.stringify(body)?.slice(0, 600)}`);
}

function fail(msg) { console.error("ERRO: " + msg); process.exit(1); }
const parseDate = (s) => (s ? Date.parse(String(s).replace(" ", "T")) || 0 : 0);

// ---------- leitura ----------
async function fetchAllSubscribers(client, { limit = 100, extraQuery = "" } = {}) {
  const all = [];
  let page = 1, lastPage = 1;
  do {
    const r = await api(client, "GET", `/subscribers?limit=${limit}&page=${page}${extraQuery}`);
    if (!r.ok) fail("Falha ao listar assinantes (veja o erro acima).");
    const data = r.json?.data ?? [];
    all.push(...data);
    lastPage = r.json?.meta?.last_page ?? page;
    process.stderr.write(`\r  página ${page}/${lastPage} (${all.length} contatos)   `);
    page++;
  } while (page <= lastPage && page <= 2000);
  process.stderr.write("\n");
  return all;
}

const tagName = (t) => (typeof t === "string" ? t : t?.name || t?.tag || JSON.stringify(t));

async function resumo(client, top) {
  console.log(`Cliente: ${client.label || client.name} — buscando base...`);
  const subs = await fetchAllSubscribers(client);
  console.log(`\n=== RESUMO DA BASE (${client.label || client.name}) ===`);
  console.log(`Total de contatos: ${subs.length}`);

  const byTag = {}, byStatus = {};
  for (const s of subs) {
    const st = s.status || "(sem status)";
    byStatus[st] = (byStatus[st] || 0) + 1;
    for (const t of s.tags || []) {
      const n = tagName(t);
      byTag[n] = (byTag[n] || 0) + 1;
    }
  }
  console.log("\nPor status (estado da conversa):");
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log("\nPor tag:");
  const tags = Object.entries(byTag).sort((a, b) => b[1] - a[1]);
  if (!tags.length) console.log("  (nenhuma tag aplicada nos contatos)");
  for (const [k, v] of tags) console.log(`  ${k}: ${v}`);

  const recent = subs
    .map((s) => ({ s, t: parseDate(s.subscribed) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, top);
  console.log(`\n${top} cadastros mais recentes:`);
  for (const { s, t } of recent) {
    const when = t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "?";
    console.log(`  ${when}  ${s.name || s.first_name || "?"}  | ${s.phone || ""}  (user_ns: ${s.user_ns})`);
  }
}

async function listar(client, limit, tagNs) {
  const subs = await fetchAllSubscribers(client, { limit, extraQuery: tagNs ? `&tag_ns=${tagNs}` : "" });
  for (const s of subs) {
    console.log(`${s.user_ns}  ${(s.name || "").padEnd(28)} ${s.phone || ""}  status=${s.status}  tags=[${(s.tags || []).map(tagName).join(",")}]`);
  }
  console.log(`\nTotal: ${subs.length}`);
}

async function info(client, userNs) {
  const r = await api(client, "GET", `/subscriber/get-info?user_ns=${encodeURIComponent(userNs)}`);
  console.log(JSON.stringify(r.json, null, 2));
}

// ---------- escrita (dry-run por padrão) ----------
async function write(client, label, method, path, body, confirmar) {
  console.log(`\n[${confirmar ? "EXECUTANDO" : "SIMULAÇÃO"}] ${label}`);
  console.log(`  ${method} ${path}`);
  console.log(`  body: ${JSON.stringify(body)}`);
  if (!confirmar) {
    console.log("  → modo simulação. Reexecute com --confirmar pra aplicar de verdade na base ao vivo.");
    return;
  }
  const r = await api(client, method, path, body);
  if (r.ok) console.log(`  ✓ OK (${r.status}): ${JSON.stringify(r.json)?.slice(0, 400)}`);
  else fail("a API recusou a operação (veja o erro acima).");
}

// ---------- main ----------
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
}
const cmd = argv[0];
const confirmar = has("confirmar");
const client = await loadClient(flag("client"));
const need = (v, msg) => { if (!v) fail(msg); return v; };

switch (cmd) {
  case "descobrir": {
    const docsUrl = (client.base_url || "https://app.nicochat.com.br/api").replace(/\/api$/, "") + "/api-docs";
    const res = await fetch(docsUrl, { headers: { Authorization: `Bearer ${client.api_key}`, Accept: "application/json" } });
    const spec = await res.json();
    for (const [p, ms] of Object.entries(spec.paths || {}))
      for (const m of Object.keys(ms)) console.log(`${m.toUpperCase().padEnd(6)} ${p}  ${ms[m].summary || ms[m].operationId || ""}`);
    break;
  }
  case "resumo": await resumo(client, parseInt(flag("top", "10"), 10)); break;
  case "listar": await listar(client, parseInt(flag("limit", "200"), 10), flag("tag")); break;
  case "info": await info(client, need(flag("user_ns"), "uso: info --user_ns XXX")); break;

  case "criar": {
    const body = {
      phone: need(flag("phone"), "criar exige --phone"),
      email: need(flag("email"), "criar exige --email (API obriga phone+email)"),
    };
    if (flag("name")) body.name = flag("name");
    if (flag("first")) body.first_name = flag("first");
    if (flag("last")) body.last_name = flag("last");
    await write(client, `criar lead ${body.name || body.phone}`, "POST", "/subscriber/create", body, confirmar);
    break;
  }
  case "editar": {
    const body = { user_ns: need(flag("user_ns"), "editar exige --user_ns") };
    for (const [f, k] of [["name", "name"], ["phone", "phone"], ["email", "email"], ["first", "first_name"], ["last", "last_name"]])
      if (flag(f)) body[k] = flag(f);
    if (Object.keys(body).length === 1) fail("editar precisa de ao menos 1 campo (--name/--phone/--email/--first/--last)");
    await write(client, `editar ${body.user_ns}`, "PUT", "/subscriber/update", body, confirmar);
    break;
  }
  case "campo": {
    const body = {
      user_ns: need(flag("user_ns"), "campo exige --user_ns"),
      field_name: need(flag("field"), "campo exige --field"),
      value: need(flag("value"), "campo exige --value"),
    };
    await write(client, `set campo "${body.field_name}"`, "PUT", "/subscriber/set-user-field-by-name", body, confirmar);
    break;
  }
  case "tags": {
    const r = await api(client, "GET", `/flow/tags?limit=100&page=1`);
    for (const t of r.json?.data ?? []) console.log(`${t.tag_ns || t.ns || ""}  ${t.name}`);
    break;
  }
  case "tag-criar": {
    const body = { name: need(flag("tag"), "tag-criar exige --tag \"Nome\"") };
    await write(client, `criar tag "${body.name}"`, "POST", "/flow/create-tag", body, confirmar);
    break;
  }
  case "tag-add": {
    const body = { user_ns: need(flag("user_ns"), "tag-add exige --user_ns"), tag_name: need(flag("tag"), "tag-add exige --tag") };
    await write(client, `add tag "${body.tag_name}"`, "POST", "/subscriber/add-tag-by-name", body, confirmar);
    break;
  }
  case "tag-rem": {
    const body = { user_ns: need(flag("user_ns"), "tag-rem exige --user_ns"), tag_name: need(flag("tag"), "tag-rem exige --tag") };
    await write(client, `remove tag "${body.tag_name}"`, "DELETE", "/subscriber/remove-tag-by-name", body, confirmar);
    break;
  }
  case "deletar": {
    const body = { user_ns: need(flag("user_ns"), "deletar exige --user_ns") };
    await write(client, `DELETAR contato ${body.user_ns}`, "DELETE", "/subscriber/delete", body, confirmar);
    break;
  }
  case "raw": {
    const method = (argv[1] || "GET").toUpperCase();
    const path = need(argv[2], "uso: raw <METHOD> <path> [jsonBody]");
    const r = await api(client, method, path, argv[3] ? JSON.parse(argv[3]) : undefined);
    console.log(JSON.stringify(r.json, null, 2));
    break;
  }
  default:
    console.log("Comandos: resumo | listar | info | criar | editar | campo | tag-add | tag-rem | deletar | descobrir | raw");
    console.log("Leitura é direta; escrita roda em SIMULAÇÃO até você passar --confirmar. Global: --client <nome>");
}
