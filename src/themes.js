// Eingebaute Farbschemata. Eigene Themes per Plugin: app.registerTheme({...})

const darkTones = {
  '--c-gray': '#9b9ba6', '--c-brown': '#c19a7a', '--c-orange': '#f0a05a', '--c-yellow': '#e8c95a', '--c-green': '#5fcf8f',
  '--c-blue': '#62a8f5', '--c-purple': '#b28bf5', '--c-pink': '#f07bbd', '--c-red': '#f27373',
  '--bg-gray': 'rgba(155,155,166,.18)', '--bg-brown': 'rgba(193,154,122,.18)', '--bg-orange': 'rgba(240,160,90,.18)', '--bg-yellow': 'rgba(232,201,90,.18)',
  '--bg-green': 'rgba(95,207,143,.16)', '--bg-blue': 'rgba(98,168,245,.17)', '--bg-purple': 'rgba(178,139,245,.18)', '--bg-pink': 'rgba(240,123,189,.17)', '--bg-red': 'rgba(242,115,115,.17)'
};
const lightTones = {
  '--c-gray': '#787774', '--c-brown': '#9f6b53', '--c-orange': '#d9730d', '--c-yellow': '#b8860b', '--c-green': '#2f9e5f',
  '--c-blue': '#2f7fd3', '--c-purple': '#8b5cf6', '--c-pink': '#c4458f', '--c-red': '#d44c47',
  '--bg-gray': '#efefed', '--bg-brown': '#f4eeee', '--bg-orange': '#fbecdd', '--bg-yellow': '#fbf3db',
  '--bg-green': '#e3f4ea', '--bg-blue': '#e1eefb', '--bg-purple': '#efe8fd', '--bg-pink': '#fae5f0', '--bg-red': '#fde8e7'
};

export function registerBuiltinThemes(registry) {
  registry.registerTheme({ id: 'dark', name: 'Dunkel', dark: true, vars: {
    '--bg': '#17171c', '--bg-2': '#1d1d24', '--bg-3': '#26262f', '--bg-hover': 'rgba(255,255,255,.055)', '--panel': 'rgba(34,34,43,.92)',
    '--border': 'rgba(255,255,255,.08)', '--text': '#e8e8ef', '--text-2': '#a3a3b2', '--text-3': '#6c6c7c', '--shadow': '0 12px 40px rgba(0,0,0,.45)', ...darkTones } });
  registry.registerTheme({ id: 'midnight', name: 'Mitternacht', dark: true, accent: '#5b8cff', vars: {
    '--bg': '#0d1220', '--bg-2': '#111829', '--bg-3': '#1a2338', '--bg-hover': 'rgba(120,150,255,.07)', '--panel': 'rgba(22,30,50,.93)',
    '--border': 'rgba(140,170,255,.10)', '--text': '#e3e9ff', '--text-2': '#97a3c4', '--text-3': '#5d6886', '--shadow': '0 12px 40px rgba(0,0,10,.55)', ...darkTones } });
  registry.registerTheme({ id: 'oled', name: 'OLED Schwarz', dark: true, vars: {
    '--bg': '#000000', '--bg-2': '#0a0a0c', '--bg-3': '#16161a', '--bg-hover': 'rgba(255,255,255,.06)', '--panel': 'rgba(18,18,22,.95)',
    '--border': 'rgba(255,255,255,.09)', '--text': '#f2f2f5', '--text-2': '#a0a0aa', '--text-3': '#62626c', '--shadow': '0 12px 40px rgba(0,0,0,.7)', ...darkTones } });
  registry.registerTheme({ id: 'forest', name: 'Wald', dark: true, accent: '#34d399', vars: {
    '--bg': '#111815', '--bg-2': '#151e1a', '--bg-3': '#1e2a24', '--bg-hover': 'rgba(140,255,200,.06)', '--panel': 'rgba(26,36,31,.93)',
    '--border': 'rgba(160,255,210,.09)', '--text': '#e2efe8', '--text-2': '#9db5a8', '--text-3': '#62786c', '--shadow': '0 12px 40px rgba(0,0,0,.5)', ...darkTones } });
  registry.registerTheme({ id: 'light', name: 'Hell', dark: false, vars: {
    '--bg': '#ffffff', '--bg-2': '#f7f7f5', '--bg-3': '#ececea', '--bg-hover': 'rgba(0,0,0,.045)', '--panel': 'rgba(255,255,255,.94)',
    '--border': 'rgba(0,0,0,.08)', '--text': '#2b2b30', '--text-2': '#6e6e78', '--text-3': '#a5a5ae', '--shadow': '0 12px 40px rgba(20,20,40,.14)', ...lightTones } });
  registry.registerTheme({ id: 'paper', name: 'Papier', dark: false, accent: '#d9730d', vars: {
    '--bg': '#fbf8f1', '--bg-2': '#f3eee2', '--bg-3': '#e9e2d2', '--bg-hover': 'rgba(90,60,20,.06)', '--panel': 'rgba(253,250,243,.95)',
    '--border': 'rgba(90,60,20,.10)', '--text': '#3a3226', '--text-2': '#7a6d5a', '--text-3': '#ad9f89', '--shadow': '0 12px 40px rgba(80,50,10,.14)', ...lightTones } });
  registry.registerTheme({ id: 'rose', name: 'Rosé', dark: false, accent: '#e0567f', vars: {
    '--bg': '#fffafb', '--bg-2': '#fbf0f3', '--bg-3': '#f4e1e7', '--bg-hover': 'rgba(180,40,90,.05)', '--panel': 'rgba(255,250,251,.95)',
    '--border': 'rgba(180,40,90,.10)', '--text': '#3d2a31', '--text-2': '#8a6b76', '--text-3': '#bba1aa', '--shadow': '0 12px 40px rgba(120,20,60,.13)', ...lightTones } });
}

/** Farbton verschieben (für den zweiten Akzent-Farbverlauf) */
export function shiftHue(hex, deg) {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return hex;
  let [r, g, b] = m.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  hh = (hh + deg) % 360;
  return `hsl(${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
