// A small shared response layer. App drawing/game handlers retain their meaning.
export function createInputSystem() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  // Check the current preference when acting, including immediately after a
  // preference change while a retained query is waiting for its change event.
  const reducedNow = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let response = 0.8, settling = 280;
  const active = new Map(), releases = new Map();
  function configure(values = {}) {
    const intensity = values["system.input.response"]?.value;
    const duration = values["system.input.settling"]?.value;
    response = Number.isFinite(intensity) ? Math.max(0, Math.min(1.5, intensity)) : 0.8;
    settling = Number.isFinite(duration) ? Math.max(120, Math.min(500, duration)) : 280;
    document.documentElement.style.setProperty("--input-settling", `${settling}ms`);
  }
  function cancelRelease(element) { releases.get(element)?.cancel(); releases.delete(element); }
  function release(event) {
    const contact = active.get(event.pointerId);
    if (!contact) return;
    active.delete(event.pointerId);
    const { element } = contact;
    element.classList.remove("input-contact");
    if (!element.isConnected || reducedNow() || !response) {
      element.style.removeProperty("transform"); return;
    }
    const from = element.style.transform || "none";
    element.style.removeProperty("transform");
    const animation = element.animate([
      { transform: from },
      { transform: `translateY(${-0.35 * response}px)`, offset: 0.7 },
      { transform: "none" },
    ], { duration: settling, easing: "cubic-bezier(.2,.8,.3,1)" });
    releases.set(element, animation);
    animation.finished.catch(() => {}).finally(() => { if (releases.get(element) === animation) releases.delete(element); });
  }
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const element = event.target.closest?.("button:not(:disabled):not([data-direct-input]), summary, a.primary-button, a.quiet-button");
    // The opening owns its captured drag and transform lifecycle as one surface.
    if (!element || element.closest("[inert], .workspace-intro")) return;
    cancelRelease(element);
    active.set(event.pointerId, { element, x: event.clientX, y: event.clientY });
    element.classList.add("input-contact");
    if (!reducedNow() && response) element.style.transform = `translateY(${0.8 * response}px)`;
  }, { passive: true });
  document.addEventListener("pointermove", (event) => {
    const contact = active.get(event.pointerId);
    if (!contact || reducedNow() || !response) return;
    const x = Math.max(-1.2, Math.min(1.2, (event.clientX - contact.x) * 0.04)) * response;
    const y = (0.8 + Math.max(-0.7, Math.min(0.7, (event.clientY - contact.y) * 0.04))) * response;
    contact.element.style.transform = `translate(${x}px,${y}px)`;
  }, { passive: true });
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });
  function clear() {
    for (const [pointerId] of active) release({ pointerId });
    for (const [element, animation] of releases) { animation.cancel(); element.style.removeProperty("transform"); }
    releases.clear();
  }
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  reduced.addEventListener("change", clear);
  function present(element) {
    if (reducedNow() || !response || !element) return;
    element.animate([{ opacity: 0.7, transform: `translateY(${3 * response}px)` }, { opacity: 1, transform: "translateY(0)" }], { duration: settling, easing: "cubic-bezier(.2,.8,.3,1)" });
  }
  return { configure, present, get response() { return response; }, get settling() { return settling; }, get reduced() { return reducedNow(); } };
}

export function createPhysicalSurface(element, board, input, onChange = () => {}) {
  let drag, animation, x = 0, y = 0;
  const clamp = (value, max) => Math.max(-max, Math.min(max, value));
  function bounds() { return { x: Math.max(0, (board.clientWidth - element.offsetWidth) / 2 - 12), y: Math.max(0, (board.clientHeight - element.offsetHeight) / 2 - 10) }; }
  function place() {
    element.style.transform = `translate(${x}px,${y}px)`;
    element.dataset.x = String(x); element.dataset.y = String(y);
    board.style.setProperty("--contact-x", `${x * 0.035}px`);
    board.style.setProperty("--contact-y", `${y * 0.035}px`);
    onChange();
  }
  function stop() {
    if (animation) {
      const position = new DOMMatrix(getComputedStyle(element).transform);
      x = position.m41; y = position.m42;
      animation.cancel(); animation = null; place();
    }
  }
  function settle(vx = 0, vy = 0) {
    element.dataset.dragging = "false";
    const fromX = x, fromY = y, limits = bounds();
    x = 0; y = 0; place();
    if (input.reduced || !input.response || (Math.abs(fromX) < 0.01 && Math.abs(fromY) < 0.01 && !vx && !vy)) return;
    const toX = clamp(fromX + clamp(vx * 22 * input.response, 22), limits.x);
    const toY = clamp(fromY + clamp(vy * 22 * input.response, 22), limits.y);
    animation = element.animate([
      { transform: `translate(${fromX}px,${fromY}px)` },
      { transform: `translate(${toX}px,${toY}px)`, offset: 0.15 },
      { transform: `translate(${-toX * 0.025}px,${-toY * 0.025}px)`, offset: 0.8 },
      { transform: "translate(0px,0px)" },
    ], { duration: input.settling + Math.min(150, Math.hypot(vx, vy) * 35), easing: "cubic-bezier(.18,.75,.3,1)" });
    const current = animation;
    let lastFrame = 0;
    function observeFrame(time) {
      if (animation !== current) return;
      if (time - lastFrame >= 50) { onChange(); lastFrame = time; }
      requestAnimationFrame(observeFrame);
    }
    requestAnimationFrame(observeFrame);
    current.finished.catch(() => {}).finally(() => { if (animation === current) { animation = null; onChange(); } });
  }
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    event.preventDefault(); stop();
    drag = { id: event.pointerId, startX: event.clientX - x, startY: event.clientY - y, lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, vx: 0, vy: 0 };
    element.setPointerCapture(event.pointerId);
    element.dataset.dragging = "true";
  });
  element.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const limits = bounds(), dt = Math.max(1, event.timeStamp - drag.time);
    drag.vx = (event.clientX - drag.lastX) / dt; drag.vy = (event.clientY - drag.lastY) / dt;
    x = clamp(event.clientX - drag.startX, limits.x); y = clamp(event.clientY - drag.startY, limits.y);
    Object.assign(drag, { lastX: event.clientX, lastY: event.clientY, time: event.timeStamp }); place();
  });
  function end(event) {
    if (drag?.id !== event.pointerId) return;
    const recent = event.timeStamp - drag.time < 100 && event.type === "pointerup";
    const vx = recent ? drag.vx : 0, vy = recent ? drag.vy : 0;
    drag = null; settle(vx, vy);
  }
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  element.addEventListener("lostpointercapture", end);
  element.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault(); stop();
    if (["Enter", " ", "Escape"].includes(event.key)) { settle(); return; }
    const limits = bounds();
    x = clamp(x + (event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0), limits.x);
    y = clamp(y + (event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0), limits.y); place();
  });
  const observer = new ResizeObserver(() => { if (!drag) { stop(); x = 0; y = 0; place(); } });
  observer.observe(board);
  function reset(animate = true) {
    const pointer = drag?.id;
    drag = null;
    if (pointer !== undefined && element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    stop();
    if (animate && element.getClientRects().length) settle();
    else { x = 0; y = 0; element.dataset.dragging = "false"; place(); }
  }
  window.addEventListener("blur", () => reset(false));
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(false); });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", event => { if (event.matches) reset(false); });
  return { reset };
}
