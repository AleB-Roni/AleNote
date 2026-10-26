// Auswahlfenster für Emojis und Titelbilder
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { popover, closeMenu, prompt } from './overlays.js';

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

const EMOJIS = {
  'Häufig': '📝 📒 📓 📔 📕 📗 📘 📙 📚 📖 🗒️ 🗂️ 📁 📂 📌 📍 📎 🖇️ ✏️ 🖊️ 🖋️ 🔖 🏷️ 💡 ⭐ 🌟 ✨ 🔥 ✅ ☑️ ❗ ❓ 💬 🗨️ 🧠 🎯 🚀 🏆 🎉',
  'Arbeit': '💼 📊 📈 📉 🗓️ 📅 ⏰ ⏳ 🧾 💰 💳 🏦 🧮 🖥️ 💻 ⌨️ 🖱️ 📱 ☎️ 📧 📨 📦 🔧 🔨 ⚙️ 🛠️ 🧰 🔬 🔭 🧪 📐 📏 🧩 🔒 🔑 🗝️',
  'Leben': '🏠 🏡 🛒 🍎 🍕 🍔 ☕ 🍵 🍰 🎂 🍷 🥗 🏃 🚴 🏋️ 🧘 ⚽ 🏀 🎮 🎲 🎸 🎧 🎬 📷 🎨 🖌️ ✈️ 🚗 🚲 🗺️ 🏖️ ⛰️ 🏕️ 🌍 🐶 🐱 🦊 🐼',
  'Natur': '🌱 🌿 🍀 🌵 🌴 🌲 🌳 🌸 🌺 🌻 🌹 🌷 🍁 🍂 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ 🌈 🌙 ⭐ 🌊 💧 🔥 ⚡ 🌋',
  'Symbole': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✔️ ❌ ⚠️ 🚫 ♻️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔶 🔷 ➡️ ⬅️ ⬆️ ⬇️ 🔁 ➕ ➖ 💲 #️⃣ ©️',
  'Gesichter': '😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😇 🥰 😍 🤩 😎 🤓 🧐 🤔 🤨 😐 😴 😮 😱 😤 😭 🥳 🤯 🙈 👍 👎 👏 🙌 💪 🤝 ✌️ 👋'
};

export function emojiPicker(anchor, onPick) {
  const wrap = h('div.emoji-picker');
  const search = h('input.input.small', { placeholder: 'Emoji suchen oder einfügen…' });
  const grid = h('div.emoji-grid');
  const renderGrid = (filter = '') => {
    grid.innerHTML = '';
    for (const [group, str] of Object.entries(EMOJIS)) {
      if (filter && !group.toLowerCase().includes(filter.toLowerCase())) continue;
      grid.append(h('div.emoji-group', { text: group }));
      for (const em of str.split(' ')) {
        grid.append(h('button.emoji-btn', { text: em, onclick: () => { closeMenu(); onPick(em); } }));
      }
    }
  };
  search.addEventListener('input', () => {
    const v = search.value.trim();
    // Direkt eingegebene Emojis übernehmen
    if (/\p{Extended_Pictographic}/u.test(v)) { closeMenu(); onPick([...v].slice(0, 2).join('')); return; }
    renderGrid(v);
  });
  const all = Object.values(EMOJIS).join(' ').split(' ');
  wrap.append(
    h('div.emoji-head', {}, search,
      h('button.btn.small', { title: 'Zufällig', onclick: () => { closeMenu(); onPick(all[Math.floor(Math.random() * all.length)]); } }, '🎲'),
      h('button.btn.small', { title: 'Entfernen', onclick: () => { closeMenu(); onPick(''); } }, icon('trash', 14))),
    grid);
  renderGrid();
  popover(wrap, anchor);
  setTimeout(() => search.focus(), 30);
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
