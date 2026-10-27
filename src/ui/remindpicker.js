// Glocke am To-do: wann soll das Handy bzw. AleNote erinnern? (mehrere Zeitpunkte möglich)
import { h, formatDate } from '../core/utils.js';
import { icon } from './icons.js';
import { popover, closeMenu } from './overlays.js';
import { REMIND_OPTIONS, offsetLabel, dueTime } from '../core/reminders.js';
import { dueLabel, DAY_NAMES } from '../core/todos.js';

/**
 * remindPicker(anchor, { due, time, remind, rs, onChange(list), onPickDate() })
 * remind: Minuten vor der Fälligkeit, z.B. [60, 1440]; [] = keine Erinnerung
 */
export function remindPicker(anchor, { due, time, remind = [], rs, onChange, onPickDate }) {
  let sel = [...new Set(remind.map(Number))];
  const body = h('div.remindpicker');

  const render = () => {
    body.innerHTML = '';
    body.append(h('div.rp-head', {}, icon('bell', 15), h('b', { text: 'Erinnerung' }), h('div.flex'),
      due ? h('span.muted.small', { text: 'fällig ' + dueLabel(due, time) }) : null));
    if (!due) {
      body.append(h('p.muted.small', { text: 'Für eine Erinnerung braucht das To-do ein Datum (und am besten eine Uhrzeit).' }),
        h('button.btn.btn-primary.small', { onclick: () => { closeMenu(); onPickDate?.(); } }, icon('calendar', 14), 'Datum festlegen'));
      return;
    }
    if (!time) body.append(h('p.muted.small.rp-hint', { text: `Ohne Uhrzeit gilt ${rs.defaultTime} Uhr als Fälligkeit.` }));
    const at = dueTime({ due, time }, rs);
    const opts = [...new Set([...REMIND_OPTIONS, ...sel])].sort((a, b) => a - b);
    const list = h('div.rp-list');
    for (const off of opts) {
      const on = sel.includes(off);
      const when = new Date(at - off * 6e4);
      const past = when.getTime() < Date.now();
      list.append(h('button.rp-opt' + (on ? '.on' : '') + (past ? '.past' : ''), {
        onclick: () => {
          sel = on ? sel.filter((x) => x !== off) : [...sel, off].sort((a, b) => a - b);
          onChange(sel);
          render();
        }
      }, h('span.rp-box', {}, on ? icon('check', 12) : null), h('span.rp-label', { text: offsetLabel(off) }),
      h('span.rp-when.muted.small', { text: past ? 'vorbei' : DAY_NAMES[when.getDay()] + '. ' + formatDate(when, 'DD.MM. · HH:mm') })));
    }
    body.append(list);

    // Eigener Zeitpunkt
    const num = h('input.input.rp-num', { type: 'number', min: '1', max: '999', value: '2', inputmode: 'numeric' });
    const unit = h('select.input.select.rp-unit', {},
      h('option', { value: '1', text: 'Minuten' }), h('option', { value: '60', text: 'Stunden', selected: true }),
      h('option', { value: '1440', text: 'Tage' }), h('option', { value: '10080', text: 'Wochen' }));
    const add = () => {
      const off = Math.round(Number(num.value) * Number(unit.value));
      if (!(off > 0) || sel.includes(off)) return;
      sel = [...sel, off].sort((a, b) => a - b);
      onChange(sel);
      render();
    };
    body.append(h('div.rp-custom', {}, h('span.muted.small', { text: 'Eigene:' }), num, unit, h('span.muted.small', { text: 'vorher' }),
      h('button.icon-btn.tiny', { title: 'Hinzufügen', onclick: add }, icon('plus', 14))));
    body.append(h('div.rp-foot', {},
      sel.length ? h('button.link-btn.danger', { text: 'Keine Erinnerung', onclick: () => { sel = []; onChange(sel); closeMenu(); } }) : null,
      h('div.flex'),
      h('button.btn.small.btn-primary', { text: 'Fertig', onclick: () => closeMenu() })));
  };
  render();
  return popover(body, anchor, { className: 'rp-popover' });
}
