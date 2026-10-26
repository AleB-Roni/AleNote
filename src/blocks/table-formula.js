// Formel-Engine für Tabellen (wie Excel, deutsch & englisch)
//
//   =A1+B2*2      =SUMME(B2:B5)      =WENN(A1>10;"groß";"klein")
//
// Zellbezüge: Spalte als Buchstabe, Zeile ab 1 (die Kopfzeile ist Zeile 1).
// Argumente werden mit ";" getrennt ("," geht auch, solange es kein Dezimalkomma ist).

import { stripHtml } from '../core/utils.js';

export const colName = (c) => {
  let s = '';
  for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};
export const colIndex = (name) => [...name.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const cellName = (r, c) => colName(c) + (r + 1);

const ERR = (code) => ({ error: code });
const isErr = (v) => v && typeof v === 'object' && 'error' in v;

/** Zahl aus Zelltext lesen: "1.234,5", "3,5", "12 €", "50 %" */
export function parseNumber(text) {
  if (typeof text === 'number') return text;
  let s = String(text ?? '').replace(/[\s €$]/g, '');
  if (!s) return null;
  let percent = false;
  if (s.endsWith('%')) { percent = true; s = s.slice(0, -1); }
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return percent ? n / 100 : n;
}

export function formatValue(v) {
  if (isErr(v)) return v.error;
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (typeof v === 'number') {
    if (!isFinite(v)) return '#DIV/0!';
    return v.toLocaleString('de-DE', { maximumFractionDigits: 10 });
  }
  return v == null ? '' : String(v);
}

// ---------- Tokenizer ----------
function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = rest.match(/^\d+(?:[.,]\d+)?(?:e[-+]?\d+)?/i)) && !/^\d+,\d+,/.test(rest)) {
      t.push({ type: 'num', value: Number(m[0].replace(',', '.')) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?(?![A-Za-zÄÖÜäöü(])/))) {
      const a = { r: Number(m[2]) - 1, c: colIndex(m[1]) };
      if (m[3]) t.push({ type: 'range', from: a, to: { r: Number(m[4]) - 1, c: colIndex(m[3]) } });
      else t.push({ type: 'ref', ...a });
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^[A-Za-zÄÖÜäöü_][A-Za-zÄÖÜäöü0-9_.]*/))) {
      const name = m[0].toUpperCase();
      if (name === 'WAHR' || name === 'TRUE') t.push({ type: 'bool', value: true });
      else if (name === 'FALSCH' || name === 'FALSE') t.push({ type: 'bool', value: false });
      else t.push({ type: 'name', value: name });
      i += m[0].length; continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new Error('#FEHLER!');
      t.push({ type: 'str', value: src.slice(i + 1, end) }); i = end + 1; continue;
    }
    if ((m = rest.match(/^(<>|<=|>=|[-+*/^&=<>(),;%])/))) { t.push({ type: 'op', value: m[0] }); i += m[0].length; continue; }
    throw new Error('#FEHLER!');
  }
  return t;
}

