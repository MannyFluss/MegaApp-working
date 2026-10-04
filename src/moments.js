import { createMomentBuffer, createMomentStore, selectMoment, momentMarkdown } from "./moment-record.js";
import { mountMomentReplay, momentReplayHTML } from "./moment-replay.js";
import { createPortableZip } from "./file-export.js";
import { storageName } from "./environment.js";

export function createMoments({ getApp, getDesignContext, closeMeta, notify, onOpenChange = () => {} }) {
  const buffer = createMomentBuffer(), pauseKey = storageName("megaapp.moments.paused.v1");
  try { buffer.setPaused(localStorage.getItem(pauseKey) === "true"); } catch { /* Session preference still works. */ }
  const storeReady = createMomentStore({ name: storageName("megaapp-moments-v1") });
  const deleted = new Set();
  let draft, replay, priorFocus, capturing = false, longRecording = false, saveChain = Promise.resolve(), voice, voiceStream, audio, timer, saveTimer, saveGeneration = 0;
  const system = document.createElement("section"); system.className = "moment-system"; system.dataset.momentPrivate = "";
  system.innerHTML = `<div class="moment-system-heading"><strong>Moments</strong><span id="moment-record-status"></span></div><p>Recent interactions stay on this device. Keep a moment to review and export it.</p><div class="moment-system-actions"><button id="moment-pause" class="quiet-button" type="button"></button><button id="moment-long" class="quiet-button" type="button">Start longer recording</button><button id="moment-library" class="quiet-button" type="button">Saved moments</button></div>`;
  document.querySelector(".meta-system").append(system);
  const keepButton = document.createElement("button"); keepButton.id = "moment-keep"; keepButton.type = "button"; keepButton.className = "moment-keep quiet-button"; keepButton.textContent = "Keep moment"; keepButton.dataset.momentPrivate = ""; document.querySelector(".app-shell").append(keepButton);
  const dialog = document.createElement("dialog"); dialog.id = "moment-dialog"; dialog.className = "moment-dialog"; dialog.dataset.momentPrivate = ""; dialog.setAttribute("aria-labelledby", "moment-title");
  dialog.innerHTML = `<header class="moment-heading"><div><h1 id="moment-title">My moment.</h1><p id="moment-description"></p></div><button id="moment-close" class="quiet-button" type="button">Close</button></header><div id="moment-review"><label class="moment-note-label" for="moment-note">What was happening for me?</label><textarea id="moment-note" rows="3" maxlength="12000" placeholder="What I wanted, noticed, or felt. My explanation goes beside the recorded evidence."></textarea><div class="moment-voice"><button id="moment-voice" class="quiet-button" type="button">Add voice note</button><button id="moment-voice-remove" class="quiet-button" type="button" hidden>Remove voice note</button><audio id="moment-audio" controls hidden></audio><span id="moment-voice-status" role="status"></span></div><div class="moment-trim"><label>From <input id="moment-from" type="range" min="0" max="1" step="1" value="0"></label><label>To <input id="moment-to" type="range" min="0" max="1" step="1" value="1"></label><output id="moment-range"></output></div><label class="moment-context-choice"><input id="moment-content" type="checkbox" checked> Include captured content and app state</label><div id="moment-replay"></div><details class="moment-timeline"><summary>Recorded interactions</summary><ol id="moment-events"></ol><pre id="moment-context"></pre></details><footer class="moment-review-actions"><button id="moment-export" class="primary-button" type="button">Export moment</button><button id="moment-json" class="quiet-button" type="button">Save JSON</button><button id="moment-delete" class="quiet-button" type="button">Delete moment</button><span id="moment-save-status" role="status"></span></footer><p class="moment-export-help">Export includes a readable account, structured events and a replay page. Open the ZIP’s replay.html to watch the Design example. Nothing is sent to an agent automatically.</p></div><div id="moment-saved" hidden><p id="moment-library-status"></p><ul id="moment-saved-list"></ul></div>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(id);
  function context() {
    const app = getApp(), panel = $(`panel-${app}`);
    if (app === "design") return getDesignContext();
    const state = { app, coverage: "Control activations and bounded pointer samples. App content and visual replay are not yet supported here.", viewport: { width: innerWidth, height: innerHeight } };
    if (app === "reading") { state.document = $("reading-title").textContent; state.page = $("reading-page-label").textContent; state.tool = panel.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label") || null; state.coverage += " Current paper title, page and tool are included."; }
    if (app === "canvas") { state.tool = $("draw-tool")?.getAttribute("aria-pressed") === "true" ? "Draw" : "Draw/erase workspace"; }
    return state;
  }
  function record(event) { if (!dialog.open && !document.hidden && (!event.app || event.app === getApp())) buffer.record(event); }
  function captureEvent(event, kind, action, extra = {}) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("[data-moment-private], input[type=password], [data-private], #reading-library-key")) return;
    const app = getApp();
    const control = target.closest("button, summary, select, input[type=range], input[type=checkbox], canvas");
    if (!control || !control.closest(`#panel-${app}`)) return;
    record({ kind, app, action, target: control.id || control.getAttribute("aria-label") || control.tagName.toLowerCase(), ...extra, context: context() });
  }
  document.addEventListener("click", event => captureEvent(event, "control", "Control activated", { outcome: "Activation observed; app outcome is recorded separately where supported" }), true);
  const pointers = new Map();
  document.addEventListener("pointerdown", event => { pointers.set(event.pointerId, 0); captureEvent(event, "input", "Pointer down", inputData(event)); }, { passive: true });
  document.addEventListener("pointermove", event => { if (!pointers.has(event.pointerId) || event.timeStamp - pointers.get(event.pointerId) < 50) return; pointers.set(event.pointerId, event.timeStamp); captureEvent(event, "input", "Pointer moved", inputData(event)); }, { passive: true });
  for (const name of ["pointerup", "pointercancel"]) document.addEventListener(name, event => { pointers.delete(event.pointerId); captureEvent(event, "input", name === "pointerup" ? "Pointer up" : "Pointer cancelled", inputData(event)); }, { passive: true });
  document.addEventListener("keydown", event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", "Escape", " "].includes(event.key) && !event.target.closest?.("input, textarea, [contenteditable=true]")) captureEvent(event, "input", "Control key", { input: { key: event.key === " " ? "Space" : event.key } }); }, true);
  function inputData(event) { return { input: { type: event.pointerType, x: event.clientX / Math.max(1, innerWidth), y: event.clientY / Math.max(1, innerHeight), pressure: event.pressure, tiltX: event.tiltX, tiltY: event.tiltY } }; }
  document.addEventListener("visibilitychange", () => { pointers.clear(); if (document.hidden) { buffer.clear("App was hidden; background activity was not recorded"); stopVoice(); $("moment-audio").pause(); } else record({ kind: "boundary", app: getApp(), action: "App returned", context: context() }); });
  window.addEventListener("blur", () => pointers.clear());
  function status() {
    $("moment-record-status").textContent = buffer.paused ? "Paused" : longRecording ? "Recording up to 10 minutes" : "Recent 60 seconds";
    $("moment-pause").textContent = buffer.paused ? "Resume recording" : "Pause recording";
    $("moment-long").textContent = longRecording ? "Keep longer recording" : "Start longer recording";
    keepButton.textContent = buffer.paused ? "Moments paused" : "Keep moment";
  }
  $("moment-pause").onclick = () => { buffer.setPaused(!buffer.paused); longRecording = false; buffer.setWindow(60); try { localStorage.setItem(pauseKey, String(buffer.paused)); } catch {} status(); };
  $("moment-long").onclick = () => { if (longRecording) { keep(); return; } buffer.setPaused(false); try { localStorage.setItem(pauseKey, "false"); } catch {} buffer.clear("Longer recording began"); buffer.setWindow(600); longRecording = true; record({ kind: "boundary", app: getApp(), action: "Longer recording began", context: context() }); status(); };
  function open() {
    priorFocus = document.activeElement; closeMeta(); dialog.showModal(); onOpenChange(true);
    $("moment-close").focus({ preventScroll: true });
  }
  function selection() {
    const value = selectMoment(draft, Number($("moment-from").value), Number($("moment-to").value), $("moment-content").checked);
    value.explanation = $("moment-note").value; return value;
  }
  function save() {
    clearTimeout(saveTimer);
    if (!draft) return;
    draft.explanation = $("moment-note").value; draft.review = { start: Number($("moment-from").value), end: Number($("moment-to").value), includeContext: $("moment-content").checked };
    const value = { ...structuredClone(draft), ...(audio ? { audio } : {}) };
    const generation = ++saveGeneration;
    $("moment-save-status").textContent = "Saving on this device…";
    saveChain = saveChain.catch(() => {}).then(async () => {
      try { const store = await storeReady; await store.put(value); if (generation === saveGeneration) $("moment-save-status").textContent = store.mode === "device" ? "Saved on this device." : "Session only. Export to keep a copy."; }
      catch (error) { if (generation === saveGeneration) $("moment-save-status").textContent = "Not saved. Export this moment to keep it."; notify(error.message); }
    });
  }
  function queueSave() { clearTimeout(saveTimer); $("moment-save-status").textContent = "Saving on this device…"; saveTimer = setTimeout(save, 250); }
  function renderReview() {
    replay?.dispose();
    const value = selection(); replay = mountMomentReplay($("moment-replay"), value);
    $("moment-range").textContent = `${(Number($("moment-from").value) / 1000).toFixed(1)}–${(Number($("moment-to").value) / 1000).toFixed(1)} s`;
    const list = $("moment-events"); list.replaceChildren();
    for (const event of value.events.filter(event => event.kind !== "frame").slice(0, 500)) { const row = document.createElement("li"); row.textContent = `${(event.time / 1000).toFixed(2)}s · ${event.app} · ${event.action}${event.outcome ? ` · ${event.outcome}` : ""}`; list.append(row); }
    $("moment-context").textContent = value.includeContext ? JSON.stringify(value.context, null, 2) : "Captured content and app state excluded.";
  }
  function review(moment) {
    draft = moment; audio = moment.audio || null;
    $("moment-review").hidden = false; $("moment-saved").hidden = true;
    $("moment-title").textContent = "My moment.";
    $("moment-description").textContent = `${new Date(moment.capturedAt).toLocaleString()} · ${moment.boundary}`;
    $("moment-note").value = moment.explanation || "";
    for (const id of ["moment-from", "moment-to"]) { $(id).max = String(moment.duration); $(id).disabled = !moment.duration; }
    $("moment-from").value = String(moment.review?.start || 0); $("moment-to").value = String(moment.review?.end ?? moment.duration);
    $("moment-content").checked = moment.review?.includeContext ?? true;
    updateAudio(); renderReview(); save();
  }
  async function keep() {
    if (capturing) return;
    if (buffer.paused) { notify("Recording is paused. Resume it in Meta before keeping a moment."); return; }
    capturing = true;
    try { const moment = buffer.snapshot(context()); longRecording = false; buffer.setWindow(60); status(); review(moment); open(); await saveChain; }
    finally { capturing = false; }
  }
  keepButton.onclick = keep;
  $("moment-note").addEventListener("input", queueSave);
  for (const id of ["moment-from", "moment-to", "moment-content"]) $(id).addEventListener("input", () => {
    if (Number($("moment-from").value) > Number($("moment-to").value)) { if (id === "moment-from") $("moment-to").value = $("moment-from").value; else $("moment-from").value = $("moment-to").value; }
    renderReview(); queueSave();
  });
  function download(blob, name) { const link = document.createElement("a"), url = URL.createObjectURL(blob); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  $("moment-json").onclick = () => { const value = selection(); if (audio) value.voiceNote = { file: "voice-note", mimeType: audio.type, includedIn: "ZIP export" }; download(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), `moment-${value.id}.json`); };
  $("moment-export").onclick = async () => {
    const button = $("moment-export"); button.disabled = true;
    try {
      const value = selection(), entries = [];
      if (audio) { value.voiceNote = { file: "voice-note", mimeType: audio.type }; entries.push({ name: "voice-note", blob: audio }); }
      entries.push({ name: "moment.json", blob: new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }) }, { name: "read-me.md", blob: new Blob([momentMarkdown(value)], { type: "text/markdown" }) }, { name: "replay.html", blob: new Blob([momentReplayHTML(value)], { type: "text/html" }) });
      download(await createPortableZip(entries), `moment-${value.id}.zip`); $("moment-save-status").textContent = "Exported. Attach the files to your chosen agent.";
    } catch (error) { notify(`Export failed: ${error.message}`); } finally { button.disabled = false; }
  };
  $("moment-delete").onclick = async () => { const id = draft.id; deleted.add(id); clearTimeout(saveTimer); draft = null; stopVoice(); try { await saveChain; await (await storeReady).remove(id); dialog.close(); notify("Moment deleted from this device."); } catch (error) { notify(error.message); } };
  $("moment-library").onclick = async () => {
    replay?.dispose(); draft = null; $("moment-review").hidden = true; $("moment-saved").hidden = false; $("moment-title").textContent = "Saved moments."; $("moment-description").textContent = "Kept on this device. Open one to review or export it.";
    const list = $("moment-saved-list"); list.replaceChildren(); $("moment-library-status").textContent = "Opening saved moments…"; open();
    try { await saveChain; const rows = await (await storeReady).list(); $("moment-library-status").textContent = rows.length ? `${rows.length} saved moment${rows.length === 1 ? "" : "s"}.` : "No moments yet. Return to an app and choose Keep moment.";
      for (const moment of rows.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))) { const row = document.createElement("li"), button = document.createElement("button"); button.type = "button"; button.className = "quiet-button"; button.textContent = `${new Date(moment.capturedAt).toLocaleString()} · ${moment.context?.app || "app"}${moment.explanation ? ` · ${moment.explanation.slice(0, 70)}` : ""}`; button.onclick = () => review(moment); row.append(button); list.append(row); }
    } catch (error) { $("moment-library-status").textContent = error.message; }
  };
  let audioURL;
  function updateAudio() { if (audioURL) URL.revokeObjectURL(audioURL); audioURL = audio ? URL.createObjectURL(audio) : null; $("moment-audio").hidden = !audio; $("moment-voice-remove").hidden = !audio; if (audioURL) $("moment-audio").src = audioURL; else $("moment-audio").removeAttribute("src"); }
  function stopVoice() { clearTimeout(timer); if (voice?.state === "recording") voice.stop(); voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null; }
  $("moment-voice").onclick = async () => {
    if (voice?.state === "recording") { stopVoice(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { $("moment-voice-status").textContent = "Voice recording is unavailable here. Add a text note."; return; }
    $("moment-voice").disabled = true;
    const capturedDraft = draft, id = draft.id;
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!dialog.open || draft?.id !== id) { stopVoice(); return; }
      const chunks = [], recorder = new MediaRecorder(voiceStream); voice = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { stopVoice(); $("moment-voice-status").textContent = "Voice recording failed. Your text note is kept."; };
      recorder.onstop = () => {
        if (deleted.has(id)) return;
        if (!chunks.length) { $("moment-voice").textContent = "Add voice note"; $("moment-voice-status").textContent = "No audio recorded. Try again or add a text note."; return; }
        const recorded = new Blob(chunks, { type: recorder.mimeType });
        if (draft?.id === id) { audio = recorded; updateAudio(); save(); $("moment-voice").textContent = "Add voice note"; $("moment-voice-status").textContent = "Voice note recorded. Audio is included in ZIP export."; }
        else { saveChain = saveChain.catch(() => {}).then(async () => (await storeReady).put({ ...capturedDraft, audio: recorded })).catch(error => notify(error.message)); }
      };
      voice.start(); $("moment-voice").textContent = "Stop voice note"; $("moment-voice-status").textContent = "Recording voice. Stops after 60 seconds."; timer = setTimeout(stopVoice, 60000);
    } catch (error) { stopVoice(); $("moment-voice-status").textContent = "Could not record voice. Check microphone permission or use a text note."; }
    finally { $("moment-voice").disabled = false; }
  };
  $("moment-voice-remove").onclick = () => { audio = null; updateAudio(); save(); };
  $("moment-close").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); });
  dialog.addEventListener("close", () => { if (draft) save(); stopVoice(); $("moment-audio").pause(); replay?.dispose(); if (audioURL) URL.revokeObjectURL(audioURL); onOpenChange(false); if (priorFocus?.isConnected && !priorFocus.closest("[hidden], [inert]")) priorFocus.focus({ preventScroll: true }); record({ kind: "boundary", app: getApp(), action: "Moment review closed; review activity was not recorded", context: context() }); });
  status();
  return { record, isOpen: () => dialog.open, appChanged(app) { record({ kind: "navigation", app, action: "Opened app", context: context() }); } };
}
