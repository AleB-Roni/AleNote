// Erinnerungen an fällige To-dos.
// - Windows & Browser: AleNote prüft alle 30 Sekunden und zeigt eine System-Benachrichtigung
//   plus eine Karte in der App (Öffnen · Erledigt · Später).
// - Android: Erinnerungen werden beim System angemeldet und kommen auch bei geschlossener App.
// To-dos ohne Uhrzeit erinnern zur eingestellten Standardzeit (z.B. 9:00 Uhr) am Fälligkeitstag.
import { h, debounce } from './utils.js';
import { icon } from '../ui/icons.js';
import { collectTodos, updateTodo, parseDay, todayKey, dueLabel } from './todos.js';

export const REMIND_DEFAULTS = { enabled: true, defaultTime: '09:00', before: 0, daily: true };
export const remindSettings = (app) => ({ ...REMIND_DEFAULTS, ...(app.settings.reminders || {}) });

/** Zeitpunkt der Erinnerung (ms) oder null */
export function reminderTime(todo, rs) {
  if (!todo.due || todo.checked) return null;
  const [hh, mm] = String(todo.time || rs.defaultTime || '09:00').split(':').map(Number);
  const d = parseDay(todo.due);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d.getTime() - (Number(rs.before) || 0) * 6e4;
}

const store = {
  get(k, def) { try { return JSON.parse(localStorage.getItem('alenote-rem-' + k)) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('alenote-rem-' + k, JSON.stringify(v)); } catch {} }
};
// Stabile Zahl-ID für Android-Benachrichtigungen
const numId = (s) => { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x) % 2e9; };

export class ReminderService {
  constructor(app) {
    this.app = app;
    this.todos = [];
    this.fired = new Set(store.get('fired', []));
    this.snoozed = store.get('snoozed', {}); // key → Zeitpunkt
    this.native = app.api.native ? app.api.plugins?.LocalNotifications : null;
    this.refreshSoon = debounce(() => this.refresh(), 2500);
  }

  get settings() { return remindSettings(this.app); }

  async start() {
    const ev = this.app.events;
    ev.on('todos:change', () => this.refreshSoon());
    ev.on('tree:change', () => this.refreshSoon());
    ev.on('note:save', (data) => { if ((data.blocks || []).some((b) => b.type === 'todo' && b.data?.due)) this.refreshSoon(); });
    ev.on('settings:change', () => this.refreshSoon());
    if (this.native) {
      this.native.addListener('localNotificationActionPerformed', (a) => {
        const x = a.notification?.extra;
        if (x?.path) this.openTodo({ path: x.path, id: x.id });
      }).catch?.(() => {});
    }
    await this.refresh();
    this.timer = setInterval(() => this.check(), 30e3);
    setTimeout(() => this.dailySummary(), 2500);
  }

  async refresh() {
    try { this.todos = await collectTodos(this.app); } catch { return; }
    this.updateWidget();
    if (this.native) await this.scheduleNative();
    else this.check();
  }

  upcoming() {
    const rs = this.settings;
    return this.todos.map((t) => {
      const key = `${t.path}#${t.id}@${t.due}${t.time || ''}`;
      return { ...t, key, at: this.snoozed[key] || reminderTime(t, rs) };
    }).filter((t) => t.at);
  }

  /** Android-Widget: Anzahl heute fälliger und überfälliger Aufgaben */
  updateWidget() {
    const tools = this.app.api.native ? this.app.api.plugins?.AleTools : null;
    if (!tools?.updateWidget) return;
    const open = this.todos.filter((t) => !t.checked && t.due), day = todayKey();
    tools.updateWidget({ today: open.filter((t) => t.due === day).length, overdue: open.filter((t) => t.due < day).length }).catch(() => {});
  }

  /** Browser & Windows: fällige Erinnerungen anzeigen */
  check() {
    if (this.native || !this.settings.enabled) return;
    const now = Date.now();
    for (const t of this.upcoming()) {
      // nur Erinnerungen der letzten 6 Stunden (ältere zeigt die Tagesübersicht)
      if (t.at > now || t.at < now - 6 * 36e5 || this.fired.has(t.key)) continue;
      this.fired.add(t.key);
      this.fire(t);
    }
    store.set('fired', [...this.fired].slice(-500));
  }