// ---------- Funktionen ----------
const flat = (args) => args.flat(Infinity);
const nums = (args) => flat(args).map((v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? null : parseNumber(v))).filter((v) => v != null);
const FUNCS = {
  SUMME: (a) => nums(a).reduce((s, v) => s + v, 0),
  MITTELWERT: (a) => { const n = nums(a); return n.length ? n.reduce((s, v) => s + v, 0) / n.length : ERR('#DIV/0!'); },
  MIN: (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
  MAX: (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
  ANZAHL: (a) => nums(a).length,
  ANZAHL2: (a) => flat(a).filter((v) => v !== '' && v != null).length,
  PRODUKT: (a) => nums(a).reduce((s, v) => s * v, 1),
  RUNDEN: (a) => { const f = 10 ** (toNum(a[1] ?? 0)); return Math.round(toNum(a[0]) * f) / f; },
  ABRUNDEN: (a) => { const f = 10 ** (toNum(a[1] ?? 0)); return Math.floor(toNum(a[0]) * f) / f; },
  AUFRUNDEN: (a) => { const f = 10 ** (toNum(a[1] ?? 0)); return Math.ceil(toNum(a[0]) * f) / f; },
  ABS: (a) => Math.abs(toNum(a[0])),
  WURZEL: (a) => Math.sqrt(toNum(a[0])),
  POTENZ: (a) => toNum(a[0]) ** toNum(a[1]),
  REST: (a) => toNum(a[0]) % toNum(a[1]),
  WENN: (a) => (truthy(a[0]) ? a[1] ?? true : a[2] ?? false),
  UND: (a) => flat(a).every(truthy),
  ODER: (a) => flat(a).some(truthy),
  NICHT: (a) => !truthy(a[0]),
  VERKETTEN: (a) => flat(a).map(formatValue).join(''),
  LÄNGE: (a) => formatValue(a[0]).length,
  GROSS: (a) => formatValue(a[0]).toUpperCase(),
  KLEIN: (a) => formatValue(a[0]).toLowerCase(),
  HEUTE: () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  JETZT: () => new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
  PI: () => Math.PI
};
// Englische Namen
Object.assign(FUNCS, {
  SUM: FUNCS.SUMME, AVERAGE: FUNCS.MITTELWERT, AVG: FUNCS.MITTELWERT, COUNT: FUNCS.ANZAHL, COUNTA: FUNCS.ANZAHL2, PRODUCT: FUNCS.PRODUKT,
  ROUND: FUNCS.RUNDEN, ROUNDDOWN: FUNCS.ABRUNDEN, ROUNDUP: FUNCS.AUFRUNDEN, SQRT: FUNCS.WURZEL, POWER: FUNCS.POTENZ, MOD: FUNCS.REST,
  IF: FUNCS.WENN, AND: FUNCS.UND, OR: FUNCS.ODER, NOT: FUNCS.NICHT, CONCAT: FUNCS.VERKETTEN, CONCATENATE: FUNCS.VERKETTEN,
  LEN: FUNCS.LÄNGE, LAENGE: FUNCS.LÄNGE, UPPER: FUNCS.GROSS, LOWER: FUNCS.KLEIN, TODAY: FUNCS.HEUTE, NOW: FUNCS.JETZT
});
export const FUNCTION_NAMES = Object.keys(FUNCS);

function toNum(v) {
  if (isErr(v)) throw new Error(v.error);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '' || v == null) return 0;
  const n = parseNumber(v);
  if (n == null) throw new Error('#WERT!');
  return n;
}
const truthy = (v) => (typeof v === 'string' ? v !== '' && v.toUpperCase() !== 'FALSCH' : !!(typeof v === 'number' ? v : v));

// ---------- Parser & Auswertung ----------
function evaluate(tokens, getCell) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.type === 'op' && peek().value === v;
  const next = () => tokens[pos++];
  const expect = (v) => { if (!isOp(v)) throw new Error('#FEHLER!'); pos++; };

  function comparison() {
    let left = concat();
    while (peek()?.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().value)) {
      const op = next().value;
      const right = concat();
      const [a, b] = typeof left === 'number' || typeof right === 'number' ? [toNumLoose(left), toNumLoose(right)] : [formatValue(left).toLowerCase(), formatValue(right).toLowerCase()];
      left = { '=': a === b, '<>': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op];
    }
    return left;
  }
  const toNumLoose = (v) => { const n = typeof v === 'number' ? v : parseNumber(v); return n == null ? formatValue(v).toLowerCase() : n; };
  function concat() {
    let left = additive();
    while (isOp('&')) { next(); left = formatValue(left) + formatValue(additive()); }
    return left;
  }
  function additive() {
    let left = term();
    while (isOp('+') || isOp('-')) { const op = next().value; const r = term(); left = op === '+' ? toNum(left) + toNum(r) : toNum(left) - toNum(r); }
    return left;
  }
  function term() {
    let left = power();
    while (isOp('*') || isOp('/')) {
      const op = next().value; const r = power();
      if (op === '/' && toNum(r) === 0) throw new Error('#DIV/0!');
      left = op === '*' ? toNum(left) * toNum(r) : toNum(left) / toNum(r);
    }
    return left;
  }
  function power() {
    const base = unary();
    if (isOp('^')) { next(); return toNum(base) ** toNum(power()); }
    return base;
  }
  function unary() {
    if (isOp('-')) { next(); return -toNum(unary()); }
    if (isOp('+')) { next(); return toNum(unary()); }
    let v = primary();
    while (isOp('%')) { next(); v = toNum(v) / 100; }
    return v;
  }
  function primary() {
    const t = next();
    if (!t) throw new Error('#FEHLER!');
    if (t.type === 'num' || t.type === 'str' || t.type === 'bool') return t.value;
    if (t.type === 'ref') { const v = getCell(t.r, t.c); if (isErr(v)) throw new Error(v.error); return v; }
    if (t.type === 'range') {
      const out = [];
      for (let r = Math.min(t.from.r, t.to.r); r <= Math.max(t.from.r, t.to.r); r++)
        for (let c = Math.min(t.from.c, t.to.c); c <= Math.max(t.from.c, t.to.c); c++) { const v = getCell(r, c); if (isErr(v)) throw new Error(v.error); out.push(v); }
      return out;
    }
    if (t.type === 'name') {
      const fn = FUNCS[t.value];
      if (!fn) throw new Error('#NAME?');
      expect('(');
      const args = [];
      if (!isOp(')')) {
        do { args.push(comparison()); } while ((isOp(';') || isOp(',')) && next());
      }
      expect(')');
      return fn(args);
    }
    if (t.type === 'op' && t.value === '(') { const v = comparison(); expect(')'); return v; }
    throw new Error('#FEHLER!');
  }

  const result = comparison();
  if (pos < tokens.length) throw new Error('#FEHLER!');
  if (Array.isArray(result)) return result[0] ?? '';
  return result;
}

