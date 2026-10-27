// Kleiner Kalender zum Auswählen eines Fälligkeitsdatums (mit optionaler Uhrzeit)
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { popover, closeMenu } from './overlays.js';
import { dayKey, parseDay, todayKey, addDays, MONTHS, dueLabel } from '../core/todos.js';

/**
 * datePicker(anchor, { due, time, onPick(due, time) })
 * onPick('', '') = Datum entfernen
 */
export function datePicker(anchor, { due = '', time = '', onPick }) {
  let view = parseDay(due || todayKey());
  view.setDate(1);
  let sel = due;
  const timeIn = h('input.input.dp-time', { type: 'time', value: time, title: 'Uhrzeit (optional)' });
  const grid = h('div.dp-grid');
  const title = h('div.dp-title');
  const pick = (d) => { closeMenu(); onPick(d, d ? timeIn.value : ''); };

  const render = () => {
    title.textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;
    grid.innerHTML = '';
    for (const n of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) grid.append(h('span.dp-dow', { text: n }));
    const start = new Date(view);
    start.setDate(1 - ((view.getDay() + 6) % 7));
    const today = todayKey();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      grid.append(h('button.dp-day' + (d.getMonth() !== view.getMonth() ? '.other' : '') + (k === today ? '.today' : '') + (k === sel ? '.sel' : ''), { text: String(d.getDate()), title: dueLabel(k), onclick: () => pick(k) }));
    }
  };
  const nav = (n) => { view.setMonth(view.getMonth() + n); render(); };
  const nextMonday = () => { const t = parseDay(todayKey()); return addDays(todayKey(), ((8 - t.getDay()) % 7) || 7); };

  const content = h('div.datepicker', {},
    h('div.dp-quick', {},
      h('button.pill', { text: 'Heute', onclick: () => pick(todayKey()) }),
      h('button.pill', { text: 'Morgen', onclick: () => pick(addDays(todayKey(), 1)) }),
      h('button.pill', { text: 'Nächste Woche', onclick: () => pick(nextMonday()) })),
    h('div.dp-head', {},
      h('button.icon-btn.tiny', { title: 'Voriger Monat', onclick: () => nav(-1) }, icon('chevronRight', 14, 'flip')),
      title,
      h('button.icon-btn.tiny', { title: 'Nächster Monat', onclick: () => nav(1) }, icon('chevronRight', 14))),
    grid,
    h('div.dp-foot', {}, icon('clock', 14), timeIn,
      h('div.flex'),
      due ? h('button.link-btn.danger', { text: 'Entfernen', onclick: () => pick('') }) : null,
      sel ? h('button.btn.small.btn-primary', { text: 'OK', onclick: () => pick(sel) }) : null));
  render();
  timeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(sel || todayKey()); });
  return popover(content, anchor, { className: 'dp-popover' });
}
