// Diktieren: Sprache aufnehmen und in Text umwandeln.
// 1) Aufnahme im Gerät + Umwandlung durch OpenAI (Whisper), Groq (Whisper) oder Gemini
//    – funktioniert auf Windows, Android und im Browser.
// 2) Ersatzweise die Spracherkennung des Browsers (Chrome, Edge, Safari).
// Danach kann die KI den Text bereinigen (Satzzeichen, Füllwörter, Erkennungsfehler).
import { h } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/overlays.js';
import { PROVIDERS, streamChat } from './providers.js';

export const DICTATE_DEFAULTS = { provider: 'auto', language: 'de', cleanup: true };
const STT = ['openai', 'groq', 'gemini'];
const STT_MODELS = { openai: 'gpt-4o-mini-transcribe', groq: 'whisper-large-v3-turbo' };

const BrowserSR = window.SpeechRecognition || window.webkitSpeechRecognition;
/** Browser-Spracherkennung (nicht in Electron: dort fehlt der Google-Dienst) */
const browserSRAvailable = () => !!BrowserSR && !window.alenoteNative && !window.Capacitor?.isNativePlatform?.();

export function dictateSettings(app) { return { ...DICTATE_DEFAULTS, ...(app.settings.ai?.dictate || {}) }; }

/** Welcher Weg wird genutzt? → { kind: 'cloud', provider } | { kind: 'browser' } | null */
export function dictationMethod(app) {
  const ds = dictateSettings(app);
  const ai = app.ai;
  const hasKey = (id) => !!ai?.cfg.providers[id]?.apiKey;
  if (ds.provider === 'browser') return browserSRAvailable() ? { kind: 'browser' } : null;
  if (STT.includes(ds.provider)) return hasKey(ds.provider) ? { kind: 'cloud', provider: ds.provider } : null;
  const id = STT.find(hasKey);
  if (id) return { kind: 'cloud', provider: id };
  return browserSRAvailable() ? { kind: 'browser' } : null;
}

// ---------- Audio → WAV (16 kHz, mono) – verstehen alle Dienste ----------
async function toWav(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf);
  ctx.close?.();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out], { type: 'audio/wav' });
}

const blobToBase64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });

async function transcribe(app, provider, wav, language) {
  const cfg = app.ai.providerConfig(provider);
  const base = (cfg.baseUrl || PROVIDERS[provider].baseUrl).replace(/\/+$/, '');
  if (provider === 'gemini') {
    const model = cfg.model && /gemini/.test(cfg.model) ? cfg.model : 'gemini-2.5-flash';
    const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: await blobToBase64(wav) } }, { text: 'Transkribiere diese Sprachaufnahme wortgetreu. Gib nur den gesprochenen Text zurück, ohne Kommentar.' }] }] })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Gemini antwortet mit ' + res.status);
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  }
  const form = new FormData();
  form.append('file', wav, 'aufnahme.wav');
  form.append('model', STT_MODELS[provider]);
  if (language && language !== 'auto') form.append('language', language);
  const res = await fetch(base + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.apiKey }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `${PROVIDERS[provider].name} antwortet mit ${res.status}`);
  return String(data.text || '').trim();
}

/** Diktierten Text mit der Standard-KI bereinigen (falls eingerichtet) */
export async function cleanupText(app, text) {
  const ai = app.ai;
  if (!text || !ai?.isConfigured() || !ai.cfg.providers[ai.cfg.defaultProvider]?.apiKey && !PROVIDERS[ai.cfg.defaultProvider]?.noKey) return text;
  try {
    const r = await streamChat(ai.providerConfig(), {
      system: 'Du bereinigst diktierten Text. Setze Satzzeichen und Groß-/Kleinschreibung, entferne Füllwörter (äh, ähm, also halt) und Wiederholungen, korrigiere offensichtliche Erkennungsfehler. Ändere nicht den Inhalt und füge nichts hinzu. Gesprochene Befehle wie „neue Zeile“ oder „Punkt“ setzt du um. Antworte nur mit dem bereinigten Text.',
      messages: [{ role: 'user', content: text }]
    });
    return r.text.trim() || text;
  } catch { return text; }
}

/**
 * Startet eine Diktat-Sitzung mit kleiner Aufnahme-Leiste.
 * onText(text) erhält das Endergebnis. Gibt eine Funktion zum Stoppen zurück.
 */
