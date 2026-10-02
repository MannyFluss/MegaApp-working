// Runs only in the isolated Picker bridge, never in the main workspace.
// https://developers.google.com/workspace/drive/picker/guides/web-picker
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const failure = "The file chooser could not finish. Return to MegaApp and try again; your local files are kept.";

function safeFiles(value) {
  if (!Array.isArray(value) || value.length !== 1) throw new Error("Invalid selection");
  return value.map((file) => {
    if (!file || !validId(file.id) || typeof file.name !== "string" || file.name.length > 1000 ||
      typeof file.mimeType !== "string" || file.mimeType.length > 200 || /^application\/vnd\.google-apps\./.test(file.mimeType) ||
      !(typeof file.size === "number" || (typeof file.size === "string" && /^\d+$/.test(file.size))) ||
      !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 0 || Number(file.size) > 512 * 1024 * 1024) throw new Error("Invalid selection");
    const safe = { id: file.id, name: file.name, mimeType: file.mimeType, size: Number(file.size) };
    if (typeof file.version === "string" && /^\d{1,40}$/.test(file.version)) safe.version = file.version;
    return safe;
  });
}

export function createDrivePickerController({ config, createPicker, submitSelection, cancelSelection = async () => {}, onStatus = () => {} }) {
  let credentials = config, picker = null, started = false, settling = false, terminal = null, disposed = false;
  // Release the controller's reference. Credentials only reach Google's Picker
  // constructor and are never included in results, errors, DOM, or storage.
  config = null;
  function cleanPicker() {
    credentials = null;
    if (!picker) return;
    const current = picker; picker = null;
    try { current.setVisible(false); } catch {}
    try { current.dispose?.(); } catch {}
  }
  function settle(result) {
    if (terminal || disposed) return terminal;
    terminal = result; cleanPicker();
    try { onStatus(result); } catch {}
    return result;
  }
  async function cancel() {
    if (settling || terminal || disposed) return terminal;
    settling = true;
    try { await cancelSelection(); }
    catch { return settle({ state: "failed", message: failure }); }
    return settle({ state: "cancelled" });
  }
  async function handleSelection(data) {
    if (settling || terminal || disposed) return terminal;
    if (data?.action === "loaded") return null;
    if (data?.action === "cancel") return cancel();
    settling = true;
    try {
      if (data?.action !== "picked" || !Array.isArray(data.docs) || data.docs.length !== 1 || !validId(data.docs[0]?.id))
        throw new Error("Invalid selection");
      if (/^application\/vnd\.google-apps\./.test(data.docs[0].mimeType || ""))
        throw new Error("Native documents need export support");
      const verified = await submitSelection([data.docs[0].id]);
      return settle({ state: "picked", files: safeFiles(verified.files) });
    } catch { return settle({ state: "failed", message: failure }); }
  }
  return {
    async start() {
      if (started || terminal || disposed) return terminal;
      started = true;
      try {
        const origin = new URL(credentials?.origin);
        if (!credentials || typeof credentials.accessToken !== "string" || !credentials.accessToken ||
          typeof credentials.developerKey !== "string" || !credentials.developerKey || !/^\d+$/.test(credentials.appId) ||
          origin.origin !== credentials.origin || !(origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))))
          throw new Error("Invalid setup");
        picker = await createPicker({ oauthToken: credentials.accessToken, developerKey: credentials.developerKey,
          appId: credentials.appId, origin: credentials.origin, onSelection: handleSelection });
        credentials = null;
        if (terminal || disposed) { cleanPicker(); return terminal; }
        picker.setVisible(true);
        return { state: "open" };
      } catch { return settle({ state: "failed", message: failure }); }
    },
    handleSelection,
    cancel,
    dispose() { if (!disposed) { disposed = true; cleanPicker(); } },
  };
}

export function createGooglePickerFactory(google) {
  return ({ oauthToken, developerKey, appId, origin, onSelection }) => {
    const api = google.picker;
    // List mode avoids thumbnail requests requiring broader Drive scopes.
    const view = new api.DocsView(api.ViewId.DOCS).setMode(api.DocsViewMode.LIST)
      .setIncludeFolders(false).setSelectFolderEnabled(false);
    return new api.PickerBuilder().addView(view).setOAuthToken(oauthToken).setDeveloperKey(developerKey)
      .setAppId(appId).setOrigin(origin).setTitle("Choose one file for MegaApp")
      .setCallback(onSelection).build();
  };
}
