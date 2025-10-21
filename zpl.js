// ====== SUPABASE CONFIG ======
const SUPABASE_URL = 'https://ijbzcxfqxaftjhzgjqco.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqYnpjeGZxeGFmdGpoemdqcWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAyMDI5OTYsImV4cCI6MjA3NTc3ODk5Nn0.S12ux2LmUc6clMIW6NSjk1C65Z8IzIAik4L1wbxffiM';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== Config ======
const IGNORAR_SEM_NFE = true;
const DEFAULT_MARKETPLACE = 'SHOPEE'; // fallback quando nada é detectado

const MARKETPLACE_EMOJI = { ML:'🤝', SHOPEE:'🛒', UNK:'❓' };
const MARKETPLACE_LOGOS = {
  ML:'./logos/mercado-livre.svg',
  SHOPEE:'./logos/shopee.svg'
};

// ====== Seletores ======
const $ = (q) => document.querySelector(q);
const out = $('#out');
const btnCSV = $('#btnCSV');
const btnJSON = $('#btnJSON');
const btnLimpar = $('#btnLimpar');
const btnCal = $('#btnCalendario');
const count = $('#count');
const uploadLabel = $('.file-upload-label');
const btnPickFiles = $('#btnPickFiles');
const btnPickDir = $('#btnPickDir');
const inputFiles = $('#fileFiles');
const inputDir = $('#fileDir');
const calDateInput = document.getElementById('calDate');

// ====== Utils ======
const onlyDigits = (s) => (s == null ? null : String(s).replace(/\D+/g, ''));
function normalizeNFe(nfe) {
  if (nfe == null) return null;
  const d = onlyDigits(nfe);
  if (!d) return null;
  const trimmed = d.replace(/^0+/, '');
  return trimmed || '0';
}
const keyLoja = (loja) => (loja || '').trim().toUpperCase().replace(/\s+/g, ' ');

function codeToName(code) {
  const c = (code || 'UNK').toUpperCase();
  if (c === 'ML') return 'Mercado Livre';
  if (c === 'SHOPEE') return 'Shopee';
  return 'Desconhecido';
}

