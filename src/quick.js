// Eigenes Schnellnotiz-Fenster (Desktop, globale Tastenkombination).
// Der Eintrag wird an das Hauptfenster geschickt, das ihn in die Notiz schreibt.
import { api } from './core/api.js';
import { h } from './core/utils.js';
import { registerBuiltinThemes, shiftHue } from './themes.js';
import { FONTS, ACCENTS } from './ui/settings.js';
import { quickNoteForm } from './ui/quicknote.js';
import { QUICK_DEFAULTS } from './core/todos.js';

const host = document.getElementById('quick');
const themes = new Map();
registerBuiltinThemes({ registerTheme: (t) => themes.set(t.id, t) });

function applyTheme(s) {
  const root = document.documentElement;
  const theme = themes.get(s.theme || 'dark') || themes.get('dark');
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.dataset.theme = theme.dark ? 'dark' : 'light';
  const accent = s.accent || theme.accent || ACCENTS[0];
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', shiftHue(accent, 40));
  root.style.setProperty('--font', (FONTS[s.font] || FONTS.system).css);
  document.body.classList.toggle('no-anim', s.animations === false);
}

const flatten = (nodes, out = []) => { for (const n of nodes) n.type === 'note' ? out.push(n) : flatten(n.children, out); return out; };

async function render() {
  const settings = await api.getSettings();
  applyTheme(settings);
  const notes = flatten(await api.tree());
  const form = quickNoteForm({
    notes,
    qs: { ...QUICK_DEFAULTS, ...(settings.quicknote || {}) },
    onCancel: () => api.quickHide(),
    onSubmit: async (entry) => {
      await api.quickSubmit(entry);
      host.replaceChildren(h('div.qn-done', {}, h('div.qn-done-icon', { text: '✓' }), h('div', { text: 'Gespeichert' })));
      setTimeout(() => api.quickHide(), 650);
    }
  });
  host.replaceChildren(form);
  form.focusText();
}

// Fenstergröße an Inhalt (inkl. geöffnetem Datumswähler) anpassen
let lastH = 0;
const fit = () => {
  // Das Fenster ist anfangs klein: Datumswähler immer unter dem Knopf öffnen, das Fenster wächst mit
  const dp = document.querySelector('.dp-popover');
  const btn = document.querySelector('.qn-due');
  if (dp && btn && !dp.dataset.placed) {
    const r = btn.getBoundingClientRect();
    dp.style.top = r.bottom + 6 + 'px';
    dp.style.left = Math.max(8, Math.min(r.left, innerWidth - dp.offsetWidth - 8)) + 'px';
    dp.dataset.placed = '1';
  }
  let bottom = 0;
  for (const el of document.querySelectorAll('#quick > *, .popover, .modal')) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  const hgt = Math.ceil(bottom + 14);
  if (hgt > 40 && Math.abs(hgt - lastH) > 2) { lastH = hgt; api.quickResize(hgt); }
};
new MutationObserver(() => requestAnimationFrame(fit)).observe(document.body, { childList: true, subtree: true, attributes: true });
new ResizeObserver(fit).observe(host);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.popover, .modal, .menu')) api.quickHide(); });
api.on('quicknote:show', () => render());
render();
