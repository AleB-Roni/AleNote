// Papierkorb: Gelöschte Notizen und Ordner werden 30 Tage aufbewahrt.
//
// Sie landen im Vault-Ordner "_trash" (in der Seitenleiste ausgeblendet). Weil das ein normaler
// Ordner ist, wird er wie alle Notizen synchronisiert: Auf dem PC Gelöschtes lässt sich auch
// auf dem Handy oder im Browser wiederherstellen.
//
// Aufbau:  _trash/<Löschzeit>~<ursprünglicher Ordner, base64url>/<Notiz oder Ordner>

export const TRASH_DIR = '_trash';
export const KEEP_DAYS = 30;

const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => { try { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); } catch { return ''; } };
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/** Notiz oder Ordner in den Papierkorb verschieben. Gibt den Pfad im Papierkorb zurück. */
export async function moveToTrash(api, path) {
  const holder = `${TRASH_DIR}/${Date.now()}~${b64(parentOf(path))}`;
  await api.ensureFolder(holder);
  return api.move(path, holder);
}

/** Alle Einträge im Papierkorb, neueste zuerst */
export async function listTrash(api) {
  let nodes = [];
  try { nodes = await api.tree({ trash: true }); } catch { return []; }
  const items = [];
  for (const holder of nodes) {
    if (holder.type !== 'folder') continue;
    const m = holder.name.match(/^(\d+)~(.*)$/);
    if (!m) continue;
    const deletedAt = Number(m[1]);
    const from = unb64(m[2]);
    for (const n of holder.children || []) {
      const count = n.type === 'folder' ? countNotes(n) : 1;
      items.push({
        holder: holder.path, path: n.path, type: n.type, icon: n.icon || '', name: n.name, count, from, deletedAt,
        expiresAt: deletedAt + KEEP_DAYS * 864e5
      });
    }
    // Leere Hülle (z.B. nach dem Wiederherstellen auf einem anderen Gerät)
    if (!holder.children?.length) items.push({ holder: holder.path, empty: true, deletedAt });
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

const countNotes = (n) => (n.type === 'note' ? 1 : (n.children || []).reduce((s, c) => s + countNotes(c), 0));

/** Wiederherstellen an den ursprünglichen Ort (fehlende Ordner werden angelegt) */
export async function restoreFromTrash(api, item) {
  if (item.from) await api.ensureFolder(item.from);
  const restored = await api.move(item.path, item.from);
  await api.remove(item.holder).catch(() => {});
  return restored;
}

/** Endgültig löschen */
export async function deleteForever(api, item) {
  await api.remove(item.holder);
}

/** Abgelaufene Einträge (älter als 30 Tage) entfernen. Gibt die Anzahl zurück. */
export async function purgeExpired(api) {
  const now = Date.now();
  let n = 0;
  for (const item of await listTrash(api)) {
    if (item.empty || item.expiresAt <= now) {
      await api.remove(item.holder).catch(() => {});
      if (!item.empty) n++;
    }
  }
  return n;
}

export async function emptyTrash(api) {
  await api.remove(TRASH_DIR).catch(() => {});
}

export const trashLabel = { parentOf, nameOf };
