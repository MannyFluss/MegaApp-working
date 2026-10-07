// Connection authority belongs to the shared singleton state block.
// Until its interface is available this view owns no configuration or session.
export function createOllamaConnection() {
  let details;
  return {
    info: () => ({ connected: false, model: '' }),
    clearKeyField() {},
    subscribe() { return () => {}; },
    open() { if (details) { details.open = true; details.scrollIntoView({ block: 'nearest' }); details.querySelector('summary').focus({ preventScroll: true }); } },
    mountMeta(dialog) {
      details = document.createElement('details'); details.id = 'meta-ollama'; details.className = 'meta-ollama';
      details.innerHTML = '<summary>Ollama connection</summary><p id="meta-ollama-status" role="status">Ollama setup is being moved into the shared State block. Browser generation is not connected yet.</p>';
      dialog.querySelector('.meta-system').after(details);
    },
    async generate() { throw new Error('Ollama setup is waiting for the shared State block. Your current programs are kept.'); },
  };
}
