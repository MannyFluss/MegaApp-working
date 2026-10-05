// The environment is a temporary surface; the current app keeps the workspace.
export function createMeta({ onOpenChange, focusApp, input, onReach = async () => true, onReading = async () => true }) {
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

  const about = document.createElement("details"); about.className = "meta-about";
  about.innerHTML = '<summary>What is Meta?</summary><p>Meta is the temporary place for your apps and shared controls. Close it to return to your work. Hold the Meta button to open this explanation.</p>';
  dialog.querySelector(".meta-help").after(about);
  const reach = document.createElement("details"); reach.className = "meta-reach";
  reach.innerHTML = '<summary>Reach and access</summary><label>Keep controls on the <select id="meta-side"><option value="right">Right</option><option value="left">Left</option></select></label><p>Meta and Keep moment travel together. Pull inward from the matching edge; mouse and Pencil keep their app input.</p><p id="meta-reach-status" role="status">A shared preference you can also edit in State.</p>';
  dialog.querySelector(".meta-system").after(reach);
  const reading = document.createElement('details'); reading.className = 'meta-reading';
  reading.innerHTML = '<summary>Reading preferences</summary><label><input id="meta-word-emphasis" type="checkbox"> Emphasize word beginnings</label><p>A reversible bionic reading style. Design uses this preference; PDF pages keep their original typography.</p><p id="meta-reading-status" role="status">Your words and annotations stay intact.</p>';
  reach.after(reading);
  const emphasisControl = reading.querySelector('input'), readingStatus = reading.querySelector('[role=status]');
  let readingChain = Promise.resolve(), readingSaving = false, readingRevision = 0;
  const sideControl = reach.querySelector("select"), reachStatus = reach.querySelector("#meta-reach-status");
  let priorFocus, entryFocus, gesture, side = "right", holdTimer, holdPoint, saveChain = Promise.resolve(), saving = false, saveRevision = 0;
  function configure(values = {}, force = false) {
    if (!readingSaving) emphasisControl.checked = values['system.reading.emphasis']?.value === true;
    if (saving && !force) return;
    const next = values["system.meta.side"]?.value === "left" ? "left" : "right";
    if (next !== side) cancelGesture(); side = next; sideControl.value = side;
    document.documentElement.dataset.metaSide = side;
    dialog.querySelector(".meta-shortcut").textContent = `Pull inward from the ${side} edge, or press ⌘ / Ctrl + Shift + M.`;
  }
  configure();
  emphasisControl.onchange = () => {
    const enabled = emphasisControl.checked, revision = ++readingRevision; readingSaving = true; readingStatus.textContent = 'Saving reading preference…';
    readingChain = readingChain.catch(() => {}).then(async () => {
      try { const persistent = await onReading(enabled); if (revision === readingRevision) readingStatus.textContent = persistent === false ? 'Reading preference changed for this session.' : 'Reading preference saved on this device.'; }
      catch { if (revision === readingRevision) { emphasisControl.checked = !enabled; readingStatus.textContent = 'Could not save. Your previous reading preference remains; try again.'; } }
      finally { if (revision === readingRevision) readingSaving = false; }
    });
  };
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
  return { open, close, configure, isOpen: () => dialog.open };
}
