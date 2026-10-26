// Block-Editor von AleNote
// Eine Notiz besteht aus Blöcken: { id, type, data, indent?, color? }
// und frei beweglichen Bildern (floats): { id, src, x, y, w, rot, z }

import { h, uid, debounce, setPath, placeCaret, setCaretOffset, getCaretOffset, isCaretAtStart, isCaretAtEnd,
  isCaretOnFirstLine, isCaretOnLastLine, splitAtCaret, isEmptyHtml, getCaretClientRect, sanitizeHtml, clamp, stripHtml } from '../core/utils.js';
import { History } from '../core/history.js';
import { icon } from './icons.js';
import { contextMenu, toast, popover } from './overlays.js';
import { SlashMenu } from './slashmenu.js';
import { InlineToolbar } from './toolbar.js';
import { FloatLayer } from './floats.js';
import { emojiPicker, coverPicker, GRADIENTS } from './pickers.js';

export const BLOCK_COLORS = [
  { id: '', name: 'Standard' },
  { id: 'gray', name: 'Grau' }, { id: 'brown', name: 'Braun' }, { id: 'orange', name: 'Orange' }, { id: 'yellow', name: 'Gelb' },
  { id: 'green', name: 'Grün' }, { id: 'blue', name: 'Blau' }, { id: 'purple', name: 'Lila' }, { id: 'pink', name: 'Pink' }, { id: 'red', name: 'Rot' }
];

export class Editor {
  constructor(app, root) {
    this.app = app;
    this.registry = app.registry;
    this.root = root;
    this.note = null;
    this.path = null;
    this.history = new History();
    this.selectedBlockId = null;
    this.slash = new SlashMenu(this);
    this.toolbar = new InlineToolbar(this);
    this.pushHistory = debounce(() => this.commit(), 450);
    this.bindGlobal();
  }

  // ================= Laden & Rendern =================

  load(note, path) {
    this.note = note;
    this.path = path;
    this.note.blocks ||= [];
    this.note.floats ||= [];
    if (!this.note.blocks.length) this.note.blocks.push(this.newBlock('paragraph'));
    this.history.reset(this.snapshot());
    this.renderAll();
    this.root.scrollTop = 0;
  }

  get title() { return this.path ? this.path.split('/').pop().replace(/\.alenote$/, '') : ''; }

