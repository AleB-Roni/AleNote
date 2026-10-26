// Zentrale Registry – hier wird alles registriert, was AleNote kann.
// Neue Features (eingebaut oder als Plugin) melden sich hier an:
//
//   registerBlock(def)         neuer Blocktyp (Text, Tabelle, Bild, ...)
//   registerSlashCommand(def)  zusätzlicher Eintrag im "/"-Menü
//   registerCommand(def)       Befehl für Befehlspalette + Tastenkürzel
//   registerTheme(def)         Farbschema
//   registerSidebarPanel(def)  Bereich in der Seitenleiste
//   registerVariable(def)      Platzhalter für eigene Hotkeys, z.B. {datum}

export class Registry {
  constructor(events) {
    this.events = events;
    this.blocks = new Map();
    this.slashCommands = new Map();
    this.commands = new Map();
    this.themes = new Map();
    this.sidebarPanels = new Map();
    this.variables = new Map();
  }

  /**
   * Blocktyp registrieren.
   * @param {object} def
   *  type        eindeutige ID, z.B. "paragraph"
   *  name        Anzeigename
   *  icon        Icon-Name (siehe ui/icons.js) oder Emoji
   *  description Kurzbeschreibung im "/"-Menü
   *  keywords    zusätzliche Suchbegriffe
   *  group       Gruppe im "/"-Menü
   *  text        true = Block hat Fließtext (Enter/Backspace/Pfeiltasten, Markdown-Kürzel)
   *  continues   true = Enter erzeugt wieder denselben Typ (z.B. Listen)
   *  create()    liefert die Standarddaten
   *  render(block, ctx) liefert ein HTMLElement
   *  toMarkdown(block, ctx) für den Export
   *  slash       false = nicht im "/"-Menü anzeigen
   */
  registerBlock(def) {
    if (!def.type || !def.render) throw new Error('Block braucht "type" und "render"');
    this.blocks.set(def.type, { group: 'Blöcke', slash: true, keywords: [], create: () => ({}), ...def });
    this.events.emit('registry:change');
  }

  /** Eintrag im "/"-Menü: { id, name, icon, description, keywords, group, run(editor, blockId) } */
  registerSlashCommand(def) {
    this.slashCommands.set(def.id, { group: 'Aktionen', keywords: [], ...def });
    this.events.emit('registry:change');
  }

  unregisterSlashCommand(id) { this.slashCommands.delete(id); }

  /** Befehl: { id, name, icon, shortcut: "Ctrl+Shift+D", group, when(app), run(app) } */
  registerCommand(def) {
    this.commands.set(def.id, { group: 'Allgemein', ...def });
    this.events.emit('registry:change');
  }

  unregisterCommand(id) { this.commands.delete(id); }

  /** Farbschema: { id, name, dark: bool, vars: { '--bg': '#000', ... } } */
  registerTheme(def) {
    this.themes.set(def.id, def);
    this.events.emit('registry:change');
  }

  /** Seitenleisten-Bereich: { id, title, icon, render(container, app) } */
  registerSidebarPanel(def) {
    this.sidebarPanels.set(def.id, def);
    this.events.emit('registry:change');
  }

  /** Platzhalter für Hotkey-Vorlagen: { name: "datum", description, value(app) → string } */
  registerVariable(def) {
    this.variables.set(def.name, def);
  }

  /** Alle Einträge für das "/"-Menü (Blöcke + Aktionen) */
  getSlashItems() {
    const items = [];
    for (const b of this.blocks.values()) {
      if (b.slash === false) continue;
      items.push({ kind: 'block', id: 'block:' + b.type, type: b.type, name: b.name, icon: b.icon, description: b.description, keywords: b.keywords, group: b.group, preset: b.preset });
    }
    for (const c of this.slashCommands.values()) items.push({ kind: 'command', ...c });
    return items;
  }
}
