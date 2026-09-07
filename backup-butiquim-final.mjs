// BACKUP FINAL do NicoChat do Butiquim antes do encerramento da conta (06/09/2026).
// Dump completo de contatos (user_ns, telefone, nome, tags, canal, datas) — respeitando
// o rate limit agressivo (~1 chamada/2,2s, backoff no 429).
import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync(new URL('./credentials.json', import.meta.url), 'utf8'));
const C = creds.clients.butiquim;
const h = { Authorization: `Bearer ${C.api_key}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todos = [];
let pagina = 1, ultima = 1, erros = 0;
do {
  const r = await fetch(`${C.base_url}/subscribers?limit=100&page=${pagina}`, { headers: h }).catch(() => null);
  if (!r) { if (++erros > 5) break; await sleep(8000); continue; }
  if (r.status === 429) { await sleep(9000); continue; }
  if (!r.ok) { console.log('HTTP', r.status, await r.text().then((t) => t.slice(0, 150))); if (++erros > 5) break; await sleep(5000); continue; }
  const b = await r.json();
  for (const c of b.data || []) todos.push({ user_ns: c.user_ns, user_id: c.user_id, phone: c.phone, name: c.name, first: c.first_name, last: c.last_name, channel: c.channel, status: c.status, tags: (c.tags || []).map((t) => t.name || t), subscribed_at: c.subscribed_at, last_message_at: c.last_message_at, last_interaction: c.last_interaction_at });
  ultima = b.meta?.last_page || 1;
  if (pagina % 10 === 0) console.log(`página ${pagina}/${ultima} · ${todos.length} contatos`);
  pagina++;
  await sleep(2200);
} while (pagina <= ultima);
const out = `C:/Users/User/Documents/projetos/nicochat/backup-butiquim-contatos-2026-09-06.json`;
fs.writeFileSync(out, JSON.stringify(todos, null, 1), 'utf8');
const canais = {}; const tags = {};
for (const c of todos) { canais[c.channel] = (canais[c.channel] || 0) + 1; for (const t of c.tags) tags[t] = (tags[t] || 0) + 1; }
console.log('TOTAL:', todos.length, 'contatos · canais:', JSON.stringify(canais));
console.log('top tags:', Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}(${v})`).join(' · '));
console.log('salvo em', out);