// Dedupe por NFe (mantém 1 por NF e escolhe o mais “confiável”)
function dedupeByNFe(arr) {
  const rank = { ML:4, SHOPEE:2, UNK:1 };
  const groups = new Map();
  for (const r of arr) {
    const nfe = normalizeNFe(r.nfe_numero);
    if (!nfe) { groups.set(`__NO_NFE__${r.arquivo}`, [r]); continue; }
    r.nfe_numero = nfe;
    if (!groups.has(nfe)) groups.set(nfe, []);
    groups.get(nfe).push(r);
  }
  const pickBest = (items) => {
    let best = null, bestScore = -Infinity;
    for (const it of items) {
      const raw = (it.marketplace_raw || it.marketplace_code || 'UNK').toUpperCase();
      const detectedBonus = it.marketplace_detected ? 1 : 0;
      const lojaBonus = keyLoja(it.loja).length / 100;
      const base = rank[raw] || 0;
      const score = base*10 + detectedBonus + lojaBonus;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    const code = (best.marketplace_code || best.marketplace_raw || 'UNK').toUpperCase();
    best.marketplace = codeToName(code);
    best.marketplace_code = code;
    return best;
  };
  const out = [];
  for (const [k, items] of groups) {
    out.push(k.startsWith('__NO_NFE__') ? items[0] : pickBest(items));
  }
  return out;
}

// ====== ZPL helpers ======
function decodeZplEscapes(s) {
  if (!s) return s;
  // remove ^FH e decodifica \xx e _xx (hex) — preservando \& pra não quebrar
  let t = s.replace(/\^FH\\?/g, '').replace(/\\&/g, '%26');
  t = t.replace(/\\([0-9A-Fa-f]{2})/g, '%$1').replace(/_([0-9A-Fa-f]{2})/g, '%$1');
  try { return decodeURIComponent(t); } catch { return s; }
}

// Split em múltiplas etiquetas
function splitZplLabels(zpl) {
  const parts = zpl.split(/(?<=\^XZ)\s*(?=\^XA)/g).map(s=>s.trim()).filter(Boolean);
  return parts.length ? parts : [zpl];
}

// ---------- DETECÇÃO MERCADO LIVRE: “Logo Meli” ----------
function hasLogoMeli(text) {
  if (!text) return false;
  // casa ^FX Logo Meli^FS ou “Logo Meli” em qualquer lugar
  return (
    /\^FX\s*Logo\s*Meli(?:\b|\s*\^FS)/i.test(text) ||
    /\blogo\s*meli(?:\b|\s*\^FS)/i.test(text) ||
    /logo.{0,20}meli/i.test(text) // super tolerante (ex.: "Logo   Meli")
  );
}
function detectMarketplace(text) {
  const raw = text || '';
  const dec = decodeZplEscapes(text) || '';
  if (hasLogoMeli(raw) || hasLogoMeli(dec)) {
    return { code:'ML', name: codeToName('ML'), detected:true };
  }
  // fallback = Shopee
  const def = (DEFAULT_MARKETPLACE || 'UNK').toUpperCase();
  return { code:def, name: codeToName(def), detected:false };
}

function normalizeLojaName(name){
  if (!name) return name;
  let s = String(name).trim().replace(/^\^?FD/i, '');
  return s.trim().replace(/\s+/g, ' ');
}
function extractLoja(text){
  const t = decodeZplEscapes(text) || '';

  // 1) ML padrão de DANFE: "NOME #123456..."
  let m = t.match(/([A-Za-zÀ-ÿ0-9 ._\-]{3,}?)\s*#\d{6,}/);
  if (m) return normalizeLojaName(m[1]);

  // 2) Varre ^FD ... ^FS
  const fds = [...t.matchAll(/\^FD([^\^]*)\^FS/g)].map(x=>x[1].trim());
  const idxCnpj = fds.findIndex(s => /CNPJ\s*:/i.test(s));
  if (idxCnpj > 0) {
    const lojaPrev = fds[idxCnpj - 1];
    if (lojaPrev && lojaPrev.length >= 5) return normalizeLojaName(lojaPrev);
  }
  const campo = fds.find(s => /(Raz[aã]o Social|Nome Fantasia|Vendedor|Loja|Seller)\s*:/i.test(s));
  if (campo){ const nome = campo.split(/:/).slice(1).join(':').trim(); if (nome) return normalizeLojaName(nome); }
  const emit = fds.find(s => /^Emitente\s*:/i.test(s));
  if (emit){ const nome = emit.split(/:/).slice(1).join(':').trim(); if (nome) return normalizeLojaName(nome); }

  // 3) Fallback
  const cand = fds.find(s =>
    /^[A-ZÀ-Ÿ0-9 .&\-]{6,}$/.test(s) &&
    !/DANFE|Etiqueta|Data|TIPO:|Protocolo|IE:|Endere|Rua|Avenida|CEP|CPF|CNPJ|NF(?:e)?:|Chave/i.test(s)
  );
  return cand ? normalizeLojaName(cand) : null;
}
function extractNFe(text){
  const t = decodeZplEscapes(text) || '';
  let m = t.match(/\bNFe\s*:\s*([0-9]{3,})\b/i); if (m) return m[1];
  m = t.match(/\bNF\s*:\s*([0-9]{3,})\b/i);     if (m) return m[1];
  m = t.replace(/[º°]/g, '').match(/\bNFe\s*:\s*([0-9]{3,})\b/i);
  return m ? m[1] : null;
}

function parseUmArquivo(nome, conteudo){
  const mkt = detectMarketplace(conteudo);
  const nfe = normalizeNFe(extractNFe(conteudo));
  const code = (mkt.code || DEFAULT_MARKETPLACE || 'UNK').toUpperCase();
  return {
    arquivo: nome,
    loja: extractLoja(conteudo),
    marketplace_code: code,
    marketplace: codeToName(code),
    marketplace_raw: code,
    marketplace_detected: !!mkt.detected,
    nfe_numero: nfe,
  };
}

// ====== Render ======
function escapeHtml(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function marketplaceBadge({code}){
  const c = (code || 'UNK').toUpperCase();
  const label = escapeHtml(codeToName(c));
  const file  = MARKETPLACE_LOGOS[c];
  const emoji = MARKETPLACE_EMOJI[c] || '❓';
  const cls = (c==='ML') ? 'mkt-ml'
           : c==='SHOPEE' ? 'mkt-shopee'
           : 'mkt-unk';
  const img   = file ? `<img class="logo-mkt" src="${file}" alt="" onerror="this.remove()">` : '';
  return `<span class="mkt-pill ${cls}">${img}<span class="mkt-emoji">${emoji}</span> ${label}</span>`;
}

let resultados = [];
function atualizarBotoes(){
  const vazio = resultados.length===0;
  btnCSV.disabled=vazio; btnJSON.disabled=vazio; btnLimpar.disabled=vazio; if (btnCal) btnCal.disabled=vazio;
  count.textContent = `(${resultados.length} itens)`;
}
function renderizar(){
  atualizarBotoes();
  if (!resultados.length){ out.innerHTML=''; return; }
  resultados.forEach(r => r.marketplace = codeToName((r.marketplace_code||'UNK').toUpperCase()));

  const linhas = resultados.map((r,i)=>`
    <tr>
      <td class="mono">${escapeHtml(r.arquivo)}</td>
      <td>${r.loja ? escapeHtml(r.loja) : '—'}</td>
      <td class="market-cell" data-idx="${i}" title="Clique para editar">
        ${marketplaceBadge({code:r.marketplace_code})}
      </td>
      <td class="mono">${r.nfe_numero ? escapeHtml(r.nfe_numero) : '—'}</td>
    </tr>`).join('');
  out.innerHTML = `<div style="overflow-x:auto">
    <table style="width:100%; border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left; padding:8px 12px">Arquivo</th>
        <th style="text-align:left; padding:8px 12px">Loja</th>
        <th style="text-align:left; padding:8px 12px">Marketplace</th>
        <th style="text-align:left; padding:8px 12px">Número NFe</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;
}

// ====== Mini-editor de marketplace ======
out.addEventListener('click', (e) => {
  const cell = e.target.closest('td.market-cell'); if (!cell) return;
  if (cell.dataset.editing === '1') return;

  const idx = +cell.dataset.idx;
  const atual = (resultados[idx]?.marketplace_code || 'UNK').toUpperCase();

  const sel = document.createElement('select');
  ['ML','SHOPEE','UNK'].forEach(code=>{
    const o=document.createElement('option');
    o.value=code;
    o.textContent = codeToName(code);
    if(code===atual) o.selected=true;
    sel.appendChild(o);
  });

  sel.style.width='100%';
  sel.style.padding='8px 10px';
  sel.style.border='1px solid var(--border)';
  sel.style.borderRadius='8px';
  sel.className = 'mkt-editor';

  cell.dataset.editing = '1';
  const restore = () => { cell.dataset.editing = ''; };

  cell.innerHTML=''; cell.appendChild(sel); sel.focus();

  sel.addEventListener('click', (ev)=>ev.stopPropagation());
  sel.addEventListener('mousedown', (ev)=>ev.stopPropagation());

  const commit = () => {
    const code = (sel.value||'UNK').toUpperCase();
    resultados[idx].marketplace_code = code;
    resultados[idx].marketplace      = codeToName(code);
    cell.innerHTML = marketplaceBadge({code});
    restore();
  };
  const cancel = () => {
    cell.innerHTML = marketplaceBadge({code: resultados[idx].marketplace_code});
    restore();
  };

  sel.addEventListener('change', commit);
  sel.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Enter'){ ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape'){ ev.preventDefault(); cancel(); }
  });
});

// ====== Upload / DnD ======
// Propagação por arquivo: se QUALQUER parte (ou o arquivo bruto) tiver “Logo Meli”, forçamos ML
async function processarArquivos(fileList){
  if (!fileList?.length) return;
  uploadLabel?.classList.add('loading');

  for (const f of Array.from(fileList)){
    const raw = await f.text();
    const parts = splitZplLabels(raw);

    // 1) parse cada parte
    const parsed = parts.map((p,i) => {
      const base = parseUmArquivo(`${f.name}#${String(i+1).padStart(2,'0')}`, p);
      return { ...base, __content: p };
    });

    // 2) se QUALQUER parte OU o próprio arquivo tiver “Logo Meli” => arquivo é ML
    const fileIsML =
      hasLogoMeli(raw) ||
      parsed.some(it => hasLogoMeli(it.__content) || hasLogoMeli(decodeZplEscapes(it.__content || '')));

    // 3) propaga para todas as partes (principalmente a DANFE com a NFe)
    if (fileIsML) {
      parsed.forEach(it => {
        it.marketplace_code = 'ML';
        it.marketplace      = codeToName('ML');
        it.marketplace_raw  = 'ML';
        it.marketplace_detected = true;
      });
    }

    // 4) salva respeitando a flag IGNORAR_SEM_NFE
    parsed.forEach(it => {
      delete it.__content;
      if (!IGNORAR_SEM_NFE || it.nfe_numero) resultados.push(it);
    });
  }

  resultados = dedupeByNFe(resultados);
  uploadLabel?.classList.remove('loading','drag-over');
  renderizar();
}

