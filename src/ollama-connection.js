import { storageName } from './environment.js';

export const DEFAULT_OLLAMA_RELAY = '';
export function createOllamaConnection({ fetchImpl = fetch } = {}) {
  const prefsKey = storageName('megaapp.ollama.connection.v1');
  let prefs = { relayUrl: DEFAULT_OLLAMA_RELAY, model: 'gemma4:31b' }, token = '', connectedUrl = '', expiresAt = 0, models = [], details, form, pending = false, activeController;
  try { const saved = JSON.parse(localStorage.getItem(prefsKey)); if (saved && typeof saved.relayUrl === 'string' && typeof saved.model === 'string') prefs = saved; } catch { /* No credential is read from storage. */ }
  const subscribers = new Set();
  const info = () => ({ connected: !!token && Date.now() < expiresAt, model: prefs.model, relayUrl: prefs.relayUrl, expiresAt });
  const publish = () => { for (const callback of subscribers) callback(info()); };
  const savePrefs = () => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* Preferences can remain session-only. */ } };
  function base(value) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use the HTTPS relay address, or localhost for development.');
    return url.origin;
  }
  function show(message, failed = false) { if (!details) return; const node = details.querySelector('#meta-ollama-status'); node.textContent = message; node.dataset.error = String(failed); }
  function controls() {
    if (!details) return;
    const connected = info().connected;
    details.querySelector('#meta-ollama-connect').disabled = pending;
    details.querySelector('#meta-ollama-disconnect').hidden = !connected;
    details.querySelector('#meta-ollama-key').disabled = pending;
  }
  async function request(url, path, body, auth, signal) {
    let response;
    try { response = await fetchImpl(new URL(path, url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body), signal }); }
    catch (error) { if (signal?.aborted) throw new Error('Generation canceled; your previous programs are kept.'); throw new Error('The Ollama relay could not be reached. A sleeping relay may need a moment to start.'); }
    let value; try { value = await response.json(); } catch { throw new Error('The relay returned an unreadable response.'); }
    if (!response.ok) {
      if (value.code === 'SESSION_EXPIRED' || value.code === 'AUTH_FAILED') { token = ''; connectedUrl = ''; expiresAt = 0; controls(); publish(); }
      throw new Error(typeof value.error === 'string' ? value.error.slice(0, 500) : 'The relay could not complete the request.');
    }
    return value;
  }
  async function disconnect() {
    activeController?.abort(); const previous = token, url = connectedUrl;
    token = ''; connectedUrl = ''; expiresAt = 0; controls(); publish();
    show('Disconnected. The relay key session has been removed.');
    if (previous && url) await request(url, '/api/disconnect', {}, previous, AbortSignal.timeout(10000)).catch(() => { show('Disconnected here. An unreachable relay session expires automatically.'); });
  }
  async function connect(key) {
    const url = base(prefs.relayUrl);
    if (!key?.trim()) throw new Error('Enter your Ollama API key.');
    if (token) await disconnect();
    const result = await request(url, '/api/connect', { apiKey: key.trim() }, '', AbortSignal.timeout(90000));
    if (typeof result.token !== 'string' || !Number.isFinite(result.expiresAt) || !Array.isArray(result.models)) throw new Error('The relay connection response is invalid.');
    token = result.token; connectedUrl = url; expiresAt = result.expiresAt; models = result.models;
    if (!models.includes(prefs.model)) prefs.model = models[0] || ''; savePrefs();
    if (details) { details.querySelector('#meta-ollama-key').value = ''; renderModels(); }
    controls(); publish(); show('Relay connected for this session. Ollama checks the key on generation. Reconnect after reload or relay restart.');
  }
  function renderModels() {
    if (!details) return;
    const select = details.querySelector('#meta-ollama-model'); select.replaceChildren();
    for (const name of models.length ? models : [prefs.model]) { const option = document.createElement('option'); option.value = name; option.textContent = name || 'Choose a model'; option.selected = name === prefs.model; select.append(option); }
  }
  return {
    info,
    clearKeyField() { if (details) details.querySelector('#meta-ollama-key').value = ''; },
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    open() { if (details) { details.open = true; details.scrollIntoView({ block: 'nearest' }); details.querySelector('#meta-ollama-key').focus({ preventScroll: true }); } },
    mountMeta(dialog) {
      details = document.createElement('details'); details.id = 'meta-ollama'; details.className = 'meta-ollama'; details.setAttribute('data-moment-private', '');
      details.innerHTML = '<summary>Ollama connection</summary><form><label>Ollama API key<input id="meta-ollama-key" type="password" autocomplete="off" spellcheck="false" placeholder="Enter your Ollama Cloud key"></label><label>Model<select id="meta-ollama-model"></select></label><details class="meta-ollama-address"><summary>Relay address</summary><label>HTTPS relay<input id="meta-ollama-relay" type="url" autocomplete="off" spellcheck="false" placeholder="https://your-relay.onrender.com"></label></details><div class="meta-ollama-actions"><button id="meta-ollama-connect" class="quiet-button" type="submit">Connect for this session</button><button id="meta-ollama-disconnect" class="quiet-button" type="button" hidden>Disconnect</button></div><p id="meta-ollama-status" role="status">Connect Ollama to generate complete HTML experiences from your choices.</p><p>The key stays in relay memory for up to 30 minutes of inactivity. It is excluded from HTML, saved feedback and exports. This browser keeps only a temporary connection token.</p></form>';
      dialog.querySelector('.meta-system').after(details); form = details.querySelector('form');
      const address = details.querySelector('#meta-ollama-relay'); address.value = prefs.relayUrl;
      if (!prefs.relayUrl) details.querySelector('.meta-ollama-address').open = true;
      address.onchange = async () => { if (token) await disconnect(); prefs.relayUrl = address.value.trim(); savePrefs(); publish(); };
      renderModels(); details.querySelector('#meta-ollama-model').onchange = event => { prefs.model = event.target.value; savePrefs(); publish(); };
      details.querySelector('#meta-ollama-disconnect').onclick = disconnect;
      form.onsubmit = async event => {
        event.preventDefault(); if (pending) return; pending = true; controls(); show('Connecting to the Ollama relay…');
        prefs.relayUrl = address.value.trim(); savePrefs();
        try { await connect(details.querySelector('#meta-ollama-key').value); }
        catch (error) { show(error.message, true); }
        finally { pending = false; controls(); }
      };
      controls();
    },
    async generate(brief, { signal } = {}) {
      if (!info().connected) { token = ''; controls(); publish(); throw new Error('Connect Ollama in Meta first.'); }
      const controller = new AbortController(); activeController = controller;
      const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      try {
        const result = await request(connectedUrl, '/api/generate', { brief, model: prefs.model }, token, combined);
        if (combined.aborted) throw new Error('Generation canceled; your previous programs are kept.');
        if (!result.bundle) throw new Error('The relay did not return a code round.');
        expiresAt = result.expiresAt; controls(); publish(); return result.bundle;
      } finally { if (activeController === controller) activeController = null; }
    },
  };
}
