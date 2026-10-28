// AleNote – Electron Hauptprozess
// Verwaltet Fenster, Dateisystem (Vault), Assets, Einstellungen und Plugins.

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, globalShortcut, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const os = require('os');
const { SyncManager } = require('./sync');
const { Updater } = require('./updater');

const NOTE_EXT = '.alenote';
const ASSET_DIR = '_assets';
const CONFIG_DIR = '.alenote';
const TRASH_DIR = '_trash'; // Papierkorb (siehe src/core/trash.js)

protocol.registerSchemesAsPrivileged([
  { scheme: 'alenote', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let win;
let settings = {};
let vault = '';

// ---------- Einstellungen ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function loadSettings() {
  try { settings = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); } catch { settings = {}; }
}
async function saveSettings() {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
}

// ---------- Vault ----------
async function ensureVault() {
  if (!settings.vault) settings.vault = path.join(app.getPath('documents'), 'AleNote');
  // Angemeldete Konten haben einen eigenen lokalen Ordner
  vault = path.resolve(settings.account?.vault || settings.vault);
  await fs.mkdir(path.join(vault, ASSET_DIR), { recursive: true });
  await fs.mkdir(path.join(vault, CONFIG_DIR, 'plugins'), { recursive: true });
  await saveSettings();
}

// Verhindert Zugriffe außerhalb des Vaults
function resolveInVault(rel = '') {
  const p = path.resolve(vault, rel);
  if (p !== vault && !p.startsWith(vault + path.sep)) throw new Error('Pfad außerhalb des Vaults');
  return p;
}
const toRel = (abs) => path.relative(vault, abs).split(path.sep).join('/');

function sanitizeName(name) {
  return (name || 'Unbenannt').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/[. ]+$/, '').trim().slice(0, 120) || 'Unbenannt';
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function uniquePath(dir, base, ext = '') {
  let candidate = path.join(dir, base + ext);
  let i = 2;
  while (await exists(candidate)) candidate = path.join(dir, `${base} ${i++}${ext}`);
  return candidate;
}

async function readTree(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === ASSET_DIR || (dir === vault && (e.name === TRASH_DIR || e.name === '_config'))) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push({ type: 'folder', name: e.name, path: toRel(abs), children: await readTree(abs) });
    } else if (e.name.endsWith(NOTE_EXT)) {
      let icon = '';
      try { icon = JSON.parse(await fs.readFile(abs, 'utf8')).icon || ''; } catch {}
      out.push({ type: 'note', name: e.name.slice(0, -NOTE_EXT.length), path: toRel(abs), icon });
    }
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'de', { numeric: true }) : a.type === 'folder' ? -1 : 1));
  return out;
}

async function allNotes(dir = vault) {
  const tree = await readTree(dir);
  const list = [];
  const walk = (nodes) => nodes.forEach((n) => (n.type === 'note' ? list.push(n) : walk(n.children)));
  walk(tree);
  return list;
}

// ---------- Fenster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 500,
    backgroundColor: '#14141a',
    title: 'AleNote',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c9c9d6', height: 40 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  win.removeMenu();
  // Mit --hidden (Autostart) startet AleNote unsichtbar im Infobereich
  win.once('ready-to-show', () => { if (process.argv.includes('--hidden') && settings.runInTray) setupTray(); else win.show(); });
  win.on('closed', () => { win = null; if (quickWin) quickWin.destroy(); });
  // Im Hintergrund weiterlaufen (Erinnerungen & globale Schnellnotiz), statt zu beenden
  win.on('close', (e) => {
    if (settings.runInTray && !app.isQuitting) { e.preventDefault(); win.hide(); setupTray(); }
  });
  win.loadURL('alenote://app/index.html');

  // Externe Links im Standardbrowser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('alenote://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

// ---------- Infobereich (Tray) & Autostart ----------
let tray = null;
function showMain() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function setupTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('AleNote');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'AleNote öffnen', click: showMain },
    { label: 'Schnellnotiz', click: () => showQuickWindow() },
    { type: 'separator' },
    { label: 'Beenden', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showMain);
}
function applyAutostart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings.autostart, args: ['--hidden'] }); } catch {}
}

// ---------- Schnellnotiz-Fenster (globale Tastenkombination) ----------
let quickWin;
let quickShortcut = '';

