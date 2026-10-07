import { applyReadingStyle, readingPrefix } from './reading-style.js';
import { createReadingFont } from './reading-font.js';
// The environment is a temporary surface; the current app keeps the workspace.
export function createMeta({ onOpenChange, focusApp, input, inputConnection, onReach = async () => true, onReading = async () => true, onReadingFont = () => {} }) {
  const shell = document.querySelector(".app-shell");
  const topbar = shell.querySelector(".topbar");
  const dock = shell.querySelector(".dock");
  const trigger = document.createElement("button");
  trigger.id = "meta-open";
  trigger.className = "meta-open";
  trigger.type = "button";
  trigger.textContent = "Meta";
  trigger.setAttribute("aria-label", "Open Meta: apps and environment");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", "meta-dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-keyshortcuts", "Control+Shift+M Meta+Shift+M");
  trigger.title = "Apps and environment (⌘ / Ctrl + Shift + M)";
  const edge = document.createElement("div");
  edge.id = "meta-edge";
  edge.className = "meta-edge";
  edge.setAttribute("aria-hidden", "true");
  const dialog = document.createElement("dialog");
  dialog.id = "meta-dialog";
  dialog.className = "meta-dialog";
  dialog.setAttribute("aria-labelledby", "meta-title");
  dialog.setAttribute("aria-modal", "true");
  dialog.innerHTML = '<div class="meta-heading"><h1 id="meta-title">Meta</h1><button id="meta-close" class="quiet-button" type="button">Close</button></div><p class="meta-help">Choose an app. Return to what you were doing.</p><div class="meta-apps"></div><div class="meta-system"></div><p class="meta-shortcut">Swipe left from the right edge, or press ⌘ / Ctrl + Shift + M.</p>';
  dock.setAttribute("aria-label", "Apps");
  topbar.querySelector(".topbar-actions").append(dock.querySelector("#theme-toggle"));
  dock.querySelector(".dock-spacer")?.remove();
  dialog.querySelector(".meta-apps").append(dock);
  dialog.querySelector(".meta-system").append(topbar);
  const peek = document.createElement("div"); peek.className = "meta-pull-preview"; peek.hidden = true; peek.setAttribute("aria-hidden", "true");
  peek.innerHTML = '<strong>Meta</strong><span>Pull for apps and controls</span>';
  shell.append(trigger, edge, peek);
  document.body.append(dialog);
  inputConnection?.mountMeta(dialog);

  const about = document.createElement("details"); about.className = "meta-about";
  about.innerHTML = '<summary>What is Meta?</summary><p>Meta is the temporary place for your apps and shared controls. Close it to return to your work. Hold the Meta button to open this explanation.</p>';
  dialog.querySelector(".meta-help").after(about);
  const reach = document.createElement("details"); reach.className = "meta-reach";
  reach.innerHTML = '<summary>Reach and access</summary><label>Keep controls on the <select id="meta-side"><option value="right">Right</option><option value="left">Left</option></select></label><p>Meta and Keep moment travel together. Pull inward from the matching edge; mouse and Pencil keep their app input.</p><p id="meta-reach-status" role="status">A shared preference you can also edit in State.</p>';
  dialog.querySelector(".meta-system").after(reach);
  const reading = document.createElement('details'); reading.className = 'meta-reading';
  reading.innerHTML = '<summary>Reading preferences</summary><label><input id="meta-word-emphasis" type="checkbox"> Emphasize word beginnings</label><label class="meta-reading-prefix">Word beginning <input id="meta-word-prefix" type="range" min="25" max="75" step="5" value="50"><output for="meta-word-prefix">50%</output></label><p class="meta-reading-preview" data-reading-text>Software is material I can reshape. My work keeps its place.</p><p>Local word emphasis for Design. Words and native selection stay intact; PDF pages retain their typography.</p><p><a href="https://bionic-reading.com/bionic-reading-font/" target="_blank" rel="noopener noreferrer">Bionic Reading® fonts</a> are separate licensed typefaces.</p><p id="meta-reading-status" role="status">Your words and annotations stay intact.</p>';
  reach.after(reading);
  const emphasisControl = reading.querySelector('#meta-word-emphasis'), prefixControl = reading.querySelector('#meta-word-prefix'), prefixOutput = reading.querySelector('output'), readingStatus = reading.querySelector('[role=status]');
  let savedReading = { enabled: false, prefix: .5 };
  let deviceFont;
  function previewReading() {
    prefixOutput.value = `${prefixControl.value}%`;
    const usingFont = deviceFont?.info()?.enabled === true;
    emphasisControl.disabled = usingFont;
    prefixControl.disabled = usingFont || !emphasisControl.checked;
    applyReadingStyle(reading, { enabled: emphasisControl.checked && !usingFont, prefix: Number(prefixControl.value) / 100 });
  }
  const fontTools = document.createElement('details'); fontTools.className = 'meta-reading-font';
  fontTools.innerHTML = '<summary>Use a font from Files</summary><p>Choose your licensed Bionic Reading® font or another reading font. It stays on this device.</p><label>Font file <input id="meta-reading-font-file" type="file" accept=".otf,.ttf,.woff,.woff2"></label><label><input id="meta-reading-font-enabled" type="checkbox" disabled> Use device font</label><button id="meta-reading-font-remove" class="quiet-button" type="button" disabled>Remove device font</button><p id="meta-reading-font-status" role="status">No device font selected.</p>';
  readingStatus.before(fontTools);
  const fontFile = fontTools.querySelector('#meta-reading-font-file'), fontEnabled = fontTools.querySelector('#meta-reading-font-enabled'), fontRemove = fontTools.querySelector('#meta-reading-font-remove'), fontStatus = fontTools.querySelector('[role=status]');
  function showFont(info, message) {
    fontEnabled.checked = info?.enabled === true; fontEnabled.disabled = !info; fontRemove.disabled = !info;
    fontStatus.textContent = message || (info ? `${info.name}. ${info.persistent ? 'Saved on this device.' : 'Available for this session only; choose the file again next time.'}` : 'No device font selected.');
    previewReading();
  }
  deviceFont = createReadingFont({ onChange(info) { showFont(info); onReadingFont(info); } });
  deviceFont.ready.then(result => { if (result?.error) showFont(null, result.error); });
  async function changeFont(operation, action) {
    fontFile.disabled = fontEnabled.disabled = fontRemove.disabled = true; fontStatus.textContent = 'Preparing reading font…';
    try { const result = await operation(); const info = deviceFont.info(); showFont(info, action === 'remove' && result?.persistent === false ? 'Removed for this session. The saved font could not be cleared and may return after reload.' : undefined); onReadingFont(info, action, result); }
    catch (error) { showFont(deviceFont.info(), error.message || 'Could not change the font. Your previous font remains.'); }
    finally { fontFile.disabled = false; fontFile.value = ''; }
  }
  fontFile.onchange = () => { const file = fontFile.files[0]; if (file) changeFont(() => deviceFont.import(file), 'import'); };
  fontEnabled.onchange = () => { const enabled = fontEnabled.checked; changeFont(() => deviceFont.enable(enabled), 'enable'); };
  fontRemove.onclick = () => changeFont(() => deviceFont.remove(), 'remove');
  let readingChain = Promise.resolve(), readingSaving = false, readingRevision = 0;
  const sideControl = reach.querySelector("select"), reachStatus = reach.querySelector("#meta-reach-status");
  let priorFocus, entryFocus, gesture, side = "right", holdTimer, holdPoint, saveChain = Promise.resolve(), saving = false, saveRevision = 0;
  function configure(values = {}, force = false) {
    if (!readingSaving) {
      savedReading = { enabled: values['system.reading.emphasis']?.value === true, prefix: readingPrefix(values['system.reading.prefix']?.value) };
      emphasisControl.checked = savedReading.enabled;
      prefixControl.value = String(savedReading.prefix * 100);
      previewReading();
    }
    if (saving && !force) return;
    const next = values["system.meta.side"]?.value === "left" ? "left" : "right";
    if (next !== side) cancelGesture(); side = next; sideControl.value = side;
    document.documentElement.dataset.metaSide = side;
    dialog.querySelector(".meta-shortcut").textContent = `Pull inward from the ${side} edge, or press ⌘ / Ctrl + Shift + M.`;
  }
  configure();
  function saveReading() {
    const enabled = emphasisControl.checked, prefix = Number(prefixControl.value) / 100, revision = ++readingRevision; readingSaving = true; previewReading(); readingStatus.textContent = 'Saving reading preference…';
    readingChain = readingChain.catch(() => {}).then(async () => {
      try { const persistent = await onReading(enabled, prefix); savedReading = { enabled, prefix }; if (revision === readingRevision) readingStatus.textContent = persistent === false ? 'Reading preference changed for this session.' : 'Reading preference saved on this device.'; }
      catch { if (revision === readingRevision) { emphasisControl.checked = savedReading.enabled; prefixControl.value = String(savedReading.prefix * 100); previewReading(); readingStatus.textContent = 'Could not save. Your previous reading preference remains; try again.'; } }
      finally { if (revision === readingRevision) readingSaving = false; }
    });
  }
  emphasisControl.onchange = saveReading;
  prefixControl.oninput = previewReading;
  prefixControl.onchange = saveReading;
  sideControl.onchange = () => {
    const choice = sideControl.value, revision = ++saveRevision; configure({ "system.meta.side": { value: choice } }, true); saving = true;
    reachStatus.textContent = "Saving reach…";
    saveChain = saveChain.catch(() => {}).then(async () => {
      try { const persistent = await onReach(choice); if (revision === saveRevision) reachStatus.textContent = persistent === false ? "Reach changed for this session." : "Reach saved on this device."; }
      catch { if (revision === saveRevision) reachStatus.textContent = "Could not save. Reach is changed here for now; try again to keep it."; }
      finally { if (revision === saveRevision) saving = false; }
    });
  };
  const touches = new Set(), pens = new Set();
  const otherModal = () => Boolean(document.querySelector('dialog[open]:not(#meta-dialog)'));
  const focusables = () => [...dialog.querySelectorAll('button, summary, a[href], input, select, textarea, [tabindex]')]
    .filter((element) => !element.disabled && element.tabIndex >= 0 && !element.closest("[hidden], [inert]") && element.getClientRects().length);
  function open({ explain = false, fromTrigger = false } = {}) {
    if (dialog.open || shell.inert || otherModal() || document.body.classList.contains("intro-open")) return;
    cancelGesture();
    priorFocus = fromTrigger && entryFocus ? entryFocus : document.activeElement; entryFocus = null;
    if (explain) about.open = true;
    shell.inert = true;
    document.body.classList.add("meta-is-open");
    trigger.setAttribute("aria-expanded", "true");
    dialog.showModal();
    input?.present(dialog);
    onOpenChange(true);
    const selected = dock.querySelector('[aria-selected="true"]');
    for (const tab of dock.querySelectorAll("[data-panel]")) tab.tabIndex = tab === selected ? 0 : -1;
    selected?.focus({ preventScroll: true });
  }
  function close({ restoreFocus = true } = {}) {
    if (!dialog.open) return;
    inputConnection?.clearKeyField();
    shell.inert = false;
    dialog.close(); about.open = false;
    document.body.classList.remove("meta-is-open");
    trigger.setAttribute("aria-expanded", "false");
    onOpenChange(false);
    if (!restoreFocus) return;
    const canRestore = priorFocus?.isConnected && priorFocus !== document.body && priorFocus !== trigger &&
      !priorFocus.closest("[hidden], [inert], #meta-dialog") && priorFocus.getClientRects().length;
    if (canRestore) priorFocus.focus({ preventScroll: true });
    else focusApp();
  }
  trigger.onclick = () => open({ fromTrigger: true });
  trigger.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    entryFocus = document.activeElement; holdPoint = { x: event.clientX, y: event.clientY }; clearTimeout(holdTimer);
    holdTimer = setTimeout(() => open({ explain: true, fromTrigger: true }), 500);
  });
  trigger.addEventListener("pointermove", event => { if (holdPoint && Math.hypot(event.clientX - holdPoint.x, event.clientY - holdPoint.y) > 10) clearTimeout(holdTimer); });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) trigger.addEventListener(event, () => clearTimeout(holdTimer));
  trigger.addEventListener("contextmenu", event => { if (dialog.open && about.open) event.preventDefault(); });
  dialog.querySelector("#meta-close").onclick = () => close();
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
  });
  function keyboard(event) {
    if (otherModal() || document.body.classList.contains("intro-open")) return;
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") {
      event.preventDefault(); event.stopPropagation();
      dialog.open ? close() : open();
      return;
    }
    if (!dialog.open || event.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    event.preventDefault(); items[next].focus();
  }
  document.addEventListener("keydown", keyboard, true);
  // A same-origin embedded app still gets the environment shortcut.
  const boundDocuments = new WeakSet();
  for (const frame of shell.querySelectorAll("iframe")) {
    const bind = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || boundDocuments.has(doc)) return;
        boundDocuments.add(doc);
        doc.addEventListener("keydown", keyboard, true);
        doc.documentElement.style.touchAction = "pan-y pinch-zoom";
        bindPointers(doc, frame);
      } catch { /* Other origins keep their own input. */ }
    };
    frame.addEventListener("load", bind); bind();
  }
  // Recognize touch at document capture before any app sees pointerdown. The
  // edge is only a geometric region, so mouse and Pencil always pass through.
  function bindPointers(doc, frame) {
    const point = (event) => {
      const rect = frame?.getBoundingClientRect();
      return { x: event.clientX + (rect?.left || 0), y: event.clientY + (rect?.top || 0) };
    };
    doc.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "pen") { pens.add(event.pointerId); cancelGesture(true); return; }
      if (event.pointerType !== "touch" || pens.size) return;
      touches.add(event.pointerId);
      if (touches.size > 1) { cancelGesture(true); return; }
      const rect = edge.getBoundingClientRect(), current = point(event);
      const inEdge = current.x >= rect.left && current.x <= rect.right && current.y >= rect.top && current.y <= rect.bottom;
      if (!inEdge || !event.isPrimary || touches.size !== 1 || shell.inert || dialog.open || otherModal()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const owner = frame ? event.target : edge;
      gesture = { id: event.pointerId, x: current.x, y: current.y, dx: 0, dy: 0, owner };
      try { owner.setPointerCapture(event.pointerId); } catch { /* Synthetic input has no native pointer. */ }
    }, true);
    doc.addEventListener("pointermove", (event) => {
      if (gesture?.id !== event.pointerId) return;
      const current = point(event);
      gesture.dx = current.x - gesture.x;
      gesture.dy = current.y - gesture.y;
      const distance = Math.max(0, side === "left" ? gesture.dx : -gesture.dx), directional = Math.abs(gesture.dy) < Math.max(12, distance * .8);
      peek.hidden = distance < 4 || !directional;
      if (!peek.hidden) {
        peek.style.top = `${Math.max(76, Math.min(innerHeight - 110, gesture.y - 24))}px`;
        peek.style.transform = input?.reduced ? "none" : `translate(${(side === "left" ? 1 : -1) * Math.min(80, distance) * .35}px,${Math.max(-3, Math.min(3, gesture.dy * .025))}px)`;
        peek.dataset.ready = String(distance > 56 && Math.abs(gesture.dy) < distance * .6);
        peek.querySelector("span").textContent = peek.dataset.ready === "true" ? "Release to open" : "Pull for apps and controls";
      }
    }, true);
    const releaseTouch = (event, cancelled = false) => { pens.delete(event.pointerId); touches.delete(event.pointerId); endGesture(event, cancelled); };
    doc.addEventListener("pointerup", (event) => releaseTouch(event), true);
    doc.addEventListener("pointercancel", (event) => releaseTouch(event, true), true);
    doc.addEventListener("lostpointercapture", (event) => { pens.delete(event.pointerId); touches.delete(event.pointerId); endGesture(event, true); }, true);
  }
  function endGesture(event, cancelled = false) {
    if (gesture?.id !== event.pointerId) return;
    const current = gesture; gesture = null; peek.hidden = true;
    if (current.owner.hasPointerCapture?.(event.pointerId)) current.owner.releasePointerCapture(event.pointerId);
    const distance = side === "left" ? current.dx : -current.dx;
    if (!cancelled && distance > 56 && Math.abs(current.dy) < distance * 0.6) open();
  }
  bindPointers(document);
  function cancelGesture(keepTouches = false) {
    clearTimeout(holdTimer); const current = gesture; gesture = null; peek.hidden = true; if (keepTouches !== true) touches.clear();
    if (current?.owner.hasPointerCapture?.(current.id)) current.owner.releasePointerCapture(current.id);
  }
  window.addEventListener("blur", () => { pens.clear(); cancelGesture(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pens.clear(); cancelGesture(); } });
  return { open, close, configure, readingFontInfo: deviceFont.info, isOpen: () => dialog.open };
}
