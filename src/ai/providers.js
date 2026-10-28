// KI-Anbieter: Claude, ChatGPT, Gemini, Mistral, Groq, DeepSeek, xAI, OpenRouter, Ollama, Open WebUI, eigene
// Alle Anfragen laufen direkt aus der App zum Anbieter (mit Streaming).
// API-Schlüssel werden nur lokal auf dem Gerät gespeichert.

export const PROVIDERS = {
  anthropic: {
    name: 'Claude (Anthropic)', protocol: 'anthropic', keyUrl: 'https://platform.claude.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    baseUrl: 'https://api.anthropic.com'
  },
  openai: {
    name: 'ChatGPT (OpenAI)', protocol: 'openai', keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'],
    baseUrl: 'https://api.openai.com/v1'
  },
  gemini: {
    name: 'Gemini (Google)', protocol: 'gemini', keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
  },
  mistral: {
    name: 'Mistral', protocol: 'openai', keyUrl: 'https://console.mistral.ai/api-keys',
    defaultModel: 'mistral-large-latest', models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
    baseUrl: 'https://api.mistral.ai/v1'
  },
  groq: {
    name: 'Groq', protocol: 'openai', keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  deepseek: {
    name: 'DeepSeek', protocol: 'openai', keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'],
    baseUrl: 'https://api.deepseek.com'
  },
  xai: {
    name: 'Grok (xAI)', protocol: 'openai', keyUrl: 'https://console.x.ai',
    defaultModel: 'grok-4', models: ['grok-4', 'grok-3-mini'],
    baseUrl: 'https://api.x.ai/v1'
  },
  openrouter: {
    name: 'OpenRouter (viele Modelle)', protocol: 'openai', keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'anthropic/claude-opus-5-5', models: ['anthropic/claude-opus-5-5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct'],
    baseUrl: 'https://openrouter.ai/api/v1'
  },
  ollama: {
    name: 'Ollama (lokal, ohne Schlüssel)', protocol: 'openai', noKey: true, keyUrl: 'https://ollama.com',
    defaultModel: 'llama3.2', models: ['llama3.2', 'qwen2.5', 'mistral', 'gemma3'],
    baseUrl: 'http://localhost:11434/v1', editableUrl: true, apiSuffix: '/v1', listModels: true,
    urlHelp: 'z.B. http://192.168.1.20:11434 – „/v1“ wird automatisch ergänzt. Ollama muss mit OLLAMA_ORIGINS="*" laufen, sonst blockt es die App'
  },
  openwebui: {
    name: 'Open WebUI (selbst gehostet)', protocol: 'openai', keyUrl: '',
    keyHelp: 'In Open WebUI: Profilbild → Einstellungen → Konto → API-Schlüssel → „Neuen Schlüssel erstellen“',
    urlHelp: 'Adresse von Open WebUI, z.B. https://ki.meine-domain.de oder http://192.168.1.20:3000 – „/api“ wird automatisch ergänzt',
    defaultModel: '', models: [], baseUrl: 'http://localhost:3000/api', editableUrl: true, optionalKey: true, apiSuffix: '/api', listModels: true
  },
  custom: {
    name: 'Eigener (OpenAI-kompatibel)', protocol: 'openai', keyUrl: '',
    defaultModel: '', models: [], baseUrl: 'http://localhost:1234/v1', editableUrl: true, optionalKey: true, listModels: true
  }
};

export function ollamaName(m) {
  const parts = m.trim().toLowerCase().split(/\s+/);
  const tag = /^(\d+(\.\d+)?[bm]|latest|e\d+b)$/.test(parts.at(-1)) && parts.length > 1 ? parts.pop() : '';
  return parts.join('') + (tag ? ':' + tag : '');
}

/** Basis-Adresse eines Anbieters (bei Ollama/Open WebUI wird /v1 bzw. /api ergänzt, falls es fehlt) */
export function baseUrlOf(cfg) {
  const p = PROVIDERS[cfg.provider] || {};
  let base = String(cfg.baseUrl || p.baseUrl || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) base = 'http://' + base;
  if (p.apiSuffix && !/\/(api|v1)(\/v1)?$/i.test(base)) base += p.apiSuffix;
  return base;
}

/** Netzwerkfehler in eine verständliche Meldung übersetzen */
function networkError(cfg, base, err) {
  if (err?.name === 'AbortError') return err;
  const name = PROVIDERS[cfg.provider]?.name || 'KI-Server';
  if (location.protocol === 'https:' && /^http:/i.test(base)) {
    return new Error(`${name} ist nur über http:// erreichbar, AleNote läuft hier aber über https:// – der Browser blockiert das. Stelle die KI hinter deinen Reverse-Proxy (https://…) und trage diese Adresse ein.`);
  }
  if (cfg.provider === 'ollama') return new Error(`Ollama unter ${base} nicht erreichbar. Läuft Ollama, stimmt die Adresse, und ist OLLAMA_ORIGINS="*" gesetzt? (Ohne diese Einstellung blockt Ollama Anfragen aus Apps.)`);
  if (cfg.provider === 'openwebui') return new Error(`Open WebUI unter ${base} nicht erreichbar. Stimmt die Adresse (gleiche wie im Browser, ohne /chat …)? Falls du CORS_ALLOW_ORIGIN eingeschränkt hast: auf * setzen.`);
  return new Error(`${name} unter ${base} nicht erreichbar (${err?.message || err}). Adresse prüfen – bei selbst gehosteten Servern auch die CORS-Einstellung.`);
}

/** Installierte Modelle abfragen (OpenAI-Format: GET /models → { data: [{ id }] }) */
export async function listModels(cfg) {
  const base = baseUrlOf(cfg);
  const headers = {};
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  let res;
  try { res = await fetch(base + '/models', { headers, signal: AbortSignal.timeout(15e3) }); }
  catch (err) { throw networkError(cfg, base, err); }
  if (!res.ok) throw new Error(await errorText(res));
  const body = await res.json();
  const list = (body.data || body.models || []).map((m) => m.id || m.name || m.model).filter(Boolean);
  return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

/** Liest einen SSE-Stream und ruft onEvent(data) für jede "data:"-Zeile auf */
async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { onEvent(JSON.parse(data)); } catch { /* unvollständige Zeile ignorieren */ }
    }
  }
}

