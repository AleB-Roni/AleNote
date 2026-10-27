// Import: Markdown-Dateien, ganze Obsidian-Vaults (Ordner) und Notion-Exporte (ZIP mit Markdown + CSV).
// Ordnerstruktur bleibt erhalten, Bilder werden übernommen, Obsidian-Links [[…]] als Text,
// Notion-IDs in Datei-/Ordnernamen werden entfernt.
import { readZip } from './zip.js';
import { mdToBlocks, mdInlineToHtml } from '../ai/markdown.js';

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const NOTE_EXT = /\.(md|markdown|txt)$/i;

/** Notion hängt 32-stellige IDs an: "Seite 1a2b…" → "Seite" */
const cleanName = (s) => s.replace(/\s+[0-9a-f]{32}(?=$|\.)/i, '').replace(/%20/g, ' ').trim();
const baseName = (p) => p.split('/').pop();
const dirName = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Dateien einsammeln → [{ path, bytes }]
 * input: FileList / Array<File> (bei Ordnerauswahl mit webkitRelativePath)
 */
export async function collectFiles(files) {
  const out = [];
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    if (/(^|\/)\.(obsidian|trash|git)\//.test(rel) || /(^|\/)\./.test(baseName(rel))) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(rel)) {
      for (const e of await readZip(bytes)) {
        // Notion legt manchmal ZIPs in ZIPs
        if (/\.zip$/i.test(e.name)) for (const inner of await readZip(e.bytes)) out.push({ path: inner.name, bytes: inner.bytes });
        else out.push({ path: e.name, bytes: e.bytes });
      }
    } else out.push({ path: rel, bytes });
  }
  return out.filter((f) => !f.path.startsWith('__MACOSX/'));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * Importiert die Dateien in den Ordner targetFolder.
 * app: für api, editor.newBlock; onProgress(done, total)
 * Rückgabe: { notes, images, skipped }
 */
export async function importFiles(app, files, targetFolder, onProgress) {
  const api = app.api;
  const editor = app.editor;
  const notes = files.filter((f) => NOTE_EXT.test(f.path) || /\.csv$/i.test(f.path));
  const images = new Map(); // Pfad/Name → Datei
  for (const f of files) if (IMG_EXT.test(f.path)) { images.set(f.path, f); images.set(baseName(f.path).toLowerCase(), f); }

  // Gemeinsamen Wurzelordner (z.B. "Export-123/") entfernen, wenn alles darin liegt
  const roots = new Set(notes.map((f) => f.path.split('/')[0]));
  const strip = roots.size === 1 && notes.every((f) => f.path.includes('/')) ? [...roots][0] + '/' : '';

  const saved = new Map(); // Bildpfad → alenote://asset/…
  const saveImage = async (f) => {
    if (saved.has(f.path)) return saved.get(f.path);
    const src = await api.saveAsset(baseName(f.path), f.bytes);
    saved.set(f.path, src);
    return src;
  };
  const findImage = (ref, notePath) => {
    let r = decodeURIComponent(ref.split('|')[0].split('#')[0].trim()).replace(/^\.\//, '');
    const dir = dirName(notePath);
    const joined = (dir ? dir + '/' : '') + r;
    const norm = joined.split('/').reduce((a, s) => (s === '..' ? a.slice(0, -1) : [...a, s]), []).join('/');
    return images.get(norm) || images.get(r) || images.get(baseName(r).toLowerCase());
  };

  const dec = new TextDecoder();
  const madeFolders = new Set();
  const ensure = async (folder) => { if (folder && !madeFolders.has(folder)) { await api.ensureFolder(folder); madeFolders.add(folder); } };
  let done = 0, imageCount = 0, skipped = 0;

  for (const f of notes) {
    const rel = f.path.startsWith(strip) ? f.path.slice(strip.length) : f.path;
    const folder = [targetFolder, ...dirName(rel).split('/').filter(Boolean).map(cleanName)].filter(Boolean).join('/');
    const name = cleanName(baseName(rel).replace(/\.(md|markdown|txt|csv)$/i, '')) || 'Import';
    let text = dec.decode(f.bytes).replace(/^﻿/, '');
    let blocks;
    try {
      if (/\.csv$/i.test(f.path)) {
        const rows = parseCsv(text);
        blocks = rows.length ? [editor.newBlock('table', { rows: rows.map((r) => r.map((c) => mdInlineToHtml(c))), header: true })] : [];
      } else {
        // YAML-Frontmatter entfernen, Titelzeile = Dateiname überspringen
        text = text.replace(/^---\n[\s\S]*?\n---\n/, '');
        const lines = text.split('\n');
        if (/^#\s+/.test(lines[0] || '') && cleanName(lines[0].replace(/^#\s+/, '')).toLowerCase() === name.toLowerCase()) lines.shift();
        // Bilder auf eigene Zeilen setzen und durch Platzhalter ersetzen
        const imgs = [];
        const md = lines.join('\n')
          .replace(/!\[\[([^\]]+)\]\]/g, (_, ref) => { imgs.push(ref); return `\n\n@@IMG${imgs.length - 1}@@\n\n`; })
          .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, ref) => { imgs.push(ref); return `\n\n@@IMG${imgs.length - 1}@@\n\n`; })
          // Obsidian-Links [[Ziel|Text]] → Text, Notion-Links auf .md → nur Text
          .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.split('#')[0])
          .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\.md\)/g, '$1');
        blocks = mdToBlocks(md, editor);
        const out = [];
        for (const b of blocks) {
          const m = b.type === 'paragraph' && (b.data.text || '').match(/^@@IMG(\d+)@@$/);
          if (!m) { out.push(b); continue; }
          const ref = imgs[Number(m[1])];
          if (/^https?:/.test(ref)) { out.push(editor.newBlock('image', { src: ref })); continue; }
          const img = findImage(ref, f.path);
          if (img) { out.push(editor.newBlock('image', { src: await saveImage(img) })); imageCount++; }
          else out.push(editor.newBlock('paragraph', { text: `<i>[Bild fehlt: ${ref.replace(/[<>&]/g, '')}]</i>` }));
        }
        blocks = out;
      }
      await ensure(folder);
      await api.createNote(folder, name, { version: 1, created: Date.now(), updated: Date.now(), icon: '', blocks: blocks.length ? blocks : [editor.newBlock('paragraph')], floats: [] });
    } catch (err) { console.error('Import', f.path, err); skipped++; }
    onProgress?.(++done, notes.length);
  }
  return { notes: done - skipped, images: imageCount, skipped };
}
