// Notiz-Speicher pro Benutzer mit Änderungsindex für die Synchronisierung
//
// Jeder Eintrag im Index:  { kind: 'note'|'folder'|'asset', rev, hash, seq, updated, size, deleted }
// - rev: Version des Eintrags (steigt bei jeder Änderung)
// - seq: globale Änderungsnummer im Vault → Clients holen alles mit seq > lastSeq
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { JsonFile, KeyedLock } = require('./store');
const { httpError } = require('./auth');

const locks = new KeyedLock();

/** Gleicher Notizinhalt, abgesehen von Zeitstempeln? */
function sameContent(a, b) {
  try {
    const norm = (x) => { const o = JSON.parse(x.toString('utf8')); delete o.updated; delete o.created; return JSON.stringify(o); };
    return norm(a) === norm(b);
  } catch { return a.equals(b); }
}
const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function checkPath(p, kind) {
  if (typeof p !== 'string' || !p || p.length > 500) throw httpError(400, 'Ungültiger Pfad');
  const parts = p.split('/');
  if (p.startsWith('/') || p.includes('\\') || parts.some((s) => !s || s === '.' || s === '..' || /[\x00-\x1f<>:"|?*]/.test(s))) {
    throw httpError(400, 'Ungültiger Pfad: ' + p);
  }
  if (kind === 'note' && !p.endsWith('.alenote')) throw httpError(400, 'Notizen müssen auf .alenote enden');
  if (kind === 'asset' && (parts.length !== 1 || !/^[\w.-]+$/.test(p))) throw httpError(400, 'Ungültiger Dateiname');
  return p;
}

class Vault {
  constructor(root, userId) {
    this.dir = path.join(root, userId);
    this.userId = userId;
    this.index = new JsonFile(path.join(this.dir, 'index.json'), { seq: 0, items: {} });
  }

  fileFor(kind, p) {
    return path.join(this.dir, kind === 'asset' ? 'assets' : 'notes', ...p.split('/'));
  }

  lock(fn) { return locks.run(this.userId, fn); }

  // ---------- Versionsverlauf ----------
  // Vor jedem Überschreiben/Löschen einer Notiz wird der alte Inhalt aufbewahrt:
  // history/<sha1(Pfad)>/<Zeit>_<rev>.alenote  – ausgedünnt (siehe pruneVersions)
  historyDir(p) { return path.join(this.dir, 'history', hashOf(Buffer.from(p, 'utf8'))); }

  async keepVersion(p, cur, incoming = null) {
    if (!cur || cur.deleted || cur.kind !== 'note') return;
    try {
      const buf = await fs.readFile(this.fileFor('note', p));
      const dir = this.historyDir(p);
      await fs.mkdir(dir, { recursive: true });
      // Nur echte Inhaltsänderungen aufbewahren (nicht bloß ein neuer Zeitstempel)
      const latest = (await fs.readdir(dir)).filter((f) => /^\d+_\d+\.alenote$/.test(f)).sort((a, b) => Number(b.split('_')[0]) - Number(a.split('_')[0]))[0];
      if (latest && sameContent(await fs.readFile(path.join(dir, latest)), buf)) return;
      // Gleicher Inhalt wie die aktuelle Fassung → überspringen
      if (incoming && sameContent(incoming, buf)) return;
      await fs.writeFile(path.join(dir, `${cur.updated || Date.now()}_${cur.rev}.alenote`), buf);
      await this.pruneVersions(dir);
    } catch { /* Verlauf ist optional – Speichern darf daran nicht scheitern */ }
  }

  /**
   * Ausdünnen: letzte Stunde alle, bis 24 Std. je 10 Min. eine Version, bis 7 Tage je Stunde, bis 90 Tage je Tag,
   * ältere werden gelöscht. Behalten wird jeweils die neueste im Zeitfenster.
   */
  async pruneVersions(dir) {
    const now = Date.now();
    const files = (await fs.readdir(dir)).filter((f) => /^\d+_\d+\.alenote$/.test(f))
      .map((f) => ({ f, t: Number(f.split('_')[0]) })).sort((a, b) => b.t - a.t);
    const seen = new Set();
    for (const { f, t } of files) {
      const age = now - t;
      const bucket = age < 36e5 ? 'a' + t : age < 864e5 ? 'm' + Math.floor(t / 6e5) : age < 7 * 864e5 ? 'h' + Math.floor(t / 36e5) : age < 90 * 864e5 ? 'd' + Math.floor(t / 864e5) : null;
      if (!bucket || seen.has(bucket) || seen.size >= 300) await fs.rm(path.join(dir, f), { force: true });
      else seen.add(bucket);
    }
  }

  async versions(p) {
    checkPath(p, 'note');
    const dir = this.historyDir(p);
    let files = [];
    try { files = await fs.readdir(dir); } catch {}
    const out = [];
    for (const f of files) {
      const m = f.match(/^(\d+)_(\d+)\.alenote$/);
      if (!m) continue;
      const st = await fs.stat(path.join(dir, f)).catch(() => null);
      out.push({ id: f.replace(/\.alenote$/, ''), updated: Number(m[1]), rev: Number(m[2]), size: st?.size || 0 });
    }
    const idx = await this.index.load();
    return { current: idx.items[p] ? { path: p, ...idx.items[p] } : null, versions: out.sort((a, b) => b.updated - a.updated) };
  }

  async version(p, id) {
    checkPath(p, 'note');
    if (!/^\d+_\d+$/.test(String(id))) throw httpError(400, 'Ungültige Version');
    try { return (await fs.readFile(path.join(this.historyDir(p), id + '.alenote'))).toString('utf8'); }
    catch { throw httpError(404, 'Version nicht gefunden'); }
  }

  async changes(since = 0) {
    const idx = await this.index.load();
    const items = Object.entries(idx.items).filter(([, it]) => it.seq > since).map(([p, it]) => ({ path: p, ...it }));
    return { seq: idx.seq, items };
  }

  async usage() {
    const idx = await this.index.load();
    let bytes = 0, notes = 0, assets = 0, folders = 0;
    for (const it of Object.values(idx.items)) {
      if (it.deleted) continue;
      bytes += it.size || 0;
      if (it.kind === 'note') notes++; else if (it.kind === 'asset') assets++; else folders++;
    }
    return { bytes, notes, assets, folders };
  }

  async read(kind, p) {
    checkPath(p, kind);
    const idx = await this.index.load();
    const it = idx.items[p];
    if (!it || it.deleted || it.kind !== kind) throw httpError(404, 'Nicht gefunden');
    const buf = await fs.readFile(this.fileFor(kind, p));
    return { meta: { path: p, ...it }, buf };
  }

  /**
   * Schreibt eine Notiz oder ein Asset.
   * baseRev muss der Version auf dem Server entsprechen, sonst Konflikt (409) – außer force=true.
   */
  write(kind, p, buf, { baseRev = 0, force = false, quotaBytes = 0 } = {}) {
    checkPath(p, kind);
    return this.lock(async () => {
      const idx = await this.index.load();
      const cur = idx.items[p];
      const curRev = cur ? cur.rev : 0;
      const hash = hashOf(buf);
      if (cur && !cur.deleted && cur.hash === hash && cur.kind === kind) return { path: p, ...cur, unchanged: true };
      // Eine gelöschte Notiz neu anzulegen (baseRev 0, z.B. aus dem Papierkorb) ist kein Konflikt
      const recreate = cur?.deleted && baseRev === 0;
      if (!force && kind !== 'asset' && baseRev !== curRev && !recreate) {
        const e = httpError(409, 'Konflikt: Auf dem Server gibt es eine neuere Version');
        e.extra = { current: cur ? { path: p, ...cur } : null };
        throw e;
      }
      if (quotaBytes) {
        const { bytes } = await this.usage();
        if (bytes - (cur && !cur.deleted ? cur.size || 0 : 0) + buf.length > quotaBytes) throw httpError(413, 'Speicherplatz-Kontingent überschritten');
      }
      const file = this.fileFor(kind, p);
      if (kind === 'note') await this.keepVersion(p, cur, buf);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', buf);
      await fs.rename(file + '.tmp', file);
      idx.seq++;
      idx.items[p] = { kind, rev: curRev + 1, hash, seq: idx.seq, updated: Date.now(), size: buf.length, deleted: false };
      await this.index.save();
      return { path: p, ...idx.items[p] };
    });
  }

  putFolder(p) {
    checkPath(p, 'folder');
    return this.lock(async () => {
      const idx = await this.index.load();
      const cur = idx.items[p];
      if (cur && !cur.deleted) return { path: p, ...cur, unchanged: true };
      idx.seq++;
      idx.items[p] = { kind: 'folder', rev: (cur?.rev || 0) + 1, hash: '', seq: idx.seq, updated: Date.now(), size: 0, deleted: false };
      await this.index.save();
      return { path: p, ...idx.items[p] };
    });
  }

  remove(p, { baseRev = null, force = false } = {}) {
    if (typeof p !== 'string') throw httpError(400, 'Ungültiger Pfad');
    return this.lock(async () => {
      const idx = await this.index.load();
      const cur = idx.items[p];
      if (!cur || cur.deleted) return { path: p, deleted: true, unchanged: true };
      if (!force && baseRev != null && cur.kind === 'note' && baseRev !== cur.rev) {
        const e = httpError(409, 'Konflikt: Die Notiz wurde auf dem Server geändert');
        e.extra = { current: { path: p, ...cur } };
        throw e;
      }
      if (cur.kind === 'note') await this.keepVersion(p, cur);
      if (cur.kind !== 'folder') await fs.rm(this.fileFor(cur.kind, p), { force: true });
      idx.seq++;
      idx.items[p] = { ...cur, rev: cur.rev + 1, seq: idx.seq, updated: Date.now(), deleted: true, size: 0, hash: '' };
      await this.index.save();
      return { path: p, ...idx.items[p] };
    });
  }

  async destroy() {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

module.exports = { Vault, checkPath };
