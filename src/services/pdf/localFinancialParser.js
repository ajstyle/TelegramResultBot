'use strict';

/**
 * Zero-API Local Financial PDF Extractor
 * Parses SEBI Ind-AS quarterly result PDFs — no API, no network calls.
 * Output schema identical to geminiAnalyzer.
 *
 * Key insight: Most Indian company PDFs (pdf-parse output) have each table cell on its OWN line.
 * Row labels are also split across 1-5 lines.
 * Algorithm:
 *   1. Locate all date-column-header clusters (runs of 3+ DD.MM.YYYY lines)
 *   2. For each table, scan every line and its next 5 joined lines for row keywords
 *   3. Once keyword found, skip non-numeric label continuation lines (max 8 skips)
 *   4. Collect next 3 pure-number lines as Q_t, Q_t1, Q_t4
 *   5. Prefer consolidated (last table with high score)
 */

const axios    = require('axios');
const pdfParse = require('pdf-parse');

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Row definitions ───────────────────────────────────────────────────────────
// Patterns must match across joined multi-line contexts
const ROWS = [
  {
    key: 'revenue',
    tests: [
      (s) => /revenue\s+from\s+oper/i.test(s),
      (s) => /income\s+from\s+oper/i.test(s),
      (s) => /\bnet\s+sales\b/i.test(s),
    ],
  },
  {
    key: 'other_inc',
    tests: [(s) => /other\s+income/i.test(s)],
  },
  {
    key: 'total_exp',
    tests: [
      (s) => /total\s+expens/i.test(s),
      (s) => /total\s+expenditure/i.test(s),
    ],
  },
  {
    key: 'finance_cost',
    tests: [
      (s) => /finance\s+costs?/i.test(s),
      (s) => /interest\s+expense/i.test(s),
    ],
  },
  {
    key: 'depreciation',
    tests: [
      (s) => /depreciation\s+and\s+amortis/i.test(s),
      (s) => /depreciation\s+and\s+amortiz/i.test(s),
    ],
  },
  {
    key: 'pat',
    tests: [
      (s) => /profit\s+for\s+the\s+(?:period|year)/i.test(s),
      (s) => /profit\s*\/\s*\(loss\)\s+for\s+the/i.test(s),
      (s) => /\(loss\)\s*\/\s*profit\s+for\s+the/i.test(s),
      (s) => /net\s+profit\s+for\s+the/i.test(s),
    ],
  },
  {
    key: 'eps',
    tests: [
      (s) => /basic\s+and\s+diluted\s+earn/i.test(s),
      (s) => /basic\s+earnings?\s+per\s+(?:equity\s+)?share/i.test(s),
      (s) => /earnings?\s+per\s+(?:equity\s+)?share/i.test(s),
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseNum(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s || s === '-') return null;
  // Parenthesized negative: (3.38) or ( 3.38 )
  const neg = s.match(/^\(\s*([0-9,.]+)\s*\)$/);
  if (neg) { const v = parseFloat(neg[1].replace(/,/g, '')); return isNaN(v) ? null : -v; }
  const v = parseFloat(s.replace(/,/g, ''));
  return isNaN(v) ? null : v;
}

function isNumLine(line) {
  const t = line.trim();
  if (!t || t === '-') return false;
  // Match: pure number (with optional commas), OR parenthesized negative
  return /^[-+]?[\d,]+\.?\d*$/.test(t) || /^\(\s*[\d,.]+\s*\)$/.test(t);
}

function detectUnit(text) {
  const u = text.toUpperCase();
  if (/IN\s+CRORES?|RS\.?\s*IN\s+CRORES?|\(RS\.?\s*IN\s+CR/.test(u)) return 1.0;
  if (/IN\s+LAKHS?|RS\.?\s*IN\s+LAKHS?|\(RS\.?\s*IN\s+LA/.test(u)) return 0.01;
  if (/IN\s+MILLIONS?/.test(u)) return 0.1;
  return 1.0;
}

function normDateLabel(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[A-Za-z]{3}\s*'\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!m) return s;
  const mi = parseInt(m[2], 10) - 1;
  return (mi >= 0 && mi < 12) ? `${MONTH_NAMES[mi]} '${m[3].slice(-2)}` : s;
}

// ─── Find all financial table start positions ─────────────────────────────────
function findTableStarts(lines) {
  const starts = [];
  for (let i = 0; i < lines.length - 3; i++) {
    const t0 = lines[i].trim();
    const t1 = (lines[i+1]||'').trim();
    const t2 = (lines[i+2]||'').trim();
    const isDate = (s) => /^\d{2}[./]\d{2}[./]\d{4}$/.test(s);
    if (isDate(t0) && isDate(t1) && isDate(t2)) {
      starts.push(i);
      i += 4; // skip ahead
    }
  }
  return starts;
}

// ─── Extract one table section ────────────────────────────────────────────────
function extractSection(lines, dateStartIdx, scale) {
  // Collect date headers
  const dateLines = [];
  for (let i = dateStartIdx; i < Math.min(dateStartIdx + 6, lines.length); i++) {
    if (/^\d{2}[./]\d{2}[./]\d{4}$/.test(lines[i].trim())) {
      dateLines.push(lines[i].trim());
    }
  }

  const periodLabels = {
    q_t:  normDateLabel(dateLines[0]),
    q_t1: normDateLabel(dateLines[1]),
    q_t4: normDateLabel(dateLines[2]),
  };

  // Find the first data line (past "Unaudited", "Audited", "Note 7" etc.)
  let dataStart = dateStartIdx + dateLines.length;
  while (dataStart < lines.length) {
    const t = lines[dataStart].trim().toUpperCase();
    if (!t || /^UNAUDITED|^AUDITED|^\(REFER|^NOTE\s*\d|^REFER\s*NOTE/.test(t) || /^\d+$/.test(t)) {
      dataStart++;
    } else {
      break;
    }
  }

  const extracted = {};
  const scanEnd = Math.min(dataStart + 350, lines.length);

  // Build a "joined window" array once (each element = current line joined with next 5)
  // This handles split labels like "Revenue \n from operations"
  for (let i = dataStart; i < scanEnd; i++) {
    const tCur = lines[i].trim();
    if (!tCur) continue;

    // Build joined context of up to 5 consecutive non-empty lines
    const contextLines = [];
    for (let j = i; j < Math.min(i + 6, scanEnd); j++) {
      const t = lines[j].trim();
      if (t) contextLines.push(t);
      if (contextLines.length >= 5) break;
    }
    const ctx = contextLines.join(' ').replace(/\s+/g, ' ');

    for (const row of ROWS) {
      if (extracted[row.key] !== undefined) continue;

      // Require the keyword to appear in the FIRST 3 lines of the window (tight anchor).
      // This prevents false matches where keyword is 5 lines ahead in the window
      // while earlier numeric lines (prior-row values) get accidentally collected.
      const tightCtx = contextLines.slice(0, 3).join(' ').replace(/\s+/g, ' ');
      if (!row.tests.some(fn => fn(tightCtx))) continue;

      // Keyword matched in context window starting at line i
      // Scan forward from line i+1 to collect pure-number lines
      // Allow up to 8 non-numeric continuation lines before the first number
      const nums = [];
      let j = i + 1;
      let nonNumSkips = 0;
      while (j < scanEnd && nums.length < 4) {
        const nt = lines[j].trim();
        if (!nt) { j++; continue; }
        if (isNumLine(nt)) {
          const v = parseNum(nt);
          if (v !== null) nums.push(v);
          nonNumSkips = 0; // Reset once we start getting numbers
        } else {
          if (nums.length > 0) break; // Stop after first non-num once collecting
          nonNumSkips++;
          if (nonNumSkips > 8) break;
        }
        j++;
      }

      if (nums.length >= 1) {
        extracted[row.key] = {
          q_t:  scale * nums[0],
          q_t1: nums.length >= 2 ? scale * nums[1] : 0,
          q_t4: nums.length >= 3 ? scale * nums[2] : 0,
        };
        break;
      }
    }
  }

  return { extracted, periodLabels };
}

// ─── Score & build output ─────────────────────────────────────────────────────
function scoreResult(ext) {
  const chk = (k, p) => {
    const r = ext[k];
    if (!r) return 0;
    const v = r[p];
    return (v !== undefined && v !== null && Math.abs(v) > 0) ? 1 : 0;
  };
  return chk('revenue','q_t') + chk('revenue','q_t1') + chk('revenue','q_t4')
       + (ext.pat ? 1 : 0) + (ext.eps ? 1 : 0)
       + chk('finance_cost','q_t') + chk('total_exp','q_t');
}

function buildPeriod(ext, pk) {
  const g = (k) => { const r = ext[k]; return r ? (r[pk] ?? 0) : 0; };
  const sales = g('revenue'), other_inc = g('other_inc');
  const total_exp = g('total_exp'), finance_cost = g('finance_cost');
  const depreciation = g('depreciation'), pat = g('pat'), eps = g('eps');
  let op = 0;
  if (total_exp > 0 && sales > 0) {
    op = sales - (total_exp - finance_cost - depreciation);
  }
  return { sales, other_inc, total_exp, finance_cost, depreciation, op, pat, eps };
}

// ─── Main parse ───────────────────────────────────────────────────────────────
function parseRawText(rawText, symbol) {
  if (!rawText || rawText.trim().length < 200) return null;

  const scale = detectUnit(rawText);
  const lines  = rawText.split('\n');

  const tableStarts = findTableStarts(lines);
  if (tableStarts.length === 0) {
    console.log(`[LocalParser] ${symbol}: No date-column headers found.`);
    return null;
  }

  // Extract all tables, pick best.
  // Tie-breaking: prefer later table (consolidated comes after standalone in most Indian PDFs).
  let bestExt = null, bestScore = -1, bestLabels = null;

  for (const ts of tableStarts) {
    const { extracted, periodLabels } = extractSection(lines, ts, scale);
    const score = scoreResult(extracted);
    if (score > bestScore ||
        (score === bestScore && score >= 3)) {
      // For equal scores, prefer later (consolidated) — update always if score >= threshold
      bestScore = score;
      bestExt = extracted;
      bestLabels = periodLabels;
    }
  }

  if (bestScore < 1 || !bestExt) {
    console.log(`[LocalParser] ${symbol}: Score=0 after scanning ${tableStarts.length} tables.`);
    return null;
  }

  const confidence = bestScore >= 5 ? 'HIGH' : bestScore >= 3 ? 'MEDIUM' : 'LOW';
  const q_t  = buildPeriod(bestExt, 'q_t');
  const q_t1 = buildPeriod(bestExt, 'q_t1');
  const q_t4 = buildPeriod(bestExt, 'q_t4');

  console.log(`[LocalParser] ${symbol}: score=${bestScore}/7 conf=${confidence} | Sales ${q_t.sales}/${q_t1.sales}/${q_t4.sales} | PAT=${q_t.pat} EPS=${q_t.eps}`);

  return {
    q_t, q_t1, q_t4,
    period_labels: bestLabels || {},
    is_financial_sector: false,
    extractionMethod: 'local-sequential',
    confidence,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────
class LocalFinancialParser {
  async analyzeFromBuffer(buffer, symbol) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 500) return null;
    let rawText = '';
    try {
      const parsed = await pdfParse(buffer, { max: 0 });
      rawText = (parsed.text || '').trim();
    } catch (_) {}
    if (!rawText || rawText.length < 200) return null;
    return this.analyzeFromText(rawText, symbol);
  }

  analyzeFromText(rawText, symbol) {
    return parseRawText(rawText, symbol);
  }

  async analyzeFromUrl(url, symbol) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      return await this.analyzeFromBuffer(Buffer.from(res.data), symbol);
    } catch (e) { return null; }
  }
}

module.exports = new LocalFinancialParser();
