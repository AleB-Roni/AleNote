// Auswahlfenster für Emojis und Titelbilder
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { popover, closeMenu, prompt, contextMenu, confirmDialog, toast } from './overlays.js';
import { EMOJI_GROUPS, ALL_EMOJIS } from './emoji-data.js';
import { emojiStore, emojiNode, CUSTOM_RE, cleanName } from '../core/emoji.js';

export const GRADIENTS = {
  aurora: 'linear-gradient(120deg, #7f5af0 0%, #2cb67d 100%)',
  sunset: 'linear-gradient(120deg, #ff7e5f 0%, #feb47b 100%)',
  ocean: 'linear-gradient(120deg, #2193b0 0%, #6dd5ed 100%)',
  berry: 'linear-gradient(120deg, #8e2de2 0%, #f857a6 100%)',
  forest: 'linear-gradient(120deg, #134e5e 0%, #71b280 100%)',
  peach: 'linear-gradient(120deg, #ffecd2 0%, #fcb69f 100%)',
  night: 'linear-gradient(120deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  candy: 'linear-gradient(120deg, #a18cd1 0%, #fbc2eb 100%)',
  fire: 'linear-gradient(120deg, #f12711 0%, #f5af19 100%)',
  mint: 'linear-gradient(120deg, #43e97b 0%, #38f9d7 100%)',
  steel: 'linear-gradient(120deg, #485563 0%, #29323c 100%)',
  mesh: 'radial-gradient(circle at 20% 30%, #ff6ec4 0%, transparent 40%), radial-gradient(circle at 80% 20%, #7873f5 0%, transparent 45%), radial-gradient(circle at 60% 80%, #4ade80 0%, transparent 45%), #1e1b4b'
};

const GROUP_ICONS = { 'Smileys': '😀', 'Gesten & Menschen': '👋', 'Tiere & Natur': '🐶', 'Essen & Trinken': '🍎', 'Aktivitäten': '⚽', 'Reisen & Orte': '✈️', 'Objekte': '💡', 'Symbole': '❤️', 'Flaggen': '🏁' };
const RECENT_KEY = 'alenote-emoji-recent';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const remember = (em) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([em, ...recent().filter((x) => x !== em)].slice(0, 24))); } catch {} };

/**
 * Emoji-Auswahl mit Suche (deutsch), Kategorien, zuletzt benutzten und eigenen Emojis.
 * onPick(''): Icon entfernen · eigene Emojis kommen als „:name:“ zurück.
 * opts.remove: „Entfernen“-Knopf anzeigen (Standard: ja)
 */
