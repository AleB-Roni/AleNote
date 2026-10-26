// Frei bewegliche Elemente: Bilder (verschieben, skalieren, drehen) und Blöcke wie Tabellen
// (am Griff verschieben, Breite ändern) – überall auf der Seite
import { h, uid, clamp } from '../core/utils.js';
import { resolveSrc } from '../core/api.js';
import { icon } from './icons.js';

export class FloatLayer {
  constructor(editor, page) {
    this.editor = editor;
    this.page = page;
    this.layer = h('div.float-layer');
    page.append(this.layer);
    this.selected = null;
    this.onKey = (e) => {
      if (!this.selected || !this.layer.isConnected) return;
      if (document.activeElement?.closest?.('.float-block')) return;
      if (document.activeElement?.isContentEditable || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(this.selected); }
      else if (e.key === 'Escape') this.select(null);
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const f = this.get(this.selected);
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') f.x -= step; if (e.key === 'ArrowRight') f.x += step;
        if (e.key === 'ArrowUp') f.y -= step; if (e.key === 'ArrowDown') f.y += step;
        this.apply(f);
        this.editor.changed();
      }
    };
    document.addEventListener('keydown', this.onKey);
    this.onDown = (e) => { if (!e.target.closest('.float-item') && this.layer.isConnected) this.select(null); };
    document.addEventListener('mousedown', this.onDown);
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('mousedown', this.onDown);
  }

  get list() { return this.editor.note.floats; }
  get(id) { return this.list.find((f) => f.id === id); }

  render() {
    this.layer.innerHTML = '';
    for (const f of this.list) this.layer.append(this.renderItem(f));
    this.updateHeight();
  }

  hasBlock(id) { return this.list.some((f) => f.block?.id === id); }

  renderItem(f) {
    if (f.block) return this.renderBlockItem(f);
    const el = h('div.float-item', { dataset: { id: f.id } });
    const img = h('img', { src: resolveSrc(f.src), draggable: false, alt: '' });
    img.addEventListener('load', () => { this.updateHeight(); });
    const bar = h('div.float-toolbar', {},
      this.tool('layers', 'Nach vorne', () => this.toFront(f.id)),
      this.tool('undo', 'Nach hinten', () => this.toBack(f.id)),
      this.tool('rotate', 'Drehung zurücksetzen', () => { f.rot = 0; this.apply(f); this.editor.changed(true); }),
      this.tool('alignCenter', 'Als Block in den Text einfügen', () => this.toBlock(f.id)),
      this.tool('trash', 'Löschen', () => this.remove(f.id)));
    const inner = h('div.float-inner', {}, img,
      h('div.float-handle.rot', { title: 'Drehen (Shift = 15°-Schritte)' }),
      h('div.float-handle.rs.se'), h('div.float-handle.rs.sw'), h('div.float-handle.rs.ne'), h('div.float-handle.rs.nw'));
    el.append(inner, bar);
    el.addEventListener('pointerdown', (e) => this.pointerDown(e, f, el));
    this.apply(f, el);
    if (f.id === this.selected) el.classList.add('selected');
    return el;
  }

  /** Frei platzierter Block (z.B. Tabelle) mit Griff zum Verschieben */
  renderBlockItem(f) {
    const editor = this.editor;
    const def = editor.def(f.block.type);
    const el = h('div.float-item.float-block', { dataset: { id: f.id } });
    const grip = h('div.float-grip', { title: 'Ziehen zum Verschieben' }, icon('grip', 14), h('span', { text: def?.name || 'Block' }));
    const bar = h('div.float-block-tools', {},
      this.tool('layers', 'Nach vorne', () => this.toFront(f.id)),
      this.tool('undo', 'Nach hinten', () => this.toBack(f.id)),
      this.tool('alignCenter', 'Zurück in den Text', () => this.toBlock(f.id)),
      this.tool('trash', 'Löschen', () => this.remove(f.id)));
    const head = h('div.float-head', {}, grip, h('div.flex'), bar);
    const row = h('div.block', { dataset: { id: f.block.id, type: f.block.type } });
    const content = h('div.block-content');
    try { content.append(def.render(f.block, this.blockCtx(f))); }
    catch (err) { content.append(h('div.block-error', { text: err.message })); }
    row.append(content);
    el.append(head, row, h('div.float-handle.rs.e', { title: 'Breite ändern' }));
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.float-grip') || e.target.closest('.float-handle')) this.pointerDown(e, f, el);
      else this.select(f.id);
    });
    this.apply(f, el);
    if (f.id === this.selected) el.classList.add('selected');
    return el;
  }

  blockCtx(f) {
    const base = this.editor.ctx(f.block);
    return {
      ...base,
      floating: true,
      remove: () => this.remove(f.id),
      unfloat: () => this.toBlock(f.id),
      insertAfter: () => {},
      focusNext: () => false,
      focusPrev: () => false
    };
  }

  rerenderBlock(id) {
    const f = this.list.find((x) => x.block?.id === id);
    const old = f && this.layer.querySelector(`.float-item[data-id="${f.id}"]`);
    if (!old) return;
    const el = this.renderItem(f);
    old.replaceWith(el);
    this.updateHeight();
    return el;
  }

  addBlock(block, x, y, w = 480) {
    const pw = this.page.clientWidth || 800;
    const f = { id: uid(), block, x: Math.round(x ?? pw / 2 - w / 2), y: Math.round(y ?? (this.editor.root.scrollTop + 120)), w, z: this.maxZ() + 1 };
    this.list.push(f);
    const el = this.renderItem(f);
    el.classList.add('enter');
    this.layer.append(el);
    this.select(f.id);
    this.updateHeight();
    this.editor.changed(true);
    requestAnimationFrame(() => el.querySelector('.cell, [contenteditable]')?.focus());
    return f;
  }

  tool(ic, title, run) {
    const b = h('button.tb-btn', { title }, icon(ic, 14));
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
    return b;
  }

  apply(f, el = this.layer.querySelector(`.float-item[data-id="${f.id}"]`)) {
    if (!el) return;
    el.style.left = f.x + 'px';
    el.style.top = f.y + 'px';
    el.style.width = f.w + 'px';
    el.style.zIndex = 10 + (f.z || 0);
    if (!f.block) el.firstChild.style.transform = `rotate(${f.rot || 0}deg)`;
    el.classList.toggle('shadow', f.shadow !== false);
  }

  select(id) {
    this.selected = id;
    this.layer.querySelectorAll('.float-item').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  }

  pointerDown(e, f, el) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    document.activeElement?.blur?.();
    this.select(f.id);
    const handle = e.target.closest('.float-handle');
    const start = { x: e.clientX, y: e.clientY, fx: f.x, fy: f.y, w: f.w, rot: f.rot || 0 };
    const rect = el.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const startAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    const mode = !handle ? 'move' : handle.classList.contains('rot') ? 'rotate' : 'resize';
    const corner = handle?.classList.contains('e') ? 'e' : handle?.classList.contains('sw') ? 'sw' : handle?.classList.contains('ne') ? 'ne' : handle?.classList.contains('nw') ? 'nw' : 'se';
    const ratio = el.offsetHeight / el.offsetWidth || 1;
    el.classList.add('active');
    document.body.classList.add('float-dragging');

    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (mode === 'move') {
        f.x = Math.round(start.fx + dx);
        f.y = Math.round(Math.max(-200, start.fy + dy));
        if (!ev.altKey) this.snap(f, el);
      } else if (mode === 'resize') {
        const dir = corner === 'se' || corner === 'ne' || corner === 'e' ? 1 : -1;
        const nw = clamp(start.w + dx * dir, f.block ? 200 : 40, 2400);
        if (corner === 'sw' || corner === 'nw') f.x = Math.round(start.fx + (start.w - nw));
        if (corner === 'ne' || corner === 'nw') f.y = Math.round(start.fy + (start.w - nw) * ratio);
        f.w = Math.round(nw);
      } else {
        const a = Math.atan2(ev.clientY - center.y, ev.clientX - center.x);
        let deg = start.rot + ((a - startAngle) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        f.rot = Math.round(((deg % 360) + 360) % 360);
        if (f.rot > 180) f.rot -= 360;
      }
      this.apply(f, el);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.classList.remove('active');
      document.body.classList.remove('float-dragging');
      this.layer.querySelectorAll('.snap-guide').forEach((g) => g.remove());
      if (f.x !== start.fx || f.y !== start.fy || f.w !== start.w || (f.rot || 0) !== start.rot) {
        this.updateHeight();
        this.editor.changed(true);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Einrasten an Seitenmitte und Rändern (Alt gedrückt halten = aus)
  snap(f, el) {
    this.layer.querySelectorAll('.snap-guide').forEach((g) => g.remove());
    const pw = this.page.clientWidth;
    const w = el.offsetWidth;
    const targets = [[0, 'left'], [pw / 2 - w / 2, 'center'], [pw - w, 'right']];
    for (const [tx, kind] of targets) {
      if (Math.abs(f.x - tx) < 8) {
        f.x = Math.round(tx);
        const gx = kind === 'left' ? 0 : kind === 'center' ? pw / 2 : pw;
        this.layer.append(h('div.snap-guide', { style: { left: gx + 'px' } }));
      }
    }
  }

  add(src, x, y, w = 300) {
    const pw = this.page.clientWidth || 800;
    const f = { id: uid(), src, x: Math.round(x ?? pw / 2 - w / 2), y: Math.round(y ?? (this.editor.root.scrollTop + 120)), w, rot: 0, z: this.maxZ() + 1 };
    this.list.push(f);
    const el = this.renderItem(f);
    el.classList.add('enter');
    this.layer.append(el);
    this.select(f.id);
    this.updateHeight();
    this.editor.changed(true);
    return f;
  }

  remove(id) {
    const i = this.list.findIndex((f) => f.id === id);
    if (i < 0) return;
    this.list.splice(i, 1);
    const el = this.layer.querySelector(`.float-item[data-id="${id}"]`);
    if (el) { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }
    this.selected = null;
    this.updateHeight();
    this.editor.changed(true);
  }

  maxZ() { return this.list.reduce((m, f) => Math.max(m, f.z || 0), 0); }
  toFront(id) { const f = this.get(id); f.z = this.maxZ() + 1; this.apply(f); this.editor.changed(true); }
  toBack(id) { const f = this.get(id); f.z = Math.min(...this.list.map((x) => x.z || 0)) - 1; this.apply(f); this.editor.changed(true); }

  toBlock(id) {
    const f = this.get(id);
    if (!f) return;
    // In den Block einfügen, der der aktuellen Position am nächsten ist
    const fy = this.page.getBoundingClientRect().top + f.y;
    let after = null;
    for (const row of this.editor.blocksEl.querySelectorAll(':scope > .block')) {
      if (row.getBoundingClientRect().top < fy) after = row.dataset.id;
    }
    this.remove(id);
    if (f.block) { this.editor.insertBlock(f.block, null, after || this.editor.note.blocks.at(-1)?.id, { focus: false }); return; }
    this.editor.insertBlock('image', { src: f.src, width: Math.min(100, Math.round((f.w / this.page.clientWidth) * 100)) }, after || this.editor.note.blocks.at(-1)?.id, { focus: false });
  }

  updateHeight() {
    let max = 0;
    this.layer.querySelectorAll('.float-item').forEach((el) => { max = Math.max(max, el.offsetTop + el.offsetHeight); });
    this.page.style.minHeight = max ? max + 120 + 'px' : '';
  }
}
