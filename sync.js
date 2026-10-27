// AleNote Synchronisierung (läuft im Electron-Hauptprozess)
//
// Ablauf eines Abgleichs:
//   1. Beim Server nachfragen, was sich seit dem letzten Abgleich geändert hat (/api/sync/changes)
//   2. Lokalen Vault einlesen und mit dem Stand vom letzten Abgleich vergleichen (.alenote/sync.json)
//   3. Nur lokal geändert → hochladen · nur auf dem Server geändert → herunterladen
//      Beides geändert → Konflikt, der Benutzer entscheidet in der App
//
// Lokal wird immer sofort gespeichert – die App funktioniert auch komplett offline.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const NOTE_EXT = '.alenote';
const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

class SyncError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

class SyncManager {
  constructor({ getAccount, getVault, notify, onAuthLost }) {
    this.getAccount = getAccount;
    this.getVault = getVault;
    this.notify = notify; // (channel, payload) → an die Oberfläche
    this.onAuthLost = onAuthLost;
    this.running = false;
    this.again = false;
    this.timer = null;
    this.interval = null;
    this.status = { state: 'off' };
    this.conflicts = new Map();
  }

  // ---------------- Steuerung ----------------

  start() {
    this.stop();
    if (!this.getAccount()) { this.setStatus({ state: 'off' }); return; }
    this.interval = setInterval(() => this.run(), 30e3);
    this.run();
  }

  stop() {
    clearInterval(this.interval);
    clearTimeout(this.timer);
    this.interval = null;
  }

  /** Nach lokalen Änderungen etwas verzögert abgleichen */
  schedule(ms = 1500) {
    if (!this.getAccount()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.notify('sync:status', this.status);
  }

  // ---------------- HTTP ----------------

  async request(method, url, { json, body, raw = false } = {}) {
    const acc = this.getAccount();
    if (!acc) throw new SyncError('Nicht angemeldet', 401);
    let res;
    try {
      res = await fetch(acc.server + url, {
        method,
        headers: { Authorization: 'Bearer ' + acc.token, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : body,
        signal: AbortSignal.timeout(30e3)
      });
    } catch (err) {
      throw new SyncError('Server nicht erreichbar', 0);
    }
    if (raw && res.ok) return Buffer.from(await res.arrayBuffer());
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SyncError(data.error || `Fehler ${res.status}`, res.status, data);
    return data;
  }

  // ---------------- Lokaler Zustand ----------------

  stateFile() { return path.join(this.getVault(), '.alenote', 'sync.json'); }

  async loadState() {
    const acc = this.getAccount();
    try {
      const s = JSON.parse(await fs.readFile(this.stateFile(), 'utf8'));
      if (s.server === acc.server && s.userId === acc.userId) return s;
    } catch {}
    return { server: acc.server, userId: acc.userId, lastSeq: 0, items: {} };
  }

  async saveState(state) {
    await fs.mkdir(path.dirname(this.stateFile()), { recursive: true });
    await fs.writeFile(this.stateFile() + '.tmp', JSON.stringify(state), 'utf8');
    await fs.rename(this.stateFile() + '.tmp', this.stateFile());
  }

  /** Liest den lokalen Vault: Notizen (mit Hash), Ordner und Assets */
  async scan() {
    const root = this.getVault();
    const out = {};
    const walk = async (dir, rel) => {
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.endsWith('.tmp')) continue;
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (!rel && e.name === '_assets') {
          if (e.isDirectory()) for (const a of await fs.readdir(abs, { withFileTypes: true })) if (a.isFile() && !a.name.startsWith('.')) out['asset:' + a.name] = { kind: 'asset', path: a.name };
          continue;
        }
        if (e.isDirectory()) { out[r] = { kind: 'folder', path: r }; await walk(abs, r); }
        else if (e.name.endsWith(NOTE_EXT)) out[r] = { kind: 'note', path: r, hash: hashOf(await fs.readFile(abs)) };
      }
    };
    await walk(root, '');
    return out;
  }

  localFile(kind, p) {
    const root = this.getVault();
    const abs = kind === 'asset' ? path.join(root, '_assets', p) : path.join(root, ...p.split('/'));
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Ungültiger Pfad vom Server: ' + p);
    return resolved;
  }

