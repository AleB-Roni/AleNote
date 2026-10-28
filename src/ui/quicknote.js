// Schnellnotiz: kleines Eingabefenster, schreibt mit Datum & Uhrzeit in eine Notiz.
// Wird im App-Fenster als Dialog benutzt und auf dem Desktop zusätzlich als eigenes
// Fenster über eine globale Tastenkombination (siehe quick.js / main.js).
import { h, formatDate } from '../core/utils.js';
import { icon } from './icons.js';
import { modal, prompt, toast } from './overlays.js';
import { datePicker } from './datepicker.js';
import { addQuickNote, quickSettings, dueLabel } from '../core/todos.js';
import { startDictation } from '../ai/dictate.js';
import { plainIcon } from '../core/emoji.js';

/**
 * Baut das Formular.
 * notes:    [{ path, name, icon }]
 * qs:       Schnellnotiz-Einstellungen (target, asTodo …)
 * preset:   { due, asTodo, text } – z.B. vom Kalender
 * onSubmit: async (entry) => void
 */
export function quickNoteForm({ notes, qs, preset = {}, onSubmit, onCancel, dictate }) {
  const state = { target: qs.target, asTodo: preset.asTodo ?? (!!preset.due || qs.asTodo), due: preset.due || '', dueTime: preset.dueTime || '' };
  const clock = h('span.qn-clock');
  const tick = () => { clock.textContent = formatDate(new Date(), 'dddd, DD.MM.YYYY · HH:mm'); };
  tick();
  const timer = setInterval(() => (clock.isConnected ? tick() : clearInterval(timer)), 15e3);

  const text = h('textarea.qn-text', { rows: 4, placeholder: 'Was möchtest du festhalten?', spellcheck: 'true' });
  text.value = preset.text || '';

  // Ziel-Notiz
  const target = h('select.input.select.qn-target', { title: 'Wohin soll die Notiz geschrieben werden?' });
  const fill = () => {
    target.innerHTML = '';
    const list = [...notes];
    if (!list.some((n) => n.path === state.target)) list.unshift({ path: state.target, name: state.target.replace(/\.alenote$/, '').split('/').pop() + ' (neu)' });
    for (const n of list) target.append(h('option', { value: n.path, text: (n.icon ? plainIcon(n.icon) + ' ' : '📄 ') + n.path.replace(/\.alenote$/, ''), selected: n.path === state.target }));
    target.append(h('option', { value: '__new', text: '＋ Neue Notiz …' }));
  };
  fill();
  target.addEventListener('change', async () => {
    if (target.value !== '__new') { state.target = target.value; return; }
    const name = await prompt('Neue Notiz für Schnellnotizen', { placeholder: 'Name, z.B. Ideen oder Arbeit/Inbox', okLabel: 'Übernehmen' });
    if (name) state.target = name.replace(/\.alenote$/, '').replace(/^\/+|\/+$/g, '') + '.alenote';
    fill();
    text.focus();
  });

  // To-do + Fälligkeitsdatum
  const todoBtn = h('button.pill.qn-todo', { title: 'Als Aufgabe speichern (erscheint im Kalender, wenn ein Datum gesetzt ist)' });
  const dueBtn = h('button.pill.qn-due', { title: 'To-do-Datum festlegen' });
  const renderOpts = () => {
    todoBtn.classList.toggle('active', state.asTodo);
    todoBtn.replaceChildren(icon('checkSquare', 14), h('span', { text: 'To-do' }));
    dueBtn.classList.toggle('active', !!state.due);
    dueBtn.replaceChildren(icon('calendar', 14), h('span', { text: state.due ? dueLabel(state.due, state.dueTime) : 'Datum' }));
  };
  renderOpts();
  todoBtn.addEventListener('click', () => { state.asTodo = !state.asTodo; if (!state.asTodo) { state.due = ''; state.dueTime = ''; } renderOpts(); text.focus(); });
  dueBtn.addEventListener('click', () => datePicker(dueBtn, {
    due: state.due, time: state.dueTime,
    onPick: (d, t) => { state.due = d; state.dueTime = t; if (d) state.asTodo = true; renderOpts(); text.focus(); }
  }));

  // Diktieren: Text an der Cursorposition einfügen
  const micBtn = dictate ? h('button.qn-mic', { title: 'Diktieren – sprechen statt tippen', 'aria-label': 'Diktieren', onmousedown: (e) => e.preventDefault(), onclick: () => dictate((t) => {
    const a = text.selectionStart ?? text.value.length, b = text.selectionEnd ?? a;
    const before = text.value.slice(0, a), after = text.value.slice(b);
    const ins = (before && !/\s$/.test(before) ? ' ' : '') + t;
    text.value = before + ins + after;
    text.focus();
    text.setSelectionRange((before + ins).length, (before + ins).length);
  }) }, icon('mic', 20)) : null;

  const save = h('button.btn.btn-primary.qn-save', {}, icon('check', 15), 'Speichern');
  const submit = async () => {
    if (!text.value.trim()) { text.focus(); text.classList.add('shake'); setTimeout(() => text.classList.remove('shake'), 400); return; }
    save.disabled = true;
    try { await onSubmit({ text: text.value, target: state.target, asTodo: state.asTodo, due: state.due, dueTime: state.dueTime }); }
    catch (err) { toast(err.message, { type: 'error' }); save.disabled = false; }
  };
  save.addEventListener('click', submit);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(hover: none)').matches) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
  });

  const el = h('div.quicknote', {},
    h('div.qn-head', {}, h('span.qn-logo', {}, icon('zap', 15)), h('b', { text: 'Schnellnotiz' }), h('div.flex'), clock),
    h('div.qn-textwrap', {}, text, micBtn),
    h('div.qn-opts', {}, h('label.qn-where', {}, icon('file', 14), target), todoBtn, dueBtn),
    h('div.qn-foot', {}, h('span.muted.small', { html: '<kbd>Enter</kbd> speichern · <kbd>Shift</kbd><kbd>Enter</kbd> neue Zeile · <kbd>Esc</kbd> schließen' }), h('div.flex'), save));
  el.focusText = () => { text.focus(); text.setSelectionRange(text.value.length, text.value.length); };
  return el;
}

/** Schnellnotiz-Dialog im App-Fenster */
export function openQuickNote(app, preset = {}) {
  if (document.querySelector('.qn-modal')) { document.querySelector('.qn-modal .qn-text')?.focus(); return; }
  let m;
  const form = quickNoteForm({
    notes: app.sidebar.allNotes(), qs: quickSettings(app), preset,
    dictate: (onText) => startDictation(app, { onText }),
    onCancel: () => m.close(),
    onSubmit: async (entry) => {
      const path = await addQuickNote(app, entry);
      m.close();
      toast(`Gespeichert in „${path.replace(/\.alenote$/, '').split('/').pop()}“${entry.due ? ' · fällig ' + dueLabel(entry.due, entry.dueTime) : ''}`, { type: 'success' });
    }
  });
  m = modal({ content: form, width: 'min(560px, 94vw)', className: 'qn-modal' });
  setTimeout(() => form.focusText(), 40);
  return m;
}
