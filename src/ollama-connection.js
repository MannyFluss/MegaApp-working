import { temporaryStateBlock, OLLAMA_STATE, OLLAMA_KEY } from './state-block.js';
import { generateWithOllama, boundedResponse } from './taste-generation.js';

export function validateOllamaSettings(value) {
  if (!value || value.version !== 1 || !['cloud', 'server'].includes(value.provider) || typeof value.model !== 'string' || !/^[\w.:/-]{1,120}$/.test(value.model)) throw new Error('Choose an Ollama provider and model.');
  const url = new URL(value.provider === 'cloud' ? 'https://ollama.com' : value.url);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS Ollama server address, or localhost on this device.');
  return { version: 1, provider: value.provider, model: value.model, url: url.origin, ...(value.check ? { check: value.check } : {}) };
}
export function ollamaRequestAddress(settings, path, location = globalThis.location) {
  const localPreview = location && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (localPreview && (settings.provider === 'cloud' || settings.url === 'http://127.0.0.1:11434' || settings.url === 'http://localhost:11434')) return new URL('/api/ollama/' + (settings.provider === 'cloud' ? '' : 'local/') + path, location.href).href;
  return new URL('/api/' + path, settings.url).href;
}
const DEFAULTS = { version: 1, provider: 'cloud', model: 'gemma4:31b', url: 'https://ollama.com' };
export function createOllamaConnection({ stateReady = temporaryStateBlock(), fetchImpl = fetch } = {}) {
  let state, details, pending = false, activeController;
  const subscribers = new Set();
  const settings = () => { try { return validateOllamaSettings(state?.read(OLLAMA_STATE) || DEFAULTS); } catch { return null; } };
  const credential = config => { const saved = state?.readPrivate(OLLAMA_KEY); return saved?.origin === config?.url ? saved.key : undefined; };
  function info() {
    const config = settings();
    return { connected: !!state && !!config && (config.provider === 'server' || !!credential(config)), model: config?.model || '', provider: config?.provider || '', keySet: !!state?.hasPrivate(OLLAMA_KEY), status: config?.check?.status || 'untested' };
  }
  function publish() { for (const callback of subscribers) callback(info()); }
  function show(message, failed = false) { if (!details) return; const node = details.querySelector('#meta-ollama-status'); node.textContent = message; node.dataset.error = String(failed); }
  function controls() {
    if (!details) return;
    for (const node of details.querySelectorAll('button,input,select')) node.disabled = !state || pending;
    details.querySelector('#meta-ollama-remove-key').hidden = !info().keySet;
    details.querySelector('#meta-ollama-key').placeholder = info().keySet ? 'Leave blank to keep the saved key' : 'Enter your Ollama API key';
    details.querySelector('#meta-ollama-key-state').textContent = info().keySet ? (state.privateDurable ? 'Key saved privately on this device.' : 'Key set for this session; durable private storage is unavailable.') : 'No API key is set.';
    details.querySelector('#meta-ollama-server-label').hidden = details.querySelector('#meta-ollama-provider').value !== 'server';
  }
  function fillSettings() {
    if (!state || !details) return;
    const config = settings() || DEFAULTS;
    details.querySelector('#meta-ollama-provider').value = config.provider;
    details.querySelector('#meta-ollama-model').value = config.model;
    details.querySelector('#meta-ollama-server').value = config.provider === 'server' ? config.url : 'http://127.0.0.1:11434';
    controls();
  }
  const ready = Promise.resolve(stateReady).then(value => {
    state = value;
    state.subscribe(names => { if (names.some(name => name === OLLAMA_STATE || name === OLLAMA_KEY)) { activeController?.abort(); if (!pending && !details?.closest('dialog')?.open) fillSettings(); controls(); publish(); } });
    controls(); publish(); return state;
  });
  ready.catch(() => show('State could not open. The key has not been saved.', true));
  async function save({ provider, model, url, apiKey = '' }) {
    await ready;
    const config = validateOllamaSettings({ version: 1, provider, model: model.trim(), url: url.trim() });
    const newKey = apiKey.trim(), saved = state.readPrivate(OLLAMA_KEY);
    if (config.provider === 'cloud' && !newKey && saved?.origin !== config.url) throw new Error('Enter your Ollama Cloud API key.');
    const values = [{ name: OLLAMA_STATE, value: config }];
    if (newKey) values.push({ name: OLLAMA_KEY, value: { key: newKey, origin: config.url } });
    await state.writeMany(values);
    if (details) details.querySelector('#meta-ollama-key').value = '';
    show('Connection saved in State. Generate three uses these settings.');
    controls(); publish();
  }
  function connectionError(config) {
    return config.provider === 'cloud' && !['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname)
      ? 'Your key is saved. Ollama Cloud blocks direct requests from this website. Cloud generation works in the local MegaApp preview; a browser-accessible Ollama server can be used here.'
      : 'Ollama could not be reached. Check the server address and whether it allows requests from this app.';
  }
  async function testConnection() {
    await ready; const config = settings(); if (!config || !info().connected) throw new Error('Save a valid Ollama connection first.');
    let response;
    try { response = await fetchImpl(ollamaRequestAddress(config, 'tags'), { headers: credential(config) ? { Authorization: 'Bearer ' + credential(config) } : {}, signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error(connectionError(config)); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(response.status === 401 || response.status === 403 ? 'Ollama rejected access. Check the key or server permissions.' : 'Ollama could not list its models.'); }
    const result = await boundedResponse(response);
    if (!Array.isArray(result.models)) throw new Error('That address did not return an Ollama model list.');
    // Reachability does not prove that a model or key is accepted for inference.
    await state.write(OLLAMA_STATE, { ...config, check: { status: 'reachable', at: new Date().toISOString() } });
    show('Ollama is reachable. Generation checks the selected model and key.');
    return result.models.map(model => model.name).filter(name => typeof name === 'string');
  }
  return {
    ready, info, save, testConnection,
    async removeKey() { await ready; await state.remove(OLLAMA_KEY); if (details) details.querySelector('#meta-ollama-key').value = ''; show('API key removed from State.'); },
    clearKeyField() { if (details) details.querySelector('#meta-ollama-key').value = ''; },
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    open() { if (details) { fillSettings(); details.open = true; details.scrollIntoView({ block: 'nearest' }); details.querySelector('#meta-ollama-key').focus({ preventScroll: true }); } },
    mountMeta(dialog) {
      details = document.createElement('details'); details.id = 'meta-ollama'; details.className = 'meta-ollama'; details.setAttribute('data-moment-private', '');
      details.innerHTML = '<summary>Ollama connection</summary><form><label>Use<select id="meta-ollama-provider"><option value="cloud">Ollama Cloud</option><option value="server">My Ollama server</option></select></label><label id="meta-ollama-server-label" hidden>Server address<input id="meta-ollama-server" type="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://your-ollama-server"></label><label>Model<input id="meta-ollama-model" type="text" autocomplete="off" autocapitalize="none" spellcheck="false"></label><label>API key<input id="meta-ollama-key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"></label><p id="meta-ollama-key-state"></p><div class="meta-ollama-actions"><button id="meta-ollama-save" class="quiet-button" type="submit">Save connection</button><button id="meta-ollama-test" class="quiet-button" type="button">Test connection</button><button id="meta-ollama-remove-key" class="quiet-button" type="button" hidden>Remove key</button></div><p id="meta-ollama-status" role="status">Set the connection here; inspect its settings and Feeling workspace in State.</p><p>Private keys are excluded from State exports, shared feedback and moment capture. Cloud generation runs in the local preview; this published app needs a browser-accessible Ollama server.</p></form>';
      dialog.querySelector('.meta-system').after(details);
      details.addEventListener('toggle', () => { if (details.open && !pending) fillSettings(); });
      ready.then(fillSettings).catch(() => {});
      details.querySelector('#meta-ollama-provider').onchange = event => { const model = details.querySelector('#meta-ollama-model'); if (['gemma4:31b','gemma4:cloud',''].includes(model.value)) model.value = event.target.value === 'server' ? 'gemma4:cloud' : 'gemma4:31b'; controls(); };
      const perform = action => async event => { event?.preventDefault(); if (pending) return; pending = true; controls(); try { await action(); } catch (error) { show(error.message, true); } finally { pending = false; controls(); } };
      details.querySelector('form').onsubmit = perform(() => save({ provider: details.querySelector('#meta-ollama-provider').value, model: details.querySelector('#meta-ollama-model').value, url: details.querySelector('#meta-ollama-server').value, apiKey: details.querySelector('#meta-ollama-key').value }));
      details.querySelector('#meta-ollama-test').onclick = perform(testConnection);
      details.querySelector('#meta-ollama-remove-key').onclick = perform(() => this.removeKey());
      controls();
    },
    async generate(brief, { signal } = {}) {
      await ready; const config = settings(); if (!config || !info().connected) throw new Error('Set Ollama in Meta first.');
      const controller = new AbortController(); activeController = controller;
      try {
        return await generateWithOllama({ brief, model: config.model, endpoint: ollamaRequestAddress(config, 'chat'), apiKey: credential(config), fetchImpl, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      } catch (error) { if (error.message === 'Ollama could not be reached.') throw new Error(connectionError(config)); throw error; }
      finally { if (activeController === controller) activeController = null; }
    },
  };
}
