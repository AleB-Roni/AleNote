// AleNote Sync-Server
// Start:  node server.js            (Port 8787, Daten in ./data)
// Optionen über Umgebungsvariablen: PORT, HOST, DATA_DIR, ADMIN_USER, ADMIN_PASSWORD

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { JsonFile } = require('./lib/store');
const { Vault } = require('./lib/vault');
const A = require('./lib/auth');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const VERSION = require('./package.json').version;

const DEFAULT_SETTINGS = {
  serverName: 'AleNote Server',
  allowRegistration: false,
  sessionDays: 90,
  maxUploadMB: 25,
  defaultQuotaMB: 0, // 0 = unbegrenzt
  motd: ''
};

const settingsFile = new JsonFile(path.join(DATA, 'settings.json'), DEFAULT_SETTINGS);
const usersFile = new JsonFile(path.join(DATA, 'users.json'), { users: [] });
const sessionsFile = new JsonFile(path.join(DATA, 'sessions.json'), { sessions: {} });
const vaults = new Map();
const vaultOf = (userId) => {
  if (!vaults.has(userId)) vaults.set(userId, new Vault(path.join(DATA, 'vaults'), userId));
  return vaults.get(userId);
};

const settings = () => ({ ...DEFAULT_SETTINGS, ...settingsFile.data });
const users = () => usersFile.data.users;
const findUser = (id) => users().find((u) => u.id === id);
const findByName = (name) => users().find((u) => u.username.toLowerCase() === String(name || '').toLowerCase());

// ================= Start =================

async function init() {
  await fs.mkdir(DATA, { recursive: true });
  await settingsFile.load();
  await usersFile.load();
  await sessionsFile.load();
  if (!users().length) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    users().push({ id: A.newId(), username, displayName: 'Administrator', role: 'admin', passHash: await A.hashPassword(password), disabled: false, quotaMB: 0, created: Date.now(), lastLogin: null });
    await usersFile.save();
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║  Erster Start – Admin-Konto wurde angelegt   ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log(`    Benutzer: ${username}`);
    console.log(`    Passwort: ${password}`);
    console.log('    → Bitte nach dem ersten Login in der Admin-Konsole ändern!\n');
  }
  // Abgelaufene Sitzungen aufräumen
  const now = Date.now();
  for (const [k, s] of Object.entries(sessionsFile.data.sessions)) if (s.expires < now) delete sessionsFile.data.sessions[k];
  await sessionsFile.save();
}

