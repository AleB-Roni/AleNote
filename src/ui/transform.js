// Blöcke umwandeln und bearbeiten – für einen Block oder mehrere markierte Blöcke:
// Umwandeln in (Text, Überschrift, Liste, To-do, Zitat …), Zeilen aufteilen, Zusammenführen,
// Sortieren, Einrücken, Farbe, Groß/klein, Liste ↔ Tabelle, in eine Unterseite verschieben.
// Alles ist ein einziger Rückgängig-Schritt (Strg+Z).
import { escapeHtml, stripHtml, uid } from '../core/utils.js';
import { childFolder } from '../core/pages.js';

/** Reihenfolge im Menü „Umwandeln in“ */
export const TURN_INTO = ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle', 'code'];
const LISTS = new Set(['bullet', 'numbered', 'todo']);

const BR = /<br\s*\/?>/i;
const htmlToPlain = (html) => stripHtml(String(html || '').replace(/<br\s*\/?>/gi, '\n'));
const plainToHtml = (text) => escapeHtml(String(text || '')).replace(/\n/g, '<br>');

/** Text-Inhalt eines Blocks als HTML (Code-Blöcke haben Klartext) */
function textOf(b) {
  if (b.type === 'code') return plainToHtml(b.data.code || '');
  if (b.type === 'table') return (b.data.rows || []).map((r) => r.map((c) => escapeHtml(String(c ?? ''))).join(' · ')).join('<br>');
  return b.data.text || '';
}

/** Zeilen (durch Umbrüche getrennt) eines Text-Blocks */
function linesOf(html) {
  return String(html || '').split(/<br\s*\/?>/i).map((l) => l.replace(/^(&nbsp;|\s)+|(&nbsp;|\s)+$/g, '')).filter((l) => stripHtml(l).trim());
}

function blockFrom(editor, src, type, text) {
  const def = editor.def(type);
  const data = { ...def.create() };
  if (type === 'code') data.code = htmlToPlain(text);
  else data.text = text;
  if (type === 'todo' && src.type === 'todo') { data.checked = src.data.checked; for (const k of ['due', 'dueTime', 'remind']) if (src.data[k] != null) data[k] = src.data[k]; }
  if (type === 'callout' && src.type === 'callout') Object.assign(data, { icon: src.data.icon, tone: src.data.tone });
  if (type === 'toggle' && src.type === 'toggle') Object.assign(data, { body: src.data.body, open: src.data.open });
  const b = { id: src.id && !src._split ? src.id : uid(), type, data };
  if (src.indent && (LISTS.has(type) || type === 'paragraph')) b.indent = src.indent;
  if (src.color) b.color = src.color;
  return b;
}

/** Ausgewählte Blöcke (in Dokument-Reihenfolge) */
export function targetIds(editor, id) {
  if (editor.multiSelected?.size && (!id || editor.multiSelected.has(id))) return editor.note.blocks.filter((b) => editor.multiSelected.has(b.id)).map((b) => b.id);
  const fid = id || document.activeElement?.closest?.('.block')?.dataset.id || editor.selectedBlockId;
  return fid ? [fid] : [];
}

/** Änderung an den Blöcken anwenden: neu zeichnen, Auswahl wiederherstellen, ein Undo-Schritt */
function apply(editor, newIds, { focus } = {}) {
  editor.renderAll();
  editor.updateNumbering?.();
  editor.changed(true);
  editor.app.events.emit('todos:change');
  if (newIds?.length > 1) editor.selectBlocks(newIds);
  else if (newIds?.length === 1) editor.focusBlock(newIds[0], focus || 'end');
}

/** Ersetzt die Blöcke ids durch das Ergebnis von fn(blocks) an derselben Stelle */
function replace(editor, ids, fn) {
  const set = new Set(ids);
  const blocks = editor.note.blocks.filter((b) => set.has(b.id));
  if (!blocks.length) return [];
  const at = editor.note.blocks.findIndex((b) => set.has(b.id));
  const out = fn(blocks);
  editor.note.blocks = editor.note.blocks.filter((b) => !set.has(b.id));
  editor.note.blocks.splice(at, 0, ...out);
  if (!editor.note.blocks.length) editor.note.blocks.push(editor.newBlock('paragraph'));
  return out.map((b) => b.id);
}

/**
 * Umwandeln in einen anderen Blocktyp. Text mit mehreren Zeilen wird bei Listen/To-dos
 * automatisch in einzelne Einträge aufgeteilt.
 */
export function turnInto(editor, ids, type) {
  if (!editor.def(type)) return;
  editor.clearMulti();
  const newIds = replace(editor, ids, (blocks) => blocks.flatMap((b) => {
    if (!editor.def(b.type)?.text && b.type !== 'table') return [b]; // Bilder, Trennlinien … bleiben
    if (b.type === 'table' && !LISTS.has(type)) return [b];
    const text = textOf(b);
    if (LISTS.has(type) && (BR.test(text) || b.type === 'table')) {
      const lines = linesOf(text);
      if (lines.length > 1) return lines.map((l, i) => blockFrom(editor, { ...b, _split: i > 0 }, type, l));
    }
    return [blockFrom(editor, b, type, text)];
  }));
  apply(editor, newIds);
}

