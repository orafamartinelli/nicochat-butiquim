#!/usr/bin/env node
// Relatório de reservas do Democrático Bar (NicoChat → Z-API).
//   node democratico.mjs dados              -> JSON por dia
//   node democratico.mjs relatorio          -> texto do relatório
//   node democratico.mjs enviar-relatorio   -> monta e envia pelo WhatsApp
// Credenciais: env var (nuvem) ou credentials.json / ../z-api/.env (local).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

function readEnvFile(p){ try { return Object.fromEntries(readFileSync(p,"utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()];})); } catch { return {}; } }
const ENV = { ...readEnvFile(join(__dirname,".env")), ...readEnvFile(join(__dirname,"..","z-api",".env")), ...process.env };

function nicochat(){
  if (ENV.NICOCHAT_API_KEY) return { key: ENV.NICOCHAT_API_KEY, base: ENV.NICOCHAT_BASE_URL || "https://app.nicochat.com.br/api" };
  const c = JSON.parse(readFileSync(join(__dirname,"credentials.json"),"utf8")).clients.democratico;
  return { key: c.api_key, base: c.base_url };
}
const NC = nicochat();
const H = { Authorization:`Bearer ${NC.key}`, "Content-Type":"application/json", Accept:"application/json" };
const norm = (s)=>s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();

// dias na ordem do relatório (Segunda só entra se tiver dado)
const DIAS = [
  { key:"Segunda", label:"SEG",    emoji:"📋", open:true,  secao:"form", onlyIfData:true },
  { key:"Terça",   label:"TERÇA",  emoji:"📋", open:false, secao:"form" },
  { key:"Quarta",  label:"QUARTA", emoji:"📋", open:true,  secao:"form" },
  { key:"Quinta",  label:"QUI",    emoji:"📋", open:true,  secao:"form" },
  { key:"Sexta",   label:"SEX",    emoji:"🟠", open:true,  secao:"bot" },
  { key:"Sabado",  label:"SÁB",    emoji:"🟠", open:true,  secao:"bot" },
  { key:"Domingo", label:"DOM",    emoji:"🥘", open:true,  secao:"bot", almoco:true },
];

async function coletar(){
  let fields=[],page=1,last=1;
  do{ const j=await(await fetch(NC.base+`/flow/bot-fields?limit=100&page=${page}`,{headers:H})).json(); fields.push(...(j.data||[])); last=j.meta?.last_page||page; page++; }while(page<=last);
  const num=(v)=>parseInt(v??"0",10)||0;
  const out={};
  for(const d of DIAS){
    const nd=norm(d.key);
    const f=(pred)=>fields.find(x=>norm(x.name).includes(nd)&&pred(norm(x.name)));
    out[d.key]={
      reservas: num(f(n=>n.includes("reservas")&&!n.includes("encerrada"))?.value),
      px:       num(f(n=>n.includes("px")&&!n.includes("trad")&&!n.includes("open")&&!n.includes("reservas"))?.value),
      open:     num(f(n=>n.includes("open"))?.value),
    };
  }
  return out;
}

function texto(dados){
  const L=["📋🟠 Reservas das Semana:",""];
  let botHeader=false;
  for(const d of DIAS){
    const v=dados[d.key];
    if(d.onlyIfData && v.reservas===0 && v.px===0) continue;
    if(d.secao==="bot" && !botHeader){ L.push("Reservas pelo Bot:",""); botHeader=true; }
    L.push(`${d.emoji} ${d.label}:`);
    L.push(d.almoco ? `- ${v.reservas} Reservas para almoço e ${v.px} pessoas.` : `- ${v.reservas} Reservas e ${v.px} pessoas.`);
    if(d.open) L.push(d.almoco ? `- ${v.open}` : `- Open food: ${v.open}`);
    L.push("");
  }
  return L.join("\n").trimEnd();
}

async function enviar(msg){
  const z={ base:ENV.ZAPI_BASE_URL||"https://api.z-api.io", instance:ENV.ZAPI_INSTANCE_ID, token:ENV.ZAPI_TOKEN, clientToken:ENV.ZAPI_CLIENT_TOKEN, dest:ENV.WHATSAPP_DEST||"" };
  if(!z.instance||!z.token) throw new Error("Z-API sem credenciais.");
  if(!z.dest) throw new Error("WHATSAPP_DEST não definido.");
  const r=await fetch(`${z.base}/instances/${z.instance}/token/${z.token}/send-text`,{method:"POST",headers:{"Client-Token":z.clientToken,"Content-Type":"application/json"},body:JSON.stringify({phone:z.dest,message:msg})});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(`Z-API ${r.status}: ${JSON.stringify(j)}`); return j;
}

const cmd=process.argv[2];
try{
  if(cmd==="dados") console.log(JSON.stringify(await coletar(),null,2));
  else if(cmd==="relatorio") console.log(texto(await coletar()));
  else if(cmd==="enviar-relatorio") console.log(JSON.stringify(await enviar(texto(await coletar()))));
  else console.log("uso: democratico.mjs <dados|relatorio|enviar-relatorio>");
}catch(e){ console.error("ERRO:",e.message); process.exit(1); }
