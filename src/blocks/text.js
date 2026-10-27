// Text-Blöcke: Absatz, Überschriften, Listen, To-do, Zitat, Callout
import { h, stripHtml } from '../core/utils.js';
import { emojiPicker } from '../ui/pickers.js';
import { contextMenu } from '../ui/overlays.js';
import { BLOCK_COLORS } from '../ui/editor.js';
import { icon } from '../ui/icons.js';
import { datePicker } from '../ui/datepicker.js';
import { dueLabel, dueState } from '../core/todos.js';
import { offsetLabel, remindSettings } from '../core/reminders.js';
import { remindPicker } from '../ui/remindpicker.js';

/** Erstellt das Haupt-Textfeld eines Blocks */
export function editable(block, { tag = 'div', field = 'text', placeholder = '', cls = '' } = {}) {
  const el = h(`${tag}.editable${cls ? '.' + cls : ''}`, {
    contenteditable: 'true',
    'data-field': field,
    'data-editable': 'main',
    'data-placeholder': placeholder
  });
  el.innerHTML = block.data[field] || '';
  return el;
}

export function htmlToMarkdown(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  const walk = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return n.textContent.replace(/ /g, ' ');
    if (n.nodeType !== 1) return '';
    const inner = walk(n);
    switch (n.tagName) {
      case 'B': case 'STRONG': return inner.trim() ? `**${inner}**` : inner;
      case 'I': case 'EM': return inner.trim() ? `*${inner}*` : inner;
      case 'S': case 'STRIKE': case 'DEL': return `~~${inner}~~`;
      case 'CODE': return '`' + inner + '`';
      case 'A': return `[${inner}](${n.getAttribute('href')})`;
      case 'BR': return '  \n';
      case 'DIV': case 'P': return '\n' + inner;
      default: return inner;
    }
  }).join('');
  return walk(d);
}

const textBlock = (def) => ({ text: true, group: 'Text', create: () => ({ text: '' }), ...def });

