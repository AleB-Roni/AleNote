// Plugin-System
//
// Ein Plugin ist ein ES-Modul mit einem Default-Export:
//
//   export default {
//     id: 'mein-plugin',
//     name: 'Mein Plugin',
//     description: 'Was es tut',
//     activate(app) { ... },     // app = öffentliche AleNote-API (siehe app.js → createPluginApi)
//     deactivate(app) { ... }    // optional
//   };
//
// Eingebaute Plugins liegen in src/builtin-plugins/ (Liste in src/builtin-plugins/index.js).
// Eigene Plugins kommen in den Vault-Ordner:  <Vault>/.alenote/plugins/<name>/plugin.js

import { api } from './api.js';
import { builtinPlugins } from '../builtin-plugins/index.js';

export class PluginManager {
  constructor(app) {
    this.app = app;
    this.loaded = []; // { id, name, description, source: 'builtin'|'vault', enabled, error }
  }

  isDisabled(id) {
    return (this.app.settings.disabledPlugins || []).includes(id);
  }

  async activate(mod, source) {
    const plugin = mod.default || mod;
    const info = { id: plugin.id, name: plugin.name || plugin.id, description: plugin.description || '', source, enabled: !this.isDisabled(plugin.id) };
    this.loaded.push(info);
    if (!info.enabled) return;
    try {
      await plugin.activate?.(this.app.pluginApi(plugin.id));
    } catch (err) {
      info.error = String(err?.message || err);
      console.error(`[AleNote] Plugin "${info.id}" konnte nicht gestartet werden`, err);
    }
  }

  async loadAll() {
    for (const mod of builtinPlugins) await this.activate(mod, 'builtin');
    let list = [];
    try { list = await api.listPlugins(); } catch {}
    for (const p of list) {
      try {
        const mod = await import(p.url + '?t=' + Date.now());
        const plugin = mod.default || mod;
        if (!plugin.id) plugin.id = p.id;
        await this.activate(mod, 'vault');
      } catch (err) {
        this.loaded.push({ id: p.id, name: p.id, source: 'vault', enabled: false, error: String(err?.message || err) });
        console.error(`[AleNote] Plugin "${p.id}" konnte nicht geladen werden`, err);
      }
    }
  }
}
