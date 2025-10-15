// =======================
//  Calendário de Pedidos (Supabase) — grid novo + clique confiável + TZ fix
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
function pad(n){ return String(n).padStart(2,'0'); }
function isoOf(y, mZero, d) { return y + '-' + pad(mZero + 1) + '-' + pad(d); }
function formatISO(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function escapeHtml(s) { s = (s == null) ? '' : String(s); return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// normaliza marketplace para um CODE estável
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
function resumeByMarketplace(items) {
  var out = { ML: 0, SHOPEE: 0, MAGALU: 0, UNK: 0 };
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var c = normCode(it.marketplace_code || it.marketplace);
    if (out.hasOwnProperty(c)) out[c]++; else out.UNK++;
  }
  return out;
}

// uma loja não pode repetir a mesma NFe 2x no mesmo dia
function dedupeByLojaNFe(arr) {
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i] || {};
    var loja = (it.loja || '').toUpperCase().trim();
    var nf   = String(it.nfe_numero || '').replace(/\D+/g,'');
    var key  = loja + '|' + nf;
    if (!seen[key]) { seen[key] = true; out.push(it); }
  }
  return out;
}

// LocalStorage (fallback/merge)
function lsGetMap() { try { return JSON.parse(localStorage.getItem('labelsByDate') || '{}'); } catch(e){ return {}; } }
function lsSetMap(obj) { try { localStorage.setItem('labelsByDate', JSON.stringify(obj || {})); } catch(e){} }

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
// Supabase + Local: busca mês (sem UTC!)
// =======================
async function fetchMonthMap(year, monthZeroBased) {
  // limites do mês como strings puras, sem toISOString/UTC
  var startISO = year + '-' + pad(monthZeroBased + 1) + '-01';
  var endISO   = (monthZeroBased === 11)
    ? (year + 1) + '-01-01'
    : year + '-' + pad(monthZeroBased + 2) + '-01';

  var map = {};

  // Supabase
  try {
    var resp = await sb
      .from('labels')
      .select('date, arquivo, loja, marketplace_code, marketplace, nfe_numero')
      .gte('date', startISO)
      .lt('date', endISO)
      .order('date', { ascending: true });

    if (!resp.error) {
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
        (map[item.date] || (map[item.date] = [])).push(item);
      }
    } else {
      console.error('Erro Supabase:', resp.error);
    }
  } catch (e) { console.error('Falha geral Supabase:', e); }

  // LocalStorage merge
  try {
    var store = lsGetMap();
    Object.keys(store).forEach(function(iso){
      if (iso >= startISO && iso < endISO) {
        var arr = store[iso] || [];
        (map[iso] || (map[iso] = []));
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
  } catch (e2) { console.warn('localStorage inválido:', e2); }

  // dedupe por dia (loja+NF)
  Object.keys(map).forEach(function(k){ map[k] = dedupeByLojaNFe(map[k]); });
  return map;
}

// =======================
// Render do calendário (grid fixado)
// =======================
async function load() {
  var today = new Date();
  var base  = new Date(today.getFullYear(), today.getMonth(), 1);
  if (nav !== 0) { base.setMonth(base.getMonth() + nav); }

  var year  = base.getFullYear();
  var month = base.getMonth();

  // título
  if (monthDisplay) {
    monthDisplay.textContent = base.toLocaleDateString('pt-BR',{ month:'long' }) + ', ' + year;
  }

  // dados
  monthCache = await fetchMonthMap(year, month);

  // calendário
  calendar.innerHTML = '';

  var daysInMonth  = new Date(year, month + 1, 0).getDate();
  var firstWeekday = new Date(year, month, 1).getDay(); // 0=Dom ... 6=Sáb
  var totalCells   = firstWeekday + daysInMonth;
  var rows         = Math.ceil(totalCells / 7);
  totalCells       = rows * 7;

  for (var i = 0; i < totalCells; i++) {
    var cell = document.createElement('button'); // button melhora foco/clique
    cell.type = 'button';
    cell.className = 'day';
    cell.tabIndex = 0;

    if (i < firstWeekday || i >= firstWeekday + daysInMonth) {
      cell.classList.add('padding');
      calendar.appendChild(cell);
      continue;
    }

    var day = i - firstWeekday + 1;
    var iso = isoOf(year, month, day);
    cell.dataset.iso = iso;

    // número do dia
    var num = document.createElement('div');
    num.className = 'day-number';
    num.textContent = day;
    cell.appendChild(num);

    // resumo do dia
    var items = monthCache[iso] || [];
    if (items.length) {
      var res = resumeByMarketplace(items);
      var wrap = document.createElement('div');
      wrap.className = 'event';
      wrap.style.pointerEvents = 'none';            // segurança extra
      wrap.innerHTML =
        '<span class="badge">' + items.length + ' etiqueta(s)</span>' +
        (res.SHOPEE ? '<span class="badge badge-shopee">Shopee ' + res.SHOPEE + '</span>' : '') +
        (res.ML     ? '<span class="badge badge-ml">ML '     + res.ML     + '</span>' : '') +
        (res.MAGALU ? '<span class="badge badge-magalu">Magalu ' + res.MAGALU + '</span>' : '') +
        (res.UNK    ? '<span class="badge badge-unk">Outros ' + res.UNK    + '</span>' : '');
      cell.appendChild(wrap);
    }

    // hoje
    var isToday = (day === today.getDate() && month === today.getMonth() && year === today.getFullYear() && nav === 0);
    if (isToday) cell.id = 'currentDay';

    calendar.appendChild(cell);
  }
}

// clique/teclado (event delegation)
calendar.addEventListener('click', function(e) {
  var cell = e.target.closest('.day');
  if (!cell || cell.classList.contains('padding')) return;
  var iso = cell.dataset.iso;
  if (iso) openModalFor(iso);
});
calendar.addEventListener('keydown', function(e) {
  var cell = e.target.closest('.day');
  if (!cell || cell.classList.contains('padding')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    var iso = cell.dataset.iso;
    if (iso) openModalFor(iso);
  }
});

// =======================
// Modal (apenas filtros por marketplace)
// =======================
function renderLabelsModal(iso, items) {
  if (labelsTitulo) labelsTitulo.textContent = formatISO(iso);

  var state = {
    iso: iso,
    raw: items,                        // já deduplicado loja+NF
    mkt: { SHOPEE:true, ML:true, MAGALU:true, UNK:true },
    q: ''
  };

  function apply() {
    var res = resumeByMarketplace(state.raw);
    if (labelsResumo) {
      labelsResumo.innerHTML =
        state.raw.length + ' etiqueta(s) — ' +
        res.SHOPEE + ' Shopee, ' + res.ML + ' ML, ' + res.MAGALU + ' Magalu, ' + res.UNK + ' Outras.';
    }

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

  // chips (apenas marketplace)
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

  // limpar dia (DB + local)
  if (btnLabelsClear) {
    btnLabelsClear.onclick = async function () {
      if (!confirm('Remover ' + items.length + ' etiqueta(s) de ' + formatISO(iso) + ' do banco?')) return;
      var resp = await sb.from('labels').delete().eq('date', iso);
      if (resp.error) { alert('Erro ao limpar o dia.'); console.error(resp.error); return; }
      try { var store = lsGetMap(); if (store[iso]) { delete store[iso]; lsSetMap(store); } } catch(e){}
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
  items = dedupeByLojaNFe(items).map(function(it){
    return Object.assign({}, it, {
      marketplace_code: normCode(it.marketplace_code || it.marketplace)
    });
  });

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
// Navegação
// =======================
var backBtn = document.getElementById('backButton');
var nextBtn = document.getElementById('nextButton');
if (backBtn) backBtn.addEventListener('click', function(){ nav = nav - 1; load(); });
if (nextBtn) nextBtn.addEventListener('click', function(){ nav = nav + 1; load(); });

// init
load();