export async function startDictation(app, { onText, anchor } = {}) {
  if (document.querySelector('.dictate-bar')) return null;
  const method = dictationMethod(app);
  if (!method) {
    toast('Zum Diktieren in Einstellungen → KI einen Schlüssel für OpenAI, Groq oder Gemini hinterlegen', { type: 'error', duration: 5000, action: { label: 'Einstellungen', run: () => app.openSettings('ai') } });
    return null;
  }
  const ds = dictateSettings(app);
  const lang = ds.language === 'auto' ? '' : ds.language;

  // ---- Leiste ----
  const timeEl = h('span.dictate-time', { text: '0:00' });
  const live = h('span.dictate-live');
  const level = h('span.dictate-level');
  const stopBtn = h('button.dictate-stop', { title: 'Fertig (Enter)' }, icon('check', 16), 'Fertig');
  const cancelBtn = h('button.icon-btn', { title: 'Abbrechen (Esc)' }, icon('x', 16));
  const bar = h('div.dictate-bar', {}, h('span.dictate-dot'), level, h('b', { text: 'Diktieren' }), timeEl, live, h('div.flex'), cancelBtn, stopBtn);
  document.body.append(bar);
  const started = Date.now();
  const tick = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
  let finished = false;
  const cleanupUi = () => { clearInterval(tick); document.removeEventListener('keydown', onKey, true); bar.classList.add('leaving'); setTimeout(() => bar.remove(), 200); };
  const setBusy = (txt) => { bar.classList.add('busy'); live.textContent = txt; stopBtn.disabled = true; };
  const deliver = async (text) => {
    if (!text) { toast('Es wurde nichts erkannt', { duration: 2000 }); cleanupUi(); return; }
    if (ds.cleanup) { setBusy('KI bereinigt …'); text = await cleanupText(app, text); }
    cleanupUi();
    onText?.(text);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    if (e.key === 'Enter' && !bar.classList.contains('busy')) { e.preventDefault(); e.stopPropagation(); stop(); }
  };
  document.addEventListener('keydown', onKey, true);

  let stop, cancel;
  if (method.kind === 'browser') {
    const sr = new BrowserSR();
    sr.lang = lang ? { de: 'de-DE', en: 'en-US', fr: 'fr-FR', it: 'it-IT', es: 'es-ES' }[lang] || lang : navigator.language;
    sr.continuous = true;
    sr.interimResults = true;
    let finalText = '';
    sr.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      live.textContent = (finalText + interim).slice(-60);
    };
    sr.onerror = (e) => { if (!finished) { finished = true; cleanupUi(); toast('Spracherkennung: ' + (e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : e.error), { type: 'error' }); } };
    sr.onend = () => { if (!finished) { finished = true; deliver(finalText.trim()); } };
    sr.start();
    stop = () => sr.stop();
    cancel = () => { finished = true; sr.abort(); cleanupUi(); };
  } else {
    if (!navigator.mediaDevices?.getUserMedia) {
      cleanupUi();
      toast(window.isSecureContext ? 'Kein Mikrofon verfügbar' : 'Das Mikrofon funktioniert im Browser nur über HTTPS', { type: 'error', duration: 5000 });
      return null;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (err) { cleanupUi(); toast('Mikrofon nicht verfügbar: ' + (err.name === 'NotAllowedError' ? 'Zugriff verweigert' : err.message), { type: 'error' }); return null; }
    // Pegelanzeige
    let raf;
    try {
      const actx = new AudioContext();
      const an = actx.createAnalyser();
      an.fftSize = 256;
      actx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const loop = () => { an.getByteTimeDomainData(data); let m = 0; for (const v of data) m = Math.max(m, Math.abs(v - 128)); level.style.setProperty('--lvl', Math.min(1, m / 50)); raf = requestAnimationFrame(loop); };
      loop();
      bar._actx = actx;
    } catch {}
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const release = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); bar._actx?.close?.(); };
    rec.onstop = async () => {
      release();
      if (finished) return;
      finished = true;
      setBusy('Wandle Sprache in Text um …');
      try {
        const wav = await toWav(new Blob(chunks, { type: rec.mimeType }));
        await deliver(await transcribe(app, method.provider, wav, lang));
      } catch (err) { cleanupUi(); toast('Diktat fehlgeschlagen: ' + err.message, { type: 'error', duration: 5000 }); }
    };
    rec.start(1000);
    stop = () => { if (rec.state !== 'inactive') rec.stop(); };
    cancel = () => { finished = true; if (rec.state !== 'inactive') rec.stop(); release(); cleanupUi(); };
    live.textContent = `(${PROVIDERS[method.provider].name.split(' (')[0]})`;
  }
  stopBtn.addEventListener('click', () => stop());
  cancelBtn.addEventListener('click', () => cancel());
  return { stop, cancel };
}
