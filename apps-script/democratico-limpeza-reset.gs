// === Democratico: limpeza da planilha + reset das variaveis do Nico (gatilho 11h diario) ===
// Cole no Apps Script da planilha de reservas. Troque NICO_KEY pela chave do Democratico.

var COL_DATA = 10;     // coluna J (Data da reserva)
var COL_LUGARES = 5;   // coluna E (Lugares = pessoas)
var COL_SERVICO = 8;   // coluna H (Servico: Open/Tradicional)
var ABAS_RESERVA = /^\d\d\s*-\s*(SEG|TER|QUA|QUI|SEX|S.B|DOM)/i;
var NICO_KEY = 'COLE_A_CHAVE_DO_DEMOCRATICO_AQUI';
var NICO_BASE = 'https://app.nicochat.com.br/api';

function _hoje() {
  var d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _parseData(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v !== 'string') return null;
  var m = v.match(/(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?/);
  if (!m) return null;
  var yy = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : (new Date()).getFullYear();
  var d = new Date(yy, Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function _norm(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ---------- LIMPEZA: apaga linhas com data vencida (coluna J) ----------
function limparPlanilha(dryRun, filtroAba) {
  var hoje = _hoje();
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var out = [];
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    var nome = sh.getName();
    if (!ABAS_RESERVA.test(nome)) continue;
    if (filtroAba && nome.toUpperCase().indexOf(filtroAba.toUpperCase()) === -1) continue;
    var last = sh.getLastRow();
    if (last < 2) continue;
    var datas = sh.getRange(2, COL_DATA, last - 1, 1).getValues();
    var apagar = 0;
    var manter = 0;
    for (var i = datas.length - 1; i >= 0; i--) {
      var d = _parseData(datas[i][0]);
      if (!d) continue;
      if (d < hoje) {
        apagar = apagar + 1;
        if (!dryRun) sh.deleteRow(i + 2);
      } else {
        manter = manter + 1;
      }
    }
    out.push(nome + ': ' + (dryRun ? 'apagaria ' : 'apagou ') + apagar + ' / manteve ' + manter);
  }
  Logger.log((dryRun ? '[LIMPEZA dry-run] ' : '[LIMPEZA] ') + out.join('  |  '));
}

// ---------- NicoChat ----------
function _nicoFields() {
  var fields = [];
  for (var page = 1; page <= 20; page++) {
    var r = UrlFetchApp.fetch(NICO_BASE + '/flow/bot-fields?limit=100&page=' + page, {
      headers: { Authorization: 'Bearer ' + NICO_KEY },
      muteHttpExceptions: true
    });
    var j = JSON.parse(r.getContentText());
    var data = j.data || [];
    for (var i = 0; i < data.length; i++) fields.push(data[i]);
    var lp = (j.meta && j.meta.last_page) ? j.meta.last_page : page;
    if (page >= lp) break;
  }
  return fields;
}

function _setField(name, value) {
  UrlFetchApp.fetch(NICO_BASE + '/flow/set-bot-field-by-name', {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + NICO_KEY },
    payload: JSON.stringify({ name: name, value: String(value) }),
    muteHttpExceptions: true
  });
}

// totais da PROXIMA ocorrencia (menor data futura) na aba do dia; zero se nao houver
function _proximaOcorrencia(diaSub) {
  var hoje = _hoje();
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var aba = null;
  for (var s = 0; s < sheets.length; s++) {
    var nm = sheets[s].getName();
    if (ABAS_RESERVA.test(nm) && _norm(nm).indexOf(diaSub) !== -1) { aba = sheets[s]; break; }
  }
  var z = { reservas: 0, px: 0, open: 0, trad: 0, data: null };
  if (!aba) return z;
  var last = aba.getLastRow();
  if (last < 2) return z;
  var rows = aba.getRange(2, 1, last - 1, COL_DATA).getValues();
  var alvo = null;
  for (var i = 0; i < rows.length; i++) {
    var d = _parseData(rows[i][COL_DATA - 1]);
    if (!d || d < hoje) continue;
    if (!alvo || d < alvo) alvo = d;
  }
  if (!alvo) return z;
  for (var i = 0; i < rows.length; i++) {
    var d = _parseData(rows[i][COL_DATA - 1]);
    if (!d || d.getTime() !== alvo.getTime()) continue;
    var lug = Number(rows[i][COL_LUGARES - 1]) || 0;
    var serv = _norm(String(rows[i][COL_SERVICO - 1] || ''));
    z.reservas = z.reservas + 1;
    z.px = z.px + lug;
    if (serv.indexOf('open') !== -1) z.open = z.open + lug;
    else if (serv.indexOf('tradi') !== -1 || serv.indexOf('carte') !== -1) z.trad = z.trad + lug;
  }
  z.data = alvo;
  return z;
}

// ---------- RESET: atualiza variaveis do dia anterior p/ a proxima ocorrencia (ou 0) ----------
function resetDiaAnterior(dryRun) {
  var SUBS = ['dom', 'seg', 'ter', 'quart', 'quint', 'sext', 'sab'];
  var ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  var diaSub = SUBS[ontem.getDay()];
  var t = _proximaOcorrencia(diaSub);
  var fields = _nicoFields();
  var out = [];
  function setMatch(pred, val) {
    for (var k = 0; k < fields.length; k++) {
      var n = _norm(fields[k].name);
      if (n.indexOf(diaSub) === -1) continue;
      if (!pred(n)) continue;
      if (!dryRun) _setField(fields[k].name, val);
      out.push(fields[k].name + ' -> ' + (val === '' ? '(vazio)' : val));
    }
  }
  setMatch(function (n) { return n.indexOf('reservas') !== -1 && n.indexOf('encerrada') === -1; }, t.reservas);
  setMatch(function (n) { return n.indexOf('px') !== -1 && n.indexOf('trad') === -1 && n.indexOf('open') === -1 && n.indexOf('reservas') === -1; }, t.px);
  setMatch(function (n) { return n.indexOf('open') !== -1; }, t.open);
  setMatch(function (n) { return n.indexOf('trad') !== -1; }, t.trad);
  setMatch(function (n) { return n.indexOf('encerrada') !== -1; }, '');
  var quando = t.data ? Utilities.formatDate(t.data, Session.getScriptTimeZone(), 'dd/MM') : 'sem futura';
  Logger.log((dryRun ? '[RESET dry-run] ' : '[RESET] ') + 'dia=' + diaSub + ' proxima=' + quando + '  |  ' + out.join('  |  '));
}

// ---------- ROTINA das 11h (o gatilho chama esta) ----------
function rotina11h() {
  limparPlanilha(false);
  resetDiaAnterior(false);
}

// ---------- TESTES / SETUP ----------
function limparTudoDryRun() { limparPlanilha(true); }
function testarReset() { resetDiaAnterior(true); }
function criarGatilho11h() {
  ScriptApp.newTrigger('rotina11h').timeBased().everyDays(1).atHour(11).create();
}
