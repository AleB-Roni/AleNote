// Live-Bearbeitung: Änderungen an der geöffneten Notiz erscheinen sofort auf allen Geräten.
//
// So funktioniert's:
//  - Solange der Server erreichbar ist, besteht eine Live-Verbindung (Server-Sent Events).
//  - Änderungen werden blockweise (nur geänderte Blöcke + Reihenfolge) an den Server geschickt.
//    Der Server führt sie zusammen (pro Block gewinnt die letzte Änderung) und gibt sie an die
//    anderen Geräte weiter. Die bestätigte Fassung wird lokal gespeichert und beim normalen
//    Abgleich als „schon synchron“ markiert.
//  - Andere Änderungen (neue Notizen, Umbenennen …) lösen auf den anderen Geräten sofort einen
//    normalen Abgleich aus statt erst nach 30 Sekunden.
//  - Offline oder bei Problemen speichert AleNote ganz normal lokal und gleicht später ab.
import { h } from './utils.js';
import { icon } from '../ui/icons.js';
import { sha1Hex } from './mobile/sync-core.js';

const SEND_DELAY = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LiveService {
  constructor(app) {
    this.app = app;
    this.api = app.api;
    this.client = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    this.state = 'off'; // off | connecting | live | offline
    this.presence = [];
    this.shadow = null; // was der Server von der geöffneten Notiz kennt
    this.ready = false; // geöffnete Notiz ist mit dem Server abgeglichen → Live-Speichern
    this.inflight = null;
    this.again = false;
    this.changedSinceSend = false;
    this.applying = false;
    this.waiters = [];
    this.chip = h('button.live-chip', { title: 'Live-Bearbeitung', onclick: () => this.showInfo() });
    this.chip.hidden = true;
  }

  get enabled() { return this.app.settings.live !== false; }

  /** Speichert die geöffnete Notiz gerade live über den Server? */
  handles(path) { return this.state === 'live' && this.ready && !!path && this.shadow?.path === path; }

  device() {
    const p = this.api.platform;
    if (p === 'android') return 'Android';
    if (p === 'web') return 'Browser' + (/Mac/.test(navigator.platform) ? ' (Mac)' : /Win/.test(navigator.platform) ? ' (Windows)' : /iPhone|iPad/.test(navigator.userAgent) ? ' (iPhone/iPad)' : '');
    return p === 'darwin' ? 'Mac' : p === 'linux' ? 'Linux-PC' : 'Windows-PC';
  }

  init() {
    const ev = this.app.events;
    ev.on('note:open', (_n, path) => this.prepare(path));
    ev.on('note:change', () => { if (!this.applying) this.localChange(); });
    this.api.on?.('sync:status', (st) => {
      // Nach einem Abgleich erneut prüfen, ob die geöffnete Notiz jetzt live gehen kann
      if (st.state === 'ok' && this.state === 'live' && !this.ready && this.app.currentPath) this.prepareSoon();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.state === 'offline') this.reconnectNow(); });
    this.api.plugins?.App?.addListener?.('resume', () => { if (this.state !== 'live') this.reconnectNow(); })?.catch?.(() => {});
    this.app.account?.chip?.after(this.chip);
    this.start();
  }

  // ---------------- Verbindung ----------------

  async start() {
    this.stop();
    if (!this.enabled || !this.api.liveCredentials) return this.render();
    const creds = await this.api.liveCredentials().catch(() => null);
    if (!creds?.token) return this.render();
    this.creds = creds;
    this.run = (this.run || 0) + 1;
    this.loop(this.run);
  }

  stop() {
    this.run = (this.run || 0) + 1;
    this.abort?.abort();
    this.setState('off');
    this.ready = false;
  }

  reconnectNow() { this.wake?.(); }

  async loop(run) {
    let backoff = 1000;
    while (run === this.run) {
      this.setState(this.state === 'live' ? 'live' : 'connecting');
      try {
        this.abort = new AbortController();
        const res = await fetch(`${this.creds.server}/api/live?client=${encodeURIComponent(this.client)}&device=${encodeURIComponent(this.device())}`, {
          headers: { Authorization: 'Bearer ' + this.creds.token }, signal: this.abort.signal, cache: 'no-store'
        });
        if (res.status === 401 || res.status === 403) { this.setState('off'); return; }
        if (!res.ok || !res.body) throw new Error('Status ' + res.status);
        backoff = 1000;
        await this.read(res.body, run);
      } catch { /* offline – später erneut */ }
      if (run !== this.run) return;
      this.ready = false;
      this.setState('offline');
      await new Promise((r) => { this.wake = r; setTimeout(r, backoff); });
      backoff = Math.min(backoff * 2, 30e3);
    }
  }

  async read(body, run) {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done || run !== this.run) return;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message', data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try { this.onEvent(event, JSON.parse(data)); } catch (err) { console.warn('[Live]', err); }
      }
    }
  }

  async request(method, url, json) {
    const res = await fetch(this.creds.server + url, {
      method,
      headers: { Authorization: 'Bearer ' + this.creds.token, 'X-AleNote-Client': this.client, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(15e3)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Fehler ' + res.status); e.status = res.status; throw e; }
    return data;
  }

  onEvent(event, data) {
    if (event === 'hello') {
      this.setState('live');
      this.presence = data.presence || [];
      this.sendPresence();
      // Erst die geöffnete Notiz zusammenführen, dann verpasste Änderungen normal nachholen
      Promise.resolve(this.app.currentPath ? this.prepare(this.app.currentPath) : null).finally(() => this.api.syncNow?.());
    } else if (event === 'presence') {
      this.presence = data.list || [];
      this.render();
    } else if (event === 'change') {
      this.syncSoon();
      if (data.path === this.app.currentPath && !this.ready) this.prepareSoon(1500);
    } else if (event === 'edit') {
      if (data.by === this.client) return;
      if (data.path === this.app.currentPath && this.shadow?.path === data.path && this.ready) this.applyRemote(data);
      else this.syncSoon();
    }
  }

  syncSoon() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.api.syncNow?.(), 400);
  }

  sendPresence() {
    if (this.state !== 'live') return;
    this.request('POST', '/api/live/presence', { client: this.client, path: this.app.currentPath || null }).catch(() => {});
  }

  // ---------------- Geöffnete Notiz ----------------

  prepareSoon(ms = 300) {
    clearTimeout(this.prepTimer);
    this.prepTimer = setTimeout(() => this.prepare(this.app.currentPath), ms);
  }

  snapshot(path, note) {
    const meta = new Map();
    for (const [k, v] of Object.entries(note)) if (k !== 'blocks' && k !== 'updated') meta.set(k, JSON.stringify(v));
    return { path, blocks: new Map((note.blocks || []).map((b) => [b.id, JSON.stringify(b)])), order: JSON.stringify((note.blocks || []).map((b) => b.id)), meta };
  }

  /** Beim Öffnen: ist die lokale Fassung gleich der auf dem Server? Dann live speichern. */
  async prepare(path) {
    // Letzter mit dem Server abgestimmter Stand (falls zwischendurch offline weitergeschrieben wurde)
    const base = this.shadow?.path === path ? this.shadow : null;
    this.ready = false;
    this.shadow = null;
    this.sendPresence();
    this.render();
    if (this.state !== 'live' || !path || !this.app.editor?.note) return;
    let remote = null;
    try { remote = await this.request('GET', '/api/sync/note?path=' + encodeURIComponent(path)); }
    catch (err) { if (err.status !== 404) return; }
    if (path !== this.app.currentPath) return;
    if (!remote) { this.api.syncNow?.(); return; } // neue Notiz: erst normal hochladen
    if (this.app.dirty) await this.app.saveNow({ local: true });
    let local;
    try { local = JSON.stringify(await this.api.readNote(path), null, 2); } catch { return; }
    if (path !== this.app.currentPath) return;
    if ((await sha1Hex(local)) !== remote.hash) {
      // Offline weitergeschrieben: eigene Änderungen blockweise mit dem Server zusammenführen
      if (base && this.state === 'live') {
        try {
          this.shadow = base;
          const patch = this.diff(this.app.editor.note) || { blocks: {} };
          const res = await this.request('POST', '/api/live/edit', { client: this.client, path, patch });
          if (path !== this.app.currentPath) return;
          this.ready = true;
          this.adopt(path, JSON.parse(res.content));
          this.best = { path, rev: res.rev, hash: res.hash, content: res.content };
          await this.persist(path, this.best);
          this.render();
          return;
        } catch (err) { console.warn('[Live] Zusammenführen fehlgeschlagen', err.message); this.shadow = null; this.ready = false; }
      }
      this.api.syncNow?.(); // sonst erst normal abgleichen
      return;
    }
    this.shadow = this.snapshot(path, this.app.editor.note);
    this.best = { path, rev: remote.rev, hash: remote.hash, content: null };
    this.persisted = { path, rev: remote.rev };
    this.ready = true;
    this.render();
  }

  /** Lokale Änderung → gleich (gebündelt) an den Server */
  localChange() {
    if (!this.handles(this.app.currentPath)) return;
    this.changedSinceSend = true;
    clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.send(), SEND_DELAY);
  }

  diff(note) {
    const sh = this.shadow;
    const blocks = {};
    let n = 0;
    const ids = new Set();
    for (const b of note.blocks || []) {
      ids.add(b.id);
      const js = JSON.stringify(b);
      if (sh.blocks.get(b.id) !== js) { blocks[b.id] = b; n++; }
    }
    for (const id of sh.blocks.keys()) if (!ids.has(id)) { blocks[id] = null; n++; }
    const order = JSON.stringify((note.blocks || []).map((b) => b.id));
    const meta = {};
    const keys = new Set([...Object.keys(note), ...sh.meta.keys()]);
    for (const k of keys) {
      if (k === 'blocks' || k === 'updated') continue;
      const js = k in note ? JSON.stringify(note[k]) : undefined;
      if (js !== sh.meta.get(k)) { meta[k] = k in note ? note[k] : null; n++; }
    }
    const patch = { blocks };
    if (order !== sh.order) { patch.order = JSON.parse(order); n++; }
    if (Object.keys(meta).length) patch.meta = meta;
    return n ? patch : null;
  }

  /** Alles Ausstehende senden; erfüllt sich, wenn der Server bestätigt und lokal gespeichert ist */
  flush() {
    clearTimeout(this.sendTimer);
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.send(); });
  }

  settle(err) {
    const w = this.waiters.splice(0);
    for (const x of w) err ? x.reject(err) : x.resolve();
  }

  async send() {
    if (this.inflight) { this.again = true; return; }
    const path = this.app.currentPath;
    const note = this.app.editor?.note;
    if (!this.handles(path) || !note) { this.settle(this.ready ? null : new Error('nicht live')); return; }
    const patch = this.diff(note);
    if (!patch) { this.app.dirty = false; this.settle(); return; }
    const next = this.snapshot(path, note);
    this.changedSinceSend = false;
    this.inflight = this.request('POST', '/api/live/edit', { client: this.client, path, patch });
    try {
      const res = await this.inflight;
      this.shadow = next;
      this.offer(res);
      if (!this.changedSinceSend && path === this.app.currentPath) await this.persist(path, this.best);
    } catch (err) {
      // Server hat die Änderung nicht → normal lokal speichern, später abgleichen
      console.warn('[Live] Senden fehlgeschlagen', err.message);
      this.ready = false;
      this.inflight = null;
      this.again = false;
      this.render();
      this.app.dirty = true;
      this.settle(err);
      if (err.status === 404) this.api.syncNow?.();
      return;
    }
    this.inflight = null;
    if (this.again || this.changedSinceSend) { this.again = false; return this.send(); }
    this.settle();
  }

  /** Neueste vom Server bestätigte Fassung merken (Antworten können durcheinander ankommen) */
  offer(v) {
    if (v?.content && (!this.best || this.best.path !== this.shadow?.path || v.rev > this.best.rev)) this.best = { ...v, path: this.shadow?.path };
  }

  /** Vom Server bestätigte Fassung lokal speichern und als „schon synchron“ markieren */
  async persist(path, v) {
    if (!v?.content || v.path !== path || (this.persisted?.path === path && this.persisted.rev >= v.rev)) return;
    const { rev, hash, content } = v;
    this.persisted = { path, rev };
    const data = JSON.parse(content);
    await this.api.syncMark?.(path, rev, hash);
    await this.api.writeNote(path, data);
    if (this.app.currentPath === path && !this.changedSinceSend) {
      this.app.dirty = false;
      this.app.setStatus('Live gespeichert', 'saved');
    }
    this.app.events.emit('note:save', data, path);
  }

  // ---------------- Änderungen anderer Geräte übernehmen ----------------

  /** Editor sanft auf einen neuen Stand bringen (z.B. nach Abgleich), ohne alles neu zu zeichnen */
  adopt(path, target) {
    const ed = this.app.editor;
    if (!ed?.note || path !== this.app.currentPath) return;
    this.shadow = this.snapshot(path, ed.note); // eigene Änderungen gelten als bekannt
    const patch = this.diff(target);
    if (patch) this.applyRemote({ path, patch, rev: 0, hash: '', content: null });
    this.shadow = this.snapshot(path, target);
  }

  /** Der normale Abgleich hat die geöffnete Notiz geändert (z.B. Offline-Änderungen eines anderen Geräts) */
  async reloadFromDisk(path) {
    if (!this.handles(path)) return false;
    if (this.inflight || this.changedSinceSend) await this.flush().catch(() => {});
    let note;
    try { note = await this.api.readNote(path); } catch { return false; }
    this.adopt(path, note);
    this.prepareSoon(200); // Stand mit dem Server erneut bestätigen
    return true;
  }

  applyRemote({ path, patch, rev, hash, content }) {
    const ed = this.app.editor;
    const note = ed.note;
    const sh = this.shadow;
    const local = this.diff(note); // eigene, noch nicht gesendete Änderungen haben Vorrang
    const keepLocal = new Set(Object.keys(local?.blocks || {}));
    const focusedId = document.activeElement?.closest?.('.block')?.dataset.id || null;
    this.applying = true;
    let structure = false, meta = false;
    try {
      for (const [id, b] of Object.entries(patch.blocks || {})) {
        if (keepLocal.has(id)) continue;
        const idx = note.blocks.findIndex((x) => x.id === id);
        if (b === null) {
          if (idx >= 0) { note.blocks.splice(idx, 1); ed.rowEl(id)?.remove(); }
          sh.blocks.delete(id);
          structure = true;
          continue;
        }
        sh.blocks.set(id, JSON.stringify(b));
        if (idx >= 0) {
          const el = ed.mainEditable?.(id);
          const caret = id === focusedId && el ? saveCaret(el) : null;
          note.blocks[idx] = b;
          ed.rerenderBlock(id);
          if (caret != null) restoreCaret(ed.mainEditable?.(id), caret);
          flash(ed.rowEl(id));
        } else {
          note.blocks.push(b);
          structure = true;
        }
      }
      if (patch.order) {
        const want = patch.order.filter((id) => note.blocks.some((b) => b.id === id));
        const placed = new Set(want);
        let prev = null;
        for (const b of note.blocks) {
          if (!placed.has(b.id)) { want.splice(prev ? want.indexOf(prev) + 1 : 0, 0, b.id); placed.add(b.id); }
          prev = b.id;
        }
        sh.order = JSON.stringify(patch.order);
        if (want.join() !== note.blocks.map((b) => b.id).join()) {
          const byId = new Map(note.blocks.map((b) => [b.id, b]));
          note.blocks = want.map((id) => byId.get(id));
          structure = true;
        }
      }
      if (structure) {
        // Reihenfolge im Fenster anpassen, ohne den Cursor im aktuellen Block zu verlieren
        for (const b of note.blocks) {
          let row = ed.rowEl(b.id);
          const fresh = !row;
          if (!row) row = ed.renderRow(b);
          ed.blocksEl.append(row);
          if (fresh) flash(row);
        }
        ed.updateNumbering?.();
      }
      for (const [k, v] of Object.entries(patch.meta || {})) {
        if (local?.meta && k in local.meta) continue;
        if (v === null) delete note[k]; else note[k] = v;
        sh.meta.set(k, v === null ? undefined : JSON.stringify(v));
        meta = true;
      }
      if (meta) {
        ed.renderAll();
        if (focusedId) ed.focusBlock?.(focusedId, 'end');
      }
      ed.floats?.updateHeight?.();
      this.app.events.emit('note:change', note, ed);
    } finally {
      this.applying = false;
    }
    this.offer({ rev, hash, content });
    if (!local && !this.inflight) this.persist(path, this.best).catch(() => {});
  }

  // ---------------- Anzeige ----------------

  setState(s) { this.state = s; this.render(); }

  others() {
    return this.presence.filter((p) => p.client !== this.client);
  }

  render() {
    const c = this.chip;
    if (!c) return;
    c.hidden = this.state === 'off' || this.state === 'offline' || !this.enabled;
    if (c.hidden) return;
    const here = this.others().filter((p) => p.path && p.path === this.app.currentPath);
    c.className = 'live-chip ' + (this.state === 'live' ? (this.ready || !this.app.currentPath ? 'on' : 'wait') : 'connecting');
    c.innerHTML = '';
    c.append(h('span.live-dot'), h('span', { text: 'Live' }));
    if (here.length) c.append(h('span.live-count', {}, icon('users', 12), String(here.length)));
    c.title = this.state !== 'live' ? 'Verbinde mit dem Server …'
      : (this.ready || !this.app.currentPath ? 'Live: Änderungen erscheinen sofort auf deinen anderen Geräten' : 'Diese Notiz wird gerade abgeglichen …')
        + (here.length ? '\nAuch geöffnet auf: ' + here.map((p) => p.device).join(', ') : '');
  }

  showInfo() {
    const all = this.others();
    const lines = all.length ? all.map((p) => `• ${p.device}${p.path ? ' – ' + p.path.replace(/\.alenote$/, '').split('/').pop() : ''}`).join('\n') : 'Keine anderen Geräte verbunden';
    this.app.toast?.(`Live-Bearbeitung aktiv\n${lines}`, { duration: 5000 });
  }
}

function flash(row) {
  if (!row) return;
  row.classList.remove('remote-edit');
  void row.offsetWidth;
  row.classList.add('remote-edit');
  setTimeout(() => row.classList.remove('remote-edit'), 1400);
}

/** Cursorposition als Zeichen-Abstand vom Blockanfang */
function saveCaret(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !el.contains(sel.focusNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.focusNode, sel.focusOffset);
  return r.toString().length;
}

function restoreCaret(el, offset) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, left = offset;
  while ((node = walker.nextNode())) {
    if (left <= node.length) {
      const r = document.createRange();
      r.setStart(node, left);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    left -= node.length;
  }
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