/** "Ctrl+Alt+N" → Electron-Accelerator */
function toAccelerator(sc) {
  return String(sc || '').split('+').map((k) => ({ Ctrl: 'CommandOrControl', Meta: 'Super', Esc: 'Escape' }[k] || (/^Num\d$/.test(k) ? 'num' + k.slice(3) : k))).join('+');
}

function createQuickWindow() {
  quickWin = new BrowserWindow({
    width: 580, height: 270, show: false, frame: false, resizable: false, maximizable: false, minimizable: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, backgroundColor: '#1b1b22', title: 'AleNote – Schnellnotiz',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  quickWin.removeMenu();
  quickWin.loadURL('alenote://app/quick.html');
  quickWin.on('blur', () => { if (!quickWin.webContents.isDevToolsOpened()) quickWin.hide(); });
  quickWin.on('closed', () => { quickWin = null; });
}

function showQuickWindow() {
  if (!quickWin) createQuickWindow();
  // Auf dem Bildschirm öffnen, auf dem gerade die Maus ist
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w] = quickWin.getSize();
  quickWin.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + area.height * 0.22));
  const reveal = () => { quickWin.show(); quickWin.focus(); quickWin.webContents.send('quicknote:show'); };
  if (quickWin.webContents.isLoading()) quickWin.webContents.once('did-finish-load', reveal); else reveal();
}

function registerQuickShortcut() {
  const sc = settings.quicknote?.globalShortcut ?? 'Ctrl+Alt+Space';
  if (sc === quickShortcut) return { ok: true };
  if (quickShortcut) globalShortcut.unregister(toAccelerator(quickShortcut));
  quickShortcut = '';
  if (!sc) return { ok: true };
  let ok = false;
  try { ok = globalShortcut.register(toAccelerator(sc), showQuickWindow); } catch {}
  if (ok) quickShortcut = sc;
  return { ok, error: ok ? '' : `„${sc}“ wird bereits von einem anderen Programm verwendet` };
}

function registerQuickIpc() {
  ipcMain.handle('quick:submit', (_e, entry) => { notify('quicknote:add', entry); return true; });
  ipcMain.handle('quick:hide', () => quickWin?.hide());
  ipcMain.handle('quick:resize', (_e, height) => {
    if (!quickWin) return;
    const [w] = quickWin.getSize();
    quickWin.setSize(w, Math.max(200, Math.min(640, Math.round(height))));
  });
  ipcMain.handle('quick:shortcut', () => registerQuickShortcut());
  ipcMain.handle('quick:open', () => showQuickWindow());
}

