// Eigene Emojis: hochgeladene Bilder, nutzbar als Seiten-Icon, im Text und in Hinweisboxen.
//
// - Die Bilder liegen als Assets im Vault (_assets) und werden wie Bilder synchronisiert.
// - Die Liste (Name → Bild) steht in den synchronisierten Einstellungen (_config/settings.alenote).
// - Gespeichert wird nur der Name, z.B. „:katze:“ als Icon oder
//   <span class="cemoji" data-e="katze">:katze:</span> im Text. Das Bild selbst kommt über ein
//   Stylesheet dazu – so funktioniert es auf PC, Handy und im Browser gleich.
import { h } from './utils.js';
import { resolveSrc } from './api.js';
import { readSynced, writeSynced } from './synced.js';

export const CUSTOM_RE = /^:([\w-]{1,40}):$/;
const SYNCED_FILE = '_config/settings.alenote';

let store = null;
export const emojiStore = () => store;

export function initEmojis(app) {
  store = new EmojiStore(app);
  store.load();
  app.api.on?.('sync:changed', ({ paths }) => { if (paths?.includes(SYNCED_FILE)) store.load(); });
  return store;
}

class EmojiStore {
  constructor(app) {
    this.app = app;
    this.list = [];
    this.style = h('style#cemoji-style');
    document.head.append(this.style);
  }

  get(name) { return this.list.find((x) => x.name === name); }

  async load() {
    const s = await readSynced(this.app.api);
    this.list = Array.isArray(s.customEmojis) ? s.customEmojis.filter((x) => x && /^[\w-]{1,40}$/.test(x.name) && x.src) : [];
    this.renderStyle();
    this.app.events.emit('emojis:change', this.list);
  }

  renderStyle() {
    this.style.textContent = this.list.map((x) => `.cemoji[data-e="${x.name}"]{background-image:url("${String(resolveSrc(x.src)).replace(/"/g, '%22')}")}`).join('\n');
  }

  async save(list) {
    this.list = list;
    await writeSynced(this.app.api, { customEmojis: list });
    this.renderStyle();
    this.app.events.emit('emojis:change', list);
  }

  /** Bild hochladen (wird auf max. 128 px verkleinert; GIFs bleiben animiert) */
  async add(file, name) {
    name = cleanName(name || file.name.replace(/\.[^.]+$/, ''));
    if (!name) throw new Error('Bitte einen Namen angeben (Buchstaben, Zahlen, - und _)');
    let unique = name, i = 2;
    while (this.get(unique)) unique = `${name}${i++}`;
    let bytes, ext = '.png';
    if (file.type === 'image/gif' && file.size < 600e3) { bytes = await file.arrayBuffer(); ext = '.gif'; }
    else bytes = await shrink(file, 128);
    const src = await this.app.api.saveAsset('emoji-' + unique + ext, bytes);
    await this.save([...this.list, { name: unique, src, added: Date.now() }]);
    return unique;
  }

  async remove(name) { await this.save(this.list.filter((x) => x.name !== name)); }

  async rename(name, next) {
    next = cleanName(next);
    if (!next || this.get(next)) throw new Error('Name ungültig oder schon vergeben');
    await this.save(this.list.map((x) => (x.name === name ? { ...x, name: next } : x)));
  }
}

export const cleanName = (s) => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
  const c = Object.assign(document.createElement('canvas'), { width: w, height: hgt });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, hgt);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return blob.arrayBuffer();
}

/** HTML für ein eigenes Emoji im Text */
export const customEmojiHtml = (name) => `<span class="cemoji" data-e="${name}" contenteditable="false">:${name}:</span>`;

/** Element für ein Icon – normales Emoji als Text, eigenes Emoji als Bild */
export function emojiNode(value, cls = '') {
  const m = CUSTOM_RE.exec(value || '');
  if (m) return h('span.cemoji' + (cls ? '.' + cls : ''), { dataset: { e: m[1] }, title: value, text: value });
  return h('span' + (cls ? '.' + cls : ''), { text: value || '' });
}

/** Für reine Textstellen (Benachrichtigungen, Auswahllisten): eigenes Emoji → Ersatzzeichen */
export const plainIcon = (value, fallback = '🖼️') => (CUSTOM_RE.test(value || '') ? fallback : value || '');
