// AleNote Admin-Konsole
const $ = (s, el = document) => el.querySelector(s);
let token = sessionStorage.getItem('alenote-admin-token');
let me = null;

// ---------- Hilfen ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(false); throw new Error(data.error || 'Sitzung abgelaufen'); }
  if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status);
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
const fmtDate = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const ago = (t) => {
  if (!t) return 'nie';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  return `vor ${Math.floor(s / 86400)} Tagen`;
};
const color = (name) => `hsl(${[...name].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360} 55% 50%)`;
const avatar = (u) => `<div class="avatar" style="background:${color(u.username)}">${esc((u.displayName || u.username)[0].toUpperCase())}</div>`;

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
}

function modal(title, html, onSubmit, submitLabel = 'Speichern', danger = false) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<form class="modal"><h3>${esc(title)}</h3>${html}<div class="error"></div><div class="foot"><button type="button" class="btn ghost" data-cancel>Abbrechen</button><button class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button></div></form>`;
  const close = () => bd.remove();
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  $('[data-cancel]', bd).onclick = close;
  $('form', bd).onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(new FormData(e.target), bd); close(); }
    catch (err) { $('.error', bd).textContent = err.message; }
  };
  document.body.append(bd);
  setTimeout(() => $('input:not([type=checkbox])', bd)?.focus(), 30);
  return bd;
}

function switchEl(on) { return `<button type="button" class="switch ${on ? 'on' : ''}" onclick="this.classList.toggle('on')"></button>`; }

// ---------- Anmeldung ----------
async function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  try { const h = await api('GET', '/api/health'); $('#server-name').textContent = h.name + ' · v' + h.version; } catch {}
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    const r = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password'), device: 'Admin-Konsole (Browser)' });
    if (r.user.role !== 'admin') {
      token = r.token;
      await api('POST', '/api/logout').catch(() => {});
      token = null;
      throw new Error('Dieses Konto hat keine Admin-Rechte');
    }
    token = r.token;
    sessionStorage.setItem('alenote-admin-token', token);
    start();
  } catch (err) { $('#login-error').textContent = err.message; }
};

async function logout(callServer = true) {
  if (callServer && token) await api('POST', '/api/logout').catch(() => {});
  token = null;
  sessionStorage.removeItem('alenote-admin-token');
  showLogin();
}
$('#logout').onclick = () => logout();

async function start() {
  try { me = (await api('GET', '/api/me')).user; } catch { return showLogin(); }
  if (me.role !== 'admin') return logout();
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#me').innerHTML = `${esc(me.displayName)} <span class="muted">(${esc(me.username)})</span>`;
  go('overview');
}

// ---------- Navigation ----------
const pages = { overview, users, sessions, updates, settings, account };
const titles = { overview: 'Übersicht', users: 'Benutzer', sessions: 'Sitzungen', updates: 'App-Updates', settings: 'Server-Einstellungen', account: 'Mein Konto' };
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => go(b.dataset.page)));

function go(page) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $('#page-title').textContent = titles[page];
  $('#top-actions').innerHTML = '';
  const el = $('#page');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  el.innerHTML = '<div class="empty">Lädt…</div>';
  pages[page](el).catch((err) => { el.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

// ---------- Seiten ----------
async function overview(el) {
  const s = await api('GET', '/api/admin/stats');
  const up = s.uptime > 86400 ? Math.floor(s.uptime / 86400) + ' Tage' : s.uptime > 3600 ? Math.floor(s.uptime / 3600) + ' Std.' : Math.floor(s.uptime / 60) + ' Min.';
  el.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Benutzer</div><div class="value">${s.users}</div><div class="sub">${s.admins} Admin · ${s.disabled} deaktiviert</div></div>
      <div class="card"><div class="label">Aktiv (24 h)</div><div class="value">${s.activeToday}</div><div class="sub">${s.sessions} offene Sitzungen</div></div>
      <div class="card"><div class="label">Notizen</div><div class="value">${s.notes}</div><div class="sub">${s.assets} Bilder/Dateien</div></div>
      <div class="card"><div class="label">Speicher</div><div class="value">${fmtBytes(s.bytes)}</div><div class="sub">alle Benutzer</div></div>
    </div>
    <div class="panel"><h3>Server</h3>
      <div class="row"><div>Version</div><div>${esc(s.version)} · Node ${esc(s.node)}</div></div>
      <div class="row"><div>Laufzeit</div><div>${up}</div></div>
      <div class="row"><div>Datenordner</div><div><code>${esc(s.dataDir)}</code></div></div>
      <div class="row"><div>Server-Adresse für AleNote</div><div><code>${esc(location.origin)}</code></div></div>
    </div>`;
}

