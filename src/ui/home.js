// Startseite: Begrüßung, Suche, Schnellzugriffe, Favoriten, zuletzt geöffnete/bearbeitete Seiten,
// fällige Aufgaben, Termine, Schnellnotiz und „Wiederentdecken“. Bereiche lassen sich ausblenden.
import { h, debounce, stripHtml } from '../core/utils.js';
import { icon } from './icons.js';
import { contextMenu, modal, toast } from './overlays.js';
import { emojiNode } from '../core/emoji.js';
import { collectTodos, updateTodo, addQuickNote, todayKey, addDays, dueLabel, dueState } from '../core/todos.js';
import { upcomingEvents } from './calendar.js';
import { openTemplatePicker } from './templates.js';

export const HOME_SECTIONS = {
  favorites: 'Favoriten',
  recent: 'Zuletzt',
  tasks: 'Aufgaben',
  events: 'Termine',
  quick: 'Schnellnotiz',
  rediscover: 'Wiederentdecken'
};

const ago = (t) => {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'gestern';
  if (d < 30) return `vor ${d} Tagen`;
  if (d < 365) return `vor ${Math.floor(d / 30)} Monat${d < 60 ? '' : 'en'}`;
  return `vor ${Math.floor(d / 365)} Jahr${d < 730 ? '' : 'en'}`;
};

export class HomeView {
  constructor(app) {
    this.app = app;
    this.offs = [];
    this.recentTab = app.settings.home?.recentTab || 'opened';
    this.todos = [];
    this.events = null;
  }

  get cfg() { return { sections: {}, ...(this.app.settings.home || {}) }; }
  shown(key) { return this.cfg.sections[key] !== false; }
  setCfg(patch) { this.app.saveSettings({ home: { ...this.cfg, ...patch } }); }

  isOpen() { return this.el?.isConnected; }

  async mount(root) {
    root.innerHTML = '';
    this.el = h('div.home');
    root.append(this.el);
    const refresh = debounce(() => this.isOpen() && this.load(), 400);
    this.offs.push(this.app.events.on('tree:change', refresh), this.app.events.on('todos:change', refresh), this.app.events.on('emojis:change', () => this.render()));
    this.render();
    await this.load();
  }

  destroy() { this.offs.forEach((off) => off?.()); this.offs = []; }

  async load() {
    try { this.todos = await collectTodos(this.app); } catch { this.todos = []; }
    if (this.isOpen()) this.render();
    if (this.shown('events')) {
      try { this.events = await upcomingEvents(this.app, 7); } catch { this.events = []; }
      if (this.isOpen()) this.render();
    }
  }

  notes() { return this.app.sidebar.allNotes(); }
  byPath(p) { return this.notes().find((n) => n.path === p); }

  noteRow(n, meta, extra) {
    const folder = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
    return h('button.home-note', { title: n.path.replace(/\.alenote$/, ''), onclick: () => this.app.openNote(n.path) },
      h('span.home-note-icon', {}, n.icon ? emojiNode(n.icon) : icon(n.children?.length ? 'files' : 'file', 16)),
      h('span.home-note-text', {}, h('span.home-note-name', { text: n.name }), folder ? h('span.home-note-folder', { text: folder }) : null),
      meta ? h('span.home-note-meta', { text: meta }) : null, extra || null);
  }

  card(key, title, ic, body, actions) {
    if (!this.shown(key)) return null;
    return h('section.home-card.home-' + key, {},
      h('div.home-card-head', {}, h('span.home-card-icon', {}, icon(ic, 15)), h('h3', { text: title }), h('div.flex'), actions || null),
      body);
  }

