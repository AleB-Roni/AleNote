// Export (PDF, Word) und Import (Markdown, Obsidian, Notion) – Oberfläche
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { modal, toast } from './overlays.js';
import { resolveSrc } from '../core/api.js';
import { noteToDocx } from '../core/docx.js';
import { collectFiles, importFiles } from '../core/importer.js';

const safeName = (s) => (s || 'Notiz').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Notiz';

export async function exportPdf(app) {
  if (!app.editor.note) { toast('Öffne zuerst eine Notiz'); return; }
  await app.saveNow();
  if (app.drawMode) app.toggleDrawMode(false);
  document.body.classList.add('printing');
  try {
    const file = await app.api.printNote(safeName(app.editor.title) + '.pdf');
    if (file) toast('PDF gespeichert: ' + file, { type: 'success', duration: 4000 });
  } catch (err) { toast('PDF-Export fehlgeschlagen: ' + err.message, { type: 'error' }); }
  finally { setTimeout(() => document.body.classList.remove('printing'), 500); }
}

export async function exportDocx(app) {
  const editor = app.editor;
  if (!editor.note) { toast('Öffne zuerst eine Notiz'); return; }
  await app.saveNow();
  toast('Word-Datei wird erstellt …', { duration: 1500 });
  try {
    const bytes = await noteToDocx({ note: editor.note, title: editor.title, editor, resolveSrc });
    const file = await app.api.saveFile(safeName(editor.title) + '.docx', bytes, [{ name: 'Word-Dokument', extensions: ['docx'] }], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (file) toast('Word-Datei gespeichert: ' + file, { type: 'success', duration: 4000 });
  } catch (err) { console.error(err); toast('Word-Export fehlgeschlagen: ' + err.message, { type: 'error' }); }
}

/** Import-Dialog */
export function openImport(app, folder = '') {
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.md,.markdown,.txt,.csv,.zip,image/*', style: { display: 'none' } });
  const dirIn = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
  dirIn.webkitdirectory = true;
  const status = h('div.import-status.muted.small');
  const bar = h('div.import-bar', {}, h('div.import-fill'));
  const date = new Date().toLocaleDateString('de-DE');
  const targetIn = h('input.input', { value: folder || `Import ${date}`, placeholder: 'Zielordner (leer = Hauptebene)' });

  const run = async (list) => {
    if (!list?.length) return;
    m.box.classList.add('busy');
    status.textContent = 'Lese Dateien …';
    try {
      const files = await collectFiles(list);
      const count = files.filter((f) => /\.(md|markdown|txt|csv)$/i.test(f.path)).length;
      if (!count) { status.textContent = 'Keine Markdown- oder CSV-Dateien gefunden.'; m.box.classList.remove('busy'); return; }
      const target = targetIn.value.trim().replace(/^\/+|\/+$/g, '');
      const r = await importFiles(app, files, target, (done, total) => {
        status.textContent = `Importiere ${done} von ${total} …`;
        bar.firstChild.style.width = Math.round((done / total) * 100) + '%';
      });
      await app.sidebar.refresh();
      if (target) { app.sidebar.expanded.add(target); app.sidebar.saveExpanded(); app.sidebar.renderTree(); }
      m.close();
      toast(`${r.notes} ${r.notes === 1 ? 'Notiz' : 'Notizen'}${r.images ? ` und ${r.images} Bilder` : ''} importiert${r.skipped ? ` (${r.skipped} übersprungen)` : ''}`, { type: 'success', duration: 5000 });
    } catch (err) {
      console.error(err);
      status.textContent = 'Import fehlgeschlagen: ' + err.message;
      m.box.classList.remove('busy');
    }
  };
  fileIn.addEventListener('change', () => run([...fileIn.files]));
  dirIn.addEventListener('change', () => run([...dirIn.files]));

  const card = (ic, title, desc, onclick) => h('button.import-card', { onclick }, h('span.import-icon', { text: ic }), h('div', {}, h('b', { text: title }), h('div.muted.small', { text: desc })));
  const content = h('div.import', {},
    h('label.ai-field', {}, h('span', { text: 'In Ordner importieren' }), targetIn),
    h('div.import-grid', {},
      card('📄', 'Markdown-Dateien', '.md, .txt und .csv (wird zur Tabelle) – mehrere auf einmal', () => fileIn.click()),
      card('🟣', 'Obsidian-Vault', 'Ganzen Ordner wählen – Unterordner, Bilder und [[Links]] werden übernommen', () => dirIn.click()),
      card('⬛', 'Notion-Export', 'In Notion: Einstellungen → Exportieren → „Markdown & CSV“, dann die ZIP-Datei wählen', () => fileIn.click())),
    bar, status, fileIn, dirIn,
    h('p.muted.small', { text: 'OneNote hat kein offenes Exportformat: Seite in OneNote markieren, kopieren (Strg+C) und in eine neue Notiz einfügen – Text und Formatierung werden übernommen.' }));
  const m = modal({ title: 'Importieren', content, width: 'min(640px, 94vw)', className: 'import-modal' });
}
