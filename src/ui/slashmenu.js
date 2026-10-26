// "/"-Menü zum schnellen Einfügen von Blöcken und Aktionen
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { shortcutHtml } from '../core/shortcuts.js';

export function scoreItem(item, q) {
  if (!q) return 1;
  q = q.toLowerCase();
  const name = (item.name || '').toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  if (name.includes(q)) return 50;
  if ((item.keywords || []).some((k) => k.toLowerCase().startsWith(q))) return 40;
  if ((item.description || '').toLowerCase().includes(q)) return 20;
  // Unscharfe Suche: alle Zeichen in Reihenfolge
  let i = 0;
  for (const c of name) if (c === q[i]) i++;
  return i === q.length ? 10 : 0;
}

export class SlashMenu {
  constructor(editor) {
    this.editor = editor;
    this.el = null;
    this.items = [];
    this.active = 0;
    this.query = '';
  }

  get isOpen() { return !!this.el; }

  open(rect, { onQuery, onSelect }) {
    this.close();
    this.onQuery = onQuery;
    this.onSelect = onSelect;
    this.rect = rect;
    this.el = h('div.slash-menu.menu');
    this.list = h('div.slash-list');
    this.el.append(this.list, h('div.slash-footer', { html: '<kbd>↑</kbd><kbd>↓</kbd> wählen · <kbd>Enter</kbd> einfügen · <kbd>Esc</kbd> schließen' }));
    document.body.append(this.el);
    this.query = '';
    this.renderList();
    this.position();
    this.outside = (e) => { if (!this.el?.contains(e.target)) this.close(); };
    setTimeout(() => document.addEventListener('mousedown', this.outside), 0);
  }

  position() {
    const r = this.rect || { left: 100, bottom: 100, top: 100 };
    const mr = this.el.getBoundingClientRect();
    let x = r.left - 8, y = r.bottom + 8;
    if (y + mr.height > innerHeight - 10) y = Math.max(10, r.top - mr.height - 8);
    if (x + mr.width > innerWidth - 10) x = innerWidth - mr.width - 10;
    this.el.style.left = Math.max(10, x) + 'px';
    this.el.style.top = y + 'px';
  }

  refresh() {
    if (!this.el) return;
    const q = this.onQuery?.();
    if (q == null || q.length > 40) { this.close(); return; }
    this.query = q;
    this.active = 0;
    this.renderList();
    if (!this.items.length && /\s$/.test(q)) this.close();
  }

  renderList() {
    const all = this.editor.registry.getSlashItems();
    const q = this.query.trim();
    this.list.innerHTML = '';
    let items;
    if (q) {
      items = all.map((it) => ({ it, s: scoreItem(it, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it);
    } else {
      const groups = new Map();
      for (const it of all) { if (!groups.has(it.group)) groups.set(it.group, []); groups.get(it.group).push(it); }
      items = [];
      for (const [g, list] of groups) { items.push({ header: g }); items.push(...list); }
    }
    this.items = items.filter((i) => !i.header);
    if (!this.items.length) {
      this.list.append(h('div.slash-empty', { text: 'Keine Treffer' }));
      return;
    }
    let idx = 0;
    for (const it of items) {
      if (it.header) { this.list.append(h('div.menu-header', { text: it.header })); continue; }
      const i = idx++;
      const row = h('button.slash-item' + (i === this.active ? '.active' : ''), { dataset: { index: i } },
        h('div.slash-icon', {}, icon(it.icon || 'zap', 18)),
        h('div.slash-text', {}, h('div.slash-name', { text: it.name }), it.description ? h('div.slash-desc', { text: it.description }) : null),
        it.shortcut ? h('div.slash-shortcut', { html: shortcutHtml(it.shortcut) }) : null);
      row.addEventListener('mousemove', () => { if (this.active !== i) { this.active = i; this.highlight(); } });
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this.active = i; this.choose(); });
      this.list.append(row);
    }
  }

  highlight() {
    this.list.querySelectorAll('.slash-item').forEach((el) => el.classList.toggle('active', +el.dataset.index === this.active));
    this.list.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  handleKey(e) {
    if (!this.el) return false;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); this.active = (this.active + 1) % Math.max(1, this.items.length); this.highlight(); return true; }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); this.active = (this.active - 1 + this.items.length) % Math.max(1, this.items.length); this.highlight(); return true; }
    if (e.key === 'Enter') {
      if (!this.items.length) { this.close(); return false; }
      e.preventDefault(); this.choose(); return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return true; }
    return false;
  }

  choose() {
    const item = this.items[this.active];
    const cb = this.onSelect;
    this.close();
    if (item) cb?.(item);
  }

  close() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    document.removeEventListener('mousedown', this.outside);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 140);
  }
}