async function errorText(res) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    msg = body.error?.message || body.error?.type || body.message || body.detail || (typeof body.error === 'string' ? body.error : msg);
  } catch {}
  if (res.status === 401 || res.status === 403) msg = 'API-Schlüssel ungültig oder ohne Berechtigung – ' + msg;
  if (res.status === 404 || res.status === 405) msg += ' – Adresse oder Modellname prüfen';
  if (res.status === 429) msg = 'Zu viele Anfragen oder Guthaben aufgebraucht – ' + msg;
  return msg;
}

/**
 * Streamt eine Antwort.
 * @param {object} cfg       { provider, apiKey, model, baseUrl }
 * @param {string} system    System-Anweisung
 * @param {Array}  messages  [{ role: 'user'|'assistant', content: string }]
 * @param {function} onText  wird mit jedem neuen Textstück aufgerufen
 * @returns {Promise<{text: string, note?: string}>}
 */
export async function streamChat(cfg, { system, messages, onText, signal }) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new Error('Unbekannter KI-Anbieter');
  if (!cfg.apiKey && !p.noKey && !p.optionalKey) throw new Error(`Kein API-Schlüssel für ${p.name} hinterlegt (Einstellungen → KI)`);
  let model = (cfg.model || p.defaultModel || '').trim();
  if (!model) throw new Error('Kein Modell angegeben (Einstellungen → KI)');
  // Ollama: Anzeigenamen wie „Qwen3 8B“ in den technischen Namen „qwen3:8b“ umwandeln
  if (cfg.provider === 'ollama' && /\s/.test(model)) model = ollamaName(model);
  const base = baseUrlOf(cfg);
  let text = '';
  let note = '';
  const push = (t) => { if (t) { text += t; onText?.(t, text); } };

  if (p.protocol === 'anthropic') {
    // Claude Messages API (direkter Aufruf aus der App)
    const body = { model, max_tokens: 64000, stream: true, system, messages };
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    // Ausweichmodell bei Sicherheits-Ablehnung (serverseitig, wählt automatisch passend)
    if (['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5'].includes(model)) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    const res = await fetch(base + '/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error(await errorText(res));
    await readSSE(res, (ev) => {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') push(ev.delta.text);
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') note = 'Die Anfrage wurde vom Modell abgelehnt.';
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'max_tokens') note = 'Antwort wurde wegen Längenbegrenzung abgeschnitten.';
      else if (ev.type === 'error') throw new Error(ev.error?.message || 'Fehler im Stream');
    });
    return { text, note };
  }

  if (p.protocol === 'gemini') {
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined })
    });
    if (!res.ok) throw new Error(await errorText(res));
    await readSSE(res, (ev) => {
      const c = ev.candidates?.[0];
      for (const part of c?.content?.parts || []) if (!part.thought) push(part.text);
      if (c?.finishReason === 'SAFETY') note = 'Die Anfrage wurde aus Sicherheitsgründen blockiert.';
    });
    return { text, note };
  }

  // OpenAI-kompatibel (OpenAI, Mistral, Groq, DeepSeek, xAI, OpenRouter, Ollama, eigene)
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  if (cfg.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/AleB-Roni/AleNote'; headers['X-Title'] = 'AleNote'; }
  const res = await fetch(base + '/chat/completions', {
    method: 'POST', headers, signal,
    body: JSON.stringify({ model, stream: true, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] })
  }).catch((e) => { throw networkError(cfg, base, e); });
  if (!res.ok) throw new Error(await errorText(res));
  await readSSE(res, (ev) => {
    push(ev.choices?.[0]?.delta?.content);
    if (ev.choices?.[0]?.finish_reason === 'content_filter') note = 'Die Antwort wurde vom Inhaltsfilter blockiert.';
  });
  return { text, note };
}
