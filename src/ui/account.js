// Konto & Synchronisierung: Anmelden, Abmelden, Konto wechseln, Sync-Status und Konflikte
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { modal, toast, confirmDialog } from './overlays.js';

const STATUS = {
  off: { icon: 'cloudOff', label: 'Nur lokal', cls: '' },
  syncing: { icon: 'refresh', label: 'Synchronisiere…', cls: 'spin' },
  ok: { icon: 'cloud', label: 'Synchronisiert', cls: 'ok' },
  offline: { icon: 'cloudOff', label: 'Offline', cls: 'warn' },
  error: { icon: 'cloudOff', label: 'Sync-Fehler', cls: 'err' },
  auth: { icon: 'user', label: 'Neu anmelden', cls: 'err' },
  conflict: { icon: 'zap', label: 'Konflikt', cls: 'warn' }
};

const ago = (t) => {
  if (!t) return 'noch nie';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

const colorFor = (name) => `hsl(${[...(name || '?')].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360} 55% 50%)`;

export class AccountUI {
  constructor(app) {
    this.app = app;
    this.api = app.api;
    this.account = null;
    this.status = { state: 'off' };
    this.shownConflicts = new Set();
    this.chip = h('button.sync-chip', { title: 'Synchronisierung', onclick: (e) => this.menu(e.currentTarget) });
    app.addStatusItem('sync', this.chip);
  }

  async init() {
    const r = await this.api.getAccount?.().catch(() => null);
    this.account = r?.account || null;
    this.status = r?.status || { state: this.account ? 'syncing' : 'off' };
    this.render();
    if (!this.api.on) return;
    this.api.on('sync:status', (s) => { this.status = s; this.render(); });
    this.api.on('sync:changed', ({ paths }) => this.onRemoteChanges(paths));
    this.api.on('sync:conflicts', (list) => this.onConflicts(list));
    this.api.on('account:authLost', (msg) => {
      toast(msg || 'Bitte erneut anmelden', { type: 'error', duration: 5000 });
      this.loginDialog({ server: this.account?.server, username: this.account?.username, relogin: true });
    });
    if (this.account) {
      this.api.syncStart();
      this.api.accountInfo().then((info) => { if (info?.motd) toast('📢 ' + info.motd, { duration: 6000 }); }).catch(() => {});
    }
    window.addEventListener('focus', () => { if (this.account) this.api.syncNow(); });
    // Web-Version: beim ersten Öffnen gleich anmelden (sonst liegen die Notizen nur in diesem Browser)
    if (this.api.isWeb && !this.account && !this.app.settings.webLocalOnly) {
      setTimeout(() => this.loginDialog({ web: true }), 300);
    }
  }

  // ---------------- Anzeige ----------------

  render() {
    const st = STATUS[this.status.state] || STATUS.off;
    this.chip.className = 'sync-chip ' + st.cls;
    this.chip.innerHTML = '';
    this.chip.append(icon(st.icon, 15), h('span', { text: this.account ? st.label : 'Nur lokal' }));
    this.chip.title = this.account
      ? `${this.account.displayName} @ ${this.account.serverName}\nLetzter Abgleich: ${ago(this.status.lastSync)}${this.status.message ? '\n' + this.status.message : ''}`
      : 'Nicht angemeldet – Notizen werden nur lokal gespeichert';
    this.renderSidebarButton();
  }

  renderSidebarButton() {
    const btn = this.app.sidebar?.el.querySelector('.vault-btn');
    if (!btn) return;
    btn.innerHTML = '';
    if (this.account) {
      btn.append(h('span.mini-avatar', { text: (this.account.displayName || this.account.username)[0].toUpperCase(), style: { background: colorFor(this.account.username) } }),
        h('span.vault-name', { text: this.account.displayName || this.account.username }));
      btn.title = `Angemeldet als ${this.account.username} auf ${this.account.serverName}`;
    } else {
      btn.append(icon('user', 15), h('span.vault-name', { text: 'Anmelden' }));
      btn.title = 'Bei einem AleNote-Server anmelden';
    }
    btn.onclick = (e) => (this.account ? this.menu(e.currentTarget) : this.loginDialog());
  }

  menu(anchor) {
    if (!this.account) { this.loginDialog(); return; }
    import('./overlays.js').then(({ contextMenu }) => contextMenu([
      { header: `${this.account.displayName} · ${this.account.serverName}` },
      { label: 'Jetzt synchronisieren', icon: 'refresh', run: () => this.api.syncNow() },
      { label: 'Konto & Sync…', icon: 'settings', run: () => this.app.openSettings('account') },
      '-',
      { label: 'Server-Adresse ändern …', icon: 'cloud', run: () => this.changeServer() },
      { label: 'Konto wechseln', icon: 'user', run: () => this.switchAccount() },
      { label: 'Abmelden', icon: 'x', danger: true, run: () => this.logout() }
    ], anchor));
  }

  // ---------------- Anmelden ----------------

  loginDialog({ server = this.app.settings.lastServer || this.api.defaultServer || '', username = '', relogin = false, web = false } = {}) {
    let registerMode = false;
    let serverInfo = null;
    const serverIn = h('input.input', { value: server, placeholder: 'z.B. notizen.meine-domain.de oder 192.168.1.20:8787', spellcheck: 'false', autocapitalize: 'off' });
    const info = h('div.login-server-info.muted.small');
    const userIn = h('input.input', { value: username, placeholder: 'Benutzername', autocomplete: 'username' });
    const nameIn = h('input.input', { placeholder: 'Anzeigename (optional)' });
    const passIn = h('input.input', { type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
    const err = h('div.login-error');
    const nameRow = h('label.login-field.hidden', {}, h('span', { text: 'Anzeigename' }), nameIn);
    const toggle = h('button.link-btn.hidden', { type: 'button', text: 'Noch kein Konto? Registrieren' });
    const submit = h('button.btn.btn-primary.login-submit', { type: 'submit', text: 'Anmelden' });

    const probe = async () => {
      info.textContent = '';
      toggle.classList.add('hidden');
      if (!serverIn.value.trim()) return;
      try {
        serverInfo = await this.api.probeServer(serverIn.value);
        // Erkannte Adresse übernehmen (z.B. https:// ergänzt oder Weiterleitung des Reverse-Proxys)
        if (serverInfo.resolved && serverInfo.resolved !== serverIn.value.trim()) serverIn.value = serverInfo.resolved;
        const secure = /^https:/i.test(serverInfo.resolved || serverIn.value);
        info.innerHTML = '';
        info.append(icon('check', 13), ` ${serverInfo.name} · Version ${serverInfo.version}${secure ? ' · 🔒 HTTPS' : ''}`);
        info.className = 'login-server-info ok small';
        toggle.classList.toggle('hidden', !serverInfo.allowRegistration);
      } catch (e) {
        serverInfo = null;
        info.textContent = e.message;
        info.className = 'login-server-info err small';
      }
    };
    serverIn.addEventListener('change', probe);
    toggle.addEventListener('click', () => {
      registerMode = !registerMode;
      nameRow.classList.toggle('hidden', !registerMode);
      submit.textContent = registerMode ? 'Konto erstellen' : 'Anmelden';
      toggle.textContent = registerMode ? 'Ich habe schon ein Konto' : 'Noch kein Konto? Registrieren';
    });

    const form = h('form.login-form', {},
      h('div.login-hero', {}, icon('cloud', 26), h('div', {},
        h('div.login-title', { text: relogin ? 'Sitzung abgelaufen' : 'Bei AleNote-Server anmelden' }),
        h('div.muted.small', { text: 'Notizen werden lokal gespeichert und automatisch mit dem Server abgeglichen – auch für die Handy-App.' }))),
      h('label.login-field' + (web ? '.hidden' : ''), {}, h('span', { text: 'Server-Adresse' }), serverIn), info,
      h('label.login-field', {}, h('span', { text: 'Benutzername' }), userIn),
      nameRow,
      h('label.login-field', {}, h('span', { text: 'Passwort' }), passIn),
      err,
      h('div.login-actions', {}, toggle, h('div.flex'), submit),
      web ? h('button.link-btn.login-local', { type: 'button', text: 'Ohne Konto nur in diesem Browser nutzen', onclick: () => { this.app.saveSettings({ webLocalOnly: true }); m.close(); } }) : null);

    let m;
    m = modal({ title: '', content: form, width: 440, className: 'login-modal' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Verbinde…';
      try {
        await this.app.saveNow();
        const acc = await this.api.login({ server: serverIn.value, username: userIn.value.trim(), password: passIn.value, register: registerMode, displayName: nameIn.value.trim() });
        await this.app.saveSettings({ lastServer: serverIn.value.trim(), lastOpen: null, recent: [], favorites: [], expanded: [] });
        m.close();
        toast(`Angemeldet als ${acc.displayName} – Notizen werden geladen…`, { type: 'success' });
        setTimeout(() => location.reload(), 600);
      } catch (ex) {
        err.textContent = ex.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        submit.disabled = false;
        submit.textContent = registerMode ? 'Konto erstellen' : 'Anmelden';
      }
    });
    if (server) probe();
    setTimeout(() => (server ? (username ? passIn : userIn) : serverIn).focus(), 50);
  }

  async logout({ silent = false } = {}) {
    if (!silent && !(await confirmDialog('Abmelden?', 'Deine Notizen bleiben auf dem Server und lokal in deinem Konto-Ordner erhalten. AleNote wechselt zurück zu den lokalen Notizen.', { okLabel: 'Abmelden', danger: false }))) return false;
    await this.app.saveNow();
    this.api.syncNow?.();
    await new Promise((r) => setTimeout(r, 400));
    await this.api.logout();
    await this.app.saveSettings({ lastOpen: null, recent: [], favorites: [], expanded: [] });
    location.reload();
    return true;
  }

  /** Gleicher Server unter neuer Adresse (z.B. Reverse-Proxy mit HTTPS) – ohne neu anzumelden */
  async changeServer() {
    if (!this.api.changeServer) return;
    const { prompt } = await import('./overlays.js');
    const input = await prompt('Neue Server-Adresse', { value: this.account.server, placeholder: 'z.B. notizen.meine-domain.de', okLabel: 'Umstellen' });
    if (!input || input.trim() === this.account.server) return;
    try {
      this.account = await this.api.changeServer(input);
      await this.app.saveSettings({ lastServer: this.account.server });
      this.render();
      toast(`Server-Adresse geändert: ${this.account.server}`, { type: 'success' });
    } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { type: 'error', duration: 6000 }); }
  }

  async switchAccount() {
    await this.app.saveNow();
    const server = this.account?.server;
    await this.api.logout();
    this.account = null;
    this.status = { state: 'off' };
    this.render();
    this.loginDialog({ server });
  }

  // ---------------- Änderungen vom Server ----------------

  async onRemoteChanges(paths) {
    await this.app.sidebar.refresh();
    const cur = this.app.currentPath;
    if (!cur) return;
    if (!this.app.sidebar.allNotes().some((n) => n.path === cur)) {
      toast('Die geöffnete Notiz wurde auf einem anderen Gerät gelöscht');
      this.app.showEmpty();
      return;
    }
    // Live: geöffnete Notiz sanft aktualisieren (Cursor bleibt, kein Neuzeichnen)
    if (paths.includes(cur) && this.app.live?.handles(cur) && (await this.app.live.reloadFromDisk(cur))) return;
    if (paths.includes(cur) && !this.app.dirty) {
      const scroll = this.app.editorScroll.scrollTop;
      const note = await this.api.readNote(cur).catch(() => null);
      if (!note || this.app.dirty) return;
      this.app.editor.load(note, cur);
      this.app.editorScroll.scrollTop = scroll;
      toast('Notiz wurde von einem anderen Gerät aktualisiert', { duration: 1800 });
    }
  }

  onConflicts(list) {
    // Kurz warten: die Live-Verbindung führt Offline-Änderungen oft gleich selbst zusammen
    this.latestConflicts = list;
    clearTimeout(this.conflictTimer);
    this.conflictTimer = setTimeout(() => this.showConflicts(this.latestConflicts || []), list.length ? 2500 : 0);
  }

  showConflicts(list) {
    const fresh = list.filter((c) => !this.shownConflicts.has(c.path));
    if (!fresh.length || document.querySelector('.conflict-modal')) return;
    const c = fresh[0];
    this.shownConflicts.add(c.path);
    const name = c.path.split('/').pop().replace(/\.alenote$/, '');
    const choose = async (close, choice) => {
      close();
      try {
        await this.app.saveNow();
        await this.api.syncResolve(c.path, choice);
        toast({ local: 'Deine Version wurde hochgeladen', remote: 'Server-Version übernommen', both: 'Beide Versionen behalten' }[choice], { type: 'success' });
        this.shownConflicts.delete(c.path);
      } catch (e) { toast('Fehler: ' + e.message, { type: 'error' }); }
    };
    modal({
      title: 'Konflikt beim Synchronisieren',
      className: 'conflict-modal',
      width: 480,
      content: h('div', {},
        h('p', { html: `<b>${name}</b> wurde hier <b>und</b> auf einem anderen Gerät geändert${c.remoteUpdated ? ` (Server: ${new Date(c.remoteUpdated).toLocaleString('de-DE')})` : ''}. Welche Version möchtest du behalten?` }),
        h('p.muted.small', { text: c.path })),
      actions: [
        { label: 'Beide behalten', run: (close) => choose(close, 'both') },
        { label: 'Server-Version', run: (close) => choose(close, 'remote') },
        { label: 'Meine Version', primary: true, run: (close) => choose(close, 'local') }
      ],
      onClose: () => setTimeout(() => this.onConflicts(list), 300)
    });
  }

  // ---------------- Einstellungen ----------------

  renderSettings(page, rerender) {
    const section = (t, d) => h('div.set-section', {}, h('h4', { text: t }), d ? h('p.muted.small', { text: d }) : null);
    if (!this.account) {
      page.append(section('Konto & Synchronisierung', 'Melde dich bei einem AleNote-Server an, um deine Notizen auf mehreren Geräten zu nutzen. Lokal bleibt alles bearbeitbar – auch offline. Jedes Konto bekommt einen eigenen Notiz-Ordner auf diesem PC.'));
      page.append(h('div.account-card.empty', {},
        h('div.account-empty-icon', {}, icon('cloudOff', 28)),
        h('div.flex', {}, h('div', { text: 'Nicht angemeldet' }), h('div.muted.small', { text: 'Notizen werden nur lokal gespeichert.' })),
        h('button.btn.btn-primary', { onclick: () => this.loginDialog() }, icon('user', 15), 'Anmelden')));
      page.append(section('Eigenen Server einrichten', 'Den Server findest du im Ordner "server" des AleNote-Projekts. Start mit: node server.js – danach in der Admin-Konsole (http://<server>:8787/admin) Benutzer anlegen.'));
      return;
    }
    const a = this.account;
    const st = STATUS[this.status.state] || STATUS.off;
    const usageEl = h('span.muted.small', { text: '…' });
    page.append(section('Konto'));
    page.append(h('div.account-card', {},
      h('div.big-avatar', { text: (a.displayName || a.username)[0].toUpperCase(), style: { background: colorFor(a.username) } }),
      h('div.flex', {},
        h('div.account-name', {}, a.displayName, a.role === 'admin' ? h('span.badge', { text: 'Admin' }) : null),
        h('div.muted.small', { text: `@${a.username} · ${a.serverName}` }),
        usageEl),
      h('div.account-actions', {},
        h('button.btn.small', { onclick: () => this.switchAccount() }, icon('user', 14), 'Konto wechseln'),
        h('button.btn.small', { onclick: () => this.logout() }, icon('x', 14), 'Abmelden'))));
    this.api.accountInfo().then((info) => {
      const u = info?.user?.usage;
      if (u) usageEl.textContent = `${u.notes} Notizen · ${(u.bytes / 1048576).toFixed(1)} MB auf dem Server${info.user.quotaMB ? ` von ${info.user.quotaMB} MB` : ''}`;
    }).catch((e) => { usageEl.textContent = e.message; });

    page.append(section('Synchronisierung'));
    page.append(
      h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Status' }), h('div.muted.small', { text: this.status.message || `Letzter Abgleich: ${ago(this.status.lastSync)}` })),
        h('div.set-control', {}, h('span.sync-chip.static.' + (st.cls || 'none'), {}, icon(st.icon, 14), h('span', { text: st.label })))),
      h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Live-Bearbeitung' }), h('div.muted.small', { text: 'Änderungen erscheinen sofort auf deinen anderen Geräten, solange du online bist. Offline wird wie gewohnt lokal gespeichert und später abgeglichen.' })),
        h('div.set-control', {}, (() => {
          const on = this.app.settings.live !== false;
          const el = h('button.switch' + (on ? '.on' : ''), { role: 'switch' });
          el.addEventListener('click', async () => { const v = !el.classList.contains('on'); el.classList.toggle('on', v); await this.app.saveSettings({ live: v }); this.app.live?.start(); });
          return el;
        })())),
      h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Server' }), h('div.muted.small', { text: (/^https:/i.test(a.server) ? '🔒 ' : '') + a.server })),
        h('div.set-control', {}, h('div.row-inline', {},
          this.api.changeServer ? h('button.btn.small', { title: 'Z.B. auf die neue HTTPS-Adresse umstellen – Anmeldung und Notizen bleiben', onclick: () => this.changeServer().then(rerender) }, icon('edit', 14), 'Adresse ändern') : null,
          h('button.btn.small', { onclick: () => { this.api.syncNow(); setTimeout(rerender, 1200); } }, icon('refresh', 14), 'Jetzt synchronisieren')))),
      h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Lokaler Ordner' }), h('div.muted.small', { text: 'Hier liegen die Notizen dieses Kontos auf deinem PC' })),
        h('div.set-control', {}, h('button.btn.small', { onclick: () => this.api.openFolder('') }, icon('folder', 14), 'Öffnen'))),
      a.role === 'admin' ? h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Admin-Konsole' }), h('div.muted.small', { text: 'Benutzer anlegen, Einstellungen, Sitzungen' })),
        h('div.set-control', {}, h('button.btn.small', { onclick: () => this.api.openExternal(a.server + '/admin/') }, icon('external', 14), 'Öffnen'))) : '');

    page.append(section('Passwort ändern'));
    const oldPw = h('input.input', { type: 'password', placeholder: 'Aktuelles Passwort' });
    const newPw = h('input.input', { type: 'password', placeholder: 'Neues Passwort (min. 6 Zeichen)' });
    page.append(h('div.pw-row', {}, oldPw, newPw, h('button.btn', {
      onclick: async () => {
        try {
          await this.api.changePassword(oldPw.value, newPw.value);
          toast('Passwort geändert', { type: 'success' });
          oldPw.value = newPw.value = '';
        } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { type: 'error' }); }
      }
    }, 'Ändern')));
  }
}
