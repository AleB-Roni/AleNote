// Word-Export (.docx) ohne Bibliothek: Überschriften, Listen, To-dos, Zitate, Hinweisboxen,
// Code, Tabellen (mit berechneten Formeln), Bilder, Trennlinien und Textformatierung.
import { createZip } from './zip.js';
import { stripHtml } from './utils.js';
import { computeTable, formatValue } from '../blocks/table-formula.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const TONES = { blue: 'E1EEFB', yellow: 'FBF3DB', green: 'E3F4EA', red: 'FDE8E7', purple: 'EFE8FD', gray: 'EFEFED', orange: 'FBECDD', pink: 'FAE5F0', brown: 'F4EEEE' };

/** Inline-HTML (b, i, u, s, code, a, br, mark) → Word-Textläufe */
function runs(html, base = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const out = [];
  const walk = (node, f) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const text = n.textContent.replace(/​/g, '');
        if (text) out.push(run(text, f));
      } else if (n.nodeType === 1) {
        const t = n.tagName;
        if (t === 'BR') { out.push('<w:r><w:br/></w:r>'); continue; }
        const g = { ...f };
        if (t === 'B' || t === 'STRONG') g.b = true;
        if (t === 'I' || t === 'EM') g.i = true;
        if (t === 'U') g.u = true;
        if (t === 'S' || t === 'STRIKE' || t === 'DEL') g.s = true;
        if (t === 'CODE') g.code = true;
        if (t === 'MARK') g.mark = true;
        if (t === 'A') g.link = true;
        if (n.classList?.contains('qn-time')) g.gray = true;
        walk(n, g);
      }
    }
  };
  walk(tpl.content, base);
  return out.join('');
}

function run(text, f = {}) {
  const pr = [
    f.b ? '<w:b/>' : '', f.i ? '<w:i/>' : '', f.u || f.link ? '<w:u w:val="single"/>' : '', f.s ? '<w:strike/>' : '',
    f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F0F0F2"/>' : '',
    f.link ? '<w:color w:val="2F7FD3"/>' : f.gray ? '<w:color w:val="8A8A95"/>' : f.color ? `<w:color w:val="${f.color}"/>` : '',
    f.mark ? '<w:highlight w:val="yellow"/>' : '', f.size ? `<w:sz w:val="${f.size}"/>` : ''
  ].join('');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

const para = (content, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

/** Bild laden → { bytes, ext, w, h } */
async function loadImage(src, resolveSrc) {
  try {
    const url = resolveSrc(src);
    const res = await fetch(url);
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = blob.type || '';
    let ext = /png/.test(type) ? 'png' : /jpe?g/.test(type) ? 'jpeg' : /gif/.test(type) ? 'gif' : /webp/.test(type) ? 'webp' : '';
    if (!ext) ext = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpeg' : bytes[0] === 0x47 ? 'gif' : 'png';
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = URL.createObjectURL(blob); });
    // WebP kann Word nicht → als PNG neu zeichnen
    if (ext === 'webp') {
      const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
      c.getContext('2d').drawImage(img, 0, 0);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      return { bytes: new Uint8Array(await png.arrayBuffer()), ext: 'png', w: img.naturalWidth, h: img.naturalHeight };
    }
    return { bytes, ext, w: img.naturalWidth || 400, h: img.naturalHeight || 300 };
  } catch { return null; }
}

/**
 * Notiz → .docx (Uint8Array)
 * note: { blocks }, title, editor (für Blocktyp-Definitionen), resolveSrc
 */
