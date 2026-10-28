// Synchronisierung für die Handy-App – gleicher Ablauf wie sync.js auf dem PC:
//   1. Server fragen, was sich seit dem letzten Abgleich geändert hat
//   2. Lokalen Vault einlesen und mit dem letzten Stand vergleichen (.alenote/sync.json)
//   3. Nur lokal geändert → hochladen · nur auf dem Server → herunterladen · beides → Konflikt

const NOTE_EXT = '.alenote';

/** SHA-1 als Hex – wie auf dem Server. Browser stellen crypto.subtle nur über HTTPS bereit,
 *  daher gibt es für die Web-Version über http:// eine eigene Umsetzung. */
export async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle?.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-1', bytes);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* weiter mit eigener Umsetzung */ }
  }
  return sha1Js(bytes);
}

function sha1Js(bytes) {
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  words[words.length - 2] = Math.floor((len * 8) / 0x100000000);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < words.length; off += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[off + t];
    for (let t = 16; t < 80; t++) w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(a, 5) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = rol(b, 30) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

class SyncError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export class MobileSync {
  /** fs: Dateisystem mit Pfaden relativ zum Vault */
  constructor({ fs, getAccount, notify, onAuthLost }) {
    this.fs = fs;
    this.getAccount = getAccount;
    this.notify = notify;
    this.onAuthLost = onAuthLost;
    this.running = false;
    this.again = false;
    this.timer = null;
    this.interval = null;
    this.status = { state: 'off' };
    this.conflicts = new Map();
    this.marks = new Map(); // Live-Bearbeitung: vom Server bestätigte Stände (Pfad → { rev, hash })
  }

  start() {
    this.stop();
    if (!this.getAccount()) { this.setStatus({ state: 'off' }); return; }
    this.interval = setInterval(() => { if (document.visibilityState === 'visible') this.run(); }, 30e3);
    this.run();
  }

  stop() { clearInterval(this.interval); clearTimeout(this.timer); this.interval = null; }

  schedule(ms = 1500) {
    if (!this.getAccount()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  setStatus(patch) { this.status = { ...this.status, ...patch }; this.notify('sync:status', this.status); }

  async request(method, url, json) {
    const acc = this.getAccount();
    if (!acc) throw new SyncError('Nicht angemeldet', 401);
    let res;
    try {
      res = await fetch(acc.server + url, {
        method,
        headers: { Authorization: 'Bearer ' + acc.token, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(30e3)
      });
    } catch { throw new SyncError('Server nicht erreichbar', 0); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SyncError(data.error || `Fehler ${res.status}`, res.status, data);
    return data;
  }

  async loadState() {
    const acc = this.getAccount();
    try {
      const s = JSON.parse(await this.fs.readText('.alenote/sync.json'));
      if (s.server === acc.server && s.userId === acc.userId) return s;
    } catch {}
    return { server: acc.server, userId: acc.userId, lastSeq: 0, items: {} };
  }

  saveState(s) { return this.fs.writeText('.alenote/sync.json', JSON.stringify(s)); }

  async scan() {
    const out = {};
    const walk = async (dir) => {
      for (const e of await this.fs.list(dir)) {
        if (e.name.startsWith('.') || e.name.endsWith('.tmp')) continue;
        const r = dir ? `${dir}/${e.name}` : e.name;
        if (!dir && e.name === '_assets') {
          for (const a of await this.fs.list('_assets')) if (a.type === 'file' && !a.name.startsWith('.')) out['asset:' + a.name] = { kind: 'asset', path: a.name };
          continue;
        }
        if (e.type === 'directory') { out[r] = { kind: 'folder', path: r }; await walk(r); }
        else if (e.name.endsWith(NOTE_EXT)) out[r] = { kind: 'note', path: r, hash: await sha1Hex(await this.fs.readText(r)) };
      }
    };
    await walk('');
    return out;
  }

  async localHash(p) { try { return await sha1Hex(await this.fs.readText(p)); } catch { return null; } }

  checkPath(p) {
    if (!p || p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '.' || !s)) throw new Error('Ungültiger Pfad vom Server: ' + p);
    return p;
  }

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

  /**
   * Live-Bearbeitung: Die lokale Datei entspricht jetzt genau dieser Server-Version
   * (rev/hash) – sie muss also weder hoch- noch heruntergeladen werden.
   */
  async mark(p, rev, hash) {
    this.marks.set(p, { kind: 'note', rev, hash });
    if (this.running) return; // wird am Ende des laufenden Abgleichs übernommen
    const had = this.conflicts.size;
    const state = await this.loadState();
    this.applyMarks(state);
    await this.saveState(state);
    if (had !== this.conflicts.size) {
      this.setStatus({ state: this.conflicts.size ? 'conflict' : 'ok', conflicts: this.conflicts.size });
      this.notify('sync:conflicts', [...this.conflicts.values()]);
    }
  }

  applyMarks(state) {
    for (const [p, m] of this.marks) {
      const cur = state.items[p];
      if (!cur || !(cur.rev > m.rev)) state.items[p] = m;
      this.conflicts.delete(p); // über die Live-Verbindung zusammengeführt → kein Konflikt mehr
    }
    this.marks.clear();
  }

  async syncOnce(changed) {
    const state = await this.loadState();
    const remote = await this.request('GET', `/api/sync/changes?since=${state.lastSeq}`);
    const R = {};
    for (const it of remote.items) R[it.kind === 'asset' ? 'asset:' + it.path : it.path] = it;
    const L = await this.scan();
    const B = state.items;
    const keys = [...new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(B)])].sort((a, b) => a.split('/').length - b.split('/').length);
    const folderDeletes = [];

    for (const key of keys) {
      const l = L[key], r = R[key], b = B[key];
      const kind = l?.kind || r?.kind || b?.kind;
      try {
        if (kind === 'note') await this.syncNote(key, l, r, b, state, changed);
        else if (kind === 'folder') {
          if (l && !b) { const res = await this.request('PUT', '/api/sync/folder', { path: key }); B[key] = { kind, rev: res.rev }; }
          else if (!l && r && !r.deleted) { await this.fs.mkdir(this.checkPath(key)); B[key] = { kind, rev: r.rev }; changed.add(key); }
          else if (!l && b && !(r && !r.deleted)) folderDeletes.push(key);
          else if (l && r && r.deleted && b) { await this.fs.rmdir(key); delete B[key]; changed.add(key); }
          else if (l && r && !r.deleted) B[key] = { kind, rev: r.rev };
        } else if (kind === 'asset') {
          const name = (l || r || b).path;
          if (!/^[\w.-]+$/.test(name)) continue;
          if (l && !b) {
            if (!(r && !r.deleted)) await this.request('PUT', '/api/sync/asset64/' + encodeURIComponent(name), { data: await this.fs.readBase64('_assets/' + name) });
            B[key] = { kind, path: name };
          } else if (!l && r && !r.deleted) {
            const res = await this.request('GET', '/api/sync/asset64/' + encodeURIComponent(name));
            await this.fs.writeBase64('_assets/' + name, res.data);
            B[key] = { kind, path: name };
          }
        }
      } catch (err) {
        if (err.status === 0 || err.status === 401 || err.status === 403) throw err;
        console.error('[Sync] Fehler bei', key, err.message);
      }
    }
    for (const key of folderDeletes.sort((a, b) => b.length - a.length)) {
      await this.request('DELETE', '/api/sync/folder?path=' + encodeURIComponent(key)).catch(() => {});
      delete B[key];
    }
    state.lastSeq = remote.seq;
    this.applyMarks(state);
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
      return this.upload(p, r ? r.rev : b?.rev || 0, state);
    }
    if (localDeleted) {
      if (remoteChanged) return this.download(p, null, state, changed);
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
    if (remoteChanged) return this.download(p, l ? l.hash : null, state, changed);
    if (remoteDeleted && l) {
      if ((await this.localHash(p)) === l.hash) { await this.fs.remove(p); changed.add(p); }
      delete B[p];
    }
  }

  async upload(p, baseRev, state, force = false) {
    try {
      const content = await this.fs.readText(p);
      const res = await this.request('PUT', '/api/sync/note', { path: p, content, baseRev, force });
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

  async download(p, expectedLocalHash, state, changed) {
    this.checkPath(p);
    const res = await this.request('GET', '/api/sync/note?path=' + encodeURIComponent(p));
    if ((await this.localHash(p)) !== expectedLocalHash) return;
    await this.fs.writeText(p, res.content);
    state.items[p] = { kind: 'note', rev: res.rev, hash: res.hash };
    this.conflicts.delete(p);
    changed.add(p);
  }

  addConflict(p, remote) {
    this.conflicts.set(p, { path: p, remoteUpdated: remote?.updated || null, remoteDeleted: !!remote?.deleted });
  }

  async resolve(p, choice) {
    const state = await this.loadState();
    const changed = new Set();
    let current = null;
    try { current = await this.request('GET', '/api/sync/note?path=' + encodeURIComponent(p)); } catch (err) { if (err.status !== 404) throw err; }
    if (choice === 'remote' && current) {
      await this.fs.writeText(p, current.content);
      state.items[p] = { kind: 'note', rev: current.rev, hash: current.hash };
      changed.add(p);
    } else {
      if (choice === 'both' && current) {
        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
        const base = p.slice(dir.length, -NOTE_EXT.length);
        let copy = `${dir}${base} (Server-Version)${NOTE_EXT}`;
        for (let i = 2; await this.fs.exists(copy); i++) copy = `${dir}${base} (Server-Version ${i})${NOTE_EXT}`;
        await this.fs.writeText(copy, current.content);
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
