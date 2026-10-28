// Kalender: zeigt alle To-dos mit Fälligkeitsdatum aus dem Vault des angemeldeten Benutzers,
// Termine aus abonnierten Kalendern (Google, Outlook, iCal) und Tagesnotizen.
// Ansichten: Monat, Woche, Liste. Aufgaben lassen sich abhaken, per Ziehen verschieben und neu anlegen.

const FEED_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];
const feedCache = new Map(); // url → { at, events, error }
const timeOf = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Termine eines Abos laden (mit 15-Minuten-Zwischenspeicher) */
async function loadFeed(app, feed, force) {
  const c = feedCache.get(feed.url);
  if (c && !force && Date.now() - c.at < 15 * 6e4) return c;
  try {
    const text = await app.api.fetchCalendar(feed.url);
    const r = { at: Date.now(), events: parseICS(text), error: '' };
    feedCache.set(feed.url, r);
    return r;
  } catch (err) {
    const r = { at: Date.now(), events: c?.events || [], error: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') };
    feedCache.set(feed.url, r);
    return r;
  }
}
import { plainIcon } from '../core/emoji.js';
import { h, uid } from '../core/utils.js';
import { icon } from './icons.js';
import { toast, modal, popover, confirmDialog } from './overlays.js';
import { parseICS, expandEvents } from '../core/ical.js';
import { readSynced, writeSynced } from '../core/synced.js';
import { openDailyNote, dailyNotePath } from '../core/templates.js';
import { datePicker } from './datepicker.js';
import { openQuickNote } from './quicknote.js';
import { collectTodos, updateTodo, dayKey, parseDay, todayKey, addDays, dueLabel, dueState, MONTHS } from '../core/todos.js';

export class CalendarView {
  constructor(app) {
    this.app = app;
    this.month = parseDay(todayKey());
    this.month.setDate(1);
    this.selected = todayKey();
    this.todos = [];
    this.feeds = [];
    this.feedData = new Map();
    this.mode = app.settings.calendarMode || 'month';
    this.showDone = app.settings.calendarShowDone !== false;
    this.offs = [];
  }

  async mount(root) {
    this.root = root;
    root.innerHTML = '';
    this.el = h('div.calendar');
    root.append(this.el);
    const reload = () => this.isOpen() && this.load();
    this.offs.push(this.app.events.on('todos:change', reload), this.app.events.on('tree:change', reload));
    await this.load();
  }

  isOpen() { return this.el?.isConnected; }

  destroy() { this.offs.forEach((off) => off?.()); this.offs = []; }

  async load(forceFeeds = false) {
    try { this.todos = await collectTodos(this.app); } catch (err) { console.error(err); toast('Aufgaben konnten nicht geladen werden', { type: 'error' }); }
    this.render();
    await this.loadFeeds(forceFeeds);
  }

  async loadFeeds(force = false) {
    this.feeds = (await readSynced(this.app.api)).calendarFeeds || [];
    const active = this.feeds.filter((f) => f.enabled !== false);
    if (!active.length) { this.feedData.clear(); this.render(); return; }
    await Promise.all(active.map(async (f) => this.feedData.set(f.id, await loadFeed(this.app, f, force))));
    if (this.isOpen()) this.render();
  }

  /** Termine im Zeitraum, nach Tag gruppiert (mehrtägige Termine an jedem Tag) */
  eventsBetween(from, to) {
    const map = new Map();
    for (const f of this.feeds) {
      if (f.enabled === false) continue;
      const data = this.feedData.get(f.id);
      if (!data) continue;
      for (const e of expandEvents(data.events, from, to)) {
        const ev = { ...e, feed: f };
        const last = new Date(e.allDay ? e.end.getTime() - 1 : e.end.getTime() - 1);
        for (let d = new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()); d <= last && d < to; d.setDate(d.getDate() + 1)) {
          if (d < from) continue;
          const k = dayKey(d);
          (map.get(k) || map.set(k, []).get(k)).push(ev);
        }
      }
    }
    for (const list of map.values()) list.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
    return map;
  }

  dailyNotes() {
    const folder = (this.app.settings.pluginData?.['daily-note']?.folder || 'Tagebuch') + '/';
    return new Set(this.app.sidebar.allNotes().filter((n) => n.path.startsWith(folder) && /^\d{4}-\d{2}-\d{2}$/.test(n.name)).map((n) => n.name));
  }

  visible() { return this.todos.filter((t) => this.showDone || !t.checked); }
  byDay() {
    const map = new Map();
    for (const t of this.visible()) if (t.due) (map.get(t.due) || map.set(t.due, []).get(t.due)).push(t);
    return map;
  }

  render() {
    const app = this.app;
    const acc = app.account?.account;
    const open = this.todos.filter((t) => !t.checked && t.due);
    const overdue = open.filter((t) => t.due < todayKey());
    const today = open.filter((t) => t.due === todayKey());
    const head = h('div.cal-head', {},
      h('div.cal-title', {},
        h('h1', {}, '📅 Kalender'),
        h('div.muted.small', { text: (acc ? `Aufgaben von ${acc.displayName || acc.username}` : 'Deine Aufgaben') + ` · ${today.length} heute · ${overdue.length} überfällig · ${open.length} offen` })),
      h('div.flex'),
      h('div.seg', {},
        h('button' + (this.mode === 'month' ? '.active' : ''), { text: 'Monat', onclick: () => this.setMode('month') }),
        h('button' + (this.mode === 'week' ? '.active' : ''), { text: 'Woche', onclick: () => this.setMode('week') }),
        h('button' + (this.mode === 'list' ? '.active' : ''), { text: 'Liste', onclick: () => this.setMode('list') })),
      h('button.btn.small', { title: 'Kalender abonnieren (Google, Outlook, iCal)', onclick: () => openFeeds(app, () => this.load(true)) }, icon('calendar', 14), 'Abos', this.feedErrors() ? h('span.cal-feed-err', { text: '!' }) : null),
      h('button.icon-btn', { title: 'Abos neu laden', onclick: () => this.load(true) }, icon('refresh', 15)),
      h('button.btn.small' + (this.showDone ? '' : '.muted-btn'), { title: 'Erledigte Aufgaben anzeigen', onclick: () => { this.showDone = !this.showDone; app.saveSettings({ calendarShowDone: this.showDone }); this.render(); } }, icon(this.showDone ? 'eye' : 'checkSquare', 14), this.showDone ? 'Erledigte sichtbar' : 'Erledigte ausgeblendet'),
      h('button.btn.btn-primary.small', { onclick: () => this.add(this.selected) }, icon('plus', 14), 'Aufgabe'));

    this.el.replaceChildren(head, this.mode === 'month' ? this.renderMonth() : this.mode === 'week' ? this.renderWeek() : this.renderList());
  }

  feedErrors() {
    return this.feeds.filter((f) => f.enabled !== false && this.feedData.get(f.id)?.error).length;
  }

  setMode(m) { this.mode = m; this.app.saveSettings({ calendarMode: m }); this.render(); }

  // ---------- Monatsansicht ----------
  renderMonth() {
    const map = this.byDay();
    const gridStart = new Date(this.month);
    gridStart.setDate(1 - ((this.month.getDay() + 6) % 7));
    const events = this.eventsBetween(gridStart, new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42));
    const daily = this.dailyNotes();
    const bar = h('div.cal-bar', {},
      h('button.icon-btn', { title: 'Voriger Monat', onclick: () => this.shift(-1) }, icon('chevronRight', 17, 'flip')),
      h('h2', { text: `${MONTHS[this.month.getMonth()]} ${this.month.getFullYear()}` }),
      h('button.icon-btn', { title: 'Nächster Monat', onclick: () => this.shift(1) }, icon('chevronRight', 17)),
      h('button.btn.small', { text: 'Heute', onclick: () => { this.month = parseDay(todayKey()); this.month.setDate(1); this.selected = todayKey(); this.render(); } }));

    const grid = h('div.cal-grid');
    for (const n of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) grid.append(h('div.cal-dow', { text: n }));
    const start = new Date(this.month);
    start.setDate(1 - ((this.month.getDay() + 6) % 7));
    const today = todayKey();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      const items = map.get(k) || [];
      const evs = events.get(k) || [];
      const cell = h('div.cal-cell' + (d.getMonth() !== this.month.getMonth() ? '.other' : '') + (k === today ? '.today' : '') + (k === this.selected ? '.sel' : '') + (d.getDay() % 6 === 0 ? '.weekend' : ''), { dataset: { day: k } });
      const open = items.filter((t) => !t.checked);
      cell.append(h('div.cal-num', {}, h('span', { text: String(d.getDate()) }),
        daily.has(k) ? h('button.cal-daily', { title: 'Tagesnotiz öffnen', text: '📓', onclick: (e) => { e.stopPropagation(); openDailyNote(this.app, parseDay(k)); } }) : null,
        h('div.flex'),
        open.length ? h('span.cal-count.' + (dueState(k) || 'later'), { text: String(open.length) }) : null,
        evs.length ? h('span.cal-evcount', { text: String(evs.length) }) : null));
      const list = h('div.cal-items');
      const max = 4;
      evs.slice(0, max).forEach((e) => list.append(this.eventChip(e)));
      items.slice(0, Math.max(0, max - evs.length)).forEach((t) => list.append(this.chip(t)));
      const hidden = evs.length + items.length - Math.min(max, evs.length + items.length);
      if (hidden > 0) list.append(h('div.cal-more', { text: `+${hidden} weitere` }));
      cell.append(list);
      cell.addEventListener('click', (e) => { if (e.target.closest('.cal-chip, .cal-event')) return; this.selected = k; this.render(); });
      cell.addEventListener('dblclick', (e) => { if (!e.target.closest('.cal-chip, .cal-event')) this.add(k); });
      // Aufgaben per Ziehen auf einen anderen Tag verschieben
      cell.addEventListener('dragover', (e) => { if (this.dragging) { e.preventDefault(); cell.classList.add('drop'); } });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', (e) => { e.preventDefault(); cell.classList.remove('drop'); if (this.dragging && this.dragging.due !== k) this.patch(this.dragging, { due: k }, `Verschoben auf ${dueLabel(k)}`); });
      grid.append(cell);
    }
    return h('div.cal-body', {}, h('div.cal-main', {}, bar, grid), this.renderSide(events));
  }

  /** Termin aus einem Abo (nicht verschiebbar, Klick zeigt Details) */
  eventChip(e, long = false) {
    const c = h('div.cal-event' + (e.allDay ? '.allday' : ''), { style: { '--feed': e.feed.color }, title: `${e.title}${e.location ? '\n' + e.location : ''}\n${e.feed.name}` },
      !e.allDay ? h('span.cal-time', { text: timeOf(e.start) }) : null,
      h('span.cal-text', { text: e.title }),
      long && e.location ? h('span.cal-loc', { text: e.location }) : null);
    c.addEventListener('click', (ev) => { ev.stopPropagation(); this.eventDetails(e, c); });
    return c;
  }

  eventDetails(e, anchor) {
    const when = e.allDay
      ? (e.end - e.start > 864e5 ? `${e.start.toLocaleDateString('de-DE')} – ${new Date(e.end - 1).toLocaleDateString('de-DE')}` : e.start.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })) + ' · ganztägig'
      : `${e.start.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })} · ${timeOf(e.start)} – ${timeOf(e.end)}`;
    popover(h('div.cal-evpop', {},
      h('div.cal-evpop-title', {}, h('span.cal-dot', { style: { background: e.feed.color } }), h('b', { text: e.title })),
      h('div.muted.small', { text: when }),
      e.location ? h('div.small', {}, icon('external', 12), ' ', /^https?:/.test(e.location) ? h('a', { href: e.location, text: e.location, onclick: (ev) => { ev.preventDefault(); this.app.api.openExternal(e.location); } }) : e.location) : null,
      e.description ? h('div.cal-evpop-desc.small', { text: e.description.slice(0, 600) }) : null,
      h('div.muted.small', { text: 'Kalender: ' + e.feed.name }),
      h('div.cal-evpop-actions', {},
        h('button.btn.small', { onclick: () => openDailyNote(this.app, new Date(e.start)) }, '📓 Tagesnotiz'),
        h('button.btn.small', { onclick: () => openQuickNote(this.app, { text: `${e.title} – `, asTodo: true, due: dayKey(e.start) }) }, icon('plus', 13), 'Aufgabe dazu'))), anchor, { className: 'cal-evpop-wrap' });
  }

  // ---------- Wochenansicht ----------
  renderWeek() {
    const sel = parseDay(this.selected);
    const start = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - ((sel.getDay() + 6) % 7));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const events = this.eventsBetween(start, end);
    const map = this.byDay();
    const daily = this.dailyNotes();
    const kw = (() => { const d = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() + 3)); return Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); })();
    const fmt = (d, o) => d.toLocaleDateString('de-DE', o);
    const bar = h('div.cal-bar', {},
      h('button.icon-btn', { title: 'Vorige Woche', onclick: () => { this.selected = addDays(this.selected, -7); this.render(); } }, icon('chevronRight', 17, 'flip')),
      h('h2', { text: `KW ${kw} · ${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(new Date(end - 864e5), { day: 'numeric', month: 'short', year: 'numeric' })}` }),
      h('button.icon-btn', { title: 'Nächste Woche', onclick: () => { this.selected = addDays(this.selected, 7); this.render(); } }, icon('chevronRight', 17)),
      h('button.btn.small', { text: 'Heute', onclick: () => { this.selected = todayKey(); this.render(); } }));
    const cols = h('div.cal-week');
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = dayKey(d);
      const col = h('div.cal-wday' + (k === todayKey() ? '.today' : '') + (k === this.selected ? '.sel' : '') + (d.getDay() % 6 === 0 ? '.weekend' : ''), { dataset: { day: k } },
        h('div.cal-wday-head', {},
          h('span.cal-wday-name', { text: fmt(d, { weekday: 'short' }) }), h('span.cal-wday-num', { text: String(d.getDate()) }), h('div.flex'),
          h('button.icon-btn.tiny', { title: daily.has(k) ? 'Tagesnotiz öffnen' : 'Tagesnotiz anlegen', onclick: () => openDailyNote(this.app, d) }, daily.has(k) ? '📓' : icon('filePlus', 13)),
          h('button.icon-btn.tiny', { title: 'Aufgabe für diesen Tag', onclick: () => this.add(k) }, icon('plus', 13))));
      const body = h('div.cal-wday-body');
      for (const e of events.get(k) || []) body.append(this.eventChip(e));
      for (const t of map.get(k) || []) body.append(this.chip(t));
      if (!body.children.length) body.append(h('div.cal-wday-empty', { text: '–' }));
      col.append(body);
      col.addEventListener('click', (e) => { if (e.target.closest('button, .cal-chip, .cal-event')) return; this.selected = k; this.render(); });
      col.addEventListener('dblclick', (e) => { if (!e.target.closest('button, .cal-chip, .cal-event')) this.add(k); });
      col.addEventListener('dragover', (e) => { if (this.dragging) { e.preventDefault(); col.classList.add('drop'); } });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop'); if (this.dragging && this.dragging.due !== k) this.patch(this.dragging, { due: k }, `Verschoben auf ${dueLabel(k)}`); });
      cols.append(col);
    }
    return h('div.cal-weekwrap', {}, bar, cols);
  }

  chip(t) {
    const c = h('div.cal-chip.' + (dueState(t.due, t.checked) || 'later') + (t.checked ? '.done' : ''), { draggable: 'true', title: `${t.text}\n${t.note}${t.time ? ' · ' + t.time : ''}` },
      t.time ? h('span.cal-time', { text: t.time }) : null, h('span.cal-text', { text: t.text || '(ohne Text)' }));
    c.addEventListener('click', () => this.openTodo(t));
    c.addEventListener('dragstart', (e) => { this.dragging = t; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.text); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => { this.dragging = null; c.classList.remove('dragging'); });
    return c;
  }

  shift(n) { this.month.setMonth(this.month.getMonth() + n); this.render(); }

  // ---------- Seitenleiste: gewählter Tag, überfällig, ohne Datum ----------
  renderSide(events) {
    const side = h('div.cal-side');
    const vis = this.visible();
    const overdue = vis.filter((t) => t.due && t.due < todayKey() && !t.checked);
    const day = vis.filter((t) => t.due === this.selected);
    const noDate = vis.filter((t) => !t.due && !t.checked);
    if (overdue.length && this.selected >= todayKey()) side.append(this.group('Überfällig', overdue, 'overdue'));
    const dayGroup = this.group(dueLabel(this.selected) + (this.selected === todayKey() || Math.abs(parseDay(this.selected) - parseDay(todayKey())) <= 864e5 ? ` · ${parseDay(this.selected).toLocaleDateString('de-DE')}` : ''), day, '', true);
    const hasDaily = this.dailyNotes().has(this.selected);
    dayGroup.querySelector('.cal-group-title .flex').after(h('button.icon-btn.tiny', { title: hasDaily ? 'Tagesnotiz öffnen' : 'Tagesnotiz anlegen', onclick: () => openDailyNote(this.app, parseDay(this.selected)) }, hasDaily ? '📓' : icon('filePlus', 14)));
    const evs = events?.get(this.selected) || [];
    if (evs.length) {
      const evBox = h('div.cal-day-events');
      for (const e of evs) evBox.append(this.eventChip(e, true));
      dayGroup.querySelector('.cal-group-title').after(evBox);
      dayGroup.querySelector('.cal-empty')?.remove();
    }
    side.append(dayGroup);
    if (noDate.length) {
      const g = this.group(`Ohne Datum (${noDate.length})`, noDate.slice(0, 50), 'nodate');
      side.append(h('details.cal-nodate', {}, h('summary', { text: `Ohne Datum (${noDate.length})` }), ...g.querySelectorAll('.cal-task')));
    }
    return side;
  }

  group(title, items, cls = '', addable = false) {
    const g = h('div.cal-group' + (cls ? '.' + cls : ''), {}, h('div.cal-group-title', {}, h('span', { text: title }), h('div.flex'),
      addable ? h('button.icon-btn.tiny', { title: 'Aufgabe für diesen Tag', onclick: () => this.add(this.selected) }, icon('plus', 14)) : null));
    if (!items.length) g.append(h('div.cal-empty.muted.small', { text: addable ? 'Keine Aufgaben – Doppelklick auf einen Tag oder ＋ zum Anlegen.' : 'Nichts da.' }));
    for (const t of items) g.append(this.task(t));
    return g;
  }

  task(t) {
    const check = h('button.todo-check' + (t.checked ? '.checked' : ''), { title: t.checked ? 'Wieder öffnen' : 'Erledigt', html: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
    check.addEventListener('click', () => this.patch(t, { checked: !t.checked }, t.checked ? 'Wieder geöffnet' : 'Erledigt ✓'));
    const dateBtn = h('button.todo-due.has.' + (dueState(t.due, t.checked) || 'later'), { title: 'Datum ändern' }, icon('calendar', 13), h('span', { text: t.due ? dueLabel(t.due, t.time) : 'Datum' }));
    dateBtn.addEventListener('click', () => datePicker(dateBtn, { due: t.due, time: t.time, onPick: (d, tm) => this.patch(t, { due: d, dueTime: tm }, d ? `Fällig ${dueLabel(d, tm)}` : 'Datum entfernt') }));
    return h('div.cal-task' + (t.checked ? '.done' : ''), {}, check,
      h('div.cal-task-body', {},
        h('div.cal-task-text', { text: t.text || '(ohne Text)', onclick: () => this.openTodo(t) }),
        h('div.cal-task-meta', {}, h('button.link-btn', { onclick: () => this.openTodo(t) }, (plainIcon(t.icon, '📄') || '📄') + ' ' + t.note), dateBtn)));
  }

  // ---------- Listenansicht (Agenda) ----------
  renderList() {
    const vis = this.visible();
    const wrap = h('div.cal-agenda');
    const overdue = vis.filter((t) => t.due && t.due < todayKey() && !t.checked);
    if (overdue.length) wrap.append(this.group('Überfällig', overdue, 'overdue'));
    const map = this.byDay();
    const from = parseDay(todayKey());
    const events = this.eventsBetween(from, new Date(from.getFullYear(), from.getMonth(), from.getDate() + 60));
    const days = [...new Set([...map.keys(), ...events.keys()])].filter((k) => k >= todayKey()).sort();
    if (!days.includes(todayKey())) days.unshift(todayKey());
    for (const k of days) {
      const items = map.get(k) || [];
      const g = this.group(`${dueLabel(k)} · ${parseDay(k).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}`, items, k === todayKey() ? 'today' : '', false);
      g.querySelector('.cal-group-title').append(h('button.icon-btn.tiny', { title: 'Aufgabe für diesen Tag', onclick: () => this.add(k) }, icon('plus', 14)));
      const evs = events.get(k) || [];
      if (evs.length) { const box = h('div.cal-day-events'); evs.forEach((e) => box.append(this.eventChip(e, true))); g.querySelector('.cal-group-title').after(box); if (!items.length) g.querySelector('.cal-empty')?.remove(); }
      wrap.append(g);
    }
    const noDate = vis.filter((t) => !t.due && !t.checked);
    if (noDate.length) wrap.append(this.group(`Ohne Datum (${noDate.length})`, noDate.slice(0, 100), 'nodate'));
    return wrap;
  }

  // ---------- Aktionen ----------
  async patch(t, patch, msg) {
    try {
      await updateTodo(this.app, t.path, t.id, patch);
      Object.assign(t, { checked: patch.checked ?? t.checked, due: 'due' in patch ? patch.due : t.due, time: 'dueTime' in patch ? patch.dueTime : t.time });
      if (msg) toast(msg, { type: 'success', duration: 1500 });
      this.render();
    } catch (err) { toast(err.message, { type: 'error' }); this.load(); }
  }

  add(day) {
    openQuickNote(this.app, { due: day || this.selected, asTodo: true });
  }

  async openTodo(t) {
    await this.app.openNote(t.path);
    const ed = this.app.editor;
    requestAnimationFrame(() => {
      const row = ed.rowEl?.(t.id) || document.querySelector(`[data-id="${t.id}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1600);
      ed.focusBlock?.(t.id, 'end');
    });
  }
}

/** Kurzinfo für die Seitenleiste: Anzahl heute/überfällig */
export async function todoBadge(app) {
  const todos = await collectTodos(app);
  const t = todayKey();
  return { today: todos.filter((x) => !x.checked && x.due === t).length, overdue: todos.filter((x) => !x.checked && x.due && x.due < t).length, tomorrow: todos.filter((x) => !x.checked && x.due === addDays(t, 1)).length };
}

/** Kalender-Abos verwalten (werden mit dem Konto auf alle Geräte synchronisiert) */
export async function openFeeds(app, onChange) {
  let feeds = (await readSynced(app.api)).calendarFeeds || [];
  const list = h('div.feed-list');
  const save = async () => { await writeSynced(app.api, { calendarFeeds: feeds }); onChange?.(); };
  const render = () => {
    list.innerHTML = '';
    if (!feeds.length) list.append(h('div.muted.small.feed-empty', { text: 'Noch keine Kalender abonniert.' }));
    for (const f of feeds) {
      const st = feedCache.get(f.url);
      const color = h('input.feed-color', { type: 'color', value: f.color, title: 'Farbe' });
      color.addEventListener('change', () => { f.color = color.value; save(); });
      const toggle = h('button.switch' + (f.enabled !== false ? '.on' : ''), { title: 'Anzeigen' });
      toggle.addEventListener('click', () => { f.enabled = f.enabled === false; toggle.classList.toggle('on', f.enabled); save(); });
      list.append(h('div.feed-item', {}, color,
        h('div.feed-info', {}, h('b', { text: f.name }), h('div.muted.small.feed-url', { text: f.url.replace(/(private-|\/private\/)[^/]+/, '$1…') }),
          st?.error ? h('div.small.ai-err', { text: '✗ ' + st.error }) : st ? h('div.small.ai-ok', { text: `✓ ${st.events.length} Termine geladen` }) : null),
        toggle,
        h('button.icon-btn.danger-hover', { title: 'Abo entfernen', onclick: async () => { if (await confirmDialog('Abo entfernen?', `„${f.name}“ wird aus dem Kalender entfernt.`, { okLabel: 'Entfernen' })) { feeds = feeds.filter((x) => x !== f); await save(); render(); } } }, icon('trash', 15))));
    }
  };
  const nameIn = h('input.input', { placeholder: 'Name, z.B. Arbeit' });
  const urlIn = h('input.input', { placeholder: 'iCal-Adresse (https://… oder webcal://…)', spellcheck: 'false' });
  const err = h('div.small.ai-err');
  const addBtn = h('button.btn.btn-primary', {}, icon('plus', 14), 'Abonnieren');
  addBtn.addEventListener('click', async () => {
    const url = urlIn.value.trim();
    if (!url) { urlIn.focus(); return; }
    err.textContent = '';
    addBtn.disabled = true;
    addBtn.lastChild.textContent = 'Prüfe …';
    const feed = { id: uid(), name: nameIn.value.trim() || 'Kalender', url, color: FEED_COLORS[feeds.length % FEED_COLORS.length], enabled: true };
    const r = await loadFeed(app, feed, true);
    addBtn.disabled = false;
    addBtn.lastChild.textContent = 'Abonnieren';
    if (r.error) { err.textContent = r.error; return; }
    feeds.push(feed);
    await save();
    nameIn.value = ''; urlIn.value = '';
    render();
    toast(`„${feed.name}“ abonniert – ${r.events.length} Termine`, { type: 'success' });
  });
  render();
  modal({
    title: 'Kalender-Abos', width: 'min(620px, 94vw)', className: 'feeds-modal',
    content: h('div.feeds', {}, list,
      h('div.feed-add', {}, nameIn, urlIn, addBtn), err,
      h('details.feed-help', {}, h('summary', { text: 'Wo finde ich die iCal-Adresse?' }),
        h('div.small', { html: '<b>Google Kalender:</b> Einstellungen → Kalender auswählen → „Kalender integrieren“ → <i>Privatadresse im iCal-Format</i>.<br><b>Outlook / Microsoft 365:</b> Einstellungen → Kalender → Freigegebene Kalender → „Kalender veröffentlichen“ → <i>ICS-Link</i>.<br><b>Apple iCloud:</b> Kalender teilen → „Öffentlicher Kalender“ → Link kopieren.<br>Termine werden nur angezeigt (nur lesen) und alle 15 Minuten aktualisiert.' })),
      h('p.muted.small', { text: 'Die Abos werden mit deinem Konto synchronisiert und erscheinen auf allen Geräten.' }))
  });
}
