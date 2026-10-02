import { createFileRepository } from "./file-repository.js";
import { storageName } from "./environment.js";
import { createFileWorkspace } from "./file-workspace.js";
import { createMockDriveAdapter } from "./mock-drive.js";
import { createGoogleDriveAdapter } from "./drive-adapter.js";

const $ = (id) => document.getElementById(id);
const labels = { local: "Saved locally", pending: "Upload pending", synced: "Synced", conflict: "Both copies kept" };
const statusLabel = (row) => row?.conflict?.sourceUnavailable && !row.conflict.preservedCopy ? "Draft kept locally" : labels[row.status];
const fileIcon = '<svg viewBox="0 0 28 34" aria-hidden="true"><path d="M5 2h12l6 6v24H5Z M17 2v6h6 M10 16h8m-8 5h8m-8 5h5"/></svg>';
const isText = (row) => row.size <= 2 * 1024 * 1024 && (/^text\//.test(row.mimeType) || /(?:json|javascript|xml|svg)/.test(row.mimeType) || /\.(?:txt|md|csv|json|html|css|js|xml|svg)$/i.test(row.name));
const sizeLabel = (size) => size < 1024 ? `${size} bytes` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / (1024 * 1024)).toFixed(1)} MiB`;
const textBlob = (text, mimeType = "text/plain") => new Blob([text], { type: mimeType });

function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createFilesDemo({ notify = () => {} } = {}) {
  const storageMode = new URLSearchParams(location.search).get("storage");
  const live = storageMode === "drive" || (!storageMode && document.documentElement.dataset.driveDefault === "live");
  let repository, adapter, workspace, initialization;
  let liveConnected = false, liveConfigured = false, livePickerConfigured = false, liveUploadConfigured = false, driveFiles = [];
  let pickerFlow = null, pickerTimer = null, pickerEpoch = 0;
  let pickerFocusReturn = null;
  let record = null, visible = false, busy = false, dirtyTyping = false, blockedDraft = false;
  let draftTimer, draftQueue = Promise.resolve(), generation = 0, renderGeneration = 0;
  let walkthrough = null, guideOverride = null, failureArmed = false;
  const actionIds = ["files-walkthrough", "files-network", "files-external", "files-fail", "files-new", "files-import", "files-large", "files-save", "files-refresh", "files-export", "files-keep-both", "files-use-drive", "files-guide-action", "files-recover", "files-connect", "files-drive-refresh", "files-disconnect", "files-pick-drive"];

  function controls() {
    for (const id of actionIds) $(id).disabled = busy || !workspace;
    $("files-external").disabled = busy || !record?.remote;
    for (const id of ["files-save", "files-refresh", "files-export"])
      $(id).disabled = busy || !record || blockedDraft;
    $("files-refresh").disabled ||= !adapter?.online;
    $("files-fail").disabled ||= failureArmed || !adapter?.online;
    $("files-pick-drive").disabled ||= !liveConnected || !livePickerConfigured || !adapter?.online;
    $("files-keep-both").disabled ||= !(record?.conflict?.blob || record?.conflict?.preservedCopy || record?.conflict?.sourceUnavailable) || blockedDraft;
    $("files-use-drive").disabled ||= !record?.conflict?.blob || blockedDraft;
    $("files-editor").readOnly = busy;
    for (const button of $("files-list").querySelectorAll("button")) button.disabled = busy || blockedDraft;
    if (!busy && visible && pickerFocusReturn && !$("files-picker-dialog").open) {
      const target = pickerFocusReturn === "editor" && record && isText(record) ? $("files-editor") : $("files-pick-drive");
      pickerFocusReturn = null;
      if (!target.hidden && !target.disabled) target.focus();
    }
  }

  function guide(title, text, actionText = "", action = null) {
    $("files-guide-title").textContent = title;
    $("files-guide-text").textContent = text;
    $("files-guide-action").hidden = !action;
    $("files-guide-action").textContent = actionText;
    $("files-guide-action").onclick = action ? () => run(action) : null;
  }

  function renderGuide() {
    if (guideOverride) return guide(...guideOverride);
    if (blockedDraft) return guide("Your typing is safe on screen.", "Keep it as a new file before opening another file. You can also download the typing immediately.");
    if (live && !record) return guide(liveConnected ? "Open an original or create a local file." : "Your local files are available here.", liveConnected ? "Drive files available to MegaApp appear in the list. Opening downloads a working copy; later opens check its version." : "Create or import a file to work locally. A Drive connection requires the approved private server setup and a session you choose to connect.");
    if (!record) return guide("See what happens to a file.", "Start a walkthrough, or bring in a file of your own. The simulation never removes your work.");
    if (record.status === "conflict" && record.conflict?.sourceUnavailable)
      return guide("The Drive copy is unavailable.", record.conflict.preservedCopy ? "Your draft and its uploaded copy are kept. Keep both as separate files, or export all copies. Refresh can check whether the original becomes available again." : "Your draft is kept on this device. Keep it as a new file, or export it. Refresh can check whether the Drive copy becomes available again.");
    if (record.status === "conflict") return guide("Drive changed while you were working.", "Saving checked the latest version before uploading. Both copies are kept below; choose Keep both as files to continue without losing either.");
    if (live && (!adapter.online || record.error || record.status === "pending")) return guide("Your local copy is safe.", record.error || (liveConnected ? "The connection is unavailable. Keep working locally; reconnect your device, then save when you’re ready." : "Changes stay on this device. Connect the approved Drive session above when you’re ready to upload."), adapter.online ? "Try Save again" : "", adapter.online ? saveCurrent : null);
    if (walkthrough?.id === record.id) {
      if (walkthrough.step === "resolved") return guide("You kept both changes.", "The original now shows the other edit. Your own file is separate and safe. Export all copies to take this file and its earlier versions anywhere.", "Export all copies", exportCurrent);
      if (walkthrough.step === "external") return guide("The other device made a change.", "Your local draft has stayed untouched. Reconnect, then save. MegaApp will check Drive and ask you about the two versions.", adapter.online ? "Save and compare" : "Reconnect", adapter.online ? saveCurrent : toggleNetwork);
      if (!adapter.online && record.status === "pending") return guide("Your edit is saved here; the upload can wait.", "Now make a change from the other simulated device. This creates the situation where two people changed the same file.", "Change Drive copy", externalEdit);
      if (!adapter.online) return guide("The connection is off. Your file still opens.", "Add a line in the working copy, then press Save locally. Your typing is saved on this device first, and the upload will stay pending.", "Add an offline edit", async () => {
        $("files-editor").value += "\nMy offline idea: take the scenic route.\n";
        changed(); await persistDraft(); await saveCurrent();
      });
      if (walkthrough.step === "start" && record.status === "synced") return guide("A working copy here. An original in Drive.", "Open and refresh check the original. Try turning off the connection; your cached copy will still be here to edit.", "Try offline", toggleNetwork);
    }
    if (record.error) return guide("The local copy is safe.", record.error, adapter.online ? "Try Save again" : "Reconnect", adapter.online ? saveCurrent : toggleNetwork);
    if (record.status === "pending") return guide("Saved here, waiting to upload.", adapter.online ? "Press Save again to send the pending changes. The latest Drive version is checked first." : "Keep working offline. Reconnect and save when you’re ready.", adapter.online ? "Try Save again" : "Reconnect", adapter.online ? saveCurrent : toggleNetwork);
    if (record.status === "local") return guide("Your working copy is saved on this device.", "Save to Drive when you’re ready. If Drive changed since you opened the file, your edits and the changed original will both be kept.");
    return guide("The working copy matches Drive.", live ? "Opening and Refresh check the original. Saving checks again, keeps earlier versions, and uploads a new Drive copy." : "Try Go offline, or Change Drive copy and Refresh. Opening a file also refreshes its cached copy when connected.");
  }

  async function render({ replaceText = false } = {}) {
    if (!workspace) return;
    const ticket = ++renderGeneration, rows = await workspace.list();
    if (ticket !== renderGeneration) return;
    $("files-session-warning").hidden = repository.mode !== "memory";
    $("files-count").textContent = String(rows.length);
    $("files-list").replaceChildren();
    if (!rows.length) {
      const text = document.createElement("p"); text.className = "files-list-empty";
      text.textContent = "Your files will appear here. Start with a note or import a file.";
      $("files-list").append(text);
    }
    for (const row of rows) {
      const button = document.createElement("button"); button.className = "files-file-button";
      button.innerHTML = fileIcon; button.setAttribute("aria-current", String(row.id === record?.id));
      button.setAttribute("aria-label", `Open ${row.name}, ${statusLabel(row)}`);
      const name = document.createElement("strong"), detail = document.createElement("span");
      name.textContent = row.name; detail.textContent = `${statusLabel(row)} · ${sizeLabel(row.size)}`;
      detail.dataset.status = row.status; button.append(name, detail);
      button.onclick = () => run(async () => { await persistDraft(); await openFile(row.id); });
      $("files-list").append(button);
    }
    if (live) {
      for (const remote of driveFiles.filter((item) => !rows.some((row) => row.remote?.id === item.id))) {
        const button = document.createElement("button"); button.className = "files-file-button"; button.innerHTML = fileIcon;
        const name = document.createElement("strong"), detail = document.createElement("span");
        name.textContent = remote.name; detail.textContent = `In Drive · ${sizeLabel(Number(remote.size))}`;
        button.setAttribute("aria-label", `Open ${remote.name} from Drive`); button.append(name, detail);
        button.onclick = () => run(async () => { await persistDraft(); await openFile(remote.id); });
        $("files-list").append(button);
      }
      $("files-count").textContent = String(rows.length + driveFiles.filter((item) => !rows.some((row) => row.remote?.id === item.id)).length);
      $("files-connect").hidden = !liveConfigured || liveConnected;
      $("files-pick-drive").hidden = !liveConnected;
      $("files-drive-refresh").hidden = !liveConnected;
      $("files-disconnect").hidden = !liveConnected;
      $("files-picker-setup").hidden = !liveConnected || livePickerConfigured;
      $("files-upload-setup").hidden = !liveConnected || liveUploadConfigured;
      if (!record) $("files-drive-state").textContent = liveConnected ? "Connected" : "Not connected";
      $("files-live-title").textContent = liveConnected ? "Drive connected for this session" : liveConfigured ? "Choose when to connect Drive" : "Private Drive setup needed";
      $("files-live-detail").textContent = liveConnected ? (navigator.onLine ? "Only files available to MegaApp are shown. Access ends when this server session ends; no persistent Google access was requested." : "This device is offline. Keep working with local files; reconnect your device, then save or refresh.") : liveConfigured ? "Connect opens Google’s consent screen. It requests access to files you choose or create with MegaApp for this session." : "The approved OAuth application and private server credentials are not configured here. You can still create, edit, and export local files.";
    }
    $("files-network").textContent = adapter.online ? "Go offline" : "Reconnect";
    $("files-network").setAttribute("aria-pressed", String(!adapter.online));
    $("files-network-label").textContent = adapter.online ? "Simulated connection on" : "Simulated connection off";
    $("files-network-dot").dataset.online = String(adapter.online);
    $("files-bridge").dataset.online = String(adapter.online);
    $("files-fail").textContent = failureArmed ? "Next upload will fail" : "Fail next upload";
    $("files-empty").hidden = Boolean(record);
    $("files-editor-content").hidden = !record;
    if (record) {
      const remote = live ? (record.conflict?.metadata || driveFiles.find((item) => item.id === record.remote?.id) || record.remote) : record.remote ? await repository.getRemote(record.remote.id) : null;
      if (ticket !== renderGeneration) return;
      const localStatus = dirtyTyping ? "Saving your typing…" : statusLabel(record);
      $("files-device-state").textContent = localStatus;
      $("files-device-name").textContent = record.name;
      $("files-device-detail").textContent = `${sizeLabel(record.size)} · ${repository.mode === "memory" ? "This tab only" : "Saved in this browser"}`;
      $("files-device-explanation").textContent = record.status === "conflict" ? "Your edits are kept here while you choose between copies." : "Your working copy is available here, even offline.";
      $("files-drive-state").textContent = record.conflict?.sourceUnavailable ? "Original unavailable" : remote ? `${live && !adapter.online ? "Last checked v" : "Version "}${remote.version}` : "No copy yet";
      $("files-drive-name").textContent = remote?.name || "Your original";
      $("files-drive-detail").textContent = record.conflict?.sourceUnavailable ? "The previously linked Drive copy cannot be opened." : remote ? `${sizeLabel(live ? Number(remote.size) : remote.blob.size)} · ${live ? "Drive original" : "Simulated Drive original"}` : `Save to make a ${live ? "Drive" : "simulated Drive"} copy.`;
      $("files-drive-explanation").textContent = record.conflict?.sourceUnavailable ? (record.conflict.preservedCopy ? "The original cannot be opened. Your draft and uploaded copy are kept." : "The Drive copy cannot be opened. Your local draft is kept.") : record.status === "conflict" ? "This original changed. It has not been overwritten." : "Opening checks the original for changes. Saving checks again.";
      $("files-bridge").dataset.status = record.status;
      $("files-bridge-label").textContent = record.conflict?.sourceUnavailable ? "Draft kept here" : record.status === "synced" ? "Copies match" : record.status === "conflict" ? "Two changes kept" : record.status === "pending" ? "Upload waiting" : "Changes stay here";
      $("files-editor-name").textContent = record.name;
      $("files-editor-meta").textContent = `${sizeLabel(record.size)} · ${record.mimeType}`;
      $("files-status").textContent = statusLabel(record); $("files-status").dataset.status = record.status;
      $("files-save").textContent = live && liveConnected && !liveUploadConfigured ? "Save locally (Drive setup needed)" : adapter.online ? "Save to Drive" : "Save locally";
      $("files-draft-status").textContent = blockedDraft ? "Typing kept on screen. Choose how to preserve it below." : dirtyTyping ? "Saving your typing on this device…" : repository.mode === "memory" ? "Typing is kept in this tab. Export before closing." : record.error || (record.status === "pending" ? "Saved on this device. Upload pending." : "Typing saves on this device as you work.");
      $("files-draft-recovery").hidden = !blockedDraft;
      const editable = isText(record);
      $("files-editor").hidden = !editable; $("files-text-label").hidden = !editable;
      $("files-binary").hidden = editable; $("files-binary-name").textContent = record.name;
      if (replaceText && editable && !dirtyTyping) $("files-editor").value = await record.blob.text();
      $("files-conflict").hidden = record.status !== "conflict";
      if (record.status === "conflict") {
        const unavailableWithoutCopy = record.conflict?.sourceUnavailable && !record.conflict.preservedCopy;
        $("files-conflict").querySelector("h3").textContent = unavailableWithoutCopy ? "Drive copy unavailable. Draft kept." : record.conflict?.sourceUnavailable ? "Original unavailable. Copies kept." : "Two changes. Both kept.";
        $("files-conflict-description").textContent = unavailableWithoutCopy ? "The Drive copy cannot be opened. Your local draft is safe; keep it as a new file or export it to continue." : record.conflict?.sourceUnavailable ? "The original cannot be opened. Your local draft and its uploaded copy are kept; Keep both makes them separate files." : "Your working copy and the changed Drive original are safe. Compare them, then choose what to keep working on.";
        $("files-remote-heading").textContent = record.conflict?.sourceUnavailable ? "Unavailable Drive copy" : "Changed Drive copy";
        $("files-conflict").querySelector(".files-conflict-footnote").textContent = unavailableWithoutCopy ? "Keep your draft as a new file to continue. The unavailable Drive copy cannot be used." : record.conflict?.sourceUnavailable ? "The unavailable original cannot be used. Keep both saves your local draft and its uploaded copy as separate files." : "Use Drive copy also keeps your local draft in earlier copies and in your export.";
        $("files-keep-both").textContent = unavailableWithoutCopy ? "Keep my draft as new file" : "Keep both as files";
        $("files-local-preview").textContent = editable ? (await record.blob.text()).slice(0, 12000) : `${record.name}\n${sizeLabel(record.size)} · Original bytes preserved`;
        $("files-remote-preview").textContent = record.conflict?.blob ? (editable ? (await record.conflict.blob.text()).slice(0, 12000) : `${record.conflict.metadata.name}\n${sizeLabel(record.conflict.blob.size)} · Original bytes preserved`) : record.conflict?.sourceUnavailable ? (record.conflict.preservedCopy ? "The original is unavailable. Your draft and uploaded copy are preserved." : "The Drive copy is unavailable. Your local draft is preserved.") : "Reconnect and refresh to load the changed Drive copy.";
      }
      $("files-history-count").textContent = String(record.history.length);
      $("files-history-list").replaceChildren();
      for (const prior of [...record.history].reverse()) {
        const row = document.createElement("div"); row.className = "files-history-row";
        const description = document.createElement("span"), button = document.createElement("button");
        const kind = prior.kind === "drive-version" ? "Saved Drive copy" : prior.kind === "previous-cache" ? "Previous working copy" : prior.kind === "preserved-draft" ? "Your preserved draft" : "Preserved copy";
        description.textContent = `${kind}${prior.version ? `, version ${prior.version}` : ""} · ${sizeLabel(prior.blob.size)}`;
        button.className = "quiet-button"; button.textContent = "Download";
        button.onclick = () => download(prior.blob, prior.name);
        row.append(description, button); $("files-history-list").append(row);
      }
    }
    renderGuide(); controls();
  }

  function changed() {
    dirtyTyping = true; generation += 1; guideOverride = null;
    $("files-draft-status").textContent = "Saving your typing on this device…";
    clearTimeout(draftTimer);
    if (!blockedDraft) draftTimer = setTimeout(() => persistDraft().catch(report), 300);
  }

  function report(error) {
    notify(error.message || "The action could not finish. Your local files are kept.");
    guideOverride = ["The local files are kept.", error.message || "Try the action again."];
    renderGuide();
  }

  function persistDraft() {
    clearTimeout(draftTimer);
    draftQueue = draftQueue.catch(() => {}).then(async () => {
      if (!dirtyTyping || !record || !isText(record)) return;
      if (blockedDraft) throw new Error("Keep your typing as a new file before continuing.");
      const id = record.id, text = $("files-editor").value, savedGeneration = generation;
      try {
        record = await workspace.edit(id, textBlob(text, record.mimeType), { expectedRevision: record.revision });
        if (generation === savedGeneration) dirtyTyping = false;
      } catch (e) {
        if (e.code === "LOCAL_CONFLICT" && e.recovery) {
          record = e.recovery;
          if (generation === savedGeneration) dirtyTyping = false;
          walkthrough = null;
          guideOverride = ["This tab’s edit was kept as a new file.", "Another tab changed the original. Your typing is saved in this separate file, so neither tab overwrites the other."];
          notify("Another tab changed the file. Your typing was saved as a separate copy.");
        } else { blockedDraft = true; throw e; }
      } finally { await render(); }
    });
    return draftQueue;
  }

  async function openFile(id) {
    record = await workspace.open(id); dirtyTyping = false; blockedDraft = false; guideOverride = null;
    await render({ replaceText: true });
  }

  async function saveCurrent() {
    await persistDraft();
    record = await workspace.save(record.id);
    guideOverride = null;
    if (failureArmed && adapter.online) failureArmed = false;
    await render();
    if (live && record.status === "synced") await refreshDriveFiles();
    notify(record.status === "synced" ? `Saved on this device and ${live ? "Drive" : "simulated Drive"}.` : record.conflict?.sourceUnavailable && !record.conflict.preservedCopy ? "Drive copy unavailable. Your local draft is kept." : record.status === "conflict" ? "Drive changed. Both copies are kept." : "Saved on this device. Upload pending.");
  }

  async function exportCurrent() {
    await persistDraft(); const exported = await workspace.export(record.id);
    download(exported.blob, exported.name);
    notify("Exported the working copy, earlier copies, and any Drive conflict copy.");
  }

  async function toggleNetwork() {
    await persistDraft(); adapter.setOnline(!adapter.online); guideOverride = null;
    await render();
    notify(adapter.online ? "Simulated connection restored. Save or refresh when you’re ready." : "Simulated connection off. Your files are still here.");
  }

  async function externalEdit() {
    await persistDraft();
    const remote = await repository.getRemote(record.remote.id);
    let changedBlob;
    if (isText(record)) changedBlob = textBlob(`${await remote.blob.text()}\nAnother device’s idea: bring a picnic.\n`, remote.mimeType);
    else changedBlob = new Blob([remote.blob, "\nSimulated change from another device.\n"], { type: remote.mimeType });
    await adapter.externalEdit(remote.id, changedBlob);
    if (walkthrough?.id === record.id) walkthrough.step = "external";
    guideOverride = walkthrough?.id === record.id ? null : ["The simulated Drive original changed.", "Your working copy has stayed untouched. Open again or Refresh to check it. If you made local edits, both versions will be kept.", adapter.online ? "Refresh now" : "Reconnect", adapter.online ? refreshCurrent : toggleNetwork];
    await render();
    notify("The other simulated device changed Drive. Your local copy is untouched.");
  }

  async function refreshCurrent() {
    await persistDraft(); record = await workspace.refresh(record.id); guideOverride = null;
    await render({ replaceText: true });
    notify(record.status === "conflict" ? "Both changes are kept. Choose a copy below." : `Checked the ${live ? "Drive" : "simulated Drive"} original.`);
  }

  async function resolve(choice) {
    await persistDraft(); const draftOnly = record.conflict?.sourceUnavailable && !record.conflict.preservedCopy;
    record = await workspace.resolve(record.id, choice);
    if (walkthrough) walkthrough = { id: record.id, step: "resolved" };
    guideOverride = null; dirtyTyping = false;
    await render({ replaceText: true });
    notify(choice === "keep-both" ? (draftOnly ? "Your draft is now a separate file." : "Both changes are now separate files.") : "Using the Drive copy. Your local draft remains in earlier copies.");
  }

  async function newNote({ walkthrough: startWalkthrough = false } = {}) {
    await persistDraft();
    const count = (await workspace.list()).filter((row) => row.name.startsWith(startWalkthrough ? "Weekend plans" : "Untitled note")).length;
    const name = `${startWalkthrough ? "Weekend plans" : "Untitled note"}${count ? ` ${count + 1}` : ""}.txt`;
    record = await workspace.create({ name, mimeType: "text/plain", blob: textBlob(startWalkthrough ? "Weekend plans\n\nSaturday: a walk along the water.\nSunday: make something just for fun.\n" : "") });
    dirtyTyping = false; blockedDraft = false; guideOverride = null;
    if (startWalkthrough) {
      adapter.setOnline(true); record = await workspace.save(record.id);
      failureArmed = false; walkthrough = { id: record.id, step: "start" };
    } else walkthrough = null;
    await render({ replaceText: true });
    $("files-editor").focus();
  }

  async function run(action) {
    if (busy) return;
    busy = true; controls();
    try { await initialize(); await action(); }
    catch (e) { report(e); }
    finally { busy = false; controls(); }
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      repository = await createFileRepository({ name: storageName(live ? "megaapp-live-drive-files-v1" : "megaapp-files-v1") });
      adapter = live ? createGoogleDriveAdapter({ isOnline: () => liveConnected && navigator.onLine }) : createMockDriveAdapter(repository);
      workspace = createFileWorkspace({ repository, adapter });
      if (live) {
        $("files-walkthrough").hidden = true;
        $("files-large").hidden = true;
        $("files-live-connection").hidden = false;
        $("panel-files").querySelector(".files-demo-controls").hidden = true;
        $("panel-files").querySelector(".files-simulation-note").hidden = true;
        $("files-library-note").textContent = "Originals and local drafts stay separate from ordinary State values.";
        $("files-drive-state").textContent = "Not connected";
        $("files-guide-text").textContent = "Create or import a file to work locally. Connect Drive after the private server setup is approved.";
        await checkLiveSession();
      }
      await render();
    })();
    return initialization;
  }

  async function checkLiveSession() {
    try {
      const session = await adapter.session();
      liveConfigured = Boolean(session.configured); liveConnected = Boolean(session.connected);
      livePickerConfigured = Boolean(session.pickerConfigured); liveUploadConfigured = Boolean(session.uploadConfigured);
      if (liveConnected) driveFiles = await adapter.list();
    } catch {
      liveConfigured = false; liveConnected = false; livePickerConfigured = false; liveUploadConfigured = false;
    }
  }

  async function refreshDriveFiles() {
    await persistDraft(); await checkLiveSession();
    await render();
  }

  function releasePicker({ focusEditor = false } = {}) {
    const previous = pickerFlow; pickerFlow = null; pickerEpoch += 1;
    clearTimeout(pickerTimer); pickerTimer = null; previous?.controller.abort();
    $("files-picker-open").removeAttribute("href");
    $("files-picker-open").setAttribute("aria-disabled", "true");
    if ($("files-picker-dialog").open) $("files-picker-dialog").close();
    if (previous) pickerFocusReturn = focusEditor ? "editor" : "launcher";
    controls();
    return previous;
  }

  async function cancelPicker({ silent = false } = {}) {
    const previous = releasePicker();
    if (previous) await adapter.cancelPicker(previous.nonce).catch(() => {});
    if (!silent) {
      guideOverride = ["File selection cancelled.", "Your open file and typing are unchanged. Open the chooser again whenever you’re ready."];
      await render(); notify("File selection cancelled. Your open file is unchanged.");
    }
  }

  function pickerFailed() {
    const previous = releasePicker();
    if (previous) adapter.cancelPicker(previous.nonce).catch(() => {});
    guideOverride = ["The file chooser could not finish.", "Your open file and local drafts are unchanged. Open the chooser again to try another selection."];
    render().catch(report); notify("The file chooser could not finish. Your open file is unchanged.");
  }

  async function pollPicker(flow) {
    if (pickerFlow !== flow) return;
    if (Date.now() - flow.started > 5 * 60 * 1000) { pickerFailed(); return; }
    try {
      const result = await adapter.pickerResult(flow.nonce, { signal: flow.controller.signal });
      if (pickerFlow !== flow) return;
      if (result.state === "pending") { pickerTimer = setTimeout(() => pollPicker(flow), 800); return; }
      if (result.state === "cancelled") { await cancelPicker(); return; }
      if (result.state !== "picked") { pickerFailed(); return; }
      if (busy) { pickerTimer = setTimeout(() => pollPicker(flow), 100); return; }
      $("files-picker-status").textContent = "Opening your chosen file…";
      await run(async () => {
        try {
          await persistDraft();
          const selected = await workspace.open(result.files[0].id);
          // Cancel/reopen may happen while the selected file downloads. A late
          // result can never replace the current working copy.
          if (pickerFlow !== flow) return;
          record = selected; dirtyTyping = false; blockedDraft = false; walkthrough = null; guideOverride = null;
          releasePicker({ focusEditor: true }); await render({ replaceText: true });
          notify("Opened your chosen Drive file. A working copy is saved on this device.");
        } catch { if (pickerFlow === flow) pickerFailed(); }
      });
    } catch {
      if (pickerFlow === flow) pickerFailed();
    }
  }

  async function startPicker() {
    await persistDraft();
    if (!live || !liveConnected || !livePickerConfigured) throw new Error("Choosing existing Drive files needs the approved Picker setup and a connected session first.");
    await cancelPicker({ silent: true });
    const prepared = await adapter.startPicker();
    pickerFlow = { nonce: prepared.nonce, epoch: ++pickerEpoch, controller: new AbortController(), opened: false, started: Date.now() };
    $("files-picker-status").textContent = "The chooser is ready. Open Google’s separate window, select one file, then return here.";
    $("files-picker-open").href = prepared.bridgeUrl;
    $("files-picker-open").setAttribute("aria-disabled", "false");
    $("files-picker-dialog").showModal();
  }

  $("files-editor").addEventListener("input", changed);
  $("files-walkthrough").onclick = () => run(() => newNote({ walkthrough: true }));
  $("files-new").onclick = () => run(() => newNote());
  $("files-network").onclick = () => run(toggleNetwork);
  $("files-external").onclick = () => run(externalEdit);
  $("files-save").onclick = () => run(saveCurrent);
  $("files-refresh").onclick = () => run(refreshCurrent);
  $("files-export").onclick = () => run(exportCurrent);
  $("files-keep-both").onclick = () => run(() => resolve("keep-both"));
  $("files-use-drive").onclick = () => run(() => resolve("use-remote"));
  $("files-drive-refresh").onclick = () => run(refreshDriveFiles);
  $("files-pick-drive").onclick = () => run(startPicker);
  $("files-picker-open").onclick = (event) => {
    const flow = pickerFlow;
    if (!flow || flow.opened) { event.preventDefault(); return; }
    flow.opened = true; $("files-picker-open").setAttribute("aria-disabled", "true");
    $("files-picker-status").textContent = "Choose a file in Google’s window. MegaApp is waiting here; Cancel keeps your open file unchanged.";
    pollPicker(flow);
  };
  $("files-picker-cancel").onclick = () => cancelPicker().catch(report);
  $("files-picker-dialog").addEventListener("cancel", (event) => { event.preventDefault(); cancelPicker().catch(report); });
  $("files-disconnect").onclick = () => run(async () => {
    await persistDraft(); await cancelPicker({ silent: true }); await adapter.disconnect(); liveConnected = false; driveFiles = [];
    guideOverride = ["Drive access ended for this session.", "Your local files and drafts are still here. Connect another session when you want to save or refresh Drive again."];
    await render(); notify("Drive session ended. Local files are kept.");
  });
  $("files-connect").onclick = () => run(async () => {
    await persistDraft();
    if (!liveConfigured) throw new Error("The private Drive setup needs approval and configuration first.");
    const result = await adapter.connect(), authorization = new URL(result.authorizationUrl);
    if (authorization.protocol !== "https:" || authorization.hostname !== "accounts.google.com") throw new Error("The Drive connection returned an unexpected authorization address.");
    location.assign(authorization.href);
  });
  $("files-fail").onclick = () => run(async () => {
    await persistDraft(); adapter.failNext(); failureArmed = true;
    guideOverride = ["The next upload will be interrupted.", "Edit a file, then save. The local draft stays safe, and Save can retry the upload."];
    await render();
  });
  $("files-import").onclick = () => $("files-import-input").click();
  $("files-import-input").onchange = () => {
    const file = $("files-import-input").files[0]; $("files-import-input").value = "";
    if (file) run(async () => {
      await persistDraft(); record = await workspace.create({ name: file.name, mimeType: file.type, blob: file });
      dirtyTyping = false; blockedDraft = false; walkthrough = null; guideOverride = null;
      await render({ replaceText: true }); notify("Imported a separate local copy. The original file is unchanged.");
    });
  };
  $("files-large").onclick = () => run(async () => {
    await persistDraft();
    const block = new Uint8Array(1024 * 1024); for (let i = 0; i < block.length; i += 1) block[i] = i % 251;
    record = await workspace.create({ name: `Large sample ${new Date().toISOString().replace(/[:.]/g, "-")}.bin`, mimeType: "application/octet-stream", blob: new Blob(Array(12).fill(block), { type: "application/octet-stream" }) });
    dirtyTyping = false; blockedDraft = false; walkthrough = null;
    guideOverride = ["A large file stays out of ordinary State values.", "This 12 MiB sample is kept as its original bytes. Save to make a simulated Drive original, then export all copies to take it with you."];
    await render({ replaceText: true });
  });
  $("files-recover").onclick = () => run(async () => {
    const blob = textBlob($("files-editor").value, record.mimeType);
    record = await workspace.create({ name: `Recovered ${record.name}`.slice(0, 180), mimeType: record.mimeType, blob });
    blockedDraft = false; dirtyTyping = false; walkthrough = null;
    guideOverride = ["Your typing was kept as a new file.", "The previous file is unchanged. Save this separate copy to Drive when you’re ready."];
    await render({ replaceText: true });
  });
  $("files-download-typing").onclick = () => download(textBlob($("files-editor").value, record.mimeType), `Unsaved ${record.name}`);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && dirtyTyping && !blockedDraft) persistDraft().catch(report);
  });
  window.addEventListener("pagehide", () => {
    if (pickerFlow) releasePicker();
    if (dirtyTyping && !blockedDraft) persistDraft().catch(() => {});
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirtyTyping || blockedDraft) {
      event.preventDefault(); event.returnValue = "";
    }
  });
  for (const event of ["online", "offline"]) window.addEventListener(event, () => {
    if (live && workspace) render().catch(report);
  });
  $("files-editor").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault(); run(saveCurrent);
    }
  });
  controls();
  return {
    setVisible(value) {
      visible = Boolean(value);
      if (visible) initialize().catch(report);
      else {
        if (pickerFlow) cancelPicker({ silent: true }).catch(() => {});
        if (dirtyTyping && !blockedDraft) persistDraft().catch(report);
      }
    },
  };
}
