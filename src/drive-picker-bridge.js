import { createDrivePickerController, createGooglePickerFactory } from "./drive-picker.js";

// This entry point is used only by the broker's restricted, uncached page.
// No opener/postMessage: the workspace receives the server's safe result.
const status = document.getElementById("picker-status"), cancelButton = document.getElementById("picker-cancel"), closeButton = document.getElementById("picker-close");
const nonce = new URLSearchParams(location.search).get("nonce");
let csrf, controller = null, completed = false;
const setStatus = (text) => { if (status) status.textContent = text; };

async function post(path, value, { keepalive = false } = {}) {
  const response = await fetch(`/api/drive/picker/${path}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", keepalive,
    headers: { "Content-Type": "application/json", "X-MegaApp-CSRF": csrf }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error("The chooser could not finish.");
  return response.json();
}

function loadGooglePicker() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://apis.google.com/js/api.js"; script.async = true;
    const timeout = setTimeout(() => reject(new Error("The chooser could not load.")), 20000);
    script.onerror = () => { clearTimeout(timeout); reject(new Error("The chooser could not load.")); };
    script.onload = () => {
      try {
        globalThis.gapi.load("picker", { callback: () => { clearTimeout(timeout); resolve(); },
          onerror: () => { clearTimeout(timeout); reject(new Error("The chooser could not load.")); } });
      } catch { clearTimeout(timeout); reject(new Error("The chooser could not load.")); }
    };
    document.head.append(script);
  });
}

async function initialize() {
  if (!nonce || !/^[A-Za-z0-9_-]{16,200}$/.test(nonce)) throw new Error("Invalid chooser session.");
  setStatus("Preparing Google’s file chooser…");
  // CSRF is safe to obtain before loading Google. A Cancel during a slow
  // library download can end the broker flow without ever requesting a token.
  const sessionResponse = await fetch("/api/drive/session", { credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (!sessionResponse.ok) throw new Error("A connected session is required.");
  const session = await sessionResponse.json(); csrf = session.csrf;
  if (completed) { await post("cancel", { nonce }).catch(() => {}); return; }
  // Load Google's code before handing out an ephemeral token, keeping a failed
  // script download from leaving a token in an unused bridge session.
  await loadGooglePicker();
  if (completed) return;
  let config = await post("bootstrap", { nonce });
  if (completed) { config = null; await post("cancel", { nonce }).catch(() => {}); return; }
  if (config.origin !== location.origin) throw new Error("The chooser origin is invalid.");
  controller = createDrivePickerController({ config, createPicker: createGooglePickerFactory(globalThis.google),
    submitSelection: (ids) => post("selection", { nonce, ids }),
    cancelSelection: () => post("cancel", { nonce }),
    onStatus(result) {
        completed = true; if (cancelButton) cancelButton.disabled = true; if (closeButton) closeButton.hidden = false;
        setStatus(result.state === "picked" ? "File selected. Return to MegaApp; your working copy will open there." : result.state === "cancelled" ? "Selection cancelled. Your local files are unchanged. You can close this window." : "The chooser could not finish. Return to MegaApp and try again; your local files are kept.");
        if (result.state === "failed") post("cancel", { nonce }).catch(() => {});
    },
  });
  config = null;
  if (completed) { controller.dispose(); return; }
  const result = await controller.start();
  if (result?.state === "open" && !completed) setStatus("Choose one uploaded file. Google Docs, Sheets, and Slides need export support first.");
}

if (cancelButton) cancelButton.onclick = () => {
  completed = true; cancelButton.disabled = true; if (closeButton) closeButton.hidden = false;
  if (controller) controller.cancel();
  else { if (csrf) post("cancel", { nonce }).catch(() => {}); setStatus("Selection cancelled. You can close this window."); }
};
if (closeButton) closeButton.onclick = () => window.close();
window.addEventListener("pagehide", () => {
  controller?.dispose();
  if (!completed && csrf && nonce) post("cancel", { nonce }, { keepalive: true }).catch(() => {});
  csrf = null;
});
initialize().catch(() => {
  controller?.dispose(); completed = true;
  setStatus("The chooser could not open. Return to MegaApp and try again; your local files are kept.");
  if (csrf && nonce) post("cancel", { nonce }).catch(() => {});
});
