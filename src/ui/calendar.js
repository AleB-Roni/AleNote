// Kalender: zeigt alle To-dos mit Fälligkeitsdatum aus dem Vault des angemeldeten Benutzers.
// Aufgaben lassen sich abhaken, per Ziehen verschieben und direkt neu anlegen.
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
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

  async load() {
    try { this.todos = await collectTodos(this.app); } catch (err) { console.error(err); toast('Aufgaben konnten nicht geladen werden', { type: 'error' }); }
    this.render();
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
        h('button' + (this.mode === 'list' ? '.active' : ''), { text: 'Liste', onclick: () => this.setMode('list') })),
      h('button.btn.small' + (this.showDone ? '' : '.muted-btn'), { title: 'Erledigte Aufgaben anzeigen', onclick: () => { this.showDone = !this.showDone; app.saveSettings({ calendarShowDone: this.showDone }); this.render(); } }, icon(this.showDone ? 'eye' : 'checkSquare', 14), this.showDone ? 'Erledigte sichtbar' : 'Erledigte ausgeblendet'),
      h('button.btn.btn-primary.small', { onclick: () => this.add(this.selected) }, icon('plus', 14), 'Aufgabe'));

    this.el.replaceChildren(head, this.mode === 'month' ? this.renderMonth() : this.renderList());
  }

  setMode(m) { this.mode = m; this.app.saveSettings({ calendarMode: m }); this.render(); }

  // ---------- Monatsansicht ----------
  renderMonth() {
    const map = this.byDay();
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
      const cell = h('div.cal-cell' + (d.getMonth() !== this.month.getMonth() ? '.other' : '') + (k === today ? '.today' : '') + (k === this.selected ? '.sel' : '') + (d.getDay() % 6 === 0 ? '.weekend' : ''), { dataset: { day: k } });
      const open = items.filter((t) => !t.checked);
      cell.append(h('div.cal-num', {}, h('span', { text: String(d.getDate()) }), open.length ? h('span.cal-count.' + (dueState(k) || 'later'), { text: String(open.length) }) : null));
      const list = h('div.cal-items');
      items.slice(0, 4).forEach((t) => list.append(this.chip(t)));
      if (items.length > 4) list.append(h('div.cal-more', { text: `+${items.length - 4} weitere` }));
      cell.append(list);
      cell.addEventListener('click', (e) => { if (e.target.closest('.cal-chip')) return; this.selected = k; this.render(); });
      cell.addEventListener('dblclick', (e) => { if (!e.target.closest('.cal-chip')) this.add(k); });
      // Aufgaben per Ziehen auf einen anderen Tag verschieben
      cell.addEventListener('dragover', (e) => { if (this.dragging) { e.preventDefault(); cell.classList.add('drop'); } });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', (e) => { e.preventDefault(); cell.classList.remove('drop'); if (this.dragging && this.dragging.due !== k) this.patch(this.dragging, { due: k }, `Verschoben auf ${dueLabel(k)}`); });
      grid.append(cell);
    }
    return h('div.cal-body', {}, h('div.cal-main', {}, bar, grid), this.renderSide());
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
  renderSide() {
    const side = h('div.cal-side');
    const vis = this.visible();
    const overdue = vis.filter((t) => t.due && t.due < todayKey() && !t.checked);
    const day = vis.filter((t) => t.due === this.selected);
    const noDate = vis.filter((t) => !t.due && !t.checked);
    if (overdue.length && this.selected >= todayKey()) side.append(this.group('Überfällig', overdue, 'overdue'));
    side.append(this.group(dueLabel(this.selected) + (this.selected === todayKey() || Math.abs(parseDay(this.selected) - parseDay(todayKey())) <= 864e5 ? ` · ${parseDay(this.selected).toLocaleDateString('de-DE')}` : ''), day, '', true));
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
        h('div.cal-task-meta', {}, h('button.link-btn', { onclick: () => this.openTodo(t) }, (t.icon || '📄') + ' ' + t.note), dateBtn)));
  }

  // ---------- Listenansicht (Agenda) ----------
  renderList() {
    const vis = this.visible();
    const wrap = h('div.cal-agenda');
    const overdue = vis.filter((t) => t.due && t.due < todayKey() && !t.checked);
    if (overdue.length) wrap.append(this.group('Überfällig', overdue, 'overdue'));
    const map = this.byDay();
    const days = [...map.keys()].filter((k) => k >= todayKey()).sort();
    if (!days.includes(todayKey())) days.unshift(todayKey());
    for (const k of days) {
      const items = map.get(k) || [];
      const g = this.group(`${dueLabel(k)} · ${parseDay(k).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}`, items, k === todayKey() ? 'today' : '', false);
      g.querySelector('.cal-group-title').append(h('button.icon-btn.tiny', { title: 'Aufgabe für diesen Tag', onclick: () => this.add(k) }, icon('plus', 14)));
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