async function users(el) {
  const { users } = await api('GET', '/api/admin/users');
  $('#top-actions').innerHTML = '<button class="btn primary" id="add-user">+ Neuer Benutzer</button>';
  $('#add-user').onclick = createUser;
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Benutzer</th><th>Rolle</th><th>Status</th><th>Speicher</th><th>Notizen</th><th>Letzte Anmeldung</th><th></th></tr></thead>
    <tbody>${users.map((u) => {
      const quota = u.quotaMB ? u.quotaMB * 1048576 : 0;
      const pct = quota ? Math.min(100, (u.usage.bytes / quota) * 100) : 0;
      return `<tr data-id="${u.id}">
        <td><div class="user-cell">${avatar(u)}<div><div>${esc(u.displayName)}</div><div class="muted" style="font-size:12px">@${esc(u.username)}</div></div></div></td>
        <td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? 'Admin' : 'Benutzer'}</span></td>
        <td><span class="badge ${u.disabled ? 'off' : 'on'}">${u.disabled ? 'Deaktiviert' : 'Aktiv'}</span></td>
        <td>${fmtBytes(u.usage.bytes)}${quota ? ` / ${u.quotaMB} MB<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</td>
        <td>${u.usage.notes}</td>
        <td title="${fmtDate(u.lastLogin)}">${ago(u.lastLogin)}</td>
        <td><div class="actions">
          <button class="btn small" data-act="edit">Bearbeiten</button>
          <button class="btn small" data-act="pw">Passwort</button>
          ${u.id !== me.id ? '<button class="btn small danger" data-act="del">Löschen</button>' : ''}
        </div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  el.querySelectorAll('[data-act]').forEach((b) => {
    const u = users.find((x) => x.id === b.closest('tr').dataset.id);
    b.onclick = () => ({ edit: editUser, pw: resetPassword, del: deleteUser })[b.dataset.act](u);
  });
}

function createUser() {
  modal('Neuen Benutzer anlegen', `
    <label>Benutzername<input class="in" name="username" required pattern="[a-zA-Z0-9._-]{2,32}" placeholder="z.B. max" /></label>
    <label>Anzeigename<input class="in" name="displayName" placeholder="z.B. Max Mustermann" /></label>
    <label>Passwort<input class="in" name="password" type="text" required minlength="6" value="${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6).toUpperCase()}" /></label>
    <label>Rolle<select class="in" name="role"><option value="user">Benutzer</option><option value="admin">Administrator</option></select></label>
    <label>Speicher-Kontingent in MB (0 = unbegrenzt)<input class="in" name="quotaMB" type="number" min="0" value="0" /></label>`,
  async (f) => {
    const body = Object.fromEntries(f);
    await api('POST', '/api/admin/users', { ...body, quotaMB: Number(body.quotaMB) });
    go('users');
    setTimeout(() => showCredentials(body.username, body.password), 50);
  }, 'Anlegen');
}

function showCredentials(username, password) {
  const text = `Server: ${location.origin}\nBenutzername: ${username}\nPasswort: ${password}`;
  modal('Benutzer angelegt ✓', `
    <p class="muted" style="margin:0">Gib diese Zugangsdaten an den Benutzer weiter. Das Passwort wird danach nicht mehr angezeigt.</p>
    <pre style="margin:0;padding:12px 14px;border-radius:10px;background:var(--bg);border:1px solid var(--border);font-family:Consolas,monospace;font-size:13px;line-height:1.7;user-select:all">${esc(text)}</pre>
    <button type="button" class="btn small" id="copy-cred">📋 Kopieren</button>`,
  async () => {}, 'Fertig');
  $('#copy-cred').onclick = async () => { await navigator.clipboard.writeText(text).catch(() => {}); toast('Kopiert'); };
}

function editUser(u) {
  modal(`${u.displayName} bearbeiten`, `
    <label>Benutzername<input class="in" name="username" value="${esc(u.username)}" required /></label>
    <label>Anzeigename<input class="in" name="displayName" value="${esc(u.displayName)}" /></label>
    <label>Rolle<select class="in" name="role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Benutzer</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option></select></label>
    <label>Speicher-Kontingent in MB (0 = unbegrenzt)<input class="in" name="quotaMB" type="number" min="0" value="${u.quotaMB || 0}" /></label>
    <div class="row"><div>Konto deaktiviert<div class="hint">Deaktivierte Benutzer werden sofort abgemeldet</div></div>${switchEl(u.disabled)}</div>`,
  async (f, bd) => {
    const body = Object.fromEntries(f);
    await api('PATCH', '/api/admin/users/' + u.id, { ...body, quotaMB: Number(body.quotaMB), disabled: $('.switch', bd).classList.contains('on') });
    toast('Gespeichert');
    go('users');
  });
}

function resetPassword(u) {
  modal(`Passwort für ${u.username} zurücksetzen`, `
    <p class="muted" style="margin:0">Alle Sitzungen dieses Benutzers werden beendet.</p>
    <label>Neues Passwort<input class="in" name="password" type="text" minlength="6" required /></label>`,
  async (f) => {
    await api('PATCH', '/api/admin/users/' + u.id, { password: f.get('password') });
    toast('Passwort geändert');
  }, 'Passwort setzen');
}

function deleteUser(u) {
  modal(`${u.username} löschen?`, `
    <p class="muted" style="margin:0">Das Konto wird entfernt. Alle Notizen dieses Benutzers auf dem Server werden <b>unwiderruflich gelöscht</b> (${u.usage.notes} Notizen, ${fmtBytes(u.usage.bytes)}).</p>
    <label>Zur Bestätigung den Benutzernamen eingeben<input class="in" name="confirm" required /></label>`,
  async (f) => {
    if (f.get('confirm') !== u.username) throw new Error('Benutzername stimmt nicht überein');
    await api('DELETE', '/api/admin/users/' + u.id);
    toast('Benutzer gelöscht');
    go('users');
  }, 'Endgültig löschen', true);
}

async function sessions(el) {
  const { sessions } = await api('GET', '/api/admin/sessions');
  el.innerHTML = sessions.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Benutzer</th><th>Gerät</th><th>IP</th><th>Angemeldet</th><th>Zuletzt aktiv</th><th></th></tr></thead>
    <tbody>${sessions.map((s) => `<tr>
      <td>@${esc(s.username)}</td><td>${esc(s.device)} ${s.current ? '<span class="badge on">Diese Sitzung</span>' : ''}</td>
      <td><code>${esc(s.ip || '–')}</code></td><td>${fmtDate(s.created)}</td><td>${ago(s.lastSeen)}</td>
      <td>${s.current ? '' : `<button class="btn small danger" data-id="${s.id}">Beenden</button>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Keine aktiven Sitzungen</div>';
  el.querySelectorAll('[data-id]').forEach((b) => (b.onclick = async () => {
    await api('DELETE', '/api/admin/sessions/' + b.dataset.id);
    toast('Sitzung beendet');
    go('sessions');
  }));
}

async function updates(el) {
  const u = await api('GET', '/api/admin/updates');
  $('#top-actions').innerHTML = '<button class="btn primary" id="check-gh">Jetzt bei GitHub prüfen</button>';
  $('#check-gh').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Lade herunter…';
    try { const r = await api('POST', '/api/admin/updates/check'); toast(r.version ? `Version ${r.version} ist verfügbar` : 'Kein Release gefunden'); }
    catch (err) { toast(err.message, true); }
    go('updates');
  };
  el.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Windows</div><div class="value">${esc(u.version || '–')}</div><div class="sub">${u.releaseDate ? fmtDate(Date.parse(u.releaseDate)) : 'noch keine'}</div></div>
      <div class="card"><div class="label">Android</div><div class="value">${esc(u.androidVersion || '–')}</div><div class="sub">${esc(u.androidFile || 'noch keine APK')}</div></div>
      <div class="card"><div class="label">Quelle</div><div class="value" style="font-size:16px;margin-top:12px">${esc(u.source || '–')}</div></div>
      <div class="card"><div class="label">Letzte Prüfung</div><div class="value" style="font-size:16px;margin-top:12px">${ago(u.lastCheck)}</div><div class="sub" style="color:${u.lastError ? 'var(--red)' : ''}">${esc(u.lastError || (u.checking ? 'läuft…' : 'ok'))}</div></div>
    </div>
    <div class="panel"><h3>So funktioniert es</h3>
      <p class="muted" style="margin:0 0 8px;line-height:1.6">Installierte AleNote-Apps, die mit diesem Server verbunden sind, fragen beim Start und alle 4 Stunden hier nach Updates (<code>${esc(location.origin)}/updates/latest.yml</code> bzw. <code>latest-android.json</code>). Sie laden neue Versionen im Hintergrund und fragen dann, ob neu gestartet werden soll.</p>
    </div>
    <form class="panel form" id="upd-form" style="max-width:none">
      <h3 style="margin:0">Automatisch von GitHub übernehmen</h3>
      <div class="row"><div>Neue Releases automatisch übernehmen<div class="hint">Prüft alle 6 Stunden das neueste GitHub-Release</div></div>${switchEl(u.updateAuto)}</div>
      <label>GitHub-Repository<input class="in" name="updateRepo" value="${esc(u.updateRepo)}" placeholder="besitzer/repository" /></label>
      <div><button class="btn primary">Speichern</button></div>
    </form>
    <div class="panel"><h3>Manuell hochladen</h3>
      <p class="muted" style="margin:0 0 12px">Windows: Setup-EXE (+ .blockmap) und <code>latest.yml</code>. Android: APK und <code>latest-android.json</code>. Die Info-Dateien werden automatisch zuletzt hochgeladen.</p>
      <input type="file" id="upd-files" multiple accept=".exe,.yml,.blockmap,.apk,.json" />
      <div id="upd-progress" class="muted" style="margin-top:10px"></div>
    </div>`;
  $('#upd-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', '/api/admin/settings', { updateRepo: new FormData(e.target).get('updateRepo'), updateAuto: $('#upd-form .switch').classList.contains('on') });
      toast('Gespeichert');
    } catch (err) { toast(err.message, true); }
  };
  $('#upd-files').onchange = async (e) => {
    const isInfo = (f) => f.name === 'latest.yml' || f.name === 'latest-android.json';
    const files = [...e.target.files].sort((a, b) => isInfo(a) - isInfo(b));
    const prog = $('#upd-progress');
    try {
      for (const f of files) {
        prog.textContent = `Lade ${f.name} hoch (${fmtBytes(f.size)})…`;
        const res = await fetch('/api/admin/updates/file/' + encodeURIComponent(f.name), { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: f });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Fehler ' + res.status);
      }
      toast('Hochgeladen');
      go('updates');
    } catch (err) { prog.textContent = ''; toast(err.message, true); }
  };
}

async function settings(el) {
  const { settings: s } = await api('GET', '/api/admin/settings');
  el.innerHTML = `<form class="form panel" id="settings-form" style="margin-top:0">
    <label>Servername<input class="in" name="serverName" value="${esc(s.serverName)}" /></label>
    <label>Nachricht für alle Benutzer (wird in AleNote angezeigt)<textarea class="in" name="motd" rows="2">${esc(s.motd)}</textarea></label>
    <div class="row"><div>Selbst-Registrierung erlauben<div class="hint">Jeder mit der Server-Adresse kann sich ein Konto anlegen</div></div>${switchEl(s.allowRegistration)}</div>
    <label>Sitzungsdauer in Tagen<input class="in" name="sessionDays" type="number" min="1" value="${s.sessionDays}" /></label>
    <label>Maximale Dateigröße pro Upload (MB)<input class="in" name="maxUploadMB" type="number" min="1" value="${s.maxUploadMB}" /></label>
    <label>Standard-Kontingent für neue Benutzer (MB, 0 = unbegrenzt)<input class="in" name="defaultQuotaMB" type="number" min="0" value="${s.defaultQuotaMB}" /></label>
    <div><button class="btn primary">Einstellungen speichern</button></div>
  </form>`;
  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      await api('PATCH', '/api/admin/settings', { ...body, allowRegistration: $('.switch', el).classList.contains('on') });
      toast('Einstellungen gespeichert');
    } catch (err) { toast(err.message, true); }
  };
}

async function account(el) {
  el.innerHTML = `<form class="form panel" id="pw-form" style="margin-top:0">
    <h3>Passwort ändern</h3>
    <label>Aktuelles Passwort<input class="in" name="oldPassword" type="password" required autocomplete="current-password" /></label>
    <label>Neues Passwort<input class="in" name="newPassword" type="password" minlength="6" required autocomplete="new-password" /></label>
    <label>Neues Passwort wiederholen<input class="in" name="repeat" type="password" minlength="6" required autocomplete="new-password" /></label>
    <div><button class="btn primary">Passwort ändern</button></div>
  </form>`;
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.newPassword !== f.repeat) return toast('Die Passwörter stimmen nicht überein', true);
    try {
      await api('POST', '/api/me/password', f);
      toast('Passwort geändert – andere Sitzungen wurden abgemeldet');
      e.target.reset();
    } catch (err) { toast(err.message, true); }
  };
}

token ? start() : showLogin();
