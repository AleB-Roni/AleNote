// Bild-, Code-, Trenner- und Inhaltsverzeichnis-Blöcke
import { h, clamp, stripHtml } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast, prompt, contextMenu } from '../ui/overlays.js';

const LANGS = ['Text', 'JavaScript', 'TypeScript', 'Python', 'C#', 'C++', 'Java', 'HTML', 'CSS', 'JSON', 'SQL', 'Bash', 'PowerShell', 'Rust', 'Go', 'PHP', 'Markdown', 'YAML'];

export default function registerMediaBlocks(registry) {
  // ---------- Bild ----------
  registry.registerBlock({
    type: 'image', name: 'Bild', icon: 'image', description: 'Bild hochladen, einfügen oder verlinken', keywords: ['bild', 'image', 'foto', 'img', 'picture'],
    group: 'Medien', create: () => ({ src: '', width: 100, align: 'center', caption: '' }),
    render(b, ctx) {
      const wrap = h('div.image-block', { dataset: { align: b.data.align || 'center' } });
      if (!b.data.src) {
        const ph = h('div.image-placeholder', {},
          icon('image', 28),
          h('div.ph-title', { text: 'Bild hinzufügen' }),
          h('div.ph-sub', { text: 'Hierher ziehen, mit Strg+V einfügen oder:' }),
          h('div.ph-actions', {},
            h('button.btn.btn-primary.small', { onclick: async () => { const [src] = await ctx.app.api.pickImages(); if (src) ctx.update({ src }, { rerender: true }); } }, icon('upload', 14), 'Hochladen'),
            h('button.btn.small', { onclick: async () => { const src = await prompt('Bild-URL', { placeholder: 'https://…/bild.png' }); if (src) ctx.update({ src }, { rerender: true }); } }, icon('link', 14), 'Link')));
        ph.addEventListener('dragover', (e) => { e.preventDefault(); ph.classList.add('over'); });
        ph.addEventListener('dragleave', () => ph.classList.remove('over'));
        ph.addEventListener('drop', async (e) => {
          e.preventDefault();
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
          if (f) ctx.update({ src: await ctx.app.saveImageFile(f) }, { rerender: true });
        });
        wrap.append(ph);
        return wrap;
      }
      const img = h('img', { src: b.data.src, draggable: false, alt: stripHtml(b.data.caption) });
      img.addEventListener('error', () => figure.classList.add('broken'));
      const figure = h('div.image-frame', { style: { width: (b.data.width || 100) + '%' } }, img,
        h('div.img-resize.left'), h('div.img-resize.right'));
      const tools = h('div.image-tools', {},
        tool('alignLeft', 'Links', () => ctx.update({ align: 'left' }, { rerender: true })),
        tool('alignCenter', 'Zentriert', () => ctx.update({ align: 'center' }, { rerender: true })),
        tool('alignRight', 'Rechts', () => ctx.update({ align: 'right' }, { rerender: true })),
        h('div.tb-sep'),
        tool('move', 'Frei bewegen (aus dem Text lösen)', () => {
          const pr = ctx.editor.page.getBoundingClientRect();
          const fr = figure.getBoundingClientRect();
          ctx.remove();
          ctx.editor.floats.add(b.data.src, fr.left - pr.left, fr.top - pr.top, Math.round(fr.width));
          toast('Bild ist jetzt frei beweglich – ziehen, drehen, skalieren!', { type: 'success' });
        }),
        tool('refresh', 'Ersetzen', async () => { const [src] = await ctx.app.api.pickImages(); if (src) ctx.update({ src }, { rerender: true }); }),
        tool('trash', 'Löschen', () => ctx.editor.removeBlock(b.id, { animate: true })));
      figure.append(tools);

      // Breite per Ziehen ändern
      figure.querySelectorAll('.img-resize').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = figure.getBoundingClientRect().width;
          const total = wrap.getBoundingClientRect().width;
          const dir = handle.classList.contains('left') ? -1 : 1;
          const factor = (b.data.align || 'center') === 'center' ? 2 : 1;
          figure.classList.add('resizing');
          const move = (ev) => {
            const w = clamp(((startW + (ev.clientX - startX) * dir * factor) / total) * 100, 10, 100);
            figure.style.width = w + '%';
            b.data.width = Math.round(w);
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            figure.classList.remove('resizing');
            ctx.update({}, { commit: true });
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      });

      const caption = h('div.image-caption.editable', { contenteditable: 'true', 'data-field': 'caption', 'data-placeholder': 'Bildunterschrift…' });
      caption.innerHTML = b.data.caption || '';
      wrap.append(figure, caption);
      img.addEventListener('dblclick', () => ctx.app.lightbox(b.data.src));
      return wrap;
    },
    toMarkdown: (b) => `![${stripHtml(b.data.caption)}](${b.data.src})`
  });

  // ---------- Code ----------
  registry.registerBlock({
    type: 'code', name: 'Code', icon: 'code', description: 'Codeblock mit Sprache', keywords: ['code', 'programm', 'snippet', '```'],
    group: 'Medien', text: true, markdown: /^```/, create: () => ({ code: '', lang: 'Text' }),
    render(b, ctx) {
      const pre = h('pre.code-editor', { contenteditable: 'plaintext-only', spellcheck: 'false', 'data-field': 'code', 'data-plain': '1', 'data-editable': 'main', 'data-placeholder': '// Code hier…' });
      pre.textContent = b.data.code || '';
      const langBtn = h('button.code-lang', { text: b.data.lang || 'Text' });
      langBtn.addEventListener('click', () => contextMenu(LANGS.map((l) => ({ label: l, active: l === b.data.lang, run: () => { ctx.update({ lang: l }); langBtn.textContent = l; } })), langBtn));
      const copy = h('button.code-copy', {}, icon('copy', 13), 'Kopieren');
      copy.addEventListener('click', async () => { await navigator.clipboard.writeText(b.data.code || ''); toast('Code kopiert', { type: 'success' }); });
      return h('div.code-block', {}, h('div.code-head', {}, langBtn, copy), pre);
    },
    onKeyDown(e, ctx, el) {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); return true; }
      if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) { e.preventDefault(); ctx.insertAfter('paragraph'); return true; }
      if (e.key === 'Enter') return true; // normaler Zeilenumbruch
      if (e.key === 'Backspace') {
        if (!el.textContent) { e.preventDefault(); ctx.editor.convertBlock(ctx.block.id, 'paragraph'); }
        return true;
      }
      if (e.key === 'Escape') { e.preventDefault(); ctx.editor.selectBlock(ctx.block.id); return true; }
      return e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Delete';
    },
    toMarkdown: (b) => '```' + (b.data.lang && b.data.lang !== 'Text' ? b.data.lang.toLowerCase() : '') + '\n' + (b.data.code || '') + '\n```'
  });

  // ---------- Trennlinie ----------
  registry.registerBlock({
    type: 'divider', name: 'Trennlinie', icon: 'minus', description: 'Horizontale Linie', keywords: ['linie', 'divider', 'hr', 'trenner', '---'],
    group: 'Medien', markdown: /^---$/,
    render: () => h('div.divider', {}, h('hr')),
    toMarkdown: () => '---'
  });

  // ---------- Inhaltsverzeichnis ----------
  registry.registerBlock({
    type: 'toc', name: 'Inhaltsverzeichnis', icon: 'list', description: 'Automatische Übersicht aller Überschriften', keywords: ['toc', 'inhalt', 'verzeichnis', 'übersicht'],
    group: 'Medien',
    render(b, ctx) {
      const box = h('div.toc');
      const draw = () => {
        if (!box.isConnected && box.dataset.drawn) { off(); return; }
        box.dataset.drawn = '1';
        box.innerHTML = '';
        const heads = ctx.editor.note.blocks.filter((x) => /^h[123]$/.test(x.type) && stripHtml(x.data.text).trim());
        if (!heads.length) { box.append(h('div.toc-empty', { text: 'Füge Überschriften hinzu, um ein Inhaltsverzeichnis zu erhalten.' })); return; }
        for (const hd of heads) {
          box.append(h('button.toc-item', {
            text: stripHtml(hd.data.text), style: { paddingLeft: (Number(hd.type[1]) - 1) * 18 + 10 + 'px' },
            onclick: () => { const el = ctx.editor.rowEl(hd.id); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 900); }
          }));
        }
      };
      const off = ctx.app.events.on('note:change', () => requestAnimationFrame(draw));
      requestAnimationFrame(draw);
      return box;
    },
    toMarkdown: () => '[TOC]'
  });
}

function tool(ic, title, run) {
  const b = h('button.tb-btn', { title }, icon(ic, 14));
  b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  return b;
}
