// Schwebende Formatierungsleiste bei Textauswahl
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { prompt } from './overlays.js';
import { BLOCK_COLORS } from './editor.js';

export class InlineToolbar {
  constructor(editor) {
    this.editor = editor;
    this.el = h('div.inline-toolbar');
    const btn = (name, title, run) => {
      const b = h('button.tb-btn', { title, dataset: { cmd: name } }, icon(name, 15));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); run(b); });
      return b;
    };
    this.el.append(
      btn('bold', 'Fett (Strg+B)', () => this.exec('bold')),
      btn('italic', 'Kursiv (Strg+I)', () => this.exec('italic')),
      btn('underline', 'Unterstrichen (Strg+U)', () => this.exec('underline')),
      btn('strike', 'Durchgestrichen (Strg+Shift+S)', () => this.exec('strikeThrough')),
      btn('code', 'Inline-Code (Strg+E)', () => this.toggleCode()),
      h('div.tb-sep'),
      btn('link', 'Link (Strg+K)', () => this.link()),
      btn('palette', 'Farbe', (b) => this.colors(b)),
      h('div.tb-sep'),
      (() => {
        const b = h('button.tb-btn.tb-ai', { title: 'KI (Strg+J)' }, icon('sparkles', 15), h('span', { text: 'KI' }));
        b.addEventListener('mousedown', (e) => { e.preventDefault(); this.aiMenu(b); });
        return b;
      })()
    );
    this.colorPanel = null;
    document.body.append(this.el);
    document.addEventListener('selectionchange', () => requestAnimationFrame(() => this.update()));
    document.addEventListener('keydown', (e) => this.shortcuts(e), true);
  }

  editable() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const node = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    const ed = node?.closest?.('[data-field]');
    if (!ed || ed.dataset.plain || !this.editor.blocksEl?.contains(ed)) return null;
    return ed;
  }

  update() {
    const sel = window.getSelection();
    const ed = this.editable();
    if (!ed || sel.isCollapsed || !sel.toString().trim()) { this.hide(); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { this.hide(); return; }
    this.el.classList.add('visible');
    const tw = this.el.offsetWidth;
    let x = rect.left + rect.width / 2 - tw / 2;
    x = Math.max(8, Math.min(innerWidth - tw - 8, x));
    let y = rect.top - this.el.offsetHeight - 10;
    if (y < 48 || document.body.classList.contains('touch')) y = rect.bottom + 14;
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
    for (const [cmd, q] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough']]) {
      this.el.querySelector(`[data-cmd="${cmd}"]`).classList.toggle('active', document.queryCommandState(q));
    }
  }

  hide() {
    this.el.classList.remove('visible');
    this.colorPanel?.remove();
    this.colorPanel = null;
  }

  exec(cmd, value = null) {
    document.execCommand('styleWithCSS', false, cmd === 'foreColor' || cmd === 'hiliteColor');
    document.execCommand(cmd, false, value);
    this.update();
  }

  toggleCode() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const ed = this.editable();
    if (!ed) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const existing = node.closest('code');
    if (existing && ed.contains(existing)) {
      existing.replaceWith(...existing.childNodes);
    } else {
      const code = document.createElement('code');
      code.textContent = range.toString();
      range.deleteContents();
      range.insertNode(code);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(code);
      sel.addRange(r);
    }
    ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatCode' }));
  }

  async link() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0).cloneRange();
    const url = await prompt('Link einfügen', { placeholder: 'https://…', okLabel: 'Verlinken' });
    sel.removeAllRanges();
    sel.addRange(range);
    if (!url) return;
    this.exec('createLink', /^[a-z]+:/i.test(url) ? url : 'https://' + url);
  }

  colors(anchor) {
    if (this.colorPanel) { this.colorPanel.remove(); this.colorPanel = null; return; }
    const panel = h('div.tb-colors');
    const row = (label, cmd, prefix) => {
      const r = h('div.tb-color-row', {}, h('span.tb-color-label', { text: label }));
      for (const c of BLOCK_COLORS) {
        const sw = h('button.tb-swatch', { title: c.name, style: { background: c.id ? `var(${prefix}${c.id})` : (cmd === 'foreColor' ? 'var(--text)' : 'transparent') } });
        if (!c.id && cmd === 'hiliteColor') sw.classList.add('none');
        sw.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const value = c.id ? getComputedStyle(document.documentElement).getPropertyValue(prefix + c.id).trim() : (cmd === 'foreColor' ? 'inherit' : 'transparent');
          this.exec(cmd, value);
        });
        r.append(sw);
      }
      return r;
    };
    panel.append(row('Text', 'foreColor', '--c-'), row('Marker', 'hiliteColor', '--bg-'));
    this.el.append(panel);
    this.colorPanel = panel;
    void anchor;
  }

  /** KI-Aktionen für den markierten Text */
  aiMenu(anchor) {
    const ai = this.editor.app.ai;
    if (!ai) return;
    const sel = window.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const target = ai.captureTarget('selection');
    if (!target) return;
    import('./overlays.js').then(({ contextMenu }) => contextMenu([
      { header: 'KI · markierter Text' },
      { label: 'Eigene Anweisung …', icon: 'sparkles', shortcut: 'Ctrl+J', run: () => { if (range) { sel.removeAllRanges(); sel.addRange(range); } ai.openCommandBar(); } },
      '-',
      ...ai.toolbarActions().map((a) => ({ label: `${a.icon || ''} ${a.name}`.trim(), run: () => ai.run(a, { target }) }))
    ], anchor));
  }

  shortcuts(e) {
    if (!(e.ctrlKey || e.metaKey) || !this.editable()) return;
    const k = e.key.toLowerCase();
    if (k === 'e') { e.preventDefault(); this.toggleCode(); }
    else if (k === 'k' && !window.getSelection().isCollapsed) { e.preventDefault(); e.stopPropagation(); this.link(); }
    else if (k === 's' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); this.exec('strikeThrough'); }
  }
}
