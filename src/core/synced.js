// Einstellungen, die mit dem Konto auf alle Geräte synchronisiert werden (z.B. Kalender-Abos).
// Sie liegen als Datei im Vault-Ordner „_config“ (in der Seitenleiste ausgeblendet) und
// werden wie Notizen abgeglichen.
const FILE = '_config/settings.alenote';

export async function readSynced(api) {
  try { return (await api.readNote(FILE)) || {}; } catch { return {}; }
}

export async function writeSynced(api, patch) {
  const cur = await readSynced(api);
  const next = { ...cur, ...patch, updated: Date.now() };
  await api.ensureFolder('_config');
  await api.writeNote(FILE, next);
  return next;
}
