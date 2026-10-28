// KI-Einstellungen mit dem Konto synchronisieren: API-Schlüssel, Modelle, Server-Adressen,
// Standard-Anbieter, Diktier-Einstellungen und eigene Prompts.
// Gespeichert werden sie auf dem eigenen AleNote-Server (getrennt von den Notizen, nicht im
// Versionsverlauf). Bei Änderungen bekommen die anderen Geräte über die Live-Verbindung Bescheid.
// Ohne Anmeldung (oder ausgeschaltet) bleibt alles wie bisher nur auf dem Gerät.

const SYNC_KEYS = ['providers', 'defaultProvider', 'dictate', 'actions'];

export class AISync {
  constructor(app, ai) {
    this.app = app;
    this.ai = ai;
    this.applying = false;
    this.timer = null;
  }

  get cfg() { return this.ai.cfg; }
  get enabled() { return this.cfg.syncAccount !== false; }

  async creds() {
    if (!this.enabled || !this.app.api.liveCredentials) return null;
    const c = await this.app.api.liveCredentials().catch(() => null);
    return c?.token ? c : null;
  }

  async request(method, json) {
    const c = await this.creds();
    if (!c) return null;
    const res = await fetch(c.server + '/api/me/ai', {
      method,
      headers: { Authorization: 'Bearer ' + c.token, 'X-AleNote-Client': this.app.live?.client || '', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(15e3)
    });
    if (res.status === 404) throw new Error('Der Server ist zu alt für KI-Einstellungen im Konto (bitte Server aktualisieren)');
    if (!res.ok) throw new Error('Fehler ' + res.status);
    return res.json();
  }

  pick() {
    const out = {};
    for (const k of SYNC_KEYS) if (this.cfg[k] !== undefined) out[k] = structuredClone(this.cfg[k]);
    return out;
  }

  hasLocal() { return Object.values(this.cfg.providers || {}).some((p) => p?.apiKey || p?.baseUrl || p?.model); }

  /** Stand vom Server holen; neuer als der lokale → übernehmen. Gibt es noch nichts → hochladen. */
  async pull() {
    try {
      const remote = await this.request('GET');
      if (!remote) return false;
      const local = this.cfg.syncUpdated || 0;
      if (remote.config && remote.updated > local) {
        const first = !local && this.hasLocal(); // erstes Mal auf einem Gerät, das schon Schlüssel hat
        this.applying = true;
        try {
          for (const k of SYNC_KEYS) {
            if (remote.config[k] === undefined) continue;
            if (first && k === 'providers') {
              // Zusammenführen: was das Gerät schon hat, bleibt – der Server ergänzt bzw. überschreibt nur ausgefüllte Felder
              const merged = structuredClone(this.cfg.providers || {});
              for (const [id, rp] of Object.entries(remote.config.providers || {})) {
                merged[id] = { ...(merged[id] || {}) };
                for (const [f, v] of Object.entries(rp || {})) if (v) merged[id][f] = v;
              }
              this.cfg.providers = merged;
            } else if (!(first && k === 'defaultProvider')) {
              this.cfg[k] = remote.config[k];
            }
          }
          this.cfg.syncUpdated = first ? Date.now() : remote.updated;
          this.ai.save();
        } finally { this.applying = false; }
        if (first) await this.push(); // zusammengeführten Stand für die anderen Geräte hochladen
        this.app.events.emit('ai:config');
        return true;
      }
      if ((!remote.config && this.hasLocal()) || (remote.config && local > remote.updated)) await this.push();
    } catch (err) { console.warn('[KI-Sync]', err.message); this.lastError = err.message; }
    return false;
  }

  /** Vor dem Speichern einer lokalen Änderung: Zeitstempel setzen (neuere Fassung gewinnt) */
  touch() { if (!this.applying) this.cfg.syncUpdated = Date.now(); }

  /** Nach einer Änderung (gebündelt) hochladen */
  schedulePush() {
    if (this.applying || !this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push().catch((err) => { console.warn('[KI-Sync]', err.message); this.lastError = err.message; }), 800);
  }

  async push() {
    if (!this.cfg.syncUpdated) { this.cfg.syncUpdated = Date.now(); this.app.saveSettings({ ai: this.cfg }); }
    const updated = this.cfg.syncUpdated;
    const res = await this.request('PUT', { config: this.pick(), updated });
    if (res) { this.lastError = null; this.lastPush = Date.now(); }
    return res;
  }
}
