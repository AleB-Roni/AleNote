// Befehlspalette (Strg+P): Notizen öffnen, Volltextsuche, Befehle & eigene Hotkeys ausführen
import { emojiNode } from '../core/emoji.js';
import { h, debounce, escapeHtml } from '../core/utils.js';
import { icon } from './icons.js';
import { shortcutHtml } from '../core/shortcuts.js';
import { scoreItem } from './slashmenu.js';

export class CommandPalette {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.searchContent = debounce((q) => this.fullText(q), 220);
  }

  open(initial = '') {
    if (this.el) { this.input.select(); return; }
    this.lastFocus = document.activeElement;
    this.savedRange = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null;
    this.backdrop = h('div.palette-backdrop');
    this.el = h('div.palette');
    this.input = h('input.palette-input', { placeholder: 'Notiz suchen…   ( > für Befehle )', spellcheck: 'false', value: initial });
    this.list = h('div.palette-list');
    this.el.append(h('div.palette-head', {}, icon('search', 18), this.input), this.list,
      h('div.palette-footer', { html: '<span><kbd>↑</kbd><kbd>↓</kbd> navigieren</span><span><kbd>Enter</kbd> öffnen</span><span><kbd>&gt;</kbd> Befehle</span><span><kbd>Esc</kbd> schließen</span>' }));
    this.backdrop.append(this.el);
    document.body.append(this.backdrop);
    this.backdrop.addEventListener('mousedown', (e) => { if (e.target === this.backdrop) this.close(); });
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.active = 0;
    this.update();
    setTimeout(() => this.input.focus(), 10);
  }

  close(restore = true) {
    if (!this.el) return;
    const bd = this.backdrop;
    bd.classList.add('leaving');
    setTimeout(() => bd.remove(), 180);
    this.el = null;
    if (restore) this.restoreFocus();
  }

  restoreFocus() {
    if (this.lastFocus && this.lastFocus.isConnected && this.lastFocus.focus) {
      this.lastFocus.focus({ preventScroll: true });
      if (this.savedRange && this.lastFocus.contains(this.savedRange.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(this.savedRange);
      }
    }
  }

  commandItems() {
    const items = [];
    for (const c of this.app.registry.commands.values()) {
      if (c.hidden || (c.when && !c.when(this.app))) continue;
      items.push({ kind: 'command', name: c.name, icon: c.icon || 'zap', group: c.group, shortcut: this.app.hotkeys.shortcutFor(c.id), run: c.run, id: c.id, description: c.group });
    }
    return items;
  }

  update() {
    const raw = this.input.value;
    const commandsOnly = raw.startsWith('>');
    const q = (commandsOnly ? raw.slice(1) : raw).trim();
    const sections = [];
    if (!commandsOnly) {
      const notes = this.app.sidebar.allNotes();
      let noteItems;
      if (q) noteItems = notes.map((n) => ({ n, s: scoreItem({ name: n.name, description: n.path }, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.n);
      else {
        const recent = (this.app.settings.recent || []).map((p) => notes.find((n) => n.path === p)).filter(Boolean);
        noteItems = (recent.length ? recent : notes).slice(0, 8);
      }
      sections.push({ title: q ? 'Notizen' : 'Zuletzt geöffnet', items: noteItems.map((n) => ({ kind: 'note', name: n.name, emoji: n.icon, icon: 'file', description: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '', path: n.path })) });
      if (q && !noteItems.some((n) => n.name.toLowerCase() === q.toLowerCase())) {
        sections[0].items.push({ kind: 'create', name: `"${q}" als neue Notiz anlegen`, icon: 'filePlus', title: q });
      }
    }
    let cmds = this.commandItems();
    if (q) cmds = cmds.map((c) => ({ c, s: scoreItem(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
    sections.push({ title: 'Befehle', items: cmds.slice(0, commandsOnly ? 60 : q ? 8 : 6) });
    this.contentSection = { title: 'Im Inhalt gefunden', items: [] };
    if (!commandsOnly) sections.push(this.contentSection);
    this.sections = sections;
    this.active = 0;
    this.render();
    if (!commandsOnly && q.length >= 2) this.searchContent(q);
  }

  async fullText(q) {
    if (!this.el) return;
    const results = await this.app.api.search(q).catch(() => []);
    if (!this.el || this.input.value.trim() !== q) return;
    const shown = new Set(this.sections[0]?.items.map((i) => i.path));
    this.contentSection.items = results.filter((r) => !shown.has(r.path)).slice(0, 10).map((r) => ({
      kind: 'note', name: r.name, emoji: r.icon, icon: 'file', path: r.path, snippetHtml: highlight(r.snippet, q)
    }));
    this.render(true);
  }

  flat() { return this.sections.flatMap((s) => s.items); }

  render(keepActive = false) {
    if (!keepActive) this.active = 0;
    this.list.innerHTML = '';
    let i = 0;
    for (const s of this.sections) {
      if (!s.items.length) continue;
      this.list.append(h('div.palette-section', { text: s.title }));
      for (const it of s.items) {
        const idx = i++;
        const row = h('div.palette-item' + (idx === this.active ? '.active' : ''), { dataset: { index: idx } },
          it.emoji ? h('span.palette-emoji', {}, emojiNode(it.emoji)) : icon(it.icon, 16),
          h('div.palette-text', {},
            h('div.palette-name', { text: it.name }),
            it.snippetHtml ? h('div.palette-desc', { html: it.snippetHtml }) : it.description ? h('div.palette-desc', { text: it.description }) : null),
          it.shortcut ? h('div.palette-shortcut', { html: shortcutHtml(it.shortcut) }) : null);
        row.addEventListener('mousemove', () => { if (this.active !== idx) { this.active = idx; this.highlight(); } });
        row.addEventListener('click', () => { this.active = idx; this.choose(); });
        this.list.append(row);
      }
    }
    if (!i) this.list.append(h('div.palette-empty', { text: 'Keine Treffer' }));
  }

  highlight() {
    this.list.querySelectorAll('.palette-item').forEach((el) => el.classList.toggle('active', +el.dataset.index === this.active));
    this.list.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    const n = this.flat().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active = (this.active + 1) % Math.max(1, n); this.highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active = (this.active - 1 + n) % Math.max(1, n); this.highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.choose(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
  }

  async choose() {
    const it = this.flat()[this.active];
    if (!it) return;
    if (it.kind === 'note') { this.close(false); this.app.openNote(it.path); }
    else if (it.kind === 'create') { this.close(false); this.app.createNote(this.app.sidebar.contextFolder(), it.title); }
    else {
      // Fokus zurückgeben, damit z.B. "Datum einfügen" an der Cursorposition landet
      this.close(true);
      await new Promise((r) => setTimeout(r, 20));
      this.app.runCommand(it.id);
    }
  }
}

function highlight(snippet, q) {
  if (!snippet) return '';
  const safe = escapeHtml(snippet);
  const re = new RegExp(escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}
