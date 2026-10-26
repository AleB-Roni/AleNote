// Tastenkürzel: Umwandlung Tastatur-Ereignis <-> Text wie "Ctrl+Shift+D"

const NAMED = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

export function eventToShortcut(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
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
  return s.split('+').map((k) => `<kbd>${k === 'Ctrl' ? 'Strg' : k === 'Shift' ? '⇧' : k}</kbd>`).join('');
}
