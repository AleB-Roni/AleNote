// Automatische Updates
//
// Angemeldet:      Updates kommen von deinem AleNote-Server  (<server>/updates/latest.yml)
// Nicht angemeldet: Updates kommen direkt aus den GitHub-Releases
//
// Funktioniert nur in der installierten Version (Setup), nicht in der portablen EXE
// und nicht im Entwicklungsmodus (npm start).

const { app } = require('electron');

const GITHUB = { provider: 'github', owner: 'AleB-Roni', repo: 'AleNote' };

class Updater {
  constructor({ getAccount, getSettings, notify }) {
    this.getAccount = getAccount;
    this.getSettings = getSettings;
    this.notify = notify;
    this.status = { state: 'idle', version: app.getVersion() };
    this.updater = null;
    this.timer = null;
    // Portable EXE und Entwicklungsmodus können sich nicht selbst aktualisieren
    this.supported = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE && process.platform === 'win32';
    if (!this.supported) this.status.state = 'unsupported';
  }

  set(patch) {
    this.status = { ...this.status, ...patch };
    this.notify('update:status', this.status);
  }

  source() {
    const acc = this.getAccount();
    return acc ? { provider: 'generic', url: acc.server + '/updates', label: acc.serverName || acc.server } : { ...GITHUB, label: 'GitHub' };
  }

  init() {
    if (!this.supported) return;
    const { autoUpdater } = require('electron-updater');
    this.updater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: '' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'latest', lastCheck: Date.now() }));
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', available: info.version, notes: info.releaseNotes || '', percent: 0, lastCheck: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', available: info.version, percent: 100 }));
    autoUpdater.on('error', (err) => this.set({ state: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 200), lastCheck: Date.now() }));

    setTimeout(() => this.check(), 15e3);
    this.timer = setInterval(() => this.check(), 4 * 3600e3);
  }

  async check() {
    if (!this.supported) return this.status;
    if (this.getSettings().autoUpdate === false) return this.status;
    if (['checking', 'downloading', 'ready'].includes(this.status.state)) return this.status;
    const src = this.source();
    try {
      const { label, ...feed } = src;
      this.updater.setFeedURL(feed);
      this.set({ source: label });
      await this.updater.checkForUpdates();
    } catch (err) {
      this.set({ state: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 200) });
    }
    return this.status;
  }

  install() {
    if (this.status.state === 'ready') this.updater.quitAndInstall(false, true);
  }
}

module.exports = { Updater };