export function emojiPicker(anchor, onPick, opts = {}) {
  const store = emojiStore();
  const pick = (em) => { closeMenu(); if (em) remember(em); onPick(em); };
  const wrap = h('div.emoji-picker');
  const search = h('input.input.small', { placeholder: 'Emoji suchen, z.B. „herz“ oder „kaffee“…' });
  const grid = h('div.emoji-grid');
  const tabs = h('div.emoji-tabs');
  const sections = {};

  const btn = (em, title) => {
    const custom = CUSTOM_RE.exec(em);
    const b = h('button.emoji-btn', { title: title || (custom ? em : ''), onclick: () => pick(em) }, custom ? emojiNode(em) : em);
    if (custom) {
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); customMenu(custom[1], e); });
      let t; // langes Drücken auf dem Handy
      b.addEventListener('touchstart', (e) => { t = setTimeout(() => customMenu(custom[1], e.touches[0]), 550); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(t));
    }
    return b;
  };
  const customMenu = (name, ev) => contextMenu([
    { label: 'Umbenennen …', icon: 'edit', run: async () => { const n = await prompt('Neuer Name', { value: name }); if (n) { try { await store.rename(name, n); } catch (err) { toast(err.message, { type: 'error' }); } } } },
    { label: 'Löschen', icon: 'trash', danger: true, run: async () => { if (await confirmDialog('Emoji löschen?', `„:${name}:“ verschwindet aus der Auswahl. Wo es schon benutzt wird, bleibt nur der Name stehen.`, { okLabel: 'Löschen' })) await store.remove(name); } }
  ], { x: ev.clientX, y: ev.clientY });

  const upload = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const name = await prompt('Name für dein Emoji', { value: cleanName(f.name.replace(/\.[^.]+$/, '')), placeholder: 'z.B. katze oder team_logo', okLabel: 'Hinzufügen' });
      if (!name) return;
      try { const n = await store.add(f, name); toast(`Emoji „:${n}:“ hinzugefügt`, { type: 'success' }); pick(`:${n}:`); }
      catch (err) { toast('Emoji konnte nicht gespeichert werden: ' + err.message, { type: 'error' }); }
    };
    input.click();
  };

  const section = (key, title, items) => {
    const head = h('div.emoji-group', { text: title });
    sections[key] = head;
    grid.append(head, ...items);
  };

  const render = (q = '') => {
    grid.innerHTML = '';
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const custom = store?.list || [];
    if (words.length) {
      const hits = new Set();
      for (const c of custom) if (words.every((w) => c.name.includes(w))) hits.add(`:${c.name}:`);
      for (const x of ALL_EMOJIS) if (words.every((w) => x.k.split(' ').some((k) => k.startsWith(w)) || x.e === w)) hits.add(x.e);
      if (!hits.size) { grid.append(h('div.emoji-empty.muted.small', { text: 'Nichts gefunden – versuch ein anderes Wort.' })); return; }
      section('hits', `Treffer (${hits.size})`, [...hits].slice(0, 240).map((e) => btn(e)));
      return;
    }
    const rec = recent().filter((e) => !CUSTOM_RE.test(e) || store?.get(CUSTOM_RE.exec(e)[1]));
    if (rec.length) section('recent', 'Zuletzt benutzt', rec.map((e) => btn(e)));
    if (store) section('custom', 'Eigene Emojis', [...custom.map((c) => btn(`:${c.name}:`)), h('button.emoji-btn.emoji-upload', { title: 'Eigenes Emoji hochladen (Bild, wird synchronisiert)', onclick: upload }, icon('plus', 16))]);
    for (const [g, list] of Object.entries(EMOJI_GROUPS)) section(g, g, list.map((x) => btn(x.e, x.k.split(' ')[0])));
  };

  const tab = (key, label, title) => h('button.emoji-tab', { title, onclick: () => { if (search.value) { search.value = ''; render(); } sections[key]?.scrollIntoView({ block: 'start' }); } }, label);
  tabs.append(tab('recent', icon('clock', 15), 'Zuletzt benutzt'), tab('custom', icon('star', 15), 'Eigene Emojis'),
    ...Object.entries(GROUP_ICONS).map(([g, e]) => tab(g, e, g)));

  search.addEventListener('input', () => {
    const v = search.value.trim();
    // Direkt eingegebene Emojis übernehmen
    if (/\p{Extended_Pictographic}/u.test(v)) { pick([...v].slice(0, 2).join('')); return; }
    render(v);
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('.emoji-btn')?.click(); } });
  wrap.append(
    h('div.emoji-head', {}, search,
      h('button.btn.small', { title: 'Zufällig', onclick: () => pick(ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)].e) }, '🎲'),
      opts.remove === false ? null : h('button.btn.small', { title: 'Entfernen', onclick: () => { closeMenu(); onPick(''); } }, icon('trash', 14))),
    tabs, grid);
  render();
  popover(wrap, anchor, { className: 'emoji-popover' });
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => search.focus(), 30);
}

export function coverPicker(anchor, app, onPick) {
  const wrap = h('div.cover-picker');
  const grid = h('div.cover-grid');
  for (const [key, val] of Object.entries(GRADIENTS)) {
    grid.append(h('button.cover-swatch', { style: { background: val }, title: key, onclick: () => { closeMenu(); onPick({ type: 'gradient', value: key }); } }));
  }
  wrap.append(h('div.menu-header', { text: 'Farbverläufe' }), grid,
    h('div.cover-actions-row', {},
      h('button.btn.small', { onclick: async () => { closeMenu(); const [src] = await app.api.pickImages(); if (src) onPick({ type: 'image', src }); } }, icon('upload', 14), 'Bild hochladen'),
      h('button.btn.small', { onclick: async () => { closeMenu(); const url = await prompt('Bild-URL', { placeholder: 'https://…' }); if (url) onPick({ type: 'image', src: url }); } }, icon('link', 14), 'Link')));
  popover(wrap, anchor);
}
