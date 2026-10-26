// AleNote – Start der Oberfläche
import { api } from './core/api.js';
import { EventBus } from './core/events.js';
import { Registry } from './core/registry.js';
import { PluginManager } from './core/plugins.js';
import { HotkeyManager, DEFAULT_HOTKEYS, registerDefaultVariables } from './core/hotkeys.js';
import { h, debounce } from './core/utils.js';
import { registerBuiltinBlocks } from './blocks/index.js';
import { editable, htmlToMarkdown } from './blocks/text.js';
import { registerBuiltinThemes } from './themes.js';
import { Editor } from './ui/editor.js';
import { Sidebar } from './ui/sidebar.js';
import { CommandPalette } from './ui/palette.js';
import { openSettings, FONTS, ACCENTS } from './ui/settings.js';
import { icon } from './ui/icons.js';
import { toast, modal, prompt, confirmDialog, contextMenu } from './ui/overlays.js';
import { welcomeNote } from './welcome.js';

class App {
  constructor() {
    this.api = api;
    this.events = new EventBus();
    this.registry = new Registry(this.events);
    this.settings = {};
    this.currentPath = null;
    this.saveQueue = Promise.resolve();
    this.dirty = false;
  }

  async start() {
    this.settings = await api.getSettings();
    if (!this.settings.hotkeys) this.settings.hotkeys = structuredClone(DEFAULT_HOTKEYS);

    registerBuiltinThemes(this.registry);
    registerBuiltinBlocks(this.registry);
    registerDefaultVariables(this.registry);
    this.registerCoreCommands();
    this.registerCoreSlashCommands();

    this.buildLayout();
    this.applySettings();

    this.hotkeys = new HotkeyManager(this);
    this.sidebar = new Sidebar(this, this.sidebarEl);
    this.editor = new Editor(this, this.editorScroll);
    this.palette = new CommandPalette(this);
    this.scheduleSave = debounce(() => this.saveNow(), this.settings.saveDelay || 600);

    this.plugins = new PluginManager(this);
    await this.plugins.loadAll();
    this.hotkeys.syncCustomHotkeys();

    const tree = await this.sidebar.refresh();
    if (!tree.length && !this.settings.welcomed) {
      const p = await api.createNote('', 'Willkommen bei AleNote', welcomeNote());
      await this.saveSettings({ welcomed: true });
      await this.sidebar.refresh();
      await this.openNote(p);
    } else {
      const last = this.settings.lastOpen;
      if (last && this.sidebar.allNotes().some((n) => n.path === last)) await this.openNote(last);
      else this.showEmpty();
    }

    window.addEventListener('beforeunload', () => { if (this.dirty) this.saveNow(); });
    window.addEventListener('focus', () => this.sidebar.refresh());
    document.body.classList.add('ready');
    this.events.emit('app:ready', this);
  }

  // ================= Layout =================

  buildLayout() {
    const root = document.getElementById('app');
    root.innerHTML = '';
    this.sidebarEl = h('aside.sidebar');
    this.breadcrumbEl = h('div.breadcrumb');
    this.statusEl = h('div.save-status');
    this.statusItems = h('div.status-items');
    const topbar = h('header.topbar', {},
      h('button.icon-btn.sidebar-toggle', { title: 'Seitenleiste (Strg+\\)', onclick: () => this.toggleSidebar() }, icon('sidebar', 17)),
      this.breadcrumbEl,
      h('div.flex.drag-region'),
      this.statusItems,
      this.statusEl,
      h('button.icon-btn.fav-btn', { title: 'Favorit', onclick: () => this.currentPath && this.toggleFavorite(this.currentPath) }, icon('star', 17)),
      h('button.icon-btn', { title: 'Mehr', onclick: (e) => this.noteMenu(e.currentTarget) }, icon('more', 17)),
      h('div.titlebar-spacer'));
    this.editorScroll = h('div.editor-scroll');
    this.mainEl = h('main.main', {}, topbar, this.editorScroll);
    root.append(this.sidebarEl, this.mainEl);
  }

