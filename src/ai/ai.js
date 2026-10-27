// KI-Funktionen: eigene Prompts (Aktionen), KI-Befehlsleiste (Strg+J), Vorschau mit Übernehmen/Verwerfen
//
// Eine Aktion: { id, name, icon, prompt, scope, output, provider, shortcut, slash, toolbar }
//   scope:  'auto' (Markierung → Block → Seite) | 'selection' | 'block' | 'page'
//   output: 'replace' (ersetzen) | 'below' (darunter einfügen) | 'chat' (im Chat anzeigen)

import { h, uid, stripHtml, escapeHtml } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast, popover, closeMenu } from '../ui/overlays.js';
import { PROVIDERS, streamChat } from './providers.js';
import { blocksToMarkdown, mdToBlocks, mdInlineToHtml, cleanResult } from './markdown.js';
import { ChatPanel, renderMarkdown } from './chat.js';

export const DEFAULT_ACTIONS = [
  { id: 'improve', name: 'Verbessern', icon: '✨', scope: 'auto', output: 'replace', slash: true, toolbar: true, prompt: 'Verbessere Rechtschreibung, Grammatik und Stil. Behalte Bedeutung, Sprache und Formatierung bei.' },
  { id: 'shorter', name: 'Kürzer fassen', icon: '✂️', scope: 'auto', output: 'replace', slash: true, toolbar: true, prompt: 'Formuliere den Text deutlich kürzer und prägnanter, ohne wichtige Informationen zu verlieren.' },
  { id: 'longer', name: 'Ausführlicher', icon: '➕', scope: 'auto', output: 'replace', slash: true, toolbar: true, prompt: 'Formuliere den Text ausführlicher, mit mehr Details und Beispielen.' },
  { id: 'professional', name: 'Professioneller Ton', icon: '👔', scope: 'auto', output: 'replace', slash: true, toolbar: true, prompt: 'Schreibe den Text in einem professionellen, sachlichen Ton um.' },
  { id: 'casual', name: 'Lockerer Ton', icon: '😎', scope: 'auto', output: 'replace', slash: false, toolbar: true, prompt: 'Schreibe den Text in einem lockeren, freundlichen Ton um.' },
  { id: 'translate-en', name: 'Ins Englische übersetzen', icon: '🇬🇧', scope: 'auto', output: 'replace', slash: true, toolbar: true, prompt: 'Übersetze den Text ins Englische.' },
  { id: 'bullets', name: 'In Stichpunkte umwandeln', icon: '📋', scope: 'auto', output: 'replace', slash: true, toolbar: false, prompt: 'Wandle den Inhalt in eine übersichtliche Stichpunktliste um.' },
  { id: 'continue', name: 'Weiterschreiben', icon: '✍️', scope: 'block', output: 'below', slash: true, toolbar: false, prompt: 'Schreibe den Text sinnvoll weiter (1–2 Absätze) im gleichen Stil und in der gleichen Sprache. Gib nur die Fortsetzung zurück.' },
  { id: 'summary', name: 'Seite zusammenfassen', icon: '📝', scope: 'page', output: 'below', slash: true, toolbar: false, prompt: 'Fasse den gesamten Inhalt in 3–5 Sätzen zusammen. Beginne mit der Überschrift "## Zusammenfassung".' },
  { id: 'todos', name: 'Aufgaben herausziehen', icon: '☑️', scope: 'page', output: 'below', slash: true, toolbar: false, prompt: 'Erstelle aus dem Inhalt eine Aufgabenliste im Format "- [ ] Aufgabe". Beginne mit der Überschrift "## Aufgaben".' },
  { id: 'structure', name: 'Seite neu strukturieren', icon: '🧱', scope: 'page', output: 'replace', slash: false, toolbar: false, prompt: 'Strukturiere die gesamte Notiz übersichtlich neu: sinnvolle Überschriften, Absätze und Listen. Behalte alle Informationen.' }
];

