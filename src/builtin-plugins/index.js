// Eingebaute Plugins. Jedes Plugin nutzt nur die öffentliche Plugin-API –
// sie sind also gleichzeitig Beispiele für eigene Erweiterungen.
import * as wordCount from './word-count.js';
import * as markdownExport from './markdown-export.js';
import * as progressBlock from './progress-block.js';
import * as dailyNote from './daily-note.js';
import * as outline from './outline.js';

export const builtinPlugins = [wordCount, markdownExport, progressBlock, dailyNote, outline];
