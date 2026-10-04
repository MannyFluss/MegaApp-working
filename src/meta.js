// The environment is a temporary surface; the current app keeps the workspace.
export function createMeta({ onOpenChange, focusApp, input }) {
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
  shell.append(trigger, edge);
  document.body.append(dialog);

  let priorFocus, gesture;
  const touches = new Set();
  const otherModal = () => Boolean(document.querySelector('dialog[open]:not(#meta-dialog)'));
  const focusables = () => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter((element) => !element.disabled && element.tabIndex >= 0 && !element.closest("[hidden], [inert]") && element.getClientRects().length);
  function open() {
    if (dialog.open || shell.inert || otherModal() || document.body.classList.contains("intro-open")) return;
    priorFocus = document.activeElement;
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
    dialog.close();
    document.body.classList.remove("meta-is-open");
    trigger.setAttribute("aria-expanded", "false");
    onOpenChange(false);
    if (!restoreFocus) return;
    const canRestore = priorFocus?.isConnected && priorFocus !== document.body && priorFocus !== trigger &&
      !priorFocus.closest("[hidden], [inert], #meta-dialog") && priorFocus.getClientRects().length;
    if (canRestore) priorFocus.focus({ preventScroll: true });
    else focusApp();
  }
  trigger.onclick = open;
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
      if (event.pointerType !== "touch") return;
      touches.add(event.pointerId);
      if (touches.size > 1) gesture = null;
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
    }, true);
    const releaseTouch = (event, cancelled = false) => { touches.delete(event.pointerId); endGesture(event, cancelled); };
    doc.addEventListener("pointerup", (event) => releaseTouch(event), true);
    doc.addEventListener("pointercancel", (event) => releaseTouch(event, true), true);
    doc.addEventListener("lostpointercapture", (event) => endGesture(event, true), true);
  }
  function endGesture(event, cancelled = false) {
    if (gesture?.id !== event.pointerId) return;
    const current = gesture; gesture = null;
    if (current.owner.hasPointerCapture?.(event.pointerId)) current.owner.releasePointerCapture(event.pointerId);
    if (!cancelled && current.dx < -56 && Math.abs(current.dy) < Math.abs(current.dx) * 0.6) open();
  }
  bindPointers(document);
  const cancelGesture = () => {
    const current = gesture; gesture = null; touches.clear();
    if (current?.owner.hasPointerCapture?.(current.id)) current.owner.releasePointerCapture(current.id);
  };
  window.addEventListener("blur", cancelGesture);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelGesture(); });
  return { open, close, isOpen: () => dialog.open };
}