/** Anzeigename des Bereichs */
const SCOPE_NAMES = { selection: 'Markierung', block: 'Block', blocks: 'Markierte Blöcke', page: 'Ganze Seite' };
const SCOPE_LABELS = { auto: 'Automatisch', selection: 'Markierter Text', block: 'Aktueller Block', page: 'Ganze Seite' };
const OUTPUT_LABELS = { replace: 'Ersetzen', below: 'Darunter einfügen', chat: 'Im Chat anzeigen' };
export { SCOPE_LABELS, OUTPUT_LABELS };

export class AIManager {
  constructor(app) {
    this.app = app;
    this.chat = new ChatPanel(app, this);
  }

  // ---------- Einstellungen ----------
  get cfg() {
    const s = this.app.settings;
    s.ai ||= {};
    s.ai.providers ||= {};
    if (!s.ai.actions) s.ai.actions = structuredClone(DEFAULT_ACTIONS);
    if (!s.ai.defaultProvider) s.ai.defaultProvider = 'anthropic';
    return s.ai;
  }
  save() { this.app.saveSettings({ ai: this.cfg }); this.registerAll(); }

  providerConfig(id = this.cfg.defaultProvider, model) {
    const p = this.cfg.providers[id] || {};
    return { provider: id, apiKey: p.apiKey || '', model: model || p.model || PROVIDERS[id]?.defaultModel, baseUrl: p.baseUrl || '' };
  }

  isConfigured(id = this.cfg.defaultProvider) {
    const p = PROVIDERS[id];
    return !!p && (p.noKey || p.optionalKey || !!this.cfg.providers[id]?.apiKey);
  }

  configuredProviders() { return Object.keys(PROVIDERS).filter((id) => this.isConfigured(id)); }

  // ---------- Befehle, "/"-Menü, Tastenkürzel ----------
  registerAll() {
    const reg = this.app.registry;
    for (const id of [...reg.commands.keys()]) if (id.startsWith('ai:')) reg.unregisterCommand(id);
    for (const id of [...reg.slashCommands.keys()]) if (id.startsWith('ai:')) reg.unregisterSlashCommand(id);
    const hasNote = () => !!this.app.editor?.note;

    reg.registerCommand({ id: 'ai:bar', name: 'KI-Befehl …', icon: 'zap', shortcut: 'Ctrl+J', group: 'KI', when: hasNote, run: () => this.openCommandBar() });
    reg.registerCommand({ id: 'ai:chat', name: 'KI-Chat ein-/ausblenden', icon: 'sparkles', shortcut: 'Ctrl+Shift+J', group: 'KI', run: () => this.chat.toggle() });
    reg.registerSlashCommand({
      id: 'ai:bar', name: 'KI fragen …', icon: 'sparkles', group: 'KI', description: 'Eigene Anweisung an die KI', keywords: ['ki', 'ai', 'claude', 'chatgpt', 'gemini'],
      run: (editor, { blockId }) => this.openCommandBar({ blockId, fromSlash: true })
    });

    for (const a of this.cfg.actions) {
      reg.registerCommand({ id: 'ai:' + a.id, name: 'KI: ' + a.name, icon: a.icon || 'sparkles', shortcut: a.shortcut || '', group: 'KI', when: hasNote, run: () => this.run(a) });
      if (a.slash !== false) {
        reg.registerSlashCommand({
          id: 'ai:' + a.id, name: a.name, icon: a.icon || 'sparkles', group: 'KI',
          description: `KI · ${SCOPE_LABELS[a.scope] || ''} · ${OUTPUT_LABELS[a.output] || ''}`, keywords: ['ki', 'ai', a.name.toLowerCase()],
          run: (editor, { blockId }) => this.run(a, { blockId, fromSlash: true })
        });
      }
    }
  }

