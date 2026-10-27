// AleNote – Start der Oberfläche
import { api, resolveSrc } from './core/api.js';
import { EventBus } from './core/events.js';
import { Registry } from './core/registry.js';
import { PluginManager } from './core/plugins.js';
import { HotkeyManager, DEFAULT_HOTKEYS, registerDefaultVariables } from './core/hotkeys.js';
import { h, debounce, copyText } from './core/utils.js';
import { registerBuiltinBlocks } from './blocks/index.js';
import { editable, htmlToMarkdown } from './blocks/text.js';
import { registerBuiltinThemes, shiftHue } from './themes.js';
import { Editor } from './ui/editor.js';
import { Sidebar } from './ui/sidebar.js';
import { CommandPalette } from './ui/palette.js';
import { openSettings, FONTS, ACCENTS } from './ui/settings.js';
import { icon } from './ui/icons.js';
import { toast, modal, prompt, confirmDialog, contextMenu } from './ui/overlays.js';
import { welcomeNote } from './welcome.js';
import { AccountUI } from './ui/account.js';
import { UpdateUI } from './ui/updates.js';
import { DrawToolbar } from './ui/drawing.js';
import { AIManager } from './ai/ai.js';
import { CalendarView } from './ui/calendar.js';
import { openQuickNote } from './ui/quicknote.js';
import { datePicker } from './ui/datepicker.js';
import { addQuickNote, dueLabel } from './core/todos.js';
import { moveToTrash, listTrash, restoreFromTrash, purgeExpired } from './core/trash.js';
import { openTrash } from './ui/trash.js';
import { initSubpages } from './ui/subpages.js';
import { childFolder, parentOf, isNotePath, remap as remapPath, remapPageLinks } from './core/pages.js';
import { openTemplatePicker, saveCurrentAsTemplate } from './ui/templates.js';
import { openHistory } from './ui/history.js';
import { exportPdf, exportDocx, openImport } from './ui/export.js';
import { ReminderService } from './core/reminders.js';
import { initMobile, isNarrow } from './core/mobile.js';

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
    initMobile(this);
    this.applySettings();

    this.hotkeys = new HotkeyManager(this);
    this.sidebar = new Sidebar(this, this.sidebarEl);
    this.editor = new Editor(this, this.editorScroll);
    this.palette = new CommandPalette(this);
    this.scheduleSave = debounce(() => this.saveNow(), this.settings.saveDelay || 600);

    // Zusatzfunktionen: Fällt eine davon aus, startet AleNote trotzdem (Fehler wird angezeigt)
    this.startErrors = [];
    const safe = async (name, fn) => {
      try { await fn(); }
      catch (err) { console.error(err); this.startErrors.push(`${name}: ${err?.message || err}`); }
    };
    this.plugins = new PluginManager(this);
    await safe('Plugins', () => this.plugins.loadAll());
    this.hotkeys.syncCustomHotkeys();
    await safe('KI', () => { this.ai = new AIManager(this); this.ai.registerAll(); });

    await safe('Konto', async () => { this.account = new AccountUI(this); await this.account.init(); });
    await safe('Updates', () => { this.updates = new UpdateUI(this); this.updates.init(); });

    let tree = [];
    await safe('Notizen laden', async () => { tree = await this.sidebar.refresh(); });
    this.reminders = new ReminderService(this);
    initSubpages(this);
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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawMode && !document.querySelector('.modal-backdrop, .palette-backdrop, .menu')) this.toggleDrawMode(false);
    });
    this.events.on('note:open', () => { if (this.drawMode) this.editor.drawing?.setActive(true); });
    window.addEventListener('beforeunload', () => { if (this.dirty) this.saveNow(); });
    window.addEventListener('focus', () => this.sidebar.refresh());
    // Schnellnotiz aus dem eigenen Fenster (globale Tastenkombination, nur Desktop)
    api.on('quicknote:add', async (entry) => {
      try {
        const path = await addQuickNote(this, entry);
        toast(`Schnellnotiz gespeichert in „${path.replace(/\.alenote$/, '').split('/').pop()}“${entry.due ? ' · fällig ' + dueLabel(entry.due, entry.dueTime) : ''}`, { type: 'success' });
      } catch (err) { toast('Schnellnotiz: ' + err.message, { type: 'error' }); }
    });
    this.events.on('todos:change', () => this.sidebar.updateBadge());
    this.events.on('note:save', (data) => { if ((data.blocks || []).some((b) => b.type === 'todo' && b.data?.due)) this.sidebar.updateBadge(); });
    document.body.classList.add('ready');
    safe('Erinnerungen', () => this.reminders.start());
    // Papierkorb: Einträge älter als 30 Tage entfernen
    setTimeout(() => purgeExpired(api).then((n) => { if (n) this.sidebar.updateTrashBadge?.(); }).catch((err) => console.error(err)), 4000);
    if (this.startErrors.length) toast('Beim Start ist ein Fehler aufgetreten – ' + this.startErrors.join(' · '), { type: 'error', duration: 12000 });
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
      h('button.icon-btn.ai-btn', { title: 'KI-Chat (Strg+Shift+J) · KI-Befehl: Strg+J', onclick: () => this.ai.chat.toggle() }, icon('sparkles', 17)),
      h('button.icon-btn.draw-btn', { title: 'Zeichnen (Strg+Alt+P)', onclick: () => this.toggleDrawMode() }, icon('pen', 17)),
      h('button.icon-btn.undo-btn', { title: 'Rückgängig (Strg+Z)', disabled: true, onmousedown: (e) => e.preventDefault(), onclick: () => this.editor.undo() }, icon('undo', 17)),
      h('button.icon-btn.redo-btn', { title: 'Wiederholen (Strg+Y)', disabled: true, onmousedown: (e) => e.preventDefault(), onclick: () => this.editor.redo() }, icon('redo', 17)),
      h('button.icon-btn.fav-btn', { title: 'Favorit', onclick: () => this.currentPath && this.toggleFavorite(this.currentPath) }, icon('star', 17)),
      h('button.icon-btn', { title: 'Mehr', onclick: (e) => this.noteMenu(e.currentTarget) }, icon('more', 17)),
      h('div.titlebar-spacer'));
    this.events.on('history:change', ({ canUndo, canRedo }) => {
      topbar.querySelector('.undo-btn').disabled = !canUndo;
      topbar.querySelector('.redo-btn').disabled = !canRedo;
    });
    this.editorScroll = h('div.editor-scroll');
    this.mainEl = h('main.main', {}, topbar, this.editorScroll);
    root.append(this.sidebarEl, this.mainEl);
  }

  showEmpty() {
    this.closeCalendar();
    this.editor?.clearMulti();
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
        h('button.btn', { onclick: () => openTemplatePicker(this, { mode: 'new' }) }, icon('layers', 16), 'Aus Vorlage'),
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

  toggleSidebar() {
    // Auf dem Handy ist die Seitenleiste eine ausklappbare Schublade
    if (isNarrow()) { this.setDrawer?.(!document.body.classList.contains('sidebar-open')); return; }
    this.saveSettings({ sidebarHidden: !this.settings.sidebarHidden });
  }

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
    this.closeCalendar();
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

  // ---------- Kalender & Schnellnotiz ----------
  async openCalendar() {
    if (this.calendar?.isOpen()) return;
    await this.saveNow();
    if (this.drawMode) this.toggleDrawMode(false);
    this.editor.clearMulti();
    this.currentPath = null;
    this.editor.note = null;
    this.mainEl.classList.remove('has-note');
    this.mainEl.classList.add('calendar-mode');
    this.breadcrumbEl.replaceChildren(h('span.crumb.current', {}, '📅 Kalender'));
    this.statusEl.textContent = '';
    this.sidebar.setActive(null);
    this.sidebar.el.querySelector('.nav-calendar')?.classList.add('active');
    document.title = 'Kalender – AleNote';
    this.editorScroll.classList.remove('page-enter');
    void this.editorScroll.offsetWidth;
    this.editorScroll.classList.add('page-enter');
    this.calendar = new CalendarView(this);
    await this.calendar.mount(this.editorScroll);
    this.setDrawer?.(false);
  }

  closeCalendar() {
    if (!this.calendar) return;
    this.calendar.destroy();
    this.calendar = null;
    this.mainEl.classList.remove('calendar-mode');
    this.sidebar.el.querySelector('.nav-calendar')?.classList.remove('active');
  }

  quickNote(preset) {
    this.setDrawer?.(false);
    return openQuickNote(this, preset);
  }

  /** Fälligkeitsdatum für den aktuellen Block (wird bei Bedarf zum To-do) */
  setDueForFocused(anchor) {
    const id = document.activeElement?.closest?.('.block')?.dataset.id || this.editor.selectedBlockId;
    let b = id && this.editor.block(id);
    if (!b) return;
    if (b.type !== 'todo') { if (!this.editor.def(b.type)?.text) return; this.editor.convertBlock(id, 'todo'); b = this.editor.block(id); }
    const chip = this.editor.rowEl(id)?.querySelector('.todo-due');
    if (chip) chip.click();
    else datePicker(anchor || this.editor.rowEl(id), { due: b.data.due, time: b.data.dueTime, onPick: (d, t) => { Object.assign(b.data, { due: d, dueTime: t }); this.editor.rerenderBlock(id); this.editor.changed(true); } });
  }

  updateChrome() {
    const path = this.currentPath;
    this.breadcrumbEl.innerHTML = '';
    if (!path) return;
    const parts = path.split('/');
    const notes = this.sidebar.allNotes();
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const label = last ? p.replace(/\.alenote$/, '') : p;
      if (i) this.breadcrumbEl.append(h('span.crumb-sep', { text: '/' }));
      // Gehört der Ordner zu einer Seite, führt die Krume zu dieser Elternseite
      const page = !last && notes.find((n) => n.path === parts.slice(0, i + 1).join('/') + '.alenote');
      if (page) this.breadcrumbEl.append(h('button.crumb.crumb-page', { title: 'Zu „' + page.name + '“', onclick: () => this.openNote(page.path) }, page.icon ? page.icon + ' ' : '', page.name));
      else this.breadcrumbEl.append(h('span.crumb' + (last ? '.current' : ''), {}, last && this.editor.note?.icon ? this.editor.note.icon + ' ' : '', label));
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
    const map = (p) => remapPath(p, from, to);
    const favorites = (this.settings.favorites || []).map(map);
    const recent = (this.settings.recent || []).map(map);
    const expanded = [...this.sidebar.expanded].map(map);
    this.sidebar.expanded = new Set(expanded);
    this.editor.remapHistory?.(from, to);
    if (this.currentPath) this.currentPath = map(this.currentPath);
    if (this.editor.path) this.editor.path = this.currentPath;
    this.saveSettings({ favorites, recent, expanded, lastOpen: this.currentPath });
  }

  /** Ordner mit den Unterseiten einer Seite (oder null) */
  subFolderOf(path) {
    return isNotePath(path) ? this.sidebar.allNotes().find((n) => n.path === path)?.sub || null : null;
  }

  /** Unterseiten-Ordner an den (evtl. umbenannten/verschobenen) Seitenpfad anpassen */
  async followSubFolder(sub, np) {
    const want = childFolder(np);
    if (parentOf(sub) !== parentOf(want)) sub = await api.move(sub, parentOf(want));
    if (sub !== want) sub = await api.rename(sub, want.split('/').pop());
    return sub;
  }

  async renameItem(path, newName) {
    await this.saveNow();
    try {
      const sub = this.subFolderOf(path);
      const np = await api.rename(path, newName);
      if (np !== path && sub) await this.followSubFolder(sub, np);
      if (np !== path) { this.remapPaths(path, np); await remapPageLinks(this, path, np); }
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
      const sub = this.subFolderOf(path);
      const own = isNotePath(path) ? childFolder(path) : path;
      if (folder === own || (folder || '').startsWith(own + '/')) throw new Error('Eine Seite kann nicht in ihre eigenen Unterseiten verschoben werden');
      if (folder) await api.ensureFolder(folder);
      const np = await api.move(path, folder);
      if (np !== path && sub) await this.followSubFolder(sub, np);
      if (np !== path) { this.remapPaths(path, np); await remapPageLinks(this, path, np); toast('Verschoben', { type: 'success' }); }
      await this.sidebar.refresh();
      this.updateChrome();
      this.sidebar.setActive(this.currentPath);
    } catch (err) { toast(err.message, { type: 'error' }); }
  }

  /** Neue Unterseite in einer Seite anlegen (und öffnen) */
  async createSubpage(parent, name = 'Unbenannt', { open = true } = {}) {
    await this.saveNow();
    this.sidebar.expanded.add(parent);
    this.sidebar.saveExpanded();
    if (open) return this.createNote(childFolder(parent), name);
    const p = await api.createNote(childFolder(parent), name, { version: 1, created: Date.now(), updated: Date.now(), icon: '', blocks: [], floats: [] });
    await this.sidebar.refresh();
    return p;
  }

  async duplicateNote(path) {
    await this.saveNow();
    const np = await api.duplicate(path);
    await this.sidebar.refresh();
    this.openNote(np);
  }

  async deleteItem(path, name, isFolder = false) {
    const sub = this.subFolderOf(path);
    if (!(await this.sidebar.confirmDelete(name, isFolder, !!this.sidebar.allNotes().find((n) => n.path === path)?.children?.length))) return;
    const affectsCurrent = this.currentPath && (this.currentPath === path || this.currentPath.startsWith(path + '/') || (sub && this.currentPath.startsWith(sub + '/')));
    await this.saveNow(); // letzte Änderungen mit in den Papierkorb nehmen
    if (affectsCurrent) { this.scheduleSave.cancel(); this.editor.note = null; }
    let trashed;
    try { trashed = await moveToTrash(api, path, sub ? [sub] : []); }
    catch (err) { toast('Löschen fehlgeschlagen: ' + err.message, { type: 'error' }); if (affectsCurrent) this.showEmpty(); return; }
    this.saveSettings({ favorites: (this.settings.favorites || []).filter((p) => p !== path && !p.startsWith(path + '/') && !(sub && p.startsWith(sub + '/'))) });
    await this.sidebar.refresh();
    if (affectsCurrent) this.showEmpty();
    toast(`„${name}“ ist im Papierkorb`, {
      type: 'success', duration: 6000,
      action: { label: 'Rückgängig', run: async () => {
        const item = (await listTrash(api)).find((x) => x.path === trashed);
        if (!item) return;
        const p = await restoreFromTrash(api, item);
        await this.sidebar.refresh();
        if (!isFolder) this.openNote(p);
      } }
    });
  }

  openTrash() { openTrash(this); }

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
    const bd = h('div.lightbox', { onclick: () => { bd.classList.add('leaving'); setTimeout(() => bd.remove(), 200); } }, h('img', { src: resolveSrc(src) }));
    document.body.append(bd);
  }

  toast(msg, opts) { toast(msg, opts); }

  // ---------- Zeichen-Modus ----------
  toggleDrawMode(on = !this.drawMode) {
    if (on && !this.editor.note) { toast('Öffne zuerst eine Notiz'); return; }
    this.drawMode = on;
    document.activeElement?.blur?.();
    this.editor.drawing?.setActive(on);
    this.drawToolbar ||= new DrawToolbar(this);
    this.drawToolbar.show(on);
    this.mainEl.querySelector('.draw-btn')?.classList.toggle('active-tool', on);
    document.body.classList.toggle('draw-mode', on);
  }

  async confirmClearDrawing() {
    if (!this.editor.note?.drawing?.strokes?.length) return;
    if (await confirmDialog('Zeichnungen löschen?', 'Alle Striche dieser Notiz werden entfernt. Mit Strg+Z lässt sich das rückgängig machen.')) this.editor.drawing.clear();
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
    const inTable = () => !!document.activeElement?.closest?.('.table-block');
    // Eingabefelder und der Titel behalten ihr eigenes Strg+Z
    const notInField = () => { const el = document.activeElement; return !(el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.classList?.contains('note-title'))); };
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
    r.registerCommand({ id: 'core.duplicateBlock', name: 'Block duplizieren', icon: 'copy', shortcut: 'Ctrl+D', group: 'Bearbeiten', when: () => hasNote() && !inTable(), run: () => {
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
    r.registerCommand({ id: 'core.draw', name: 'Zeichnen ein/aus', icon: 'pen', shortcut: 'Ctrl+Alt+P', group: 'Einfügen', when: hasNote, run: () => this.toggleDrawMode() });
    r.registerCommand({ id: 'core.drawMarker', name: 'Textmarker', icon: 'highlighter', shortcut: 'Ctrl+Alt+M', group: 'Einfügen', when: hasNote, run: () => { this.saveSettings({ drawTool: 'marker' }); this.toggleDrawMode(true); this.drawToolbar.render(); } });
    r.registerCommand({ id: 'core.deleteNote', name: 'Aktuelle Notiz löschen', icon: 'trash', group: 'Notizen', when: hasNote, run: () => this.deleteItem(this.currentPath, this.editor.title) });
    r.registerCommand({ id: 'core.favorite', name: 'Favorit umschalten', icon: 'star', shortcut: 'Ctrl+Alt+F', group: 'Notizen', when: hasNote, run: () => this.toggleFavorite(this.currentPath) });
    r.registerCommand({ id: 'core.reload', name: 'AleNote neu laden', icon: 'refresh', shortcut: 'Ctrl+R', group: 'Allgemein', when: () => !inTable(), run: async () => { await this.saveNow(); location.reload(); } });
    r.registerCommand({ id: 'core.quickNote', name: 'Schnellnotiz', icon: 'zap', shortcut: 'Ctrl+Shift+Space', group: 'Notizen', run: () => this.quickNote() });
    r.registerCommand({ id: 'core.newSubpage', name: 'Neue Unterseite', icon: 'files', shortcut: 'Ctrl+Alt+U', group: 'Notizen', when: () => !!this.currentPath, run: () => this.createSubpage(this.currentPath) });
    r.registerCommand({ id: 'core.calendar', name: 'Kalender öffnen', icon: 'calendar', shortcut: 'Ctrl+Alt+K', group: 'Navigation', run: () => this.openCalendar() });
    r.registerCommand({ id: 'core.todoDue', name: 'Fälligkeitsdatum festlegen', icon: 'calendar', shortcut: 'Ctrl+Shift+T', group: 'Bearbeiten', when: hasNote, run: () => this.setDueForFocused() });
    r.registerCommand({ id: 'core.exportPdf', name: 'Als PDF exportieren', icon: 'download', group: 'Export', when: hasNote, noteMenu: true, run: () => exportPdf(this) });
    r.registerCommand({ id: 'core.exportDocx', name: 'Als Word-Datei exportieren', icon: 'download', group: 'Export', when: hasNote, noteMenu: true, run: () => exportDocx(this) });
    r.registerCommand({ id: 'core.import', name: 'Importieren (Markdown, Obsidian, Notion)', icon: 'upload', group: 'Notizen', run: () => openImport(this, this.sidebar.contextFolder()) });
    r.registerCommand({ id: 'core.history', name: 'Versionsverlauf', icon: 'clock', shortcut: 'Ctrl+Alt+H', group: 'Notizen', when: hasNote, noteMenu: true, run: () => openHistory(this) });
    r.registerCommand({ id: 'core.newFromTemplate', name: 'Neue Notiz aus Vorlage', icon: 'layers', shortcut: 'Ctrl+Alt+V', group: 'Notizen', run: () => openTemplatePicker(this, { mode: 'new' }) });
    r.registerCommand({ id: 'core.insertTemplate', name: 'Vorlage einfügen', icon: 'layers', group: 'Einfügen', when: hasNote, run: () => openTemplatePicker(this, { mode: 'insert' }) });
    r.registerCommand({ id: 'core.saveAsTemplate', name: 'Als Vorlage speichern', icon: 'layers', group: 'Notizen', when: hasNote, noteMenu: true, run: () => saveCurrentAsTemplate(this) });
    r.registerCommand({ id: 'core.trash', name: 'Papierkorb öffnen', icon: 'trash', group: 'Notizen', run: () => this.openTrash() });
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
      id: 'core.subpage', name: 'Unterseite', icon: 'files', group: 'Einfügen', description: 'Neue Seite innerhalb dieser Seite (wie ein Unterordner)', keywords: ['seite', 'unterseite', 'page', 'subpage', 'doku', 'ordner', 'kapitel'],
      run: async (editor, { blockId }) => {
        const parent = this.currentPath;
        if (!parent) return;
        const p = await this.createSubpage(parent, 'Unbenannt', { open: false });
        if (blockId && editor.block(blockId)) editor.convertBlock(blockId, 'page', { path: p });
        else editor.insertBlock('page', { path: p });
        await this.saveNow();
        await this.openNote(p);
        setTimeout(() => { this.editor.titleEl?.focus(); document.execCommand('selectAll'); }, 60);
      }
    });
    this.registry.registerSlashCommand({
      id: 'core.template', name: 'Vorlage einfügen', icon: 'layers', group: 'Einfügen', description: 'Inhalt einer Vorlage hier einfügen', keywords: ['vorlage', 'template', 'muster'],
      run: (editor, { blockId }) => openTemplatePicker(this, { mode: 'insert', afterId: blockId })
    });
    this.registry.registerSlashCommand({
      id: 'core.todoDue', name: 'To-do mit Datum', icon: 'calendar', group: 'Listen', description: 'Aufgabe mit Fälligkeitsdatum (erscheint im Kalender)', keywords: ['datum', 'fällig', 'termin', 'deadline', 'kalender', 'todo', 'aufgabe', 'due'],
      run: (editor, { blockId }) => { editor.focusBlock(blockId, 'end'); setTimeout(() => this.setDueForFocused(), 30); }
    });
    this.registry.registerSlashCommand({
      id: 'core.quickNote', name: 'Schnellnotiz', icon: 'zap', group: 'Einfügen', description: 'Notiz mit Zeitstempel in deine Quicknotizen', keywords: ['schnell', 'quick', 'notiz', 'inbox'],
      run: () => this.quickNote()
    });
    this.registry.registerSlashCommand({
      id: 'core.draw', name: 'Zeichnen', icon: 'pen', group: 'Medien', description: 'Frei auf der Notiz zeichnen & markieren', keywords: ['zeichnen', 'malen', 'stift', 'marker', 'draw', 'markieren'],
      run: () => this.toggleDrawMode(true)
    });
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
      ui: { h, icon, editable, htmlToMarkdown, copyText }
    };
  }
}

const app = new App();
window.AleNote = app; // für Entwickler-Konsole (F12)
app.start().catch((err) => {
  console.error(err);
  document.body.classList.add('boot-failed');
  document.getElementById('app').innerHTML = `<div class="boot-error"><h2>AleNote konnte nicht starten</h2><p>Bitte mach ein Foto von dieser Meldung.</p><pre></pre><button class="btn btn-primary">Neu laden</button></div>`;
  document.querySelector('.boot-error pre').textContent = String(err?.stack || err);
  document.querySelector('.boot-error button').addEventListener('click', () => location.reload());
});