  render() {
    if (!this.el) return;
    const app = this.app;
    const notes = this.notes();
    const open = this.todos.filter((t) => !t.checked);
    const today = todayKey();
    const overdue = open.filter((t) => t.due && t.due < today);
    const dueToday = open.filter((t) => t.due === today);
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 14 ? 'Hallo' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
    const name = app.account?.account?.displayName?.split(' ')[0];
    const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const stats = [
      `${notes.length} ${notes.length === 1 ? 'Seite' : 'Seiten'}`,
      `${open.length} offene ${open.length === 1 ? 'Aufgabe' : 'Aufgaben'}`,
      dueToday.length ? `${dueToday.length} heute fällig` : null,
      overdue.length ? `${overdue.length} überfällig` : null
    ].filter(Boolean);

    const search = h('button.home-search', { onclick: () => app.palette.open() },
      icon('search', 17), h('span', { text: matchMedia('(max-width: 760px)').matches ? 'Suchen …' : 'Suchen, Seite öffnen oder Befehl ausführen …' }), h('kbd', { text: 'Strg P' }));

    const action = (ic, label, run, title) => h('button.home-action', { title: title || label, onclick: run }, h('span.home-action-icon', {}, icon(ic, 18)), h('span', { text: label }));
    const actions = h('div.home-actions', {},
      action('filePlus', 'Neue Seite', () => app.createNote('')),
      action('zap', 'Schnellnotiz', () => app.quickNote()),
      app.registry.commands.has('daily.open') ? action('edit', 'Tagesnotiz', () => app.runCommand('daily.open')) : null,
      action('layers', 'Aus Vorlage', () => openTemplatePicker(app, { mode: 'new' })),
      action('calendar', 'Kalender', () => app.openCalendar()),
      app.ai ? action('sparkles', 'KI fragen', () => app.ai.chat.open()) : null);

    const head = h('header.home-head', {},
      h('div.home-hello', {},
        h('h1', { text: `${greet}${name ? ', ' + name : ''} 👋` }),
        h('p.muted', { text: `${date} · ${stats.join(' · ')}` })),
      h('button.icon-btn.home-customize', { title: 'Startseite anpassen', onclick: (e) => this.customize(e.currentTarget) }, icon('settings', 17)));

    const grid = h('div.home-grid', {},
      this.favoritesCard(), this.tasksCard(open, overdue), this.recentCard(), this.eventsCard(), this.quickCard(), this.rediscoverCard());

    this.el.replaceChildren(head, search, actions, grid);
  }

  // ---------- Favoriten ----------
  favoritesCard() {
    const favs = (this.app.settings.favorites || []).map((p) => this.byPath(p)).filter(Boolean);
    const body = h('div.home-favs');
    for (const n of favs) {
      body.append(h('div.home-fav', {},
        h('button.home-fav-main', { title: n.path.replace(/\.alenote$/, ''), onclick: () => this.app.openNote(n.path) },
          h('span.home-fav-icon', {}, n.icon ? emojiNode(n.icon) : icon('file', 22)),
          h('span.home-fav-name', { text: n.name }),
          h('span.home-fav-meta', { text: ago(n.updated) })),
        h('button.icon-btn.tiny.home-fav-remove', { title: 'Aus Favoriten entfernen', onclick: () => { this.app.toggleFavorite(n.path); this.render(); } }, icon('x', 12))));
    }
    body.append(h('button.home-fav.home-fav-add', { title: 'Seite zu den Favoriten hinzufügen', onclick: () => this.pickFavorite() }, icon('plus', 18), h('span', { text: 'Favorit' })));
    if (!favs.length) body.prepend(h('p.home-empty', { text: 'Markiere wichtige Seiten mit ☆ oben in der Seite oder hier mit ＋ – sie erscheinen dann hier.' }));
    return this.card('favorites', 'Favoriten', 'star', body);
  }

