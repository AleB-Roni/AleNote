// Tabellen-Block mit Excel-Funktionen:
//   Bereiche markieren (Maus ziehen, Shift+Klick, Shift+Pfeile, Spalten-/Zeilenköpfe)
//   Ausfüllkästchen (Reihen fortsetzen, über das Tabellenende hinaus), Strg+D / Strg+R
//   Kopieren/Ausschneiden/Einfügen von Bereichen (auch aus Excel), Wert auf alle Felder einfügen
//   Formeln (=SUMME(A1:A3) …), Formelleiste, Sortieren, Summenzeile, Spaltenbreite ziehen
//   Frei auf der Seite platzierbar (wie Bilder)
import { h, stripHtml, placeCaret, escapeHtml } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { contextMenu, toast } from '../ui/overlays.js';
import { htmlToMarkdown } from './text.js';
import { computeTable, formatValue, isFormula, parseNumber, cellName, colName, shiftFormula } from './table-formula.js';
import { fillSeries } from './table-fill.js';

const emptyRow = (n) => Array.from({ length: n }, () => '');
const plain = (html) => stripHtml(html || '').replace(/ /g, ' ').trim();

// Markierung pro Tabelle (bleibt beim Neuzeichnen erhalten)
const selections = new Map();
// Interne Zwischenablage, damit Formeln beim Einfügen mitverschoben werden
let clip = null;

