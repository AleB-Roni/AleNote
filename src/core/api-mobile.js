// AleNote auf dem Handy (Android/Capacitor) und als Web-Version im Browser
// Bietet dieselbe Schnittstelle wie die Desktop-Brücke (preload.js), damit die gesamte
// Oberfläche unverändert läuft: Notizen, Ordner, Bilder, Konto, Synchronisierung, Updates.

import { CapacitorFs, MemoryFs, IdbFs, norm, parentOf } from './mobile/fs.js';
import { MobileSync } from './mobile/sync-core.js';

const NOTE_EXT = '.alenote';
const ROOT = 'alenote';
const GITHUB_REPO = 'AleB-Roni/AleNote';

const sanitizeName = (name) => (name || 'Unbenannt').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/[. ]+$/, '').trim().slice(0, 120) || 'Unbenannt';
const join = (a, b) => (a ? `${a}/${b}` : b);

function versionNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}

function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Dateisystem mit festem Unterordner (z.B. dem Vault) */
class PrefixFs {
  constructor(fs, prefix) { this.fs = fs; this.prefix = prefix; }
  p(x) { return join(this.prefix, norm(x)); }
}
for (const m of ['readText', 'readBase64', 'writeText', 'writeBase64', 'list', 'exists', 'isDir', 'mkdir', 'rmdir', 'remove']) {
  PrefixFs.prototype[m] = function (p, ...rest) { return this.fs[m](this.p(p), ...rest); };
}
PrefixFs.prototype.rename = function (a, b) { return this.fs.rename(this.p(a), this.p(b)); };
PrefixFs.prototype.copy = function (a, b) { return this.fs.copy(this.p(a), this.p(b)); };

/**
 * Web-Version: nur ein Browser-Tab darf gleichzeitig mit den lokalen Daten arbeiten.
 * Ist AleNote schon in einem anderen Tab offen, wartet dieser Tab (oder übernimmt auf Wunsch).
 */
async function claimTab() {
  if (!navigator.locks) return;
  const lost = () => {
    const box = document.createElement('div');
    box.className = 'tab-lock';
    box.innerHTML = '<div><h2>AleNote ist jetzt in einem anderen Tab geöffnet</h2><p>Damit nichts doppelt gespeichert wird, ist dieser Tab pausiert.</p><button class="btn btn-primary">Hier weiterarbeiten</button></div>';
    box.querySelector('button').addEventListener('click', () => location.reload());
    document.body.append(box);
  };
  const hold = (steal) => new Promise((resolve) => {
    navigator.locks.request('alenote-web-tab', steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      resolve(!!lock);
      return lock ? new Promise(() => {}) : undefined; // Sperre bis zum Schließen des Tabs halten
    }).catch(() => lost()); // ein anderer Tab hat übernommen
  });
  if (await hold(false)) return;
  // Schon offen: Hinweis zeigen, auf Wunsch übernehmen
  await new Promise((resolve) => {
    const app = document.getElementById('app');
    document.body.classList.add('boot-failed');
    app.innerHTML = '<div class="tab-lock"><div><h2>AleNote ist bereits in einem anderen Tab geöffnet</h2><p>Arbeite dort weiter oder öffne AleNote hier – der andere Tab wird dann pausiert.</p><button class="btn btn-primary">Hier öffnen</button></div></div>';
    app.querySelector('button').addEventListener('click', async () => { await hold(true); app.innerHTML = ''; document.body.classList.remove('boot-failed'); resolve(); });
  });
}

