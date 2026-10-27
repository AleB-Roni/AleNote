// Vorlagen: ganz normale Notizen im Ordner „Vorlagen“ (bearbeitbar wie jede Notiz, werden synchronisiert).
// Platzhalter wie {datum}, {wochentag}, {zeit}, {kw}, {notiz} oder {datum:DD.MM.YYYY} werden beim
// Erstellen ersetzt – auch im Namen der Vorlage (z.B. „Besprechung {datum}“).
import { uid, formatDate } from './utils.js';

/** Datums-Platzhalter für einen bestimmten Tag ersetzen (z.B. Tagesnotiz für morgen) */
function expandDateVars(text, date) {
  if (!date) return text;
  const kw = (() => { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); return Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); })();
  return text.replace(/\{(datum|date)(?::([^}]+))?\}/gi, (_, __, fmt) => formatDate(date, fmt || 'DD.MM.YYYY'))
    .replace(/\{wochentag\}/gi, formatDate(date, 'dddd')).replace(/\{iso\}/gi, formatDate(date, 'YYYY-MM-DD'))
    .replace(/\{monat\}/gi, formatDate(date, 'MMMM')).replace(/\{jahr\}/gi, String(date.getFullYear())).replace(/\{kw\}/gi, String(kw));
}

export const templateFolder = (app) => app.settings.templateFolder || 'Vorlagen';

/** Alle Vorlagen (Notizen im Vorlagen-Ordner, auch in Unterordnern) */
export function listTemplates(app) {
  const folder = templateFolder(app);
  return app.sidebar.allNotes().filter((n) => n.path.startsWith(folder + '/'));
}