export async function noteToDocx({ note, title, editor, resolveSrc = (s) => s }) {
  const media = [];
  const body = [];
  const numbered = { counter: 0 };
  let prevType = '';

  body.push(para(run(title), '<w:pStyle w:val="Title"/>'));

  for (const b of note.blocks || []) {
    const d = b.data || {};
    const ind = b.indent || 0;
    if (b.type === 'numbered' && prevType !== 'numbered') numbered.counter++; // neue Liste → neu nummerieren
    switch (b.type) {
      case 'paragraph': body.push(para(runs(d.text))); break;
      case 'h1': case 'h2': case 'h3': body.push(para(runs(d.text), `<w:pStyle w:val="Heading${b.type[1]}"/>`)); break;
      case 'bullet': body.push(para(runs(d.text), `<w:numPr><w:ilvl w:val="${ind}"/><w:numId w:val="1"/></w:numPr>`)); break;
      case 'numbered': body.push(para(runs(d.text), `<w:numPr><w:ilvl w:val="${ind}"/><w:numId w:val="${100 + numbered.counter}"/></w:numPr>`)); break;
      case 'todo': {
        const due = d.due ? run(`  📅 ${new Date(d.due).toLocaleDateString('de-DE')}${d.dueTime ? ' ' + d.dueTime : ''}`, { gray: true }) : '';
        body.push(para(run(d.checked ? '☑ ' : '☐ ') + runs(d.text, d.checked ? { s: true, gray: true } : {}) + due, `<w:ind w:left="${360 * ind}"/>`));
        break;
      }
      case 'quote': body.push(para(runs(d.text, { i: true }), '<w:pStyle w:val="Quote"/>')); break;
      case 'callout': {
        const fill = TONES[d.tone] || TONES.blue;
        body.push(para(run((d.icon || '💡') + '  ') + runs(d.text), `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:spacing w:before="120" w:after="120"/><w:ind w:left="120" w:right="120"/>`));
        break;
      }
      case 'toggle':
        body.push(para(run('▸ ') + runs(d.text, { b: true })));
        if (stripHtml(d.body || '').trim()) body.push(para(runs(d.body), '<w:ind w:left="360"/>'));
        break;
      case 'code':
        for (const line of String(d.code || '').split('\n')) body.push(para(run(line || ' ', { code: true }), '<w:pStyle w:val="Code"/>'));
        break;
      case 'divider': body.push(para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBC4"/></w:pBdr>')); break;
      case 'table': {
        const rows = d.rows || [];
        const computed = computeTable(rows);
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const grid = `<w:tblGrid>${`<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`.repeat(cols)}</w:tblGrid>`;
        const trs = rows.map((r, ri) => {
          const header = d.header && ri === 0;
          const cells = Array.from({ length: cols }, (_, ci) => {
            const v = computed[ri]?.[ci];
            const content = v != null ? run(formatValue(v), header ? { b: true } : {}) : runs(r[ci] || '', header ? { b: true } : {});
            return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / cols)}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F5"/>' : ''}</w:tcPr>${para(content)}</w:tc>`;
          }).join('');
          return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
        }).join('');
        body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="CFCFD6"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${trs}</w:tbl>`);
        body.push(para(''));
        break;
      }
      case 'image': {
        if (!d.src) break;
        const img = await loadImage(d.src, resolveSrc);
        if (!img) { body.push(para(run('[Bild]', { gray: true }))); break; }
        const n = media.length + 1;
        media.push({ name: `image${n}.${img.ext}`, bytes: img.bytes, ext: img.ext });
        // Breite: Anteil der Seitenbreite (ca. 16 cm)
        const maxW = 6.3 * 914400 * Math.min(1, (d.width || 100) / 100);
        const cx = Math.round(Math.min(maxW, img.w * 9525));
        const cy = Math.round(cx * (img.h / img.w));
        const jc = d.align === 'left' ? 'left' : d.align === 'right' ? 'right' : 'center';
        body.push(para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Bild ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${img.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, `<w:jc w:val="${jc}"/>`));
        if (d.caption) body.push(para(runs(d.caption, { i: true, gray: true }), '<w:jc w:val="center"/>'));
        break;
      }
      case 'progress': body.push(para(run(`${d.label || 'Fortschritt'}: ${d.value ?? 0} %`))); break;
      case 'toc': break;
      default: {
        // Unbekannte Blöcke (z.B. aus Plugins): als Text über Markdown
        const def = editor?.def?.(b.type);
        let text = '';
        try { text = def?.toMarkdown ? def.toMarkdown(b) : stripHtml(d.text || ''); } catch {}
        if (text) for (const line of text.split('\n')) body.push(para(run(line)));
      }
    }
    prevType = b.type;
  }

  const numIds = Array.from({ length: numbered.counter }, (_, i) => `<w:num w:numId="${101 + i}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('');
  const lvls = (fmt) => Array.from({ length: 7 }, (_, i) => {
    const text = fmt === 'bullet' ? ['•', '◦', '▪'][i % 3] : `%${i + 1}.`;
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt === 'bullet' ? 'bullet' : ['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1) + 360}" w:hanging="360"/></w:pPr></w:lvl>`;
  }).join('');

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>AleNote</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>` },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${360 - n * 60}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[36, 30, 26][n - 1]}"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="7C5CFF"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="555560"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>` },
    { name: 'word/numbering.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>${numIds}</w:numbering>` },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>` },
    ...media.map((m) => ({ name: 'word/media/' + m.name, data: m.bytes }))
  ];
  return createZip(files);
}