/**
 * Berechnet alle Zellen einer Tabelle.
 * rows: 2D-Array mit HTML-Inhalten → liefert 2D-Array mit Anzeige-Werten (oder null für normale Zellen)
 */
export function computeTable(rows) {
  const cache = new Map();
  const visiting = new Set();
  const raw = (r, c) => stripHtml(rows[r]?.[c] ?? '').replace(/ /g, ' ').trim();
  const getCell = (r, c) => {
    const key = r + ':' + c;
    if (cache.has(key)) return cache.get(key);
    const text = raw(r, c);
    if (!text.startsWith('=') || text.length < 2) {
      const n = parseNumber(text);
      return n != null && text !== '' ? n : text;
    }
    if (visiting.has(key)) return ERR('#ZIRKEL!');
    visiting.add(key);
    let v;
    try {
      v = evaluate(tokenize(text.slice(1)), getCell);
      // =A1 auf eine leere Zelle zeigt wie in Excel 0
      if (v === '' && /^\$?[A-Za-z]{1,3}\$?\d+$/.test(text.slice(1).trim())) v = 0;
    }
    catch (e) { v = ERR(/^#/.test(e.message) ? e.message : '#FEHLER!'); }
    visiting.delete(key);
    cache.set(key, v);
    return v;
  };
  return rows.map((row, r) => row.map((_, c) => (raw(r, c).startsWith('=') && raw(r, c).length > 1 ? getCell(r, c) : null)));
}

export const isFormula = (html) => /^=./.test(stripHtml(html || '').trim());

/** Relative Bezüge verschieben (beim Ausfüllen/Kopieren), $A$1 bleibt fest */
export function shiftFormula(text, dr, dc) {
  return text.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-zÄÖÜäöü(])/g, (m, cAbs, col, rAbs, row, offset, str) => {
    // Nicht innerhalb von "Text" ersetzen
    const before = str.slice(0, offset);
    if ((before.match(/"/g) || []).length % 2) return m;
    const c = cAbs ? colIndex(col) : colIndex(col) + dc;
    const r = rAbs ? Number(row) - 1 : Number(row) - 1 + dr;
    if (c < 0 || r < 0) return '#BEZUG!';
    return `${cAbs}${colName(c)}${rAbs}${r + 1}`;
  });
}
