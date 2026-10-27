// Freihand-Zeichnen auf der Notiz: Stift, Textmarker, Radierer – mit Farben, Stärke und Transparenz.
// Striche werden in note.drawing.strokes gespeichert (Koordinaten relativ zur Seite):
//   { id, tool: 'pen'|'marker', color, width, opacity, points: [[x, y], …] }

import { h, uid } from '../core/utils.js';
import { icon } from './icons.js';

export const DRAW_COLORS = ['#1f1f24', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
const DEFAULTS = {
  pen: { color: '#3b82f6', width: 3, opacity: 1 },
  marker: { color: '#facc15', width: 18, opacity: 0.35 },
  eraser: { width: 16 }
};

/** Glatter SVG-Pfad aus Punkten (quadratische Kurven durch die Mittelpunkte) */
function pathData(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]} l0.01 0`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts.at(-1);
  return d + ` L${last[0]} ${last[1]}`;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export class DrawLayer {
  constructor(editor, page) {
    this.editor = editor;
    this.app = editor.app;
    this.page = page;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('draw-layer');
    this.capture = h('div.draw-capture');
    this.capture.addEventListener('pointerdown', (e) => this.down(e));
    page.append(this.svg, this.capture);
    this.setActive(!!this.app.drawMode);
  }

  destroy() { this.svg.remove(); this.capture.remove(); }

  get strokes() {
    const n = this.editor.note;
    n.drawing ||= { strokes: [] };
    return n.drawing.strokes;
  }

  get tool() { return this.app.settings.drawTool || 'pen'; }
  opts(tool = this.tool) { return { ...DEFAULTS[tool], ...((this.app.settings.drawOptions || {})[tool] || {}) }; }

  render() {
    this.svg.innerHTML = '';
    for (const s of this.strokes) this.svg.append(this.strokeEl(s));
  }

  strokeEl(s) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', pathData(s.points));
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', s.width);
    p.setAttribute('stroke-opacity', s.opacity);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', s.tool === 'marker' ? 'square' : 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.classList.add('stroke-' + s.tool);
    p.dataset.id = s.id;
    return p;
  }

  extent() { return this.strokes.reduce((m, s) => Math.max(m, ...s.points.map((pt) => pt[1] + s.width)), 0); }

  setActive(on) {
    this.active = on;
    this.capture.classList.toggle('on', on);
    this.page.classList.toggle('drawing', on);
    this.capture.dataset.tool = this.tool;
  }

  pos(e) {
    const r = this.page.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  }

  down(e) {
    if (!this.active || (e.button !== 0 && e.pointerType === 'mouse')) return;
    e.preventDefault();
    this.capture.setPointerCapture(e.pointerId);
    const tool = this.tool;
    const start = this.pos(e);

    if (tool === 'eraser') {
      let removed = false;
      const erase = (pt) => {
        const r = this.opts('eraser').width / 2;
        for (let i = this.strokes.length - 1; i >= 0; i--) {
          const s = this.strokes[i];
          const hit = s.points.length === 1 ? Math.hypot(pt[0] - s.points[0][0], pt[1] - s.points[0][1]) < r + s.width / 2
            : s.points.some((p, k) => k && distToSegment(pt, s.points[k - 1], p) < r + s.width / 2);
          if (hit) { this.strokes.splice(i, 1); this.svg.querySelector(`[data-id="${s.id}"]`)?.remove(); removed = true; }
        }
      };
      erase(start);
      const move = (ev) => erase(this.pos(ev));
      const up = () => {
        this.capture.removeEventListener('pointermove', move);
        this.capture.removeEventListener('pointerup', up);
        this.capture.removeEventListener('pointercancel', up);
        if (removed) { this.editor.changed(true); this.editor.floats?.updateHeight(); }
      };
      this.capture.addEventListener('pointermove', move);
      this.capture.addEventListener('pointerup', up);
      this.capture.addEventListener('pointercancel', up);
      return;
    }

    const o = this.opts(tool);
    const stroke = { id: uid(), tool, color: o.color, width: o.width, opacity: o.opacity, points: [start] };
    const el = this.strokeEl(stroke);
    this.svg.append(el);
    const move = (ev) => {
      const events = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of events.length ? events : [ev]) {
        const pt = this.pos(ce);
        if (ev.shiftKey) { stroke.points = [stroke.points[0], pt]; continue; } // gerade Linie
        const last = stroke.points.at(-1);
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 1.5) stroke.points.push(pt);
      }
      el.setAttribute('d', pathData(stroke.points));
      // Seite beim Zeichnen nach unten verlängern
      const y = stroke.points.at(-1)[1];
      if (y > this.page.offsetHeight - 120) this.page.style.minHeight = y + 300 + 'px';
    };
    const up = () => {
      this.capture.removeEventListener('pointermove', move);
      this.capture.removeEventListener('pointerup', up);
      this.capture.removeEventListener('pointercancel', up);
      this.strokes.push(stroke);
      this.editor.changed(true);
      this.editor.floats?.updateHeight();
    };
    this.capture.addEventListener('pointermove', move);
    this.capture.addEventListener('pointerup', up);
    this.capture.addEventListener('pointercancel', up);
  }

  clear() {
    if (!this.strokes.length) return;
    this.strokes.length = 0;
    this.render();
    this.editor.changed(true);
    this.editor.floats?.updateHeight();
  }
}

/** Schwebende Werkzeugleiste für den Zeichen-Modus */
export class DrawToolbar {
  constructor(app) {
    this.app = app;
    this.el = h('div.draw-toolbar');
    document.body.append(this.el);
  }

  get layer() { return this.app.editor.drawing; }
  opts(tool) { return { ...DEFAULTS[tool], ...((this.app.settings.drawOptions || {})[tool] || {}) }; }

  setOpt(tool, patch) {
    const all = { ...(this.app.settings.drawOptions || {}) };
    all[tool] = { ...this.opts(tool), ...patch };
    this.app.saveSettings({ drawOptions: all });
    this.render();
  }

  show(on) {
    this.el.classList.toggle('visible', on);
    if (on) this.render();
  }

  render() {
    const tool = this.app.settings.drawTool || 'pen';
    const o = this.opts(tool);
    const el = this.el;
    el.innerHTML = '';
    const toolBtn = (id, ic, label) => h('button.dt-tool' + (tool === id ? '.active' : ''), {
      title: label, onclick: () => { this.app.saveSettings({ drawTool: id }); if (this.layer) this.layer.capture.dataset.tool = id; this.render(); }
    }, icon(ic, 18), h('span', { text: label }));
    el.append(h('div.dt-group', {},
      toolBtn('pen', 'edit', 'Stift'),
      toolBtn('marker', 'highlighter', 'Marker'),
      toolBtn('eraser', 'eraser', 'Radierer')));

    if (tool !== 'eraser') {
      const colors = h('div.dt-group.dt-colors');
      for (const c of DRAW_COLORS) {
        colors.append(h('button.dt-color' + (o.color.toLowerCase() === c ? '.active' : ''), { style: { background: c }, title: c, onclick: () => this.setOpt(tool, { color: c }) }));
      }
      const custom = h('input.dt-custom', { type: 'color', value: o.color, title: 'Eigene Farbe' });
      custom.addEventListener('change', () => this.setOpt(tool, { color: custom.value }));
      colors.append(custom);
      el.append(colors);

      // Transparenz: Regler + Schnellstufen
      const opRange = h('input.dt-range', { type: 'range', min: 5, max: 100, step: 5, value: Math.round(o.opacity * 100), title: 'Deckkraft' });
      const opLabel = h('span.dt-val', { text: Math.round(o.opacity * 100) + '%' });
      opRange.addEventListener('input', () => { opLabel.textContent = opRange.value + '%'; preview.setAttribute('stroke-opacity', opRange.value / 100); });
      opRange.addEventListener('change', () => this.setOpt(tool, { opacity: opRange.value / 100 }));
      const steps = h('div.dt-steps', {}, ...[25, 50, 75, 100].map((v) => h('button.dt-step' + (Math.round(o.opacity * 100) === v ? '.active' : ''), { text: v + '%', onclick: () => this.setOpt(tool, { opacity: v / 100 }) })));
      el.append(h('div.dt-group.dt-slider', {}, h('span.dt-label', { text: 'Deckkraft' }), opRange, opLabel, steps));
    }

    const wRange = h('input.dt-range', { type: 'range', min: tool === 'pen' ? 1 : 4, max: tool === 'pen' ? 24 : 60, value: o.width, title: 'Stärke' });
    const wLabel = h('span.dt-val', { text: o.width + ' px' });
    wRange.addEventListener('input', () => { wLabel.textContent = wRange.value + ' px'; preview.setAttribute('stroke-width', Math.min(16, wRange.value)); });
    wRange.addEventListener('change', () => this.setOpt(tool, { width: +wRange.value }));
    el.append(h('div.dt-group.dt-slider', {}, h('span.dt-label', { text: 'Stärke' }), wRange, wLabel));

    // Vorschau des Strichs
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 60 24');
    svg.classList.add('dt-preview');
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    preview.setAttribute('d', 'M6 16 Q20 4 30 12 T54 8');
    preview.setAttribute('fill', 'none');
    preview.setAttribute('stroke-linecap', 'round');
    preview.setAttribute('stroke', tool === 'eraser' ? 'var(--text-3)' : o.color);
    preview.setAttribute('stroke-opacity', tool === 'eraser' ? 0.5 : o.opacity);
    preview.setAttribute('stroke-width', Math.min(16, o.width));
    if (tool === 'eraser') preview.setAttribute('stroke-dasharray', '3 4');
    svg.append(preview);

    el.append(h('div.dt-group', {},
      svg,
      h('button.dt-icon', { title: 'Rückgängig (Strg+Z)', onclick: () => this.app.editor.undo() }, icon('undo', 17)),
      h('button.dt-icon', { title: 'Alle Zeichnungen dieser Notiz löschen', onclick: () => this.app.confirmClearDrawing() }, icon('trash', 17)),
      h('button.btn.btn-primary.small.dt-done', { onclick: () => this.app.toggleDrawMode(false) }, icon('check', 14), 'Fertig')));
  }
}
