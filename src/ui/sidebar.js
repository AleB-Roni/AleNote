// Seitenleiste mit Ordnerstruktur, Favoriten und Plugin-Bereichen
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { contextMenu, confirmDialog, toast } from './overlays.js';
import { todoBadge } from './calendar.js';

export class Sidebar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.tree = [];
    this.filter = '';
    this.expanded = new Set(app.settings.expanded || []);
    this.build();
  }

  build() {
    const app = this.app;
    this.el.innerHTML = '';
    const brand = h('div.brand', {},
      h('div.brand-logo', { html: '<svg viewBox="0 0 32 32" width="22" height="22"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg)"/><path d="M10 22 16 9l6 13M12.5 17h7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      h('span.brand-name', { text: 'AleNote' }));

    this.searchInput = h('input.sidebar-search-input', { placeholder: 'Filtern…', spellcheck: 'false' });
    this.searchInput.addEventListener('input', () => { this.filter = this.searchInput.value.trim().toLowerCase(); this.renderTree(); });
    this.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.searchInput.value = ''; this.filter = ''; this.renderTree(); this.searchInput.blur(); } });

    const quick = h('div.sidebar-quick', {},
      this.navButton('search', 'Suchen & Befehle', 'Ctrl+P', () => app.palette.open()),
      this.navButton('filePlus', 'Neue Notiz', 'Ctrl+N', () => app.createNote(this.contextFolder())),
      this.navButton('folderPlus', 'Neuer Ordner', 'Ctrl+Shift+N', () => app.createFolder(this.contextFolder())),
      this.navButton('zap', 'Schnellnotiz', app.hotkeys?.shortcutFor('core.quickNote') || '', () => app.quickNote()),
      this.calBtn = this.navButton('calendar', 'Kalender', app.hotkeys?.shortcutFor('core.calendar') || '', () => app.openCalendar()));
    this.calBtn.classList.add('nav-calendar');
    this.calBadge = h('span.nav-badge');
    this.calBtn.querySelector('.nav-kbd').before(this.calBadge);

    this.favEl = h('div.sidebar-section');
    this.panelsEl = h('div.sidebar-panels');
    this.treeEl = h('div.tree');
    this.treeEl.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tree-item')) return;
      e.preventDefault();
      contextMenu([
        { label: 'Neue Notiz', icon: 'filePlus', run: () => app.createNote('') },
        { label: 'Neuer Ordner', icon: 'folderPlus', run: () => app.createFolder('') },
        '-',
        { label: 'Vault im Explorer öffnen', icon: 'external', run: () => app.api.openFolder('') }
      ], { x: e.clientX, y: e.clientY });
    });
    // Auf leere Fläche ziehen = in Hauptebene verschieben
    this.treeEl.addEventListener('dragover', (e) => { if (this.dragPath) { e.preventDefault(); this.treeEl.classList.add('drop-root'); } });
    this.treeEl.addEventListener('dragleave', (e) => { if (!this.treeEl.contains(e.relatedTarget)) this.treeEl.classList.remove('drop-root'); });
    this.treeEl.addEventListener('drop', (e) => {
      this.treeEl.classList.remove('drop-root');
      if (e.target.closest('.tree-item') || !this.dragPath) return;
      e.preventDefault();
      app.moveItem(this.dragPath, '');
    });

    const treeHeader = h('div.section-title', {}, h('span', { text: 'Notizen' }),
      h('div.section-actions', {},
        h('button.icon-btn.tiny', { title: 'Alle einklappen', onclick: () => { this.expanded.clear(); this.saveExpanded(); this.renderTree(); } }, icon('chevronRight', 13)),
        h('button.icon-btn.tiny', { title: 'Neue Notiz', onclick: () => app.createNote('') }, icon('plus', 14))));

    const footer = h('div.sidebar-footer', {},
      h('button.icon-btn', { title: 'Einstellungen (Strg+,)', onclick: () => app.openSettings() }, icon('settings', 17)),
      h('button.icon-btn', { title: 'Eigene Hotkeys', onclick: () => app.openSettings('hotkeys') }, icon('keyboard', 17)),
      h('button.icon-btn', { title: 'Plugins', onclick: () => app.openSettings('plugins') }, icon('puzzle', 17)),
      h('button.icon-btn', { title: 'Hell/Dunkel wechseln', onclick: () => app.toggleTheme() }, icon('moon', 17)),
      h('div.flex'),
      h('button.vault-btn', { title: 'Vault wechseln', onclick: () => app.chooseVault() }, icon('vault', 15), h('span.vault-name', { text: '' })));
    this.vaultName = footer.querySelector('.vault-name');

    this.el.append(brand, h('div.sidebar-search', {}, icon('search', 14), this.searchInput), quick, this.favEl, this.panelsEl,
      h('div.sidebar-scroll', {}, treeHeader, this.treeEl), footer);

    const resizer = h('div.sidebar-resizer');
    resizer.addEventListener('pointerdown', (e) => this.startResize(e));
    this.el.append(resizer);
  }

  navButton(ic, label, shortcut, run) {
    return h('button.nav-btn', { onclick: run }, icon(ic, 16), h('span', { text: label }), h('span.nav-kbd', { text: shortcut.replace('Ctrl', 'Strg') }));
  }

  startResize(e) {
    e.preventDefault();
    const startX = e.clientX, startW = this.el.offsetWidth;
    document.body.classList.add('col-resizing');
    const move = (ev) => document.documentElement.style.setProperty('--sidebar-w', Math.min(520, Math.max(200, startW + ev.clientX - startX)) + 'px');
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('col-resizing');
      this.app.saveSettings({ sidebarWidth: this.el.offsetWidth });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Ordner der aktuell geöffneten Notiz (für "Neue Notiz") */
  contextFolder() {
    const p = this.app.currentPath;
    return p && p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  }

  async refresh() {
    try { this.tree = await this.app.api.tree(); } catch (err) { console.error(err); this.tree = []; }
    if (!this.app.account?.account) this.app.api.getVault().then((v) => { this.vaultName.textContent = String(v).split(/[\\/]/).pop(); if (this.vaultName.parentElement) this.vaultName.parentElement.title = 'Vault: ' + v; });
    this.app.account?.renderSidebarButton();
    this.renderTree();
    this.renderFavorites();
    this.renderPanels();
    this.app.events.emit('tree:change', this.tree);
    this.updateBadge();
    return this.tree;
  }

  /** Zahl der heute fälligen bzw. überfälligen Aufgaben am Kalender-Knopf */
  updateBadge() {
    clearTimeout(this.badgeTimer);
    this.badgeTimer = setTimeout(async () => {
      try {
        const { today, overdue } = await todoBadge(this.app);
        const n = today + overdue;
        this.calBadge.textContent = n ? String(n) : '';
        this.calBadge.className = 'nav-badge' + (overdue ? ' overdue' : '');
        this.calBadge.title = `${today} heute fällig · ${overdue} überfällig`;
      } catch (err) { console.error(err); }
    }, 400);
  }

  allNotes() {
    const list = [];
    const walk = (nodes) => nodes.forEach((n) => (n.type === 'note' ? list.push(n) : walk(n.children)));
    walk(this.tree);
    return list;
  }

  saveExpanded() { this.app.saveSettings({ expanded: [...this.expanded] }); }

  renderFavorites() {
    const favs = (this.app.settings.favorites || []).map((p) => this.allNotes().find((n) => n.path === p)).filter(Boolean);
    this.favEl.innerHTML = '';
    if (!favs.length) return;
    this.favEl.append(h('div.section-title', {}, h('span', { text: 'Favoriten' })));
    for (const n of favs) this.favEl.append(this.noteItem(n, 0, true));
  }

  renderPanels() {
    this.panelsEl.innerHTML = '';
    for (const p of this.app.registry.sidebarPanels.values()) {
      const body = h('div.panel-body');
      this.panelsEl.append(h('div.sidebar-section', {}, h('div.section-title', {}, h('span', { text: p.title })), body));
      try { p.render(body, this.app.pluginApi(p.id)); } catch (err) { console.error(err); }
    }
  }

  renderTree() {
    this.treeEl.innerHTML = '';
    const nodes = this.filter ? this.filtered(this.tree) : this.tree;
    if (!nodes.length) {
      this.treeEl.append(h('div.tree-empty', {}, this.filter ? 'Nichts gefunden' : h('div', {}, 'Noch keine Notizen. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.app.createNote(''); } }, 'Erstelle die erste!'))));
      return;
    }
    this.renderNodes(nodes, this.treeEl, 0);
  }

  filtered(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'folder') {
        const kids = this.filtered(n.children);
        if (kids.length || n.name.toLowerCase().includes(this.filter)) out.push({ ...n, children: kids.length ? kids : n.children, forceOpen: true });
      } else if (n.name.toLowerCase().includes(this.filter)) out.push(n);
    }
    return out;
  }

  renderNodes(nodes, container, depth) {
    for (const n of nodes) {
      if (n.type === 'folder') container.append(this.folderItem(n, depth));
      else container.append(this.noteItem(n, depth));
    }
  }

  folderItem(f, depth) {
    const open = f.forceOpen || this.expanded.has(f.path);
    const row = h('div.tree-item.folder' + (open ? '.open' : ''), { draggable: true, dataset: { path: f.path }, style: { '--depth': depth } },
      h('span.tree-chevron', {}, icon('chevronRight', 13)),
      icon(open ? 'folder' : 'folder', 15, 'tree-icon folder-icon'),
      h('span.tree-label', { text: f.name }),
      h('span.tree-count', { text: f.children.length || '' }),
      h('div.tree-actions', {},
        h('button.icon-btn.tiny', { title: 'Neue Notiz im Ordner', onclick: (e) => { e.stopPropagation(); this.expanded.add(f.path); this.app.createNote(f.path); } }, icon('plus', 13)),
        h('button.icon-btn.tiny', { title: 'Mehr', onclick: (e) => { e.stopPropagation(); this.folderMenu(f, e.currentTarget); } }, icon('more', 13))));
    const children = h('div.tree-children' + (open ? '.open' : ''));
    const inner = h('div.tree-children-inner');
    children.append(inner);
    if (open) this.renderNodes(f.children, inner, depth + 1);
    row.addEventListener('click', () => {
      const isOpen = !row.classList.contains('open');
      row.classList.toggle('open', isOpen);
      if (isOpen) { this.expanded.add(f.path); if (!inner.children.length) this.renderNodes(f.children, inner, depth + 1); }
      else this.expanded.delete(f.path);
      children.classList.toggle('open', isOpen);
      this.saveExpanded();
    });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.folderMenu(f, { x: e.clientX, y: e.clientY }); });
    this.makeDraggable(row, f.path);
    this.makeDropTarget(row, f.path);
    return h('div.tree-node', {}, row, children);
  }

  noteItem(n, depth, isFav = false) {
    const active = n.path === this.app.currentPath;
    const row = h('div.tree-item.note' + (active ? '.active' : ''), { draggable: !isFav, dataset: { path: n.path }, style: { '--depth': depth } },
      h('span.tree-chevron.empty'),
      n.icon ? h('span.tree-emoji', { text: n.icon }) : icon('file', 15, 'tree-icon'),
      h('span.tree-label', { text: n.name }),
      h('div.tree-actions', {}, h('button.icon-btn.tiny', { title: 'Mehr', onclick: (e) => { e.stopPropagation(); this.noteMenu(n, e.currentTarget); } }, icon('more', 13))));
    row.addEventListener('click', () => this.app.openNote(n.path));
    row.addEventListener('auxclick', (e) => { if (e.button === 1) this.app.openNote(n.path); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.noteMenu(n, { x: e.clientX, y: e.clientY }); });
    if (!isFav) this.makeDraggable(row, n.path);
    return row;
  }

  noteMenu(n, pos) {
    const app = this.app;
    const fav = (app.settings.favorites || []).includes(n.path);
    contextMenu([
      { label: 'Öffnen', icon: 'file', run: () => app.openNote(n.path) },
      { label: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: 'star', run: () => app.toggleFavorite(n.path) },
      '-',
      { label: 'Umbenennen', icon: 'edit', shortcut: 'F2', run: () => this.inlineRename(n.path) },
      { label: 'Duplizieren', icon: 'copy', run: () => app.duplicateNote(n.path) },
      { label: 'Im Explorer zeigen', icon: 'external', run: () => app.api.revealInExplorer(n.path) },
      '-',
      { label: 'Löschen', icon: 'trash', danger: true, run: () => app.deleteItem(n.path, n.name) }
    ], pos);
  }

  folderMenu(f, pos) {
    const app = this.app;
    contextMenu([
      { label: 'Neue Notiz', icon: 'filePlus', run: () => { this.expanded.add(f.path); app.createNote(f.path); } },
      { label: 'Neuer Unterordner', icon: 'folderPlus', run: () => { this.expanded.add(f.path); app.createFolder(f.path); } },
      '-',
      { label: 'Umbenennen', icon: 'edit', run: () => this.inlineRename(f.path) },
      { label: 'Im Explorer öffnen', icon: 'external', run: () => app.api.openFolder(f.path) },
      '-',
      { label: 'Ordner löschen', icon: 'trash', danger: true, run: () => app.deleteItem(f.path, f.name, true) }
    ], pos);
  }

  inlineRename(path) {
    const row = this.treeEl.querySelector(`.tree-item[data-path="${CSS.escape(path)}"]`);
    if (!row) return;
    const label = row.querySelector('.tree-label');
    const old = label.textContent;
    const input = h('input.tree-rename', { value: old });
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (save && val && val !== old) await this.app.renameItem(path, val);
      else input.replaceWith(label);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  makeDraggable(row, path) {
    row.addEventListener('dragstart', (e) => {
      this.dragPath = path;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/alenote-path', path);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => { this.dragPath = null; row.classList.remove('dragging'); this.treeEl.querySelectorAll('.drop-into').forEach((x) => x.classList.remove('drop-into')); });
  }

  makeDropTarget(row, folderPath) {
    let timer;
    row.addEventListener('dragover', (e) => {
      if (!this.dragPath || this.dragPath === folderPath || folderPath.startsWith(this.dragPath + '/')) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add('drop-into');
      if (!timer && !row.classList.contains('open')) timer = setTimeout(() => row.click(), 700);
    });
    row.addEventListener('dragleave', () => { row.classList.remove('drop-into'); clearTimeout(timer); timer = null; });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(timer); timer = null;
      row.classList.remove('drop-into');
      if (this.dragPath) {
        this.expanded.add(folderPath);
        this.app.moveItem(this.dragPath, folderPath);
      }
    });
  }

  setActive(path) {
    this.el.querySelectorAll('.tree-item.note').forEach((el) => el.classList.toggle('active', el.dataset.path === path));
    // Ordner der aktiven Notiz aufklappen
    if (path && path.includes('/')) {
      const parts = path.split('/').slice(0, -1);
      let changed = false;
      parts.forEach((_, i) => { const p = parts.slice(0, i + 1).join('/'); if (!this.expanded.has(p)) { this.expanded.add(p); changed = true; } });
      if (changed) { this.saveExpanded(); this.renderTree(); }
    }
  }

  async confirmDelete(name, isFolder) {
    return confirmDialog(isFolder ? 'Ordner löschen?' : 'Notiz löschen?', `"${name}"${isFolder ? ' und alle Inhalte werden' : ' wird'} in den Papierkorb verschoben.`);
  }
}

export { toast };
