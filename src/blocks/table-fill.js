// Automatisches Ausfüllen wie in Excel
//
// fillSeries(quelle, anzahl) setzt eine Reihe fort:
//   1, 2      → 3, 4, 5            5      → 5, 5 (Kopie; mit Strg: 6, 7)
//   Montag    → Dienstag, …        Jan    → Feb, Mär, …
//   26.10.2026 → 27.10.2026, …     Woche 1 → Woche 2, …
//   =A1*2     → =A2*2, =A3*2       alles andere → Muster wiederholen

import { stripHtml, escapeHtml } from '../core/utils.js';
import { parseNumber, isFormula, shiftFormula } from './table-formula.js';

const LISTS = [
  ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ['Q1', 'Q2', 'Q3', 'Q4']
];

const text = (html) => stripHtml(html || '').replace(/ /g, ' ').trim();

function matchCase(word, sample) {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  if (sample === sample.toLowerCase()) return word.toLowerCase();
  return word;
}

function parseDate(s) {
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { date: new Date(y, m[2] - 1, m[1]), fmt: 'de', short: m[3].length === 2, pad: m[1].length === 2 };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { date: new Date(m[1], m[2] - 1, m[3]), fmt: 'iso' };
  return null;
}

function formatDate(d, info) {
  const p = (n) => String(n).padStart(2, '0');
  if (info.fmt === 'iso') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const day = info.pad ? p(d.getDate()) : d.getDate();
  const mon = info.pad ? p(d.getMonth() + 1) : d.getMonth() + 1;
  return `${day}.${mon}.${info.short ? String(d.getFullYear()).slice(2) : d.getFullYear()}`;
}

const fmtNumber = (n, sample) => {
  const decimals = Math.max(0, ...sample.map((s) => (String(s).split(/[.,]/)[1] || '').length));
  const rounded = Number(n.toFixed(Math.min(10, decimals + 2)));
  return sample.some((s) => /,/.test(String(s))) ? String(rounded).replace('.', ',') : String(rounded);
};

/**
 * @param {string[]} src   HTML der Quellzellen (in Ausfüllrichtung)
 * @param {number} count   wie viele neue Werte
 * @param {object} opts    { invert: Strg gedrückt → Kopie ↔ Reihe tauschen, offset: (i) → {dr, dc} für Formeln }
 */
export function fillSeries(src, count, { invert = false, offset } = {}) {
  const vals = src.map(text);
  const out = [];
  if (!count) return out;

  // Formeln: relative Bezüge mitverschieben
  if (src.some(isFormula)) {
    for (let i = 0; i < count; i++) {
      const k = i % src.length;
      const { dr, dc } = offset(i, k);
      out.push(isFormula(src[k]) ? escapeHtml(shiftFormula(vals[k], dr, dc)) : src[k]);
    }
    return out;
  }

  const copy = () => { for (let i = 0; i < count; i++) out.push(src[i % src.length]); return out; };
  if (vals.every((v) => v === '')) return copy();

  // Zahlen
  const numbers = vals.map((v) => (v === '' ? null : parseNumber(v)));
  if (numbers.every((n) => n != null) && !vals.some((v) => /[%€$]/.test(v))) {
    const series = numbers.length > 1 ? !invert : invert;
    if (!series) return copy();
    const step = numbers.length > 1 ? (numbers.at(-1) - numbers[0]) / (numbers.length - 1) : 1;
    for (let i = 1; i <= count; i++) out.push(escapeHtml(fmtNumber(numbers.at(-1) + step * i, vals)));
    return out;
  }
  if (invert) return copy();

  // Datum
  const dates = vals.map(parseDate);
  if (dates.every(Boolean)) {
    const days = dates.length > 1 ? Math.round((dates.at(-1).date - dates[0].date) / 864e5 / (dates.length - 1)) : 1;
    const last = dates.at(-1);
    for (let i = 1; i <= count; i++) {
      const d = new Date(last.date);
      d.setDate(d.getDate() + days * i);
      out.push(escapeHtml(formatDate(d, last)));
    }
    return out;
  }

  // Wochentage, Monate, Quartale
  for (const list of LISTS) {
    const idx = vals.map((v) => list.findIndex((w) => w.toLowerCase() === v.toLowerCase()));
    if (idx.every((i) => i >= 0)) {
      const step = idx.length > 1 ? ((idx.at(-1) - idx[0]) / (idx.length - 1)) || 1 : 1;
      for (let i = 1; i <= count; i++) {
        const n = ((idx.at(-1) + Math.round(step) * i) % list.length + list.length) % list.length;
        out.push(escapeHtml(matchCase(list[n], vals.at(-1))));
      }
      return out;
    }
  }

  // Text mit Zahl am Ende: "Woche 1", "Raum 12"
  const parts = vals.map((v) => v.match(/^(.*?)(-?\d+)(\D*)$/));
  if (parts.every(Boolean) && parts.every((p) => p[1] === parts[0][1] && p[3] === parts[0][3])) {
    const n = parts.map((p) => Number(p[2]));
    const step = n.length > 1 ? (n.at(-1) - n[0]) / (n.length - 1) || 1 : 1;
    const width = parts.at(-1)[2].replace('-', '').length;
    const pad = /^0\d/.test(parts.at(-1)[2]) ? width : 0;
    for (let i = 1; i <= count; i++) {
      const v = Math.round(n.at(-1) + step * i);
      out.push(escapeHtml(parts[0][1] + String(v).padStart(pad, '0') + parts[0][3]));
    }
    return out;
  }

  return copy();
}
