// Einstellungen: Darstellung, Editor, Hotkeys, Plugins, Vault
import { plainIcon } from '../core/emoji.js';
import { h } from '../core/utils.js';
import { renderAISettings } from '../ai/ai-settings.js';
import { quickSettings } from '../core/todos.js';
import { remindSettings } from '../core/reminders.js';
import { icon } from './icons.js';
import { modal, toast, confirmDialog } from './overlays.js';
import { isNarrow } from '../core/mobile.js';
import { eventToShortcut, shortcutHtml } from '../core/shortcuts.js';

export const ACCENTS = ['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];
export const FONTS = {
  system: { name: 'Modern (Segoe UI)', css: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif' },
  serif: { name: 'Serif (Georgia)', css: 'Georgia, "Cambria", "Times New Roman", serif' },
  rounded: { name: 'Rund (Nunito/Verdana)', css: '"Nunito", "Varela Round", Verdana, sans-serif' },
  mono: { name: 'Mono (Cascadia)', css: '"Cascadia Code", "Consolas", ui-monospace, monospace' }
};

export function openSettings(app, tab) {
  const tabs = [
    ['appearance', 'Darstellung', 'palette'],
    ['editor', 'Editor', 'edit'],
    ['hotkeys', 'Hotkeys', 'keyboard'],
    ['quick', 'Schnellnotiz', 'zap'],
    ['reminders', 'Erinnerungen', 'clock'],
    ['ai', 'KI', 'sparkles'],
    ['account', 'Konto & Sync', 'user'],
    ['plugins', 'Plugins', 'puzzle'],
    ['vault', 'Vault', 'vault'],
    ['about', 'Über', 'star']
  ];
  // Auf dem Handy gibt es keine Tastenkürzel
  const mobile = !!app.api.isMobile;
  const shown = tabs.filter(([id]) => !(mobile && id === 'hotkeys'));
  if (mobile && tab === 'hotkeys') tab = 'appearance';
  // Schmaler Bildschirm: erst Liste der Bereiche, dann die Seite mit „Zurück“ (wie in Android)
  const drill = isNarrow();
  const nav = h('div.settings-nav');
  const body = h('div.settings-body');
  const content = h('div.settings' + (drill ? '.drill' : ''), {}, nav, body);
  const m = modal({ title: 'Einstellungen', content, width: 'min(900px, 94vw)', className: 'settings-modal' });

  const showList = () => { content.classList.remove('page-open'); nav.scrollTop = 0; };
  const show = (id) => {
    nav.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    body.innerHTML = '';
    const page = h('div.settings-page');
    if (drill) {
      const label = shown.find(([t]) => t === id)?.[1] || '';
      body.append(h('button.settings-back', { onclick: showList }, icon('chevronRight', 16, 'flip'), h('span', { text: 'Einstellungen' }), h('b', { text: label })));
      content.classList.add('page-open');
    }
    ({ appearance, editor, hotkeys, quick, reminders, ai, account, plugins, vault, about })[id](app, page, () => show(id), m);
    body.append(page);
    body.scrollTop = 0;
  };
  for (const [id, label, ic] of shown) {
    nav.append(h('button.settings-tab', { dataset: { tab: id }, onclick: () => show(id) }, icon(ic, 16), h('span', { text: label }), drill ? icon('chevronRight', 15, 'settings-arrow') : null));
  }
  if (drill && !tab) showList();
  else show(tab || 'appearance');
  return m;
}

// ---------- Bausteine ----------
const section = (title, desc) => h('div.set-section', {}, h('h4', { text: title }), desc ? h('p.muted.small', { text: desc }) : null);

function row(label, desc, control) {
  return h('div.set-row', {}, h('div.set-label', {}, h('div', { text: label }), desc ? h('div.muted.small', { text: desc }) : null), h('div.set-control', {}, control));
}

function toggle(value, onChange) {
  const el = h('button.switch' + (value ? '.on' : ''), { role: 'switch' });
  el.addEventListener('click', () => { value = !value; el.classList.toggle('on', value); onChange(value); });
  return el;
}

function select(options, value, onChange) {
  const el = h('select.input.select');
  for (const [v, label] of options) el.append(h('option', { value: v, text: label, selected: v === value }));
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

/** Feld, das eine Tastenkombination aufnimmt */
export function shortcutRecorder(app, value, onChange, { exceptId } = {}) {
  const el = h('button.shortcut-rec', { title: 'Klicken und Tastenkombination drücken' });
  const render = () => { el.innerHTML = value ? shortcutHtml(value) : '<span class="muted">Kein Kürzel</span>'; };
  render();
  el.addEventListener('click', () => {
    el.classList.add('recording');
    el.innerHTML = '<span class="rec-dot"></span> Tasten drücken…';
    app.hotkeys.recording = true;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop();
      if (e.key === 'Backspace' || e.key === 'Delete') { value = ''; onChange(''); return stop(); }
      const sc = eventToShortcut(e);
      if (!sc) return;
      if (!/^(Ctrl|Alt|Meta)\+/.test(sc) && !/^F\d+$/.test(sc) && !/\+F\d+$/.test(sc)) {
        el.innerHTML = '<span class="muted">Bitte mit Strg, Alt oder F-Taste</span>';
        return;
      }
      const c = app.hotkeys.conflict(sc, exceptId);
      if (c) toast(`Hinweis: "${sc}" wird auch von "${c.name}" verwendet`, { type: 'error', duration: 3500 });
      value = sc;
      onChange(sc);
      stop();
    };
    const stop = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', outside, true);
      el.classList.remove('recording');
      app.hotkeys.recording = false;
      render();
    };
    const outside = (e) => { if (e.target !== el) stop(); };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  });
  return el;
}

// ---------- Seiten ----------
function appearance(app, page, rerender) {
  const s = app.settings;
  page.append(section('Farbschema'));
  const grid = h('div.theme-grid');
  for (const t of app.registry.themes.values()) {
    const v = t.vars;
    const card = h('button.theme-card' + ((s.theme || 'dark') === t.id ? '.active' : ''), { onclick: () => { app.saveSettings({ theme: t.id }); rerender(); } },
      h('div.theme-preview', { style: { background: v['--bg'] } },
        h('div.tp-side', { style: { background: v['--bg-2'] } }),
        h('div.tp-lines', {}, h('i', { style: { background: v['--text'] } }), h('i', { style: { background: v['--text-3'] } }), h('i', { style: { background: 'var(--accent)' } }))),
      h('span', { text: t.name }));
    grid.append(card);
  }
  page.append(grid);

  page.append(section('Akzentfarbe'));
  const accents = h('div.accent-row');
  for (const c of ACCENTS) {
    accents.append(h('button.accent-swatch' + (s.accent === c ? '.active' : ''), { style: { background: c }, onclick: () => { app.saveSettings({ accent: c }); rerender(); } }));
  }
  const custom = h('input.color-input', { type: 'color', value: s.accent || ACCENTS[0], title: 'Eigene Farbe' });
  custom.addEventListener('input', () => { app.saveSettings({ accent: custom.value }); });
  custom.addEventListener('change', rerender);
  accents.append(custom);
  page.append(accents);

  page.append(section('Schrift & Layout'));
  page.append(
    row('Schriftart', null, select(Object.entries(FONTS).map(([k, f]) => [k, f.name]), s.font || 'system', (v) => app.saveSettings({ font: v }))),
    row('Schriftgröße', `${s.fontSize || 16}px`, (() => {
      const r = h('input.range', { type: 'range', min: 13, max: 22, value: s.fontSize || 16 });
      r.addEventListener('input', () => { app.saveSettings({ fontSize: +r.value }); r.closest('.set-row').querySelector('.muted').textContent = r.value + 'px'; });
      return r;
    })()),
    row('Seitenbreite', 'Breite des Textbereichs', select([['narrow', 'Schmal'], ['normal', 'Normal'], ['wide', 'Breit'], ['full', 'Volle Breite']], s.width || 'normal', (v) => app.saveSettings({ width: v }))),
    row('Animationen', 'Weiche Übergänge und Effekte', toggle(s.animations !== false, (v) => app.saveSettings({ animations: v }))),
    row('Glas-Effekt', 'Transparente Menüs mit Unschärfe', toggle(s.glass !== false, (v) => app.saveSettings({ glass: v })))
  );
}

function editor(app, page) {
  const s = app.settings;
  page.append(section('Schreiben'));
  page.append(
    row('Rechtschreibprüfung', null, toggle(s.spellcheck !== false, (v) => app.saveSettings({ spellcheck: v }))),
    row('Block-Griffe anzeigen', 'Die ⋮⋮ und + Buttons links neben Blöcken', toggle(s.showHandles !== false, (v) => app.saveSettings({ showHandles: v }))),
    row('Fokus-Modus', 'Seitenleiste ausblenden & nur aktuellen Block hervorheben', toggle(!!s.focusMode, (v) => app.saveSettings({ focusMode: v }))),
    row('Speicher-Verzögerung', 'Automatisches Speichern nach … ms', select([['300', '300 ms'], ['600', '600 ms'], ['1200', '1,2 s'], ['3000', '3 s']], String(s.saveDelay || 600), (v) => app.saveSettings({ saveDelay: +v })))
  );
  page.append(section('Markdown-Kürzel', 'Am Zeilenanfang tippen, dann Leertaste:'));
  const md = [['#', 'Überschrift 1'], ['##', 'Überschrift 2'], ['###', 'Überschrift 3'], ['-', 'Aufzählung'], ['1.', 'Nummerierte Liste'], ['[]', 'To-do'], ['>', 'Zitat'], ['!>', 'Hinweisbox'], ['>>', 'Aufklappbar'], ['```', 'Codeblock'], ['---', 'Trennlinie']];
  page.append(h('div.md-grid', {}, ...md.map(([k, v]) => h('div.md-item', {}, h('code', { text: k }), h('span', { text: v })))));
}

function hotkeys(app, page, rerender) {
  const s = app.settings;
  const list = s.hotkeys || [];
  const save = (resync = true) => { app.saveSettings({ hotkeys: list }); if (resync) app.hotkeys.syncCustomHotkeys(); };

  page.append(section('Eigene Hotkeys', 'Erstelle eigene Tastenkürzel, z.B. um das aktuelle Datum einzufügen. Sie erscheinen auch in der Befehlspalette (Strg+P) und im "/"-Menü.'));
  const wrap = h('div.hotkey-list');
  const vars = [...app.registry.variables.values()];
  const blockOptions = [...app.registry.blocks.values()].filter((b) => b.slash !== false).map((b) => [b.type, b.name]);
  const cmdOptions = [...app.registry.commands.values()].filter((c) => !c.id.startsWith('custom:')).map((c) => [c.id, c.name]);

  list.forEach((hk, i) => {
    const card = h('div.hotkey-card');
    const nameInput = h('input.input', { value: hk.name, placeholder: 'Name' });
    nameInput.addEventListener('change', () => { hk.name = nameInput.value.trim() || 'Hotkey'; save(); });
    const rec = shortcutRecorder(app, hk.shortcut, (v) => { hk.shortcut = v; save(); }, { exceptId: 'custom:' + hk.id });
    const del = h('button.icon-btn', { title: 'Löschen', onclick: async () => { if (await confirmDialog('Hotkey löschen?', `"${hk.name}" wird entfernt.`)) { list.splice(i, 1); save(); rerender(); } } }, icon('trash', 15));
    const test = h('button.btn.small', { title: 'Vorschau', onclick: async () => {
      if (hk.action === 'text') toast('Ergebnis: ' + (await app.hotkeys.expand(hk.template || '')), { duration: 3500 });
      else toast(hk.action === 'block' ? 'Fügt einen Block ein' : 'Führt einen Befehl aus');
    } }, icon('zap', 13), 'Test');

    const actionSel = select([['text', 'Text einfügen'], ['block', 'Block einfügen'], ['command', 'Befehl ausführen']], hk.action, (v) => { hk.action = v; save(); rerender(); });
    let detail;
    if (hk.action === 'text') {
      const tpl = h('textarea.input.template', { rows: 2, placeholder: 'z.B. Besprechung vom {datum}', text: hk.template || '' });
      tpl.value = hk.template || '';
      tpl.addEventListener('input', () => { hk.template = tpl.value; save(false); });
      tpl.addEventListener('change', () => save());
      const chips = h('div.var-chips', {}, h('span.muted.small', { text: 'Platzhalter:' }),
        ...vars.map((v) => h('button.var-chip', { title: v.description, text: `{${v.name}}`, onclick: () => {
          const pos = tpl.selectionStart ?? tpl.value.length;
          tpl.value = tpl.value.slice(0, pos) + `{${v.name}}` + tpl.value.slice(tpl.selectionEnd ?? pos);
          hk.template = tpl.value; save(); tpl.focus();
        } })),
        h('button.var-chip', { title: 'Eigenes Datumsformat, z.B. {datum:DD.MM.YY} oder {datum:dddd, DD. MMMM YYYY}', text: '{datum:FORMAT}', onclick: () => { tpl.value += '{datum:DD. MMMM YYYY}'; hk.template = tpl.value; save(); } }));
      detail = h('div', {}, tpl, chips);
    } else if (hk.action === 'block') {
      detail = select(blockOptions, hk.blockType || 'todo', (v) => { hk.blockType = v; save(); });
    } else {
      detail = select([['', '– Befehl wählen –'], ...cmdOptions], hk.commandId || '', (v) => { hk.commandId = v; save(); });
    }
    const slashToggle = h('label.inline-toggle', {}, toggle(hk.slash !== false, (v) => { hk.slash = v; save(); }), h('span.small', { text: 'Im "/"-Menü zeigen' }));

    card.append(
      h('div.hotkey-top', {}, h('div.hotkey-icon', {}, icon(hk.action === 'block' ? 'layers' : hk.action === 'command' ? 'zap' : 'calendar', 16)), nameInput, rec, del),
      h('div.hotkey-mid', {}, actionSel, detail),
      h('div.hotkey-bottom', {}, slashToggle, h('div.flex'), test));
    wrap.append(card);
  });
  page.append(wrap);
  page.append(h('div.row-gap', {},
    h('button.btn.btn-primary', { onclick: () => { list.push(app.hotkeys.newHotkey()); s.hotkeys = list; save(); rerender(); setTimeout(() => page.querySelector('.hotkey-card:last-child input')?.select(), 50); } }, icon('plus', 15), 'Neuer Hotkey'),
    h('button.btn', { onclick: async () => { if (await confirmDialog('Standard-Hotkeys wiederherstellen?', 'Fehlende Standard-Hotkeys (Datum, Uhrzeit, …) werden wieder hinzugefügt.', { okLabel: 'Wiederherstellen', danger: false })) { app.restoreDefaultHotkeys(); rerender(); } } }, icon('refresh', 15), 'Standards')));

  page.append(section('Alle Tastenkürzel', 'Klicke auf ein Kürzel, um es zu ändern. Entf/Rücktaste entfernt es.'));
  const table = h('div.shortcut-table');
  const groups = new Map();
  for (const c of app.registry.commands.values()) {
    if (c.id.startsWith('custom:')) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  for (const [g, cmds] of groups) {
    table.append(h('div.shortcut-group', { text: g }));
    for (const c of cmds) {
      const overridden = c.id in app.hotkeys.overrides;
      table.append(h('div.shortcut-row', {},
        icon(c.icon || 'zap', 15), h('span.flex', { text: c.name }),
        overridden ? h('button.icon-btn.tiny', { title: 'Zurücksetzen', onclick: () => { const o = { ...app.hotkeys.overrides }; delete o[c.id]; app.saveSettings({ shortcutOverrides: o }); rerender(); } }, icon('undo', 13)) : null,
        shortcutRecorder(app, app.hotkeys.shortcutFor(c.id), (v) => { app.saveSettings({ shortcutOverrides: { ...app.hotkeys.overrides, [c.id]: v } }); rerender(); }, { exceptId: c.id })));
    }
  }
  page.append(table);
  page.append(h('p.muted.small', { html: 'Fest eingebaut: <kbd>Strg</kbd><kbd>B</kbd> Fett · <kbd>Strg</kbd><kbd>I</kbd> Kursiv · <kbd>Strg</kbd><kbd>U</kbd> Unterstrichen · <kbd>Strg</kbd><kbd>E</kbd> Code · <kbd>Strg</kbd><kbd>K</kbd> Link · <kbd>Strg</kbd><kbd>A</kbd> 1× Block, 2× alles · <kbd>Tab</kbd> Einrücken · <kbd>/</kbd> Befehle' }));
}

function quick(app, page, rerender) {
  const qs = quickSettings(app);
  const set = (patch) => app.saveSettings({ quicknote: { ...(app.settings.quicknote || {}), ...patch } });
  const desktop = !!app.api.quickShortcutStatus;

  page.append(section('Schnellnotiz', 'Ein kleines Fenster zum schnellen Festhalten. Jeder Eintrag landet mit Datum und Uhrzeit in deiner Quicknotizen-Notiz – auf Wunsch als To-do mit Fälligkeitsdatum.'));
  const notes = app.sidebar.allNotes();
  const opts = notes.map((n) => [n.path, (n.icon ? plainIcon(n.icon) + ' ' : '') + n.path.replace(/\.alenote$/, '')]);
  if (!opts.some(([p]) => p === qs.target)) opts.unshift([qs.target, qs.target.replace(/\.alenote$/, '') + ' (wird angelegt)']);
  page.append(row('Ziel-Notiz', 'Standard für neue Einträge. Im Schnellnotiz-Fenster kannst du jedes Mal eine andere wählen.', select(opts, qs.target, (v) => set({ target: v }))));
  page.append(row('Neue Einträge', null, select([['bottom', 'Unten anhängen (chronologisch)'], ['top', 'Oben einfügen (neueste zuerst)']], qs.order, (v) => set({ order: v }))));
  page.append(row('Standardmäßig als To-do', 'Einträge werden als Aufgabe mit Checkbox gespeichert', toggle(!!qs.asTodo, (v) => set({ asTodo: v }))));
  if (!app.api.isMobile) page.append(row('Tastenkürzel in AleNote', 'Öffnet die Schnellnotiz im App-Fenster', shortcutRecorder(app, app.hotkeys.shortcutFor('core.quickNote'), (v) => { app.saveSettings({ shortcutOverrides: { ...app.hotkeys.overrides, 'core.quickNote': v } }); }, { exceptId: 'core.quickNote' })));
  if (desktop) {
    const status = h('div.muted.small');
    const showStatus = async () => {
      const r = await app.api.quickShortcutStatus();
      status.textContent = r.ok ? (qs.globalShortcut ? '✓ Aktiv – funktioniert überall in Windows, solange AleNote läuft.' : 'Ausgeschaltet') : '✗ ' + r.error;
      status.className = 'small ' + (r.ok ? 'ai-ok' : 'ai-err');
    };
    page.append(row('Globale Tastenkombination', 'Öffnet ein eigenes kleines Fenster – auch wenn AleNote im Hintergrund ist', h('div.set-stack', {},
      shortcutRecorder(app, qs.globalShortcut, async (v) => { qs.globalShortcut = v; await set({ globalShortcut: v }); showStatus(); }),
      status)));
    showStatus();
    page.append(h('div.row-gap', {}, h('button.btn', { onclick: () => app.api.openQuickWindow() }, icon('zap', 15), 'Schnellnotiz-Fenster testen')));
  }

  page.append(section('Kalender', 'Zeigt alle To-dos mit Fälligkeitsdatum aus deinen Notizen. Jeder Benutzer sieht nur seine eigenen Aufgaben.'));
  if (!app.api.isMobile) page.append(row('Tastenkürzel', null, shortcutRecorder(app, app.hotkeys.shortcutFor('core.calendar'), (v) => app.saveSettings({ shortcutOverrides: { ...app.hotkeys.overrides, 'core.calendar': v } }), { exceptId: 'core.calendar' })));
  page.append(row('Fälligkeitsdatum setzen', app.api.isMobile ? 'Im To-do auf 📅 tippen oder „/To-do mit Datum“' : 'Im To-do auf 📅 klicken, „/To-do mit Datum“ oder dieses Kürzel', app.api.isMobile ? h('span') : shortcutRecorder(app, app.hotkeys.shortcutFor('core.todoDue'), (v) => app.saveSettings({ shortcutOverrides: { ...app.hotkeys.overrides, 'core.todoDue': v } }), { exceptId: 'core.todoDue' })));
  page.append(h('div.row-gap', {}, h('button.btn.btn-primary', { onclick: () => { document.querySelector('.settings-modal')?.closest('.modal-backdrop')?.querySelector('.modal-header .icon-btn')?.click(); app.openCalendar(); } }, icon('calendar', 15), 'Kalender öffnen')));
}

function reminders(app, page, rerender) {
  const rs = remindSettings(app);
  const set = (patch) => app.saveSettings({ reminders: { ...(app.settings.reminders || {}), ...patch } });
  const api = app.api;
  page.append(section('Erinnerungen', 'Tippe im To-do auf die Glocke 🔔, um eine Erinnerung zu aktivieren – z.B. 1 Stunde, 3 Stunden oder 1 Tag vorher (auch mehrere). Ohne Uhrzeit gilt die Standardzeit am Fälligkeitstag.'));
  page.append(row('Erinnerungen aktiv', null, toggle(rs.enabled, (v) => set({ enabled: v }))));
  const time = h('input.input', { type: 'time', value: rs.defaultTime, style: { width: '120px' } });
  time.addEventListener('change', () => set({ defaultTime: time.value || '09:00' }));
  page.append(row('Standardzeit', 'Für To-dos mit Datum, aber ohne Uhrzeit', time));
  page.append(row('Alle To-dos mit Datum erinnern', 'Auch ohne Glocke an jedes To-do mit Fälligkeitsdatum erinnern', toggle(rs.auto, (v) => { set({ auto: v }); rerender(); })));
  if (rs.auto) page.append(row('Wann erinnern?', 'Für To-dos ohne eigene Glocken-Einstellung', select([['0', 'Zur Fälligkeit'], ['5', '5 Minuten vorher'], ['15', '15 Minuten vorher'], ['30', '30 Minuten vorher'], ['60', '1 Stunde vorher'], ['180', '3 Stunden vorher'], ['1440', '1 Tag vorher']], String(rs.before), (v) => set({ before: Number(v) }))));
  page.append(row('Tagesübersicht', 'Beim ersten Öffnen am Tag: was heute fällig oder überfällig ist', toggle(rs.daily, (v) => set({ daily: v }))));

  if (api.isMobile) {
    page.append(h('p.muted.small', { text: 'Auf dem Handy kommen Erinnerungen auch, wenn AleNote geschlossen ist. Beim ersten Mal fragt Android nach der Erlaubnis für Benachrichtigungen.' }));
  } else if (!window.alenoteNative) {
    const st = h('span.small');
    const show = () => {
      const p = 'Notification' in window ? Notification.permission : 'unsupported';
      st.textContent = p === 'granted' ? '✓ Benachrichtigungen erlaubt' : p === 'denied' ? '✗ Im Browser blockiert (Seiteneinstellungen)' : !window.isSecureContext ? 'Nur über HTTPS möglich – sonst erscheinen Erinnerungen nur in AleNote' : 'Noch nicht erlaubt';
      st.className = 'small ' + (p === 'granted' ? 'ai-ok' : 'muted');
    };
    show();
    page.append(row('Browser-Benachrichtigungen', 'Erinnerungen kommen, solange AleNote in einem Tab geöffnet ist', h('div.set-stack', {},
      h('button.btn.small', { onclick: async () => { try { await Notification.requestPermission(); } catch {} show(); } }, 'Erlauben'), st)));
  } else {
    page.append(section('Im Hintergrund', 'Damit Erinnerungen und die globale Schnellnotiz auch bei geschlossenem Fenster funktionieren.'));
    page.append(row('Beim Schließen im Infobereich weiterlaufen', 'Das Fenster schließen beendet AleNote nicht, sondern legt es unten rechts neben die Uhr', toggle(!!app.settings.runInTray, (v) => app.saveSettings({ runInTray: v }))));
    page.append(row('Mit Windows starten', 'Startet unsichtbar im Infobereich (nur zusammen mit der Option oben)', toggle(!!app.settings.autostart, (v) => app.saveSettings({ autostart: v, ...(v ? { runInTray: true } : {}) }))));
  }
  page.append(h('div.row-gap', {}, h('button.btn', { onclick: () => testReminder(app) }, icon('clock', 15), 'Test-Erinnerung')));
}

async function testReminder(app) {
  const t = { path: app.currentPath || '', id: '', text: 'Test-Erinnerung von AleNote', note: app.editor?.title || 'AleNote', due: new Date().toISOString().slice(0, 10), time: '', icon: '⏰' };
  const LN = app.api.native ? app.api.plugins?.LocalNotifications : null;
  if (LN) {
    try {
      if ((await LN.checkPermissions()).display !== 'granted' && (await LN.requestPermissions()).display !== 'granted') { toast('Benachrichtigungen sind für AleNote nicht erlaubt (Android-Einstellungen)', { type: 'error' }); return; }
      await LN.schedule({ notifications: [{ id: 99, title: '⏰ ' + t.text, body: 'So sehen Erinnerungen aus', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
      toast('Erinnerung kommt in 5 Sekunden – du kannst die App auch schließen', { duration: 4000 });
    } catch (err) { toast('Fehler: ' + err.message, { type: 'error' }); }
    return;
  }
  toast('Erinnerung kommt in 5 Sekunden …', { duration: 3000 });
  setTimeout(() => app.reminders?.fire(t), 5000);
}

function ai(app, page, rerender) {
  renderAISettings(app, page, rerender, { shortcutRecorder, toggle, select });
}

function account(app, page, rerender) {
  app.account.renderSettings(page, rerender);
}

function plugins(app, page) {
  page.append(section('Plugins', 'Plugins erweitern AleNote um neue Blöcke, Befehle, Themes und mehr. Änderungen werden nach einem Neuladen aktiv.'));
  const list = h('div.plugin-list');
  for (const p of app.plugins.loaded) {
    const disabled = (app.settings.disabledPlugins || []).includes(p.id);
    list.append(h('div.plugin-card' + (p.error ? '.error' : ''), {},
      h('div.plugin-icon', {}, icon('puzzle', 18)),
      h('div.flex', {},
        h('div.plugin-name', {}, p.name, h('span.badge', { text: p.source === 'builtin' ? 'Eingebaut' : 'Vault' })),
        h('div.muted.small', { text: p.error ? 'Fehler: ' + p.error : p.description || p.id })),
      toggle(!disabled, (on) => {
        const set = new Set(app.settings.disabledPlugins || []);
        on ? set.delete(p.id) : set.add(p.id);
        app.saveSettings({ disabledPlugins: [...set] });
        toast('Wird nach dem Neuladen (Strg+R) aktiv');
      })));
  }
  page.append(list);
  page.append(h('div.row-gap', {},
    h('button.btn', { onclick: () => app.api.openPluginFolder() }, icon('folder', 15), 'Plugin-Ordner öffnen'),
    h('button.btn', { onclick: () => location.reload() }, icon('refresh', 15), 'Neu laden')));
  page.append(section('Eigenes Plugin schreiben'));
  page.append(h('pre.code-sample', { text: `// <Vault>/.alenote/plugins/mein-plugin/plugin.js
export default {
  id: 'mein-plugin',
  name: 'Mein Plugin',
  activate(app) {
    app.registerCommand({
      id: 'hallo', name: 'Hallo sagen', shortcut: 'Ctrl+Alt+H',
      run: () => app.toast('Hallo aus meinem Plugin!')
    });
    app.registerBlock({
      type: 'hinweis-rot', name: 'Roter Hinweis', icon: '🚨',
      create: () => ({ text: '' }), text: true,
      render: (block) => app.ui.editable(block, { placeholder: 'Achtung…' })
    });
  }
};` }));
}

function vault(app, page) {
  page.append(section('Vault', 'Der Vault ist der Ordner, in dem alle Notizen als Dateien liegen. Unterordner = Ordner in AleNote.'));
  const pathEl = h('code.vault-path', { text: '…' });
  app.api.getVault().then((v) => { pathEl.textContent = v; });
  page.append(pathEl, h('div.row-gap', {},
    h('button.btn.btn-primary', { onclick: () => app.chooseVault() }, icon('folder', 15), 'Anderen Ordner wählen'),
    h('button.btn', { onclick: () => app.api.openFolder('') }, icon('external', 15), 'Im Explorer öffnen')));
  page.append(section('Dateiformat', 'Notizen werden als .alenote (JSON) gespeichert, Bilder im Unterordner _assets. Über "Als Markdown exportieren" kannst du jederzeit exportieren.'));
}

function about(app, page, rerender) {
  page.append(h('div.about', {},
    h('div.about-logo', { html: '<svg viewBox="0 0 32 32" width="64" height="64"><defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg2)"/><path d="M10 22 16 9l6 13M12.5 17h7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
    h('h2', { text: 'AleNote' }),
    h('p.muted', { text: `Version ${app.updates?.version || '1.0.0'} – Deine modulare Notiz-App.` }),
    h('p.muted.small', { text: `${app.registry.blocks.size} Blocktypen · ${app.registry.commands.size} Befehle · ${app.plugins.loaded.length} Plugins` })));
  app.updates?.renderSettings(page, rerender);
}
