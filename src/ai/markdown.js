// Umwandlung zwischen AleNote-Blöcken und Markdown (für die KI)
import { escapeHtml, stripHtml } from '../core/utils.js';

/** Blöcke → Markdown (nutzt toMarkdown der Blocktypen) */
export function blocksToMarkdown(editor, blocks) {
  return blocks.map((b) => {
    const def = editor.def(b.type);
    try { return def?.toMarkdown ? def.toMarkdown(b, editor.app) : stripHtml(b.data.text || ''); }
    catch { return stripHtml(b.data.text || ''); }
  }).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Inline-Markdown → HTML für AleNote-Textfelder */
export function mdInlineToHtml(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

/** Markdown → Liste neuer Blöcke (über editor.newBlock) */
export function mdToBlocks(md, editor) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  const add = (type, data = {}, extra = {}) => { const b = editor.newBlock(type, data); Object.assign(b, extra); out.push(b); };
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { add('paragraph', { text: mdInlineToHtml(para.join(' ')) }); para = []; } };

  while (i < lines.length) {
    const line = lines[i];
    const indent = Math.min(6, Math.floor((line.match(/^\s*/)[0].replace(/\t/g, '  ').length) / 2));
    const t = line.trim();

    if (!t) { flush(); i++; continue; }

    // Codeblock
    const fence = t.match(/^```(\w*)/);
    if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      const lang = fence[1] ? fence[1][0].toUpperCase() + fence[1].slice(1) : 'Text';
      add('code', { code: code.join('\n'), lang: lang === 'Js' ? 'JavaScript' : lang });
      continue;
    }

    // Tabelle
    if (t.startsWith('|') && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => mdInlineToHtml(c.trim().replace(/\\\|/g, '|')));
      const rows = [cells(t)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      const cols = Math.max(...rows.map((r) => r.length));
      rows.forEach((r) => { while (r.length < cols) r.push(''); });
      add('table', { rows, header: true });
      continue;
    }

    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { flush(); add('h' + Math.min(3, m[1].length), { text: mdInlineToHtml(m[2]) }); }
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); add('divider'); }
    else if ((m = t.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      flush();
      const d = m[2].match(/\s*📅\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*$/);
      const text = d ? m[2].slice(0, d.index) : m[2];
      add('todo', { text: mdInlineToHtml(text), checked: m[1] !== ' ', ...(d ? { due: d[1], ...(d[2] ? { dueTime: d[2].padStart(5, '0') } : {}) } : {}) }, indent ? { indent } : {});
    }
    else if ((m = t.match(/^[-*+•]\s+(.*)$/))) { flush(); add('bullet', { text: mdInlineToHtml(m[1]) }, indent ? { indent } : {}); }
    else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { flush(); add('numbered', { text: mdInlineToHtml(m[1]) }, indent ? { indent } : {}); }
    else if ((m = t.match(/^>\s?(.*)$/))) {
      flush();
      const q = [m[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) q.push(lines[++i].trim().replace(/^>\s?/, ''));
      const first = q[0].match(/^(\p{Extended_Pictographic})\s*(.*)$/u);
      if (first) add('callout', { icon: first[1], text: mdInlineToHtml([first[2], ...q.slice(1)].join(' ')), tone: 'blue' });
      else add('quote', { text: mdInlineToHtml(q.join(' ')) });
    }
    else para.push(t);
    i++;
  }
  flush();
  return out;
}

/** Entfernt typische Einleitungen/Code-Zäune, die Modelle manchmal um das Ergebnis legen */
export function cleanResult(text) {
  let s = String(text || '').trim();
  const fenced = s.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) s = fenced[1].trim();
  return s;
}
