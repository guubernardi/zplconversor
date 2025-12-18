(() => {
  'use strict';

  // ====== Config ======
  const IGNORAR_SEM_NFE = true;
  const DEFAULT_MARKETPLACE = 'SHOPEE'; // SHOPEE | ML | MAGALU | TIKTOK | UNK

  const MARKETPLACE_EMOJI = { ML:'🤝', SHOPEE:'🛒', MAGALU:'🛍️', TIKTOK:'🎵', UNK:'❓' };
  const MARKETPLACE_LOGOS = {
    ML:'./logos/mercado-livre.svg',
    SHOPEE:'./logos/shopee.svg',
    MAGALU:'./logos/magalu.svg',
    TIKTOK:'./logos/tiktok.svg',
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
    if (c === 'MAGALU') return 'Magalu';
    if (c === 'TIKTOK') return 'TikTok Shop';
    if (c === 'SHOPEE') return 'Shopee';
    return 'Desconhecido';
  }

  // Dedupe por NFe (mantém 1 por NF e escolhe o mais “confiável”)
  function dedupeByNFe(arr) {
    const rank = { ML:4, MAGALU:3, TIKTOK:3, SHOPEE:2, UNK:1 };
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
    let t = s.replace(/\^FH\\?/g, '').replace(/\\&/g, '%26');
    t = t.replace(/\\([0-9A-Fa-f]{2})/g, '%$1').replace(/_([0-9A-Fa-f]{2})/g, '%$1');
    try { return decodeURIComponent(t); } catch { return s; }
  }

  // sem lookbehind (Safari safe)
  function splitZplLabels(zpl) {
    if (!zpl) return [];
    const parts = [];
    const re = /\^XA[\s\S]*?\^XZ/g;
    let m;
    while ((m = re.exec(zpl)) !== null) parts.push(m[0].trim());
    return parts.length ? parts : [zpl];
  }

  // Detect marketplace
  function hasLogoMeli(text) {
    if (!text) return false;
    return (
      /\^FX\s*Logo\s*Meli(?:\b|\s*\^FS)/i.test(text) ||
      /\blogo\s*meli(?:\b|\s*\^FS)/i.test(text) ||
      /logo.{0,20}meli/i.test(text) ||
      /\bmercado\s*l[ií]vre\b/i.test(text) ||
      /\bmeli\b/i.test(text) ||
      /mercadolivre\.com/i.test(text)
    );
  }
  function hasMagalu(text) {
    if (!text) return false;
    return (
      /\bmagalu\b/i.test(text) ||
      /magazine\s*luiza/i.test(text) ||
      /magazineluiza\.com/i.test(text) ||
      /parceiro\s*(magalu|mlz)/i.test(text) ||
      /logo[_\s-]*magalu/i.test(text)
    );
  }
  function hasTikTok(text) {
    if (!text) return false;
    return (
      /\btik\s*tok\b/i.test(text) ||
      /\btiktok\s*shop\b/i.test(text) ||
      /shop\.tiktok\./i.test(text) ||
      /\btt\s*shop\b/i.test(text) ||
      /logo[_\s-]*tiktok/i.test(text)
    );
  }
  function scanCode(text) {
    const raw = text || '';
    const dec = decodeZplEscapes(text) || '';
    if (hasLogoMeli(raw) || hasLogoMeli(dec))   return 'ML';
    if (hasMagalu(raw)   || hasMagalu(dec))     return 'MAGALU';
    if (hasTikTok(raw)   || hasTikTok(dec))     return 'TIKTOK';
    return null;
  }
  function detectMarketplace(text) {
    const code = scanCode(text);
    if (code) return { code, detected: true };
    const def = (DEFAULT_MARKETPLACE || 'UNK').toUpperCase();
    return { code: def, detected: false };
  }

  function normalizeLojaName(name){
    if (!name) return name;
    let s = String(name).trim().replace(/^\^?FD/i, '');
    return s.trim().replace(/\s+/g, ' ');
  }

  function extractLoja(text){
    const t = decodeZplEscapes(text) || '';

    let m = t.match(/([A-Za-zÀ-ÿ0-9 ._\-]{3,}?)\s*#\d{6,}/);
    if (m) return normalizeLojaName(m[1]);

    const fds = [...t.matchAll(/\^FD([^\^]*)\^FS/g)].map(x=>x[1].trim());
    const idxCnpj = fds.findIndex(s => /CNPJ\s*:/i.test(s));
    if (idxCnpj > 0) {
      const lojaPrev = fds[idxCnpj - 1];
      if (lojaPrev && lojaPrev.length >= 5) return normalizeLojaName(lojaPrev);
    }

    const campo = fds.find(s => /(Raz[aã]o Social|Nome Fantasia|Vendedor|Loja|Seller)\s*:/i.test(s));
    if (campo){
      const nome = campo.split(/:/).slice(1).join(':').trim();
      if (nome) return normalizeLojaName(nome);
    }

    const emit = fds.find(s => /^Emitente\s*:/i.test(s));
    if (emit){
      const nome = emit.split(/:/).slice(1).join(':').trim();
      if (nome) return normalizeLojaName(nome);
    }

    const cand = fds.find(s =>
      /^[A-ZÀ-Ÿ0-9 .&\-]{6,}$/.test(s) &&
      !/DANFE|Etiqueta|Data|TIPO:|Protocolo|IE:|Endere|Rua|Avenida|CEP|CPF|CNPJ|NF(?:e)?:|Chave/i.test(s)
    );
    return cand ? normalizeLojaName(cand) : null;
  }

  // ====== EXTRAÇÃO NFe (bem reforçada) ======
  function extractAccessKey44(text) {
    const t = decodeZplEscapes(text) || '';
    const re = /(?:\d[\s\-]*){44}/g;
    for (const m of t.matchAll(re)) {
      const digits = (m[0] || '').replace(/\D/g, '');
      if (digits.length === 44) return digits;
    }
    const pure = t.match(/\b\d{44}\b/);
    return pure ? pure[0] : null;
  }

  function nfeNumberFromAccessKey(key44) {
    if (!key44 || String(key44).length !== 44) return null;
    const nNF9 = String(key44).slice(25, 34);
    return normalizeNFe(nNF9);
  }

  function extractNFe(text){
    const t = decodeZplEscapes(text) || '';

    let m =
      t.match(/\bNF\s*-\s*e\s*[:#]?\s*([0-9]{3,})\b/i) ||
      t.match(/\bNFE\s*[:#]?\s*([0-9]{3,})\b/i) ||
      t.match(/\bNFe\s*[:#]?\s*([0-9]{3,})\b/i) ||
      t.match(/\bNF\s*[:#]?\s*([0-9]{3,})\b/i);
    if (m) return m[1];

    m =
      t.match(/\bNota\s*Fiscal(?:\s*Eletr[oô]nica)?\s*[:#]?\s*([0-9]{3,})\b/i) ||
      t.match(/\bN[úu]mero\s*da\s*NF(?:-e)?\s*[:#]?\s*([0-9]{3,})\b/i);
    if (m) return m[1];

    const key44 = extractAccessKey44(t);
    const fromKey = nfeNumberFromAccessKey(key44);
    if (fromKey) return fromKey;

    return null;
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
  function escapeHtml(s){
    s = (s == null) ? '' : String(s);
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function marketplaceBadge({code}){
    const c = (code || 'UNK').toUpperCase();
    const label = escapeHtml(codeToName(c));
    const file  = MARKETPLACE_LOGOS[c];
    const emoji = MARKETPLACE_EMOJI[c] || '❓';
    const cls = (c==='ML') ? 'mkt-ml'
             : c==='SHOPEE' ? 'mkt-shopee'
             : c==='MAGALU' ? 'mkt-magalu'
             : c==='TIKTOK' ? 'mkt-tiktok'
             : 'mkt-unk';
    const img   = file ? `<img class="logo-mkt" src="${file}" alt="" onerror="this.remove()">` : '';
    return `<span class="mkt-pill ${cls}">${img}<span class="mkt-emoji">${emoji}</span> ${label}</span>`;
  }

  let resultados = [];
  let lastReadSummary = { files: 0, labels: 0, ignoredNoNfe: 0 };

  function setEmptyMessage(msg){
    if (!out) return;
    out.innerHTML = `<div style="padding:28px; text-align:center; color:#64748b;">${msg}</div>`;
  }

  function atualizarBotoes(){
    const vazio = resultados.length===0;

    btnCSV && (btnCSV.disabled = vazio);
    btnJSON && (btnJSON.disabled = vazio);
    btnLimpar && (btnLimpar.disabled = vazio);

    const temComNfe = resultados.some(r => !!r.nfe_numero);
    btnCal && (btnCal.disabled = vazio || !temComNfe);

    const extra = (IGNORAR_SEM_NFE && lastReadSummary.ignoredNoNfe)
      ? ` • ${lastReadSummary.ignoredNoNfe} ignorado(s) sem NFe`
      : '';
    count && (count.textContent = `(${resultados.length} itens${extra})`);
  }

  function renderizar(){
    atualizarBotoes();
    if (!out) return;

    if (!resultados.length) {
      if (lastReadSummary.files > 0 && lastReadSummary.labels > 0 && lastReadSummary.ignoredNoNfe > 0) {
        setEmptyMessage(`
          Li <strong>${lastReadSummary.labels}</strong> etiqueta(s) de <strong>${lastReadSummary.files}</strong> arquivo(s),
          mas não achei <strong>NFe</strong> / <strong>chave de acesso</strong> nelas — e como
          <code>IGNORAR_SEM_NFE</code> está <strong>true</strong>, descartei tudo.
        `);
      } else {
        setEmptyMessage('Nenhum resultado ainda. Faça upload de um arquivo ZPL para começar. 📦');
      }
      return;
    }

    const linhas = resultados.map((r,i)=>`
      <tr>
        <td class="mono">${escapeHtml(r.arquivo)}</td>
        <td>${r.loja ? escapeHtml(r.loja) : '—'}</td>
        <td class="market-cell" data-idx="${i}" title="Clique para editar">
          ${marketplaceBadge({code:r.marketplace_code})}
        </td>
        <td class="mono">${r.nfe_numero ? escapeHtml(r.nfe_numero) : '<span style="color:#ef4444;font-weight:600">—</span>'}</td>
      </tr>`).join('');

    out.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%; border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border,#e2e8f0)">
          <th style="text-align:left; padding:8px 12px">Arquivo</th>
          <th style="text-align:left; padding:8px 12px">Loja</th>
          <th style="text-align:left; padding:8px 12px">Marketplace</th>
          <th style="text-align:left; padding:8px 12px">Número NFe</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>`;
  }

  // ====== Mini-editor de marketplace ======
  if (out) {
    out.addEventListener('click', (e) => {
      const cell = e.target.closest('td.market-cell'); if (!cell) return;
      if (cell.dataset.editing === '1') return;

      const idx = +cell.dataset.idx;
      const atual = (resultados[idx]?.marketplace_code || 'UNK').toUpperCase();

      const sel = document.createElement('select');
      ['ML','MAGALU','TIKTOK','SHOPEE','UNK'].forEach(code=>{
        const o=document.createElement('option');
        o.value=code;
        o.textContent = codeToName(code);
        if(code===atual) o.selected=true;
        sel.appendChild(o);
      });

      sel.style.width='100%';
      sel.style.padding='8px 10px';
      sel.style.border='1px solid var(--border,#e2e8f0)';
      sel.style.borderRadius='8px';

      cell.dataset.editing = '1';
      const restore = () => { cell.dataset.editing = ''; };

      cell.innerHTML=''; cell.appendChild(sel); sel.focus();

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
  }

  // ====== Upload / DnD ======
  async function processarArquivos(fileList){
    if (!fileList?.length) return;

    uploadLabel?.classList.add('loading');
    lastReadSummary = { files: 0, labels: 0, ignoredNoNfe: 0 };

    try {
      const files = Array.from(fileList);
      lastReadSummary.files = files.length;

      for (const f of files){
        const raw = await f.text();
        const parts = splitZplLabels(raw);
        lastReadSummary.labels += parts.length;

        const parsed = parts.map((p,i) => {
          const base = parseUmArquivo(`${f.name}#${String(i+1).padStart(2,'0')}`, p);
          return { ...base, __content: p };
        });

        // “Propaga” marketplace forte do arquivo
        let fileCode = scanCode(raw);
        if (!fileCode) {
          for (const it of parsed) {
            const c = scanCode(it.__content);
            if (c) { fileCode = c; break; }
          }
        }
        if (fileCode) {
          parsed.forEach(it => {
            it.marketplace_code = fileCode;
            it.marketplace      = codeToName(fileCode);
            it.marketplace_raw  = fileCode;
            it.marketplace_detected = true;
          });
        }

        parsed.forEach(it => {
          delete it.__content;
          if (!IGNORAR_SEM_NFE || it.nfe_numero) {
            resultados.push(it);
          } else {
            lastReadSummary.ignoredNoNfe++;
          }
        });
      }

      resultados = dedupeByNFe(resultados);
    } catch (err) {
      console.error('Erro ao processar arquivos:', err);
      alert('Deu erro lendo o arquivo. Abre o console (F12) pra ver.\n\n' + (err?.message || err));
    } finally {
      uploadLabel?.classList.remove('loading','drag-over');
      renderizar();
    }
  }

  // Botões
  btnPickFiles?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!inputFiles) return;
    inputFiles.value = '';
    inputFiles.click();
  });
  btnPickDir?.addEventListener('click', (e)=> {
    e.preventDefault();
    if (!inputDir) return;
    inputDir.value = '';
    inputDir.click();
  });

  // Clique no label grande também abre seletor
  uploadLabel?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!inputFiles) return;
    inputFiles.value = '';
    inputFiles.click();
  });

  // DnD
  ['dragenter','dragover'].forEach(ev=>{
    uploadLabel?.addEventListener(ev,(e)=>{ e.preventDefault(); uploadLabel.classList.add('drag-over'); });
  });
  ['dragleave','drop'].forEach(ev=>{
    uploadLabel?.addEventListener(ev,(e)=>{ e.preventDefault(); uploadLabel.classList.remove('drag-over'); });
  });
  uploadLabel?.addEventListener('drop',(e)=>{ const dt=e.dataTransfer; if(dt?.files) processarArquivos(dt.files); });

  // Inputs
  inputFiles?.addEventListener('change',e=>processarArquivos(e.target.files));
  inputDir  ?.addEventListener('change',e=>processarArquivos(e.target.files));

  // ====== Exportações ======
  function csvCell(v){ v = (v == null) ? '' : String(v); return `"${v.replace(/"/g,'""')}"`; }

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
      const old=btnJSON.textContent; btnJSON.textContent='Copiado!';
      btnJSON.classList.add('success-animation');
      setTimeout(()=>{btnJSON.textContent=old; btnJSON.classList.remove('success-animation');},1200);
    }catch{
      const blob=new Blob([txt],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=Object.assign(document.createElement('a'),{href: url,download:'nfe-extraidas.json'});
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
    }
  });

  btnLimpar?.addEventListener('click',()=>{
    resultados=[]; lastReadSummary={files:0,labels:0,ignoredNoNfe:0};
    renderizar();
  });

  // ====== Calendário (LocalStorage) ======
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
  function calSetStore(obj){ localStorage.setItem('labelsByDate', JSON.stringify(obj || {})); }

  // ✅ Anti-duplicação + aviso (não duplica NFe no mesmo dia)
  function mergeInLocalCalendar(dateISO, rows){
    const store = calGetStore();
    const prev  = Array.isArray(store[dateISO]) ? store[dateISO] : [];

    // NFes que já existem nesse dia
    const existing = new Set(
      prev.map(r => normalizeNFe(r.nfe_numero)).filter(Boolean)
    );

    // 1) remove duplicadas dentro do batch (rows)
    const seenBatch = new Set();
    const dedupBatch = [];
    const dupInBatch = [];

    for (const r of rows) {
      const nf = normalizeNFe(r.nfe_numero);
      r.nfe_numero = nf;

      if (!nf) { dedupBatch.push(r); continue; }

      if (seenBatch.has(nf)) {
        dupInBatch.push(nf);
        continue;
      }
      seenBatch.add(nf);
      dedupBatch.push(r);
    }

    // 2) remove duplicadas contra o que já estava salvo
    const toAdd = [];
    const dupExisting = [];

    for (const r of dedupBatch) {
      const nf = normalizeNFe(r.nfe_numero);
      if (nf && existing.has(nf)) {
        dupExisting.push(nf);
        continue;
      }
      if (nf) existing.add(nf);

      toAdd.push({
        arquivo: r.arquivo,
        loja: r.loja ?? null,
        marketplace: codeToName((r.marketplace_code || 'UNK').toUpperCase()),
        marketplace_code: (r.marketplace_code || 'UNK').toUpperCase(),
        nfe_numero: nf,
      });
    }

    store[dateISO] = prev.concat(toAdd);
    calSetStore(store);

    return {
      added: toAdd.length,
      total: store[dateISO].length,
      duplicates: Array.from(new Set([...dupInBatch, ...dupExisting])).filter(Boolean)
    };
  }

  function flashSuccess(btn, txt='Salvo!'){
    const old = btn.textContent;
    btn.textContent = txt;
    btn.classList.add('success-animation');
    setTimeout(()=>{ btn.textContent = old; btn.classList.remove('success-animation'); }, 1200);
  }

  btnCal?.addEventListener('click', () => {
    const comNfe = resultados.filter(r => !!r.nfe_numero);
    if (!comNfe.length) {
      alert('Não tem nenhum item com NFe pra enviar pro calendário. (As etiquetas podem não conter NFe/chave.)');
      return;
    }

    const dateISO = getSelectedDateISO();
    const rows = comNfe.map(r => ({
      arquivo: r.arquivo,
      loja: r.loja ?? null,
      marketplace_code: (r.marketplace_code || 'UNK').toUpperCase(),
      marketplace: codeToName((r.marketplace_code || 'UNK').toUpperCase()),
      nfe_numero: normalizeNFe(r.nfe_numero),
    }));

    const info = mergeInLocalCalendar(dateISO, rows);

    flashSuccess(btnCal, info.added ? `Salvo (+${info.added})` : 'Nada novo');

    if (info.duplicates.length) {
      const lista = info.duplicates.slice(0, 20).join(', ');
      const extra = info.duplicates.length > 20 ? `\n(+${info.duplicates.length - 20} outras)` : '';
      alert(`⚠️ Nota(s) duplicada(s) detectada(s) e NÃO adicionada(s):\n${lista}${extra}`);
    }


    window.location.href = `pedidos.html?d=${dateISO}`;
  });

  // inicial
  renderizar();
})();
