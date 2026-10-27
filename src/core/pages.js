// Unterseiten (wie in Notion): Seiten können weitere Seiten enthalten.
//
// Ablage im Vault – ganz normale Dateien und Ordner, damit Sync, Papierkorb und Verlauf
// unverändert funktionieren:
//   Projekt.alenote          ← die Seite
//   Projekt/                 ← ihre Unterseiten
//     Planung.alenote
//     Planung/Termine.alenote
// Ein Ordner, der genauso heißt wie eine Seite daneben, gehört also zu dieser Seite.

export const NOTE_EXT = '.alenote';
export const childFolder = (notePath) => notePath.slice(0, -NOTE_EXT.length);
export const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const isNotePath = (p) => p.endsWith(NOTE_EXT);

/**
 * Baut aus dem Dateibaum den Seitenbaum: Ordner, die zu einer Seite gehören, werden zu deren
 * Unterseiten (note.children, note.sub = Ordnerpfad). Alle anderen Ordner bleiben Ordner.
 */
export function pageTree(nodes) {
  const notes = new Map(nodes.filter((n) => n.type === 'note').map((n) => [childFolder(n.path), n]));
  const out = [];
  for (const n of nodes) {
    if (n.type === 'folder') {
      const owner = notes.get(n.path);
      const children = pageTree(n.children || []);
      if (owner) { owner.children = children; owner.sub = n.path; continue; }
      out.push({ ...n, children });
    } else {
      out.push(n);
    }
  }
  return out;
}

/** Seite, zu der ein Pfad gehört (Elternseite) – oder null */
export function parentPage(path, allNotes) {
  const folder = parentOf(path);
  if (!folder) return null;
  return allNotes.find((n) => n.path === folder + NOTE_EXT) || null;
}

/** Kette der Elternseiten von oben nach unten (für die Brotkrumen) */
export function ancestors(path, allNotes) {
  const chain = [];
  let p = parentPage(path, allNotes);
  while (p) { chain.unshift(p); p = parentPage(p.path, allNotes); }
  return chain;
}

/** Pfad nach Umbenennen/Verschieben von „from“ zu „to“ (gilt auch für alles darunter) */
export function remap(p, from, to) {
  if (p === from) return to;
  const f = isNotePath(from) ? childFolder(from) : from, t = isNotePath(to) ? childFolder(to) : to;
  return p.startsWith(f + '/') ? t + p.slice(f.length) : p;
}

/** Seiten-Blöcke (Verweise auf Unterseiten) in allen Notizen nachziehen */
export async function remapPageLinks(app, from, to) {
  const api = app.api;
  const fix = (note) => {
    let changed = false;
    for (const b of [...(note.blocks || []), ...(note.floats || []).filter((f) => f.block).map((f) => f.block)]) {
      if (b?.type !== 'page' || !b.data?.path) continue;
      const np = remap(b.data.path, from, to);
      if (np !== b.data.path) { b.data.path = np; changed = true; }
    }
    return changed;
  };
  // Die geöffnete Seite direkt im Editor ändern
  if (app.editor?.note && fix(app.editor.note)) { app.editor.renderAll(); app.editor.changed(true); }
  // Alle anderen Dateien (die Liste stammt noch von vor dem Umbenennen → Pfade umrechnen)
  for (const n of app.sidebar.allNotes()) {
    const path = remap(n.path, from, to);
    if (path === app.currentPath) continue;
    try {
      const data = await api.readNote(path);
      if (fix(data)) await api.writeNote(path, data);
    } catch {}
  }
}