  // ---------- Ziel bestimmen ----------
  captureTarget(scope, { blockId, fromSlash } = {}) {
    const editor = this.app.editor;
    const sel = window.getSelection();
    const anchorEl = sel.rangeCount ? (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement) : null;
    const field = anchorEl?.closest?.('[data-field]');
    const hasSelection = field && editor.page?.contains(field) && !sel.isCollapsed && sel.toString().trim();

    if ((scope === 'auto' || scope === 'selection') && hasSelection) {
      return { kind: 'selection', text: sel.toString(), range: sel.getRangeAt(0).cloneRange(), field, blockId: field.closest('.block')?.dataset.id };
    }
    // Mehrere markierte Blöcke (Ziehen über Blöcke, Shift-/Strg-Klick, Strg+A 2×)
    const multi = editor.multiSelected;
    if (multi?.size && scope !== 'page' && (!blockId || multi.has(blockId))) {
      const blocks = editor.note.blocks.filter((b) => multi.has(b.id));
      if (blocks.length > 1) return { kind: 'blocks', blockIds: blocks.map((b) => b.id), blockId: blocks.at(-1).id, text: blocksToMarkdown(editor, blocks) };
      if (blocks.length === 1 && scope !== 'selection') return { kind: 'block', blockId: blocks[0].id, text: blocksToMarkdown(editor, blocks) };
    }
    if (scope === 'selection') return null;

    let id = blockId || document.activeElement?.closest?.('.block')?.dataset.id || editor.selectedBlockId;
    let block = id && editor.block(id);
    // Aus dem "/"-Menü: leerer Block → vorherigen Block verwenden
    if (block && fromSlash && !stripHtml(block.data.text || '').trim() && editor.def(block.type)?.text) {
      const idx = editor.index(id);
      const prev = editor.note.blocks.slice(0, idx).reverse().find((b) => stripHtml(b.data.text || '').trim() || b.type === 'table');
      if (scope !== 'page' && prev) return { kind: 'block', blockId: prev.id, insertAfter: id, emptySlashBlock: id, text: blocksToMarkdown(editor, [prev]) };
      if (scope === 'auto' || scope === 'page') return { kind: 'page', insertAfter: id, emptySlashBlock: id, text: blocksToMarkdown(editor, editor.note.blocks) };
    }
    if ((scope === 'block' || scope === 'auto') && block && editor.index(id) >= 0) {
      return { kind: 'block', blockId: id, text: blocksToMarkdown(editor, [block]) };
    }
    return { kind: 'page', text: blocksToMarkdown(editor, editor.note.blocks), insertAfter: id && editor.index(id) >= 0 ? id : null };
  }

  buildRequest(prompt, target) {
    const title = this.app.editor.title;
    const format = target.kind === 'selection'
      ? 'Gib nur den neuen Text für die markierte Stelle zurück – als Fließtext ohne Zeilenumbrüche. Inline-Markdown (**fett**, *kursiv*, `Code`) ist erlaubt.'
      : 'Nutze Markdown, um die Struktur zu erhalten: # Überschriften, - Listen, 1. Nummerierungen, - [ ] Aufgaben, | Tabellen |, > Zitate, ```Code```.';
    const system = [
      'Du bist ein Schreibassistent in der Notiz-App AleNote.',
      'Wende die Anweisung des Nutzers auf den gegebenen Text an.',
      'Antworte ausschließlich mit dem Ergebnis – ohne Einleitung, Erklärung, Anführungszeichen oder umschließende Code-Blöcke.',
      'Antworte in der Sprache des Textes, außer die Anweisung verlangt etwas anderes.',
      format
    ].join('\n');
    const scopeText = { selection: 'markierter Text', block: 'ein Block der Notiz', blocks: 'mehrere markierte Blöcke der Notiz', page: 'die gesamte Notiz' }[target.kind];
    const user = `Anweisung: ${prompt}\n\nNotiz: „${title}“ (${scopeText})\n\nText:\n<<<\n${target.text}\n>>>`;
    return { system, messages: [{ role: 'user', content: user }] };
  }

