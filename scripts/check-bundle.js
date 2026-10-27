// Prüft, ob alle Dateien, die die App per import lädt, im gepackten Ordner vorhanden sind.
// Aufruf: node scripts/check-bundle.js android/app/src/main/assets/public
// (Capacitor entfernt beim Kopieren z.B. einen Ordner namens "plugins" – das fällt hier auf.)
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'src');
const missing = [];
const seen = new Set();

function check(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!fs.existsSync(file)) return;
  const code = fs.readFileSync(file, 'utf8');
  const re = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const m of code.matchAll(re)) {
    const target = path.resolve(path.dirname(file), m[1] || m[2] || m[3]);
    if (!fs.existsSync(target)) missing.push(`${path.relative(root, file)} → ${path.relative(root, target)}`);
    else check(target);
  }
}

for (const html of ['index.html', 'quick.html']) {
  const p = path.join(root, html);
  if (!fs.existsSync(p)) { missing.push(html); continue; }
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:src|href)="([^":]+\.(?:js|css))"/g)) {
    const target = path.join(root, m[1]);
    if (!fs.existsSync(target)) missing.push(`${html} → ${m[1]}`);
    else if (target.endsWith('.js')) check(target);
  }
}

if (missing.length) {
  console.error('Fehlende Dateien im Paket:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log(`OK – ${seen.size} Skripte geprüft, alle Importe vorhanden (${root})`);
