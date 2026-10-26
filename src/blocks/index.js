// Alle eingebauten Blocktypen. Neue Blöcke hier importieren
// oder (besser) als Plugin registrieren – siehe src/plugins/.
import registerTextBlocks from './text.js';
import registerMediaBlocks from './media.js';
import registerTable from './table.js';

export function registerBuiltinBlocks(registry) {
  registerTextBlocks(registry);
  registerTable(registry);
  registerMediaBlocks(registry);
}
