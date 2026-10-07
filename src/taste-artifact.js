// Code runs in an opaque-origin frame; it receives no parent capabilities.
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export function createTasteArtifact(frame, artifact, { onIssue } = {}) {
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'");
  frame.title ||= 'Runnable HTML feeling candidate';
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const bridge = `<script>addEventListener('error',e=>parent.postMessage({type:'megaapp-html-issue',token:'${token}',message:String(e.message||'The artifact reported an error.').slice(0,600)},'*'));addEventListener('unhandledrejection',e=>parent.postMessage({type:'megaapp-html-issue',token:'${token}',message:String(e.reason&&e.reason.message||e.reason||'An artifact operation failed.').slice(0,600)},'*'));<\/script>`;
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1">${bridge}${artifact.html}`;
  let active = false, issues = [], lastIssue = 0;
  const report = event => {
    if (!active || event.source !== frame.contentWindow || event.data?.type !== 'megaapp-html-issue' || event.data.token !== token || typeof event.data.message !== 'string') return;
    if (performance.now() - lastIssue < 250) return; lastIssue = performance.now();
    const message = event.data.message.slice(0, 600); issues = [...issues.slice(-4), message]; onIssue?.(message);
  };
  window.addEventListener('message', report);
  return {
    setVisible(value) {
      if (active === value) return;
      active = value; frame.dataset.running = String(value);
      if (value) { issues = []; lastIssue = -1000; onIssue?.(null); }
      frame.srcdoc = value ? html : '';
    },
    observation: () => null,
    diagnostics: () => [...issues],
    configure() {},
    dispose() { active = false; frame.srcdoc = ''; frame.dataset.running = 'false'; window.removeEventListener('message', report); },
  };
}
