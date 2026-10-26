// Update-Verteilung für die AleNote-Desktop-App
//
// Der Server stellt unter /updates/ die Dateien bereit, die electron-updater erwartet:
//   latest.yml, AleNote-Setup-<version>.exe, AleNote-Setup-<version>.exe.blockmap
//
// Neue Versionen kommen automatisch aus den GitHub-Releases (Spiegel)
// oder werden in der Admin-Konsole von Hand hochgeladen.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { JsonFile } = require('./store');

const SAFE_NAME = /^[\w.-]+$/;

function parseLatestYml(text) {
  const version = (text.match(/^version:\s*['"]?([^'"\s]+)/m) || [])[1] || null;
  const file = (text.match(/^path:\s*['"]?([^'"\n]+?)['"]?\s*$/m) || [])[1] || null;
  const releaseDate = (text.match(/^releaseDate:\s*['"]?([^'"\n]+?)['"]?\s*$/m) || [])[1] || null;
  return { version, file, releaseDate };
}

class UpdateStore {
  constructor(dataDir, getSettings) {
    this.dir = path.join(dataDir, 'updates');
    this.getSettings = getSettings;
    this.status = new JsonFile(path.join(this.dir, 'status.json'), { version: null, file: null, releaseDate: null, source: null, lastCheck: null, lastError: null, checking: false });
    this.timer = null;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    await this.status.load();
    this.status.data.checking = false;
    // Alle 6 Stunden nach neuen Releases schauen
    this.timer = setInterval(() => { if (this.getSettings().updateAuto) this.checkGithub().catch(() => {}); }, 6 * 3600e3);
    if (this.getSettings().updateAuto) setTimeout(() => this.checkGithub().catch(() => {}), 5000);
  }

  info() { return { ...this.status.data }; }

  async ghFetch(url, accept) {
    const headers = { 'User-Agent': 'AleNote-Server', Accept: accept || 'application/vnd.github+json' };
    // Nur für private Repositories nötig
    const token = process.env.ALENOTE_GITHUB_TOKEN;
    if (token && url.startsWith('https://api.github.com/')) headers.Authorization = 'Bearer ' + token;
    let res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(10 * 60e3) });
    if (res.status === 401 && headers.Authorization) {
      delete headers.Authorization;
      res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(10 * 60e3) });
    }
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub-Abfragelimit erreicht – wird später automatisch erneut versucht');
    if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}${res.status === 404 ? ' (noch kein Release vorhanden?)' : ''}`);
    return res;
  }

  async download(url, target) {
    const res = await this.ghFetch(url, 'application/octet-stream');
    const tmp = target + '.part';
    await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
    await fsp.rename(tmp, target);
  }

  /** Neuestes GitHub-Release spiegeln */
  async checkGithub() {
    const st = this.status.data;
    if (st.checking) return this.info();
    st.checking = true;
    try {
      const repo = this.getSettings().updateRepo || 'AleB-Roni/AleNote';
      const rel = await (await this.ghFetch(`https://api.github.com/repos/${repo}/releases/latest`)).json();
      const yml = rel.assets?.find((a) => a.name === 'latest.yml');
      if (!yml) throw new Error(`Release ${rel.tag_name} enthält keine latest.yml`);
      const text = await (await this.ghFetch(yml.browser_download_url, 'application/octet-stream')).text();
      const meta = parseLatestYml(text);
      if (!meta.version || !meta.file || !SAFE_NAME.test(meta.file)) throw new Error('latest.yml ist ungültig');
      if (meta.version !== st.version || !fs.existsSync(path.join(this.dir, meta.file))) {
        const exe = rel.assets.find((a) => a.name === meta.file);
        if (!exe) throw new Error(`Setup-Datei ${meta.file} fehlt im Release`);
        await this.download(exe.browser_download_url, path.join(this.dir, meta.file));
        const map = rel.assets.find((a) => a.name === meta.file + '.blockmap');
        if (map) await this.download(map.browser_download_url, path.join(this.dir, map.name));
        // latest.yml zuletzt schreiben, damit Clients nie auf eine fehlende Datei zeigen
        await fsp.writeFile(path.join(this.dir, 'latest.yml.part'), text);
        await fsp.rename(path.join(this.dir, 'latest.yml.part'), path.join(this.dir, 'latest.yml'));
        Object.assign(st, { version: meta.version, file: meta.file, releaseDate: meta.releaseDate || rel.published_at, source: `GitHub ${repo} (${rel.tag_name})` });
        await this.cleanup(meta.file);
        console.log(`  Update ${meta.version} von GitHub übernommen`);
      }
      st.lastError = null;
    } catch (err) {
      st.lastError = err.message;
      throw err;
    } finally {
      st.checking = false;
      st.lastCheck = Date.now();
      await this.status.save();
    }
    return this.info();
  }

  /** Manuell hochgeladene Datei speichern (latest.yml, Setup-EXE, Blockmap) */
  async upload(name, buf) {
    if (!SAFE_NAME.test(name)) throw Object.assign(new Error('Ungültiger Dateiname'), { status: 400 });
    if (name === 'latest.yml') {
      const meta = parseLatestYml(buf.toString('utf8'));
      if (!meta.version || !meta.file) throw Object.assign(new Error('latest.yml ist ungültig'), { status: 400 });
      if (!fs.existsSync(path.join(this.dir, meta.file))) throw Object.assign(new Error(`Bitte zuerst ${meta.file} hochladen`), { status: 400 });
      await fsp.writeFile(path.join(this.dir, 'latest.yml'), buf);
      Object.assign(this.status.data, { version: meta.version, file: meta.file, releaseDate: meta.releaseDate, source: 'Manuell hochgeladen', lastError: null });
      await this.status.save();
      await this.cleanup(meta.file);
    } else {
      await fsp.writeFile(path.join(this.dir, name + '.part'), buf);
      await fsp.rename(path.join(this.dir, name + '.part'), path.join(this.dir, name));
    }
    return this.info();
  }

  async cleanup(keep) {
    for (const f of await fsp.readdir(this.dir)) {
      if (/\.exe(\.blockmap)?$/.test(f) && f !== keep && f !== keep + '.blockmap') await fsp.rm(path.join(this.dir, f), { force: true });
    }
  }

  /** Statische Auslieferung mit Range-Unterstützung (für Differenz-Downloads) */
  async serve(req, res, name) {
    if (!SAFE_NAME.test(name) || name === 'status.json' || name.endsWith('.part')) { res.writeHead(404); return res.end(); }
    const file = path.join(this.dir, name);
    let stat;
    try { stat = await fsp.stat(file); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Nicht gefunden'); }
    const type = name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': name.endsWith('.yml') ? 'no-cache' : 'public, max-age=86400' };
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      if (!range[1]) end = stat.size - 1;
      if (start > end || end >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
}

module.exports = { UpdateStore, parseLatestYml };
