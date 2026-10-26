// Zugriff auf den Hauptprozess. Läuft die Oberfläche im normalen Browser
// (z.B. zum Entwickeln/Testen), wird ein Speicher im localStorage simuliert.

function createBrowserFallback() {
  const KEY = 'alenote-dev-vault';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { files: {}, folders: [], settings: {} }; } catch { return { files: {}, folders: [], settings: {} }; } };
  let db = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const EXT = '.alenote';
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const join = (a, b) => (a ? `${a}/${b}` : b);
  const taken = (p) => p in db.files || db.folders.includes(p);
  const unique = (dir, base, ext = '') => { let p = join(dir, base + ext), i = 2; while (taken(p)) p = join(dir, `${base} ${i++}${ext}`); return p; };
  const clean = (n) => (n || 'Unbenannt').replace(/[<>:"/\\|?*]/g, '').trim() || 'Unbenannt';
  const movePrefix = (from, to) => {
    for (const k of Object.keys(db.files)) if (k === from || k.startsWith(from + '/')) { db.files[to + k.slice(from.length)] = db.files[k]; delete db.files[k]; }
    db.folders = db.folders.map((f) => (f === from || f.startsWith(from + '/') ? to + f.slice(from.length) : f));
  };
  const tree = (dir) => {
    const out = [];
    for (const f of db.folders) if (dirOf(f) === dir) out.push({ type: 'folder', name: baseOf(f), path: f, children: tree(f) });
    for (const [k, v] of Object.entries(db.files)) if (dirOf(k) === dir) out.push({ type: 'note', name: baseOf(k).slice(0, -EXT.length), path: k, icon: v.icon || '' });
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'de', { numeric: true }) : a.type === 'folder' ? -1 : 1));
  };
  const ok = (v) => Promise.resolve(v);
  return {
    isFallback: true,
    platform: 'browser',
    getSettings: () => ok(db.settings),
    setSettings: (p) => { Object.assign(db.settings, p); save(); return ok(db.settings); },
    getVault: () => ok('Browser-Speicher'),
    chooseVault: () => ok(null),
    revealInExplorer: () => ok(),
    openFolder: () => ok(),
    tree: () => ok(tree('')),
    readNote: (p) => ok(structuredClone(db.files[p])),
    writeNote: (p, d) => { db.files[p] = structuredClone(d); save(); return ok(true); },
    createNote: (dir, name, data) => { const p = unique(dir || '', clean(name), EXT); db.files[p] = data || {}; save(); return ok(p); },
    createFolder: (dir, name) => { const p = unique(dir || '', clean(name)); db.folders.push(p); save(); return ok(p); },
    rename: (p, name) => { const isNote = p.endsWith(EXT); const t = unique(dirOf(p), clean(name), isNote ? EXT : ''); movePrefix(p, t); save(); return ok(t); },
    move: (p, dir) => {
      if (dir === p || dir.startsWith(p + '/')) return Promise.reject(new Error('Ordner kann nicht in sich selbst verschoben werden'));
      if (dirOf(p) === dir) return ok(p);
      const isNote = p.endsWith(EXT);
      const t = unique(dir, isNote ? baseOf(p).slice(0, -EXT.length) : baseOf(p), isNote ? EXT : '');
      movePrefix(p, t); save(); return ok(t);
    },
    remove: (p) => { for (const k of Object.keys(db.files)) if (k === p || k.startsWith(p + '/')) delete db.files[k]; db.folders = db.folders.filter((f) => !(f === p || f.startsWith(p + '/'))); save(); return ok(true); },
    duplicate: (p) => { const t = unique(dirOf(p), baseOf(p).slice(0, -EXT.length) + ' Kopie', EXT); db.files[t] = structuredClone(db.files[p]); save(); return ok(t); },
    search: (q) => {
      q = q.toLowerCase();
      return ok(Object.entries(db.files).filter(([k, v]) => k.toLowerCase().includes(q) || JSON.stringify(v).toLowerCase().includes(q))
        .map(([k, v]) => ({ type: 'note', path: k, name: baseOf(k).slice(0, -EXT.length), icon: v.icon, snippet: '' })));
    },
    saveAsset: (name, bytes) => {
      const blob = new Blob([bytes]);
      return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    },
    pickImages: () => new Promise((res) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
      input.onchange = async () => res(await Promise.all([...input.files].map((f) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }))));
      input.click();
    }),
    listPlugins: () => ok([]),
    openPluginFolder: () => ok(),
    saveTextFile: (name, content) => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content])), download: name });
      a.click(); return ok(name);
    },
    setTitleBar: () => ok(),
    openExternal: (url) => { window.open(url, '_blank'); return ok(); },
    // Konto & Sync gibt es nur in der Desktop-App
    getAccount: () => ok({ account: null, status: { state: 'off' } }),
    probeServer: () => Promise.reject(new Error('Nur in der Desktop-App verfügbar')),
    login: () => Promise.reject(new Error('Nur in der Desktop-App verfügbar')),
    logout: () => ok(true),
    accountInfo: () => ok(null),
    changePassword: () => Promise.reject(new Error('Nur in der Desktop-App verfügbar')),
    syncNow: () => ok(), syncStart: () => ok(), syncResolve: () => ok(),
    on: () => () => {},
    appVersion: () => ok('dev'), updateStatus: () => ok({ state: 'unsupported' }), checkUpdate: () => ok({ state: 'unsupported' }), installUpdate: () => ok()
  };
}

export const api = window.alenoteNative || createBrowserFallback();
