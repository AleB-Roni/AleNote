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
