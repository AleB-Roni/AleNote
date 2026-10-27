// „Frag deine Notizen“: passende Notizen für eine Frage finden (Stichwortsuche mit Gewichtung),
// damit die KI mit deinem eigenen Wissen antworten kann – ohne dass alles verschickt wird.
import { blocksToMarkdown } from './markdown.js';

const STOP = new Set(('der die das den dem des ein eine einer eines einem einen und oder aber auch als am an auf aus bei bin bis bist da dann dass dein deine dem den denn doch du er es etwas für hab habe haben hat hatte ich ihr im in ist ja kann kannst mal man mein meine mich mir mit muss nach nicht noch nun nur ob schon sein sich sie sind so über um und uns unser von vor war was weil welche welcher welches wenn wer wie wieder wir wird wo zu zum zur zwischen alle allem alles diese dieser dieses dort hier gibt geben gib bitte mehr sehr viel viele wann warum wieso welche notiz notizen ' +
  'the a an and or of to in on for is are was were be what which who how when where my me i you your with about from this that these those do does did have has had').split(' '));

const norm = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
/** Wortstamm grob kürzen (Plural/Endungen), damit „Rechnungen“ auch „Rechnung“ findet */
const stem = (w) => (w.length > 5 ? w.replace(/(ungen|innen|en|er|es|e|n|s)$/, '') : w);
export const tokenize = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);

const RECENT = /\b(zuletzt|letzte[nmrs]?|neueste[nmrs]?|heute|gestern|diese[rn]? woche|vorige|recent|latest)\b/i;

/**
 * Gibt die relevantesten Notizen zurück: [{ path, name, text, score, updated }]
 * query: Frage (ggf. mit vorherigen Fragen ergänzt)
 */
export async function findRelevantNotes(app, query, { limit = 8, budget = 32000, perNote = 9000 } = {}) {
  const tplFolder = (app.settings.templateFolder || 'Vorlagen') + '/';
  const notes = app.sidebar.allNotes().filter((n) => !n.path.startsWith(tplFolder));
  const docs = [];
  await Promise.all(notes.map(async (n) => {
    try {
      const data = n.path === app.currentPath && app.editor.note ? app.editor.note : await app.api.readNote(n.path);
      const blocks = [...(data.blocks || []), ...(data.floats || []).filter((f) => f.block).map((f) => f.block)];
      const text = blocksToMarkdown(app.editor, blocks);
      docs.push({ path: n.path, name: n.name, text, updated: data.updated || data.created || 0, tokens: tokenize(n.name + ' ' + n.path + ' ' + text), titleTokens: tokenize(n.name + ' ' + n.path) });
    } catch {}
  }));
  if (!docs.length) return [];

  const q = [...new Set(tokenize(query))];
  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / N || 1;
  // Dokumenthäufigkeit je Suchwort (auch Teilwörter: „steuer“ in „steuererklaerung“)
  const matches = (tok, w) => tok === w || (w.length >= 4 && tok.startsWith(w)) || (w.length >= 5 && tok.includes(w));
  const df = Object.fromEntries(q.map((w) => [w, docs.filter((d) => d.tokens.some((t) => matches(t, w))).length]));
  const now = Date.now();
  const wantsRecent = RECENT.test(query);

  for (const d of docs) {
    let score = 0;
    for (const w of q) {
      if (!df[w]) continue;
      let tf = 0;
      for (const t of d.tokens) if (t === w) tf += 1; else if (matches(t, w)) tf += 0.6;
      if (!tf) continue;
      const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.tokens.length / avgLen))); // BM25
      if (d.titleTokens.some((t) => matches(t, w))) score += idf * 1.5; // Treffer im Titel zählen mehr
    }
    const ageDays = (now - d.updated) / 864e5;
    if (wantsRecent) score += Math.max(0, 3 - ageDays / 3);
    else if (score > 0 && ageDays < 7) score *= 1.1;
    d.score = score;
  }

  const ranked = docs.filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length && wantsRecent) ranked.push(...docs.sort((a, b) => b.updated - a.updated).slice(0, 5));
  const out = [];
  let used = 0;
  for (const d of ranked.slice(0, limit)) {
    if (used >= budget) break;
    const text = d.text.length > perNote ? d.text.slice(0, perNote) + '\n…(gekürzt)' : d.text;
    used += text.length;
    out.push({ path: d.path, name: d.name, text, score: d.score, updated: d.updated });
  }
  return out;
}

/** System-Anweisung mit den gefundenen Notizen */
export function buildNotesContext(found, allNames) {
  const date = (t) => (t ? new Date(t).toLocaleDateString('de-DE') : '?');
  let s = 'Der Nutzer stellt Fragen zu seinen eigenen Notizen. Beantworte sie ausschließlich anhand der folgenden Notizen. ' +
    'Nenne die Quellen, indem du die Notiztitel in doppelten eckigen Klammern schreibst, z.B. [[Projekt Alpha]]. ' +
    'Wenn die Notizen keine Antwort enthalten, sag das ehrlich und rate nicht.\n\n';
  if (found.length) {
    s += found.map((n) => `### Notiz [[${n.name}]] (Pfad: ${n.path}, zuletzt geändert ${date(n.updated)})\n<<<\n${n.text}\n>>>`).join('\n\n');
  } else {
    s += '(Zu dieser Frage wurde keine passende Notiz gefunden.)';
  }
  if (allNames?.length) s += `\n\nAlle Notiztitel des Nutzers (zur Orientierung): ${allNames.slice(0, 300).join(' · ')}`;
  return s;
}
