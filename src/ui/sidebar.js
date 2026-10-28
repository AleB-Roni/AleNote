// Seitenleiste mit Ordnerstruktur, Favoriten und Plugin-Bereichen
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { contextMenu, confirmDialog, toast, modal } from './overlays.js';
import { todoBadge } from './calendar.js';
import { shortcutText } from '../core/shortcuts.js';
import { listTrash } from '../core/trash.js';
import { openTemplatePicker } from './templates.js';
import { openImport } from './export.js';
import { pageTree, childFolder, parentOf } from '../core/pages.js';
import { emojiNode } from '../core/emoji.js';

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
        { label: 'Neue Notiz aus Vorlage', icon: 'layers', run: () => app.runCommand('core.newFromTemplate') },
        { label: 'Neuer Ordner', icon: 'folderPlus', run: () => app.createFolder('') },
        { label: 'Importieren …', icon: 'upload', run: () => app.runCommand('core.import') },
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
    // Auf die Überschrift „Notizen“ ziehen = auf die oberste Ebene verschieben
    treeHeader.addEventListener('dragover', (e) => { if (this.dragPath && parentOf(this.dragPath)) { e.preventDefault(); treeHeader.classList.add('drop-root-head'); } });
    treeHeader.addEventListener('dragleave', () => treeHeader.classList.remove('drop-root-head'));
    treeHeader.addEventListener('drop', (e) => {
      treeHeader.classList.remove('drop-root-head');
      if (!this.dragPath) return;
      e.preventDefault();
      app.moveItem(this.dragPath, '');
    });

    const footer = h('div.sidebar-footer', {},
      h('button.icon-btn', { title: 'Einstellungen (Strg+,)', onclick: () => app.openSettings() }, icon('settings', 17)),
      h('button.icon-btn', { title: 'Eigene Hotkeys', onclick: () => app.openSettings('hotkeys') }, icon('keyboard', 17)),
      h('button.icon-btn', { title: 'Plugins', onclick: () => app.openSettings('plugins') }, icon('puzzle', 17)),
      h('button.icon-btn', { title: 'Hell/Dunkel wechseln', onclick: () => app.toggleTheme() }, icon('moon', 17)),
      this.trashBtn = h('button.icon-btn.trash-btn', { title: 'Papierkorb', onclick: () => app.openTrash() }, icon('trash', 17), h('span.trash-count')),
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
    return h('button.nav-btn', { onclick: run }, icon(ic, 16), h('span', { text: label }), h('span.nav-kbd', { text: shortcutText(shortcut) }));
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
    try { this.tree = pageTree(await this.app.api.tree()); } catch (err) { console.error(err); this.tree = []; }
    if (!this.app.account?.account) this.app.api.getVault().then((v) => { this.vaultName.textContent = String(v).split(/[\\/]/).pop(); if (this.vaultName.parentElement) this.vaultName.parentElement.title = 'Vault: ' + v; });
    this.app.account?.renderSidebarButton();
    this.renderTree();
    this.renderFavorites();
    this.renderPanels();
    this.app.events.emit('tree:change', this.tree);
    this.updateBadge();
    this.updateTrashBadge();
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

  /** Anzahl der Einträge im Papierkorb am Knopf unten */
  async updateTrashBadge(n) {
    if (n === undefined) { try { n = (await listTrash(this.app.api)).filter((x) => !x.empty).length; } catch { n = 0; } }
    const el = this.trashBtn?.querySelector('.trash-count');
    if (el) el.textContent = n ? String(n) : '';
    if (this.trashBtn) this.trashBtn.title = n ? `Papierkorb (${n})` : 'Papierkorb';
  }

  allNotes() {
    const list = [];
    const walk = (nodes) => nodes.forEach((n) => { if (n.type === 'note') list.push(n); if (n.children) walk(n.children); });
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
      } else {
        const kids = n.children ? this.filtered(n.children) : [];
        if (kids.length) out.push({ ...n, children: kids, forceOpen: true });
        else if (n.name.toLowerCase().includes(this.filter)) out.push(n);
      }
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
    const toggle = (force) => {
      const isOpen = force ?? !row.classList.contains('open');
      row.classList.toggle('open', isOpen);
      if (isOpen) { this.expanded.add(f.path); if (!inner.children.length) this.renderNodes(f.children, inner, depth + 1); }
      else this.expanded.delete(f.path);
      children.classList.toggle('open', isOpen);
      this.saveExpanded();
    };
    // Pfeil: auf-/zuklappen · Name: Ordner wie eine Seite öffnen (dort lässt sich Text schreiben)
    row.querySelector('.tree-chevron').addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    row.addEventListener('click', () => { toggle(true); this.app.openFolderPage(f.path); });
    row._toggle = toggle;
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.folderMenu(f, { x: e.clientX, y: e.clientY }); });
    this.makeDraggable(row, f.path);
    this.makeDropTarget(row, f.path, () => toggle(true));
    return h('div.tree-node', {}, row, children);
  }

  noteItem(n, depth, isFav = false) {
    const active = n.path === this.app.currentPath;
    const kids = !isFav && n.children?.length ? n.children : null;
    const open = !!kids && (n.forceOpen || this.expanded.has(n.path));
    const chevron = h('span.tree-chevron' + (kids ? '' : '.empty'), {}, kids ? icon('chevronRight', 13) : null);
    const row = h('div.tree-item.note' + (active ? '.active' : '') + (open ? '.open' : '') + (kids ? '.has-kids' : ''), { draggable: !isFav, dataset: { path: n.path }, style: { '--depth': depth } },
      chevron,
      n.icon ? h('span.tree-emoji', {}, emojiNode(n.icon)) : icon(kids ? 'files' : 'file', 15, 'tree-icon'),
      h('span.tree-label', { text: n.name }),
      h('div.tree-actions', {},
        isFav ? null : h('button.icon-btn.tiny', { title: 'Unterseite hinzufügen', onclick: (e) => { e.stopPropagation(); this.app.createSubpage(n.path); } }, icon('plus', 13)),
        h('button.icon-btn.tiny', { title: 'Mehr', onclick: (e) => { e.stopPropagation(); this.noteMenu(n, e.currentTarget); } }, icon('more', 13))));
    row.addEventListener('click', () => this.app.openNote(n.path));
    row.addEventListener('auxclick', (e) => { if (e.button === 1) this.app.openNote(n.path); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.noteMenu(n, { x: e.clientX, y: e.clientY }); });
    if (isFav) return row;
    this.makeDraggable(row, n.path);
    // Auf eine Seite ziehen = zur Unterseite machen
    const children = h('div.tree-children' + (open ? '.open' : ''));
    const inner = h('div.tree-children-inner');
    children.append(inner);
    if (open) this.renderNodes(kids, inner, depth + 1);
    const toggle = (force) => {
      if (!kids) return;
      const isOpen = force ?? !row.classList.contains('open');
      row.classList.toggle('open', isOpen);
      if (isOpen) { this.expanded.add(n.path); if (!inner.children.length) this.renderNodes(kids, inner, depth + 1); }
      else this.expanded.delete(n.path);
      children.classList.toggle('open', isOpen);
      this.saveExpanded();
    };
    chevron.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    this.makeDropTarget(row, childFolder(n.path), () => toggle(true), n.path);
    return h('div.tree-node', {}, row, children);
  }

  noteMenu(n, pos) {
    const app = this.app;
    const fav = (app.settings.favorites || []).includes(n.path);
    contextMenu([
      { label: 'Öffnen', icon: 'file', run: () => app.openNote(n.path) },
      { label: 'Unterseite hinzufügen', icon: 'filePlus', run: () => app.createSubpage(n.path) },
      { label: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: 'star', run: () => app.toggleFavorite(n.path) },
      '-',
      { label: 'Umbenennen', icon: 'edit', shortcut: 'F2', run: () => this.inlineRename(n.path) },
      { label: 'Verschieben nach …', icon: 'move', run: () => this.moveDialog(n.path) },
      ...(n.path.includes('/') ? [{ label: 'Auf oberste Ebene', icon: 'home', run: () => app.moveItem(n.path, '') }] : []),
      { label: 'Duplizieren', icon: 'copy', run: () => app.duplicateNote(n.path) },
      { label: 'Im Explorer zeigen', icon: 'external', run: () => app.api.revealInExplorer(n.path) },
      '-',
      { label: 'Löschen', icon: 'trash', danger: true, run: () => app.deleteItem(n.path, n.name) }
    ], pos);
  }

  folderMenu(f, pos) {
    const app = this.app;
    contextMenu([
      { label: 'Als Seite öffnen', icon: 'file', run: () => app.openFolderPage(f.path) },
      { label: 'Neue Notiz', icon: 'filePlus', run: () => { this.expanded.add(f.path); app.createNote(f.path); } },
      { label: 'Neue Notiz aus Vorlage', icon: 'layers', run: () => { this.expanded.add(f.path); openTemplatePicker(app, { mode: 'new', folder: f.path }); } },
      { label: 'Neuer Unterordner', icon: 'folderPlus', run: () => { this.expanded.add(f.path); app.createFolder(f.path); } },
      { label: 'Hierher importieren …', icon: 'upload', run: () => { this.expanded.add(f.path); openImport(app, f.path); } },
      '-',
      { label: 'Umbenennen', icon: 'edit', run: () => this.inlineRename(f.path) },
      { label: 'Verschieben nach …', icon: 'move', run: () => this.moveDialog(f.path) },
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

  /** Darf this.dragPath in den Ordner „folder“? (nicht in sich selbst oder die eigenen Unterseiten) */
  canDropInto(folder) {
    const d = this.dragPath;
    if (!d) return false;
    const own = d.endsWith('.alenote') ? childFolder(d) : d;
    return folder !== own && !folder.startsWith(own + '/') && folder !== parentOf(d);
  }

  /**
   * Ziel beim Ziehen: oberes/unteres Viertel einer Zeile = auf dieselbe Ebene wie dieser Eintrag
   * (Linie wird angezeigt), Mitte = hinein (als Unterseite bzw. in den Ordner).
   */
  makeDropTarget(row, folderPath, expand = () => row.click(), selfPath = folderPath) {
    let timer;
    const clear = () => { row.classList.remove('drop-into', 'drop-before', 'drop-after'); clearTimeout(timer); timer = null; };
    const zoneOf = (e) => {
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into';
    };
    const targetOf = (zone) => (zone === 'into' ? folderPath : parentOf(selfPath));
    row.addEventListener('dragover', (e) => {
      if (!this.dragPath || this.dragPath === selfPath) return;
      let zone = zoneOf(e);
      if (zone === 'into' && !this.canDropInto(folderPath)) zone = null;
      if (zone && zone !== 'into' && !this.canDropInto(targetOf(zone))) zone = this.canDropInto(folderPath) ? 'into' : null;
      if (!zone) { clear(); return; }
      e.preventDefault();
      e.stopPropagation();
      row.classList.toggle('drop-into', zone === 'into');
      row.classList.toggle('drop-before', zone === 'before');
      row.classList.toggle('drop-after', zone === 'after');
      row.title = zone === 'into' ? '' : (targetOf(zone) ? 'Auf diese Ebene verschieben' : 'Auf die oberste Ebene verschieben');
      if (zone === 'into') { if (!timer && !row.classList.contains('open')) timer = setTimeout(expand, 700); }
      else { clearTimeout(timer); timer = null; }
    });
    row.addEventListener('dragleave', clear);
    row.addEventListener('drop', (e) => {
      const zone = row.classList.contains('drop-into') ? 'into' : row.classList.contains('drop-before') ? 'before' : row.classList.contains('drop-after') ? 'after' : null;
      clear();
      row.title = '';
      if (!zone || !this.dragPath) return;
      e.preventDefault();
      e.stopPropagation();
      if (zone === 'into') this.expanded.add(selfPath);
      this.app.moveItem(this.dragPath, targetOf(zone));
    });
  }

  /** „Verschieben nach …“: Ziel aus einer Liste wählen (geht auch auf dem Handy) */
  moveDialog(path) {
    const isNote = path.endsWith('.alenote');
    const own = isNote ? childFolder(path) : path;
    const name = path.split('/').pop().replace(/\.alenote$/, '');
    const targets = [{ folder: '', label: 'Oberste Ebene', icon: 'home', depth: 0 }];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const folder = n.type === 'folder' ? n.path : childFolder(n.path);
        if (folder === own || folder.startsWith(own + '/')) continue;
        if (n.type === 'folder' || n.path !== path) targets.push({ folder, label: n.name, icon: n.type === 'folder' ? 'folder' : null, emoji: n.icon, depth: depth + 1, note: n.type === 'note' });
        if (n.children?.length) walk(n.children, depth + 1);
      }
    };
    walk(this.tree, 0);
    const search = h('input.input', { placeholder: 'Seite oder Ordner suchen …' });
    const list = h('div.move-list');
    const current = parentOf(path);
    let m;
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      for (const t of targets) {
        if (q && !t.label.toLowerCase().includes(q)) continue;
        const here = t.folder === current;
        list.append(h('button.move-item' + (here ? '.here' : ''), {
          style: { paddingLeft: (q ? 10 : 10 + t.depth * 16) + 'px' }, disabled: here,
          onclick: () => { m.close(); if (t.note) this.expanded.add(t.folder + '.alenote'); this.app.moveItem(path, t.folder); }
        }, t.emoji ? emojiNode(t.emoji, 'move-emoji') : icon(t.icon || 'file', 15), h('span', { text: t.label }),
        here ? h('span.muted.small', { text: 'aktuell' }) : t.note ? h('span.muted.small', { text: 'als Unterseite' }) : null));
      }
      if (!list.children.length) list.append(h('div.muted.small.move-empty', { text: 'Nichts gefunden' }));
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') list.querySelector('.move-item:not(:disabled)')?.click(); });
    render();
    m = modal({ title: `„${name}“ verschieben nach …`, content: h('div.move-dialog', {}, search, list), width: 'min(440px, 94vw)' });
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => search.focus(), 50);
  }

  setActive(path) {
    this.el.querySelectorAll('.tree-item.note').forEach((el) => el.classList.toggle('active', el.dataset.path === path));
    // Ordner bzw. Elternseiten der aktiven Notiz aufklappen
    if (path && path.includes('/')) {
      const parts = path.split('/').slice(0, -1);
      let changed = false;
      parts.forEach((_, i) => {
        const p = parts.slice(0, i + 1).join('/');
        for (const k of [p, p + '.alenote']) if (!this.expanded.has(k)) { this.expanded.add(k); changed = true; }
      });
      if (changed) { this.saveExpanded(); this.renderTree(); }
    }
  }

  async confirmDelete(name, isFolder, hasSubpages = false) {
    return confirmDialog(isFolder ? 'Ordner löschen?' : 'Notiz löschen?', `„${name}“${isFolder ? ' und alle Inhalte werden' : hasSubpages ? ' und alle Unterseiten werden' : ' wird'} in den Papierkorb verschoben und kann dort 30 Tage lang wiederhergestellt werden.`, { okLabel: 'In den Papierkorb' });
  }
}

export { toast };
