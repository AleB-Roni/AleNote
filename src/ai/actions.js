// KI-Aktionen: Die KI kann im Chat Befehle von AleNote ausführen – z.B. eine To-do-Liste oder
// Tabelle in die Notiz schreiben, Unterseiten anlegen, Aufgaben mit Datum/Erinnerung eintragen
// oder Befehle aus der Befehlspalette starten.
//
// Die KI hängt dafür an ihre Antwort einen Block an:
//   ```alenote
//   {"actions": [ { "type": "insert", "markdown": "- [ ] Milch" } ]}
//   ```
// Er wird nicht angezeigt, sondern ausgeführt; im Chat erscheint eine kurze Übersicht.
import { mdToBlocks, mdInlineToHtml } from './markdown.js';
import { addQuickNote, todayKey } from '../core/todos.js';
import { childFolder } from '../core/pages.js';

const FENCE = /```alenote\s*\n?([\s\S]*?)```/g;

/** Aktionsblöcke aus dem sichtbaren Text entfernen (auch einen noch unvollständigen beim Streamen) */
export function stripActions(text) {
  return String(text || '').replace(FENCE, '').replace(/```alenote[\s\S]*$/, '').trim();
}

export function parseActions(text) {
  const out = [];
  for (const m of String(text || '').matchAll(FENCE)) {
    try {
      const data = JSON.parse(m[1].trim());
      const list = Array.isArray(data) ? data : Array.isArray(data.actions) ? data.actions : [data];
      out.push(...list.filter((a) => a && typeof a.type === 'string'));
    } catch (err) { out.push({ type: 'invalid', error: 'Aktion nicht lesbar: ' + err.message }); }
  }
  return out;
}

// Befehle, die die KI nicht selbst auslösen soll (zerstörerisch oder nur mit Rückfrage sinnvoll)
const BLOCKED = /delete|löschen|trash|logout|abmelden|vault|plugin|reload|quit|beenden|reset/i;

export function commandList(app) {
  return [...app.registry.commands.values()]
    .filter((c) => !BLOCKED.test(c.id) && !BLOCKED.test(c.name || ''))
    .map((c) => `${c.id} – ${c.name}`);
}

/** Anleitung für die KI (wird an den System-Prompt angehängt) */
export function actionsPrompt(app) {
  const notes = app.sidebar.allNotes().slice(0, 150).map((n) => n.path.replace(/\.alenote$/, ''));
  return `
Du kannst AleNote direkt bedienen. Wenn der Nutzer etwas erstellt, eingetragen oder ausgeführt haben möchte
(z.B. „mach mir eine To-do-Liste“, „erstelle eine Tabelle“, „leg eine Unterseite an“, „erinnere mich morgen um 9“),
dann führe es aus, indem du am ENDE deiner Antwort GENAU EINEN Block anhängst:
\`\`\`alenote
{"actions": [ ... ]}
\`\`\`
Schreibe davor kurz in einem Satz, was du gemacht hast. Wiederhole den eingefügten Inhalt NICHT zusätzlich als Text.
Wenn der Nutzer nur eine Frage stellt oder Text sehen möchte, antworte normal OHNE Aktionsblock.

Verfügbare Aktionen (Markdown kann Überschriften, Listen, "- [ ] Aufgaben", Tabellen mit | und > Zitate enthalten):
- {"type":"insert","markdown":"…","position":"cursor|end|start"}  → Blöcke in die geöffnete Notiz einfügen
- {"type":"todos","items":[{"text":"…","due":"YYYY-MM-DD","time":"HH:MM","remind":[60]}],"where":"note|quicknote"}
    → Aufgaben anlegen; due/time/remind sind optional, remind = Minuten vor Fälligkeit (0, 15, 60, 180, 1440 …)
- {"type":"table","headers":["…"],"rows":[["…"]],"position":"cursor|end"}  → Tabelle einfügen
- {"type":"page","title":"…","markdown":"…","parent":"current|root|<Pfad>","icon":"📄","open":true}
    → neue Seite anlegen (parent "current" = Unterseite der geöffneten Seite)
- {"type":"replace","markdown":"…"}  → komplette geöffnete Notiz ersetzen (nur wenn ausdrücklich gewünscht)
- {"type":"rename","title":"…"} · {"type":"icon","emoji":"🚀"}  → geöffnete Notiz umbenennen / Icon setzen
- {"type":"open","path":"…"}  → Notiz öffnen
- {"type":"quicknote","text":"…","due":"YYYY-MM-DD"}  → Schnellnotiz mit Zeitstempel
- {"type":"command","id":"…"}  → Befehl ausführen. Erlaubte Befehle:
${commandList(app).map((c) => '    ' + c).join('\n')}

Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' })} (${todayKey()}).
Geöffnete Notiz: ${app.currentPath ? app.currentPath.replace(/\.alenote$/, '') : '(keine)'}
Vorhandene Notizen: ${notes.join(' · ') || '(keine)'}`;
}

const tableMd = (headers, rows) => {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = headers?.length ? headers : (rows?.[0] || []).map((_, i) => `Spalte ${i + 1}`);
  return [`| ${head.map(esc).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...(rows || []).map((r) => `| ${head.map((_, i) => esc(r[i])).join(' | ')} |`)].join('\n');
};

/** Führt die Aktionen aus und liefert eine Liste von Ergebnissen { ok, text } */
export async function runActions(app, actions) {
  const results = [];
  const ed = () => app.editor;
  const needNote = () => { if (!ed()?.note || !app.currentPath) throw new Error('Keine Notiz geöffnet'); };
  const insertBlocks = (blocks, position = 'cursor') => {
    needNote();
    const editor = ed();
    const focusId = document.activeElement?.closest?.('.block')?.dataset.id || editor.selectedBlockId;
    let idx = position === 'start' ? 0 : position === 'end' || !focusId || editor.index(focusId) < 0 ? editor.note.blocks.length : editor.index(focusId) + 1;
    // Leeren letzten Absatz einer leeren Notiz ersetzen
    if (editor.note.blocks.length === 1 && editor.note.blocks[0].type === 'paragraph' && !String(editor.note.blocks[0].data.text || '').replace(/<[^>]+>/g, '').trim()) { editor.note.blocks = []; idx = 0; }
    editor.note.blocks.splice(idx, 0, ...blocks);
    editor.renderAll();
    editor.changed(true);
  };

  for (const a of actions) {
    try {
      switch (a.type) {
        case 'insert': {
          const blocks = mdToBlocks(String(a.markdown || ''), ed());
          insertBlocks(blocks, a.position);
          results.push({ ok: true, text: `${blocks.length} ${blocks.length === 1 ? 'Block' : 'Blöcke'} eingefügt` });
          break;
        }
        case 'table': {
          const blocks = mdToBlocks(tableMd(a.headers, a.rows), ed());
          insertBlocks(blocks, a.position);
          results.push({ ok: true, text: `Tabelle eingefügt (${(a.rows || []).length} Zeilen)` });
          break;
        }
        case 'todos': {
          const items = (a.items || []).filter((x) => x && (x.text || typeof x === 'string')).map((x) => (typeof x === 'string' ? { text: x } : x));
          if (!items.length) throw new Error('Keine Aufgaben angegeben');
          const valid = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : '');
          if (a.where === 'quicknote' || !app.currentPath) {
            for (const it of items) await addQuickNote(app, { text: it.text, asTodo: true, due: valid(it.due), dueTime: /^\d{1,2}:\d{2}$/.test(it.time || '') ? it.time.padStart(5, '0') : '' });
            results.push({ ok: true, text: `${items.length} ${items.length === 1 ? 'Aufgabe' : 'Aufgaben'} in den Schnellnotizen angelegt` });
          } else {
            const editor = ed();
            const blocks = items.map((it) => {
              const due = valid(it.due);
              const data = { text: mdInlineToHtml(String(it.text)), checked: !!it.checked };
              if (due) data.due = due;
              if (due && /^\d{1,2}:\d{2}$/.test(it.time || '')) data.dueTime = it.time.padStart(5, '0');
              if (due && Array.isArray(it.remind) && it.remind.length) data.remind = it.remind.map(Number).filter((n) => n >= 0);
              return editor.newBlock('todo', data);
            });
            insertBlocks(blocks, a.position);
            const dated = items.filter((it) => valid(it.due)).length;
            results.push({ ok: true, text: `${items.length} ${items.length === 1 ? 'Aufgabe' : 'Aufgaben'} eingefügt${dated ? ` (${dated} mit Datum)` : ''}` });
          }
          app.events.emit('todos:change');
          break;
        }
        case 'page': {
          const title = String(a.title || 'Neue Seite').slice(0, 120);
          let folder = '';
          if (a.parent === 'current' && app.currentPath) folder = childFolder(app.currentPath);
          else if (a.parent && a.parent !== 'root' && a.parent !== 'current') {
            folder = String(a.parent).replace(/\.alenote$/, ''); // Seite → ihr Unterseiten-Ordner
          }
          await app.saveNow();
          if (folder) await app.api.ensureFolder(folder);
          const blocks = a.markdown ? mdToBlocks(String(a.markdown), ed()) : [];
          const p = await app.api.createNote(folder, title, { version: 1, created: Date.now(), updated: Date.now(), icon: a.icon || '', blocks, floats: [] });
          if (folder && app.currentPath && folder === childFolder(app.currentPath)) app.sidebar.expanded.add(app.currentPath);
          await app.sidebar.refresh();
          if (a.open !== false) await app.openNote(p);
          results.push({ ok: true, text: `Seite „${title}“ angelegt`, path: p });
          break;
        }
        case 'replace': {
          needNote();
          const editor = ed();
          editor.note.blocks = mdToBlocks(String(a.markdown || ''), editor);
          if (!editor.note.blocks.length) editor.note.blocks.push(editor.newBlock('paragraph'));
          editor.renderAll();
          editor.changed(true);
          results.push({ ok: true, text: 'Notiz ersetzt (Strg+Z macht es rückgängig)' });
          break;
        }
        case 'rename': {
          needNote();
          const np = await app.renameItem(app.currentPath, String(a.title || '').trim());
          results.push({ ok: !!np, text: np ? `Umbenannt in „${String(a.title).trim()}“` : 'Umbenennen fehlgeschlagen' });
          break;
        }
        case 'icon': {
          needNote();
          ed().note.icon = String(a.emoji || '').slice(0, 42);
          ed().changed(true);
          ed().renderAll();
          await app.saveNow();
          app.sidebar.refresh();
          app.updateChrome();
          results.push({ ok: true, text: `Icon gesetzt: ${a.emoji}` });
          break;
        }
        case 'open': {
          const want = String(a.path || a.title || '').replace(/\.alenote$/, '').toLowerCase();
          const n = app.sidebar.allNotes().find((x) => x.path.replace(/\.alenote$/, '').toLowerCase() === want) || app.sidebar.allNotes().find((x) => x.name.toLowerCase() === want.split('/').pop());
          if (!n) throw new Error(`Notiz „${a.path || a.title}“ nicht gefunden`);
          await app.openNote(n.path);
          results.push({ ok: true, text: `„${n.name}“ geöffnet` });
          break;
        }
        case 'quicknote': {
          const p = await addQuickNote(app, { text: String(a.text || ''), asTodo: !!a.due, due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '' });
          results.push({ ok: true, text: `Schnellnotiz gespeichert in „${p.replace(/\.alenote$/, '').split('/').pop()}“` });
          break;
        }
        case 'command': {
          const cmd = app.registry.commands.get(String(a.id || ''));
          if (!cmd || BLOCKED.test(cmd.id) || BLOCKED.test(cmd.name || '')) throw new Error(`Befehl „${a.id}“ nicht erlaubt oder unbekannt`);
          if (cmd.when && !cmd.when(app)) throw new Error(`„${cmd.name}“ geht gerade nicht`);
          await app.runCommand(cmd.id);
          results.push({ ok: true, text: `Befehl ausgeführt: ${cmd.name}` });
          break;
        }
        case 'invalid':
          results.push({ ok: false, text: a.error });
          break;
        default:
          results.push({ ok: false, text: `Unbekannte Aktion „${a.type}“` });
      }
    } catch (err) {
      results.push({ ok: false, text: err.message || String(err) });
    }
  }
  return results;
}
