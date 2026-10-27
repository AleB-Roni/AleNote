// Versionsverlauf einer Notiz: frühere Stände vom Server ansehen, vergleichen und wiederherstellen
import { h, escapeHtml } from '../core/utils.js';
import { icon } from './icons.js';
import { modal, toast } from './overlays.js';
import { blocksToMarkdown } from '../ai/markdown.js';
import { renderMarkdown } from '../ai/chat.js';

const fmtTime = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (t) => {
  const d = new Date(t), today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
};
const fmtFull = (t) => new Date(t).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Zeilenweiser Vergleich (LCS) zweier Texte → [{ type: 'same'|'add'|'del', text }] */
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  if (n * m > 4e6) return [...A.map((t) => ({ type: 'del', text: t })), ...B.map((t) => ({ type: 'add', text: t }))];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ type: 'del', text: A[i++] });
    else out.push({ type: 'add', text: B[j++] });
  }
  while (i < n) out.push({ type: 'del', text: A[i++] });
  while (j < m) out.push({ type: 'add', text: B[j++] });
  return out;
}

export async function openHistory(app) {
  const editor = app.editor;
  const path = app.currentPath;
  if (!editor.note || !path) { toast('Öffne zuerst eine Notiz'); return; }
  if (!app.api.noteVersions) { toast('Der Versionsverlauf ist hier nicht verfügbar'); return; }

  const list = h('div.hist-list', {}, h('div.muted.small.hist-loading', { text: 'Lade Versionen …' }));
  const view = h('div.hist-view');
  const tabs = h('div.seg', {});
  const actions = h('div.hist-actions');
  let mode = 'preview';
  let selected = null; // { id, updated, data }
  const cache = new Map();
  const md = (note) => blocksToMarkdown(editor, note?.blocks || []);

  const m = modal({ title: `Versionsverlauf · ${editor.title}`, content: h('div.hist', {}, list, h('div.hist-main', {}, h('div.hist-bar', {}, tabs, h('div.flex'), actions), view)), width: 'min(1040px, 96vw)', className: 'hist-modal' });

  const renderView = () => {
    tabs.replaceChildren(
      h('button' + (mode === 'preview' ? '.active' : ''), { text: 'Vorschau', onclick: () => { mode = 'preview'; renderView(); } }),
      h('button' + (mode === 'diff' ? '.active' : ''), { text: 'Änderungen bis heute', onclick: () => { mode = 'diff'; renderView(); } }));
    view.innerHTML = '';
    actions.innerHTML = '';
    if (!selected) { view.append(h('div.muted.hist-hint', { text: 'Wähle links eine Version aus.' })); return; }
    if (selected.current) view.append(h('div.hist-current-note.muted.small', { text: 'Das ist der aktuelle Stand der Notiz.' }));
    if (mode === 'preview') {
      view.append(h('div.hist-preview.md', { html: renderMarkdown(md(selected.data) || '*(leer)*') }));
    } else {
      const parts = diffLines(md(selected.data), md(editor.note));
      const changed = parts.filter((p) => p.type !== 'same').length;
      view.append(h('div.hist-diff-legend.small', {}, h('span.del', { text: '− nur in dieser Version' }), h('span.add', { text: '+ seitdem hinzugekommen' }), h('span.muted', { text: changed ? `${changed} geänderte Zeilen` : 'Keine Unterschiede' })));
      const pre = h('div.hist-diff');
      for (const p of parts) pre.append(h('div.diff-line.' + p.type, { html: (p.type === 'add' ? '+ ' : p.type === 'del' ? '− ' : '  ') + (escapeHtml(p.text) || '&nbsp;') }));
      view.append(pre);
    }
    if (!selected.current) {
      actions.append(
        h('button.btn.small', { title: 'Als neue Notiz neben der aktuellen anlegen', onclick: () => restoreCopy() }, icon('copy', 14), 'Als Kopie'),
        h('button.btn.btn-primary.small', { onclick: () => restore() }, icon('undo', 14), 'Diese Version wiederherstellen'));
    }
  };

  const select = async (v, row) => {
    list.querySelectorAll('.hist-item').forEach((el) => el.classList.toggle('active', el === row));
    if (v.current) { selected = { current: true, data: editor.note }; renderView(); return; }
    view.innerHTML = '';
    view.append(h('div.muted.small.hist-hint', { text: 'Lade …' }));
    try {
      if (!cache.has(v.id)) cache.set(v.id, JSON.parse((await app.api.noteVersion(path, v.id)).content));
      selected = { ...v, data: cache.get(v.id) };
    } catch (err) { view.innerHTML = ''; view.append(h('div.hist-error', { text: 'Version konnte nicht geladen werden: ' + err.message })); return; }
    renderView();
  };

  const restore = () => {
    const d = selected.data;
    editor.pushHistory?.flush?.();
    Object.assign(editor.note, { blocks: d.blocks || [], floats: d.floats || [], drawing: d.drawing, icon: d.icon || '', cover: d.cover || null, fullWidth: !!d.fullWidth });
    if (!editor.note.blocks.length) editor.note.blocks.push(editor.newBlock('paragraph'));
    editor.renderAll();
    editor.changed(true);
    m.close();
    toast(`Version vom ${fmtFull(selected.updated)} wiederhergestellt · Strg+Z macht es rückgängig`, { type: 'success', duration: 4000 });
  };

  const restoreCopy = async () => {
    const d = selected.data;
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const name = `${editor.title} (Version ${new Date(selected.updated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[,:]/g, (c) => (c === ':' ? '.' : ''))})`;
    const p = await app.api.createNote(folder, name, { ...d, created: Date.now(), updated: Date.now() });
    await app.sidebar.refresh();
    m.close();
    app.openNote(p);
    toast('Version als Kopie angelegt', { type: 'success' });
  };

  renderView();
  // Aktuellen Stand zuerst hochladen, damit die Liste vollständig ist
  await app.saveNow();
  try { await app.api.syncNow?.(); await new Promise((r) => setTimeout(r, 900)); } catch {}
  let res;
  try { res = await app.api.noteVersions(path); }
  catch (err) {
    list.innerHTML = '';
    list.append(h('div.hist-error', { text: err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
    return;
  }
  list.innerHTML = '';
  const cur = h('button.hist-item.current', {}, h('span.hist-dot'), h('div', {}, h('div.hist-time', { text: 'Aktueller Stand' }), h('div.muted.small', { text: 'auf diesem Gerät' })));
  cur.addEventListener('click', () => select({ current: true }, cur));
  list.append(cur);
  if (!res.versions.length) list.append(h('div.muted.small.hist-hint', { text: 'Noch keine früheren Versionen. Sie entstehen automatisch, sobald du die Notiz bearbeitest.' }));
  let lastDay = '';
  for (const v of res.versions) {
    const day = fmtDay(v.updated);
    if (day !== lastDay) { list.append(h('div.hist-day', { text: day })); lastDay = day; }
    const row = h('button.hist-item', {}, h('span.hist-dot'), h('div', {}, h('div.hist-time', { text: fmtTime(v.updated) }), h('div.muted.small', { text: `${(v.size / 1024).toFixed(1)} KB` })));
    row.addEventListener('click', () => select(v, row));
    list.append(row);
  }
  const first = list.querySelector('.hist-item:not(.current)');
  if (first) first.click(); else cur.click();
}
