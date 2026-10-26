// Exportiert die aktuelle Notiz als Markdown-Datei oder in die Zwischenablage
export function noteToMarkdown(app) {
  const note = app.note;
  const lines = [`# ${note.icon ? note.icon + ' ' : ''}${app.editor.title}`, ''];
  let prevList = false;
  for (const b of note.blocks) {
    const def = app.registry.blocks.get(b.type);
    const md = def?.toMarkdown ? def.toMarkdown(b, app) : (b.data.text ? app.ui.htmlToMarkdown(b.data.text) : '');
    const isList = ['bullet', 'numbered', 'todo'].includes(b.type);
    if (!(isList && prevList)) lines.push('');
    lines.push(md);
    prevList = isList;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export default {
  id: 'markdown-export',
  name: 'Markdown-Export',
  description: 'Notizen als .md speichern oder kopieren',
  activate(app) {
    app.registerCommand({
      id: 'md.export', name: 'Als Markdown exportieren', icon: 'download', group: 'Export', shortcut: 'Ctrl+Shift+E', noteMenu: true,
      when: () => !!app.note,
      run: async () => {
        const file = await app.api.saveTextFile(app.editor.title + '.md', noteToMarkdown(app));
        if (file) app.toast('Exportiert: ' + file, { type: 'success' });
      }
    });
    app.registerCommand({
      id: 'md.copy', name: 'Als Markdown kopieren', icon: 'copy', group: 'Export', noteMenu: true,
      when: () => !!app.note,
      run: async () => { await navigator.clipboard.writeText(noteToMarkdown(app)); app.toast('Markdown kopiert', { type: 'success' }); }
    });
  }
};