  renderAll() {
    const { note } = this;
    this.slash.close();
    this.root.innerHTML = '';
    this.root.classList.toggle('full-width', !!note.fullWidth);

    // Titelbild
    if (note.cover) {
      const cover = h('div.cover', {},
        h('div.cover-actions', {},
          h('button.chip', { onclick: (e) => this.pickCover(e.currentTarget) }, icon('image', 14), 'Ändern'),
          h('button.chip', { onclick: () => { note.cover = null; this.changed(true); this.renderAll(); } }, icon('trash', 14), 'Entfernen')));
      if (note.cover.type === 'image') cover.style.backgroundImage = `url("${note.cover.src}")`;
      else cover.style.background = GRADIENTS[note.cover.value] || note.cover.value;
      this.root.append(cover);
    }

    this.page = h('div.page' + (note.cover ? '.has-cover' : ''));
    const header = h('div.page-header');
    if (note.icon) header.append(h('button.note-icon', { text: note.icon, title: 'Icon ändern', onclick: (e) => this.pickIcon(e.currentTarget) }));
    const actions = h('div.page-header-actions', {},
      !note.icon ? h('button.chip.ghost', { onclick: (e) => this.pickIcon(e.currentTarget) }, '😀', 'Icon hinzufügen') : null,
      !note.cover ? h('button.chip.ghost', { onclick: () => { note.cover = { type: 'gradient', value: Object.keys(GRADIENTS)[Math.floor(Math.random() * 6)] }; this.changed(true); this.renderAll(); } }, icon('image', 14), 'Titelbild') : null);
    header.append(actions);

    this.titleEl = h('h1.note-title', { contenteditable: 'plaintext-only', spellcheck: 'false', 'data-placeholder': 'Unbenannt', text: this.title });
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === 'ArrowDown')) {
        e.preventDefault();
        this.app.renameCurrent(this.titleEl.textContent);
        const first = this.note.blocks[0];
        if (first) this.focusBlock(first.id, 'start');
      }
    });
    this.titleEl.addEventListener('blur', () => this.app.renameCurrent(this.titleEl.textContent));
    header.append(this.titleEl);
    this.page.append(header);

    this.blocksEl = h('div.blocks');
    this.page.append(this.blocksEl);
    note.blocks.forEach((b) => this.blocksEl.append(this.renderRow(b)));
    this.updateNumbering();

    // Klick unter dem letzten Block → neuen Absatz anlegen
    const tail = h('div.page-tail', { onclick: () => this.focusEndOrCreate() });
    this.page.append(tail);

    this.floats?.destroy();
    this.floats = new FloatLayer(this, this.page);
    this.floats.render();

    this.root.append(this.page);
    this.app.events.emit('editor:render', this);
  }

  renderRow(block) {
    const def = this.registry.blocks.get(block.type) || this.registry.blocks.get('paragraph');
    const row = h('div.block', { dataset: { id: block.id, type: block.type } });
    if (block.indent) row.style.setProperty('--indent', block.indent);
    if (block.color) row.dataset.color = block.color;

    const add = h('button.gutter-btn', { title: 'Klicken: Block hinzufügen' }, icon('plus', 16));
    add.addEventListener('click', () => this.insertWithSlash(block.id));
    const grip = h('button.gutter-btn.grip', { title: 'Ziehen: verschieben\nKlicken: Menü' }, icon('grip', 16));
    grip.addEventListener('pointerdown', (e) => this.startDrag(e, block.id, grip));
    row.append(h('div.block-gutter', {}, add, grip));

    const content = h('div.block-content');
    try {
      content.append(def.render(block, this.ctx(block)));
    } catch (err) {
      console.error(err);
      content.append(h('div.block-error', { text: `Block "${block.type}" konnte nicht angezeigt werden: ${err.message}` }));
    }
    row.append(content);
    return row;
  }

  /** Kontext-Objekt, das jeder Block beim Rendern bekommt */
  ctx(block) {
    const editor = this;
    return {
      editor,
      app: this.app,
      block,
      update(patch, { rerender = false, commit = true } = {}) {
        Object.assign(block.data, patch);
        if (rerender) editor.rerenderBlock(block.id);
        editor.changed(commit);
      },
      rerender: () => this.rerenderBlock(block.id),
      remove: () => this.removeBlock(block.id),
      insertAfter: (type, data) => this.insertBlock(type, data, block.id),
      focusNext: () => this.focusSibling(block.id, 1, 'start'),
      focusPrev: () => this.focusSibling(block.id, -1, 'end')
    };
  }

  rerenderBlock(id, { focus } = {}) {
    if (this.floats?.hasBlock(id)) return this.floats.rerenderBlock(id);
    const old = this.rowEl(id);
    const block = this.block(id);
    if (!old || !block) return;
    const row = this.renderRow(block);
    old.replaceWith(row);
    if (this.selectedBlockId === id) row.classList.add('selected');
    this.updateNumbering();
    if (focus) this.focusBlock(id, focus);
    return row;
  }

  updateNumbering() {
    const counters = [];
    let prevType = null;
    for (const b of this.note.blocks) {
      const indent = b.indent || 0;
      if (b.type === 'numbered') {
        if (prevType !== 'numbered' && !(counters[indent] && prevType)) counters.length = 0;
        counters.length = indent + 1;
        counters[indent] = (counters[indent] || 0) + 1;
        const el = this.rowEl(b.id)?.querySelector('.list-marker');
        if (el) el.textContent = this.formatNumber(counters[indent], indent) + '.';
      } else if (!(b.indent > 0 && prevType === 'numbered')) {
        counters.length = 0;
      }
      prevType = b.type === 'numbered' || (b.indent > 0 && prevType === 'numbered') ? 'numbered' : b.type;
    }
  }

  formatNumber(n, indent) {
    if (indent % 3 === 1) return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    if (indent % 3 === 2) return ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][(n - 1) % 10];
    return String(n);
  }

  // ================= Zugriff =================

  block(id) { return this.note?.blocks.find((b) => b.id === id) || this.note?.floats.find((f) => f.block?.id === id)?.block; }
  index(id) { return this.note.blocks.findIndex((b) => b.id === id); }
  rowEl(id) { return (this.page || this.blocksEl)?.querySelector(`.block[data-id="${id}"]`); }
  mainEditable(id) { return this.rowEl(id)?.querySelector('[data-editable="main"]'); }
  def(type) { return this.registry.blocks.get(type); }

  newBlock(type, data = {}) {
    const def = this.def(type) || this.def('paragraph');
    return { id: uid(), type: def.type, data: { ...def.create(), ...data } };
  }

  // ================= Änderungen =================

  snapshot() {
    const { blocks, floats, icon: ic, cover, fullWidth } = this.note;
    return JSON.stringify({ blocks, floats, icon: ic, cover, fullWidth });
  }

  commit() {
    this.pushHistory.cancel();
    this.history.push(this.snapshot());
  }

  /** Muss nach jeder Änderung aufgerufen werden: speichert & aktualisiert den Verlauf */
  changed(immediateCommit = false) {
    if (!this.note) return;
    this.note.updated = Date.now();
    this.app.dirty = true;
    if (immediateCommit) this.commit(); else this.pushHistory();
    this.app.scheduleSave();
    this.app.events.emit('note:change', this.note, this);
  }

  restore(snap) {
    if (!snap) return;
    const focusedId = document.activeElement?.closest?.('.block')?.dataset.id;
    Object.assign(this.note, JSON.parse(snap));
    this.renderAll();
    this.app.scheduleSave();
    this.app.events.emit('note:change', this.note, this);
    if (focusedId && this.block(focusedId)) this.focusBlock(focusedId, 'end');
  }

  undo() { this.pushHistory.flush(); this.restore(this.history.undo()); }
  redo() { this.restore(this.history.redo()); }

  // ================= Block-Operationen =================

  insertBlock(type, data = {}, afterId = null, { focus = 'start', before = false, animate = true } = {}) {
    const block = typeof type === 'object' ? type : this.newBlock(type, data);
    let idx = afterId ? this.index(afterId) + (before ? 0 : 1) : this.note.blocks.length;
    if (idx < 0) idx = this.note.blocks.length;
    this.note.blocks.splice(idx, 0, block);
    const row = this.renderRow(block);
    if (animate) row.classList.add('enter');
    const nextId = this.note.blocks[idx + 1]?.id;
    this.blocksEl.insertBefore(row, (nextId && this.rowEl(nextId)) || null);
    this.updateNumbering();
    this.changed(true);
    if (focus) this.focusBlock(block.id, focus);
    return block;
  }

  removeBlock(id, { animate = false, focusPrev = false } = {}) {
    const idx = this.index(id);
    if (idx < 0) return;
    const prev = this.note.blocks[idx - 1];
    const next = this.note.blocks[idx + 1];
    this.note.blocks.splice(idx, 1);
    const row = this.rowEl(id);
    if (animate && row) { row.classList.add('leaving'); setTimeout(() => row.remove(), 200); }
    else row?.remove();
    if (this.selectedBlockId === id) this.selectedBlockId = null;
    if (!this.note.blocks.length) this.insertBlock('paragraph', {}, null, { focus: 'start' });
    this.updateNumbering();
    this.changed(true);
    if (focusPrev) {
      const target = prev || next;
      if (target) this.focusBlock(target.id, prev ? 'end' : 'start');
    }
  }

  duplicateBlock(id) {
    const b = this.block(id);
    if (!b) return;
    const copy = structuredClone(b);
    copy.id = uid();
    this.insertBlock(copy, null, id, { focus: 'end' });
  }

  moveBlock(id, toIndex) {
    const from = this.index(id);
    if (from < 0) return;
    const [b] = this.note.blocks.splice(from, 1);
    if (toIndex > from) toIndex--;
    this.note.blocks.splice(toIndex, 0, b);
    const row = this.rowEl(id);
    const first = new Map([...this.blocksEl.children].map((el) => [el, el.getBoundingClientRect().top]));
    const nextId = this.note.blocks[toIndex + 1]?.id;
    this.blocksEl.insertBefore(row, (nextId && this.rowEl(nextId)) || null);
    // FLIP-Animation
    for (const el of this.blocksEl.children) {
      const dy = first.get(el) - el.getBoundingClientRect().top;
      if (!dy) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 700);
    this.updateNumbering();
    this.changed(true);
  }

  /** Block in anderen Typ umwandeln (Text bleibt erhalten, wenn möglich) */
  convertBlock(id, type, extra = {}) {
    const b = this.block(id);
    const def = this.def(type);
    if (!b || !def) return;
    const oldDef = this.def(b.type);
    const text = b.data.text;
    if (!def.text && oldDef?.text && !isEmptyHtml(text)) {
      // Nicht-Text-Block: unterhalb einfügen statt Text zu verlieren
      const nb = this.insertBlock(type, extra, id, { focus: false });
      this.afterNonTextInsert(nb);
      return nb;
    }
    b.type = type;
    b.data = { ...def.create(), ...extra };
    if (def.text && text != null) b.data.text = text;
    this.rerenderBlock(id);
    this.changed(true);
    if (def.text) this.focusBlock(id, 'end'); else this.afterNonTextInsert(b);
    return b;
  }

  afterNonTextInsert(block) {
    const idx = this.index(block.id);
    const next = this.note.blocks[idx + 1];
    const def = this.def(block.type);
    if (def.focusOnInsert) { def.focusOnInsert(this.rowEl(block.id), this.ctx(block)); return; }
    if (next && this.def(next.type)?.text) this.focusBlock(next.id, 'start');
    else this.insertBlock('paragraph', {}, block.id);
  }

  setIndent(id, delta) {
    const b = this.block(id);
    if (!b) return;
    const idx = this.index(id);
    const prev = this.note.blocks[idx - 1];
    const max = prev ? (prev.indent || 0) + 1 : 0;
    const val = clamp((b.indent || 0) + delta, 0, Math.min(6, Math.max(max, b.indent || 0)));
    if (val === (b.indent || 0)) return;
    const offset = getCaretOffset(this.mainEditable(id));
    b.indent = val || undefined;
    this.rowEl(id).style.setProperty('--indent', val);
    if (b.type === 'bullet') this.rerenderBlock(id);
    this.updateNumbering();
    this.changed(true);
    setCaretOffset(this.mainEditable(id), offset);
  }

  setColor(id, color) {
    const b = this.block(id);
    if (!b) return;
    b.color = color || undefined;
    const row = this.rowEl(id);
    if (color) row.dataset.color = color; else delete row.dataset.color;
    this.changed(true);
  }

  // ================= Fokus =================

  focusBlock(id, pos = 'end') {
    const row = this.rowEl(id);
    if (!row) return;
    const el = row.querySelector('[data-editable="main"]') || row.querySelector('[contenteditable]:not([contenteditable="false"])');
    if (!el) { this.selectBlock(id); return; }
    this.selectBlock(null);
    if (typeof pos === 'number') setCaretOffset(el, pos);
    else if (pos && typeof pos === 'object') this.focusAtX(el, pos.x, pos.fromBelow);
    else placeCaret(el, pos !== 'start');
    el.scrollIntoView({ block: 'nearest' });
  }

  focusAtX(el, x, fromBelow) {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const y = fromBelow ? r.bottom - 6 : r.top + 6;
    const range = document.caretRangeFromPoint?.(clamp(x, r.left + 1, r.right - 2), y);
    if (range && el.contains(range.startContainer)) {
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else placeCaret(el, fromBelow);
  }

  focusSibling(id, dir, pos) {
    let idx = this.index(id) + dir;
    while (idx >= 0 && idx < this.note.blocks.length) {
      const b = this.note.blocks[idx];
      if (this.mainEditable(b.id)) { this.focusBlock(b.id, pos); return true; }
      if (!this.def(b.type)?.text) { this.selectBlock(b.id); return true; }
      idx += dir;
    }
    if (dir < 0 && idx < 0) { placeCaret(this.titleEl, true); return true; }
    return false;
  }

  focusEndOrCreate() {
    const last = this.note.blocks.at(-1);
    if (last && this.def(last.type)?.text && isEmptyHtml(last.data.text) && last.type === 'paragraph') this.focusBlock(last.id, 'end');
    else this.insertBlock('paragraph', {}, last?.id);
  }

  selectBlock(id) {
    if (this.selectedBlockId) this.rowEl(this.selectedBlockId)?.classList.remove('selected');
    this.selectedBlockId = id;
    if (id) {
      const row = this.rowEl(id);
      row?.classList.add('selected');
      document.activeElement?.blur?.();
      row?.scrollIntoView({ block: 'nearest' });
    }
  }

  // ================= Slash-Menü =================

  insertWithSlash(afterId) {
    const b = this.block(afterId);
    let target;
    if (b && b.type === 'paragraph' && isEmptyHtml(b.data.text)) target = b;
    else target = this.insertBlock('paragraph', {}, afterId, { focus: false });
    const el = this.mainEditable(target.id);
    placeCaret(el, true);
    document.execCommand('insertText', false, '/');
  }

  openSlash(blockId, el) {
    const offset = getCaretOffset(el) - 1;
    const rect = getCaretClientRect();
    this.slash.open(rect, {
      onQuery: () => {
        const caret = getCaretOffset(el);
        if (document.activeElement !== el || caret <= offset) return null;
        const text = (el.textContent || '').replace(/ /g, ' ');
        if (text[offset] !== '/') return null;
        return text.slice(offset + 1, caret);
      },
      onSelect: (item) => this.runSlashItem(item, blockId, el, offset)
    });
  }

  removeTextRange(el, start, end) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let pos = 0, node, startSet = false;
    while ((node = walker.nextNode())) {
      const len = node.length;
      if (!startSet && start <= pos + len) { range.setStart(node, start - pos); startSet = true; }
      if (startSet && end <= pos + len) { range.setEnd(node, end - pos); break; }
      pos += len;
    }
    if (!startSet) return;
    range.deleteContents();
    el.normalize();
    if (el.innerHTML === '<br>') el.innerHTML = '';
    const sel = window.getSelection();
    sel.removeAllRanges();
    range.collapse(true);
    sel.addRange(range);
  }

  async runSlashItem(item, blockId, el, offset) {
    const caret = getCaretOffset(el);
    this.removeTextRange(el, offset, Math.max(caret, offset + 1));
    const block = this.block(blockId);
    if (!block) return;
    block.data.text = el.innerHTML;
    this.changed();
    if (item.kind === 'block') {
      if (isEmptyHtml(block.data.text) && this.def(block.type).text) this.convertBlock(blockId, item.type, item.preset || {});
      else {
        const nb = this.insertBlock(item.type, item.preset || {}, blockId, { focus: this.def(item.type).text ? 'start' : false });
        if (!this.def(item.type).text) this.afterNonTextInsert(nb);
      }
    } else {
      setCaretOffset(el, offset);
      try { await item.run(this, { blockId, el, app: this.app }); }
      catch (err) { toast('Fehler: ' + err.message, { type: 'error' }); console.error(err); }
    }
  }

  // ================= Text einfügen (für Hotkeys / Plugins) =================

  /** Fügt Text an der Cursorposition ein (oder als neuen Absatz am Ende) */
  insertText(text) {
    const active = document.activeElement;
    const inEditor = active && this.blocksEl?.contains(active) && active.isContentEditable;
    const lines = String(text).split(/\r?\n/);
    if (!inEditor) {
      let after = this.note.blocks.at(-1)?.id;
      lines.forEach((line, i) => {
        const b = this.insertBlock('paragraph', { text: escapeText(line) }, after, { focus: i === lines.length - 1 ? 'end' : false });
        after = b.id;
      });
      return;
    }
    if (lines.length === 1 || !active.matches('[data-editable="main"]')) {
      document.execCommand('insertText', false, lines.join('\n'));
      return;
    }
    document.execCommand('insertText', false, lines[0]);
    let afterId = active.closest('.block').dataset.id;
    lines.slice(1).forEach((line, i, arr) => {
      const b = this.insertBlock('paragraph', { text: escapeText(line) }, afterId, { focus: i === arr.length - 1 ? 'end' : false });
      afterId = b.id;
    });
  }

  // ================= Ereignisse =================

  bindGlobal() {
    const root = this.root;

    root.addEventListener('input', (e) => {
      const target = e.target.closest?.('[data-field]');
      const row = target?.closest('.block');
      if (!target || !row) return;
      const block = this.block(row.dataset.id);
      if (!block) return;
      if (!target.dataset.plain && target.innerHTML === '<br>') target.innerHTML = '';
      const value = target.dataset.plain ? target.innerText.replace(/\n$/, '') : target.innerHTML;
      setPath(block.data, target.dataset.field, value);
      this.changed();

      if (target.dataset.editable === 'main' && this.def(block.type)?.text) {
        if (e.inputType === 'insertText' && e.data === '/') {
          const off = getCaretOffset(target);
          const prevChar = (target.textContent || '')[off - 2];
          if (off === 1 || /\s| /.test(prevChar || ' ')) this.openSlash(block.id, target);
        } else if (this.slash.isOpen) {
          this.slash.refresh();
        }
        if (e.inputType === 'insertText' && !this.slash.isOpen) this.checkMarkdown(block, target);
      }
    });

    root.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keydown', (e) => {
      if (!this.selectedBlockId || !this.root.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== this.root) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removeBlock(this.selectedBlockId, { animate: true, focusPrev: true }); }
      else if (e.key === 'Enter') { e.preventDefault(); const id = this.selectedBlockId; this.selectBlock(null); this.focusBlock(id, 'end'); }
    });

    root.addEventListener('paste', (e) => this.onPaste(e));

    root.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && a.closest('.blocks')) {
        e.preventDefault();
        if (e.ctrlKey || !a.isContentEditable) this.app.api.openExternal(a.href);
        else toast('Strg + Klick öffnet den Link');
      }
      if (!e.target.closest('.block') && !e.target.closest('.float-item') && this.selectedBlockId) this.selectBlock(null);
    });

    root.addEventListener('mousedown', (e) => {
      const row = e.target.closest('.block');
      if (row && !e.target.closest('[contenteditable], button, input, .gutter-btn')) {
        const b = this.block(row.dataset.id);
        if (b && !this.def(b.type)?.text) { this.selectBlock(b.id); }
      }
    });

    // Dateien (Bilder) per Drag & Drop
    root.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); root.classList.add('drop-target'); }
    });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop-target'); });
    root.addEventListener('drop', async (e) => {
      root.classList.remove('drop-target');
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length || !this.note) return;
      e.preventDefault();
      if (e.target.closest('.image-block')) return; // vom Bildblock selbst behandelt
      const urls = await Promise.all(files.map((f) => this.app.saveImageFile(f)));
      if (e.shiftKey) {
        const pr = this.page.getBoundingClientRect();
        urls.forEach((src, i) => this.floats.add(src, e.clientX - pr.left - 150 + i * 30, e.clientY - pr.top - 100 + i * 30));
      } else {
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('.block');
        let after = row?.dataset.id || this.note.blocks.at(-1)?.id;
        for (const src of urls) after = this.insertBlock('image', { src }, after, { focus: false }).id;
      }
      toast(urls.length > 1 ? `${urls.length} Bilder eingefügt` : 'Bild eingefügt', { type: 'success' });
    });
  }

  onKeyDown(e) {
    const target = e.target;
    if (this.slash.isOpen && this.slash.handleKey(e)) return;

    if (!target.matches?.('[data-editable="main"]')) return;
    const row = target.closest('.block');
    const block = this.block(row?.dataset.id);
    if (!block) return;
    const def = this.def(block.type);
    if (def.onKeyDown?.(e, this.ctx(block), target)) return;
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      this.handleEnter(block, def, target);
    } else if (e.key === 'Backspace' && !mod && isCaretAtStart(target)) {
      if (this.handleBackspace(block, def, target)) e.preventDefault();
    } else if (e.key === 'Delete' && isCaretAtEnd(target)) {
      const next = this.note.blocks[this.index(block.id) + 1];
      if (next && this.def(next.type)?.text) {
        e.preventDefault();
        const off = getCaretOffset(target);
        block.data.text = (block.data.text || '') + (next.data.text || '');
        this.removeBlock(next.id);
        this.rerenderBlock(block.id, { focus: off });
      }
    } else if (e.key === 'ArrowUp' && !e.shiftKey && isCaretOnFirstLine(target)) {
      e.preventDefault();
      const x = getCaretClientRect()?.left ?? 0;
      this.focusSiblingAtX(block.id, -1, x);
    } else if (e.key === 'ArrowDown' && !e.shiftKey && isCaretOnLastLine(target)) {
      e.preventDefault();
      const x = getCaretClientRect()?.left ?? 0;
      this.focusSiblingAtX(block.id, 1, x);
    } else if (e.key === 'ArrowLeft' && !e.shiftKey && isCaretAtStart(target)) {
      e.preventDefault();
      this.focusSibling(block.id, -1, 'end');
    } else if (e.key === 'ArrowRight' && !e.shiftKey && isCaretAtEnd(target)) {
      if (this.focusSibling(block.id, 1, 'start')) e.preventDefault();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.setIndent(block.id, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.selectBlock(block.id);
    }
  }

  focusSiblingAtX(id, dir, x) {
    let idx = this.index(id) + dir;
    while (idx >= 0 && idx < this.note.blocks.length) {
      const b = this.note.blocks[idx];
      const el = this.mainEditable(b.id);
      if (el) { this.selectBlock(null); this.focusAtX(el, x, dir < 0); return; }
      if (!this.def(b.type)?.text) { this.selectBlock(b.id); return; }
      idx += dir;
    }
    if (dir < 0) placeCaret(this.titleEl, true);
  }

  handleEnter(block, def, el) {
    const empty = isEmptyHtml(el.innerHTML);
    if (def.continues && empty) {
      if (block.indent) this.setIndent(block.id, -1);
      else this.convertBlock(block.id, 'paragraph');
      return;
    }
    if (isCaretAtStart(el) && !empty) {
      const nb = this.newBlock(def.continues ? block.type : 'paragraph');
      nb.indent = block.indent;
      this.insertBlock(nb, null, block.id, { before: true, focus: false });
      this.focusBlock(block.id, 'start');
      return;
    }
    const [before, after] = splitAtCaret(el);
    block.data.text = isEmptyHtml(before) ? '' : before;
    el.innerHTML = block.data.text;
    const type = def.continues ? block.type : 'paragraph';
    const nb = this.newBlock(type, { text: isEmptyHtml(after) ? '' : after });
    if (block.indent) nb.indent = block.indent;
    if (def.continues && block.color) nb.color = block.color;
    this.insertBlock(nb, null, block.id, { focus: 'start' });
  }

  handleBackspace(block, def, el) {
    if (!window.getSelection().isCollapsed) return false;
    if (block.indent) { this.setIndent(block.id, -1); return true; }
    if (block.type !== 'paragraph') { this.convertBlock(block.id, 'paragraph'); this.focusBlock(block.id, 'start'); return true; }
    const idx = this.index(block.id);
    const prev = this.note.blocks[idx - 1];
    if (!prev) {
      if (isEmptyHtml(block.data.text) && this.note.blocks.length > 1) { this.removeBlock(block.id); this.focusBlock(this.note.blocks[0].id, 'start'); return true; }
      placeCaret(this.titleEl, true);
      return true;
    }
    const prevDef = this.def(prev.type);
    if (prevDef?.text && this.mainEditable(prev.id) && prevDef.type !== 'code') {
      const prevEl = this.mainEditable(prev.id);
      const len = (prevEl.textContent || '').length;
      prev.data.text = (prev.data.text || '') + (isEmptyHtml(block.data.text) ? '' : block.data.text);
      this.removeBlock(block.id);
      this.rerenderBlock(prev.id, { focus: len });
      return true;
    }
    if (isEmptyHtml(block.data.text)) { this.removeBlock(block.id); }
    this.selectBlock(prev.id);
    return true;
  }

  checkMarkdown(block, el) {
    if (block.type !== 'paragraph') return;
    const caret = getCaretOffset(el);
    const text = (el.textContent || '').replace(/ /g, ' ').slice(0, caret);
    for (const def of this.registry.blocks.values()) {
      const patterns = [].concat(def.markdown || []);
      for (const p of patterns) {
        const re = p instanceof RegExp ? p : p.pattern;
        const m = text.match(re);
        if (!m || m.index !== 0 || m[0].length !== caret) continue;
        this.removeTextRange(el, 0, caret);
        block.data.text = el.innerHTML;
        this.convertBlock(block.id, def.type, { ...(p.data || {}) });
        if (def.text) this.focusBlock(block.id, 'start');
        return;
      }
    }
  }

  async onPaste(e) {
    const target = e.target.closest?.('[contenteditable]');
    if (!target || !this.blocksEl.contains(target)) return;
    const cd = e.clipboardData;
    const files = [...cd.files].filter((f) => f.type.startsWith('image/'));
    const row = target.closest('.block');
    if (files.length) {
      e.preventDefault();
      let after = row.dataset.id;
      for (const f of files) {
        const src = await this.app.saveImageFile(f);
        after = this.insertBlock('image', { src }, after, { focus: false }).id;
      }
      return;
    }
    const plain = cd.getData('text/plain');
    if (target.dataset.plain || target.getAttribute('contenteditable') === 'plaintext-only') return;
    e.preventDefault();
    const lines = plain.replace(/\r/g, '').split('\n');
    if (target.dataset.editable === 'main' && lines.length > 1) {
      document.execCommand('insertText', false, lines.shift());
      let afterId = row.dataset.id;
      const mdTypes = [[/^#\s+/, 'h1'], [/^##\s+/, 'h2'], [/^###\s+/, 'h3'], [/^[-*•]\s+\[\s?\]\s+/, 'todo'], [/^[-*•]\s+\[x\]\s+/i, 'todo', { checked: true }],
        [/^[-*•]\s+/, 'bullet'], [/^\d+[.)]\s+/, 'numbered'], [/^>\s+/, 'quote']];
      let last;
      for (const line of lines) {
        if (!line.trim()) continue;
        let type = 'paragraph', text = line, extra = {};
        for (const [re, t, x] of mdTypes) if (re.test(line)) { type = t; text = line.replace(re, ''); extra = x || {}; break; }
        last = this.insertBlock(type, { text: escapeText(text), ...extra }, afterId, { focus: false, animate: false });
        afterId = last.id;
      }
      if (last) this.focusBlock(last.id, 'end');
      return;
    }
    const html = cd.getData('text/html');
    if (html && !target.closest('td')) document.execCommand('insertHTML', false, sanitizeHtml(html));
    else document.execCommand('insertText', false, plain);
  }

  // ================= Drag & Drop von Blöcken =================

  startDrag(e, id, handle) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY, startX = e.clientX;
    let dragging = false, ghost, indicator, dropIndex = null;
    const row = this.rowEl(id);

    const onMove = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
        dragging = true;
        const r = row.getBoundingClientRect();
        ghost = row.cloneNode(true);
        ghost.classList.add('drag-ghost');
        Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
        document.body.append(ghost);
        row.classList.add('dragging');
        indicator = h('div.drop-indicator');
        this.blocksEl.append(indicator);
        document.body.classList.add('is-dragging');
      }
      if (!dragging) return;
      const r = row.getBoundingClientRect();
      ghost.style.transform = `translate(${ev.clientX - startX}px, ${ev.clientY - startY}px) rotate(1deg)`;
      const rows = [...this.blocksEl.querySelectorAll(':scope > .block')];
      dropIndex = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rr = rows[i].getBoundingClientRect();
        if (ev.clientY < rr.top + rr.height / 2) { dropIndex = i; break; }
      }
      const base = this.blocksEl.getBoundingClientRect();
      const refRow = rows[dropIndex] || rows.at(-1);
      const rr = refRow.getBoundingClientRect();
      const y = rows[dropIndex] ? rr.top : rr.bottom;
      indicator.style.top = (y - base.top - 2) + 'px';
      // Automatisch scrollen
      const sr = this.root.getBoundingClientRect();
      if (ev.clientY < sr.top + 60) this.root.scrollTop -= 12;
      else if (ev.clientY > sr.bottom - 60) this.root.scrollTop += 12;
      void r;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-dragging');
      if (!dragging) { this.openBlockMenu(id, handle); return; }
      ghost.remove();
      indicator.remove();
      row.classList.remove('dragging');
      const from = this.index(id);
      if (dropIndex != null && dropIndex !== from && dropIndex !== from + 1) this.moveBlock(id, dropIndex);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  openBlockMenu(id, anchor) {
    const b = this.block(id);
    if (!b) return;
    this.selectBlock(id);
    const textTypes = [...this.registry.blocks.values()].filter((d) => d.text && d.slash !== false);
    contextMenu([
      { header: this.def(b.type)?.name || b.type },
      { label: 'Umwandeln in', icon: 'refresh', submenu: textTypes.map((d) => ({ label: d.name, icon: d.icon, active: d.type === b.type, run: () => this.convertBlock(id, d.type) })) },
      { label: 'Farbe', icon: 'palette', submenu: [
        { header: 'Textfarbe' },
        ...BLOCK_COLORS.map((c) => ({ label: c.name, swatch: c.id ? `var(--c-${c.id})` : 'var(--text)', active: (b.color || '') === c.id, run: () => this.setColor(id, c.id) })),
        { header: 'Hintergrund' },
        ...BLOCK_COLORS.filter((c) => c.id).map((c) => ({ label: c.name, swatch: `var(--bg-${c.id})`, active: b.color === 'bg-' + c.id, run: () => this.setColor(id, 'bg-' + c.id) }))
      ] },
      '-',
      { label: 'Duplizieren', icon: 'copy', shortcut: 'Ctrl+D', run: () => this.duplicateBlock(id) },
      { label: 'Nach oben', icon: 'chevronUp', run: () => { const i = this.index(id); if (i > 0) this.moveBlock(id, i - 1); } },
      { label: 'Nach unten', icon: 'chevronDown', run: () => { const i = this.index(id); if (i < this.note.blocks.length - 1) this.moveBlock(id, i + 2); } },
      '-',
      { label: 'Löschen', icon: 'trash', danger: true, shortcut: 'Delete', run: () => this.removeBlock(id, { animate: true }) }
    ], anchor);
  }

  // ================= Icon & Titelbild =================

  pickIcon(anchor) {
    emojiPicker(anchor, (emoji) => {
      this.note.icon = emoji || '';
      this.changed(true);
      this.renderAll();
      this.app.sidebar.refresh();
    });
  }

  pickCover(anchor) {
    coverPicker(anchor, this.app, (cover) => {
      this.note.cover = cover;
      this.changed(true);
      this.renderAll();
    });
  }

  /** Text aller Blöcke (z.B. für Wortzähler) */
  plainText() {
    return (this.note?.blocks || []).map((b) => stripHtml(b.data.text || b.data.code || '') + ' ' +
      (b.data.rows ? b.data.rows.flat().map(stripHtml).join(' ') : '')).join('\n');
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { popover };
