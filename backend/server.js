// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

// --- middlewares
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// (opcional) sirva uma pasta "public" se quiser abrir pelo http://localhost:3001/zpl.html
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- banco
const DB_FILE = path.join(__dirname, 'data', 'labels.db');
const db = new Database(DB_FILE);

// cria tabela
db.exec(`
  CREATE TABLE IF NOT EXISTS labels (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    date_iso              TEXT NOT NULL,
    arquivo               TEXT,
    loja                  TEXT,
    marketplace           TEXT,
    marketplace_code      TEXT,
    marketplace_raw       TEXT,
    marketplace_detected  INTEGER DEFAULT 0,
    nfe_numero            TEXT,
    score                 REAL DEFAULT 0,
    created_at            TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_labels_date ON labels(date_iso);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_date_nfe ON labels(date_iso, nfe_numero);
`);

// rank p/ escolha do melhor item
const RANK = { ML: 4, MAGALU: 3, SHOPEE: 2, UNK: 1 };
const keyLoja = s => (s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const onlyDigits = s => (s == null ? null : String(s).replace(/\D+/g, ''));
const normalizeNFe = nfe => {
  if (nfe == null) return null;
  const digits = onlyDigits(nfe);
  if (!digits) return null;
  const trimmed = digits.replace(/^0+/, '');
  return trimmed || '0';
};
const calcScore = it => {
  const base = RANK[it.marketplace_raw] || RANK[it.marketplace_code] || 0;
  const detected = it.marketplace_detected ? 1 : 0;
  const lojaBonus = keyLoja(it.loja).length / 100; // desempate leve
  return base * 10 + detected + lojaBonus;
};

// upsert com score
const insertStmt = db.prepare(`
  INSERT INTO labels
    (date_iso, arquivo, loja, marketplace, marketplace_code, marketplace_raw, marketplace_detected, nfe_numero, score)
  VALUES
    (@date_iso, @arquivo, @loja, @marketplace, @marketplace_code, @marketplace_raw, @marketplace_detected, @nfe_numero, @score)
  ON CONFLICT(date_iso, nfe_numero) DO UPDATE SET
    arquivo = CASE WHEN excluded.score > labels.score THEN excluded.arquivo ELSE labels.arquivo END,
    loja    = CASE WHEN excluded.score > labels.score THEN excluded.loja    ELSE labels.loja    END,
    marketplace = CASE WHEN excluded.score > labels.score THEN excluded.marketplace ELSE labels.marketplace END,
    marketplace_code = CASE WHEN excluded.score > labels.score THEN excluded.marketplace_code ELSE labels.marketplace_code END,
    marketplace_raw  = CASE WHEN excluded.score > labels.score THEN excluded.marketplace_raw  ELSE labels.marketplace_raw  END,
    marketplace_detected = CASE WHEN excluded.score > labels.score THEN excluded.marketplace_detected ELSE labels.marketplace_detected END,
    score   = CASE WHEN excluded.score > labels.score THEN excluded.score   ELSE labels.score   END
  WHERE excluded.score > labels.score
`);

// ---------------- API ----------------

// importa etiquetas de um dia
// body: { dateISO?: "YYYY-MM-DD", items: [...] }
app.post('/api/labels/import', (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const d = req.body.dateISO || new Date().toISOString().slice(0, 10);

    let upserts = 0;
    const trx = db.transaction((arr) => {
      for (const it of arr) {
        const nfe = normalizeNFe(it.nfe_numero);
        if (!nfe) continue; // ignorar sem NFe

        const row = {
          date_iso: d,
          arquivo: it.arquivo || null,
          loja: it.loja || null,
          marketplace: it.marketplace || null,
          marketplace_code: it.marketplace_code || null,
          marketplace_raw: it.marketplace_raw || it.marketplace_code || null,
          marketplace_detected: it.marketplace_detected ? 1 : 0,
          nfe_numero: nfe,
        };
        row.score = calcScore(row);
        insertStmt.run(row);
        upserts++;
      }
    });

    trx(items);
    res.json({ ok: true, upserts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'import_failed' });
  }
});

// lista etiquetas de um dia
app.get('/api/labels/day/:iso', (req, res) => {
  const iso = req.params.iso;
  const rows = db.prepare(
    `SELECT id, date_iso, arquivo, loja, marketplace, marketplace_code, marketplace_raw,
            marketplace_detected, nfe_numero
     FROM labels
     WHERE date_iso = ?
     ORDER BY marketplace_code, nfe_numero`
  ).all(iso);
  res.json({ date: iso, items: rows });
});

// apaga todas de um dia
app.delete('/api/labels/day/:iso', (req, res) => {
  const iso = req.params.iso;
  const info = db.prepare('DELETE FROM labels WHERE date_iso = ?').run(iso);
  res.json({ ok: true, deleted: info.changes });
});

// resumo por mês (para pintar o calendário)
// GET /api/labels/summary?year=2025&month=10
app.get('/api/labels/summary', (req, res) => {
  const y = Number(req.query.year);
  const m = Number(req.query.month);
  if (!y || !m) return res.status(400).json({ ok: false, error: 'invalid_params' });

  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 0).getDate(); // último dia do mês
  const end = `${y}-${String(m).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;

  const rows = db.prepare(
    `SELECT date_iso, marketplace_code, COUNT(*) as c
     FROM labels
     WHERE date_iso BETWEEN ? AND ?
     GROUP BY date_iso, marketplace_code`
  ).all(start, end);

  const days = {};
  for (const r of rows) {
    if (!days[r.date_iso]) days[r.date_iso] = { total: 0, ML: 0, SHOPEE: 0, MAGALU: 0, UNK: 0 };
    days[r.date_iso].total += r.c;
    const code = (r.marketplace_code || 'UNK').toUpperCase();
    if (days[r.date_iso][code] != null) days[r.date_iso][code] += r.c;
    else days[r.date_iso].UNK += r.c;
  }
  res.json({ days });
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
