// Seiten-Block: Verweis auf eine (Unter-)Seite mitten im Text – wie in Notion.
// Angelegt über „/Unterseite“ (legt die Seite gleich mit an). Der Pfad wird beim
// Umbenennen/Verschieben automatisch nachgezogen (siehe core/pages.js).
import { h } from '../core/utils.js';
import { icon } from '../ui/icons.js';

export default function registerPageBlock(registry) {
  registry.registerBlock({
    type: 'page', name: 'Unterseite', icon: 'files', description: 'Neue Seite innerhalb dieser Seite', keywords: ['seite', 'unterseite', 'page', 'subpage', 'doku'],
    group: 'Einfügen', slash: false, create: () => ({ path: '' }),
    render(b, ctx) {
      const note = ctx.app.sidebar.allNotes().find((n) => n.path === b.data.path);
      if (!note) {
        return h('div.page-link.missing', { contenteditable: 'false' }, icon('file', 16), h('span', { text: 'Seite nicht gefunden' }),
          h('span.muted.small', { text: (b.data.path || '').replace(/\.alenote$/, '') + ' – vielleicht im Papierkorb?' }));
      }
      const kids = note.children?.length || 0;
      return h('button.page-link', {
        contenteditable: 'false', title: 'Seite öffnen',
        onclick: () => ctx.app.openNote(note.path)
      }, note.icon ? h('span.page-link-emoji', { text: note.icon }) : icon(kids ? 'files' : 'file', 17, 'page-link-icon'),
      h('span.page-link-title', { text: note.name }),
      kids ? h('span.page-link-count', { text: `${kids} ${kids === 1 ? 'Unterseite' : 'Unterseiten'}` }) : null,
      icon('chevronRight', 15, 'page-link-arrow'));
    },
    toMarkdown: (b) => `[${(b.data.path || '').split('/').pop().replace(/\.alenote$/, '')}](${encodeURI(b.data.path || '')})`
  });
}
