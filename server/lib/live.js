// Live-Verbindungen (Server-Sent Events) pro Benutzer:
//  - „change“:   eine Notiz/ein Ordner wurde geändert → andere Geräte gleichen sofort ab
//  - „edit“:     Block-Änderungen an einer geöffneten Notiz (Live-Bearbeitung)
//  - „presence“: welches Gerät gerade welche Notiz geöffnet hat
class LiveHub {
  constructor() { this.users = new Map(); }

  attach(req, res, user, { client, device }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no' // nginx/Reverse-Proxy: nicht puffern
    });
    res.write(': AleNote live\n\n');
    const conn = { res, client: String(client || '').slice(0, 64), device: String(device || 'Gerät').slice(0, 60), name: user.displayName || user.username, path: null, since: Date.now() };
    let set = this.users.get(user.id);
    if (!set) this.users.set(user.id, (set = new Set()));
    // Gleiche Client-ID verbindet sich neu → alte Verbindung ersetzen
    for (const c of set) if (c.client === conn.client) { set.delete(c); try { c.res.end(); } catch {} }
    set.add(conn);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25e3);
    const close = () => {
      clearInterval(ping);
      if (!set.delete(conn)) return;
      if (!set.size) this.users.delete(user.id);
      this.presence(user.id);
    };
    req.on('close', close);
    res.on('error', close);
    this.write(conn, 'hello', { client: conn.client, presence: this.list(user.id) });
    this.presence(user.id);
  }

  write(conn, event, data) {
    try { conn.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  }

  send(userId, event, data, except = null) {
    for (const c of this.users.get(userId) || []) if (!except || c.client !== except) this.write(c, event, data);
  }

  list(userId) {
    return [...(this.users.get(userId) || [])].map((c) => ({ client: c.client, device: c.device, name: c.name, path: c.path }));
  }

  setPath(userId, client, path) {
    for (const c of this.users.get(userId) || []) if (c.client === client) c.path = path || null;
    this.presence(userId);
  }

  presence(userId) { this.send(userId, 'presence', { list: this.list(userId) }); }

  count() { let n = 0; for (const s of this.users.values()) n += s.size; return n; }
}

module.exports = { LiveHub };
