// Tastenkürzel: Umwandlung Tastatur-Ereignis <-> Text wie "Ctrl+Shift+D"

const NAMED = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

/** Mac: die Befehlstaste ⌘ übernimmt die Rolle von Strg */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function eventToShortcut(e) {
  const mods = [];
  const ctrl = isMac ? e.metaKey : e.ctrlKey;
  const meta = isMac ? e.ctrlKey : e.metaKey;
  if (ctrl) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (meta) mods.push('Meta');
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = 'Num' + e.code.slice(6);
  else key = NAMED[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)) return null;
  return [...mods, key].join('+');
}

export const normalizeShortcut = (s) => {
  if (!s) return '';
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  const order = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const mods = order.filter((m) => parts.some((p) => p.toLowerCase() === m.toLowerCase()));
  const key = parts.find((p) => !order.some((m) => m.toLowerCase() === p.toLowerCase()));
  return [...mods, key ? (key.length === 1 ? key.toUpperCase() : key) : ''].filter(Boolean).join('+');
};

/** Hübsche Darstellung als Tasten-Chips */
export function shortcutHtml(s) {
  if (!s) return '';
  const names = isMac ? { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Meta: '⌃' } : { Ctrl: 'Strg', Shift: '⇧' };
  return s.split('+').map((k) => `<kbd>${names[k] || k}</kbd>`).join('');
}

/** Als Text, z.B. "Strg+N" bzw. auf dem Mac "⌘N" */
export function shortcutText(s) {
  if (!s) return '';
  if (!isMac) return s.replace('Ctrl', 'Strg');
  const names = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Meta: '⌃' };
  return s.split('+').map((k) => names[k] || k).join('');
}