  async localHash(p) {
    try { return hashOf(await fs.readFile(this.localFile('note', p))); } catch { return null; }
  }

  async writeLocal(kind, p, buf) {
    const file = this.localFile(kind, p);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', buf);
    await fs.rename(file + '.tmp', file);
  }

  // ---------------- Abgleich ----------------

  async run() {
    if (!this.getAccount()) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.setStatus({ state: 'syncing', message: '' });
    const changed = new Set();
    try {
      await this.syncOnce(changed);
      this.setStatus({ state: this.conflicts.size ? 'conflict' : 'ok', lastSync: Date.now(), message: '', conflicts: this.conflicts.size });
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        this.setStatus({ state: 'auth', message: err.message });
        this.stop();
        this.onAuthLost?.(err.message);
      } else if (err.status === 0) {
        this.setStatus({ state: 'offline', message: 'Server nicht erreichbar – Änderungen werden später hochgeladen' });
      } else {
        console.error('[Sync]', err);
        this.setStatus({ state: 'error', message: err.message });
      }
    } finally {
      this.running = false;
      if (changed.size) this.notify('sync:changed', { paths: [...changed] });
      if (this.conflicts.size) this.notify('sync:conflicts', [...this.conflicts.values()]);
      if (this.again) { this.again = false; this.schedule(300); }
    }
  }

  async syncOnce(changed) {
    const state = await this.loadState();
    const remote = await this.request('GET', `/api/sync/changes?since=${state.lastSeq}`);
    const R = {};
    for (const it of remote.items) R[it.kind === 'asset' ? 'asset:' + it.path : it.path] = it;
    const L = await this.scan();
    const B = state.items;
    const keys = new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(B)]);
    const sorted = [...keys].sort((a, b) => a.split('/').length - b.split('/').length);
    const folderDeletes = [];

    for (const key of sorted) {
      const l = L[key], r = R[key], b = B[key];
      const kind = l?.kind || r?.kind || b?.kind;
      try {
        if (kind === 'note') await this.syncNote(key, l, r, b, state, changed);
        else if (kind === 'folder') {
          if (l && !b) { const res = await this.request('PUT', '/api/sync/folder', { json: { path: key } }); B[key] = { kind, rev: res.rev }; }
          else if (!l && r && !r.deleted) { await fs.mkdir(this.localFile('folder', key), { recursive: true }); B[key] = { kind, rev: r.rev }; changed.add(key); }
          else if (!l && b && !(r && !r.deleted)) folderDeletes.push(key);
          else if (l && r && r.deleted && b) { await fs.rmdir(this.localFile('folder', key)).catch(() => {}); delete B[key]; changed.add(key); }
          else if (l && r && !r.deleted) B[key] = { kind, rev: r.rev };
        } else if (kind === 'asset') {
          const name = (l || r || b).path;
          if (l && !b) {
            if (!(r && !r.deleted)) await this.request('PUT', '/api/sync/asset/' + encodeURIComponent(name), { body: await fs.readFile(this.localFile('asset', name)) });
            B[key] = { kind, path: name };
          } else if (!l && r && !r.deleted) {
            await this.writeLocal('asset', name, await this.request('GET', '/api/sync/asset/' + encodeURIComponent(name), { raw: true }));
            B[key] = { kind, path: name };
          }
        }
      } catch (err) {
        if (err.status === 0 || err.status === 401 || err.status === 403) throw err;
        console.error('[Sync] Fehler bei', key, err.message);
      }
    }

    // Lokal gelöschte Ordner zuletzt (tiefste zuerst)
    for (const key of folderDeletes.sort((a, b) => b.length - a.length)) {
      await this.request('DELETE', '/api/sync/folder?path=' + encodeURIComponent(key)).catch(() => {});
      delete B[key];
    }

    state.lastSeq = remote.seq;
    await this.saveState(state);
  }

  async syncNote(p, l, r, b, state, changed) {
    const B = state.items;
    const localChanged = !!l && (!b || b.hash !== l.hash);
    const localDeleted = !l && !!b;
    const remoteChanged = !!r && !r.deleted && (!b || r.rev !== b.rev);
    const remoteDeleted = !!r && r.deleted && !!b && r.rev !== b.rev;

    if (localChanged) {
      if (remoteChanged) {
        if (r.hash === l.hash) { B[p] = { kind: 'note', rev: r.rev, hash: r.hash }; this.conflicts.delete(p); return; }
        return this.addConflict(p, r);
      }
      await this.upload(p, r ? r.rev : b?.rev || 0, state);
      return;
    }
    if (localDeleted) {
      if (remoteChanged) return this.download(p, null, state, changed); // Server-Version wiederherstellen
      if (remoteDeleted || (r && r.deleted)) { delete B[p]; return; }
      try {
        await this.request('DELETE', `/api/sync/note?path=${encodeURIComponent(p)}&baseRev=${b.rev}`);
        delete B[p];
      } catch (err) {
        if (err.status === 409) return this.download(p, null, state, changed);
        throw err;
      }
      return;
    }
    // Lokal unverändert
    if (remoteChanged) return this.download(p, l ? l.hash : null, state, changed);
    if (remoteDeleted && l) {
      const file = this.localFile('note', p);
      if ((await this.localHash(p)) === l.hash) {
        await fs.rm(file, { force: true });
        changed.add(p);
      }
      delete B[p];
    }
  }

  async upload(p, baseRev, state, force = false) {
    try {
      const content = await fs.readFile(this.localFile('note', p), 'utf8');
      const res = await this.request('PUT', '/api/sync/note', { json: { path: p, content, baseRev, force } });
      state.items[p] = { kind: 'note', rev: res.rev, hash: res.hash };
      this.conflicts.delete(p);
    } catch (err) {
      // Neue Notiz an einer Stelle, die auf dem Server als gelöscht gilt (z.B. aus dem Papierkorb
      // wiederhergestellt): kein echter Konflikt → mit der Version des Löschvermerks erneut senden
      const cur = err.body?.current;
      if (err.status === 409 && !force && !baseRev && cur?.deleted && cur.rev) return this.upload(p, cur.rev, state);
      if (err.status === 409) return this.addConflict(p, cur);
      throw err;
    }
  }

  /** Lädt eine Notiz herunter – aber nur, wenn sie lokal seit dem Einlesen nicht verändert wurde */
  async download(p, expectedLocalHash, state, changed) {
    const res = await this.request('GET', '/api/sync/note?path=' + encodeURIComponent(p));
    if ((await this.localHash(p)) !== expectedLocalHash) return; // in der Zwischenzeit bearbeitet → nächster Durchlauf
    await this.writeLocal('note', p, Buffer.from(res.content, 'utf8'));
    state.items[p] = { kind: 'note', rev: res.rev, hash: res.hash };
    this.conflicts.delete(p);
    changed.add(p);
  }

  addConflict(p, remote) {
    this.conflicts.set(p, { path: p, remoteUpdated: remote?.updated || null, remoteDeleted: !!remote?.deleted });
  }

  /** Konflikt lösen: choice = 'local' | 'remote' | 'both' */
  async resolve(p, choice) {
    const state = await this.loadState();
    const changed = new Set();
    let current = null;
    try { current = await this.request('GET', '/api/sync/note?path=' + encodeURIComponent(p)); } catch (err) { if (err.status !== 404) throw err; }
    if (choice === 'remote' && current) {
      await this.writeLocal('note', p, Buffer.from(current.content, 'utf8'));
      state.items[p] = { kind: 'note', rev: current.rev, hash: current.hash };
      changed.add(p);
    } else {
      if (choice === 'both' && current) {
        const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p) + '/';
        const base = path.posix.basename(p, NOTE_EXT);
        let copy = `${dir}${base} (Server-Version)${NOTE_EXT}`;
        for (let i = 2; await fs.access(this.localFile('note', copy)).then(() => true, () => false); i++) copy = `${dir}${base} (Server-Version ${i})${NOTE_EXT}`;
        await this.writeLocal('note', copy, Buffer.from(current.content, 'utf8'));
        changed.add(copy);
      }
      await this.upload(p, current ? current.rev : 0, state, true);
    }
    this.conflicts.delete(p);
    await this.saveState(state);
    if (changed.size) this.notify('sync:changed', { paths: [...changed] });
    this.setStatus({ state: this.conflicts.size ? 'conflict' : 'ok', conflicts: this.conflicts.size });
    this.schedule(500);
  }
}

module.exports = { SyncManager };
