// Update-Anzeige: Hinweis in der oberen Leiste + Bereich in Einstellungen → Über
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { toast, modal } from './overlays.js';

const LABELS = {
  unsupported: 'Automatische Updates nur in der installierten Version',
  idle: 'Noch nicht geprüft',
  checking: 'Suche nach Updates…',
  latest: 'AleNote ist aktuell',
  downloading: 'Update wird heruntergeladen…',
  ready: 'Update bereit zur Installation',
  error: 'Update-Prüfung fehlgeschlagen'
};

export class UpdateUI {
  constructor(app) {
    this.app = app;
    this.api = app.api;
    this.status = { state: 'idle' };
    this.version = '';
    this.chip = h('button.update-chip.hidden', { onclick: () => this.onChip() });
    app.addStatusItem('update', this.chip);
  }

  async init() {
    if (!this.api.updateStatus) return;
    this.version = await this.api.appVersion();
    this.status = await this.api.updateStatus();
    this.render();
    this.api.on('update:status', (s) => {
      const wasReady = this.status.state === 'ready';
      this.status = s;
      this.render();
      if (s.state === 'ready' && !wasReady) this.announce();
    });
  }

  render() {
    const s = this.status;
    const show = s.state === 'downloading' || s.state === 'ready';
    this.chip.classList.toggle('hidden', !show);
    this.chip.classList.toggle('ready', s.state === 'ready');
    this.chip.innerHTML = '';
    if (s.state === 'downloading') {
      this.chip.append(icon('download', 14), h('span', { text: `Update ${s.available} · ${s.percent || 0}%` }));
      this.chip.title = 'Update wird im Hintergrund heruntergeladen';
    } else if (s.state === 'ready') {
      this.chip.append(icon('refresh', 14), h('span', { text: `Update ${s.available} installieren` }));
      this.chip.title = 'Klicken, um AleNote neu zu starten und zu aktualisieren';
    }
  }

  announce() {
    toast(`AleNote ${this.status.available} ist bereit – oben rechts auf "installieren" klicken`, { type: 'success', duration: 6000 });
  }

  async onChip() {
    if (this.status.state !== 'ready') return;
    modal({
      title: `Update auf Version ${this.status.available}`,
      width: 420,
      content: h('p.muted', { text: this.status.platform === 'android'
        ? `Das Update wird heruntergeladen. Danach fragt Android, ob AleNote aktualisiert werden soll – deine Notizen bleiben erhalten. (Aktuell: ${this.version})`
        : `AleNote wird kurz geschlossen, aktualisiert und danach automatisch neu gestartet. Deine Notizen werden vorher gespeichert. (Aktuell: ${this.version})` }),
      actions: [
        { label: 'Später', value: null },
        { label: this.status.platform === 'android' ? 'Jetzt aktualisieren' : 'Jetzt neu starten', primary: true, run: async (close) => {
          close();
          await this.app.saveNow();
          try { await this.api.installUpdate(); } catch (e) { toast('Update fehlgeschlagen: ' + e.message, { type: 'error', duration: 5000 }); }
        } }
      ]
    });
  }

  /** Bereich in Einstellungen → Über */
  renderSettings(page, rerender) {
    const s = this.status;
    const section = (t, d) => h('div.set-section', {}, h('h4', { text: t }), d ? h('p.muted.small', { text: d }) : null);
    page.append(section('Updates', s.source ? `Quelle: ${s.source}` : 'Angemeldet: Updates kommen von deinem AleNote-Server, sonst von GitHub.'));
    const label = s.state === 'error' ? `${LABELS.error}: ${s.error || ''}` : s.state === 'downloading' ? `Version ${s.available} wird heruntergeladen (${s.percent || 0}%)` : s.state === 'ready' ? `Version ${s.available} ist bereit` : LABELS[s.state] || '';
    const actions = h('div.set-control');
    if (s.state === 'ready') actions.append(h('button.btn.btn-primary.small', { onclick: () => this.onChip() }, icon('refresh', 14), 'Jetzt installieren'));
    else if (s.state !== 'unsupported') actions.append(h('button.btn.small', {
      disabled: s.state === 'checking' || s.state === 'downloading',
      onclick: async () => { await this.api.checkUpdate(); setTimeout(rerender, 300); setTimeout(rerender, 2500); }
    }, icon('refresh', 14), 'Nach Updates suchen'));
    page.append(
      h('div.set-row', {}, h('div.set-label', {}, h('div', { text: `Version ${this.version || '–'}` }), h('div.muted.small', { text: label })), actions),
      h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Automatisch nach Updates suchen' }), h('div.muted.small', { text: 'Beim Start und alle 4 Stunden. Installiert wird erst nach deiner Bestätigung oder beim Beenden.' })),
        h('div.set-control', {}, (() => {
          const on = this.app.settings.autoUpdate !== false;
          const sw = h('button.switch' + (on ? '.on' : ''));
          sw.addEventListener('click', () => { const v = !sw.classList.contains('on'); sw.classList.toggle('on', v); this.app.saveSettings({ autoUpdate: v }); });
          return sw;
        })())));
  }
}
