// KI-Chat in einer einklappbaren Seitenleiste rechts
import { h, escapeHtml } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast, contextMenu, confirmDialog } from '../ui/overlays.js';
import { PROVIDERS, streamChat } from './providers.js';
import { blocksToMarkdown, mdToBlocks, mdInlineToHtml, cleanResult } from './markdown.js';
import { findRelevantNotes, buildNotesContext } from './ask.js';

/** Einfaches Markdown → HTML für die Anzeige (Chat & Vorschau) */
export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, code = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInlineToHtml(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], t = raw.trim();
    if (code !== null) {
      if (t.startsWith('```')) { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw);
      continue;
    }
    if (t.startsWith('```')) { flushPara(); closeList(); code = []; continue; }
    if (!t) { flushPara(); closeList(); continue; }
    if (t.startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flushPara(); closeList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInlineToHtml(c.trim()));
      let html = '<table><tr>' + cells(t).map((c) => `<th>${c}</th>`).join('') + '</tr>';
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) html += '<tr>' + cells(lines[i++]).map((c) => `<td>${c}</td>`).join('') + '</tr>';
      i--;
      out.push(html + '</table>');
      continue;
    }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)/))) { flushPara(); closeList(); const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${mdInlineToHtml(m[2])}</h${n}>`); }
    else if ((m = t.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/))) { flushPara(); if (list !== 'ul') { closeList(); out.push('<ul class="todo">'); list = 'ul'; } out.push(`<li>${m[1] === ' ' ? '☐' : '☑'} ${mdInlineToHtml(m[2])}</li>`); }
    else if ((m = t.match(/^[-*+•]\s+(.*)/))) { flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${mdInlineToHtml(m[1])}</li>`); }
    else if ((m = t.match(/^\d+[.)]\s+(.*)/))) { flushPara(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${mdInlineToHtml(m[1])}</li>`); }
    else if ((m = t.match(/^>\s?(.*)/))) { flushPara(); closeList(); out.push(`<blockquote>${mdInlineToHtml(m[1])}</blockquote>`); }
    else if (/^(-{3,}|\*{3,})$/.test(t)) { flushPara(); closeList(); out.push('<hr>'); }
    else { closeList(); para.push(t); }
  }
  if (code !== null) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushPara(); closeList();
  return out.join('');
}

const SUGGESTIONS = ['Fasse diese Notiz zusammen', 'Finde Fehler und Unklarheiten', 'Erstelle eine Aufgabenliste daraus', 'Schlage 5 Ideen zum Thema vor', 'Erkläre mir das einfacher'];
const ASK_SUGGESTIONS = ['Welche offenen Aufgaben habe ich?', 'Was habe ich zuletzt notiert?', 'Fasse meine Projekte zusammen', 'Was weiß ich über …'];
const MODES = { note: { label: 'Notiz als Kontext', icon: 'file' }, all: { label: 'Alle Notizen', icon: 'layers' }, none: { label: 'Ohne Kontext', icon: 'x' } };

export class ChatPanel {
  constructor(app, ai) {
    this.app = app;
    this.ai = ai;
    this.histories = new Map(); // Verlauf je Notiz (solange die App läuft)
    this.busy = false;
    this.build();
  }

  get history() {
    const key = this.mode === 'all' ? '__all' : this.app.currentPath || '__none';
    if (!this.histories.has(key)) this.histories.set(key, []);
    return this.histories.get(key);
  }

  get opts() { return this.app.settings.ai?.chat || {}; }
  setOpt(patch) { this.app.saveSettings({ ai: { ...this.app.settings.ai, chat: { ...this.opts, ...patch } } }); }

  build() {
    this.el = h('aside.ai-panel');
    this.list = h('div.ai-messages');
    this.input = h('textarea.ai-input', { rows: 1, placeholder: 'Frag die KI … (Enter senden, Shift+Enter neue Zeile)' });
    this.input.addEventListener('input', () => this.autosize());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.sendFromInput(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    this.sendBtn = h('button.ai-send', { title: 'Senden', onclick: () => (this.busy ? this.stop() : this.sendFromInput()) }, icon('send', 16));
    this.modelBtn = h('button.ai-model-btn', { onclick: (e) => this.pickModel(e.currentTarget) });
    this.ctxBtn = h('button.ai-ctx', { title: 'Was soll die KI mitbekommen?', onclick: (e) => this.pickMode(e.currentTarget) });
    this.el.append(
      h('div.ai-panel-head', {},
        icon('sparkles', 17), h('b', { text: 'KI-Chat' }), h('div.flex'),
        h('button.icon-btn.tiny', { title: 'Chat leeren', onclick: () => this.clear() }, icon('trash', 14)),
        h('button.icon-btn.tiny', { title: 'Einklappen (Strg+Shift+J)', onclick: () => this.close() }, icon('chevronRight', 15))),
      h('div.ai-panel-bar', {}, this.modelBtn, this.ctxBtn),
      this.list,
      h('div.ai-compose', {}, this.input, this.sendBtn));
    document.getElementById('app').append(this.el);
    this.app.events.on('note:open', () => this.renderMessages());
    if (this.opts.open) setTimeout(() => this.open(false), 0);
  }

  /** note = aktuelle Notiz · all = alle Notizen durchsuchen („Frag deine Notizen“) · none = nichts */
  get mode() { const c = this.opts.context; return c === false || c === 'none' ? 'none' : c === 'all' ? 'all' : 'note'; }
  get withContext() { return this.mode === 'note'; }

  setMode(mode) { this.setOpt({ context: mode }); this.renderHeader(); this.renderMessages(); }

  pickMode(anchor) {
    contextMenu([
      { header: 'Kontext für die KI' },
      { label: 'Aktuelle Notiz', icon: 'file', active: this.mode === 'note', run: () => this.setMode('note') },
      { label: 'Alle Notizen (Frag deine Notizen)', icon: 'layers', active: this.mode === 'all', run: () => this.setMode('all') },
      { label: 'Ohne Kontext', icon: 'x', active: this.mode === 'none', run: () => this.setMode('none') }
    ], anchor);
  }

  /** Chat im Modus „Alle Notizen“ öffnen */
  askNotes() { this.setOpt({ context: 'all' }); this.open(); }

  renderHeader() {
    const id = this.opts.provider || this.ai.cfg.defaultProvider;
    const cfg = this.ai.providerConfig(id, this.opts.provider === id ? this.opts.model : undefined);
    this.modelBtn.innerHTML = '';
    this.modelBtn.append(h('span', { text: `${(PROVIDERS[id]?.name || '').split(' (')[0]} · ${cfg.model || '–'}` }), icon('chevronDown', 12));
    const mode = MODES[this.mode];
    this.ctxBtn.className = 'ai-ctx' + (this.mode !== 'none' ? ' on' : '') + (this.mode === 'all' ? ' all' : '');
    this.ctxBtn.innerHTML = '';
    this.ctxBtn.append(icon(mode.icon, 13), h('span', { text: mode.label }), icon('chevronDown', 11));
  }

  pickModel(anchor) {
    const items = [];
    for (const id of Object.keys(PROVIDERS)) {
      const ok = this.ai.isConfigured(id);
      if (!ok) continue;
      const p = PROVIDERS[id];
      const models = [...new Set([this.ai.cfg.providers[id]?.model || p.defaultModel, ...p.models])].filter(Boolean);
      items.push({ header: p.name });
      for (const m of models) items.push({ label: m, active: (this.opts.provider || this.ai.cfg.defaultProvider) === id && (this.opts.model || this.ai.providerConfig(id).model) === m, run: () => { this.setOpt({ provider: id, model: m }); this.renderHeader(); } });
    }
    if (!items.length) { this.ai.needSetup(this.ai.cfg.defaultProvider); return; }
    items.push('-', { label: 'KI-Einstellungen …', icon: 'settings', run: () => this.app.openSettings('ai') });
    contextMenu(items, anchor);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open(focus = true) {
    this.isOpen = true;
    document.body.classList.add('ai-open');
    this.renderHeader();
    this.renderMessages();
    if (!this.opts.open) this.setOpt({ open: true });
    if (focus) setTimeout(() => this.input.focus(), 250);
  }

  close() {
    this.isOpen = false;
    document.body.classList.remove('ai-open');
    if (this.opts.open) this.setOpt({ open: false });
  }

  autosize() { this.input.style.height = 'auto'; this.input.style.height = Math.min(160, this.input.scrollHeight) + 'px'; }

  async clear() {
    if (this.history.length && !(await confirmDialog('Chat leeren?', 'Der Verlauf zu dieser Notiz wird gelöscht.', { okLabel: 'Leeren' }))) return;
    this.history.length = 0;
    this.renderMessages();
  }

  renderMessages() {
    if (!this.isOpen) return;
    this.list.innerHTML = '';
    if (!this.history.length) {
      const all = this.mode === 'all';
      this.list.append(h('div.ai-empty', {},
        h('div.ai-empty-icon', {}, icon(all ? 'layers' : 'sparkles', 26)),
        h('div', { text: all ? 'Frag deine Notizen: Die KI sucht passende Notizen und antwortet mit Quellenangabe.' : this.app.editor?.note ? `Frag etwas zu „${this.app.editor.title}“ oder lass dir beim Schreiben helfen.` : 'Frag die KI etwas.' }),
        h('div.ai-suggest', {}, ...(all ? ASK_SUGGESTIONS : SUGGESTIONS).map((s) => h('button.ai-chipbtn', { text: s, onclick: () => (s.endsWith('…') ? (this.input.value = s.replace(' …', ' '), this.input.focus()) : this.send(s)) }))),
        all ? null : h('button.link-btn.ai-ask-link', { text: '…oder alle Notizen durchsuchen', onclick: () => this.setMode('all') })));
      return;
    }
    this.history.forEach((m, i) => this.list.append(this.messageEl(m, i)));
    this.list.scrollTop = this.list.scrollHeight;
  }

  messageEl(m, i) {
    if (m.role === 'user') return h('div.ai-msg.user', {}, h('div.ai-bubble', { text: m.content }));
    const body = h('div.ai-bubble.md', { html: m.error ? `<div class="ai-error">${escapeHtml(m.error)}</div>` : this.linkNotes(renderMarkdown(m.content)) });
    body.addEventListener('click', (e) => { const a = e.target.closest('[data-note]'); if (a) { e.preventDefault(); this.app.openNote(a.dataset.note); } });
    const actions = m.streaming || m.error ? null : h('div.ai-msg-actions', {},
      h('button', { title: 'Kopieren', onclick: async () => { await navigator.clipboard.writeText(m.content); toast('Kopiert', { duration: 1000 }); } }, icon('copy', 13), 'Kopieren'),
      h('button', { title: 'Als Blöcke in die Notiz einfügen', onclick: () => this.insertIntoNote(m.content) }, icon('plus', 13), 'Einfügen'),
      this.withContext ? h('button', { title: 'Die ganze Notiz durch diese Antwort ersetzen', onclick: () => this.replaceNote(m.content) }, icon('refresh', 13), 'Notiz ersetzen') : null);
    const sources = m.sources?.length && !m.streaming ? h('div.ai-sources', {}, h('span.muted', { text: 'Durchsucht:' }),
      ...m.sources.map((s) => h('button.ai-source', { title: s.path, onclick: () => this.app.openNote(s.path) }, icon('file', 12), s.name))) : null;
    return h('div.ai-msg.assistant', { dataset: { index: i } }, body, m.note ? h('div.ai-note', { text: m.note }) : null, sources, actions);
  }

  /** [[Notiztitel]] in Antworten → klickbare Links zur Notiz */
  linkNotes(html) {
    const notes = this.app.sidebar?.allNotes() || [];
    return html.replace(/\[\[([^\]]{1,200})\]\]/g, (whole, title) => {
      const t = title.replace(/&amp;/g, '&').trim().toLowerCase();
      const n = notes.find((x) => x.name.toLowerCase() === t || x.path.replace(/\.alenote$/, '').toLowerCase() === t);
      return n ? `<a href="#" class="ai-note-link" data-note="${escapeHtml(n.path)}">📄 ${escapeHtml(n.name)}</a>` : `<span class="ai-note-link missing">${title}</span>`;
    });
  }

  sendFromInput() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    this.autosize();
    this.send(text);
  }

  async send(text, { withContext } = {}) {
    const mode = withContext === undefined ? this.mode : withContext ? 'note' : 'none';
    const providerId = this.opts.provider || this.ai.cfg.defaultProvider;
    if (!this.ai.isConfigured(providerId)) { this.ai.needSetup(providerId); return; }
    if (!this.isOpen) this.open(false);
    const editor = this.app.editor;
    let system = 'Du bist ein hilfreicher Assistent in der Notiz-App AleNote. Antworte in der Sprache des Nutzers, klar und gut strukturiert. Nutze Markdown (Überschriften, Listen, - [ ] Aufgaben, Tabellen).';
    let sources = null;
    if (mode === 'all') {
      // Passende Notizen suchen (vorherige Fragen helfen bei Rückfragen wie „und wann?“)
      const prev = this.history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join(' ');
      const found = await findRelevantNotes(this.app, text + ' ' + prev);
      sources = found.map((n) => ({ path: n.path, name: n.name }));
      system += '\n\n' + buildNotesContext(found, this.app.sidebar.allNotes().map((n) => n.name));
    } else if (mode === 'note' && editor?.note) {
      system += `\n\nDie aktuell geöffnete Notiz „${editor.title}“ (Markdown). Wenn der Nutzer eine überarbeitete Fassung der Notiz möchte, gib die komplette neue Notiz in Markdown zurück.\n<<<\n${blocksToMarkdown(editor, editor.note.blocks)}\n>>>`;
    }
    const hist = this.history;
    hist.push({ role: 'user', content: text });
    const reply = { role: 'assistant', content: '', streaming: true, sources };
    hist.push(reply);
    this.renderMessages();
    const bubble = this.list.lastElementChild.querySelector('.ai-bubble');
    bubble.innerHTML = '<span class="ai-spinner"></span>';
    this.setBusy(true);
    this.abort = new AbortController();
    try {
      const res = await streamChat(this.ai.providerConfig(providerId, this.opts.provider === providerId ? this.opts.model : undefined), {
        system,
        messages: hist.filter((m) => m !== reply && !m.error).map((m) => ({ role: m.role, content: m.content })),
        signal: this.abort.signal,
        onText: (_, all) => { reply.content = all; bubble.innerHTML = this.linkNotes(renderMarkdown(all)); this.list.scrollTop = this.list.scrollHeight; }
      });
      reply.content = res.text;
      reply.note = res.note;
    } catch (e) {
      if (e.name !== 'AbortError') reply.error = e.message;
      else if (!reply.content) reply.error = 'Abgebrochen';
    }
    reply.streaming = false;
    this.setBusy(false);
    this.renderMessages();
  }

  stop() { this.abort?.abort(); }

  setBusy(b) {
    this.busy = b;
    this.sendBtn.innerHTML = '';
    this.sendBtn.append(icon(b ? 'stop' : 'send', 16));
    this.sendBtn.title = b ? 'Stopp' : 'Senden';
    this.sendBtn.classList.toggle('busy', b);
  }

  insertIntoNote(md) {
    const editor = this.app.editor;
    if (!editor?.note) return;
    const blocks = mdToBlocks(cleanResult(md), editor);
    const focusId = document.activeElement?.closest?.('.block')?.dataset.id || editor.selectedBlockId;
    const idx = focusId && editor.index(focusId) >= 0 ? editor.index(focusId) + 1 : editor.note.blocks.length;
    editor.note.blocks.splice(idx, 0, ...blocks);
    editor.renderAll();
    editor.changed(true);
    toast(`${blocks.length} Blöcke eingefügt · Strg+Z macht es rückgängig`, { type: 'success', duration: 2000 });
  }

  async replaceNote(md) {
    const editor = this.app.editor;
    if (!editor?.note) return;
    if (!(await confirmDialog('Notiz ersetzen?', 'Der Inhalt der Notiz wird durch die KI-Antwort ersetzt. Mit Strg+Z kannst du das rückgängig machen.', { okLabel: 'Ersetzen', danger: false }))) return;
    editor.note.blocks = mdToBlocks(cleanResult(md), editor);
    if (!editor.note.blocks.length) editor.note.blocks.push(editor.newBlock('paragraph'));
    editor.renderAll();
    editor.changed(true);
  }
}
