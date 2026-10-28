// Vorlagen-Auswahl: neue Notiz aus Vorlage oder Vorlage in die aktuelle Notiz einfügen
import { emojiNode } from '../core/emoji.js';
import { h, stripHtml } from '../core/utils.js';
import { icon } from './icons.js';
import { modal, toast, prompt } from './overlays.js';
import { listTemplates, newFromTemplate, insertTemplate, ensureStarterTemplates, saveAsTemplate, templateFolder } from '../core/templates.js';

/**
 * mode: 'new'    → neue Notiz (im Ordner folder)
 *       'insert' → in die geöffnete Notiz einfügen
 */
export async function openTemplatePicker(app, { mode = 'new', folder, afterId } = {}) {
  if (mode === 'insert' && !app.editor.note) { toast('Öffne zuerst eine Notiz'); return; }
  const created = await ensureStarterTemplates(app);
  const templates = listTemplates(app);
  const filter = h('input.input', { placeholder: 'Vorlage suchen …', spellcheck: 'false' });
  const grid = h('div.tpl-grid');
  let active = 0;
  let shown = [];

  const previews = new Map();
  const preview = async (t) => {
    if (previews.has(t.path)) return previews.get(t.path);
    let text = '';
    try {
      const d = await app.api.readNote(t.path);
      text = (d.blocks || []).map((b) => stripHtml(b.data?.text || '')).filter(Boolean).slice(0, 4).join(' · ');
    } catch {}
    previews.set(t.path, text);
    return text;
  };

  const choose = async (t) => {
    m.close();
    try {
      if (mode === 'insert') await insertTemplate(app, t.path, afterId);
      else await newFromTemplate(app, t.path, folder);
    } catch (err) { toast('Vorlage konnte nicht verwendet werden: ' + err.message, { type: 'error' }); }
  };

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    shown = templates.filter((t) => !q || t.name.toLowerCase().includes(q));
    active = Math.min(active, Math.max(0, shown.length - 1));
    grid.innerHTML = '';
    if (!shown.length) grid.append(h('div.muted.small.tpl-none', { text: 'Keine Vorlage gefunden.' }));
    shown.forEach((t, i) => {
      const desc = h('div.tpl-desc.muted.small');
      preview(t).then((txt) => { desc.textContent = txt || 'Leere Vorlage'; });
      const card = h('button.tpl-card' + (i === active ? '.active' : ''), { onclick: () => choose(t) },
        h('span.tpl-icon', {}, emojiNode(t.icon || '📄')),
        h('div.tpl-body', {}, h('div.tpl-name', { text: t.name.replace(/\{([^}]+)\}/g, '‹$1›') }), desc));
      card.addEventListener('mousemove', () => { if (active !== i) { active = i; grid.querySelectorAll('.tpl-card').forEach((c, k) => c.classList.toggle('active', k === i)); } });
      grid.append(card);
    });
  };
  filter.addEventListener('input', () => { active = 0; render(); });
  filter.addEventListener('keydown', (e) => {
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
    const move = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (move && shown.length) { e.preventDefault(); active = (active + move + shown.length) % shown.length; render(); }
    if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]); }
  });

  const content = h('div.tpl-picker', {},
    filter, grid,
    h('div.tpl-foot', {},
      h('span.muted.small', { html: `Vorlagen sind normale Notizen im Ordner <b>${templateFolder(app)}</b>. Platzhalter wie <code>{datum}</code>, <code>{wochentag}</code>, <code>{kw}</code> werden ersetzt.` }),
      h('div.flex'),
      app.editor.note ? h('button.btn.small', { onclick: async () => { m.close(); await saveCurrentAsTemplate(app); } }, icon('plus', 14), 'Aktuelle Notiz als Vorlage') : null));
  const m = modal({ title: mode === 'insert' ? 'Vorlage einfügen' : 'Neue Notiz aus Vorlage', content, width: 'min(720px, 94vw)', className: 'tpl-modal' });
  render();
  if (created) toast(`Startvorlagen im Ordner „${templateFolder(app)}“ angelegt – du kannst sie wie normale Notizen bearbeiten`, { duration: 4500 });
  setTimeout(() => filter.focus(), 40);
}

export async function saveCurrentAsTemplate(app) {
  if (!app.editor.note) { toast('Öffne zuerst eine Notiz'); return; }
  const name = await prompt('Als Vorlage speichern', { value: app.editor.title, placeholder: 'Name der Vorlage, z.B. Besprechung {datum}', okLabel: 'Speichern' });
  if (!name) return;
  const p = await saveAsTemplate(app, name);
  toast(`Vorlage „${name}“ gespeichert`, { type: 'success', action: { label: 'Öffnen', run: () => app.openNote(p) } });
}
