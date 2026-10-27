// Aufgaben mit Fälligkeitsdatum: Datums-Hilfen, alle To-dos des Vaults einsammeln,
// To-dos außerhalb des Editors ändern und Schnellnotizen in eine Notiz schreiben.
import { escapeHtml, formatDate, stripHtml, uid } from './utils.js';

export const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = (n) => String(n).padStart(2, '0');
/** Date → 'YYYY-MM-DD' (lokale Zeit) */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'YYYY-MM-DD' → Date (lokal, 00:00) */
export const parseDay = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => dayKey(new Date());
export const addDays = (key, n) => { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d); };
const diffDays = (key) => Math.round((parseDay(key) - parseDay(todayKey())) / 864e5);

/** Kurze, menschliche Bezeichnung: Heute, Morgen, Fr. 31. Okt */
export function dueLabel(due, time) {
  if (!due) return '';
  const n = diffDays(due);
  const d = parseDay(due);
  let s = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern'
    : `${DAY_NAMES[d.getDay()]}. ${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
  if (time) s += ', ' + time;
  return s;
}

/** CSS-Zustand: overdue | today | soon | later */
export function dueState(due, done) {
  if (!due || done) return done ? 'done' : '';
  const n = diffDays(due);
  return n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 2 ? 'soon' : 'later';
}

/** Alle To-do-Blöcke aller Notizen (auch in frei platzierten Blöcken) */
export async function collectTodos(app) {
  await app.saveNow();
  const tplFolder = (app.settings.templateFolder || 'Vorlagen') + '/';
  const notes = app.sidebar.allNotes().filter((n) => !n.path.startsWith(tplFolder));
  const out = [];
  await Promise.all(notes.map(async (n) => {
    let data;
    try { data = n.path === app.currentPath && app.editor.note ? app.editor.note : await app.api.readNote(n.path); } catch { return; }
    const blocks = [...(data?.blocks || []), ...(data?.floats || []).filter((f) => f.block).map((f) => f.block)];
    for (const b of blocks) {
      if (b?.type !== 'todo') continue;
      const text = stripHtml((b.data.text || '').replace(/<span class="qn-time">[^<]*<\/span>/g, '')).trim();
      if (!text && !b.data.due) continue;
      out.push({ path: n.path, note: n.name, icon: n.icon || data.icon || '', id: b.id, text, html: b.data.text || '', checked: !!b.data.checked, due: b.data.due || '', time: b.data.dueTime || '' });
    }
  }));
  return out.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || a.note.localeCompare(b.note, 'de'));
}

/** Liest/ändert eine Notiz – die geöffnete direkt im Editor, sonst über die Datei */
export async function editNote(app, path, fn) {
  if (path === app.currentPath && app.editor.note) {
    const r = fn(app.editor.note);
    app.editor.renderAll();
    app.editor.changed(true);
    await app.saveNow();
    return r;
  }
  const data = await app.api.readNote(path);
  const r = fn(data);
  data.updated = Date.now();
  await app.api.writeNote(path, data);
  app.events.emit('note:external-change', path);
  return r;
}

/** To-do-Block (checked, due, dueTime, text) in einer beliebigen Notiz ändern */
export function updateTodo(app, path, blockId, patch) {
  return editNote(app, path, (note) => {
    const b = [...(note.blocks || []), ...(note.floats || []).filter((f) => f.block).map((f) => f.block)].find((x) => x.id === blockId);
    if (!b) throw new Error('Aufgabe nicht mehr vorhanden');
    Object.assign(b.data, patch);
    for (const k of Object.keys(patch)) if (patch[k] === '' || patch[k] == null) delete b.data[k];
  });
}

// ---------- Schnellnotizen ----------

export const QUICK_DEFAULTS = { target: 'Quicknotizen.alenote', order: 'bottom', asTodo: false, globalShortcut: 'Ctrl+Alt+Space', shortcut: 'Ctrl+Shift+Space' };
export const quickSettings = (app) => ({ ...QUICK_DEFAULTS, ...(app.settings.quicknote || {}) });

/**
 * Schreibt einen Eintrag mit Datum & Uhrzeit in die Zielnotiz (legt sie bei Bedarf an).
 * entry: { text, target?, asTodo?, due?, dueTime? }
 * Aufbau in der Notiz: je Tag eine Überschrift, darunter die Einträge mit Uhrzeit.
 */
export async function addQuickNote(app, entry) {
  const qs = quickSettings(app);
  const lines = String(entry.text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Die Notiz ist leer');
  let path = entry.target || qs.target;
  if (!app.sidebar.allNotes().some((n) => n.path === path)) {
    const name = path.replace(/\.alenote$/, '').split('/').pop() || 'Quicknotizen';
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    path = await app.api.createNote(folder, name, { version: 1, created: Date.now(), updated: Date.now(), icon: '⚡', blocks: [], floats: [] });
    await app.sidebar.refresh();
  }
  const now = new Date();
  const day = dayKey(now);
  const time = `<span class="qn-time">${formatDate(now, 'HH:mm')}</span> `;
  const asTodo = !!(entry.asTodo || entry.due);
  const mk = (type, data) => ({ id: uid(), type, data });
  const fresh = [];
  if (asTodo) {
    lines.forEach((l, i) => fresh.push(mk('todo', { text: (i ? '' : time) + escapeHtml(l), checked: false, ...(entry.due ? { due: entry.due } : {}), ...(entry.dueTime ? { dueTime: entry.dueTime } : {}) })));
  } else {
    fresh.push(mk('paragraph', { text: time + lines.map(escapeHtml).join('<br>') }));
  }

  await editNote(app, path, (note) => {
    note.blocks ||= [];
    // Leeren Platzhalter-Absatz einer neuen Notiz entfernen
    if (note.blocks.length === 1 && note.blocks[0].type === 'paragraph' && !stripHtml(note.blocks[0].data.text || '').trim()) note.blocks = [];
    const heads = note.blocks.map((b, i) => [b, i]).filter(([b]) => b.data?.qnDay);
    const heading = () => mk('h3', { text: '📅 ' + formatDate(now, 'dddd, DD.MM.YYYY'), qnDay: day });
    if (qs.order === 'top') {
      const first = heads[0];
      if (first && first[0].data.qnDay === day) note.blocks.splice(first[1] + 1, 0, ...fresh);
      else note.blocks.splice(first ? first[1] : 0, 0, heading(), ...fresh);
    } else {
      const last = heads.at(-1);
      if (!last || last[0].data.qnDay !== day) note.blocks.push(heading());
      note.blocks.push(...fresh);
    }
  });
  if (entry.target !== qs.target || entry.asTodo !== qs.asTodo) app.saveSettings({ quicknote: { ...(app.settings.quicknote || {}), target: path, asTodo: !!entry.asTodo } });
  app.events.emit('todos:change');
  return path;
}