  // ---------- Ausführen ----------
  async run(action, opts = {}) {
    const editor = this.app.editor;
    if (!editor.note) { toast('Öffne zuerst eine Notiz'); return; }
    const provider = action.provider || this.cfg.defaultProvider;
    if (!this.isConfigured(provider)) { this.needSetup(provider); return; }
    editor.pushHistory?.flush?.();
    const target = opts.target || this.captureTarget(action.scope || 'auto', opts);
    if (!target) { toast('Bitte zuerst Text markieren'); return; }
    if (!target.text.trim()) { toast('Hier ist noch kein Text, den die KI bearbeiten kann'); return; }

    if (action.output === 'chat') {
      this.chat.open();
      this.chat.send(`${action.prompt}\n\n${target.kind === 'page' ? '(Bezieht sich auf die ganze Notiz)' : '„' + target.text.slice(0, 4000) + '“'}`, { withContext: target.kind === 'page' });
      return;
    }
    const req = this.buildRequest(action.prompt, target);
    new ResultPanel(this, { action, target, req, provider, model: action.model }).start();
  }

  needSetup(provider) {
    toast(`${PROVIDERS[provider]?.name || 'KI'}: bitte zuerst einen API-Schlüssel hinterlegen`, { type: 'error', duration: 3500 });
    this.app.openSettings('ai');
  }

  // ---------- Ergebnis anwenden ----------
  apply(target, resultText, how) {
    const editor = this.app.editor;
    const text = cleanResult(resultText);
    if (!text) return;

    if (target.kind === 'selection' && how === 'replace') {
      const field = target.field;
      if (!field.isConnected) { toast('Die Stelle existiert nicht mehr', { type: 'error' }); return; }
      field.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(target.range);
      document.execCommand('insertHTML', false, mdInlineToHtml(text.replace(/\s*\n+\s*/g, ' ')));
      editor.changed(true);
      return;
    }

    const blocks = mdToBlocks(text, editor);
    if (!blocks.length) return;

    if (how === 'below' || target.kind === 'selection') {
      let after = target.insertAfter || (target.kind === 'blocks' ? [...target.blockIds].reverse().find((id) => editor.index(id) >= 0) : target.blockId) || editor.note.blocks.at(-1)?.id;
      if (target.emptySlashBlock && editor.block(target.emptySlashBlock) && !stripHtml(editor.block(target.emptySlashBlock).data.text || '').trim()) {
        // leeren "/"-Block durch das Ergebnis ersetzen
        const idx = editor.index(target.emptySlashBlock);
        editor.note.blocks.splice(idx, 1, ...blocks);
      } else {
        const idx = after ? editor.index(after) + 1 : editor.note.blocks.length;
        editor.note.blocks.splice(idx, 0, ...blocks);
      }
    } else if (target.kind === 'blocks') {
      // Markierte Blöcke durch das Ergebnis ersetzen (an der Stelle des ersten)
      const live = target.blockIds.filter((id) => editor.index(id) >= 0);
      if (!live.length) { toast('Die Blöcke existieren nicht mehr', { type: 'error' }); return; }
      if (blocks.length === live.length) {
        // Gleich viele Blöcke zurück → jeder bleibt an seinem Platz (Überschrift, To-do usw. bleiben erhalten)
        live.forEach((id, k) => {
          const idx = editor.index(id);
          const orig = editor.note.blocks[idx];
          const nb = blocks[k];
          if (nb.type === 'paragraph' && editor.def(orig.type)?.text && orig.type !== 'code') orig.data.text = nb.data.text;
          else editor.note.blocks.splice(idx, 1, nb);
        });
      } else {
        const ids = new Set(live);
        const idx = editor.note.blocks.findIndex((b) => ids.has(b.id));
        editor.note.blocks = editor.note.blocks.filter((b) => !ids.has(b.id));
        editor.note.blocks.splice(idx, 0, ...blocks);
      }
    } else if (target.kind === 'block') {
      const idx = editor.index(target.blockId);
      if (idx < 0) { toast('Der Block existiert nicht mehr', { type: 'error' }); return; }
      const orig = editor.note.blocks[idx];
      // Ein Absatz als Ergebnis → Blocktyp (z.B. Überschrift, To-do) beibehalten
      if (blocks.length === 1 && blocks[0].type === 'paragraph' && editor.def(orig.type)?.text && orig.type !== 'code') {
        orig.data.text = blocks[0].data.text;
      } else {
        editor.note.blocks.splice(idx, 1, ...blocks);
      }
    } else {
      editor.note.blocks = blocks;
    }
    editor.renderAll();
    editor.changed(true);
    const focusId = blocks.at(-1)?.id;
    if (focusId && editor.block(focusId)) editor.focusBlock(focusId, 'end');
    toast('KI-Änderung übernommen · Strg+Z macht sie rückgängig', { type: 'success', duration: 2200 });
  }

