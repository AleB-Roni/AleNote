// Einstellungen → KI: Anbieter & Schlüssel, eigene Prompts
import { h, uid } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast, confirmDialog } from '../ui/overlays.js';
import { PROVIDERS, streamChat } from './providers.js';
import { DEFAULT_ACTIONS, SCOPE_LABELS, OUTPUT_LABELS } from './ai.js';
import { dictateSettings, dictationMethod } from './dictate.js';

export function renderAISettings(app, page, rerender, { shortcutRecorder, toggle, select }) {
  const ai = app.ai;
  const cfg = ai.cfg;
  const section = (t, d) => h('div.set-section', {}, h('h4', { text: t }), d ? h('p.muted.small', { html: d }) : null);

  // ---------- Anbieter ----------
  page.append(section('KI-Anbieter', 'Hinterlege einen API-Schlüssel für mindestens einen Anbieter. Die Schlüssel bleiben <b>nur auf diesem Gerät</b> und werden nicht synchronisiert. Anfragen gehen direkt von AleNote zum Anbieter.'));
  page.append(h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Standard-Anbieter' }), h('div.muted.small', { text: 'Für Prompts ohne eigenen Anbieter und für den Chat' })),
    h('div.set-control', {}, select(Object.entries(PROVIDERS).map(([id, p]) => [id, p.name + (ai.isConfigured(id) ? ' ✓' : '')]), cfg.defaultProvider, (v) => { cfg.defaultProvider = v; ai.save(); rerender(); }))));

  const grid = h('div.ai-provider-list');
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const pc = (cfg.providers[id] ||= {});
    const open = id === cfg.defaultProvider || !!pc.apiKey;
    const card = h('details.ai-provider' + (ai.isConfigured(id) ? '.ok' : ''), { open });
    const keyIn = h('input.input', { type: 'password', placeholder: p.noKey ? 'Kein Schlüssel nötig' : 'API-Schlüssel einfügen', value: pc.apiKey || '', autocomplete: 'off', spellcheck: 'false', disabled: !!p.noKey });
    keyIn.addEventListener('change', () => { pc.apiKey = keyIn.value.trim(); ai.save(); rerender(); });
    const eye = h('button.icon-btn', { title: 'Anzeigen', onclick: () => { keyIn.type = keyIn.type === 'password' ? 'text' : 'password'; } }, icon('eye', 15));
    const listId = 'models-' + id;
    const modelIn = h('input.input', { value: pc.model || p.defaultModel, placeholder: 'Modell', list: listId, spellcheck: 'false' });
    modelIn.addEventListener('change', () => { pc.model = modelIn.value.trim(); ai.save(); });
    const urlIn = p.editableUrl ? h('input.input', { value: pc.baseUrl || p.baseUrl, placeholder: 'Server-Adresse', spellcheck: 'false' }) : null;
    urlIn?.addEventListener('change', () => { pc.baseUrl = urlIn.value.trim(); ai.save(); });
    const testOut = h('span.small.muted');
    const test = h('button.btn.small', {
      onclick: async () => {
        testOut.textContent = 'Teste …';
        testOut.className = 'small muted';
        try {
          const r = await streamChat(ai.providerConfig(id), { system: 'Antworte nur mit: OK', messages: [{ role: 'user', content: 'Test' }] });
          testOut.textContent = '✓ Verbunden: ' + r.text.trim().slice(0, 40);
          testOut.className = 'small ai-ok';
        } catch (e) { testOut.textContent = '✗ ' + e.message; testOut.className = 'small ai-err'; }
      }
    }, icon('zap', 13), 'Testen');
    card.append(
      h('summary', {}, h('span.ai-dot'), h('b', { text: p.name }), h('div.flex'), h('span.muted.small', { text: ai.isConfigured(id) ? (pc.model || p.defaultModel) : 'nicht eingerichtet' })),
      h('div.ai-provider-body', {},
        p.noKey ? null : h('label.ai-field', {}, h('span', { text: 'API-Schlüssel' }), h('div.row-inline', {}, keyIn, eye)),
        h('label.ai-field', {}, h('span', { text: 'Modell' }), modelIn, h('datalist', { id: listId }, ...p.models.map((m) => h('option', { value: m })))),
        urlIn ? h('label.ai-field', {}, h('span', { text: 'Server-Adresse' }), urlIn) : null,
        h('div.row-inline', {}, test, p.keyUrl ? h('button.link-btn', { text: 'Schlüssel erstellen ↗', onclick: () => app.api.openExternal(p.keyUrl) }) : null, testOut)));
    grid.append(card);
  }
  page.append(grid);

  // ---------- Diktieren ----------
  const ds = dictateSettings(app);
  const setD = (patch) => { cfg.dictate = { ...ds, ...patch }; ai.save(); };
  const method = dictationMethod(app);
  page.append(section('Diktieren', 'Sprechen statt tippen: Mikrofon-Knopf in der Schnellnotiz, „/diktieren“ oder <kbd>Strg</kbd><kbd>Shift</kbd><kbd>M</kbd>. Die Aufnahme wird von OpenAI, Groq oder Gemini in Text umgewandelt (Schlüssel oben hinterlegen).'));
  page.append(h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Spracherkennung' }), h('div.muted.small', { text: method ? (method.kind === 'browser' ? 'Aktiv: Spracherkennung des Browsers' : 'Aktiv: ' + PROVIDERS[method.provider].name) : 'Noch nicht eingerichtet – Schlüssel für OpenAI, Groq oder Gemini hinterlegen' })),
    h('div.set-control', {}, select([['auto', 'Automatisch'], ['openai', 'OpenAI (Whisper)'], ['groq', 'Groq (Whisper, sehr schnell)'], ['gemini', 'Gemini'], ['browser', 'Browser (Chrome/Edge/Safari)']], ds.provider, (v) => { setD({ provider: v }); rerender(); }))));
  page.append(h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Sprache' })),
    h('div.set-control', {}, select([['de', 'Deutsch'], ['en', 'Englisch'], ['fr', 'Französisch'], ['it', 'Italienisch'], ['es', 'Spanisch'], ['auto', 'Automatisch erkennen']], ds.language, (v) => setD({ language: v })))));
  page.append(h('div.set-row', {}, h('div.set-label', {}, h('div', { text: 'Text mit KI bereinigen' }), h('div.muted.small', { text: 'Satzzeichen, Füllwörter („äh“) und Erkennungsfehler korrigiert der Standard-Anbieter' })),
    h('div.set-control', {}, toggle(ds.cleanup, (v) => setD({ cleanup: v })))));

  // ---------- Eigene Prompts ----------
  page.append(section('Eigene Prompts', 'Lege fest, was die KI mit dem Text machen soll. Prompts erscheinen in der KI-Leiste (<kbd>Strg</kbd><kbd>J</kbd>), im „/“-Menü, in der Befehlspalette, im Block-Menü (⋮⋮) und bei markiertem Text in der Formatierungsleiste.'));
  const list = h('div.hotkey-list');
  const providerOpts = [['', 'Standard-Anbieter'], ...Object.entries(PROVIDERS).map(([id, p]) => [id, p.name])];
  cfg.actions.forEach((a, i) => {
    const card = h('div.hotkey-card.ai-action');
    const emoji = h('input.input.ai-emoji', { value: a.icon || '✨', maxlength: 4, title: 'Symbol' });
    emoji.addEventListener('change', () => { a.icon = emoji.value.trim() || '✨'; ai.save(); });
    const name = h('input.input', { value: a.name, placeholder: 'Name' });
    name.addEventListener('change', () => { a.name = name.value.trim() || 'Prompt'; ai.save(); });
    const prompt = h('textarea.input.ai-prompt', { rows: 3, placeholder: 'Was soll die KI tun? z.B. „Schreibe den Text als freundliche E-Mail um.“' });
    prompt.value = a.prompt || '';
    prompt.addEventListener('change', () => { a.prompt = prompt.value.trim(); ai.save(); });
    const del = h('button.icon-btn', { title: 'Löschen', onclick: async () => { if (await confirmDialog('Prompt löschen?', `„${a.name}“ wird entfernt.`)) { cfg.actions.splice(i, 1); ai.save(); rerender(); } } }, icon('trash', 15));
    const up = h('button.icon-btn', { title: 'Nach oben', disabled: i === 0, onclick: () => { cfg.actions.splice(i - 1, 0, cfg.actions.splice(i, 1)[0]); ai.save(); rerender(); } }, icon('chevronUp', 15));
    const run = h('button.btn.small', { title: 'Jetzt auf die geöffnete Notiz anwenden', onclick: () => { document.querySelector('.modal-backdrop .modal-header .icon-btn')?.click(); setTimeout(() => ai.run(a), 250); } }, icon('zap', 13), 'Ausführen');
    card.append(
      h('div.hotkey-top', {}, emoji, name, shortcutRecorder(app, a.shortcut || '', (v) => { a.shortcut = v; ai.save(); }, { exceptId: 'ai:' + a.id }), up, del),
      prompt,
      h('div.ai-action-opts', {},
        h('label.ai-opt', {}, h('span', { text: 'Bereich' }), select(Object.entries(SCOPE_LABELS), a.scope || 'auto', (v) => { a.scope = v; ai.save(); })),
        h('label.ai-opt', {}, h('span', { text: 'Ergebnis' }), select(Object.entries(OUTPUT_LABELS), a.output || 'replace', (v) => { a.output = v; ai.save(); })),
        h('label.ai-opt', {}, h('span', { text: 'Anbieter' }), select(providerOpts, a.provider || '', (v) => { a.provider = v; ai.save(); }))),
      h('div.hotkey-bottom', {},
        h('label.inline-toggle', {}, toggle(a.slash !== false, (v) => { a.slash = v; ai.save(); }), h('span.small', { text: '„/“-Menü' })),
        h('label.inline-toggle', {}, toggle(!!a.toolbar, (v) => { a.toolbar = v; ai.save(); }), h('span.small', { text: 'Formatierungsleiste' })),
        h('div.flex'), run));
    list.append(card);
  });
  page.append(list);
  page.append(h('div.row-gap', {},
    h('button.btn.btn-primary', { onclick: () => { cfg.actions.push({ id: uid(), name: 'Neuer Prompt', icon: '✨', prompt: '', scope: 'auto', output: 'replace', slash: true, toolbar: true }); ai.save(); rerender(); setTimeout(() => page.querySelector('.ai-action:last-child .ai-prompt')?.focus(), 50); } }, icon('plus', 15), 'Neuer Prompt'),
    h('button.btn', { onclick: async () => { if (await confirmDialog('Standard-Prompts hinzufügen?', 'Fehlende Standard-Prompts werden wieder ergänzt. Deine eigenen bleiben erhalten.', { okLabel: 'Hinzufügen', danger: false })) { for (const d of DEFAULT_ACTIONS) if (!cfg.actions.some((x) => x.id === d.id)) cfg.actions.push(structuredClone(d)); ai.save(); rerender(); } } }, icon('refresh', 15), 'Standards')));
  page.append(h('p.muted.small', { html: '<b>Bereich:</b> „Automatisch“ nimmt den markierten Text, sonst den aktuellen Block, sonst die ganze Seite. <b>Ergebnis:</b> Vor dem Übernehmen siehst du immer eine Vorschau. Alles lässt sich mit <kbd>Strg</kbd><kbd>Z</kbd> rückgängig machen.' }));
}
