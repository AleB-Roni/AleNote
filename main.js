// AleNote – Electron Hauptprozess
// Verwaltet Fenster, Dateisystem (Vault), Assets, Einstellungen und Plugins.

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');

const NOTE_EXT = '.alenote';
const ASSET_DIR = '_assets';
const CONFIG_DIR = '.alenote';

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
  vault = path.resolve(settings.vault);
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
    if (e.name.startsWith('.') || e.name === ASSET_DIR) continue;
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
  win.once('ready-to-show', () => win.show());
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
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('settings:get', () => settings);
  handle('settings:set', async (patch) => { Object.assign(settings, patch); await saveSettings(); return settings; });

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

  handle('tree', () => readTree(vault));

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

  handle('window:titlebar', (color, symbolColor) => {
    try { win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch {}
  });
  handle('open:external', (url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
}

// ---------- Start ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    await loadSettings();
    await ensureVault();
    registerProtocol();
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