// ================= Hilfen =================

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    ...headers
  });
  res.end(isBuf ? body : JSON.stringify(body ?? {}));
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(A.httpError(413, `Datei zu groß (max. ${Math.round(limitBytes / 1048576)} MB)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, settings().maxUploadMB * 1048576 * 1.4 + 65536);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw A.httpError(400, 'Ungültiges JSON'); }
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

async function authenticate(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw A.httpError(401, 'Nicht angemeldet');
  const key = A.sha256(token);
  const s = sessionsFile.data.sessions[key];
  if (!s || s.expires < Date.now()) throw A.httpError(401, 'Sitzung abgelaufen – bitte neu anmelden');
  const user = findUser(s.userId);
  if (!user || user.disabled) throw A.httpError(403, 'Konto ist deaktiviert');
  if (Date.now() - (s.lastSeen || 0) > 60e3) { s.lastSeen = Date.now(); s.ip = clientIp(req); sessionsFile.save(); }
  return { user, session: s, sessionKey: key };
}

const requireAdmin = (ctx) => { if (ctx.user.role !== 'admin') throw A.httpError(403, 'Nur für Administratoren'); };

async function createSession(user, req, device) {
  const token = crypto.randomBytes(32).toString('hex');
  const key = A.sha256(token);
  sessionsFile.data.sessions[key] = {
    id: A.newId(), userId: user.id, device: String(device || 'Unbekannt').slice(0, 80),
    created: Date.now(), lastSeen: Date.now(), expires: Date.now() + settings().sessionDays * 864e5, ip: clientIp(req)
  };
  user.lastLogin = Date.now();
  await Promise.all([sessionsFile.save(), usersFile.save()]);
  return token;
}

async function userWithUsage(u) {
  return { ...A.publicUser(u), usage: await vaultOf(u.id).usage() };
}

// ================= Routen =================

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// ---- Öffentlich ----
route('GET', '/api/health', async () => ({ ok: true, name: settings().serverName, version: VERSION, allowRegistration: settings().allowRegistration, motd: settings().motd }));

route('POST', '/api/login', async (req) => {
  const ip = clientIp(req);
  A.checkRateLimit(ip);
  const { username, password, device } = await readJson(req);
  const user = findByName(username);
  if (!user || !(await A.verifyPassword(password, user.passHash))) { A.recordFailure(ip); throw A.httpError(401, 'Benutzername oder Passwort falsch'); }
  if (user.disabled) throw A.httpError(403, 'Dieses Konto ist deaktiviert');
  const token = await createSession(user, req, device);
  return { token, user: A.publicUser(user), server: { name: settings().serverName, version: VERSION } };
});

route('POST', '/api/register', async (req) => {
  if (!settings().allowRegistration) throw A.httpError(403, 'Registrierung ist auf diesem Server deaktiviert');
  A.checkRateLimit(clientIp(req));
  const { username, password, displayName, device } = await readJson(req);
  A.validateUsername(username);
  A.validatePassword(password);
  if (findByName(username)) throw A.httpError(409, 'Benutzername ist bereits vergeben');
  const user = { id: A.newId(), username, displayName: displayName || username, role: 'user', passHash: await A.hashPassword(password), disabled: false, quotaMB: settings().defaultQuotaMB, created: Date.now(), lastLogin: null };
  users().push(user);
  await usersFile.save();
  const token = await createSession(user, req, device);
  return { token, user: A.publicUser(user), server: { name: settings().serverName, version: VERSION } };
});

// ---- Eigenes Konto ----
route('GET', '/api/me', async (req, ctx) => ({ user: await userWithUsage(ctx.user), server: { name: settings().serverName, version: VERSION } }));

route('POST', '/api/logout', async (req, ctx) => {
  delete sessionsFile.data.sessions[ctx.sessionKey];
  await sessionsFile.save();
  return { ok: true };
});

route('POST', '/api/me/password', async (req, ctx) => {
  const { oldPassword, newPassword } = await readJson(req);
  if (!(await A.verifyPassword(oldPassword, ctx.user.passHash))) throw A.httpError(400, 'Aktuelles Passwort ist falsch');
  A.validatePassword(newPassword);
  ctx.user.passHash = await A.hashPassword(newPassword);
  // Alle anderen Sitzungen dieses Benutzers beenden
  for (const [k, s] of Object.entries(sessionsFile.data.sessions)) if (s.userId === ctx.user.id && k !== ctx.sessionKey) delete sessionsFile.data.sessions[k];
  await Promise.all([usersFile.save(), sessionsFile.save()]);
  return { ok: true };
});

route('PATCH', '/api/me', async (req, ctx) => {
  const { displayName } = await readJson(req);
  if (displayName != null) ctx.user.displayName = String(displayName).slice(0, 60);
  await usersFile.save();
  return { user: A.publicUser(ctx.user) };
});

// ---- Synchronisierung ----
const quota = (u) => (u.quotaMB ? u.quotaMB * 1048576 : 0);

route('GET', '/api/sync/changes', async (req, ctx, q) => vaultOf(ctx.user.id).changes(Number(q.get('since') || 0)));

route('GET', '/api/sync/note', async (req, ctx, q) => {
  const { meta, buf } = await vaultOf(ctx.user.id).read('note', q.get('path'));
  return { ...meta, content: buf.toString('utf8') };
});

route('PUT', '/api/sync/note', async (req, ctx) => {
  const { path: p, content, baseRev, force } = await readJson(req);
  if (typeof content !== 'string') throw A.httpError(400, 'content fehlt');
  return vaultOf(ctx.user.id).write('note', p, Buffer.from(content, 'utf8'), { baseRev: Number(baseRev || 0), force: !!force, quotaBytes: quota(ctx.user) });
});

route('DELETE', '/api/sync/note', async (req, ctx, q) => {
  const base = q.get('baseRev');
  return vaultOf(ctx.user.id).remove(q.get('path'), { baseRev: base == null ? null : Number(base), force: q.get('force') === '1' });
});

route('PUT', '/api/sync/folder', async (req, ctx) => vaultOf(ctx.user.id).putFolder((await readJson(req)).path));
route('DELETE', '/api/sync/folder', async (req, ctx, q) => vaultOf(ctx.user.id).remove(q.get('path'), { force: true }));

route('GET', '/api/sync/asset/:name', async (req, ctx, q, params) => {
  const { buf } = await vaultOf(ctx.user.id).read('asset', decodeURIComponent(params.name));
  return buf;
});
route('PUT', '/api/sync/asset/:name', async (req, ctx, q, params) => {
  const buf = await readBody(req, settings().maxUploadMB * 1048576);
  return vaultOf(ctx.user.id).write('asset', decodeURIComponent(params.name), buf, { force: true, quotaBytes: quota(ctx.user) });
});

// ---- Admin ----
route('GET', '/api/admin/stats', async (req, ctx) => {
  requireAdmin(ctx);
  let bytes = 0, notes = 0, assets = 0;
  for (const u of users()) { const us = await vaultOf(u.id).usage(); bytes += us.bytes; notes += us.notes; assets += us.assets; }
  const now = Date.now();
  const sessions = Object.values(sessionsFile.data.sessions).filter((s) => s.expires > now);
  return {
    users: users().length, admins: users().filter((u) => u.role === 'admin').length, disabled: users().filter((u) => u.disabled).length,
    sessions: sessions.length, activeToday: new Set(sessions.filter((s) => now - s.lastSeen < 864e5).map((s) => s.userId)).size,
    bytes, notes, assets, version: VERSION, uptime: process.uptime(), node: process.version, dataDir: DATA
  };
});

route('GET', '/api/admin/users', async (req, ctx) => {
  requireAdmin(ctx);
  return { users: await Promise.all(users().map(userWithUsage)) };
});

route('POST', '/api/admin/users', async (req, ctx) => {
  requireAdmin(ctx);
  const { username, password, displayName, role, quotaMB } = await readJson(req);
  A.validateUsername(username);
  A.validatePassword(password);
  if (findByName(username)) throw A.httpError(409, 'Benutzername ist bereits vergeben');
  const user = {
    id: A.newId(), username, displayName: displayName || username, role: role === 'admin' ? 'admin' : 'user',
    passHash: await A.hashPassword(password), disabled: false, quotaMB: Number(quotaMB ?? settings().defaultQuotaMB) || 0, created: Date.now(), lastLogin: null
  };
  users().push(user);
  await usersFile.save();
  return { user: await userWithUsage(user) };
});

route('PATCH', '/api/admin/users/:id', async (req, ctx, q, params) => {
  requireAdmin(ctx);
  const user = findUser(params.id);
  if (!user) throw A.httpError(404, 'Benutzer nicht gefunden');
  const body = await readJson(req);
  const otherAdmins = users().filter((u) => u.role === 'admin' && !u.disabled && u.id !== user.id).length;
  if (body.displayName != null) user.displayName = String(body.displayName).slice(0, 60);
  if (body.quotaMB != null) user.quotaMB = Math.max(0, Number(body.quotaMB) || 0);
  if (body.role != null) {
    if (body.role !== 'admin' && user.role === 'admin' && !otherAdmins) throw A.httpError(400, 'Es muss mindestens einen Administrator geben');
    user.role = body.role === 'admin' ? 'admin' : 'user';
  }
  if (body.disabled != null) {
    if (body.disabled && user.role === 'admin' && !otherAdmins) throw A.httpError(400, 'Der letzte Administrator kann nicht deaktiviert werden');
    user.disabled = !!body.disabled;
    if (user.disabled) for (const [k, s] of Object.entries(sessionsFile.data.sessions)) if (s.userId === user.id) delete sessionsFile.data.sessions[k];
  }
  if (body.username != null && body.username !== user.username) {
    A.validateUsername(body.username);
    if (findByName(body.username)) throw A.httpError(409, 'Benutzername ist bereits vergeben');
    user.username = body.username;
  }
  if (body.password) {
    A.validatePassword(body.password);
    user.passHash = await A.hashPassword(body.password);
    for (const [k, s] of Object.entries(sessionsFile.data.sessions)) if (s.userId === user.id && k !== ctx.sessionKey) delete sessionsFile.data.sessions[k];
  }
  await Promise.all([usersFile.save(), sessionsFile.save()]);
  return { user: await userWithUsage(user) };
});

route('DELETE', '/api/admin/users/:id', async (req, ctx, q, params) => {
  requireAdmin(ctx);
  const user = findUser(params.id);
  if (!user) throw A.httpError(404, 'Benutzer nicht gefunden');
  if (user.id === ctx.user.id) throw A.httpError(400, 'Du kannst dein eigenes Konto nicht löschen');
  if (user.role === 'admin' && users().filter((u) => u.role === 'admin').length <= 1) throw A.httpError(400, 'Der letzte Administrator kann nicht gelöscht werden');
  usersFile.data.users = users().filter((u) => u.id !== user.id);
  for (const [k, s] of Object.entries(sessionsFile.data.sessions)) if (s.userId === user.id) delete sessionsFile.data.sessions[k];
  if (q.get('keepData') !== '1') await vaultOf(user.id).destroy();
  vaults.delete(user.id);
  await Promise.all([usersFile.save(), sessionsFile.save()]);
  return { ok: true };
});

route('GET', '/api/admin/sessions', async (req, ctx) => {
  requireAdmin(ctx);
  const now = Date.now();
  return {
    sessions: Object.entries(sessionsFile.data.sessions).filter(([, s]) => s.expires > now).map(([k, s]) => ({
      id: s.id, userId: s.userId, username: findUser(s.userId)?.username || '?', device: s.device, ip: s.ip,
      created: s.created, lastSeen: s.lastSeen, expires: s.expires, current: k === ctx.sessionKey
    })).sort((a, b) => b.lastSeen - a.lastSeen)
  };
});

route('DELETE', '/api/admin/sessions/:id', async (req, ctx, q, params) => {
  requireAdmin(ctx);
  for (const [k, s] of Object.entries(sessionsFile.data.sessions)) if (s.id === params.id) delete sessionsFile.data.sessions[k];
  await sessionsFile.save();
  return { ok: true };
});

route('GET', '/api/admin/settings', async (req, ctx) => { requireAdmin(ctx); return { settings: settings() }; });

route('PATCH', '/api/admin/settings', async (req, ctx) => {
  requireAdmin(ctx);
  const body = await readJson(req);
  const s = settingsFile.data;
  if (body.serverName != null) s.serverName = String(body.serverName).slice(0, 60) || DEFAULT_SETTINGS.serverName;
  if (body.allowRegistration != null) s.allowRegistration = !!body.allowRegistration;
  if (body.sessionDays != null) s.sessionDays = Math.min(3650, Math.max(1, Number(body.sessionDays) || 90));
  if (body.maxUploadMB != null) s.maxUploadMB = Math.min(1024, Math.max(1, Number(body.maxUploadMB) || 25));
  if (body.defaultQuotaMB != null) s.defaultQuotaMB = Math.max(0, Number(body.defaultQuotaMB) || 0);
  if (body.motd != null) s.motd = String(body.motd).slice(0, 300);
  await settingsFile.save();
  return { settings: settings() };
});

// ================= Statische Admin-Konsole =================

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function serveAdmin(res, pathname) {
  const base = path.join(__dirname, 'admin');
  let rel = pathname.replace(/^\/admin\/?/, '') || 'index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) return send(res, 403, { error: 'Verboten' });
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY' });
    res.end(buf);
  } catch { send(res, 404, { error: 'Nicht gefunden' }); }
}

// ================= HTTP-Server =================

const PUBLIC = new Set(['/api/health', '/api/login', '/api/register']);

const server = http.createServer(async (req, res) => {
  // CORS – erlaubt Zugriff aus Desktop-App, Handy-App und Browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname === '/' ) { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return await serveAdmin(res, pathname);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      const ctx = PUBLIC.has(pathname) ? null : await authenticate(req);
      const result = await r.handler(req, ctx, url.searchParams, params);
      return send(res, 200, result);
    }
    send(res, 404, { error: 'Unbekannte Adresse' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message || 'Serverfehler', ...(err.extra || {}) });
  }
});

init().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`  AleNote Server ${VERSION} läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  Admin-Konsole:  http://localhost:${PORT}/admin`);
    console.log(`  Daten:          ${DATA}\n`);
  });
});

module.exports = server;
