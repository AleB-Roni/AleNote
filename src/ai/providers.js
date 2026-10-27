// KI-Anbieter: Claude, ChatGPT, Gemini, Mistral, Groq, DeepSeek, xAI, OpenRouter, Ollama, eigene
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
    baseUrl: 'http://localhost:11434/v1', editableUrl: true
  },
  custom: {
    name: 'Eigener (OpenAI-kompatibel)', protocol: 'openai', keyUrl: '',
    defaultModel: '', models: [], baseUrl: 'http://localhost:1234/v1', editableUrl: true, optionalKey: true
  }
};

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
    msg = body.error?.message || body.error?.type || body.message || (typeof body.error === 'string' ? body.error : msg);
  } catch {}
  if (res.status === 401 || res.status === 403) msg = 'API-Schlüssel ungültig oder ohne Berechtigung – ' + msg;
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
  const model = cfg.model || p.defaultModel;
  if (!model) throw new Error('Kein Modell angegeben (Einstellungen → KI)');
  const base = (cfg.baseUrl || p.baseUrl).replace(/\/+$/, '');
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
  }).catch((e) => {
    if (cfg.provider === 'ollama') throw new Error('Ollama nicht erreichbar. Läuft Ollama? (OLLAMA_ORIGINS="*" setzen, damit die App zugreifen darf)');
    throw e;
  });
  if (!res.ok) throw new Error(await errorText(res));
  await readSSE(res, (ev) => {
    push(ev.choices?.[0]?.delta?.content);
    if (ev.choices?.[0]?.finish_reason === 'content_filter') note = 'Die Antwort wurde vom Inhaltsfilter blockiert.';
  });
  return { text, note };
}