export default function registerTable(registry) {
  registry.registerBlock({
    type: 'table', name: 'Tabelle', icon: 'table', description: 'Tabelle mit Excel-Funktionen (Formeln, Ausfüllen)', keywords: ['tabelle', 'table', 'grid', 'raster', 'excel'],
    group: 'Medien',
    create: () => ({ rows: [emptyRow(3), emptyRow(3), emptyRow(3)], header: true, widths: null, heads: false }),
    focusOnInsert(row) { const cell = row.querySelector('.cell'); if (cell) placeCaret(cell, true); },
    render: (b, ctx) => renderTable(b, ctx),
    toMarkdown(b) {
      const rows = b.data.rows || [];
      if (!rows.length) return '';
      const vals = computeTable(rows);
      const fmt = (r, ri) => '| ' + r.map((c, ci) => (vals[ri][ci] != null ? formatValue(vals[ri][ci]) : htmlToMarkdown(c)).replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ').join(' | ') + ' |';
      return [fmt(rows[0], 0), '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map((r, i) => fmt(r, i + 1))].join('\n');
    },
    search: (b) => (b.data.rows || []).flat().map(stripHtml).join(' ')
  });

  registry.registerSlashCommand({
    id: 'table.float', name: 'Freie Tabelle', icon: 'table', group: 'Medien', description: 'Tabelle frei auf der Seite platzieren', keywords: ['tabelle', 'frei', 'float', 'excel'],
    run: (editor) => {
      const block = editor.newBlock('table');
      editor.floats.addBlock(block, undefined, editor.root.scrollTop + 100, 520);
    }
  });
}

function renderTable(b, ctx) {
  const d = b.data;
  d.rows ||= [emptyRow(3)];
  if (!d.rows.length) d.rows.push(emptyRow(3));
  let cols = Math.max(1, ...d.rows.map((r) => r.length));
  d.rows.forEach((r) => { while (r.length < cols) r.push(''); });
  const floating = !!ctx.floating;

  const wrap = h('div.table-block' + (d.heads ? '.with-heads' : '') + (floating ? '.floating' : ''), { tabindex: '-1' });
  const scroll = h('div.table-scroll');
  const table = h('table.table' + (d.header ? '.with-header' : ''));
  const colgroup = h('colgroup');
  if (d.heads) colgroup.append(h('col.head-col'));
  for (let c = 0; c < cols; c++) colgroup.append(h('col', { style: { width: d.widths?.[c] ? d.widths[c] + 'px' : '' } }));
  table.append(colgroup);

  const selBox = h('div.sel-box', {},
    h('div.range-handle', { title: 'Ziehen, um die Markierung zu erweitern' }),
    h('div.fill-handle', { title: 'Ziehen zum Ausfüllen (Strg = Kopie/Reihe umschalten)' }));
  const fillPreview = h('div.fill-preview');
  const nameEl = h('span.fb-name');
  const rawEl = h('span.fb-raw');
  const formulaBar = h('div.table-formulabar', {}, nameEl, h('span.fb-fx', { text: 'fx' }), rawEl);

  // ---------- Hilfen ----------
  const cellEl = (r, c) => table.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  const getSel = () => selections.get(b.id) || null;
  const range = (s = getSel()) => s && { r1: Math.min(s.a.r, s.f.r), r2: Math.max(s.a.r, s.f.r), c1: Math.min(s.a.c, s.f.c), c2: Math.max(s.a.c, s.f.c) };
  const isMulti = () => { const g = range(); return g && (g.r1 !== g.r2 || g.c1 !== g.c2); };
  const clampPos = (p) => ({ r: Math.max(0, Math.min(d.rows.length - 1, p.r)), c: Math.max(0, Math.min(cols - 1, p.c)) });
  const commit = (rerender = false) => ctx.update({ rows: d.rows, widths: d.widths }, { rerender, commit: true });

  // ---------- Anzeige von Formeln ----------
  function showCell(cell, computed) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const raw = d.rows[r][c] || '';
    const v = computed[r][c];
    const editing = document.activeElement === cell;
    cell.classList.toggle('formula', v != null);
    cell.classList.toggle('error', v != null && typeof v === 'object');
    if (v != null && !editing) cell.textContent = formatValue(v);
    const num = v != null ? typeof v === 'number' : parseNumber(plain(raw)) != null;
    cell.classList.toggle('num', num);
  }
  function refreshAll() {
    const computed = computeTable(d.rows);
    table.querySelectorAll('.cell').forEach((cell) => showCell(cell, computed));
    updateFormulaBar();
  }
  function updateFormulaBar() {
    const s = getSel();
    if (!s) return;
    const g = range(s);
    nameEl.textContent = isMulti() ? `${cellName(g.r1, g.c1)}:${cellName(g.r2, g.c2)}` : cellName(s.a.r, s.a.c);
    rawEl.textContent = plain(d.rows[s.a.r]?.[s.a.c] || '');
  }

  // ---------- Markierung ----------
  function setSel(a, f = a, { focusCell = false } = {}) {
    a = clampPos(a); f = clampPos(f);
    selections.set(b.id, { a, f });
    paint();
    if (focusCell) { const el = cellEl(a.r, a.c); if (el) placeCaret(el, true); }
  }
  function paint() {
    const g = range();
    table.querySelectorAll('.cell.in-range').forEach((el) => el.classList.remove('in-range'));
    table.querySelectorAll('.col-head.active, .row-head.active').forEach((el) => el.classList.remove('active'));
    if (!g) { selBox.style.display = 'none'; return; }
    const multi = isMulti();
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (multi) cellEl(r, c)?.classList.add('in-range');
    for (let c = g.c1; c <= g.c2; c++) table.querySelector(`.col-head[data-c="${c}"]`)?.classList.add('active');
    for (let r = g.r1; r <= g.r2; r++) table.querySelector(`.row-head[data-r="${r}"]`)?.classList.add('active');
    const tl = cellEl(g.r1, g.c1)?.parentElement, br = cellEl(g.r2, g.c2)?.parentElement;
    if (!tl || !br) return;
    const base = scroll.getBoundingClientRect();
    const a = tl.getBoundingClientRect(), z = br.getBoundingClientRect();
    Object.assign(selBox.style, {
      display: 'block', left: a.left - base.left + scroll.scrollLeft + 'px', top: a.top - base.top + 'px',
      width: z.right - a.left + 'px', height: z.bottom - a.top + 'px'
    });
    selBox.classList.toggle('multi', multi);
    updateFormulaBar();
  }

  // ---------- Struktur ändern ----------
  const restructure = (fn, focus) => {
    fn();
    if (focus) selections.set(b.id, { a: { r: focus[0], c: focus[1] }, f: { r: focus[0], c: focus[1] } });
    commit(true);
    if (focus) {
      const cell = ctx.editor.rowEl(b.id)?.querySelector(`.cell[data-r="${focus[0]}"][data-c="${focus[1]}"]`);
      if (cell) placeCaret(cell, true);
    }
  };
  const ensureSize = (rowsNeeded, colsNeeded) => {
    let changed = false;
    while (cols < colsNeeded) { d.rows.forEach((r) => r.push('')); if (d.widths) d.widths.push(140); cols++; changed = true; }
    while (d.rows.length < rowsNeeded) { d.rows.push(emptyRow(cols)); changed = true; }
    return changed;
  };
  const ops = {
    addRow: (at) => restructure(() => d.rows.splice(at, 0, emptyRow(cols)), [at, 0]),
    addCol: (at) => restructure(() => { d.rows.forEach((r) => r.splice(at, 0, '')); if (d.widths) d.widths.splice(at, 0, 140); }, [0, at]),
    dupRow: (r) => restructure(() => d.rows.splice(r + 1, 0, [...d.rows[r]]), [r + 1, 0]),
    delRow: (r) => { if (d.rows.length <= 1) return ctx.remove(); restructure(() => d.rows.splice(r, 1), [Math.max(0, r - 1), 0]); },
    delCol: (c) => { if (cols <= 1) return ctx.remove(); restructure(() => { d.rows.forEach((row) => row.splice(c, 1)); d.widths?.splice(c, 1); }, [0, Math.max(0, c - 1)]); },
    sort: (c, dir) => restructure(() => {
      const start = d.header ? 1 : 0;
      const computed = computeTable(d.rows);
      const body = d.rows.slice(start).map((row, i) => ({ row, v: computed[i + start][c] ?? (parseNumber(plain(row[c])) ?? plain(row[c]).toLowerCase()) }));
      body.sort((x, y) => {
        if (x.v === '' && y.v !== '') return 1;
        if (y.v === '' && x.v !== '') return -1;
        const res = typeof x.v === 'number' && typeof y.v === 'number' ? x.v - y.v : String(x.v).localeCompare(String(y.v), 'de', { numeric: true });
        return res * dir;
      });
      d.rows.splice(start, body.length, ...body.map((x) => x.row));
    }),
    sumRow: () => restructure(() => {
      const start = d.header ? 1 : 0;
      const end = d.rows.length;
      const computed = computeTable(d.rows);
      const row = emptyRow(cols).map((_, c) => {
        const numeric = d.rows.slice(start).some((r, i) => typeof (computed[i + start][c] ?? parseNumber(plain(r[c]))) === 'number');
        return numeric ? escapeHtml(`=SUMME(${colName(c)}${start + 1}:${colName(c)}${end})`) : '';
      });
      if (!row[0]) row[0] = '<b>Summe</b>';
      d.rows.push(row);
    }, [d.rows.length, 0]),
    toggleHeads: () => restructure(() => { d.heads = !d.heads; }),
    toggleHeader: () => restructure(() => { d.header = !d.header; })
  };

  // ---------- Werte schreiben (ohne Neuzeichnen) ----------
  function writeCells(changes, { structural = false, select } = {}) {
    for (const [r, c, v] of changes) d.rows[r][c] = v;
    if (select) selections.set(b.id, select);
    if (structural) { commit(true); return; }
    for (const [r, c] of changes) { const el = cellEl(r, c); if (el && document.activeElement !== el) el.innerHTML = d.rows[r][c]; }
    refreshAll();
    paint();
    commit(false);
  }

  function clearRange() {
    const g = range();
    if (!g) return;
    const ch = [];
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) ch.push([r, c, '']);
    const active = document.activeElement;
    if (active?.classList.contains('cell') && table.contains(active)) active.innerHTML = '';
    writeCells(ch);
  }

  function copyRange(cut = false) {
    const g = range();
    if (!g) return;
    const computed = computeTable(d.rows);
    const rawGrid = [], textGrid = [];
    for (let r = g.r1; r <= g.r2; r++) {
      const rr = [], tr = [];
      for (let c = g.c1; c <= g.c2; c++) {
        rr.push(d.rows[r][c]);
        tr.push(computed[r][c] != null ? formatValue(computed[r][c]) : plain(d.rows[r][c]).replace(/[\t\n]/g, ' '));
      }
      rawGrid.push(rr); textGrid.push(tr);
    }
    const tsv = textGrid.map((r) => r.join('\t')).join('\n');
    clip = { tsv, raw: rawGrid, origin: { r: g.r1, c: g.c1 } };
    navigator.clipboard?.writeText(tsv).catch(() => {});
    const n = rawGrid.length * rawGrid[0].length;
    toast(cut ? 'Ausgeschnitten' : `${n} ${n === 1 ? 'Zelle' : 'Zellen'} kopiert`, { duration: 1200 });
    if (cut) clearRange();
  }

  function pasteText(text) {
    const g = range();
    if (!g) return;
    let grid;
    let fromClip = clip && clip.tsv === text.replace(/\r/g, '').replace(/\n$/, '');
    if (fromClip) grid = clip.raw.map((row, i) => row.map((v, j) => (isFormula(v) ? escapeHtml(shiftFormula(plain(v), g.r1 - clip.origin.r, g.c1 - clip.origin.c)) : v)));
    else grid = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((line) => line.split('\t').map((v) => escapeHtml(v)));
    const ch = [];
    // Ein Wert + mehrere markierte Felder → auf alle Felder kopieren
    if (grid.length === 1 && grid[0].length === 1 && isMulti()) {
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const v = fromClip && isFormula(clip.raw[0][0]) ? escapeHtml(shiftFormula(plain(clip.raw[0][0]), r - clip.origin.r, c - clip.origin.c)) : grid[0][0];
        ch.push([r, c, v]);
      }
      return writeCells(ch);
    }
    const structural = ensureSize(g.r1 + grid.length, g.c1 + Math.max(...grid.map((r) => r.length)));
    grid.forEach((row, i) => row.forEach((v, j) => ch.push([g.r1 + i, g.c1 + j, v])));
    const sel = { a: { r: g.r1, c: g.c1 }, f: { r: g.r1 + grid.length - 1, c: g.c1 + Math.max(...grid.map((r) => r.length)) - 1 } };
    writeCells(ch, { structural, select: sel });
  }

  /** Ausfüllen in Richtung dir um n Zellen */
  function fill(dir, n, invert = false) {
    const g = range();
    if (!g || n <= 0) return;
    if (dir === 'up') n = Math.min(n, g.r1);
    if (dir === 'left') n = Math.min(n, g.c1);
    if (n <= 0) return;
    const structural = ensureSize(dir === 'down' ? g.r2 + 1 + n : 0, dir === 'right' ? g.c2 + 1 + n : 0);
    const ch = [];
    if (dir === 'down' || dir === 'up') {
      for (let c = g.c1; c <= g.c2; c++) {
        const src = [];
        for (let r = g.r1; r <= g.r2; r++) src.push(d.rows[r][c]);
        if (dir === 'up') src.reverse();
        const vals = fillSeries(src, n, {
          invert,
          offset: (i, k) => (dir === 'down' ? { dr: g.r2 + 1 + i - (g.r1 + k), dc: 0 } : { dr: g.r1 - 1 - i - (g.r2 - k), dc: 0 })
        });
        vals.forEach((v, i) => ch.push([dir === 'down' ? g.r2 + 1 + i : g.r1 - 1 - i, c, v]));
      }
    } else {
      for (let r = g.r1; r <= g.r2; r++) {
        const src = d.rows[r].slice(g.c1, g.c2 + 1);
        if (dir === 'left') src.reverse();
        const vals = fillSeries(src, n, {
          invert,
          offset: (i, k) => (dir === 'right' ? { dr: 0, dc: g.c2 + 1 + i - (g.c1 + k) } : { dr: 0, dc: g.c1 - 1 - i - (g.c2 - k) })
        });
        vals.forEach((v, i) => ch.push([r, dir === 'right' ? g.c2 + 1 + i : g.c1 - 1 - i, v]));
      }
    }
    const sel = {
      a: { r: dir === 'up' ? g.r1 - n : g.r1, c: dir === 'left' ? g.c1 - n : g.c1 },
      f: { r: dir === 'down' ? g.r2 + n : g.r2, c: dir === 'right' ? g.c2 + n : g.c2 }
    };
    writeCells(ch, { structural, select: sel });
  }

  /** Strg+D / Strg+R: obere bzw. linke Zelle(n) in den Bereich kopieren */
  function fillInto(dir) {
    const g = range();
    if (!g) return;
    const ch = [];
    if (dir === 'down') {
      if (g.r1 === g.r2) { if (g.r1 === 0) return; g.r1--; }
      for (let c = g.c1; c <= g.c2; c++) {
        const v = d.rows[g.r1][c];
        for (let r = g.r1 + 1; r <= g.r2; r++) ch.push([r, c, isFormula(v) ? escapeHtml(shiftFormula(plain(v), r - g.r1, 0)) : v]);
      }
    } else {
      if (g.c1 === g.c2) { if (g.c1 === 0) return; g.c1--; }
      for (let r = g.r1; r <= g.r2; r++) {
        const v = d.rows[r][g.c1];
        for (let c = g.c1 + 1; c <= g.c2; c++) ch.push([r, c, isFormula(v) ? escapeHtml(shiftFormula(plain(v), 0, c - g.c1)) : v]);
      }
    }
    const active = document.activeElement;
    writeCells(ch);
    if (active?.classList.contains('cell') && table.contains(active)) { active.innerHTML = d.rows[+active.dataset.r][+active.dataset.c]; placeCaret(active, true); }
  }

  // ---------- Tabelle aufbauen ----------
  if (d.heads) {
    const tr = h('tr.col-heads', {}, h('th.corner', { title: 'Alles markieren', onclick: () => { setSel({ r: 0, c: 0 }, { r: d.rows.length - 1, c: cols - 1 }); wrap.focus(); } }));
    for (let c = 0; c < cols; c++) {
      const th = h('th.col-head', { text: colName(c), dataset: { c } });
      th.addEventListener('pointerdown', (e) => { e.preventDefault(); const s = getSel(); setSel(e.shiftKey && s ? { r: 0, c: s.a.c } : { r: 0, c }, { r: d.rows.length - 1, c }); wrap.focus(); });
      th.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(e, 0, c); });
      tr.append(th);
    }
    table.append(tr);
  }

  d.rows.forEach((row, r) => {
    const tr = h('tr');
    if (d.heads) {
      const rh = h('td.row-head', { text: r + 1, dataset: { r } });
      rh.addEventListener('pointerdown', (e) => { e.preventDefault(); const s = getSel(); setSel(e.shiftKey && s ? { r: s.a.r, c: 0 } : { r, c: 0 }, { r, c: cols - 1 }); wrap.focus(); });
      tr.append(rh);
    }
    row.forEach((val, c) => {
      const cell = h('div.cell', { contenteditable: 'true', 'data-field': `rows.${r}.${c}`, dataset: { r, c }, spellcheck: 'false' });
      cell.innerHTML = val || '';
      const td = h(r === 0 && d.header ? 'th' : 'td', {}, cell);
      if (r === 0) {
        const rz = h('div.col-resize');
        rz.addEventListener('pointerdown', (e) => startResize(e, c));
        td.append(rz);
      }
      td.addEventListener('contextmenu', (e) => { e.preventDefault(); const g = range(); if (!g || r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) setSel({ r, c }); menu(e, r, c); });
      cell.addEventListener('pointerdown', (e) => onCellDown(e, r, c));
      cell.addEventListener('focus', () => {
        if (!wrap.dataset.keepRange) setSel({ r, c });
        if (isFormula(d.rows[r][c])) { cell.innerHTML = d.rows[r][c]; placeCaret(cell, true); cell.classList.remove('formula'); }
        updateFormulaBar();
      });
      cell.addEventListener('blur', () => requestAnimationFrame(refreshAll));
      cell.addEventListener('keydown', (e) => onKey(e, cell));
      tr.append(td);
    });
    table.append(tr);
  });

  // ---------- Maus ----------
  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.cell');
    return el && table.contains(el) ? { r: +el.dataset.r, c: +el.dataset.c } : null;
  }

  function onCellDown(e, r, c) {
    if (e.button !== 0) return;
    const s = getSel();
    if (e.shiftKey && s) {
      e.preventDefault();
      setSel(s.a, { r, c });
      wrap.focus();
      return;
    }
    const start = { r, c };
    let multi = false;
    const move = (ev) => {
      const p = cellAt(ev.clientX, ev.clientY);
      if (!p) return;
      if (!multi && (p.r !== start.r || p.c !== start.c)) {
        multi = true;
        window.getSelection().removeAllRanges();
        document.body.classList.add('cell-selecting');
        wrap.focus({ preventScroll: true });
      }
      if (multi) { window.getSelection().removeAllRanges(); setSel(start, p); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('cell-selecting');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Ausfüllkästchen ziehen
  selBox.querySelector('.fill-handle').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const g = range();
    if (!g) return;
    const trs = [...table.querySelectorAll('tr:not(.col-heads)')];
    const lastRow = trs.at(-1).getBoundingClientRect();
    const rowH = lastRow.height || 36;
    const firstRowCells = [...trs[0].querySelectorAll('.cell')].map((el) => el.parentElement.getBoundingClientRect());
    const colW = firstRowCells.at(-1)?.width || 120;
    let target = null;
    document.body.classList.add('cell-filling');
    const move = (ev) => {
      // Zeile/Spalte unter dem Mauszeiger (auch außerhalb der Tabelle)
      let r = trs.findIndex((tr) => { const b2 = tr.getBoundingClientRect(); return ev.clientY >= b2.top && ev.clientY < b2.bottom; });
      if (r < 0) r = ev.clientY >= lastRow.bottom ? d.rows.length - 1 + Math.ceil((ev.clientY - lastRow.bottom) / rowH) : 0;
      let c = firstRowCells.findIndex((b2) => ev.clientX >= b2.left && ev.clientX < b2.right);
      if (c < 0) c = ev.clientX >= firstRowCells.at(-1).right ? cols - 1 + Math.ceil((ev.clientX - firstRowCells.at(-1).right) / colW) : 0;
      const down = r - g.r2, up2 = g.r1 - r, right = c - g.c2, left = g.c1 - c;
      const best = Math.max(down, up2, right, left);
      if (best <= 0) { target = null; fillPreview.style.display = 'none'; return; }
      target = best === down ? ['down', down] : best === up2 ? ['up', up2] : best === right ? ['right', right] : ['left', left];
      // Vorschau-Rahmen
      const base = scroll.getBoundingClientRect();
      const box = selBox.getBoundingClientRect();
      let { left: L, top: T, width: W, height: H } = box;
      if (target[0] === 'down') H += target[1] * rowH;
      if (target[0] === 'up') { T -= target[1] * rowH; H += target[1] * rowH; }
      if (target[0] === 'right') W += target[1] * colW;
      if (target[0] === 'left') { L -= target[1] * colW; W += target[1] * colW; }
      Object.assign(fillPreview.style, { display: 'block', left: L - base.left + scroll.scrollLeft + 'px', top: T - base.top + 'px', width: W + 'px', height: H + 'px' });
      fillPreview.dataset.count = `${target[1]} ${target[0] === 'down' || target[0] === 'up' ? 'Zeile(n)' : 'Spalte(n)'}`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('cell-filling');
      fillPreview.style.display = 'none';
      if (target) fill(target[0], target[1], ev.ctrlKey);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // Runder Griff (vor allem für Touch): Markierung mit dem Finger erweitern
  selBox.querySelector('.range-handle').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const g = range();
    if (!g) return;
    const anchor = { r: g.r1, c: g.c1 };
    document.body.classList.add('cell-selecting');
    wrap.focus({ preventScroll: true });
    const move = (ev) => { const p = cellAt(ev.clientX, ev.clientY); if (p) setSel(anchor, p); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('cell-selecting');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  selBox.querySelector('.fill-handle').addEventListener('dblclick', () => {
    // Doppelklick: bis zum Ende der Tabelle ausfüllen (wie in Excel)
    const g = range();
    if (g && g.r2 < d.rows.length - 1) fill('down', d.rows.length - 1 - g.r2);
  });

  // ---------- Tastatur ----------
  function onKey(e, cell) {
    const inCell = !!cell;
    const s = getSel();
    if (!s) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const multi = isMulti();

    if (mod && k === 'c' && (multi || !inCell || window.getSelection().isCollapsed)) { e.preventDefault(); e.stopPropagation(); copyRange(); return; }
    if (mod && k === 'x' && (multi || !inCell)) { e.preventDefault(); e.stopPropagation(); copyRange(true); return; }
    if (mod && k === 'd') { e.preventDefault(); e.stopPropagation(); fillInto('down'); return; }
    if (mod && k === 'r') { e.preventDefault(); e.stopPropagation(); fillInto('right'); return; }
    if (mod && k === 'a' && !e.shiftKey) {
      // 1× Zellinhalt · 2× ganze Tabelle · 3× alle Blöcke der Notiz (übernimmt der Editor)
      const g = range();
      const whole = g && g.r1 === 0 && g.c1 === 0 && g.r2 === d.rows.length - 1 && g.c2 === cols - 1;
      if (inCell && cell.textContent && window.getSelection().toString().length < cell.textContent.length) return;
      if (whole && !inCell) return;
      e.preventDefault();
      setSel({ r: 0, c: 0 }, { r: d.rows.length - 1, c: cols - 1 });
      wrap.focus();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (multi || !inCell)) { e.preventDefault(); e.stopPropagation(); clearRange(); return; }

    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (delta && e.shiftKey) {
      const sel = window.getSelection();
      const atEdge = !inCell || delta[0] !== 0 || (sel.isCollapsed && (delta[1] < 0 ? caretAt(cell, 'start') : caretAt(cell, 'end')));
      if (atEdge) {
        e.preventDefault();
        setSel(s.a, { r: s.f.r + delta[0], c: s.f.c + delta[1] });
        if (isMulti()) wrap.focus({ preventScroll: true });
        return;
      }
    }
    if (!inCell) {
      if (delta) { e.preventDefault(); const p = clampPos({ r: s.a.r + delta[0], c: s.a.c + delta[1] }); setSel(p, p, { focusCell: true }); return; }
      if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setSel(s.a, s.a, { focusCell: true }); return; }
      if (e.key === 'Escape') { e.preventDefault(); selections.delete(b.id); paint(); ctx.editor.selectBlock(b.id); return; }
      if (e.key.length === 1 && !mod) {
        // Tippen ersetzt den Inhalt der aktiven Zelle (wie in Excel)
        const el = cellEl(s.a.r, s.a.c);
        setSel(s.a);
        el.innerHTML = '';
        el.focus();
        return;
      }
      return;
    }

    // In einer Zelle
    const { r, c } = { r: +cell.dataset.r, c: +cell.dataset.c };
    const go = (rr, cc) => { const t = cellEl(rr, cc); if (t) { placeCaret(t, true); return true; } return false; };
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) { if (!go(r, c - 1)) go(r - 1, cols - 1); }
      else if (!go(r, c + 1) && !go(r + 1, 0)) ops.addRow(d.rows.length);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!go(r + (e.altKey ? -1 : 1), c) && !e.altKey) ops.addRow(d.rows.length);
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault();
      if (!go(r - 1, c)) ctx.focusPrev();
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      if (!go(r + 1, c)) ctx.focusNext() || ctx.insertAfter('paragraph');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cell.blur();
      wrap.focus();
    }
  }
  wrap.addEventListener('keydown', (e) => { if (e.target === wrap) onKey(e, null); });

  // Einfügen: Bereiche, Daten aus Excel, ein Wert auf alle markierten Felder
  wrap.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text/plain');
    const inCell = e.target.closest?.('.cell');
    if (!inCell || isMulti() || /[\t\n]/.test(text.replace(/\n$/, '')) || (clip && clip.tsv === text && isFormula(clip.raw[0]?.[0]))) {
      e.preventDefault();
      e.stopPropagation();
      if (inCell) inCell.blur();
      pasteText(text);
    }
  });
  wrap.addEventListener('copy', (e) => { if (e.target === wrap || isMulti()) e.preventDefault(); });
  wrap.addEventListener('input', () => requestAnimationFrame(() => { refreshAll(); paint(); }));
  wrap.addEventListener('focusout', (e) => {
    if (!wrap.contains(e.relatedTarget)) setTimeout(() => { if (!wrap.contains(document.activeElement)) { wrap.classList.remove('active'); } }, 0);
  });
  wrap.addEventListener('focusin', () => wrap.classList.add('active'));

  // ---------- Kontextmenü ----------
  function menu(e, r, c) {
    const g = range();
    const multi = isMulti();
    contextMenu([
      { header: multi ? `Bereich ${cellName(g.r1, g.c1)}:${cellName(g.r2, g.c2)}` : `Zelle ${cellName(r, c)}` },
      { label: 'Kopieren', icon: 'copy', shortcut: 'Ctrl+C', run: () => copyRange() },
      { label: 'Ausschneiden', icon: 'copy', shortcut: 'Ctrl+X', run: () => copyRange(true) },
      { label: 'Einfügen', icon: 'copy', shortcut: 'Ctrl+V', run: async () => { try { pasteText(await navigator.clipboard.readText()); } catch { toast('Bitte Strg+V verwenden'); } } },
      { label: 'Inhalt löschen', icon: 'x', shortcut: 'Delete', run: () => clearRange() },
      { label: 'Ausfüllen', icon: 'chevronDown', submenu: [
        { label: 'Nach unten', shortcut: 'Ctrl+D', run: () => fillInto('down') },
        { label: 'Nach rechts', shortcut: 'Ctrl+R', run: () => fillInto('right') },
        { label: 'Bis zum Tabellenende', run: () => { const gg = range(); if (gg.r2 < d.rows.length - 1) fill('down', d.rows.length - 1 - gg.r2); } }
      ] },
      '-',
      { label: 'Sortieren', icon: 'listOrdered', submenu: [
        { label: `Spalte ${colName(c)}: A → Z / 0 → 9`, run: () => ops.sort(c, 1) },
        { label: `Spalte ${colName(c)}: Z → A / 9 → 0`, run: () => ops.sort(c, -1) }
      ] },
      { label: 'Summenzeile hinzufügen', icon: 'plus', run: ops.sumRow },
      { label: 'Zeilen & Spalten', icon: 'table', submenu: [
        { label: 'Zeile oberhalb einfügen', run: () => ops.addRow(r) },
        { label: 'Zeile unterhalb einfügen', run: () => ops.addRow(r + 1) },
        { label: 'Zeile duplizieren', run: () => ops.dupRow(r) },
        { label: 'Spalte links einfügen', run: () => ops.addCol(c) },
        { label: 'Spalte rechts einfügen', run: () => ops.addCol(c + 1) },
        '-',
        { label: 'Zeile löschen', danger: true, run: () => ops.delRow(r) },
        { label: 'Spalte löschen', danger: true, run: () => ops.delCol(c) }
      ] },
      '-',
      { label: d.header ? 'Kopfzeile ausschalten' : 'Kopfzeile einschalten', icon: 'h3', run: ops.toggleHeader },
      { label: d.heads ? 'Beschriftung A, B, 1, 2 ausblenden' : 'Beschriftung A, B, 1, 2 einblenden', icon: 'hash', run: ops.toggleHeads },
      floating
        ? { label: 'Zurück in den Text', icon: 'alignCenter', run: () => ctx.unfloat() }
        : { label: 'Frei bewegen', icon: 'move', run: makeFloating },
      { label: 'Tabelle löschen', icon: 'trash', danger: true, run: () => ctx.remove() }
    ], { x: e.clientX, y: e.clientY });
  }

  function makeFloating() {
    const ed = ctx.editor;
    const pr = ed.page.getBoundingClientRect();
    const r = wrap.getBoundingClientRect();
    // Maße vor dem Entfernen aus dem Text messen
    const width = Math.max(320, Math.round(Math.min(r.width, table.getBoundingClientRect().width + 60)));
    const block = ed.block(b.id);
    ed.removeBlock(b.id);
    ed.floats.addBlock(block, r.left - pr.left, r.top - pr.top, width);
    toast('Tabelle ist jetzt frei beweglich – am Griff oben ziehen', { type: 'success' });
  }

  // ---------- Spaltenbreite ----------
  function startResize(e, c) {
    e.preventDefault();
    e.stopPropagation();
    const ths = [...table.querySelectorAll('tr:not(.col-heads)')[0].children].filter((x) => !x.classList.contains('row-head'));
    d.widths = ths.map((th) => Math.round(th.getBoundingClientRect().width));
    const startX = e.clientX, startW = d.widths[c];
    const colsEls = [...colgroup.children].filter((x) => !x.classList.contains('head-col'));
    colsEls.forEach((cl, i) => { cl.style.width = d.widths[i] + 'px'; });
    table.style.width = 'auto';
    document.body.classList.add('col-resizing');
    const move = (ev) => { d.widths[c] = Math.max(50, Math.round(startW + ev.clientX - startX)); colsEls[c].style.width = d.widths[c] + 'px'; paint(); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('col-resizing');
      ctx.update({ widths: d.widths }, { commit: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  if (d.widths) table.style.width = 'auto';

  // ---------- Werkzeuge ----------
  const addCol = h('button.table-add.col', { title: 'Spalte hinzufügen' }, icon('plus', 14));
  addCol.addEventListener('click', () => ops.addCol(cols));
  const addRow = h('button.table-add.row', { title: 'Zeile hinzufügen' }, icon('plus', 14));
  addRow.addEventListener('click', () => ops.addRow(d.rows.length));
  const tool = (ic, title, run) => { const t = h('button.tb-btn', { title }, icon(ic, 14)); t.addEventListener('mousedown', (e) => e.preventDefault()); t.addEventListener('click', run); return t; };
  const tools = h('div.table-tools', {},
    tool('hash', 'Beschriftung A, B, 1, 2', ops.toggleHeads),
    tool('plus', 'Summenzeile hinzufügen', ops.sumRow),
    floating ? tool('alignCenter', 'Zurück in den Text', () => ctx.unfloat()) : tool('move', 'Frei bewegen', makeFloating));

  scroll.append(table, selBox, fillPreview, addCol);
  wrap.append(formulaBar, tools, scroll, addRow);

  // Nach dem Einhängen: Formeln berechnen und Markierung zeichnen
  requestAnimationFrame(() => { refreshAll(); if (getSel()) paint(); });
  return wrap;
}

function caretAt(el, where) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return true;
  const r = sel.getRangeAt(0).cloneRange();
  const full = document.createRange();
  full.selectNodeContents(el);
  if (where === 'start') { full.setEnd(r.startContainer, r.startOffset); return full.toString().length === 0; }
  full.setStart(r.endContainer, r.endOffset);
  return full.toString().length === 0;
}
