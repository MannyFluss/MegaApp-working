import { storageName } from "./environment.js";

export function createIntro() {
  const root = document.getElementById("workspace-intro");
  const shell = document.querySelector(".app-shell");
  const canvas = document.getElementById("intro-art");
  const enter = document.getElementById("intro-enter");
  const skip = document.getElementById("intro-skip");
  const replay = document.getElementById("intro-replay");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const ctx = canvas.getContext("2d");
  const raster = document.createElement("canvas");
  raster.width = 288;
  raster.height = 216;
  const ink = raster.getContext("2d", { willReadFrequently: true });
  const storageKey = storageName("megaapp.intro.v1");
  let frame = 0,
    started = 0,
    phase = "hidden",
    drag = null,
    animation;
  let offset = 0,
    progress = 0,
    pointerX = 0,
    pointerY = 0;
  let priorFocus;
  let drawnFrames = 0;
  const polygon = (points, fill) => {
    ink.fillStyle = fill;
    ink.beginPath();
    points.forEach(([x, y], i) => (i ? ink.lineTo(x, y) : ink.moveTo(x, y)));
    ink.closePath();
    ink.fill();
  };
  function draw(now = performance.now()) {
    frame = 0;
    if (phase === "hidden" || document.hidden || !ctx || !ink) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (
      canvas.width !== Math.round(rect.width * ratio) ||
      canvas.height !== Math.round(rect.height * ratio)
    ) {
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
    }
    const t = motion.matches ? 1 : Math.min(1, (now - started) / 1000);
    const settle = (1 - t) ** 3;
    ink.fillStyle = "#000";
    ink.fillRect(0, 0, 288, 216);
    ink.save();
    ink.translate(pointerX * 3 + settle * 8, pointerY * 2 + settle * 16);
    ink.translate(144, 108);
    ink.rotate(-0.025 + settle * 0.11);
    ink.translate(-144, -108);
    // Original light rays and a perspective computer, sampled as ASCII.
    for (let i = 0; i < 34; i++) {
      const angle = (i / 34) * Math.PI * 2;
      const radius = 86 + Math.sin(i * 4.7) * 8;
      ink.strokeStyle = `rgb(${48 + (i % 4) * 8},${48 + (i % 4) * 8},${48 + (i % 4) * 8})`;
      ink.lineWidth = 0.7;
      ink.beginPath();
      ink.moveTo(143 + Math.cos(angle) * 66, 101 + Math.sin(angle) * 52);
      ink.lineTo(
        143 + Math.cos(angle) * radius * 1.38,
        101 + Math.sin(angle) * radius,
      );
      ink.stroke();
    }
    polygon(
      [
        [45, 43],
        [224, 27],
        [227, 155],
        [58, 181],
      ],
      "#cfcfcf",
    );
    polygon(
      [
        [224, 27],
        [238, 39],
        [240, 160],
        [227, 155],
      ],
      "#696969",
    );
    polygon(
      [
        [58, 181],
        [227, 155],
        [240, 160],
        [71, 190],
      ],
      "#8b8b8b",
    );
    polygon(
      [
        [57, 53],
        [213, 39],
        [215, 141],
        [67, 163],
      ],
      "#080808",
    );
    ink.strokeStyle = "#fff";
    ink.lineWidth = 7;
    ink.lineJoin = "round";
    ink.beginPath();
    ink.moveTo(108, 124);
    ink.lineTo(105, 71);
    ink.lineTo(141, 101);
    ink.lineTo(175, 64);
    ink.lineTo(179, 116);
    ink.stroke();
    ink.lineWidth = 2;
    ink.beginPath();
    ink.moveTo(81, 140);
    ink.lineTo(91, 143);
    ink.lineTo(83, 149);
    ink.stroke();
    ink.fillStyle = "#bbb";
    ink.fillRect(98, 147, 11, 2);
    polygon(
      [
        [135, 169],
        [166, 165],
        [171, 197],
        [138, 200],
      ],
      "#909090",
    );
    polygon(
      [
        [109, 204],
        [184, 194],
        [198, 205],
        [118, 213],
      ],
      "#d9d9d9",
    );
    ink.restore();
    const pixels = ink.getImageData(0, 0, 288, 216).data;
    const columns = rect.width < 400 ? 72 : 96;
    const rows = Math.round((columns * 0.75) / 1.55);
    const cell = Math.min(rect.width / columns, rect.height / (rows * 1.55));
    const line = cell * 1.55;
    const left = (rect.width - columns * cell) / 2;
    const top = (rect.height - rows * line) / 2;
    const ramp = " .:-=+*#%@";
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.font = `${cell * 1.55}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fffbed";
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const sampleX = Math.min(287, Math.floor((x / columns) * 288));
        const sampleY = Math.min(215, Math.floor((y / rows) * 216));
        const brightness = pixels[(sampleY * 288 + sampleX) * 4] / 255;
        const index = Math.min(
          ramp.length - 1,
          Math.floor(brightness * ramp.length),
        );
        if (!index) continue;
        const smear = progress * Math.sin(y * 0.8 + x) * 7;
        ctx.fillText(ramp[index], left + x * cell + smear, top + y * line);
      }
    canvas.dataset.frames = String(++drawnFrames);
    if (t < 1 && !motion.matches && phase === "idle") requestDraw();
  }
  function requestDraw() {
    if (!frame && !document.hidden && phase !== "hidden")
      frame = requestAnimationFrame(draw);
  }
  function state(value) {
    phase = value;
    root.dataset.phase = value;
  }
  function releaseWorkspace() {
    shell.inert = false;
    document.body.classList.remove("intro-open");
    root.setAttribute("aria-modal", "false");
    root.inert = true;
    const canRestoreFocus =
      priorFocus?.isConnected &&
      priorFocus !== document.body &&
      !priorFocus.closest("[hidden], [inert]") &&
      priorFocus.getClientRects().length > 0;
    const target =
      canRestoreFocus
        ? priorFocus
        : document.getElementById("meta-open");
    target?.focus({ preventScroll: true });
  }
  function finish() {
    animation?.cancel();
    animation = null;
    cancelAnimationFrame(frame);
    frame = 0;
    root.hidden = true;
    root.style.transform = "";
    root.style.pointerEvents = "";
    root.style.removeProperty("--intro-progress");
    state("hidden");
    if (shell.inert) releaseWorkspace();
  }
  function leave(instant = false) {
    if (phase === "hidden") return;
    if (phase === "exiting") {
      finish();
      return;
    }
    drag = null;
    animation?.cancel();
    cancelAnimationFrame(frame);
    frame = 0;
    state("exiting");
    root.style.pointerEvents = "none";
    releaseWorkspace();
    try {
      sessionStorage.setItem(storageKey, "seen");
    } catch {
      /* Session storage is optional. */
    }
    if (location.hash === "#intro")
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#marble`,
      );
    if (instant || motion.matches || document.hidden) {
      finish();
      return;
    }
    root.style.setProperty("--intro-progress", "1");
    animation = root.animate(
      [
        { transform: `translate3d(${offset}px,0,0)` },
        { transform: `translate3d(${-innerWidth * 1.08}px,0,0)` },
      ],
      {
        duration: Math.max(180, 420 * (1 - progress)),
        easing: "cubic-bezier(.18,.88,.22,1)",
        fill: "forwards",
      },
    );
    const exitAnimation = animation;
    exitAnimation.onfinish = () => {
      if (animation === exitAnimation && phase === "exiting") finish();
    };
  }
  function show() {
    finish();
    priorFocus = document.activeElement;
    offset = 0;
    progress = 0;
    pointerX = 0;
    pointerY = 0;
    root.inert = false;
    root.hidden = false;
    root.setAttribute("aria-modal", "true");
    shell.inert = true;
    document.body.classList.add("intro-open");
    state("idle");
    started = performance.now();
    enter.focus({ preventScroll: true });
    requestDraw();
  }
  enter.addEventListener("click", () => leave());
  skip.addEventListener("click", () => leave(true));
  replay?.addEventListener("click", show);
  root.addEventListener("pointerdown", (event) => {
    if (
      phase === "exiting" ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.target.closest("button,a")
    )
      return;
    const current = new DOMMatrix(getComputedStyle(root).transform).m41;
    animation?.cancel();
    animation = null;
    offset = current;
    root.style.transform = `translate3d(${current}px,0,0)`;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset,
      time: performance.now(),
    };
    state("dragging");
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener("pointermove", (event) => {
    if (phase === "hidden" || phase === "exiting") return;
    pointerX = (event.clientX / innerWidth) * 2 - 1;
    pointerY = (event.clientY / innerHeight) * 2 - 1;
    if (drag?.id === event.pointerId) {
      const delta = event.clientX - drag.x;
      offset = Math.min(32, drag.offset + (delta > 0 ? delta * 0.15 : delta));
      progress = Math.min(1, Math.max(0, -offset / innerWidth));
      if (!motion.matches)
        root.style.transform = `translate3d(${offset}px,0,0)`;
      root.style.setProperty("--intro-progress", String(progress));
    }
    requestDraw();
  });
  function endDrag(event, cancelled = false) {
    if (drag?.id !== event.pointerId) return;
    const velocity = -offset / Math.max(1, performance.now() - drag.time);
    const commit =
      !cancelled && (progress > 0.22 || (-offset > 36 && velocity > 0.55));
    drag = null;
    if (root.hasPointerCapture(event.pointerId))
      root.releasePointerCapture(event.pointerId);
    if (commit) {
      leave();
      return;
    }
    state("idle");
    root.style.setProperty("--intro-progress", "0");
    progress = 0;
    if (!motion.matches && offset) {
      animation = root.animate(
        [
          { transform: `translate3d(${offset}px,0,0)` },
          { transform: "translate3d(0,0,0)" },
        ],
        {
          duration: 300,
          easing: "cubic-bezier(.2,1.15,.35,1)",
          fill: "forwards",
        },
      );
      const settling = animation;
      settling.onfinish = () => {
        if (animation !== settling || phase !== "idle") return;
        root.style.transform = "";
        settling.cancel();
        animation = null;
      };
    } else root.style.transform = "";
    offset = 0;
    requestDraw();
  }
  root.addEventListener("pointerup", (event) => endDrag(event));
  root.addEventListener("pointercancel", (event) => endDrag(event, true));
  root.addEventListener("lostpointercapture", (event) => endDrag(event, true));
  document.addEventListener("keydown", (event) => {
    if (phase === "hidden" || phase === "exiting") return;
    if (event.key === "Escape") {
      event.preventDefault();
      leave(true);
    } else if (event.key === "Enter" && event.target === root) {
      event.preventDefault();
      leave();
    } else if (event.key === "Tab") {
      // Safari may omit buttons from its native Tab order. Keep both dialog
      // actions reachable regardless of the device's keyboard preference.
      event.preventDefault();
      (document.activeElement === enter ? skip : enter).focus();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      if (phase === "exiting") finish();
      else if (drag) endDrag({ pointerId: drag.id }, true);
    } else requestDraw();
  });
  motion.addEventListener("change", () => {
    if (phase === "exiting") finish();
    else requestDraw();
  });
  new ResizeObserver(requestDraw).observe(canvas);
  window.addEventListener("hashchange", () => {
    if (location.hash === "#intro") show();
    else if (phase !== "hidden") leave(true);
  });
  let seen = false;
  try {
    seen = sessionStorage.getItem(storageKey) === "seen";
  } catch {
    /* Intro still works without storage. */
  }
  if (location.hash === "#intro" || (!location.hash && !seen)) show();
  root.dataset.ready = "true";
  return { show, leave };
}
