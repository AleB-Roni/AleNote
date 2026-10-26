// Einfacher Event-Bus. Plugins können sich auf alle App-Ereignisse registrieren.
//
// Bekannte Ereignisse:
//   app:ready, note:open (note), note:change (note), note:save (note),
//   tree:change, settings:change (settings), theme:change (themeId)

export class EventBus {
  constructor() { this.map = new Map(); }

  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) { this.map.get(name)?.delete(fn); }

  emit(name, ...args) {
    for (const fn of this.map.get(name) || []) {
      try { fn(...args); } catch (err) { console.error(`[AleNote] Fehler im Event "${name}"`, err); }
    }
  }
}
