export function createCanvas({ notify, onSettings }) {
  const canvas = document.querySelector("#drawing-canvas");
  const stage = document.querySelector("#canvas-stage");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
  const W = 960,
    H = 640;
  let strokes = [],
    redo = [],
    active = null,
    predicted = [],
    frame = 0,
    penActive = false,
    hover = null;
  let view = { scale: 1, x: 0, y: 0 },
    size = { w: 1, h: 1, dpr: 1 },
    pinch = null;
  const pointers = new Map();
  const settings = {
    width: 8,
    color: "#3558f5",
    pressure: true,
    tool: "draw",
    penOnly: false,
  };
  const $ = (id) => document.getElementById(id);
  const set = (id, text) => ($(id).textContent = text);
  function fit() {
    view.scale = Math.min((size.w - 32) / W, (size.h - 32) / H);
    view.x = (size.w - W * view.scale) / 2;
    view.y = (size.h - H * view.scale) / 2;
    invalidate();
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    size = { w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
    canvas.width = Math.round(size.w * size.dpr);
    canvas.height = Math.round(size.h * size.dpr);
    artwork.width = canvas.width;
    artwork.height = canvas.height;
    set("display-density", `${size.dpr.toFixed(1)}× pixels`);
    fit();
  }
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function point(e) {
    const p = local(e);
    return {
      x: (p.x - view.x) / view.scale,
      y: (p.y - view.y) / view.scale,
      p: e.pointerType === "pen" ? Math.max(0.03, e.pressure) : 0.5,
    };
  }
  function drawStroke(c, s, preview = false) {
    if (!s.points.length) return;
    c.save();
    c.strokeStyle = preview ? "#3558f560" : s.color;
    c.fillStyle = preview ? "#3558f560" : s.color;
    c.globalCompositeOperation =
      !preview && s.tool === "erase" ? "destination-out" : "source-over";
    c.lineCap = "round";
    c.lineJoin = "round";
    const width = (p) => s.width * (s.pressure ? 0.2 + p.p * 1.6 : 1);
    const a = s.points[0];
    c.beginPath();
    c.arc(a.x, a.y, width(a) / 2, 0, Math.PI * 2);
    c.fill();
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i - 1],
        q = s.points[i];
      c.lineWidth = (width(p) + width(q)) / 2;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
    }
    c.restore();
  }
  const artwork = document.createElement("canvas");
  artwork.width = W;
  artwork.height = H;
  const art = artwork.getContext("2d");
  function render() {
    frame = 0;
    art.setTransform(1, 0, 0, 1, 0, 0);
    art.clearRect(0, 0, artwork.width, artwork.height);
    art.save();
    art.setTransform(
      size.dpr * view.scale,
      0,
      0,
      size.dpr * view.scale,
      size.dpr * view.x,
      size.dpr * view.y,
    );
    art.beginPath();
    art.rect(0, 0, W, H);
    art.clip();
    for (const s of strokes) drawStroke(art, s);
    if (active) drawStroke(art, active);
    art.restore();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(stage).backgroundColor;
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e7ecf5";
    for (let x = 20; x < W; x += 24)
      for (let y = 20; y < H; y += 24) {
        ctx.beginPath();
        ctx.arc(x, y, 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
    ctx.restore();
    ctx.drawImage(artwork, 0, 0, size.w, size.h);
    if (active && predicted.length) {
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      drawStroke(
        ctx,
        { ...active, points: [active.points.at(-1), ...predicted] },
        true,
      );
      ctx.restore();
    }
    if (hover && !active) {
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        hover.x,
        hover.y,
        Math.max(2, (settings.width * view.scale) / 2),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    set("zoom-value", `${Math.round(view.scale * 100)}%`);
    $("undo").disabled = !strokes.length;
    $("redo").disabled = !redo.length;
    $("canvas-welcome").hidden = !!(strokes.length || active);
    set(
      "canvas-summary",
      strokes.length
        ? `${strokes.length} mark${strokes.length === 1 ? "" : "s"}. Keep going.`
        : "Your canvas is ready.",
    );
  }
  function invalidate() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  function telemetry(e, count = 1, guess = 0) {
    const p = point(e);
    set("pointer-type", e.pointerType || "Pointer");
    set("pressure-value", e.pressure.toFixed(2));
    $("pressure-fill").style.width = `${Math.min(1, e.pressure) * 100}%`;
    set("pointer-position", `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
    set("pointer-tilt", `${e.tiltX ?? 0}°, ${e.tiltY ?? 0}°`);
    set(
      "pointer-altitude",
      Number.isFinite(e.altitudeAngle)
        ? `${((e.altitudeAngle * 180) / Math.PI).toFixed(1)}°`
        : "Not exposed",
    );
    set(
      "pointer-azimuth",
      Number.isFinite(e.azimuthAngle)
        ? `${((e.azimuthAngle * 180) / Math.PI).toFixed(1)}°`
        : "Not exposed",
    );
    set("pointer-twist", `${e.twist ?? 0}°`);
    set("pointer-contact", `${e.width.toFixed(1)} × ${e.height.toFixed(1)}`);
    set("pointer-samples", String(count));
    set(
      "pointer-prediction",
      typeof e.getPredictedEvents === "function"
        ? String(guess)
        : "Not exposed",
    );
  }
  function beginPinch() {
    const ps = [...pointers.values()].filter((p) => p.type === "touch");
    if (ps.length < 2) return;
    const a = ps[0],
      b = ps[1];
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      scale: view.scale,
      world: {
        x: (center.x - view.x) / view.scale,
        y: (center.y - view.y) / view.scale,
      },
    };
    if (active?.pointerType === "touch") {
      active = null;
      predicted = [];
    }
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.pointerType === "touch" && penActive) return;
    const p = local(e);
    pointers.set(e.pointerId, { ...p, type: e.pointerType });
    canvas.setPointerCapture(e.pointerId);
    if (
      e.pointerType === "touch" &&
      [...pointers.values()].filter((p) => p.type === "touch").length > 1
    ) {
      beginPinch();
      invalidate();
      return;
    }
    if (e.pointerType === "touch" && settings.penOnly) return;
    if (e.pointerType === "pen") {
      penActive = true;
      pinch = null;
      for (const [id, pointer] of pointers)
        if (pointer.type === "touch") pointers.delete(id);
    }
    active = {
      ...settings,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      points: [point(e)],
    };
    predicted = [];
    telemetry(e);
    invalidate();
  });
  canvas.addEventListener("pointermove", (e) => {
    hover = e.pointerType === "touch" ? null : local(e);
    if (pointers.has(e.pointerId))
      pointers.set(e.pointerId, { ...local(e), type: e.pointerType });
    if (pinch) {
      const ps = [...pointers.values()].filter((p) => p.type === "touch");
      if (ps.length >= 2) {
        const [a, b] = ps;
        view.scale = Math.max(
          0.1,
          Math.min(
            8,
            (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
              Math.max(1, pinch.distance),
          ),
        );
        view.x = (a.x + b.x) / 2 - pinch.world.x * view.scale;
        view.y = (a.y + b.y) / 2 - pinch.world.y * view.scale;
        invalidate();
      }
      return;
    }
    const samples =
      typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const actual = samples.length ? samples : [e];
    const guesses =
      typeof e.getPredictedEvents === "function" ? e.getPredictedEvents() : [];
    telemetry(e, actual.length, guesses.length);
    invalidate();
    if (!active || active.pointerId !== e.pointerId) return;
    for (const sample of actual) active.points.push(point(sample));
    predicted = guesses.map(point);
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    invalidate();
  });
  function end(e) {
    pointers.delete(e.pointerId);
    if (active?.pointerId === e.pointerId) {
      // Capture the final real point; cancellation ends the partial mark safely.
      if (e.type === "pointerup") {
        const previous = active.points.at(-1),
          released = point(e);
        if (previous.x !== released.x || previous.y !== released.y)
          active.points.push({ ...released, p: previous.p });
      }
      strokes.push(active);
      redo = [];
      active = null;
      predicted = [];
    }
    if (e.pointerType === "pen") penActive = false;
    if ([...pointers.values()].filter((p) => p.type === "touch").length < 2)
      pinch = null;
    invalidate();
  }
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", (e) => {
    if (pointers.has(e.pointerId)) end(e);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        zoom(Math.exp(-e.deltaY * 0.006), p);
      } else {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        invalidate();
      }
    },
    { passive: false },
  );
  function zoom(factor, p = { x: size.w / 2, y: size.h / 2 }) {
    const wx = (p.x - view.x) / view.scale,
      wy = (p.y - view.y) / view.scale;
    view.scale = Math.max(0.1, Math.min(8, view.scale * factor));
    view.x = p.x - wx * view.scale;
    view.y = p.y - wy * view.scale;
    invalidate();
  }
  $("zoom-in").onclick = () => zoom(1.2);
  $("zoom-out").onclick = () => zoom(1 / 1.2);
  $("zoom-fit").onclick = fit;
  function undo() {
    if (strokes.length) {
      redo.push(strokes.pop());
      invalidate();
    }
  }
  function redoMark() {
    if (redo.length) {
      strokes.push(redo.pop());
      invalidate();
    }
  }
  $("undo").onclick = undo;
  $("redo").onclick = redoMark;
  $("clear-canvas").onclick = () => {
    strokes = [];
    redo = [];
    active = null;
    predicted = [];
    invalidate();
  };
  $("tool-draw").onclick = () => tool("draw");
  $("tool-erase").onclick = () => tool("erase");
  function tool(value) {
    settings.tool = value;
    for (const t of ["draw", "erase"]) {
      $(`tool-${t}`).classList.toggle("active", t === value);
      $(`tool-${t}`).setAttribute("aria-pressed", String(t === value));
    }
  }
  $("ink-color").oninput = (e) => (settings.color = e.target.value);
  $("brush-size").oninput = (e) => {
    settings.width = Number(e.target.value);
    set("brush-value", String(settings.width));
    onSettings?.("apps.canvas.brushSize", "number", settings.width);
  };
  $("pressure-toggle").onchange = (e) => {
    settings.pressure = e.target.checked;
    onSettings?.("apps.canvas.pressure", "boolean", settings.pressure);
  };
  $("pen-only").onchange = (e) => (settings.penOnly = e.target.checked);
  canvas.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redoMark() : undo();
    } else if (["+", "="].includes(e.key)) {
      e.preventDefault();
      zoom(1.2);
    } else if (e.key === "-") {
      e.preventDefault();
      zoom(1 / 1.2);
    } else if (e.key === "0") {
      e.preventDefault();
      fit();
    }
  });
  async function image() {
    const out = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    out.width = W * dpr;
    out.height = H * dpr;
    const c = out.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#fff";
    c.fillRect(0, 0, W, H);
    const layer = document.createElement("canvas");
    layer.width = out.width;
    layer.height = out.height;
    const lc = layer.getContext("2d");
    lc.scale(dpr, dpr);
    for (const s of strokes) drawStroke(lc, s);
    c.drawImage(layer, 0, 0, W, H);
    return new Promise((resolve, reject) =>
      out.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Image export failed."))),
        "image/png",
      ),
    );
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("export-png").onclick = async () => {
    try {
      download(await image(), "megaapp-canvas.png");
      notify("Image ready in Downloads.");
    } catch (e) {
      notify(e.message);
    }
  };
  $("export-svg").onclick = () => {
    let items = "",
      defs = "";
    function geometry(s, color) {
      const width = (p) => s.width * (s.pressure ? 0.2 + p.p * 1.6 : 1),
        a = s.points[0];
      let shape = `<circle cx="${a.x.toFixed(3)}" cy="${a.y.toFixed(3)}" r="${(width(a) / 2).toFixed(3)}" fill="${color}"/>`;
      for (let i = 1; i < s.points.length; i++) {
        const p = s.points[i],
          q = s.points[i - 1],
          w = (width(p) + width(q)) / 2;
        shape += `<path d="M${q.x.toFixed(3)} ${q.y.toFixed(3)}L${p.x.toFixed(3)} ${p.y.toFixed(3)}" stroke="${color}" stroke-width="${w.toFixed(3)}" stroke-linecap="round"/>`;
      }
      return shape;
    }
    for (const [i, s] of strokes.entries()) {
      if (s.tool === "erase") {
        defs += `<mask id="erase-${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="960" height="640"><rect width="960" height="640" fill="white"/>${geometry(s, "black")}</mask>`;
        items = `<g mask="url(#erase-${i})">${items}</g>`;
      } else items += geometry(s, s.color);
    }
    download(
      new Blob(
        [
          `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><defs>${defs}</defs><rect width="960" height="640" fill="white"/>${items}</svg>`,
        ],
        { type: "image/svg+xml" },
      ),
      "megaapp-canvas.svg",
    );
    notify("SVG ready in Downloads.");
  };
  $("share-canvas").onclick = async () => {
    try {
      if (!navigator.share) {
        notify("Sharing is not exposed here. Use Save image.");
        return;
      }
      await navigator.share({
        title: "MegaApp playground",
        url: location.href,
      });
    } catch (e) {
      if (e.name !== "AbortError") notify(e.message);
    }
  };
  new ResizeObserver(resize).observe(stage);
  window.visualViewport?.addEventListener("resize", () => invalidate());
  return {
    canvas,
    stage,
    image,
    download,
    redraw: invalidate,
    resize,
    settings,
    applySettings(values) {
      if (values["apps.canvas.brushSize"]?.type === "number") {
        settings.width = Math.min(
          48,
          Math.max(1, values["apps.canvas.brushSize"].value),
        );
        $("brush-size").value = settings.width;
        set("brush-value", String(settings.width));
      }
      if (values["apps.canvas.pressure"]?.type === "boolean") {
        settings.pressure = values["apps.canvas.pressure"].value;
        $("pressure-toggle").checked = settings.pressure;
      }
    },
  };
}
