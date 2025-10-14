// =======================
//  Calendário de Pedidos (Supabase) — compat ES2018
// =======================

// --- Supabase ---
var SUPABASE_URL = 'https://ijbzcxfqxaftjhzgjqco.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqYnpjeGZxeGFmdGpoemdqcWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAyMDI5OTYsImV4cCI6MjA3NTc3ODk5Nn0.S12ux2LmUc6clMIW6NSjk1C65Z8IzIAik4L1wbxffiM';
var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Estado / refs ---
var nav = 0;           // deslocamento de meses
var monthCache = {};   // { 'YYYY-MM-DD': [rows] }

var calendar      = document.getElementById('calendar');
var monthDisplay  = document.getElementById('monthDisplay');

var labelsModal    = document.getElementById('labelsModal');
var labelsTitulo   = document.getElementById('labelsTitulo');
var labelsResumo   = document.getElementById('labelsResumo');
var labelsConteudo = document.getElementById('labelsConteudo');
var btnLabelsClose = document.getElementById('labelsFechar');
var btnLabelsClear = document.getElementById('labelsLimparDia');
var backDrop       = document.getElementById('modalBackDrop');

// =======================
// Helpers
// =======================

var WEEKDAYS = [
  'domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'
];

function isoOf(y, mZero, d) {
  return y + '-' + String(mZero + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function formatISO(iso) {
  var p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
function escapeHtml(s) {
  s = (s == null) ? '' : String(s);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// normaliza marketplace em um CODE estável
function normCode(val) {
  var v = (val == null) ? '' : String(val).trim();
  var U = v.toUpperCase();
  if (U === 'ML' || U === 'SHOPEE' || U === 'MAGALU' || U === 'UNK') return U;

  var l = v.toLowerCase();
  if (l.indexOf('mercado') !== -1 && l.indexOf('livre') !== -1) return 'ML';
  if (l.indexOf('magalu') !== -1 || l.indexOf('magazine') !== -1) return 'MAGALU';
  if (l.indexOf('shopee') !== -1) return 'SHOPEE';
  return 'UNK';
}
function codeToName(code) {
  var c = normCode(code);
  if (c === 'ML') return 'Mercado Livre';
  if (c === 'MAGALU') return 'Magalu';
  if (c === 'SHOPEE') return 'Shopee';
  return 'Outros';
}

// resumo (contagem por marketplace) para células e topo do modal
function resumeByMarketplace(items) {
  var out = { ML: 0, SHOPEE: 0, MAGALU: 0, UNK: 0 };
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var c = normCode(it.marketplace_code || it.marketplace);
    if (out.hasOwnProperty(c)) out[c]++; else out.UNK++;
  }
  return out;
}

// LocalStorage helpers (fallback)
function lsGetMap() {
  try { return JSON.parse(localStorage.getItem('labelsByDate') || '{}'); }
  catch { return {}; }
}
function lsSetMap(obj) {
  try { localStorage.setItem('labelsByDate', JSON.stringify(obj || {})); } catch {}
}

// modal show/hide
function showLabelsModal() {
  if (!labelsModal) return;
  labelsModal.style.display = 'flex';
  labelsModal.classList.add('show');
  if (backDrop) backDrop.style.display = 'block';
}
function hideLabelsModal() {
  if (!labelsModal) return;
  labelsModal.classList.remove('show');
  labelsModal.style.display = 'none';
  if (backDrop) backDrop.style.display = 'none';
}
if (btnLabelsClose) btnLabelsClose.onclick = hideLabelsModal;
if (backDrop) backDrop.onclick = hideLabelsModal;
window.addEventListener('keydown', function(e){ if (e.key === 'Escape') hideLabelsModal(); });

// =======================
// Supabase + Local: busca mês
// =======================
async function fetchMonthMap(year, monthZeroBased) {
  var start = new Date(Date.UTC(year, monthZeroBased, 1));
  var end   = new Date(Date.UTC(year, monthZeroBased + 1, 1)); // exclusivo
  var startISO = start.toISOString().slice(0,10);
  var endISO   = end.toISOString().slice(0,10);

  // --- Supabase
  var map = {};
  try {
    var resp = await sb
      .from('labels')
      .select('date, arquivo, loja, marketplace_code, marketplace, nfe_numero')
      .gte('date', startISO)
      .lt('date', endISO)
      .order('date', { ascending: true });

    if (resp.error) {
      console.error('Erro ao buscar mês no Supabase:', resp.error);
    } else {
      var data = resp.data || [];
      for (var i=0;i<data.length;i++) {
        var row = data[i];
        var item = {
          date: row.date,
          arquivo: row.arquivo,
          loja: row.loja,
          marketplace_code: normCode(row.marketplace_code || row.marketplace),
          marketplace: row.marketplace,
          nfe_numero: row.nfe_numero
        };
        if (!map[item.date]) map[item.date] = [];
        map[item.date].push(item);
      }
    }
  } catch (e) {
    console.error('Falha geral ao ler Supabase:', e);
  }

  // --- LocalStorage fallback/merge
  try {
    var store = lsGetMap();
    Object.keys(store).forEach(function(iso){
      if (iso >= startISO && iso < endISO) {
        var arr = store[iso] || [];
        if (!map[iso]) map[iso] = [];
        for (var j=0;j<arr.length;j++) {
          var r = arr[j];
          map[iso].push({
            date: iso,
            arquivo: r.arquivo,
            loja: r.loja,
            marketplace_code: normCode(r.marketplace_code || r.marketplace),
            marketplace: r.marketplace,
            nfe_numero: r.nfe_numero
          });
        }
      }
    });
  } catch (e2) {
    console.warn('localStorage inválido:', e2);
  }

  return map;
}

// =======================
// Render do calendário
// =======================
async function load() {
  var date = new Date();
  if (nav !== 0) date.setMonth(date.getMonth() + nav);

  var year  = date.getFullYear();
  var month = date.getMonth();

  if (monthDisplay) {
    monthDisplay.textContent = date.toLocaleDateString('pt-BR',{ month:'long' }) + ', ' + year;
  }

  // busca/atualiza cache do mês
  monthCache = await fetchMonthMap(year, month);

  calendar.innerHTML = '';

  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var firstDay    = new Date(year, month, 1);
  var weekdayName = firstDay.toLocaleDateString('pt-BR', { weekday: 'long' });
  var paddingDays = WEEKDAYS.indexOf(String(weekdayName || '').toLowerCase());
  if (paddingDays < 0) paddingDays = 0; // fallback seguro

  for (var i = 1; i <= paddingDays + daysInMonth; i++) {
    var cell = document.createElement('div');
    cell.className = 'day';

    if (i <= paddingDays) {
      cell.classList.add('padding');
      calendar.appendChild(cell);
      continue;
    }

    var day = i - paddingDays;
    var iso = isoOf(year, month, day);

    cell.textContent = day;
    cell.dataset.iso = iso;
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    if (day === (new Date()).getDate() && nav === 0) cell.id = 'currentDay';

    // resumo do dia
    var items = monthCache[iso] || [];
    if (items.length) {
      var res = resumeByMarketplace(items);
      var div = document.createElement('div');
      div.className = 'event';
      div.style.display = 'flex';
      div.style.flexWrap = 'wrap';
      div.style.gap = '6px';
      div.innerHTML =
        '<span class="badge">' + items.length + ' etiqueta(s)</span>' +
        (res.SHOPEE ? '<span class="badge badge-shopee">Shopee ' + res.SHOPEE + '</span>' : '') +
        (res.ML     ? '<span class="badge badge-ml">ML '     + res.ML     + '</span>' : '') +
        (res.MAGALU ? '<span class="badge badge-magalu">Magalu ' + res.MAGALU + '</span>' : '') +
        (res.UNK    ? '<span class="badge badge-unk">Outros ' + res.UNK    + '</span>' : '');
      cell.appendChild(div);
    }

    calendar.appendChild(cell);
  }
}

// clique/teclado para abrir o modal do dia
calendar.addEventListener('click', function(e) {
  var cell = e.target.closest('.day');
  if (!cell || cell.classList.contains('padding')) return;
  openModalFor(cell.dataset.iso);
});
calendar.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var cell = e.target.closest('.day');
  if (!cell || cell.classList.contains('padding')) return;
  e.preventDefault();
  openModalFor(cell.dataset.iso);
});

// =======================
// Modal (agrupado por marketplace)
// =======================
function renderLabelsModal(iso, items) {
  if (labelsTitulo) labelsTitulo.textContent = formatISO(iso);

  // estado do modal
  var state = {
    iso: iso,
    raw: items,
    mkt: { SHOPEE:true, ML:true, MAGALU:true, UNK:true },
    q: ''
  };

  function apply() {
    // resumo no topo
    var res = resumeByMarketplace(state.raw);
    if (labelsResumo) {
      labelsResumo.innerHTML =
        state.raw.length + ' etiqueta(s) — ' +
        res.SHOPEE + ' Shopee, ' + res.ML + ' ML, ' + res.MAGALU + ' Magalu, ' + res.UNK + ' Outras.';
    }

    // filtros
    var q = state.q.trim().toLowerCase();
    var filtered = [];
    for (var i=0;i<state.raw.length;i++) {
      var it = state.raw[i];
      var code = normCode(it.marketplace_code || it.marketplace);
      if (!state.mkt[code]) continue;
      if (q) {
        var alvo = ((it.nfe_numero || '') + ' ' + (it.loja || '')).toLowerCase();
        if (alvo.indexOf(q) === -1) continue;
      }
      filtered.push(it);
    }

    // buckets
    var buckets = { SHOPEE:[], ML:[], MAGALU:[], UNK:[] };
    for (var j=0;j<filtered.length;j++) {
      var it2 = filtered[j];
      var c = normCode(it2.marketplace_code || it2.marketplace);
      if (!buckets[c]) buckets.UNK.push(it2); else buckets[c].push(it2);
    }

    function section(titulo, arr, cls) {
      var html = '';
      html += '<div class="group">';
      html += '  <div class="group-header">';
      html += '    <strong>' + titulo + '</strong>';
      html += '    <span class="badge ' + cls + '">' + arr.length + '</span>';
      html += '  </div>';
      if (arr.length) {
        html += '<ul class="list">';
        for (var k=0;k<arr.length;k++) {
          var x = arr[k];
          html += '<li class="item">';
          html += '  <span class="nfe">' + escapeHtml(x.nfe_numero || '(sem NF)') + '</span>';
          if (x.loja) html += '  <span>— ' + escapeHtml(x.loja) + '</span>';
          html += '  <span class="muted">(' + escapeHtml(x.arquivo) + ')</span>';
          html += '</li>';
        }
        html += '</ul>';
      } else {
        html += '<div class="muted" style="padding:12px">Sem itens.</div>';
      }
      html += '</div>';
      return html;
    }

    labelsConteudo.innerHTML =
      section('Shopee',        buckets.SHOPEE, 'badge-shopee') +
      section('Mercado Livre', buckets.ML,     'badge-ml') +
      section('Magalu',        buckets.MAGALU, 'badge-magalu') +
      section('Outros',        buckets.UNK,    'badge-unk');
  }

  // ligar chips de filtro
  var chips = document.querySelectorAll('.flt-mkt');
  for (var i=0;i<chips.length;i++) {
    (function(cb){
      cb.checked = true;
      cb.onchange = function() {
        var code = normCode(cb.value);
        state.mkt[code] = !!cb.checked;
        apply();
      };
    })(chips[i]);
  }

  // busca
  var search = document.getElementById('labelsSearch');
  if (search) {
    search.value = '';
    search.oninput = function() { state.q = search.value; apply(); };
  }

  // export CSV do dia
  var btnCsv = document.getElementById('labelsExportCSV');
  if (btnCsv) {
    btnCsv.onclick = function() {
      var headers = ['arquivo','loja','marketplace','marketplace_code','nfe_numero'];
      var q = (state.q || '').toLowerCase();

      var arr = [];
      for (var i=0;i<state.raw.length;i++) {
        var it = state.raw[i];
        var code = normCode(it.marketplace_code || it.marketplace);
        if (!state.mkt[code]) continue;
        if (q) {
          var alvo = ((it.nfe_numero || '') + ' ' + (it.loja || '')).toLowerCase();
          if (alvo.indexOf(q) === -1) continue;
        }
        arr.push(it);
      }

      function csvCell(v){ v = (v == null) ? '' : String(v); return '"' + v.replace(/"/g,'""') + '"'; }
      var linhas = [headers.join(',')];
      for (var i2=0;i2<arr.length;i2++) {
        var r = arr[i2];
        var row = [
          csvCell(r.arquivo),
          csvCell(r.loja),
          csvCell(codeToName(r.marketplace_code || r.marketplace)),
          csvCell(normCode(r.marketplace_code || r.marketplace)),
          csvCell(r.nfe_numero)
        ].join(',');
        linhas.push(row);
      }
      var blob = new Blob([linhas.join('\n')], { type:'text/csv;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url;
      a.download = 'etiquetas_' + iso + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
    };
  }

  // limpar dia no banco + localStorage
  if (btnLabelsClear) {
    btnLabelsClear.onclick = async function () {
      if (!confirm('Remover ' + items.length + ' etiqueta(s) de ' + formatISO(iso) + ' do banco?')) return;

      // apaga no Supabase
      var resp = await sb.from('labels').delete().eq('date', iso);
      if (resp.error) {
        alert('Erro ao limpar o dia.');
        console.error(resp.error);
        return;
      }

      // apaga no localStorage
      try {
        var store = lsGetMap();
        if (store[iso]) { delete store[iso]; lsSetMap(store); }
      } catch {}

      delete monthCache[iso];
      hideLabelsModal();
      load();
    };
  }

  apply();
}

// abre modal do dia selecionado
function openModalFor(iso) {
  var items = monthCache[iso] ? monthCache[iso].slice() : [];
  for (var i=0;i<items.length;i++) {
    items[i] = Object.assign({}, items[i], {
      marketplace_code: normCode(items[i].marketplace_code || items[i].marketplace)
    });
  }
  if (!items.length) {
    if (labelsTitulo)  labelsTitulo.textContent = formatISO(iso);
    if (labelsResumo)  labelsResumo.textContent = 'Sem itens.';
    if (labelsConteudo) labelsConteudo.innerHTML = '';
    showLabelsModal();
    return;
  }
  renderLabelsModal(iso, items);
  showLabelsModal();
}

// =======================
// Navegação do calendário
// =======================
var backBtn = document.getElementById('backButton');
var nextBtn = document.getElementById('nextButton');
if (backBtn) backBtn.addEventListener('click', function(){ nav = nav - 1; load(); });
if (nextBtn) nextBtn.addEventListener('click', function(){ nav = nav + 1; load(); });

// init
load();
