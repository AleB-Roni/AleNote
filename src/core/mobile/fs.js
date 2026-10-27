// Dateisystem für die Handy-App
// - CapacitorFs: echter App-Speicher auf Android (Capacitor Filesystem, Bereich DATA)
// - MemoryFs:    Simulation im Browser (zum Testen ohne Handy, localStorage)
// - IdbFs:       Web-Version im Browser (IndexedDB, genug Platz auch für Bilder)
// Alle Pfade sind relativ und mit "/" getrennt.

const norm = (p) => String(p || '').replace(/^\/+|\/+$/g, '');
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export class CapacitorFs {
  constructor(Filesystem, Capacitor) {
    this.F = Filesystem;
    this.Capacitor = Capacitor;
    this.dir = 'DATA';
  }

  o(path, extra = {}) { return { path: norm(path), directory: this.dir, ...extra }; }

  async readText(p) { return (await this.F.readFile(this.o(p, { encoding: 'utf8' }))).data; }
  async readBase64(p) { const d = (await this.F.readFile(this.o(p))).data; return typeof d === 'string' ? d : await blobToBase64(d); }
  async writeText(p, text) { await this.F.writeFile(this.o(p, { data: text, encoding: 'utf8', recursive: true })); }
  async writeBase64(p, b64) { await this.F.writeFile(this.o(p, { data: b64, recursive: true })); }
  async list(p) {
    try { return (await this.F.readdir(this.o(p))).files.map((f) => ({ name: f.name, type: f.type === 'directory' ? 'directory' : 'file' })); }
    catch { return []; }
  }
  async exists(p) { try { await this.F.stat(this.o(p)); return true; } catch { return false; } }
  async isDir(p) { try { return (await this.F.stat(this.o(p))).type === 'directory'; } catch { return false; } }
  async mkdir(p) { try { await this.F.mkdir(this.o(p, { recursive: true })); } catch {} }
  async rmdir(p, recursive = false) { try { await this.F.rmdir(this.o(p, { recursive })); } catch {} }
  async remove(p) { try { await this.F.deleteFile(this.o(p)); } catch {} }
  async rename(from, to) {
    await this.mkdir(parentOf(norm(to)));
    await this.F.rename({ from: norm(from), to: norm(to), directory: this.dir, toDirectory: this.dir });
  }
  async copy(from, to) { await this.F.copy({ from: norm(from), to: norm(to), directory: this.dir, toDirectory: this.dir }); }
  /** URL, unter der die WebView eine gespeicherte Datei (z.B. ein Bild) anzeigen kann */
  async fileUrlBase(p) {
    const { uri } = await this.F.getUri(this.o(p));
    return this.Capacitor.convertFileSrc(uri);
  }
}

