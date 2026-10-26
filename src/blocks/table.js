// Tabellen-Block: Zellen bearbeiten, Zeilen/Spalten hinzufügen, Spaltenbreite ziehen
import { h, stripHtml, placeCaret } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { contextMenu } from '../ui/overlays.js';
import { htmlToMarkdown } from './text.js';

const emptyRow = (n) => Array.from({ length: n }, () => '');

export default function registerTable(registry) {
  registry.registerBlock({
    type: 'table', name: 'Tabelle', icon: 'table', description: 'Tabelle mit Zeilen und Spalten', keywords: ['tabelle', 'table', 'grid', 'raster'],
    group: 'Medien',
    create: () => ({ rows: [emptyRow(3), emptyRow(3), emptyRow(3)], header: true, widths: null }),
    focusOnInsert(row) { const cell = row.querySelector('.cell'); if (cell) placeCaret(cell, true); },
    render(b, ctx) {
      const d = b.data;
      d.rows ||= [emptyRow(3)];
      const cols = Math.max(...d.rows.map((r) => r.length));
      d.rows.forEach((r) => { while (r.length < cols) r.push(''); });

      const table = h('table.table' + (d.header ? '.with-header' : ''));
      const colgroup = h('colgroup');
      for (let c = 0; c < cols; c++) colgroup.append(h('col', { style: { width: d.widths?.[c] ? d.widths[c] + 'px' : '' } }));
      table.append(colgroup);

      const restructure = (fn, focus) => {
        fn();
        ctx.update({ rows: d.rows, widths: d.widths }, { rerender: true });
        if (focus) {
          const [r, c] = focus;
          const cell = ctx.editor.rowEl(b.id)?.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
          if (cell) placeCaret(cell, true);
        }
      };
      const ops = {
        addRow: (at) => restructure(() => d.rows.splice(at, 0, emptyRow(cols)), [at, 0]),
        addCol: (at) => restructure(() => { d.rows.forEach((r) => r.splice(at, 0, '')); if (d.widths) d.widths.splice(at, 0, 140); }, [0, at]),
        delRow: (r) => { if (d.rows.length <= 1) return ctx.editor.removeBlock(b.id, { animate: true }); restructure(() => d.rows.splice(r, 1), [Math.max(0, r - 1), 0]); },
        delCol: (c) => { if (cols <= 1) return ctx.editor.removeBlock(b.id, { animate: true }); restructure(() => { d.rows.forEach((r) => r.splice(c, 1)); d.widths?.splice(c, 1); }, [0, Math.max(0, c - 1)]); }
      };

      d.rows.forEach((row, r) => {
        const tr = h('tr');
        row.forEach((val, c) => {
          const cell = h('div.cell', { contenteditable: 'true', 'data-field': `rows.${r}.${c}`, dataset: { r, c } });
          cell.innerHTML = val || '';
          const td = h(r === 0 && d.header ? 'th' : 'td', {}, cell);
          if (r === 0) {
            const rz = h('div.col-resize');
            rz.addEventListener('pointerdown', (e) => startResize(e, c));
            td.append(rz);
          }
          td.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            contextMenu([
              { label: 'Zeile oberhalb einfügen', icon: 'plus', run: () => ops.addRow(r) },
              { label: 'Zeile unterhalb einfügen', icon: 'plus', run: () => ops.addRow(r + 1) },
              { label: 'Spalte links einfügen', icon: 'plus', run: () => ops.addCol(c) },
              { label: 'Spalte rechts einfügen', icon: 'plus', run: () => ops.addCol(c + 1) },
              '-',
              { label: d.header ? 'Kopfzeile ausschalten' : 'Kopfzeile einschalten', icon: 'h3', run: () => restructure(() => { d.header = !d.header; }) },
              '-',
              { label: 'Zeile löschen', icon: 'trash', danger: true, run: () => ops.delRow(r) },
              { label: 'Spalte löschen', icon: 'trash', danger: true, run: () => ops.delCol(c) },
              { label: 'Tabelle löschen', icon: 'trash', danger: true, run: () => ctx.editor.removeBlock(b.id, { animate: true }) }
            ], { x: e.clientX, y: e.clientY });
          });
          cell.addEventListener('keydown', (e) => {
            const go = (rr, cc) => { const t = table.querySelector(`.cell[data-r="${rr}"][data-c="${cc}"]`); if (t) { placeCaret(t, true); return true; } return false; };
            if (e.key === 'Tab') {
              e.preventDefault();
              if (e.shiftKey) { if (!go(r, c - 1)) go(r - 1, cols - 1); }
              else if (!go(r, c + 1) && !go(r + 1, 0)) ops.addRow(d.rows.length);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!go(r + 1, c)) ops.addRow(d.rows.length);
            } else if (e.key === 'ArrowUp' && !e.shiftKey) {
              if (!go(r - 1, c)) { e.preventDefault(); ctx.focusPrev(); } else e.preventDefault();
            } else if (e.key === 'ArrowDown' && !e.shiftKey) {
              e.preventDefault();
              if (!go(r + 1, c)) ctx.focusNext() || ctx.insertAfter('paragraph');
            } else if (e.key === 'Escape') {
              e.preventDefault(); ctx.editor.selectBlock(b.id);
            }
          });
          tr.append(td);
        });
        table.append(tr);
      });

      function startResize(e, c) {
        e.preventDefault();
        e.stopPropagation();
        const ths = table.querySelectorAll('tr:first-child > *');
        d.widths = [...ths].map((th) => Math.round(th.getBoundingClientRect().width));
        const startX = e.clientX, startW = d.widths[c];
        const col = colgroup.children;
        [...col].forEach((cl, i) => { cl.style.width = d.widths[i] + 'px'; });
        table.style.width = 'auto';
        document.body.classList.add('col-resizing');
        const move = (ev) => { d.widths[c] = Math.max(60, Math.round(startW + ev.clientX - startX)); col[c].style.width = d.widths[c] + 'px'; };
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

      const addCol = h('button.table-add.col', { title: 'Spalte hinzufügen' }, icon('plus', 14));
      addCol.addEventListener('click', () => ops.addCol(cols));
      const addRow = h('button.table-add.row', { title: 'Zeile hinzufügen' }, icon('plus', 14));
      addRow.addEventListener('click', () => ops.addRow(d.rows.length));
      return h('div.table-block', {}, h('div.table-scroll', {}, table, addCol), addRow);
    },
    toMarkdown(b) {
      const rows = b.data.rows || [];
      if (!rows.length) return '';
      const fmt = (r) => '| ' + r.map((c) => htmlToMarkdown(c).replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ').join(' | ') + ' |';
      const out = [fmt(rows[0]), '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(fmt)];
      return out.join('\n');
    },
    search: (b) => (b.data.rows || []).flat().map(stripHtml).join(' ')
  });
}