btnPickFiles?.addEventListener('click',()=>inputFiles?.click());
btnPickDir?.addEventListener('click',()=>inputDir?.click());
inputFiles?.addEventListener('change',e=>processarArquivos(e.target.files));
inputDir?.addEventListener('change',e=>processarArquivos(e.target.files));
;['dragenter','dragover'].forEach(ev=>{
  uploadLabel?.addEventListener(ev,(e)=>{e.preventDefault(); uploadLabel.classList.add('drag-over');});
});
;['dragleave','drop'].forEach(ev=>{
  uploadLabel?.addEventListener(ev,(e)=>{e.preventDefault(); uploadLabel.classList.remove('drag-over');});
});
uploadLabel?.addEventListener('drop',(e)=>{ const dt=e.dataTransfer; if(dt?.files) processarArquivos(dt.files); });

// ====== Exportações ======
function csvCell(v){ return v==null ? '""' : `"${String(v).replaceAll('"','""')}"`; }
btnCSV?.addEventListener('click',()=>{
  const headers=['arquivo','loja','marketplace','marketplace_code','nfe_numero'];
  const linhas=[headers.join(',')].concat(
    resultados.map(r=>headers.map(h=>csvCell(r[h])).join(','))
  );
  const blob=new Blob([linhas.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:'nfe-extraidas.csv'});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
});
btnJSON?.addEventListener('click', async ()=>{
  const exportJson = resultados.map(({arquivo,loja,marketplace,marketplace_code,nfe_numero}) =>
    ({arquivo,loja,marketplace,marketplace_code,nfe_numero})
  );
  const txt=JSON.stringify(exportJson,null,2);
  try{
    await navigator.clipboard.writeText(txt);
    const old=btnJSON.textContent; btnJSON.textContent='Copiado!'; btnJSON.classList.add('success-animation');
    setTimeout(()=>{btnJSON.textContent=old; btnJSON.classList.remove('success-animation');},1200);
  }catch{
    const blob=new Blob([txt],{type:'application/json'}); const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:'nfe-extraidas.json'});
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
});
btnLimpar?.addEventListener('click',()=>{ resultados=[]; renderizar(); });