export async function createMobileApi({ web = false } = {}) {
  const native = !!window.Capacitor?.isNativePlatform?.();
  let Plugins = {};
  let fs;
  if (native) {
    const core = await import('../vendor/capacitor-core.js');
    Plugins = {
      Filesystem: core.registerPlugin('Filesystem'),
      App: core.registerPlugin('App'),
      StatusBar: core.registerPlugin('StatusBar'),
      ApkInstaller: core.registerPlugin('ApkInstaller'),
      AleTools: core.registerPlugin('AleTools'),
      LocalNotifications: core.registerPlugin('LocalNotifications')
    };
    fs = new CapacitorFs(Plugins.Filesystem, core.Capacitor);
  } else if (web) {
    await claimTab();
    fs = await IdbFs.open(); // Web-Version: Browser-Datenbank
  } else {
    fs = new MemoryFs(); // Simulation im Browser
  }

  // ---------- Einstellungen & Vault ----------
  let settings = {};
  try { settings = JSON.parse(await fs.readText(`${ROOT}/settings.json`)); } catch {}
  const saveSettings = () => fs.writeText(`${ROOT}/settings.json`, JSON.stringify(settings, null, 2));

  const vaultPath = () => (settings.account ? `${ROOT}/vaults/${settings.account.vaultName}` : `${ROOT}/vaults/local`);
  let vault = new PrefixFs(fs, vaultPath());
  await fs.mkdir(vaultPath() + '/_assets');
  await fs.mkdir(vaultPath() + '/.alenote');
  let assetBase = native ? await fs.fileUrlBase(vaultPath() + '/_assets').catch(() => null) : null;

  // ---------- Ereignisse ----------
  const listeners = new Map();
  const notify = (channel, payload) => (listeners.get(channel) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });

  // ---------- Synchronisierung ----------
  const sync = new MobileSync({
    fs: vault,
    getAccount: () => settings.account,
    notify,
    onAuthLost: (msg) => notify('account:authLost', msg)
  });
  const touched = () => sync.schedule();

  // ---------- Hilfen ----------
  async function uniquePath(dir, base, ext = '') {
    let candidate = join(dir, base + ext), i = 2;
    while (await vault.exists(candidate)) candidate = join(dir, `${base} ${i++}${ext}`);
    return candidate;
  }

  async function readTree(dir) {
    const out = [];
    for (const e of await vault.list(dir)) {
      if (e.name.startsWith('.') || e.name === '_assets' || e.name.endsWith('.tmp') || (!dir && (e.name === '_trash' || e.name === '_config'))) continue;
      const p = join(dir, e.name);
      if (e.type === 'directory') out.push({ type: 'folder', name: e.name, path: p, children: await readTree(p) });
      else if (e.name.endsWith(NOTE_EXT)) {
        let icon = '', updated = 0;
        try { const d = JSON.parse(await vault.readText(p)); icon = d.icon || ''; updated = Number(d.updated) || 0; } catch {}
        out.push({ type: 'note', name: e.name.slice(0, -NOTE_EXT.length), path: p, icon, updated });
      }
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'de', { numeric: true }) : a.type === 'folder' ? -1 : 1));
  }

  async function allNotes() {
    const list = [];
    const walk = (nodes) => nodes.forEach((n) => (n.type === 'note' ? list.push(n) : walk(n.children)));
    walk(await readTree(''));
    return list;
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

  /** Server-Adresse prüfen: ohne Schema zuerst https, dann http; Weiterleitungen übernehmen */
  async function resolveServer(input) {
    const raw = String(input || '').trim().replace(/\/+$/, '');
    if (!raw) throw new Error('Bitte eine Server-Adresse eingeben');
    const bare = raw.replace(/^https?:\/\//i, '');
    const candidates = /^https:\/\//i.test(raw) ? [raw] : /^http:\/\//i.test(raw) ? [raw, 'https://' + bare] : ['https://' + bare, 'http://' + bare];
    for (const c of candidates) {
      try {
        const res = await fetch(c + '/api/health', { signal: AbortSignal.timeout(8e3) });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) continue;
        const final = new URL(res.url);
        return { server: (final.origin + final.pathname.replace(/\/api\/health$/, '')).replace(/\/+$/, ''), health: data };
      } catch {}
    }
    throw new Error('Server nicht erreichbar: ' + raw);
  }
  const publicAccount = () => (settings.account ? (({ token, ...rest }) => rest)(settings.account) : null);

  // ---------- Updates ----------
  const appInfo = native ? await Plugins.App.getInfo().catch(() => ({ version: '0.0.0' }))
    : web ? await fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ version: 'web' }))
    : { version: 'dev' };
  // Die Web-Version ist immer aktuell: sie kommt bei jedem Öffnen frisch vom Server
  let update = { state: native ? 'idle' : 'unsupported', version: appInfo.version, platform: web ? 'web' : 'android' };
  const setUpdate = (patch) => { update = { ...update, ...patch }; notify('update:status', update); };
  let pendingInstall = null;
  if (native) {
    Plugins.ApkInstaller.addListener('progress', ({ percent }) => setUpdate({ state: 'downloading', percent }));
    // Nach dem Erlauben von "Unbekannte Apps installieren" zurück in die App → Installation starten
    Plugins.App.addListener('resume', async () => {
      if (settings.account) sync.run();
      if (pendingInstall) {
        try { await Plugins.ApkInstaller.installDownloaded(); pendingInstall = null; }
        catch (e) { setUpdate({ state: 'ready', error: e.message }); }
      }
    });
  }

  async function findUpdate() {
    if (settings.account) {
      const base = settings.account.server + '/updates/';
      const res = await fetch(base + 'latest-android.json', { cache: 'no-store', signal: AbortSignal.timeout(15e3) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Server antwortet mit ' + res.status);
      const info = await res.json();
      return { version: info.version, url: base + encodeURIComponent(info.file), sha256: info.sha256 || '', source: settings.account.serverName || settings.account.server };
    }
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { signal: AbortSignal.timeout(15e3) });
    if (!res.ok) throw new Error('GitHub antwortet mit ' + res.status);
    const rel = await res.json();
    const apk = rel.assets?.find((a) => /\.apk$/i.test(a.name));
    if (!apk) return null;
    return { version: rel.tag_name.replace(/^v/, ''), url: apk.browser_download_url, sha256: (apk.digest || '').replace(/^sha256:/, ''), source: 'GitHub' };
  }

  async function checkUpdate() {
    if (!native) return update;
    if (settings.autoUpdate === false && update.manual !== true) return update;
    if (['checking', 'downloading'].includes(update.state)) return update;
    setUpdate({ state: 'checking', error: '' });
    try {
      const found = await findUpdate();
      if (found && versionNewer(found.version, appInfo.version)) {
        setUpdate({ state: 'ready', available: found.version, url: found.url, sha256: found.sha256, source: found.source, lastCheck: Date.now() });
      } else setUpdate({ state: 'latest', lastCheck: Date.now(), source: found?.source });
    } catch (e) {
      setUpdate({ state: 'error', error: e.message, lastCheck: Date.now() });
    }
    return update;
  }

  async function installUpdate() {
    if (update.state !== 'ready' || !update.url) return;
    setUpdate({ state: 'downloading', percent: 0 });
    try {
      const r = await Plugins.ApkInstaller.downloadAndInstall({ url: update.url, sha256: update.sha256 || '' });
      if (r.needsPermission) {
        pendingInstall = true;
        setUpdate({ state: 'ready', needsPermission: true });
        notify('update:needsPermission', true);
        await Plugins.ApkInstaller.openInstallSettings();
      } else setUpdate({ state: 'ready', installing: true });
    } catch (e) {
      setUpdate({ state: 'ready', error: e.message });
      throw e;
    }
  }

  if (native) {
    setTimeout(checkUpdate, 8000);
    setInterval(checkUpdate, 4 * 3600e3);
  }

  // ---------- Öffentliche Schnittstelle (wie preload.js) ----------
  return {
    platform: web ? 'web' : 'android',
    isMobile: !web,
    isWeb: web,
    native,
    /** Web-Version: der Server, von dem die Seite kommt */
    defaultServer: web ? location.origin + location.pathname.replace(/\/app\/.*$/, '').replace(/\/+$/, '') : '',
    plugins: Plugins,

    resolveSrc(src) {
      if (typeof src !== 'string' || !src.startsWith('alenote://asset/')) return src;
      const name = decodeURIComponent(src.slice('alenote://asset/'.length));
      if (assetBase) return `${assetBase}/${encodeURIComponent(name)}`;
      return fs.dataUrl?.(vaultPath() + '/_assets/' + name) || src;
    },

    getSettings: async () => settings,
    setSettings: async (patch) => { Object.assign(settings, patch); await saveSettings(); return settings; },
    getVault: async () => (settings.account ? `${settings.account.username}@${settings.account.serverName}` : web ? 'In diesem Browser' : 'Auf diesem Handy'),
    chooseVault: async () => null,
    revealInExplorer: async () => {},
    openFolder: async () => {},

    tree: async (opts) => (opts?.trash ? ((await vault.exists('_trash')) ? readTree('_trash') : []) : readTree('')),
    ensureFolder: async (p) => { await vault.mkdir(p || ''); return p; },
    readNote: async (p) => JSON.parse(await vault.readText(p)),
    writeNote: async (p, data) => { await vault.writeText(p, JSON.stringify(data, null, 2)); touched(); return true; },
    createNote: async (dir, name, data) => {
      await vault.mkdir(dir || '');
      const p = await uniquePath(dir || '', sanitizeName(name), NOTE_EXT);
      await vault.writeText(p, JSON.stringify(data || {}, null, 2));
      touched();
      return p;
    },
    createFolder: async (dir, name) => { const p = await uniquePath(dir || '', sanitizeName(name)); await vault.mkdir(p); touched(); return p; },
    rename: async (p, newName) => {
      const isNote = p.endsWith(NOTE_EXT);
      const base = sanitizeName(newName);
      const target = join(parentOf(p), base + (isNote ? NOTE_EXT : ''));
      if (target === p) return p;
      const final = target.toLowerCase() === p.toLowerCase() ? target : await uniquePath(parentOf(p), base, isNote ? NOTE_EXT : '');
      await vault.rename(p, final);
      touched();
      return final;
    },
    move: async (p, dir) => {
      if (dir === p || (dir || '').startsWith(p + '/')) throw new Error('Ordner kann nicht in sich selbst verschoben werden');
      if (parentOf(p) === (dir || '')) return p;
      const isNote = p.endsWith(NOTE_EXT);
      const name = p.slice(p.lastIndexOf('/') + 1);
      const final = await uniquePath(dir || '', isNote ? name.slice(0, -NOTE_EXT.length) : name, isNote ? NOTE_EXT : '');
      await vault.rename(p, final);
      touched();
      return final;
    },
    remove: async (p) => { if (await vault.isDir(p)) await vault.rmdir(p, true); else await vault.remove(p); touched(); return true; },
    duplicate: async (p) => {
      const final = await uniquePath(parentOf(p), p.slice(p.lastIndexOf('/') + 1, -NOTE_EXT.length) + ' Kopie', NOTE_EXT);
      await vault.writeText(final, await vault.readText(p));
      touched();
      return final;
    },
    search: async (query) => {
      const q = String(query || '').toLowerCase().trim();
      if (!q) return [];
      const results = [];
      for (const n of await allNotes()) {
        try {
          const data = JSON.parse(await vault.readText(n.path));
          const text = (data.blocks || []).map((b) => JSON.stringify(b.data || {})).join(' ').replace(/<[^>]+>/g, ' ').replace(/\\[nrt]/g, ' ').replace(/[{}"[\]]/g, ' ');
          const idx = text.toLowerCase().indexOf(q);
          if (idx >= 0 || n.name.toLowerCase().includes(q)) results.push({ ...n, snippet: idx >= 0 ? text.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ').trim() : '' });
        } catch {}
        if (results.length >= 50) break;
      }
      return results;
    },

    saveAsset: async (name, bytes) => {
      const ext = ((name || '').match(/\.[a-z0-9]+$/i)?.[0] || '.png').toLowerCase();
      const file = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${ext}`;
      await vault.writeBase64('_assets/' + file, bytesToBase64(bytes));
      touched();
      return `alenote://asset/${encodeURIComponent(file)}`;
    },
    pickImages: function () {
      return new Promise((resolve) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
        input.onchange = async () => resolve(await Promise.all([...input.files].map(async (f) => this.saveAsset(f.name, await f.arrayBuffer()))));
        input.click();
      });
    },
    listPlugins: async () => [],
    openPluginFolder: async () => {},
    saveTextFile: async (name, content) => {
      if (native) {
        try {
          await Plugins.Filesystem.writeFile({ path: `AleNote/${name}`, data: content, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
          return `Dokumente/AleNote/${name}`;
        } catch {
          await fs.writeText(`${ROOT}/exports/${name}`, content);
          return `App-Speicher/exports/${name}`;
        }
      }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content])), download: name });
      a.click();
      return name;
    },
    saveFile: async (name, bytes, filters, mime = 'application/octet-stream') => {
      if (native) { await Plugins.AleTools.shareFile({ name, data: bytesToBase64(bytes), mime }); return name; }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes], { type: mime })), download: name });
      a.click();
      return name;
    },
    printNote: async (name) => {
      if (native) { await Plugins.AleTools.print({ name }); return null; }
      window.print();
      return null;
    },
    setTitleBar: async () => {
      if (!native) return;
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-2').trim() || '#17171c';
      const dark = document.documentElement.dataset.theme !== 'light';
      Plugins.StatusBar.setBackgroundColor({ color: bg.startsWith('#') ? bg : '#17171c' }).catch(() => {});
      Plugins.StatusBar.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
    },
    openExternal: async (url) => { window.open(url, '_blank'); },
    fetchCalendar: async (url) => {
      const acc = settings.account;
      if (acc) return (await serverCall(acc.server, 'GET', '/api/ical?url=' + encodeURIComponent(url), null, acc.token)).text;
      try {
        const res = await fetch(String(url).replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(20e3) });
        const text = await res.text();
        if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Kein iCal-Kalender');
        return text;
      } catch { throw new Error('Kalender-Abos brauchen die Anmeldung an deinem AleNote-Server'); }
    },

    // Konto & Synchronisierung
    getAccount: async () => ({ account: publicAccount(), vault: vaultPath(), status: sync.status }),
    probeServer: async (server) => { const r = await resolveServer(server); return { ...r.health, resolved: r.server }; },
    changeServer: async (input) => {
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
    },
    login: async ({ server, username, password, register, displayName }) => {
      server = (await resolveServer(server)).server;
      const device = web ? `AleNote Web (${/Mac/.test(navigator.platform) ? 'Mac' : /Win/.test(navigator.platform) ? 'Windows' : 'Browser'})` : 'AleNote Android';
      const r = await serverCall(server, 'POST', register ? '/api/register' : '/api/login', { username, password, displayName, device });
      const host = new URL(server).host.replace(/[^\w.-]/g, '_');
      sync.stop();
      settings.account = {
        server, token: r.token, userId: r.user.id, username: r.user.username, displayName: r.user.displayName, role: r.user.role,
        serverName: r.server?.name || host, vaultName: `${r.user.username}@${host}`
      };
      await saveSettings();
      return publicAccount();
    },
    logout: async () => {
      const acc = settings.account;
      sync.stop();
      if (acc) await serverCall(acc.server, 'POST', '/api/logout', null, acc.token).catch(() => {});
      settings.account = null;
      await saveSettings();
      return true;
    },
    accountInfo: async () => {
      const acc = settings.account;
      if (!acc) return null;
      const [me, health] = await Promise.all([
        serverCall(acc.server, 'GET', '/api/me', null, acc.token),
        serverCall(acc.server, 'GET', '/api/health').catch(() => ({}))
      ]);
      Object.assign(acc, { displayName: me.user.displayName, role: me.user.role, serverName: me.server?.name || acc.serverName });
      await saveSettings();
      return { ...me, motd: health.motd || '' };
    },
    changePassword: async (oldPassword, newPassword) => serverCall(settings.account.server, 'POST', '/api/me/password', { oldPassword, newPassword }, settings.account.token),
    syncNow: async () => { sync.run(); return sync.status; },
    noteVersions: async (p) => {
      const acc = settings.account;
      if (!acc) throw new Error('Der Versionsverlauf benötigt die Anmeldung an deinem AleNote-Server');
      return serverCall(acc.server, 'GET', '/api/sync/versions?path=' + encodeURIComponent(p), null, acc.token);
    },
    noteVersion: async (p, id) => {
      const acc = settings.account;
      return serverCall(acc.server, 'GET', `/api/sync/version?path=${encodeURIComponent(p)}&id=${encodeURIComponent(id)}`, null, acc.token);
    },
    syncStart: async () => sync.start(),
    syncResolve: (p, choice) => sync.resolve(p, choice),
    syncMark: (p, rev, hash) => sync.mark(p, rev, hash),
    liveCredentials: async () => (settings.account ? { server: settings.account.server, token: settings.account.token, userId: settings.account.userId } : null),

    // Updates
    appVersion: async () => appInfo.version,
    updateStatus: async () => update,
    checkUpdate: async () => { update.manual = true; const r = await checkUpdate(); update.manual = false; return r; },
    installUpdate,

    on: (channel, fn) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(fn);
      return () => listeners.get(channel).delete(fn);
    }
  };
}
