// Papierkorb-Fenster: gelöschte Notizen/Ordner ansehen, wiederherstellen oder endgültig löschen
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { modal, toast, confirmDialog } from './overlays.js';
import { listTrash, restoreFromTrash, deleteForever, emptyTrash, KEEP_DAYS } from '../core/trash.js';

const when = (t) => {
  const d = new Date(t);
  const days = Math.floor((Date.now() - t) / 864e5);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (days < 1 && d.getDate() === new Date().getDate()) return `heute, ${time}`;
  if (days < 2) return `gestern, ${time}`;
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
};
const daysLeft = (t) => Math.max(0, Math.ceil((t - Date.now()) / 864e5));

export async function openTrash(app) {
  const api = app.api;
  const list = h('div.trash-list');
  const filter = h('input.input.trash-filter', { placeholder: 'Im Papierkorb suchen …', spellcheck: 'false' });
  const emptyBtn = h('button.btn.small.btn-danger', {}, icon('trash', 14), 'Papierkorb leeren');
  let items = [];

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = items.filter((x) => !x.empty && (!q || x.name.toLowerCase().includes(q) || x.from.toLowerCase().includes(q)));
    list.innerHTML = '';
    emptyBtn.disabled = !items.some((x) => !x.empty);
    if (!shown.length) {
      list.append(h('div.trash-empty', {}, h('div.trash-empty-icon', {}, icon('trash', 30)),
        h('div', { text: q ? 'Nichts gefunden' : 'Der Papierkorb ist leer' }),
        h('div.muted.small', { text: `Gelöschte Notizen und Ordner bleiben hier ${KEEP_DAYS} Tage, dann werden sie automatisch entfernt.` })));
      return;
    }
    for (const it of shown) {
      const left = daysLeft(it.expiresAt);
      const row = h('div.trash-item',
        {},
        h('span.trash-icon', {}, it.type === 'folder' ? icon('folder', 18) : it.icon ? it.icon : icon('file', 18)),
        h('div.trash-info', {},
          h('div.trash-name', { text: it.name }),
          h('div.trash-meta.muted.small', {
            text: [
              it.type === 'folder' ? `Ordner · ${it.count} ${it.count === 1 ? 'Notiz' : 'Notizen'}` : null,
              `aus ${it.from ? '„' + it.from + '“' : 'Hauptebene'}`,
              `gelöscht ${when(it.deletedAt)}`
            ].filter(Boolean).join(' · ')
          })),
        h('span.trash-left' + (left <= 3 ? '.soon' : ''), { text: left <= 0 ? 'läuft ab' : `noch ${left} ${left === 1 ? 'Tag' : 'Tage'}`, title: 'Danach wird der Eintrag automatisch endgültig gelöscht' }),
        h('button.btn.small', { title: 'An den ursprünglichen Ort zurücklegen', onclick: async () => {
          try {
            const p = await restoreFromTrash(api, it);
            await app.sidebar.refresh();
            toast(`„${it.name}“ wiederhergestellt`, { type: 'success', action: it.type === 'note' ? { label: 'Öffnen', run: () => { m.close(); app.openNote(p); } } : undefined });
            await load();
          } catch (err) { toast('Wiederherstellen fehlgeschlagen: ' + err.message, { type: 'error' }); }
        } }, icon('undo', 14), 'Wiederherstellen'),
        h('button.icon-btn.danger-hover', { title: 'Endgültig löschen', onclick: async () => {
          if (!(await confirmDialog('Endgültig löschen?', `„${it.name}“ wird endgültig gelöscht – auch auf allen anderen Geräten. Das lässt sich nicht rückgängig machen.`, { okLabel: 'Endgültig löschen' }))) return;
          await deleteForever(api, it);
          await load();
        } }, icon('trash', 15)));
      list.append(row);
    }
  };

  const load = async () => {
    items = await listTrash(api);
    render();
    app.sidebar.updateTrashBadge?.(items.filter((x) => !x.empty).length);
  };

  emptyBtn.addEventListener('click', async () => {
    const n = items.filter((x) => !x.empty).length;
    if (!(await confirmDialog('Papierkorb leeren?', `${n} ${n === 1 ? 'Eintrag wird' : 'Einträge werden'} endgültig gelöscht – auch auf allen anderen Geräten.`, { okLabel: 'Leeren' }))) return;
    await emptyTrash(api);
    await load();
  });
  filter.addEventListener('input', render);

  const content = h('div.trash', {},
    h('div.trash-head', {}, filter, emptyBtn),
    list,
    h('p.muted.small.trash-hint', { text: `Einträge werden nach ${KEEP_DAYS} Tagen automatisch gelöscht. Der Papierkorb wird mit deinem Konto synchronisiert – Wiederherstellen geht auch auf anderen Geräten.` }));
  const m = modal({ title: 'Papierkorb', content, width: 'min(680px, 94vw)', className: 'trash-modal' });
  list.append(h('div.muted.small', { text: 'Lade …' }));
  await load();
  setTimeout(() => filter.focus(), 50);
  return m;
}
