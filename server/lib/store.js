// Einfache, sichere JSON-Dateispeicherung (atomar schreiben, Schreibzugriffe nacheinander)
const fs = require('fs/promises');
const path = require('path');

class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch { this.data = structuredClone(this.defaults); }
    return this.data;
  }

  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }
}

/** Führt Funktionen pro Schlüssel nacheinander aus (z.B. pro Benutzer-Vault) */
class KeyedLock {
  constructor() { this.locks = new Map(); }
  run(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next.catch(() => {}));
    return next;
  }
}

module.exports = { JsonFile, KeyedLock };
