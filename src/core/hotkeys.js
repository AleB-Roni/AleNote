// Tastenkürzel & eigene Hotkeys
//
// 1) Jeder registrierte Befehl kann ein Standard-Kürzel haben (def.shortcut).
//    Der Nutzer kann es in den Einstellungen überschreiben (settings.shortcutOverrides).
//
// 2) Eigene Hotkeys (settings.hotkeys) – vom Nutzer erstellte Aktionen:
//    { id, name, shortcut, action: 'text' | 'block' | 'command', template, blockType, commandId, slash: true }
//    - 'text':    fügt Text ein, Platzhalter wie {datum} werden ersetzt
//    - 'block':   fügt einen Block ein (z.B. Tabelle, To-do)
//    - 'command': führt einen anderen Befehl aus
//    Eigene Hotkeys erscheinen automatisch in der Befehlspalette (Strg+P) und im "/"-Menü.

import { eventToShortcut, normalizeShortcut } from './shortcuts.js';
import { formatDate, uid } from './utils.js';
import { toast } from '../ui/overlays.js';

export const DEFAULT_HOTKEYS = [
  { id: 'hk-date', name: 'Datum einfügen', shortcut: 'Ctrl+Shift+D', action: 'text', template: '{datum}', slash: true },
  { id: 'hk-time', name: 'Uhrzeit einfügen', shortcut: 'Ctrl+Shift+U', action: 'text', template: '{zeit}', slash: true },
  { id: 'hk-stamp', name: 'Zeitstempel einfügen', shortcut: 'Ctrl+Alt+D', action: 'text', template: '{wochentag}, {datum} – {zeit} Uhr', slash: true },
  { id: 'hk-todo', name: 'Neue Aufgabe', shortcut: 'Ctrl+Shift+Enter', action: 'block', blockType: 'todo', slash: false }
];

export function registerDefaultVariables(registry) {
  const v = (name, description, value) => registry.registerVariable({ name, description, value });
  v('datum', 'Heutiges Datum (26.10.2026)', () => formatDate(new Date(), 'DD.MM.YYYY'));
  v('zeit', 'Uhrzeit (14:05)', () => formatDate(new Date(), 'HH:mm'));
  v('sekunden', 'Uhrzeit mit Sekunden', () => formatDate(new Date(), 'HH:mm:ss'));
  v('wochentag', 'Wochentag (Montag)', () => formatDate(new Date(), 'dddd'));
  v('monat', 'Monatsname (Oktober)', () => formatDate(new Date(), 'MMMM'));
  v('jahr', 'Jahr (2026)', () => String(new Date().getFullYear()));
  v('iso', 'ISO-Datum (2026-10-26)', () => formatDate(new Date(), 'YYYY-MM-DD'));
  v('kw', 'Kalenderwoche', () => String(isoWeek(new Date())));
  v('morgen', 'Datum von morgen', () => formatDate(new Date(Date.now() + 864e5), 'DD.MM.YYYY'));
  v('gestern', 'Datum von gestern', () => formatDate(new Date(Date.now() - 864e5), 'DD.MM.YYYY'));
  v('notiz', 'Titel der aktuellen Notiz', (app) => app.editor.title || '');
  v('zwischenablage', 'Inhalt der Zwischenablage', async () => { try { return await navigator.clipboard.readText(); } catch { return ''; } });
  v('uuid', 'Zufällige ID', () => uid());
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 864e5 + 1) / 7);
}