// ====== Calendário (Supabase + LocalStorage) ======
const calTodayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

(function initCalDateInput(){
  if (!calDateInput) return;
  const saved = localStorage.getItem('selectedCalendarDate');
  calDateInput.value = saved || calTodayISO();
  calDateInput.addEventListener('change', () => {
    if (calDateInput.value) localStorage.setItem('selectedCalendarDate', calDateInput.value);
  });
})();

function getSelectedDateISO(){
  const v = calDateInput?.value;
  return (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : calTodayISO();
}

function calGetStore(){ try { return JSON.parse(localStorage.getItem('labelsByDate')||'{}'); } catch { return {}; } }
function calSetStore(obj){ localStorage.setItem('labelsByDate', JSON.stringify(obj)); }

function mergeInLocalCalendar(dateISO, rows){
  const store = calGetStore();
  const prev  = Array.isArray(store[dateISO]) ? store[dateISO] : [];
  store[dateISO] = dedupeByNFe(
    prev.concat(rows).map(r => ({
      arquivo: r.arquivo,
      loja: r.loja ?? null,
      marketplace: codeToName((r.marketplace_code || 'UNK').toUpperCase()),
      marketplace_code: (r.marketplace_code || 'UNK').toUpperCase(),
      nfe_numero: normalizeNFe(r.nfe_numero),
    }))
  );
  calSetStore(store);
}

function flashSuccess(btn, txt='Enviado!'){
  const old = btn.textContent;
  btn.textContent = txt;
  btn.classList.add('success-animation');
  setTimeout(()=>{ btn.textContent = old; btn.classList.remove('success-animation'); }, 1200);
}

btnCal?.addEventListener('click', async () => {
  if (!resultados.length) return;

  const dateISO = getSelectedDateISO();

  const rows = resultados
    .filter(r => !IGNORAR_SEM_NFE || r.nfe_numero)
    .map(r => ({
      date: dateISO,
      arquivo: r.arquivo,
      loja: r.loja ?? null,
      marketplace_code: (r.marketplace_code || 'UNK').toUpperCase(),
      marketplace: codeToName((r.marketplace_code || 'UNK').toUpperCase()),
      nfe_numero: normalizeNFe(r.nfe_numero),
    }));

  mergeInLocalCalendar(dateISO, rows);
  flashSuccess(btnCal, 'Salvo local');

  try {
    const { error } = await supabase
      .from('labels')
      .upsert(rows, { onConflict: 'date,nfe_numero' });
    if (error) throw error;
    flashSuccess(btnCal, 'Enviado!');
  } catch (err) {
    console.error('Supabase upsert falhou:', err);
    alert('Salvei no calendário local, mas houve erro ao gravar no banco: ' + (err.message || err));
  }
});

// inicial
renderizar();