/** Text-Platzhalter in allen Texten eines Objekts ersetzen */
async function expandDeep(app, value, date) {
  if (typeof value === 'string') return value.includes('{') ? app.hotkeys.expand(expandDateVars(value, date)) : value;
  if (Array.isArray(value)) return Promise.all(value.map((v) => expandDeep(app, v, date)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await expandDeep(app, v, date);
    return out;
  }
  return value;
}

/** Vorlage lesen und als neue Blöcke vorbereiten (neue IDs, Platzhalter ersetzt) */
export async function instantiate(app, path, date) {
  const tpl = await app.api.readNote(path);
  const fresh = (b) => ({ ...b, id: uid() });
  const blocks = await expandDeep(app, (tpl.blocks || []).map(fresh), date);
  const floats = await expandDeep(app, (tpl.floats || []).map((f) => ({ ...f, id: uid(), ...(f.block ? { block: fresh(f.block) } : {}) })), date);
  const name = await app.hotkeys.expand(expandDateVars(path.split('/').pop().replace(/\.alenote$/, ''), date));
  return { name, data: { version: 1, created: Date.now(), updated: Date.now(), icon: tpl.icon || '', cover: tpl.cover || null, fullWidth: !!tpl.fullWidth, blocks, floats, drawing: tpl.drawing } };
}

/** Neue Notiz aus einer Vorlage im angegebenen Ordner */
export async function newFromTemplate(app, path, folder = app.sidebar.contextFolder()) {
  if (folder === templateFolder(app) || folder.startsWith(templateFolder(app) + '/')) folder = '';
  const { name, data } = await instantiate(app, path);
  await app.saveNow();
  const p = await app.api.createNote(folder, name, data);
  await app.sidebar.refresh();
  await app.openNote(p);
  return p;
}

/** Inhalt einer Vorlage in die geöffnete Notiz einfügen (nach dem aktuellen Block) */
export async function insertTemplate(app, path, afterId) {
  const editor = app.editor;
  if (!editor.note) return;
  const { data } = await instantiate(app, path);
  const id = afterId || document.activeElement?.closest?.('.block')?.dataset.id || editor.selectedBlockId;
  let idx = id ? editor.index(id) : editor.note.blocks.length - 1;
  const cur = editor.note.blocks[idx];
  // Leerer Absatz (z.B. nach "/vorlage") wird ersetzt
  if (cur && cur.type === 'paragraph' && !(cur.data.text || '').replace(/<br>|&nbsp;|\s/g, '')) editor.note.blocks.splice(idx, 1, ...data.blocks);
  else editor.note.blocks.splice(idx + 1, 0, ...data.blocks);
  editor.note.floats.push(...(data.floats || []));
  editor.renderAll();
  editor.changed(true);
  if (data.blocks.length) editor.focusBlock(data.blocks.at(-1).id, 'end');
}

/** Aktuelle Notiz als Vorlage speichern */
export async function saveAsTemplate(app, name) {
  const editor = app.editor;
  if (!editor.note) return null;
  await app.saveNow();
  await app.api.ensureFolder(templateFolder(app));
  const data = JSON.parse(JSON.stringify({ ...editor.note, created: Date.now(), updated: Date.now() }));
  const p = await app.api.createNote(templateFolder(app), name || editor.title, data);
  await app.sidebar.refresh();
  return p;
}

const b = (type, data = {}) => ({ id: uid(), type, data: { text: '', ...data } });

/** Startvorlagen, die beim ersten Öffnen angelegt werden */
export const STARTER_TEMPLATES = [
  { name: 'Besprechung {datum}', icon: '🗣️', blocks: [
    b('callout', { text: '<b>{wochentag}, {datum}</b> · {zeit} Uhr', icon: '📅', tone: 'blue' }),
    b('h2', { text: 'Teilnehmer' }), b('bullet'),
    b('h2', { text: 'Themen' }), b('numbered'),
    b('h2', { text: 'Ergebnisse' }), b('paragraph'),
    b('h2', { text: 'Aufgaben' }), b('todo', { checked: false })
  ] },
  { name: 'Projekt', icon: '🚀', blocks: [
    b('callout', { text: 'Ziel des Projekts in einem Satz', icon: '🎯', tone: 'purple' }),
    b('h2', { text: 'Überblick' }),
    b('table', { rows: [['Start', '{datum}'], ['Ende', ''], ['Status', 'Geplant'], ['Verantwortlich', '']], header: false }),
    b('h2', { text: 'Meilensteine' }), b('todo', { checked: false }),
    b('h2', { text: 'Notizen' }), b('paragraph')
  ] },
  { name: 'Wochenplan KW {kw}', icon: '🗓️', blocks: [
    b('h2', { text: 'Ziele dieser Woche' }), b('todo', { checked: false }),
    ...['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'].flatMap((d) => [b('h3', { text: d }), b('bullet')]),
    b('h2', { text: 'Rückblick' }), b('paragraph')
  ] },
  { name: 'Tagesnotiz', icon: '☀️', blocks: [
    b('callout', { text: '<b>{wochentag}, {datum}</b>', icon: '☀️', tone: 'yellow' }),
    b('h2', { text: 'Ziele für heute' }), b('todo', { checked: false }),
    b('h2', { text: 'Notizen' }), b('paragraph')
  ] }
];

/** Vorlagen-Ordner mit Startvorlagen anlegen, falls er noch leer ist */
export async function ensureStarterTemplates(app) {
  if (listTemplates(app).length) return false;
  const folder = templateFolder(app);
  await app.api.ensureFolder(folder);
  for (const t of STARTER_TEMPLATES) {
    await app.api.createNote(folder, t.name, { version: 1, created: Date.now(), updated: Date.now(), icon: t.icon, blocks: t.blocks, floats: [] });
  }
  await app.sidebar.refresh();
  return true;
}

/** Tagesnotiz für einen Tag öffnen oder anlegen (Ordner wie im Tagesnotiz-Plugin, Vorlage „Tagesnotiz“) */
export async function openDailyNote(app, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const name = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const folder = app.settings.pluginData?.['daily-note']?.folder || 'Tagebuch';
  const path = `${folder}/${name}.alenote`;
  if (app.sidebar.allNotes().some((n) => n.path === path)) return app.openNote(path);
  const tpl = app.sidebar.allNotes().find((n) => n.path === `${templateFolder(app)}/Tagesnotiz.alenote`);
  let data;
  if (tpl) data = (await instantiate(app, tpl.path, date)).data;
  else {
    const t = STARTER_TEMPLATES.find((x) => x.name === 'Tagesnotiz');
    data = { version: 1, created: Date.now(), icon: t.icon, floats: [], blocks: await expandDeep(app, t.blocks.map((b) => ({ ...b, id: uid() })), date) };
  }
  await app.api.ensureFolder(folder);
  const p = await app.api.createNote(folder, name, data);
  await app.sidebar.refresh();
  return app.openNote(p);
}

export const dailyNotePath = (app, date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${app.settings.pluginData?.['daily-note']?.folder || 'Tagebuch'}/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.alenote`;
};