export class MemoryFs {
  constructor(key = 'alenote-mobile-sim') {
    this.key = key;
    try { this.files = JSON.parse(localStorage.getItem(key)) || {}; } catch { this.files = {}; }
    this.dirs = new Set(Object.keys(this.files).flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  }
  persist() { try { localStorage.setItem(this.key, JSON.stringify(this.files)); } catch {} }
  // Hooks für Unterklassen: einzelne Dateien/Ordner geändert
  put() { this.persist(); }
  del() { this.persist(); }
  async readText(p) { p = norm(p); if (!(p in this.files)) throw new Error('Nicht gefunden: ' + p); return this.files[p]; }
  async readBase64(p) { return btoa(unescape(encodeURIComponent(await this.readText(p)))); }
  async writeText(p, t) { p = norm(p); this.files[p] = t; await this.mkdir(parentOf(p)); this.put(p); }
  async writeBase64(p, b64) { p = norm(p); this.files[p] = 'data:;base64,' + b64; await this.mkdir(parentOf(p)); this.put(p); }
  async list(p) {
    p = norm(p);
    const out = new Map();
    const pre = p ? p + '/' : '';
    for (const f of Object.keys(this.files)) if (f.startsWith(pre)) { const rest = f.slice(pre.length); const name = rest.split('/')[0]; out.set(name, rest.includes('/') ? 'directory' : 'file'); }
    for (const d of this.dirs) if (d.startsWith(pre) && d !== p) { const name = d.slice(pre.length).split('/')[0]; if (!out.has(name)) out.set(name, 'directory'); }
    return [...out].map(([name, type]) => ({ name, type }));
  }
  async exists(p) { p = norm(p); return p in this.files || this.dirs.has(p); }
  async isDir(p) { return this.dirs.has(norm(p)); }
  async mkdir(p) {
    p = norm(p);
    if (!p) return;
    const before = this.dirs.size;
    const parts = p.split('/');
    parts.forEach((_, i) => this.dirs.add(parts.slice(0, i + 1).join('/')));
    if (this.dirs.size !== before) this.dirsChanged?.();
  }
  async rmdir(p, recursive = false) {
    p = norm(p);
    const inside = Object.keys(this.files).filter((f) => f.startsWith(p + '/'));
    if (inside.length && !recursive) return;
    inside.forEach((f) => delete this.files[f]);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(p + '/')) this.dirs.delete(d);
    this.dirsChanged?.();
    this.del(inside);
  }
  async remove(p) { p = norm(p); delete this.files[p]; this.del([p]); }
  async rename(from, to) {
    from = norm(from); to = norm(to);
    const moved = [];
    for (const f of Object.keys(this.files)) if (f === from || f.startsWith(from + '/')) { const t = to + f.slice(from.length); this.files[t] = this.files[f]; delete this.files[f]; moved.push([f, t]); }
    for (const d of [...this.dirs]) if (d === from || d.startsWith(from + '/')) { this.dirs.delete(d); this.dirs.add(to + d.slice(from.length)); }
    await this.mkdir(parentOf(to));
    if (moved.length) { this.del(moved.map(([f]) => f)); moved.forEach(([, t]) => this.put(t)); } else this.persist();
  }
  async copy(from, to) { this.files[norm(to)] = this.files[norm(from)]; this.put(norm(to)); }
  async fileUrlBase() { return null; }
  dataUrl(p) { const v = this.files[norm(p)]; return v && v.startsWith('data:') ? v.replace('data:;', 'data:image/*;') : null; }
}

/**
 * Web-Version: Dateien liegen in der IndexedDB des Browsers.
 * Beim Start wird alles in den Speicher geladen (schnelles Lesen), jede Änderung wird einzeln gespeichert.
 */
export class IdbFs extends MemoryFs {
  static async open(name = 'alenote-web') {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('Browser-Speicher (IndexedDB) nicht verfügbar'));
    });
    const files = {};
    let dirs = [];
    await new Promise((res, rej) => {
      const req = db.transaction('files').objectStore('files').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return res();
        if (c.key === DIRS_KEY) dirs = c.value || []; else files[c.key] = c.value;
        c.continue();
      };
      req.onerror = () => rej(req.error);
    });
    const fs = new IdbFs(db, files, dirs);
    navigator.storage?.persist?.().catch(() => {}); // Browser soll die Daten nicht automatisch löschen
    return fs;
  }

  constructor(db, files, dirs) {
    super('__unused__');
    this.db = db;
    this.files = files;
    this.dirs = new Set([...dirs, ...Object.keys(files).flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')))]);
    this.queue = Promise.resolve();
  }

  tx(fn) {
    this.queue = this.queue.then(() => new Promise((res) => {
      const t = this.db.transaction('files', 'readwrite');
      fn(t.objectStore('files'));
      t.oncomplete = res;
      t.onerror = t.onabort = () => { console.error('IndexedDB', t.error); res(); };
    }));
    return this.queue;
  }
  persist() {}
  put(p) { const v = this.files[p]; return this.tx((s) => s.put(v, p)); }
  del(list) { return this.tx((s) => list.forEach((p) => s.delete(p))); }
  dirsChanged() { const v = [...this.dirs]; this.tx((s) => s.put(v, DIRS_KEY)); }
  /** Wartet, bis alle Änderungen gespeichert sind */
  flush() { return this.queue; }
}
const DIRS_KEY = '\u0000dirs';

function blobToBase64(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
}

export { norm, parentOf };
