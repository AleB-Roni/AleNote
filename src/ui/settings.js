// Einstellungen: Darstellung, Editor, Hotkeys, Plugins, Vault
import { h } from '../core/utils.js';
import { renderAISettings } from '../ai/ai-settings.js';
import { icon } from './icons.js';
import { modal, toast, confirmDialog } from './overlays.js';
import { eventToShortcut, shortcutHtml } from '../core/shortcuts.js';

export const ACCENTS = ['#7c5cff', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];
export const FONTS = {
  system: { name: 'Modern (Segoe UI)', css: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif' },
  serif: { name: 'Serif (Georgia)', css: 'Georgia, "Cambria", "Times New Roman", serif' },
  rounded: { name: 'Rund (Nunito/Verdana)', css: '"Nunito", "Varela Round", Verdana, sans-serif' },
  mono: { name: 'Mono (Cascadia)', css: '"Cascadia Code", "Consolas", ui-monospace, monospace' }
};

export function openSettings(app, tab = 'appearance') {
  const tabs = [
    ['appearance', 'Darstellung', 'palette'],
    ['editor', 'Editor', 'edit'],
    ['hotkeys', 'Hotkeys', 'keyboard'],
    ['ai', 'KI', 'sparkles'],
    ['account', 'Konto & Sync', 'user'],
    ['plugins', 'Plugins', 'puzzle'],
    ['vault', 'Vault', 'vault'],
    ['about', 'Über', 'star']
  ];
  const nav = h('div.settings-nav');
  const body = h('div.settings-body');
  const content = h('div.settings', {}, nav, body);
  const m = modal({ title: 'Einstellungen', content, width: 'min(900px, 94vw)', className: 'settings-modal' });

  const show = (id) => {
    nav.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    body.innerHTML = '';
    const page = h('div.settings-page');
    ({ appearance, editor, hotkeys, ai, account, plugins, vault, about })[id](app, page, () => show(id), m);
    body.append(page);
    body.scrollTop = 0;
  };
  for (const [id, label, ic] of tabs) {
    nav.append(h('button.settings-tab', { dataset: { tab: id }, onclick: () => show(id) }, icon(ic, 16), h('span', { text: label })));
  }
  show(tab);
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