  /** Android: die nächsten Erinnerungen beim System anmelden */
  async scheduleNative() {
    const LN = this.native;
    try {
      const pending = await LN.getPending();
      if (pending.notifications?.length) await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      if (!this.settings.enabled) return;
      const now = Date.now();
      const list = this.upcoming().filter((t) => t.at > now && t.at < now + 60 * 864e5).sort((a, b) => a.at - b.at).slice(0, 60);
      if (!list.length) return;
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted' && (await LN.requestPermissions()).display !== 'granted') return;
      await LN.schedule({
        notifications: list.map((t) => ({
          id: numId(t.key), title: '⏰ ' + (t.text || 'Aufgabe'), body: `${t.note} · fällig ${dueLabel(t.due, t.time)}`,
          schedule: { at: new Date(t.at), allowWhileIdle: true }, extra: { path: t.path, id: t.id }
        }))
      });
    } catch (err) { console.error('Erinnerungen', err); }
  }

  fire(t) {
    const title = '⏰ ' + (t.text || 'Aufgabe');
    const body = `${t.note} · fällig ${dueLabel(t.due, t.time)}`;
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body, tag: t.key, icon: 'app-icon.png' });
        n.onclick = () => { this.app.api.focusWindow?.(); window.focus(); this.openTodo(t); n.close(); };
      }
    } catch {}
    this.card(t);
  }

  /** Karte in der App: Öffnen · Erledigt · 10 Min. später */
  card(t) {
    let host = document.querySelector('.rem-host');
    if (!host) { host = h('div.rem-host'); document.body.append(host); }
    const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); };
    const el = h('div.rem-card', {},
      h('div.rem-head', {}, h('span.rem-bell', { text: '⏰' }), h('b', { text: 'Erinnerung' }), h('div.flex'), h('button.icon-btn.tiny', { title: 'Schließen', onclick: close }, icon('x', 13))),
      h('div.rem-text', { text: t.text || 'Aufgabe' }),
      h('div.rem-meta.muted.small', { text: `${t.icon || '📄'} ${t.note} · ${dueLabel(t.due, t.time)}` }),
      h('div.rem-actions', {},
        h('button.btn.small.btn-primary', { onclick: () => { close(); this.openTodo(t); } }, 'Öffnen'),
        h('button.btn.small', { onclick: async () => { close(); await updateTodo(this.app, t.path, t.id, { checked: true }); this.app.events.emit('todos:change'); this.app.toast('Erledigt ✓', { type: 'success', duration: 1500 }); } }, icon('check', 13), 'Erledigt'),
        h('button.btn.small', { title: 'In 10 Minuten noch einmal erinnern', onclick: () => { close(); this.snooze(t, 10); } }, '10 Min.'),
        h('button.btn.small', { title: 'In einer Stunde noch einmal erinnern', onclick: () => { close(); this.snooze(t, 60); } }, '1 Std.')));
    host.append(el);
  }

  snooze(t, minutes) {
    const key = `${t.path}#${t.id}@${t.due}${t.time || ''}`;
    this.snoozed[key] = Date.now() + minutes * 6e4;
    this.fired.delete(key);
    store.set('snoozed', this.snoozed);
    this.app.toast(`Erinnere dich in ${minutes === 60 ? 'einer Stunde' : minutes + ' Minuten'} wieder`, { duration: 1800 });
  }

  /** Einmal am Tag beim Start: was ist heute fällig? */
  dailySummary() {
    if (!this.settings.daily || store.get('summary') === todayKey()) return;
    const open = this.todos.filter((t) => !t.checked && t.due);
    const today = open.filter((t) => t.due === todayKey()).length;
    const overdue = open.filter((t) => t.due < todayKey()).length;
    store.set('summary', todayKey());
    if (!today && !overdue) return;
    const parts = [today ? `${today} ${today === 1 ? 'Aufgabe' : 'Aufgaben'} heute fällig` : '', overdue ? `${overdue} überfällig` : ''].filter(Boolean);
    this.app.toast('☀️ Guten Tag! ' + parts.join(' · '), { duration: 9000, action: { label: 'Kalender', run: () => this.app.openCalendar() } });
  }

  async openTodo(t) {
    await this.app.openNote(t.path);
    requestAnimationFrame(() => {
      const row = this.app.editor.rowEl?.(t.id);
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1600);
    });
  }
}
