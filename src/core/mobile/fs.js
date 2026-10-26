// Dateisystem für die Handy-App
// - CapacitorFs: echter App-Speicher auf Android (Capacitor Filesystem, Bereich DATA)
// - MemoryFs:    Simulation im Browser (zum Testen ohne Handy)
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
  async readText(p) { p = norm(p); if (!(p in this.files)) throw new Error('Nicht gefunden: ' + p); return this.files[p]; }
  async readBase64(p) { return btoa(unescape(encodeURIComponent(await this.readText(p)))); }
  async writeText(p, t) { p = norm(p); this.files[p] = t; await this.mkdir(parentOf(p)); this.persist(); }
  async writeBase64(p, b64) { p = norm(p); this.files[p] = 'data:;base64,' + b64; await this.mkdir(parentOf(p)); this.persist(); }
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
  async mkdir(p) { p = norm(p); if (!p) return; const parts = p.split('/'); parts.forEach((_, i) => this.dirs.add(parts.slice(0, i + 1).join('/'))); }
  async rmdir(p, recursive = false) {
    p = norm(p);
    const inside = Object.keys(this.files).filter((f) => f.startsWith(p + '/'));
    if (inside.length && !recursive) return;
    inside.forEach((f) => delete this.files[f]);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(p + '/')) this.dirs.delete(d);
    this.persist();
  }
  async remove(p) { delete this.files[norm(p)]; this.persist(); }
  async rename(from, to) {
    from = norm(from); to = norm(to);
    for (const f of Object.keys(this.files)) if (f === from || f.startsWith(from + '/')) { this.files[to + f.slice(from.length)] = this.files[f]; delete this.files[f]; }
    for (const d of [...this.dirs]) if (d === from || d.startsWith(from + '/')) { this.dirs.delete(d); this.dirs.add(to + d.slice(from.length)); }
    await this.mkdir(parentOf(to));
    this.persist();
  }
  async copy(from, to) { this.files[norm(to)] = this.files[norm(from)]; this.persist(); }
  async fileUrlBase() { return null; }
  dataUrl(p) { const v = this.files[norm(p)]; return v && v.startsWith('data:') ? v.replace('data:;', 'data:image/*;') : null; }
}

function blobToBase64(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
}

export { norm, parentOf };