// ---------- Protokoll alenote:// ----------
function registerProtocol() {
  protocol.handle('alenote', (req) => {
    const url = new URL(req.url);
    let base;
    if (url.host === 'app') base = path.join(__dirname, 'src');
    else if (url.host === 'asset') base = path.join(vault, ASSET_DIR);
    else if (url.host === 'plugins') base = path.join(vault, CONFIG_DIR, 'plugins');
    else return new Response('Not found', { status: 404 });
    const file = path.normalize(path.join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------- IPC ----------
// Nach diesen Aktionen wird automatisch mit dem Server abgeglichen
const MUTATING = new Set(['note:write', 'note:create', 'folder:create', 'item:rename', 'item:move', 'item:delete', 'item:duplicate', 'asset:save', 'asset:pick']);

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    const result = await fn(...args);
    if (MUTATING.has(channel)) sync?.schedule();
    return result;
  });
}

// ---------- Konto & Synchronisierung ----------
let sync;
let updater;
const notify = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

/**
 * Server-Adresse prüfen und vervollständigen:
 * - ohne http(s):// wird zuerst https, dann http probiert
 * - Weiterleitungen (z.B. Reverse-Proxy http → https) werden übernommen
 * - auch Unterpfade wie https://domain.de/alenote funktionieren
 */
async function resolveServer(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('Bitte eine Server-Adresse eingeben');
  const bare = raw.replace(/^https?:\/\//i, '');
  const candidates = /^https:\/\//i.test(raw) ? [raw] : /^http:\/\//i.test(raw) ? [raw, 'https://' + bare] : ['https://' + bare, 'http://' + bare];
  let lastErr = '';
  for (const c of candidates) {
    try {
      const res = await fetch(c + '/api/health', { signal: AbortSignal.timeout(8e3) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { lastErr = res.ok ? 'Unter dieser Adresse läuft kein AleNote-Server' : 'Fehler ' + res.status; continue; }
      const final = new URL(res.url);
      return { server: (final.origin + final.pathname.replace(/\/api\/health$/, '')).replace(/\/+$/, ''), health: data };
    } catch (e) {
      lastErr = /certificate|CERT|SSL/i.test(String(e.cause?.code || e.cause?.message || e.message)) ? 'HTTPS-Zertifikat ungültig' : '';
    }
  }
  throw new Error('Server nicht erreichbar: ' + raw + (lastErr ? ' (' + lastErr + ')' : ''));
}

async function serverCall(server, method, url, body, token) {
  let res;
  try {
    res = await fetch(server + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15e3)
    });
  } catch { throw new Error('Server nicht erreichbar: ' + server); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status);
  return data;
}

const publicAccount = () => (settings.account ? (({ token, ...rest }) => rest)(settings.account) : null);

function registerAccountIpc() {
  sync = new SyncManager({
    getAccount: () => settings.account,
    getVault: () => vault,
    notify,
    onAuthLost: (msg) => notify('account:authLost', msg)
  });

  ipcMain.handle('account:get', () => ({ account: publicAccount(), vault, status: sync.status }));
  ipcMain.handle('account:probe', async (_e, server) => { const r = await resolveServer(server); return { ...r.health, resolved: r.server }; });
  // Neue Adresse für denselben Server (z.B. jetzt über HTTPS/Reverse-Proxy): Anmeldung und Notizen bleiben
  ipcMain.handle('account:changeServer', async (_e, input) => {
    const acc = settings.account;
    if (!acc) throw new Error('Nicht angemeldet');
    const { server } = await resolveServer(input);
    const me = await serverCall(server, 'GET', '/api/me', null, acc.token).catch(() => { throw new Error('Unter dieser Adresse ist deine Anmeldung nicht gültig – ist es wirklich derselbe AleNote-Server?'); });
    if (me.user?.id !== acc.userId) throw new Error('Das ist ein anderer AleNote-Server (anderes Konto)');
    sync.stop();
    acc.server = server;
    await saveSettings();
    sync.start();
    return publicAccount();
  });

  ipcMain.handle('account:login', async (_e, { server, username, password, register, displayName }) => {
    server = (await resolveServer(server)).server;
    const device = `AleNote Desktop (${os.hostname()})`;
    const r = await serverCall(server, 'POST', register ? '/api/register' : '/api/login', { username, password, displayName, device });
    const host = new URL(server).host.replace(/[^\w.-]/g, '_');
    sync.stop();
    settings.account = {
      server, token: r.token, userId: r.user.id, username: r.user.username, displayName: r.user.displayName, role: r.user.role,
      serverName: r.server?.name || host,
      vault: path.join(app.getPath('documents'), 'AleNote Konten', `${r.user.username}@${host}`)
    };
    await ensureVault();
    return publicAccount();
  });

  ipcMain.handle('account:logout', async () => {
    const acc = settings.account;
    sync.stop();
    if (acc) await serverCall(acc.server, 'POST', '/api/logout', null, acc.token).catch(() => {});
    settings.account = null;
    await ensureVault();
    return true;
  });

  ipcMain.handle('account:me', async () => {
    const acc = settings.account;
    if (!acc) return null;
    const [me, health] = await Promise.all([
      serverCall(acc.server, 'GET', '/api/me', null, acc.token),
      serverCall(acc.server, 'GET', '/api/health').catch(() => ({}))
    ]);
    Object.assign(acc, { displayName: me.user.displayName, role: me.user.role, serverName: me.server?.name || acc.serverName });
    await saveSettings();
    return { ...me, motd: health.motd || '' };
  });

  ipcMain.handle('account:password', async (_e, oldPassword, newPassword) => {
    const acc = settings.account;
    return serverCall(acc.server, 'POST', '/api/me/password', { oldPassword, newPassword }, acc.token);
  });

  updater = new Updater({ getAccount: () => settings.account, getSettings: () => settings, notify });
  updater.init();
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:get', () => updater.status);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => updater.install());

  // Versionsverlauf (liegt auf dem Server)
  const needAccount = () => { if (!settings.account) throw new Error('Der Versionsverlauf benötigt die Anmeldung an deinem AleNote-Server'); return settings.account; };
  ipcMain.handle('history:list', (_e, p) => { const acc = needAccount(); return serverCall(acc.server, 'GET', '/api/sync/versions?path=' + encodeURIComponent(p), null, acc.token); });
  ipcMain.handle('history:get', (_e, p, id) => { const acc = needAccount(); return serverCall(acc.server, 'GET', `/api/sync/version?path=${encodeURIComponent(p)}&id=${encodeURIComponent(id)}`, null, acc.token); });

  ipcMain.handle('sync:now', () => { sync.run(); return sync.status; });
  ipcMain.handle('sync:start', () => sync.start());
  ipcMain.handle('sync:resolve', (_e, p, choice) => sync.resolve(p, choice));
  ipcMain.handle('sync:mark', (_e, p, rev, hash) => sync.mark(p, rev, hash));
  // Live-Bearbeitung: die Oberfläche verbindet sich selbst mit dem Server
  ipcMain.handle('account:live', () => (settings.account ? { server: settings.account.server, token: settings.account.token, userId: settings.account.userId } : null));
}

function registerIpc() {
  handle('settings:get', () => settings);
  handle('settings:set', async (patch) => {
    Object.assign(settings, patch);
    await saveSettings();
    if ('quicknote' in patch) registerQuickShortcut();
    if ('autostart' in patch) applyAutostart();
    if ('runInTray' in patch) { if (patch.runInTray) setupTray(); else if (tray) { tray.destroy(); tray = null; } }
    return settings;
  });

  handle('vault:get', () => vault);
  handle('vault:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Vault-Ordner wählen', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.vault = r.filePaths[0];
    await ensureVault();
    return vault;
  });
  handle('vault:reveal', (rel) => shell.showItemInFolder(resolveInVault(rel || '')));
  handle('vault:openFolder', (rel) => shell.openPath(resolveInVault(rel || '')));

  handle('tree', async (opts) => {
    if (!opts?.trash) return readTree(vault);
    const dir = path.join(vault, TRASH_DIR);
    return (await exists(dir)) ? readTree(dir) : [];
  });
  handle('folder:ensure', async (rel) => { await fs.mkdir(resolveInVault(rel || ''), { recursive: true }); return rel; });

  handle('note:read', async (rel) => JSON.parse(await fs.readFile(resolveInVault(rel), 'utf8')));
  handle('note:write', async (rel, data) => {
    const p = resolveInVault(rel);
    const tmp = p + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, p);
    return true;
  });
  handle('note:create', async (folderRel, name, data) => {
    const dir = resolveInVault(folderRel || '');
    await fs.mkdir(dir, { recursive: true });
    const p = await uniquePath(dir, sanitizeName(name), NOTE_EXT);
    await fs.writeFile(p, JSON.stringify(data || {}, null, 2), 'utf8');
    return toRel(p);
  });
  handle('folder:create', async (parentRel, name) => {
    const p = await uniquePath(resolveInVault(parentRel || ''), sanitizeName(name));
    await fs.mkdir(p, { recursive: true });
    return toRel(p);
  });
  handle('item:rename', async (rel, newName) => {
    const p = resolveInVault(rel);
    const isNote = rel.endsWith(NOTE_EXT);
    const base = sanitizeName(newName);
    const target = path.join(path.dirname(p), base + (isNote ? NOTE_EXT : ''));
    if (target === p) return rel;
    if (target.toLowerCase() === p.toLowerCase()) { await fs.rename(p, target); return toRel(target); }
    const finalPath = await uniquePath(path.dirname(p), base, isNote ? NOTE_EXT : '');
    await fs.rename(p, finalPath);
    return toRel(finalPath);
  });
  handle('item:move', async (rel, targetFolderRel) => {
    const p = resolveInVault(rel);
    const targetDir = resolveInVault(targetFolderRel || '');
    if (targetDir === p || targetDir.startsWith(p + path.sep)) throw new Error('Ordner kann nicht in sich selbst verschoben werden');
    if (path.dirname(p) === targetDir) return rel;
    const ext = path.extname(p) === NOTE_EXT ? NOTE_EXT : '';
    const finalPath = await uniquePath(targetDir, path.basename(p, ext), ext);
    await fs.rename(p, finalPath);
    return toRel(finalPath);
  });
  handle('item:delete', async (rel) => {
    const p = resolveInVault(rel);
    try { await shell.trashItem(p); } catch { await fs.rm(p, { recursive: true, force: true }); }
    return true;
  });
  handle('item:duplicate', async (rel) => {
    const p = resolveInVault(rel);
    const target = await uniquePath(path.dirname(p), path.basename(p, NOTE_EXT) + ' Kopie', NOTE_EXT);
    await fs.copyFile(p, target);
    return toRel(target);
  });

  handle('search', async (query) => {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    const results = [];
    for (const n of await allNotes()) {
      try {
        const raw = await fs.readFile(resolveInVault(n.path), 'utf8');
        const data = JSON.parse(raw);
        const text = (data.blocks || []).map((b) => JSON.stringify(b.data || {})).join(' ')
          .replace(/<[^>]+>/g, ' ').replace(/\\[nrt]/g, ' ').replace(/[{}"\[\]]/g, ' ');
        const idx = text.toLowerCase().indexOf(q);
        if (idx >= 0 || n.name.toLowerCase().includes(q)) {
          const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ').trim() : '';
          results.push({ ...n, snippet });
        }
      } catch {}
      if (results.length >= 50) break;
    }
    return results;
  });

  handle('asset:save', async (name, bytes) => {
    const ext = (path.extname(name || '') || '.png').toLowerCase();
    const base = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const file = path.join(vault, ASSET_DIR, base + ext);
    await fs.writeFile(file, Buffer.from(bytes));
    return `alenote://asset/${encodeURIComponent(base + ext)}`;
  });
  handle('asset:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Bild auswählen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }]
    });
    if (r.canceled) return [];
    const urls = [];
    for (const f of r.filePaths) {
      const ext = path.extname(f).toLowerCase();
      const base = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      await fs.copyFile(f, path.join(vault, ASSET_DIR, base + ext));
      urls.push(`alenote://asset/${encodeURIComponent(base + ext)}`);
    }
    return urls;
  });

  handle('plugins:list', async () => {
    const dir = path.join(vault, CONFIG_DIR, 'plugins');
    const out = [];
    try {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory() && (await exists(path.join(dir, e.name, 'plugin.js')))) {
          out.push({ id: e.name, url: `alenote://plugins/${encodeURIComponent(e.name)}/plugin.js` });
        } else if (e.isFile() && e.name.endsWith('.js')) {
          out.push({ id: e.name.slice(0, -3), url: `alenote://plugins/${encodeURIComponent(e.name)}` });
        }
      }
    } catch {}
    return out;
  });
  handle('plugins:openFolder', () => shell.openPath(path.join(vault, CONFIG_DIR, 'plugins')));

  handle('file:saveText', async (defaultName, content, filters) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: filters || [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, content, 'utf8');
    return r.filePath;
  });

  // Binärdatei speichern (z.B. Word-Export)
  handle('file:save', async (defaultName, bytes, filters) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters: filters || [] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, Buffer.from(bytes));
    return r.filePath;
  });
  // Aktuelle Seite als PDF (nutzt die Druck-Ansicht aus app.css)
  handle('export:pdf', async (defaultName) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    // Seitenränder zeigen sonst die (dunkle) Fensterfarbe
    win.setBackgroundColor('#ffffff');
    let pdf;
    try { pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } }); }
    finally { win.setBackgroundColor('#14141a'); }
    await fs.writeFile(r.filePath, pdf);
    shell.openPath(r.filePath);
    return r.filePath;
  });

  handle('window:titlebar', (color, symbolColor) => {
    try { win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch {}
  });
  handle('open:external', (url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  handle('window:focus', () => showMain());

  // Kalender-Abo (iCal) laden – im Hauptprozess, damit Browser-Sicherheitsregeln (CORS) nicht stören
  handle('ical:fetch', async (url) => {
    const u = String(url || '').trim().replace(/^webcal:/i, 'https:');
    if (!/^https?:\/\//i.test(u)) throw new Error('Bitte eine http(s)- oder webcal-Adresse angeben');
    const res = await fetch(u, { signal: AbortSignal.timeout(20e3), headers: { 'User-Agent': 'AleNote' } });
    if (!res.ok) throw new Error('Kalender antwortet mit ' + res.status);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Unter dieser Adresse liegt kein iCal-Kalender');
    return text.slice(0, 15e6);
  });
}

// ---------- Start ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => showMain());
  app.on('before-quit', () => { app.isQuitting = true; });
  // Windows-Benachrichtigungen brauchen eine App-ID
  if (process.platform === 'win32') app.setAppUserModelId('com.alenote.app');
  app.whenReady().then(async () => {
    await loadSettings();
    await ensureVault();
    registerProtocol();
    registerIpc();
    registerAccountIpc();
    registerQuickIpc();
    createWindow();
    registerQuickShortcut();
    if (settings.runInTray) setupTray();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