  // ---------- KI-Befehlsleiste (Strg+J) ----------
  openCommandBar(opts = {}) {
    const editor = this.app.editor;
    if (!editor.note) { toast('Öffne zuerst eine Notiz'); return; }
    const target = this.captureTarget('auto', opts);
    const sel = window.getSelection();
    let rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) {
      const row = target?.blockId && editor.rowEl(target.blockId);
      rect = row ? row.getBoundingClientRect() : editor.page.getBoundingClientRect();
    }
    const anchor = h('div', { style: { position: 'fixed', left: rect.left + 'px', top: rect.bottom + 'px', width: '1px', height: '1px' } });
    document.body.append(anchor);

    const scopeLabel = target ? SCOPE_NAMES[target.kind] : '';
    let scope = target?.kind || 'page';
    const input = h('input.ai-bar-input', { placeholder: 'Was soll die KI mit dem Text tun?  (Enter)', spellcheck: 'false' });
    const scopeBtn = h('button.ai-scope', { title: 'Bereich wechseln' }, icon('layers', 13), h('span', { text: scopeLabel }));
    const list = h('div.ai-bar-list');
    const actions = this.cfg.actions;
    let active = 0;
    const scopes = ['selection', 'blocks', 'block', 'page'].filter((k) => (k !== 'selection' && k !== 'blocks') || target?.kind === k);

    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      const items = actions.filter((a) => !q || a.name.toLowerCase().includes(q));
      if (q) items.unshift({ id: '__custom', name: `„${input.value.trim()}“ ausführen`, icon: '💬', custom: true });
      active = Math.min(active, Math.max(0, items.length - 1));
      items.forEach((a, i) => {
        const row = h('button.ai-bar-item' + (i === active ? '.active' : ''), {},
          h('span.ai-bar-emoji', { text: a.icon || '✨' }), h('span.flex', { text: a.name }),
          a.custom ? null : h('span.ai-bar-meta', { text: OUTPUT_LABELS[a.output] }));
        row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(a); });
        row.addEventListener('mousemove', () => { active = i; list.querySelectorAll('.ai-bar-item').forEach((el, k) => el.classList.toggle('active', k === i)); });
        list.append(row);
      });
      list._items = items;
    };
    const choose = (a) => {
      closeMenu();
      const t = scope === target?.kind ? target : this.captureTarget(scope, opts) || target;
      if (a.custom) this.run({ id: 'custom', name: 'Eigene Anweisung', prompt: input.value.trim(), scope, output: scope === 'selection' ? 'replace' : 'replace' }, { target: t });
      else this.run(a, { target: a.scope === 'auto' || a.scope === scope || (t?.kind === 'blocks' && a.scope !== 'page') ? t : this.captureTarget(a.scope, opts) });
    };
    scopeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      scope = scopes[(scopes.indexOf(scope) + 1) % scopes.length];
      scopeBtn.querySelector('span:last-child').textContent = SCOPE_NAMES[scope];
    });
    input.addEventListener('input', () => { active = 0; renderList(); });
    input.addEventListener('keydown', (e) => {
      const n = list._items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; renderList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; renderList(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (list._items[active]) choose(list._items[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    });
    const box = h('div.ai-bar', {},
      h('div.ai-bar-head', {}, icon('sparkles', 16), input, scopeBtn),
      list,
      h('div.ai-bar-foot', {}, h('span', { text: `${PROVIDERS[this.cfg.defaultProvider]?.name} · ${this.providerConfig().model}` }), h('button.link-btn', { text: 'Prompts bearbeiten', onmousedown: (e) => { e.preventDefault(); closeMenu(); this.app.openSettings('ai'); } })));
    renderList();
    popover(box, anchor, { className: 'ai-bar-pop', onClose: () => anchor.remove() });
    setTimeout(() => input.focus(), 20);
  }

  /** Einträge für das Block-Menü (⋮⋮) */
  blockMenuItems(blockId) {
    return [
      { label: 'KI-Befehl …', icon: 'sparkles', shortcut: 'Ctrl+J', run: () => this.openCommandBar({ blockId }) },
      '-',
      ...this.cfg.actions.filter((a) => a.scope !== 'page').map((a) => ({ label: `${a.icon || ''} ${a.name}`.trim(), run: () => this.run(a, { target: this.captureTarget('block', { blockId }) }) }))
    ];
  }

  /** Einträge für die Leiste über mehreren markierten Blöcken */
  multiMenuItems() {
    const target = this.captureTarget('blocks');
    return [
      { header: target?.kind === 'blocks' ? `${target.blockIds.length} Blöcke mit KI bearbeiten` : 'Mit KI bearbeiten' },
      { label: 'KI-Befehl …', icon: 'sparkles', shortcut: 'Ctrl+J', run: () => this.openCommandBar() },
      '-',
      ...this.cfg.actions.filter((a) => a.scope !== 'page').map((a) => ({ label: `${a.icon || ''} ${a.name}`.trim(), run: () => this.run(a, { target }) }))
    ];
  }

  /** Einträge für die Formatierungsleiste (markierter Text) */
  toolbarActions() { return this.cfg.actions.filter((a) => a.toolbar && a.scope !== 'page'); }
}

/** Vorschau-Fenster: zeigt die KI-Antwort live, dann Übernehmen / Darunter / Neu / Verwerfen */
class ResultPanel {
  constructor(ai, { action, target, req, provider, model }) {
    Object.assign(this, { ai, action, target, req, provider, model });
    this.app = ai.app;
    this.messages = [...req.messages];
  }

  start() {
    const editor = this.app.editor;
    document.querySelector('.ai-result')?.remove();
    const p = PROVIDERS[this.provider];
    const cfg = this.ai.providerConfig(this.provider, this.model);
    this.body = h('div.ai-result-body.md');
    this.status = h('span.ai-status', {}, h('span.ai-spinner'), 'Schreibt …');
    this.refine = h('input.input.small.ai-refine', { placeholder: 'Nachbessern, z.B. „noch kürzer“ …' });
    this.refine.addEventListener('keydown', (e) => { if (e.key === 'Enter' && this.refine.value.trim()) { e.preventDefault(); this.followUp(this.refine.value.trim()); this.refine.value = ''; } if (e.key === 'Escape') this.close(); });
    const isSel = this.target.kind === 'selection';
    this.btns = h('div.ai-result-actions', {},
      h('button.btn.btn-primary.small', { onclick: () => this.finish(this.action.output === 'below' && !isSel ? 'below' : 'replace') }, icon('check', 14), this.action.output === 'below' && !isSel ? 'Einfügen' : 'Ersetzen'),
      this.action.output !== 'below' || isSel ? h('button.btn.small', { onclick: () => this.finish('below') }, icon('plus', 14), 'Darunter einfügen') : null,
      h('button.btn.small', { title: 'Neu generieren', onclick: () => { this.messages = [...this.req.messages]; this.generate(); } }, icon('refresh', 14)),
      h('button.btn.small', { title: 'Kopieren', onclick: async () => { await navigator.clipboard.writeText(cleanResult(this.text)); toast('Kopiert', { duration: 1000 }); } }, icon('copy', 14)),
      h('div.flex'),
      h('button.btn.small', { onclick: () => this.close() }, 'Verwerfen'));
    const where = SCOPE_NAMES[this.target.kind];
    this.el = h('div.ai-result', {},
      h('div.ai-result-head', {}, h('span.ai-result-icon', { text: this.action.icon || '✨' }), h('b', { text: this.action.name }),
        h('span.ai-chip', { text: where }), h('span.ai-model', { text: `${p.name.split(' (')[0]} · ${cfg.model}` }), h('div.flex'), this.status,
        h('button.icon-btn.tiny', { title: 'Schließen (Esc)', onclick: () => this.close() }, icon('x', 14))),
      this.body,
      h('div.ai-result-foot', {}, this.refine, this.btns));
    // Unter dem Ziel einblenden
    const row = this.target.blockId ? editor.rowEl(this.target.blockId) : null;
    this.markTarget(true);
    (row && this.target.kind !== 'page' ? row : editor.page.querySelector('.blocks')).after(this.el);
    if (this.target.kind === 'page') editor.page.querySelector('.blocks').before(this.el);
    this.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.onKey = (e) => { if (e.key === 'Escape' && document.body.contains(this.el)) { e.preventDefault(); this.close(); } };
    document.addEventListener('keydown', this.onKey);
    this.generate();
  }

  markTarget(on) {
    const editor = this.app.editor;
    const ids = this.target.kind === 'page' ? editor.note.blocks.map((b) => b.id) : this.target.kind === 'blocks' ? this.target.blockIds : [this.target.blockId];
    ids.forEach((id) => editor.rowEl(id)?.classList.toggle('ai-target', on));
  }

  async generate() {
    this.abort?.abort();
    this.abort = new AbortController();
    this.text = '';
    this.body.innerHTML = '';
    this.setBusy(true);
    try {
      const res = await streamChat(this.ai.providerConfig(this.provider, this.model), {
        system: this.req.system, messages: this.messages, signal: this.abort.signal,
        onText: (_, all) => { this.text = all; this.body.innerHTML = renderMarkdown(cleanResult(all)); this.body.scrollTop = this.body.scrollHeight; }
      });
      this.text = res.text;
      this.setBusy(false, res.note);
    } catch (e) {
      if (e.name === 'AbortError') return;
      this.setBusy(false);
      this.body.innerHTML = `<div class="ai-error">${escapeHtml(e.message)}</div>`;
    }
  }

  followUp(instruction) {
    this.messages = [...this.messages, { role: 'assistant', content: this.text || '(leer)' }, { role: 'user', content: `Überarbeite dein Ergebnis: ${instruction}\nAntworte wieder nur mit dem vollständigen Ergebnis.` }];
    this.generate();
  }

  setBusy(busy, note) {
    this.status.innerHTML = '';
    if (busy) this.status.append(h('span.ai-spinner'), 'Schreibt …', h('button.link-btn', { text: 'Stopp', onclick: () => { this.abort.abort(); this.setBusy(false); } }));
    else if (note) this.status.append(h('span.ai-note', { text: note }));
    else this.status.append(icon('check', 13), 'Fertig');
    this.btns.querySelectorAll('button').forEach((b, i) => { if (i < 2) b.disabled = busy; });
  }

  finish(how) {
    if (!this.text.trim()) return;
    const text = this.text;
    this.close();
    this.ai.apply(this.target, text, how);
  }

  close() {
    this.abort?.abort();
    this.markTarget(false);
    document.removeEventListener('keydown', this.onKey);
    this.el.classList.add('leaving');
    setTimeout(() => this.el.remove(), 180);
  }
}
