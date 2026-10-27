// Inhalt der Willkommens-Notiz beim ersten Start
const id = () => Math.random().toString(36).slice(2, 10);
const b = (type, data = {}, extra = {}) => ({ id: id(), type, data, ...extra });

export function welcomeNote() {
  return {
    version: 1,
    created: Date.now(),
    icon: '👋',
    cover: { type: 'gradient', value: 'mesh' },
    floats: [],
    blocks: [
      b('callout', { text: '<b>Willkommen bei AleNote!</b> Deine moderne Notiz-App. Diese Seite zeigt dir die wichtigsten Funktionen – probier einfach alles aus.', icon: '✨', tone: 'purple' }),
      b('toc'),
      b('h1', { text: 'Schnellstart' }),
      b('paragraph', { text: 'Tippe <code>/</code> in einer leeren Zeile, um das Befehlsmenü zu öffnen: Tabellen, To-dos, Bilder, Code, Hinweisboxen und mehr.' }),
      b('todo', { text: 'Tippe <code>/tabelle</code> und drücke Enter', checked: false }),
      b('todo', { text: 'Ziehe einen Block am <b>⋮⋮</b>-Griff an eine andere Stelle', checked: false }),
      b('todo', { text: 'Drücke <b>Strg + Shift + D</b>, um das heutige Datum einzufügen', checked: false }),
      b('todo', { text: 'Diese Notiz öffnen ✔', checked: true }),
      b('h2', { text: 'Eigene Hotkeys' }),
      b('paragraph', { text: 'Unter <b>Einstellungen → Hotkeys</b> kannst du eigene Tastenkürzel anlegen – z.B. für Datum, Uhrzeit, Textbausteine oder Blöcke. Platzhalter wie <code>{datum}</code>, <code>{zeit}</code>, <code>{wochentag}</code> oder <code>{datum:DD. MMMM YYYY}</code> werden automatisch ersetzt. Deine Hotkeys erscheinen auch in der Befehlspalette (<b>Strg + P</b>) und im <code>/</code>-Menü.' }),
      b('h2', { text: 'Markdown-Kürzel' }),
      b('table', { header: true, rows: [
        ['Eingabe', 'Ergebnis'],
        ['<code>#</code> + Leertaste', 'Überschrift (## und ### für kleinere)'],
        ['<code>-</code> + Leertaste', 'Aufzählung'],
        ['<code>1.</code> + Leertaste', 'Nummerierte Liste'],
        ['<code>[]</code> + Leertaste', 'To-do'],
        ['<code>&gt;</code> + Leertaste', 'Zitat'],
        ['<code>```</code>', 'Codeblock'],
        ['<code>---</code>', 'Trennlinie']
      ] }),
      b('h2', { text: 'Bilder' }),
      b('bullet', { text: 'Bilder per <b>Drag & Drop</b> oder <b>Strg + V</b> einfügen' }),
      b('bullet', { text: 'Mit <b>Shift</b> beim Ablegen werden Bilder <b>frei beweglich</b> – verschieben, drehen und skalieren wie auf einem Whiteboard' }),
      b('bullet', { text: 'Bei Bildblöcken: Button <i>„Frei bewegen“</i> löst das Bild aus dem Text' }),
      b('h2', { text: 'Organisation' }),
      b('numbered', { text: 'Ordner und Unterordner in der Seitenleiste anlegen' }),
      b('numbered', { text: 'Notizen per Drag & Drop in Ordner verschieben' }),
      b('numbered', { text: 'Rechtsklick für alle Optionen, ★ für Favoriten' }),
      b('toggle', { text: 'Für Entwickler: AleNote erweitern', body: 'Alles in AleNote ist ein Plugin oder eine Registrierung: Blöcke, Befehle, Themes, Seitenleisten-Bereiche und Platzhalter. Eigene Plugins kommen nach <code>&lt;Vault&gt;/.alenote/plugins/</code>. Beispiele findest du in <code>src/builtin-plugins/</code> und in der README.', open: false }),
      b('progress', { value: 75, label: 'AleNote kennenlernen' }),
      b('quote', { text: 'Die beste Notiz ist die, die du auch wiederfindest.' }),
      b('paragraph', { text: '' })
    ]
  };
}