  pickFavorite() {
    const favs = new Set(this.app.settings.favorites || []);
    const search = h('input.input', { placeholder: 'Seite suchen …' });
    const list = h('div.move-list');
    let m;
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const items = this.notes().filter((n) => !favs.has(n.path) && (!q || n.path.toLowerCase().includes(q)))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 60);
      for (const n of items) {
        list.append(h('button.move-item', { onclick: () => { m.close(); this.app.toggleFavorite(n.path); this.render(); toast(`„${n.name}“ ist jetzt ein Favorit`, { type: 'success', duration: 1500 }); } },
          n.icon ? emojiNode(n.icon, 'move-emoji') : icon('file', 15), h('span', { text: n.name }),
          n.path.includes('/') ? h('span.muted.small', { text: n.path.slice(0, n.path.lastIndexOf('/')) }) : null));
      }
      if (!items.length) list.append(h('div.muted.small.move-empty', { text: 'Nichts gefunden' }));
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') list.querySelector('.move-item')?.click(); });
    render();
    m = modal({ title: 'Favorit hinzufügen', content: h('div.move-dialog', {}, search, list), width: 'min(440px, 94vw)' });
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => search.focus(), 50);
  }

  // ---------- Zuletzt ----------
  recentCard() {
    const tab = this.recentTab;
    let list;
    if (tab === 'opened') list = (this.app.settings.recent || []).map((p) => this.byPath(p)).filter(Boolean).slice(0, 8);
    else list = [...this.notes()].filter((n) => n.updated).sort((a, b) => b.updated - a.updated).slice(0, 8);
    const body = h('div.home-list', {}, ...list.map((n) => this.noteRow(n, ago(n.updated))));
    if (!list.length) body.append(h('p.home-empty', { text: tab === 'opened' ? 'Noch nichts geöffnet.' : 'Noch nichts bearbeitet.' }));
    const tabs = h('div.home-tabs', {},
      ...[['opened', 'Geöffnet'], ['edited', 'Bearbeitet']].map(([k, label]) => h('button' + (tab === k ? '.active' : ''), {
        text: label, onclick: () => { this.recentTab = k; this.setCfg({ recentTab: k }); this.render(); }
      })));
    return this.card('recent', 'Zuletzt', 'clock', body, tabs);
  }

  // ---------- Aufgaben ----------
  tasksCard(open, overdue) {
    const today = todayKey(), soon = addDays(today, 7);
    const upcoming = open.filter((t) => t.due && t.due >= today && t.due <= soon);
    const list = [...overdue, ...upcoming].slice(0, 12);
    const body = h('div.home-list');
    for (const t of list) {
      const box = h('button.todo-check', { title: 'Erledigt', html: '<svg viewBox="0 0 24 24" width="13" height="13"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
      const row = h('div.home-task', {}, box,
        h('button.home-task-text', { onclick: () => this.app.reminders.openTodo(t) }, h('span', { text: t.text || 'Aufgabe' }), h('span.home-note-folder', {}, t.icon ? emojiNode(t.icon) : '', ' ' + t.note)),
        h('span.todo-due.has.' + (dueState(t.due, false) || 'later'), {}, icon('calendar', 12), h('span', { text: dueLabel(t.due, t.time) })));
      box.addEventListener('click', async () => {
        box.classList.add('checked');
        row.classList.add('done');
        try { await updateTodo(this.app, t.path, t.id, { checked: true }); this.app.events.emit('todos:change'); toast('Erledigt ✓', { type: 'success', duration: 1200 }); }
        catch (err) { toast(err.message, { type: 'error' }); box.classList.remove('checked'); row.classList.remove('done'); }
      });
      body.append(row);
    }
    const noDate = open.filter((t) => !t.due).length;
    if (!list.length) body.append(h('p.home-empty', { text: open.length ? 'Nichts fällig in den nächsten 7 Tagen 🎉' : 'Keine offenen Aufgaben 🎉' }));
    if (noDate) body.append(h('button.link-btn.home-more', { text: `+ ${noDate} Aufgaben ohne Datum – im Kalender ansehen`, onclick: () => this.app.openCalendar() }));
    return this.card('tasks', 'Aufgaben', 'checkSquare', body,
      h('button.icon-btn.tiny', { title: 'Neue Aufgabe', onclick: () => this.app.quickNote({ asTodo: true }) }, icon('plus', 14)));
  }

  // ---------- Termine ----------
  eventsCard() {
    if (!this.shown('events')) return null;
    if (this.events && !this.events.length) return null; // keine Kalender-Abos → Bereich nicht zeigen
    const body = h('div.home-list');
    if (!this.events) body.append(h('p.home-empty', { text: 'Lade Termine …' }));
    else {
      let lastDay = '';
      for (const e of this.events.slice(0, 10)) {
        const d = new Date(e.start);
        const key = d.toDateString();
        if (key !== lastDay) {
          lastDay = key;
          const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          body.append(h('div.home-day', { text: dueLabel(dk) }));
        }
        body.append(h('div.home-event', {},
          h('span.home-event-dot', { style: { background: e.color } }),
          h('span.home-event-time', { text: e.allDay ? 'ganztägig' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }),
          h('span.home-event-title', { text: e.title || 'Termin', title: [e.title, e.location, e.feed].filter(Boolean).join('\n') })));
      }
    }
    return this.card('events', 'Termine', 'calendar', body,
      h('button.link-btn.small', { text: 'Kalender', onclick: () => this.app.openCalendar() }));
  }

  // ---------- Schnellnotiz ----------
  quickCard() {
    const ta = h('textarea.home-quick-input', { rows: 3, placeholder: 'Gedanke, Idee, Aufgabe … (Enter speichert)' });
    const asTodo = h('input', { type: 'checkbox' });
    const save = async () => {
      const text = ta.value.trim();
      if (!text) return;
      try {
        const path = await addQuickNote(this.app, { text, asTodo: asTodo.checked });
        ta.value = '';
        toast(`Gespeichert in „${path.replace(/\.alenote$/, '').split('/').pop()}“`, { type: 'success', duration: 1600 });
      } catch (err) { toast(err.message, { type: 'error' }); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(hover: none)').matches) { e.preventDefault(); save(); } });
    const body = h('div.home-quick', {}, ta,
      h('div.home-quick-foot', {}, h('label.home-check', {}, asTodo, h('span', { text: 'als Aufgabe' })), h('div.flex'),
        h('button.btn.small.btn-primary', { onclick: save }, icon('check', 14), 'Speichern')));
    return this.card('quick', 'Schnellnotiz', 'zap', body);
  }

  // ---------- Wiederentdecken ----------
  rediscoverCard() {
    const old = this.notes().filter((n) => n.updated && Date.now() - n.updated > 30 * 864e5 && !n.path.startsWith('Vorlagen/'));
    if (!old.length) return null;
    // Pro Tag eine andere Seite (stabil, damit sie beim Neuzeichnen nicht springt)
    const seed = Number(todayKey().replace(/-/g, '')) + (this.shuffle || 0);
    const n = old[seed % old.length];
    const body = h('div.home-rediscover', {},
      h('p.muted.small', { text: `Zuletzt bearbeitet ${ago(n.updated)} – vielleicht wieder interessant?` }),
      this.noteRow(n, ''),
      this.preview = h('p.home-preview.muted'));
    this.app.api.readNote(n.path).then((d) => {
      const text = (d?.blocks || []).map((b) => stripHtml(b.data?.text || '')).filter(Boolean).join(' · ');
      if (this.preview?.isConnected) this.preview.textContent = text.slice(0, 220) + (text.length > 220 ? ' …' : '');
    }).catch(() => {});
    return this.card('rediscover', 'Wiederentdecken', 'sparkles', body,
      h('button.icon-btn.tiny', { title: 'Andere Seite', onclick: () => { this.shuffle = (this.shuffle || 0) + 1; this.render(); } }, icon('refresh', 14)));
  }

  // ---------- Anpassen ----------
  customize(anchor) {
    const c = this.cfg;
    contextMenu([
      { header: 'Bereiche anzeigen' },
      ...Object.entries(HOME_SECTIONS).map(([k, label]) => ({
        label, active: c.sections[k] !== false,
        run: () => { this.setCfg({ sections: { ...c.sections, [k]: c.sections[k] === false } }); this.render(); if (k === 'events') this.load(); }
      })),
      '-',
      { header: 'Beim Start öffnen' },
      { label: 'Startseite', icon: 'home', active: this.app.settings.startPage !== 'last', run: () => this.app.saveSettings({ startPage: 'home' }) },
      { label: 'Zuletzt geöffnete Seite', icon: 'clock', active: this.app.settings.startPage === 'last', run: () => this.app.saveSettings({ startPage: 'last' }) }
    ], anchor);
  }
}