  showEmpty() {
    this.currentPath = null;
    this.editor.note = null;
    this.editorScroll.innerHTML = '';
    this.breadcrumbEl.innerHTML = '';
    this.statusEl.textContent = '';
    this.mainEl.classList.remove('has-note');
    this.editorScroll.append(h('div.empty-state', {},
      h('div.empty-logo', { html: '<svg viewBox="0 0 32 32" width="72" height="72"><defs><linearGradient id="lg3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg3)"/><path d="M10 22 16 9l6 13M12.5 17h7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      h('h2', { text: 'Bereit für neue Ideen?' }),
      h('p.muted', { text: 'Wähle links eine Notiz oder lege eine neue an.' }),
      h('div.empty-actions', {},
        h('button.btn.btn-primary', { onclick: () => this.createNote('') }, icon('filePlus', 16), 'Neue Notiz'),
        h('button.btn', { onclick: () => this.palette.open() }, icon('search', 16), 'Suchen')),
      h('div.empty-hints', { html: '<span><kbd>Strg</kbd><kbd>N</kbd> Neue Notiz</span><span><kbd>Strg</kbd><kbd>P</kbd> Suchen & Befehle</span><span><kbd>/</kbd> Blöcke einfügen</span>' })));
  }

  applySettings() {
    const s = this.settings;
    const root = document.documentElement;
    const theme = this.registry.themes.get(s.theme || 'dark') || this.registry.themes.get('dark');
    for (const t of this.registry.themes.values()) for (const k of Object.keys(t.vars)) root.style.removeProperty(k);
    for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
    root.dataset.theme = theme.dark ? 'dark' : 'light';
    const accent = s.accent || theme.accent || ACCENTS[0];
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-2', shiftHue(accent, 40));
    root.style.setProperty('--font', (FONTS[s.font] || FONTS.system).css);
    root.style.setProperty('--font-size', (s.fontSize || 16) + 'px');
    root.style.setProperty('--page-w', { narrow: '680px', normal: '820px', wide: '1080px', full: '100%' }[s.width || 'normal']);
    if (s.sidebarWidth) root.style.setProperty('--sidebar-w', s.sidebarWidth + 'px');
    document.body.classList.toggle('no-anim', s.animations === false);
    document.body.classList.toggle('no-glass', s.glass === false);
    document.body.classList.toggle('hide-handles', s.showHandles === false);
    document.body.classList.toggle('focus-mode', !!s.focusMode);
    document.body.classList.toggle('sidebar-hidden', !!s.sidebarHidden);
    document.body.spellcheck = s.spellcheck !== false;
    document.body.setAttribute('spellcheck', s.spellcheck !== false ? 'true' : 'false');
    const cs = getComputedStyle(root);
    api.setTitleBar?.('#00000000', cs.getPropertyValue('--text-2').trim() || '#aaa');
    this.events.emit('theme:change', theme.id);
  }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    this.applySettings();
    if (patch.saveDelay && this.scheduleSave) { this.scheduleSave.flush?.(); this.scheduleSave = debounce(() => this.saveNow(), patch.saveDelay); }
    this.events.emit('settings:change', this.settings);
    try { await api.setSettings(patch); } catch (err) { console.error(err); }
  }

  toggleSidebar() { this.saveSettings({ sidebarHidden: !this.settings.sidebarHidden }); }

  toggleTheme() {
    const cur = this.registry.themes.get(this.settings.theme || 'dark');
    this.saveSettings({ theme: cur?.dark ? (this.settings.lastLightTheme || 'light') : (this.settings.lastDarkTheme || 'dark'), [cur?.dark ? 'lastDarkTheme' : 'lastLightTheme']: cur?.id });
  }

  openSettings(tab) { openSettings(this, tab); }

  // ================= Notizen =================

  async openNote(path) {
    if (path === this.currentPath && this.editor.note) return;
    await this.saveNow();
    let note;
    try { note = await api.readNote(path); }
    catch (err) { toast('Notiz konnte nicht geöffnet werden', { type: 'error' }); console.error(err); this.sidebar.refresh(); return; }
    this.currentPath = path;
    this.mainEl.classList.add('has-note');
    this.editorScroll.classList.remove('page-enter');
    void this.editorScroll.offsetWidth;
    this.editorScroll.classList.add('page-enter');
    this.editor.load(note || {}, path);
    this.updateChrome();
    this.sidebar.setActive(path);
    const recent = [path, ...(this.settings.recent || []).filter((p) => p !== path)].slice(0, 15);
    this.saveSettings({ lastOpen: path, recent });
    this.events.emit('note:open', this.editor.note, path);
    const first = this.editor.note.blocks[0];
    if (first && this.editor.note.blocks.length === 1 && !first.data.text) setTimeout(() => this.editor.titleEl.focus(), 50);
  }

  updateChrome() {
    const path = this.currentPath;
    this.breadcrumbEl.innerHTML = '';
    if (!path) return;
    const parts = path.split('/');
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const label = last ? p.replace(/\.alenote$/, '') : p;
      if (i) this.breadcrumbEl.append(h('span.crumb-sep', { text: '/' }));
      this.breadcrumbEl.append(h('span.crumb' + (last ? '.current' : ''), {}, last && this.editor.note?.icon ? this.editor.note.icon + ' ' : '', label));
    });
    const fav = (this.settings.favorites || []).includes(path);
    this.mainEl.querySelector('.fav-btn').classList.toggle('active', fav);
    document.title = `${parts.at(-1).replace(/\.alenote$/, '')} – AleNote`;
  }

  setStatus(text, cls = '') {
    this.statusEl.textContent = text;
    this.statusEl.className = 'save-status ' + cls;
  }

  saveNow() {
    if (!this.editor?.note || !this.currentPath) return this.saveQueue;
    this.scheduleSave?.cancel?.();
    const path = this.currentPath;
    const data = JSON.parse(JSON.stringify({ version: 1, created: this.editor.note.created || Date.now(), ...this.editor.note }));
    this.dirty = false;
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await api.writeNote(path, data);
        this.setStatus('Gespeichert', 'saved');
        this.events.emit('note:save', data, path);
      } catch (err) {
        console.error(err);
        this.setStatus('Fehler beim Speichern', 'error');
      }
    });
    return this.saveQueue;
  }

  async createNote(folder = '', name = 'Unbenannt') {
    await this.saveNow();
    const data = { version: 1, created: Date.now(), updated: Date.now(), icon: '', blocks: [], floats: [] };
    const p = await api.createNote(folder, name, data);
    await this.sidebar.refresh();
    await this.openNote(p);
    setTimeout(() => { this.editor.titleEl?.focus(); document.execCommand('selectAll'); }, 60);
    return p;
  }

  async createFolder(parent = '') {
    const name = await prompt('Neuer Ordner', { placeholder: 'Ordnername', okLabel: 'Erstellen' });
    if (!name) return;
    const p = await api.createFolder(parent, name);
    this.sidebar.expanded.add(p);
    if (parent) this.sidebar.expanded.add(parent);
    this.sidebar.saveExpanded();
    await this.sidebar.refresh();
    toast(`Ordner "${name}" erstellt`, { type: 'success' });
  }

  /** Pfade in Einstellungen (Favoriten, Zuletzt, ...) nach Umbenennen/Verschieben anpassen */
  remapPaths(from, to) {
    const map = (p) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p);
    const favorites = (this.settings.favorites || []).map(map);
    const recent = (this.settings.recent || []).map(map);
    const expanded = [...this.sidebar.expanded].map(map);
    this.sidebar.expanded = new Set(expanded);
    if (this.currentPath) this.currentPath = map(this.currentPath);
    if (this.editor.path) this.editor.path = this.currentPath;
    this.saveSettings({ favorites, recent, expanded, lastOpen: this.currentPath });
  }

  async renameItem(path, newName) {
    await this.saveNow();
    try {
      const np = await api.rename(path, newName);
      if (np !== path) this.remapPaths(path, np);
      await this.sidebar.refresh();
      this.updateChrome();
      if (this.editor.titleEl && this.currentPath === np) this.editor.titleEl.textContent = this.editor.title;
      return np;
    } catch (err) { toast('Umbenennen fehlgeschlagen: ' + err.message, { type: 'error' }); }
  }

  renameCurrent(title) {
    const name = (title || '').trim() || 'Unbenannt';
    // Nacheinander ausführen, damit Enter + Blur nicht doppelt umbenennen
    this.renameChain = (this.renameChain || Promise.resolve()).then(async () => {
      if (!this.currentPath || name === this.editor.title) return;
      await this.renameItem(this.currentPath, name);
    });
    return this.renameChain;
  }

  async moveItem(path, folder) {
    await this.saveNow();
    try {
      const np = await api.move(path, folder);
      if (np !== path) { this.remapPaths(path, np); toast('Verschoben', { type: 'success' }); }
      await this.sidebar.refresh();
      this.updateChrome();
      this.sidebar.setActive(this.currentPath);
    } catch (err) { toast(err.message, { type: 'error' }); }
  }

  async duplicateNote(path) {
    await this.saveNow();
    const np = await api.duplicate(path);
    await this.sidebar.refresh();
    this.openNote(np);
  }

  async deleteItem(path, name, isFolder = false) {
    if (!(await this.sidebar.confirmDelete(name, isFolder))) return;
    const affectsCurrent = this.currentPath && (this.currentPath === path || this.currentPath.startsWith(path + '/'));
    if (affectsCurrent) { this.scheduleSave.cancel(); this.editor.note = null; }
    await api.remove(path);
    this.saveSettings({ favorites: (this.settings.favorites || []).filter((p) => p !== path && !p.startsWith(path + '/')) });
    await this.sidebar.refresh();
    if (affectsCurrent) this.showEmpty();
    toast(`"${name}" gelöscht`, { type: 'success' });
  }

  toggleFavorite(path) {
    const favs = new Set(this.settings.favorites || []);
    favs.has(path) ? favs.delete(path) : favs.add(path);
    this.saveSettings({ favorites: [...favs] });
    this.sidebar.renderFavorites();
    this.updateChrome();
  }

  async chooseVault() {
    const v = await api.chooseVault();
    if (!v) return;
    this.scheduleSave.cancel();
    await this.saveSettings({ lastOpen: null, recent: [], favorites: [], expanded: [] });
    location.reload();
  }

  noteMenu(anchor) {
    const p = this.currentPath;
    const items = [
      { label: 'Volle Breite', icon: 'alignCenter', active: !!this.editor.note?.fullWidth, run: () => { if (!this.editor.note) return; this.editor.note.fullWidth = !this.editor.note.fullWidth; this.editor.changed(true); this.editor.renderAll(); } },
      { label: 'Freies Bild hinzufügen', icon: 'move', run: () => this.runCommand('core.floatImage') },
      '-',
      ...this.extraNoteMenuItems(),
      { label: 'Im Explorer zeigen', icon: 'external', run: () => p && api.revealInExplorer(p) },
      { label: 'Duplizieren', icon: 'copy', run: () => p && this.duplicateNote(p) },
      '-',
      { label: 'Notiz löschen', icon: 'trash', danger: true, run: () => p && this.deleteItem(p, this.editor.title) }
    ];
    contextMenu(items, anchor);
  }

  extraNoteMenuItems() {
    return [...this.registry.commands.values()].filter((c) => c.noteMenu).map((c) => ({ label: c.name, icon: c.icon, run: () => this.runCommand(c.id) }));
  }

  async saveImageFile(file) {
    const buf = await file.arrayBuffer();
    return api.saveAsset(file.name || 'bild.png', buf);
  }

  lightbox(src) {
    const bd = h('div.lightbox', { onclick: () => { bd.classList.add('leaving'); setTimeout(() => bd.remove(), 200); } }, h('img', { src }));
    document.body.append(bd);
  }

  runCommand(id) {
    const cmd = this.registry.commands.get(id);
    if (!cmd) return;
    try { return cmd.run(this); } catch (err) { console.error(err); toast('Fehler: ' + err.message, { type: 'error' }); }
  }

  restoreDefaultHotkeys() {
    const list = this.settings.hotkeys || [];
    for (const d of DEFAULT_HOTKEYS) if (!list.some((x) => x.id === d.id)) list.push(structuredClone(d));
    this.saveSettings({ hotkeys: list });
    this.hotkeys.syncCustomHotkeys();
  }

  addStatusItem(id, el) {
    el.dataset.statusId = id;
    this.statusItems.querySelector(`[data-status-id="${id}"]`)?.remove();
    this.statusItems.append(el);
    return el;
  }

  // ================= Eingebaute Befehle =================

  registerCoreCommands() {
    const r = this.registry;
    const hasNote = () => !!this.editor?.note;
    const notInField = () => !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || !!document.activeElement?.closest?.('.editor-scroll');
    r.registerCommand({ id: 'core.newNote', name: 'Neue Notiz', icon: 'filePlus', shortcut: 'Ctrl+N', group: 'Notizen', run: () => this.createNote(this.sidebar.contextFolder()) });
    r.registerCommand({ id: 'core.newFolder', name: 'Neuer Ordner', icon: 'folderPlus', shortcut: 'Ctrl+Shift+N', group: 'Notizen', run: () => this.createFolder(this.sidebar.contextFolder()) });
    r.registerCommand({ id: 'core.palette', name: 'Suchen & Befehle', icon: 'search', shortcut: 'Ctrl+P', group: 'Navigation', run: () => this.palette.open() });
    r.registerCommand({ id: 'core.commands', name: 'Nur Befehle anzeigen', icon: 'zap', shortcut: 'Ctrl+Shift+P', group: 'Navigation', run: () => this.palette.open('>') });
    r.registerCommand({ id: 'core.search', name: 'Notizen filtern (Seitenleiste)', icon: 'search', shortcut: 'Ctrl+Shift+F', group: 'Navigation', run: () => { if (this.settings.sidebarHidden) this.toggleSidebar(); this.sidebar.searchInput.focus(); } });
    r.registerCommand({ id: 'core.settings', name: 'Einstellungen öffnen', icon: 'settings', shortcut: 'Ctrl+,', group: 'Allgemein', run: () => this.openSettings() });
    r.registerCommand({ id: 'core.hotkeys', name: 'Eigene Hotkeys verwalten', icon: 'keyboard', group: 'Allgemein', run: () => this.openSettings('hotkeys') });
    r.registerCommand({ id: 'core.toggleSidebar', name: 'Seitenleiste ein-/ausblenden', icon: 'sidebar', shortcut: 'Ctrl+\\', group: 'Ansicht', run: () => this.toggleSidebar() });
    r.registerCommand({ id: 'core.toggleTheme', name: 'Hell/Dunkel wechseln', icon: 'moon', shortcut: 'Ctrl+Shift+L', group: 'Ansicht', run: () => this.toggleTheme() });
    r.registerCommand({ id: 'core.focusMode', name: 'Fokus-Modus umschalten', icon: 'zap', shortcut: 'F11', group: 'Ansicht', run: () => this.saveSettings({ focusMode: !this.settings.focusMode }) });
    r.registerCommand({ id: 'core.zoomIn', name: 'Schrift vergrößern', icon: 'plus', shortcut: 'Ctrl+=', group: 'Ansicht', run: () => this.saveSettings({ fontSize: Math.min(24, (this.settings.fontSize || 16) + 1) }) });
    r.registerCommand({ id: 'core.zoomOut', name: 'Schrift verkleinern', icon: 'minus', shortcut: 'Ctrl+-', group: 'Ansicht', run: () => this.saveSettings({ fontSize: Math.max(12, (this.settings.fontSize || 16) - 1) }) });
    r.registerCommand({ id: 'core.save', name: 'Speichern', icon: 'download', shortcut: 'Ctrl+S', group: 'Notizen', run: () => { this.saveNow(); toast('Gespeichert', { type: 'success', duration: 1200 }); } });
    r.registerCommand({ id: 'core.undo', name: 'Rückgängig', icon: 'undo', shortcut: 'Ctrl+Z', group: 'Bearbeiten', when: () => hasNote() && notInField(), run: () => this.editor.undo() });
    r.registerCommand({ id: 'core.redo', name: 'Wiederholen', icon: 'refresh', shortcut: 'Ctrl+Y', group: 'Bearbeiten', when: () => hasNote() && notInField(), run: () => this.editor.redo() });
    r.registerCommand({ id: 'core.redo2', name: 'Wiederholen (alternativ)', icon: 'refresh', shortcut: 'Ctrl+Shift+Z', group: 'Bearbeiten', hidden: true, when: () => hasNote() && notInField(), run: () => this.editor.redo() });
    r.registerCommand({ id: 'core.duplicateBlock', name: 'Block duplizieren', icon: 'copy', shortcut: 'Ctrl+D', group: 'Bearbeiten', when: hasNote, run: () => {
      const id = document.activeElement?.closest?.('.block')?.dataset.id || this.editor.selectedBlockId;
      if (id) this.editor.duplicateBlock(id);
    } });
    r.registerCommand({ id: 'core.deleteBlock', name: 'Block löschen', icon: 'trash', shortcut: 'Ctrl+Shift+K', group: 'Bearbeiten', when: hasNote, run: () => {
      const id = document.activeElement?.closest?.('.block')?.dataset.id || this.editor.selectedBlockId;
      if (id) this.editor.removeBlock(id, { animate: true, focusPrev: true });
    } });
    r.registerCommand({ id: 'core.moveUp', name: 'Block nach oben', icon: 'chevronUp', shortcut: 'Ctrl+Shift+Up', group: 'Bearbeiten', when: hasNote, run: () => this.moveFocusedBlock(-1) });
    r.registerCommand({ id: 'core.moveDown', name: 'Block nach unten', icon: 'chevronDown', shortcut: 'Ctrl+Shift+Down', group: 'Bearbeiten', when: hasNote, run: () => this.moveFocusedBlock(1) });
    r.registerCommand({ id: 'core.floatImage', name: 'Freies Bild hinzufügen', icon: 'move', group: 'Einfügen', when: hasNote, run: async () => {
      const urls = await api.pickImages();
      urls.forEach((src, i) => this.editor.floats.add(src, undefined, this.editorScroll.scrollTop + 80 + i * 40));
    } });
    r.registerCommand({ id: 'core.deleteNote', name: 'Aktuelle Notiz löschen', icon: 'trash', group: 'Notizen', when: hasNote, run: () => this.deleteItem(this.currentPath, this.editor.title) });
    r.registerCommand({ id: 'core.favorite', name: 'Favorit umschalten', icon: 'star', shortcut: 'Ctrl+Alt+F', group: 'Notizen', when: hasNote, run: () => this.toggleFavorite(this.currentPath) });
    r.registerCommand({ id: 'core.reload', name: 'AleNote neu laden', icon: 'refresh', shortcut: 'Ctrl+R', group: 'Allgemein', run: async () => { await this.saveNow(); location.reload(); } });
    r.registerCommand({ id: 'core.vault', name: 'Vault wechseln', icon: 'vault', group: 'Allgemein', run: () => this.chooseVault() });
    for (let i = 1; i <= 3; i++) {
      r.registerCommand({ id: 'core.h' + i, name: `In Überschrift ${i} umwandeln`, icon: 'h' + i, shortcut: `Ctrl+Alt+${i}`, group: 'Formatieren', when: hasNote, run: () => this.convertFocused('h' + i) });
    }
    r.registerCommand({ id: 'core.toText', name: 'In Text umwandeln', icon: 'text', shortcut: 'Ctrl+Alt+0', group: 'Formatieren', when: hasNote, run: () => this.convertFocused('paragraph') });
    r.registerCommand({ id: 'core.toTodo', name: 'In To-do umwandeln', icon: 'checkSquare', shortcut: 'Ctrl+Alt+T', group: 'Formatieren', when: hasNote, run: () => this.convertFocused('todo') });
    r.registerCommand({ id: 'core.toBullet', name: 'In Aufzählung umwandeln', icon: 'list', shortcut: 'Ctrl+Alt+L', group: 'Formatieren', when: hasNote, run: () => this.convertFocused('bullet') });
  }

  convertFocused(type) {
    const id = document.activeElement?.closest?.('.block')?.dataset.id;
    if (id) this.editor.convertBlock(id, type);
  }

  moveFocusedBlock(dir) {
    const id = document.activeElement?.closest?.('.block')?.dataset.id || this.editor.selectedBlockId;
    if (!id) return;
    const i = this.editor.index(id);
    const el = this.editor.mainEditable(id);
    const off = el ? (window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).startOffset : 0) : 0;
    if (dir < 0 && i > 0) this.editor.moveBlock(id, i - 1);
    if (dir > 0 && i < this.editor.note.blocks.length - 1) this.editor.moveBlock(id, i + 2);
    if (el) { el.focus(); void off; }
  }

  registerCoreSlashCommands() {
    this.registry.registerSlashCommand({
      id: 'core.floatImage', name: 'Freies Bild', icon: 'move', group: 'Medien', description: 'Bild frei auf der Seite platzieren', keywords: ['bild', 'frei', 'float', 'sticker', 'image'],
      run: async (editor) => {
        const urls = await api.pickImages();
        urls.forEach((src, i) => editor.floats.add(src, undefined, this.editorScroll.scrollTop + 80 + i * 40));
      }
    });
  }

  // ================= Öffentliche Plugin-API =================

  pluginApi(pluginId) {
    const app = this;
    return {
      id: pluginId,
      app,
      api,
      events: this.events,
      registry: this.registry,
      get settings() { return app.settings; },
      get editor() { return app.editor; },
      get note() { return app.editor?.note; },
      get currentPath() { return app.currentPath; },
      registerBlock: (d) => this.registry.registerBlock(d),
      registerSlashCommand: (d) => this.registry.registerSlashCommand(d),
      registerCommand: (d) => this.registry.registerCommand(d),
      registerTheme: (d) => this.registry.registerTheme(d),
      registerSidebarPanel: (d) => this.registry.registerSidebarPanel({ ...d, id: d.id || pluginId }),
      registerVariable: (d) => this.registry.registerVariable(d),
      addStatusItem: (id, el) => this.addStatusItem(id, el),
      on: (name, fn) => this.events.on(name, fn),
      toast, modal, prompt, confirm: confirmDialog, contextMenu,
      openNote: (p) => this.openNote(p),
      createNote: (folder, name) => this.createNote(folder, name),
      insertText: (t) => this.editor.insertText(t),
      runCommand: (id) => this.runCommand(id),
      /** Plugin-eigene Einstellungen */
      getData: () => (app.settings.pluginData || {})[pluginId] || {},
      setData: (data) => app.saveSettings({ pluginData: { ...(app.settings.pluginData || {}), [pluginId]: data } }),
      ui: { h, icon, editable, htmlToMarkdown }
    };
  }
}

function shiftHue(hex, deg) {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return hex;
  let [r, g, b] = m.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  hh = (hh + deg) % 360;
  return `hsl(${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

const app = new App();
window.AleNote = app; // für Entwickler-Konsole (F12)
app.start().catch((err) => {
  console.error(err);
  document.getElementById('app').innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#f66">AleNote konnte nicht starten:<pre>${err.stack || err}</pre></div>`;
});