export class HotkeyManager {
  constructor(app) {
    this.app = app;
    this.recording = false;
    document.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get overrides() { return this.app.settings.shortcutOverrides || {}; }

  /** Aktuell gültiges Kürzel eines Befehls */
  shortcutFor(commandId) {
    if (commandId in this.overrides) return this.overrides[commandId] || '';
    return this.app.registry.commands.get(commandId)?.shortcut || '';
  }

  /** Eigene Hotkeys als Befehle + "/"-Einträge registrieren */
  syncCustomHotkeys() {
    const reg = this.app.registry;
    for (const id of [...reg.commands.keys()]) if (id.startsWith('custom:')) reg.unregisterCommand(id);
    for (const id of [...reg.slashCommands.keys()]) if (id.startsWith('custom:')) reg.unregisterSlashCommand(id);
    for (const hk of this.app.settings.hotkeys || []) {
      const id = 'custom:' + hk.id;
      const icon = hk.action === 'block' ? reg.blocks.get(hk.blockType)?.icon || 'zap' : hk.action === 'command' ? 'zap' : /datum|zeit|wochentag|iso|kw/.test(hk.template || '') ? 'calendar' : 'keyboard';
      reg.registerCommand({ id, name: hk.name, icon, group: 'Eigene Hotkeys', shortcut: hk.shortcut, run: () => this.runCustom(hk) });
      if (hk.slash !== false) {
        reg.registerSlashCommand({
          id, name: hk.name, icon, group: 'Eigene Hotkeys', shortcut: hk.shortcut,
          description: hk.action === 'text' ? (hk.template || '').slice(0, 40) : hk.action === 'block' ? 'Block einfügen' : 'Befehl ausführen',
          keywords: ['hotkey', 'makro', ...(hk.template ? [hk.template] : [])],
          run: () => this.runCustom(hk)
        });
      }
    }
  }

  /** Ersetzt {platzhalter} und {datum:FORMAT} */
  async expand(template) {
    const reg = this.app.registry;
    const parts = [];
    let last = 0;
    const re = /\{([a-zäöü]+)(?::([^}]+))?\}/gi;
    let m;
    while ((m = re.exec(template))) {
      parts.push(template.slice(last, m.index));
      const [whole, name, arg] = m;
      const key = name.toLowerCase();
      if (arg && ['datum', 'date'].includes(key)) parts.push(formatDate(new Date(), arg));
      else if (reg.variables.has(key)) parts.push(await reg.variables.get(key).value(this.app, arg));
      else parts.push(whole);
      last = m.index + whole.length;
    }
    parts.push(template.slice(last));
    return parts.join('');
  }

  async runCustom(hk) {
    const editor = this.app.editor;
    if (!editor.note && hk.action !== 'command') { toast('Öffne zuerst eine Notiz'); return; }
    if (hk.action === 'text') {
      editor.insertText(await this.expand(hk.template || ''));
    } else if (hk.action === 'block') {
      const focusedRow = document.activeElement?.closest?.('.block');
      const after = focusedRow?.dataset.id || editor.selectedBlockId || editor.note.blocks.at(-1)?.id;
      const b = editor.block(after);
      if (b && b.type === 'paragraph' && !(b.data.text || '').replace(/<br>/g, '').trim()) editor.convertBlock(after, hk.blockType);
      else {
        const nb = editor.insertBlock(hk.blockType, {}, after, { focus: editor.def(hk.blockType)?.text ? 'start' : false });
        if (!editor.def(hk.blockType)?.text) editor.afterNonTextInsert(nb);
      }
    } else if (hk.action === 'command') {
      this.app.runCommand(hk.commandId);
    }
  }

  matches(shortcut, pressed) {
    return shortcut && normalizeShortcut(shortcut) === pressed;
  }

  onKey(e) {
    if (this.recording || e.repeat && !e.ctrlKey) return;
    const pressed = eventToShortcut(e);
    if (!pressed || (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d+$/.test(pressed.split('+').pop()))) return;
    if (document.querySelector('.modal-backdrop') && !pressed.startsWith('Ctrl+,')) return;
    for (const cmd of this.app.registry.commands.values()) {
      const sc = this.shortcutFor(cmd.id);
      if (!this.matches(sc, pressed)) continue;
      if (cmd.when && !cmd.when(this.app)) continue;
      e.preventDefault();
      e.stopPropagation();
      this.app.runCommand(cmd.id);
      return;
    }
  }

  /** Prüft, welcher Befehl ein Kürzel bereits verwendet */
  conflict(shortcut, exceptId) {
    const n = normalizeShortcut(shortcut);
    for (const cmd of this.app.registry.commands.values()) {
      if (cmd.id !== exceptId && normalizeShortcut(this.shortcutFor(cmd.id)) === n) return cmd;
    }
    return null;
  }

  newHotkey() {
    return { id: uid(), name: 'Neuer Hotkey', shortcut: '', action: 'text', template: '{datum}', blockType: 'todo', commandId: '', slash: true };
  }
}