/** Zeilen eines Blocks (Umbrüche mit Shift+Enter) in einzelne Blöcke gleichen Typs aufteilen */
export function splitLines(editor, ids) {
  editor.clearMulti();
  const newIds = replace(editor, ids, (blocks) => blocks.flatMap((b) => {
    if (!editor.def(b.type)?.text || b.type === 'code') return [b];
    const lines = linesOf(b.data.text);
    if (lines.length < 2) return [b];
    return lines.map((l, i) => blockFrom(editor, { ...b, _split: i > 0 }, b.type, l));
  }));
  apply(editor, newIds);
}

/** Mehrere Blöcke zu einem zusammenführen (Zeilenumbrüche bleiben erhalten) */
export function mergeBlocks(editor, ids) {
  if (ids.length < 2) return;
  editor.clearMulti();
  const newIds = replace(editor, ids, (blocks) => {
    const texts = blocks.filter((b) => editor.def(b.type)?.text || b.type === 'table').map(textOf).filter((t) => stripHtml(t).trim());
    const first = blocks.find((b) => editor.def(b.type)?.text) || blocks[0];
    const type = editor.def(first.type)?.text ? first.type : 'paragraph';
    return [blockFrom(editor, first, type, texts.join('<br>')), ...blocks.filter((b) => !editor.def(b.type)?.text && b.type !== 'table')];
  });
  apply(editor, newIds.slice(0, 1));
}

/** Sortieren nach Text (A→Z oder Z→A); To-dos optional: offene zuerst */
export function sortBlocks(editor, ids, dir = 1) {
  editor.clearMulti();
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const newIds = replace(editor, ids, (blocks) => [...blocks].sort((a, b) => dir * coll.compare(stripHtml(textOf(a)).trim(), stripHtml(textOf(b)).trim())));
  apply(editor, newIds);
}

export function indentBlocks(editor, ids, delta) {
  for (const id of ids) {
    const b = editor.block(id);
    if (!b) continue;
    const v = Math.max(0, Math.min(6, (b.indent || 0) + delta));
    b.indent = v || undefined;
  }
  editor.clearMulti();
  apply(editor, ids);
}

export function colorBlocks(editor, ids, color) {
  for (const id of ids) { const b = editor.block(id); if (b) b.color = color || undefined; }
  editor.clearMulti();
  apply(editor, ids);
}

export function duplicateBlocks(editor, ids) {
  editor.clearMulti();
  const last = editor.index(ids[ids.length - 1]);
  const copies = ids.map((id) => editor.block(id)).filter(Boolean).map((b) => ({ ...structuredClone(b), id: uid() }));
  editor.note.blocks.splice(last + 1, 0, ...copies);
  apply(editor, copies.map((b) => b.id));
}

/** To-dos alle abhaken bzw. wieder öffnen */
export function checkAll(editor, ids, checked) {
  for (const id of ids) { const b = editor.block(id); if (b?.type === 'todo') b.data.checked = checked; }
  editor.clearMulti();
  apply(editor, ids);
}

/** Groß-/Kleinschreibung ändern, ohne die Formatierung (fett, Links …) zu verlieren */
export function changeCase(editor, ids, mode) {
  const conv = (s, atStart) => mode === 'upper' ? s.toLocaleUpperCase('de') : mode === 'lower' ? s.toLocaleLowerCase('de')
    : mode === 'title' ? s.toLocaleLowerCase('de').replace(/(^|[\s\-–(„"])(\p{L})/gu, (_, a, c) => a + c.toLocaleUpperCase('de'))
      : (atStart ? s.charAt(0).toLocaleUpperCase('de') + s.slice(1).toLocaleLowerCase('de') : s.toLocaleLowerCase('de'));
  for (const id of ids) {
    const b = editor.block(id);
    if (!b || !editor.def(b.type)?.text || b.type === 'code') continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = b.data.text || '';
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    let first = true, node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      node.nodeValue = conv(node.nodeValue, first);
      first = false;
    }
    b.data.text = tpl.innerHTML;
  }
  editor.clearMulti();
  apply(editor, ids);
}

/** Markierte Blöcke als Tabelle: jede Zeile eine Tabellenzeile; Spalten aus „|“, Tab oder „;“ */
export function toTable(editor, ids) {
  editor.clearMulti();
  const newIds = replace(editor, ids, (blocks) => {
    const lines = blocks.flatMap((b) => linesOf(textOf(b)).map(htmlToPlain));
    const sep = lines.some((l) => l.includes('|')) ? '|' : lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(';')) ? ';' : null;
    let rows = lines.map((l) => (sep ? l.split(sep).map((c) => c.trim()) : [l.trim()]));
    if (sep === '|') rows = rows.map((r) => r.filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)))).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
    const cols = Math.max(1, ...rows.map((r) => r.length));
    rows = rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
    if (!rows.length) rows = [['']];
    return [{ id: uid(), type: 'table', data: { rows, header: rows.length > 1 && sep != null, widths: null, heads: false } }];
  });
  apply(editor, newIds);
}

