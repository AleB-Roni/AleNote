// Tagesnotiz: öffnet (oder erstellt) die Notiz für heute im Ordner "Tagebuch"
export default {
  id: 'daily-note',
  name: 'Tagesnotiz',
  description: 'Eine Notiz pro Tag mit Vorlage (Strg+Alt+N)',
  activate(app) {
    app.registerCommand({
      id: 'daily.open', name: 'Tagesnotiz öffnen', icon: 'calendar', group: 'Notizen', shortcut: 'Ctrl+Alt+N',
      run: async () => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const folder = (app.getData().folder || 'Tagebuch');
        const path = `${folder}/${name}.alenote`;
        const exists = app.app.sidebar.allNotes().some((n) => n.path === path);
        if (exists) return app.openNote(path);
        const id = () => Math.random().toString(36).slice(2, 10);
        const weekday = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const data = {
          version: 1, created: Date.now(), icon: '📅', cover: { type: 'gradient', value: 'sunset' }, floats: [],
          blocks: [
            { id: id(), type: 'callout', data: { text: `<b>${weekday}</b>`, icon: '☀️', tone: 'yellow' } },
            { id: id(), type: 'h2', data: { text: 'Ziele für heute' } },
            { id: id(), type: 'todo', data: { text: '', checked: false } },
            { id: id(), type: 'h2', data: { text: 'Notizen' } },
            { id: id(), type: 'paragraph', data: { text: '' } }
          ]
        };
        const p = await app.api.createNote(folder, name, data);
        await app.app.sidebar.refresh();
        app.openNote(p);
      }
    });
  }
};
