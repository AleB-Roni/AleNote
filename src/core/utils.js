// Kleine Helfer, die überall gebraucht werden

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** DOM-Helfer: h('div.klasse#id', { attrs }, ...kinder) */
export function h(tag, attrs = {}, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const stripHtml = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || '';
};

/** Erlaubt nur einfache Formatierung (für Einfügen aus der Zwischenablage) */
export function sanitizeHtml(html) {
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'CODE', 'A', 'SPAN', 'MARK', 'BR']);
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        walk(child);
        if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
        for (const a of [...child.attributes]) {
          const keep = (child.tagName === 'A' && a.name === 'href' && /^https?:|^mailto:/.test(a.value)) || (a.name === 'style' && /^(color|background-color):[^;]+;?$/.test(a.value.trim()));
          if (!keep) child.removeAttribute(a.name);
        }
      } else if (child.nodeType !== 3) child.remove();
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[keys[i]];
  }
  o[keys.at(-1)] = value;
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ---------- Caret / Selektion ----------

export function placeCaret(el, atEnd = true) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Setzt den Cursor an eine Zeichenposition im Textinhalt */
export function setCaretOffset(el, offset) {
  el.focus({ preventScroll: true });
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, remaining = offset;
  while ((node = walker.nextNode())) {
    if (remaining <= node.length) {
      const r = document.createRange();
      r.setStart(node, remaining);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    remaining -= node.length;
  }
  placeCaret(el, true);
}

/** Zeichenposition des Cursors im Element */
export function getCaretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0).cloneRange();
  if (!el.contains(r.startContainer)) return 0;
  r.selectNodeContents(el);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString().length;
}

export function isCaretAtStart(el) {
  const sel = window.getSelection();
  return sel.isCollapsed && getCaretOffset(el) === 0;
}

export function isCaretAtEnd(el) {
  const sel = window.getSelection();
  return sel.isCollapsed && getCaretOffset(el) >= (el.textContent || '').length;
}

function caretRect() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  let rect = r.getClientRects()[0];
  if (!rect) {
    const span = document.createElement('span');
    span.textContent = '​';
    r.insertNode(span);
    rect = span.getBoundingClientRect();
    const parent = span.parentNode;
    span.remove();
    parent?.normalize();
  }
  return rect;
}

export function isCaretOnFirstLine(el) {
  if (!el.textContent) return true;
  const rect = caretRect();
  if (!rect) return true;
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return rect.top - el.getBoundingClientRect().top < lh * 0.8;
}

export function isCaretOnLastLine(el) {
  if (!el.textContent) return true;
  const rect = caretRect();
  if (!rect) return true;
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return el.getBoundingClientRect().bottom - rect.bottom < lh * 0.8;
}

export function getCaretClientRect() {
  return caretRect();
}

/** Teilt den Inhalt am Cursor: liefert [htmlVorher, htmlNachher] */
export function splitAtCaret(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return [el.innerHTML, ''];
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(range.startContainer, range.startOffset);
  const wrap = (frag) => { const d = document.createElement('div'); d.append(frag); return d.innerHTML; };
  return [wrap(before.cloneContents()), wrap(after.cloneContents())];
}

export const isEmptyHtml = (html) => !stripHtml(html).replace(/​/g, '').trim() && !/<img/i.test(html || '');

export function formatDate(date, format) {
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const map = {
    YYYY: date.getFullYear(), YY: String(date.getFullYear()).slice(2), MMMM: months[date.getMonth()], MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()), dddd: days[date.getDay()], HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds())
  };
  return format.replace(/YYYY|YY|MMMM|MM|DD|dddd|HH|mm|ss/g, (t) => map[t]);
}

/** Text in die Zwischenablage – mit Ersatzweg, weil Browser die Zwischenablage nur über HTTPS freigeben */
export async function copyText(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  const active = document.activeElement;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}