/** Markierte Blöcke in eine neue Unterseite verschieben; an ihrer Stelle bleibt ein Verweis */
export async function moveToSubpage(editor, ids) {
  const app = editor.app;
  if (!app.currentPath) return;
  const blocks = editor.note.blocks.filter((b) => ids.includes(b.id));
  if (!blocks.length) return;
  const head = blocks.find((b) => /^h[123]$/.test(b.type));
  const title = (stripHtml(head?.data.text || blocks[0].data?.text || '').trim() || 'Neue Seite').slice(0, 80);
  const body = head ? blocks.filter((b) => b !== head) : blocks;
  editor.clearMulti();
  await app.saveNow();
  await app.api.ensureFolder(childFolder(app.currentPath));
  const p = await app.api.createNote(childFolder(app.currentPath), title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Neue Seite',
    { version: 1, created: Date.now(), updated: Date.now(), icon: '', blocks: body.length ? structuredClone(body) : [editor.newBlock('paragraph')], floats: [] });
  app.sidebar.expanded.add(app.currentPath);
  await app.sidebar.refresh();
  const newIds = replace(editor, ids, () => [{ id: uid(), type: 'page', data: { path: p } }]);
  apply(editor, []);
  app.toast?.(`In die Unterseite „${title}“ verschoben`, { type: 'success', action: { label: 'Öffnen', run: () => app.openNote(p) } });
  return newIds;
}

/** Menüeinträge für „Umwandeln in“ */
export function turnIntoItems(editor, ids, current) {
  return TURN_INTO.map((t) => editor.def(t)).filter(Boolean).map((d) => ({
    label: d.name, icon: d.icon, active: d.type === current, run: () => turnInto(editor, ids, d.type)
  }));
}

/** Alle Bearbeiten-Funktionen für ein Menü (Block-Menü, Auswahl-Leiste) */
export function transformItems(editor, ids, { colors } = {}) {
  const blocks = ids.map((id) => editor.block(id)).filter(Boolean);
  const multi = ids.length > 1;
  const hasLines = blocks.some((b) => editor.def(b.type)?.text && b.type !== 'code' && linesOf(b.data.text).length > 1);
  const hasTodo = blocks.some((b) => b.type === 'todo');
  const textual = blocks.some((b) => editor.def(b.type)?.text && b.type !== 'code');
  return [
    hasLines ? { label: 'Zeilen in einzelne Blöcke aufteilen', icon: 'list', run: () => splitLines(editor, ids) } : null,
    multi ? { label: 'Zu einem Block zusammenführen', icon: 'layers', run: () => mergeBlocks(editor, ids) } : null,
    multi ? { label: 'Sortieren', icon: 'listOrdered', submenu: [
      { label: 'A → Z', run: () => sortBlocks(editor, ids, 1) },
      { label: 'Z → A', run: () => sortBlocks(editor, ids, -1) }
    ] } : null,
    textual || blocks.some((b) => b.type === 'table') ? { label: blocks.every((b) => b.type === 'table') ? 'Tabelle → Liste' : 'Als Tabelle', icon: 'table', run: () => (blocks.every((b) => b.type === 'table') ? turnInto(editor, ids, 'bullet') : toTable(editor, ids)) } : null,
    textual ? { label: 'Groß-/Kleinschreibung', icon: 'text', submenu: [
      { label: 'GROSSBUCHSTABEN', run: () => changeCase(editor, ids, 'upper') },
      { label: 'kleinbuchstaben', run: () => changeCase(editor, ids, 'lower') },
      { label: 'Satzanfang groß', run: () => changeCase(editor, ids, 'sentence') },
      { label: 'Jedes Wort Groß', run: () => changeCase(editor, ids, 'title') }
    ] } : null,
    hasTodo ? { label: 'Alle abhaken', icon: 'checkSquare', run: () => checkAll(editor, ids, true) } : null,
    hasTodo ? { label: 'Alle Haken entfernen', icon: 'checkSquare', run: () => checkAll(editor, ids, false) } : null,
    multi ? { label: 'Einrücken', icon: 'chevronRight', shortcut: 'Tab', run: () => indentBlocks(editor, ids, 1) } : null,
    multi ? { label: 'Ausrücken', icon: 'chevronRight', shortcut: 'Shift+Tab', run: () => indentBlocks(editor, ids, -1) } : null,
    colors ? { label: 'Farbe', icon: 'palette', submenu: colors(ids) } : null,
    multi ? { label: 'Duplizieren', icon: 'copy', run: () => duplicateBlocks(editor, ids) } : null,
    editor.app.currentPath ? { label: 'In neue Unterseite verschieben', icon: 'files', run: () => moveToSubpage(editor, ids) } : null
  ].filter(Boolean);
}

