// Übersicht der Unterseiten unten auf jeder Seite – so lässt sich eine Doku wie in
// Notion durchklicken. Dazu „＋ Unterseite“ zum Anlegen.
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { emojiNode } from '../core/emoji.js';

export function initSubpages(app) {
  const render = () => {
    const el = app.editor?.subpagesEl;
    if (!el?.isConnected || !app.currentPath) return;
    const note = app.sidebar.allNotes().find((n) => n.path === app.currentPath);
    const kids = note?.children || [];
    el.innerHTML = '';
    el.classList.toggle('has-kids', kids.length > 0);
    const add = h('button.subpage-add', { title: 'Neue Seite innerhalb dieser Seite', onclick: () => app.createSubpage(app.currentPath) }, icon('plus', 14), 'Unterseite');
    if (!kids.length) { el.append(add); return; }
    el.append(h('div.subpages-head', {}, icon('files', 14), h('span', { text: `Unterseiten · ${kids.length}` }), h('div.flex'), add));
    const grid = h('div.subpages-grid');
    for (const k of kids) {
      if (k.type === 'folder') {
        grid.append(h('div.subpage-card.folder', { title: 'Ordner – in der Seitenleiste öffnen' }, icon('folder', 16), h('span.subpage-name', { text: k.name }), h('span.subpage-meta', { text: `${k.children?.length || 0}` })));
        continue;
      }
      const n = k.children?.length || 0;
      grid.append(h('button.subpage-card', { onclick: () => app.openNote(k.path), title: k.name },
        k.icon ? h('span.subpage-emoji', {}, emojiNode(k.icon)) : icon(n ? 'files' : 'file', 16),
        h('span.subpage-name', { text: k.name }),
        n ? h('span.subpage-meta', { text: String(n) }) : null));
    }
    el.append(grid);
  };
  // Seiten-Blöcke zeigen Titel/Symbol der Unterseite – nach Änderungen im Baum neu zeichnen
  const refreshLinks = () => {
    for (const b of app.editor?.note?.blocks || []) if (b.type === 'page') app.editor.rerenderBlock(b.id);
  };
  app.events.on('editor:render', render);
  app.events.on('tree:change', () => { render(); refreshLinks(); });
  return render;
}