export default function registerTextBlocks(registry) {
  registry.registerBlock(textBlock({
    type: 'paragraph', name: 'Text', icon: 'text', description: 'Einfacher Textabsatz', keywords: ['absatz', 'paragraph', 'p'],
    render: (b) => editable(b, { placeholder: "Schreibe etwas oder tippe '/' für Befehle…", cls: 'p' }),
    toMarkdown: (b) => htmlToMarkdown(b.data.text)
  }));

  [1, 2, 3].forEach((n) => registry.registerBlock(textBlock({
    type: 'h' + n, name: `Überschrift ${n}`, icon: 'h' + n, description: ['Große', 'Mittlere', 'Kleine'][n - 1] + ' Überschrift',
    keywords: ['heading', 'titel', 'überschrift', '#'.repeat(n)],
    markdown: new RegExp(`^${'#'.repeat(n)}\\s`),
    render: (b) => editable(b, { tag: 'h' + (n + 1), placeholder: `Überschrift ${n}`, cls: 'heading' }),
    toMarkdown: (b) => '#'.repeat(n) + ' ' + htmlToMarkdown(b.data.text)
  })));

  registry.registerBlock(textBlock({
    type: 'bullet', name: 'Aufzählung', icon: 'list', description: 'Einfache Liste mit Punkten', keywords: ['liste', 'bullet', 'ul', 'punkte'],
    group: 'Listen', continues: true, markdown: /^[-*•]\s/,
    render: (b) => h('div.list-row', {}, h('span.list-marker.bullet', { text: ['•', '◦', '▪'][(b.indent || 0) % 3] }), editable(b, { placeholder: 'Listeneintrag' })),
    toMarkdown: (b) => '  '.repeat(b.indent || 0) + '- ' + htmlToMarkdown(b.data.text)
  }));

  registry.registerBlock(textBlock({
    type: 'numbered', name: 'Nummerierte Liste', icon: 'listOrdered', description: 'Liste mit Nummern', keywords: ['nummer', 'ol', 'zahlen', 'liste'],
    group: 'Listen', continues: true, markdown: /^1[.)]\s/,
    render: (b) => h('div.list-row', {}, h('span.list-marker.num', { text: '1.' }), editable(b, { placeholder: 'Listeneintrag' })),
    toMarkdown: (b) => '  '.repeat(b.indent || 0) + '1. ' + htmlToMarkdown(b.data.text)
  }));

  registry.registerBlock(textBlock({
    type: 'todo', name: 'To-do', icon: 'checkSquare', description: 'Aufgabe mit Checkbox', keywords: ['todo', 'aufgabe', 'checkbox', 'check', 'task'],
    group: 'Listen', continues: true, create: () => ({ text: '', checked: false }),
    markdown: [/^\[\s?\]\s/, { pattern: /^\[x\]\s/i, data: { checked: true } }],
    render(b, ctx) {
      const box = h('button.todo-check' + (b.data.checked ? '.checked' : ''), { title: 'Erledigt', html: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
      const row = h('div.list-row.todo' + (b.data.checked ? '.done' : ''), {}, box, editable(b, { placeholder: 'Aufgabe' }));
      // Fälligkeitsdatum (erscheint im Kalender)
      const due = h('button.todo-due' + (b.data.due ? '.has.' + (dueState(b.data.due, b.data.checked) || 'later') : ''), {
        title: b.data.due ? 'Fälligkeitsdatum ändern' : 'Fälligkeitsdatum festlegen',
        contenteditable: 'false',
        onmousedown: (e) => e.preventDefault(),
        onclick: () => datePicker(due, { due: b.data.due, time: b.data.dueTime, onPick: (d, t) => {
          Object.assign(b.data, { due: d, dueTime: t });
          if (!d) { delete b.data.due; delete b.data.dueTime; }
          ctx.editor.rerenderBlock(b.id, { focus: 'end' });
          ctx.editor.changed(true);
          ctx.app.events.emit('todos:change');
        } })
      }, icon('calendar', 13), b.data.due ? h('span', { text: dueLabel(b.data.due, b.data.dueTime) }) : null);
      row.append(due);
      // Erinnerung (Glocke): mehrere Zeitpunkte vor der Fälligkeit
      const remind = Array.isArray(b.data.remind) ? b.data.remind : [];
      const bellOn = remind.length > 0 && !!b.data.due;
      const bell = h('button.todo-bell' + (bellOn ? '.on' : '') + (b.data.due ? '.dated' : ''), {
        title: bellOn ? 'Erinnerung: ' + remind.map((m) => offsetLabel(m)).join(', ') : 'Erinnerung aktivieren',
        contenteditable: 'false',
        onmousedown: (e) => e.preventDefault(),
        onclick: () => remindPicker(bell, {
          due: b.data.due, time: b.data.dueTime, remind, rs: remindSettings(ctx.app),
          onPickDate: () => due.click(),
          onChange: (list) => {
            if (list.length) b.data.remind = list; else delete b.data.remind;
            const on = list.length > 0;
            bell.classList.toggle('on', on);
            bell.title = on ? 'Erinnerung: ' + list.map((m) => offsetLabel(m)).join(', ') : 'Erinnerung aktivieren';
            bellLabel.textContent = on ? (list.length > 1 ? list.length + '×' : offsetLabel(list[0], true)) : '';
            ctx.editor.changed(true);
            ctx.app.events.emit('todos:change');
          }
        })
      }, icon('bell', 13));
      const bellLabel = h('span', { text: bellOn ? (remind.length > 1 ? remind.length + '×' : offsetLabel(remind[0], true)) : '' });
      bell.append(bellLabel);
      row.append(bell);
      box.addEventListener('click', () => {
        const checked = !b.data.checked;
        ctx.update({ checked });
        box.classList.toggle('checked', checked);
        row.classList.toggle('done', checked);
        if (checked) box.animate([{ transform: 'scale(.7)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 280, easing: 'ease-out' });
      });
      return row;
    },
    toMarkdown: (b) => '  '.repeat(b.indent || 0) + `- [${b.data.checked ? 'x' : ' '}] ` + htmlToMarkdown(b.data.text) + (b.data.due ? ` 📅 ${b.data.due}${b.data.dueTime ? ' ' + b.data.dueTime : ''}` : '')
  }));

  registry.registerBlock(textBlock({
    type: 'quote', name: 'Zitat', icon: 'quote', description: 'Hervorgehobenes Zitat', keywords: ['quote', 'zitat', 'blockquote'],
    markdown: /^>\s/,
    render: (b) => h('blockquote.quote', {}, editable(b, { placeholder: 'Zitat' })),
    toMarkdown: (b) => '> ' + htmlToMarkdown(b.data.text)
  }));

  registry.registerBlock(textBlock({
    type: 'callout', name: 'Hinweisbox', icon: 'callout', description: 'Box mit Icon für wichtige Hinweise', keywords: ['callout', 'hinweis', 'info', 'box', 'warnung'],
    create: () => ({ text: '', icon: '💡', tone: 'blue' }),
    markdown: /^!>\s/,
    render(b, ctx) {
      const ic = h('button.callout-icon', { text: b.data.icon || '💡', title: 'Icon ändern' });
      ic.addEventListener('click', () => emojiPicker(ic, (em) => ctx.update({ icon: em || '💡' }, { rerender: true })));
      const box = h('div.callout', { dataset: { tone: b.data.tone || 'blue' } }, ic, editable(b, { placeholder: 'Hinweis eingeben…' }));
      box.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu([{ header: 'Farbe der Box' }, ...BLOCK_COLORS.filter((c) => c.id).map((c) => ({
          label: c.name, swatch: `var(--bg-${c.id})`, active: b.data.tone === c.id, run: () => ctx.update({ tone: c.id }, { rerender: true })
        }))], { x: e.clientX, y: e.clientY });
      });
      return box;
    },
    toMarkdown: (b) => `> ${b.data.icon || '💡'} ${htmlToMarkdown(b.data.text)}`
  }));

  registry.registerBlock({
    type: 'toggle', name: 'Aufklappbar', icon: 'toggle', description: 'Ein- und ausklappbarer Inhalt', keywords: ['toggle', 'klappen', 'details', 'akkordeon'],
    group: 'Text', text: true, markdown: /^>>\s/,
    create: () => ({ text: '', body: '', open: true }),
    render(b, ctx) {
      const arrow = h('button.toggle-arrow' + (b.data.open ? '.open' : ''), { html: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
      const body = h('div.toggle-body-inner.editable', { contenteditable: 'true', 'data-field': 'body', 'data-placeholder': 'Inhalt…' });
      body.innerHTML = b.data.body || '';
      const bodyWrap = h('div.toggle-body' + (b.data.open ? '.open' : ''), {}, h('div', {}, body));
      const wrap = h('div.toggle', {}, h('div.toggle-head', {}, arrow, editable(b, { placeholder: 'Titel der Aufklappliste' })), bodyWrap);
      arrow.addEventListener('click', () => {
        const open = !b.data.open;
        ctx.update({ open }, { commit: true });
        arrow.classList.toggle('open', open);
        bodyWrap.classList.toggle('open', open);
        if (open) setTimeout(() => body.focus(), 150);
      });
      return wrap;
    },
    onKeyDown(e, ctx, el) {
      // Enter im Titel springt in den Inhalt
      if (e.key === 'Enter' && !e.shiftKey && ctx.block.data.open && el.textContent) {
        e.preventDefault();
        const body = el.closest('.toggle').querySelector('.toggle-body-inner');
        body.focus();
        return true;
      }
      return false;
    },
    toMarkdown: (b) => `<details><summary>${stripHtml(b.data.text)}</summary>\n\n${htmlToMarkdown(b.data.body)}\n\n</details>`
  });
}
