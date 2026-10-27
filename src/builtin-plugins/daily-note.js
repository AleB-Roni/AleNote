// Tagesnotiz: öffnet (oder erstellt) die Notiz für heute im Ordner "Tagebuch"
export default {
  id: 'daily-note',
  name: 'Tagesnotiz',
  description: 'Eine Notiz pro Tag mit Vorlage (Strg+Alt+N)',
  activate(app) {
    app.registerCommand({
      id: 'daily.open', name: 'Tagesnotiz öffnen', icon: 'calendar', group: 'Notizen', shortcut: 'Ctrl+Alt+N',
      run: async () => {
        // Gemeinsame Logik mit dem Kalender (Vorlage „Tagesnotiz“ aus dem Vorlagen-Ordner)
        const { openDailyNote } = await import('../core/templates.js');
        return openDailyNote(app.app, new Date());
      }
    });
  }
};
