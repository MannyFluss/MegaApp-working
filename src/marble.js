import {
  WIDTH,
  HEIGHT,
  RAIL_RADIUS,
  DEMO_SCENE,
  validateScene,
  createWorld,
  addMarble,
  stepWorld,
} from "./marble-physics.js";

const COLORS = [
  "#7867d9",
  "#6687e8",
  "#48a4b9",
  "#72aa91",
  "#d2a750",
  "#db946d",
  "#d17fad",
  "#aa80d1",
];
const NOTES = ["C", "D", "E", "G", "A", "C", "D", "E"];
const FREQUENCIES = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
const MAX_TRACKS = 32,
  MAX_POINTS = 128,
  MAX_TOTAL_POINTS = 2048;
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createMarbleMusic({
  notify = () => {},
  loadScene = Promise.resolve(null),
  onSave = async () => {},
} = {}) {
  const $ = (id) => document.getElementById(id);
  const canvas = $("marble-canvas"),
    stage = $("marble-stage");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("The Marble Music canvas could not open.");
  let scene = validateScene(DEMO_SCENE),
    world = createWorld(scene);
  let visible = true,
    loaded = false,
    playing = false,
    tool = "draw";
  let frame = 0,
    previousTime = 0,
    elapsed = 0,
    emitTime = 0,
    hits = 0;
  let active = null,
    hover = null,
    railId = 0,
    rings = [],
    history = [];
  let size = { width: 1, height: 1, dpr: 1 },
    view = { scale: 1, x: 0, y: 0 };
  let saveTimer = 0,
    revision = 0,
    saveChain = Promise.resolve(),
    externalChanges = Promise.resolve(),
    sceneEpoch = 0;
  let audio = null,
    master = null,
    compressor = null,
    unavailable = false;
  let lastVolume = scene.volume || 0.5;
  const voices = new Set();
  const controls = [
    "marble-play",
    "marble-sound",
    "marble-tool-draw",
    "marble-tool-drop",
    "marble-undo",
    "marble-clear",
    "marble-reset",
    "marble-demo",
    "marble-gravity",
    "marble-volume",
    "marble-note",
    "marble-export",
    "marble-import",
    "marble-file",
  ];
  canvas.dataset.ready = "false";
  canvas.dataset.audio = "unarmed";

  function status(message) {
    $("marble-status").textContent = message;
  }
  function snapshot() {
    return clone(scene);
  }
  function updateControls() {
    canvas.dataset.ready = String(loaded);
    canvas.dataset.playing = String(playing);
    canvas.dataset.tracks = String(scene.tracks.length);
    $("marble-play").textContent = playing ? "Pause" : "Play";
    $("marble-play").setAttribute("aria-pressed", String(playing));
    $("marble-sound").textContent = scene.volume > 0 ? "Sound on" : "Sound off";
    $("marble-sound").setAttribute("aria-pressed", String(scene.volume > 0));
    $("marble-gravity").value = String(scene.gravity);
    $("marble-gravity-value").textContent = String(Math.round(scene.gravity));
    $("marble-volume").value = String(scene.volume);
    $("marble-volume-value").textContent = `${Math.round(scene.volume * 100)}%`;
    $("marble-hit-count").textContent = String(hits);
    $("marble-ball-count").textContent = String(world.marbles.length);
    for (const id of controls) $(id).disabled = !loaded;
    $("marble-undo").disabled = !loaded || !history.length;
    for (const value of ["draw", "drop"]) {
      const button = $(`marble-tool-${value}`);
      button.classList.toggle("active", value === tool);
      button.setAttribute("aria-pressed", String(value === tool));
    }
    $("marble-instruction").textContent =
      tool === "draw"
        ? "Draw a rail with a finger, Pencil, or mouse. Pick its note, then press Play."
        : "Tap the board to drop a marble. Press Play to set it rolling.";
  }

  function queueSave() {
    if (!loaded) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    const value = snapshot(),
      atRevision = revision;
    saveChain = saveChain
      .then(() => onSave(value))
      .then(() => {
        if (atRevision === revision && !playing) status("Scene saved.");
      })
      .catch((error) => {
        status("This scene could not be saved. Export a copy to keep it.");
        notify(`Marble Music could not save: ${error.message || error}`);
      });
  }
  function saveSoon() {
    if (!loaded) return;
    revision++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(queueSave, 400);
  }
  function remember(kind = "tracks") {
    history.push({ kind, scene: snapshot() });
    if (history.length > 24) history.shift();
  }
  function seedPreview() {
    if (world.marbles.length) return;
    scene.emitters.forEach((emitter, i) => {
      addMarble(world, emitter.x, emitter.y + 20, { vx: i % 2 ? -18 : 18 });
      addMarble(
        world,
        clamp(emitter.x + (i % 2 ? 24 : -24), 12, WIDTH - 12),
        clamp(emitter.y + 58, 12, HEIGHT - 12),
      );
    });
  }
  function rebuild({ preview = false, preserve = false } = {}) {
    const previous = preserve
      ? world.marbles.map((marble) => ({ ...marble }))
      : [];
    world = createWorld(scene);
    for (const marble of previous)
      addMarble(world, marble.x, marble.y, { vx: marble.vx, vy: marble.vy });
    if (preview) seedPreview();
    rings = [];
    emitTime = 0;
    updateControls();
    redraw();
  }
  function replaceScene(value, message, { record = true } = {}) {
    if (!loaded) return;
    const next = validateScene(value);
    pause();
    cancelPointer();
    if (record) remember("scene");
    scene = next;
    if (scene.volume > 0) lastVolume = scene.volume;
    hits = 0;
    elapsed = 0;
    rebuild({ preview: true });
    saveSoon();
    status(message);
  }

  function audioState() {
    canvas.dataset.audio = unavailable
      ? "unavailable"
      : !audio
        ? "unarmed"
        : audio.state === "running"
          ? "running"
          : "suspended";
  }
  function stopVoices() {
    if (!audio) return;
    const now = audio.currentTime;
    for (const voice of voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.005);
      try {
        voice.oscillator.stop(now);
      } catch {
        /* Already stopped. */
      }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    voices.clear();
  }
  function silence() {
    stopVoices();
    if (audio && audio.state !== "closed") {
      audio.suspend().then(audioState).catch(audioState);
    }
    audioState();
  }
  function armAudio() {
    if (scene.volume <= 0 || !visible || document.hidden) return;
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) {
          unavailable = true;
          audioState();
          notify(
            "Sound is unavailable here. You can still play with the marbles.",
          );
          return;
        }
        audio = new Audio();
        master = audio.createGain();
        compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 20;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;
        master.gain.value = scene.volume * 0.5;
        master.connect(compressor);
        compressor.connect(audio.destination);
        audio.addEventListener("statechange", audioState);
      }
      master.gain.cancelScheduledValues(audio.currentTime);
      master.gain.setTargetAtTime(scene.volume * 0.5, audio.currentTime, 0.02);
      // Start resume during the click, before any asynchronous work.
      const resumed = audio.resume();
      audioState();
      Promise.resolve(resumed)
        .then(() => {
          audioState();
          if (!playing || !visible || document.hidden || scene.volume <= 0)
            silence();
        })
        .catch((error) => {
          audioState();
          notify(`Sound could not start: ${error.message || error}`);
        });
    } catch (error) {
      audioState();
      notify(`Sound could not start: ${error.message || error}`);
    }
  }
  function setVolume(value) {
    if (!loaded) return;
    scene.volume = clamp(value, 0, 1);
    world.volume = scene.volume;
    if (scene.volume > 0) lastVolume = scene.volume;
    if (master && audio)
      master.gain.setTargetAtTime(scene.volume * 0.5, audio.currentTime, 0.02);
    if (!scene.volume) silence();
    updateControls();
    saveSoon();
  }
  function pluck(hit) {
    if (
      !audio ||
      audio.state !== "running" ||
      !playing ||
      !visible ||
      document.hidden ||
      !scene.volume
    )
      return;
    if (voices.size >= 16) return;
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    const now = audio.currentTime,
      strength = clamp(hit.impact / 600, 0.08, 0.6);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      FREQUENCIES[hit.note] || FREQUENCIES[0],
      now,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      (FREQUENCIES[hit.note] || FREQUENCIES[0]) * 0.997,
      now + 0.45,
    );
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(strength, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    gain.gain.linearRampToValueAtTime(0, now + 0.72);
    oscillator.connect(gain);
    gain.connect(master);
    const voice = { oscillator, gain };
    voices.add(voice);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      voices.delete(voice);
    };
    oscillator.start(now);
    oscillator.stop(now + 0.75);
  }

  function pause(message) {
    playing = false;
    previousTime = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    silence();
    updateControls();
    if (message) status(message);
    if (visible && !document.hidden) paint();
  }
  function play() {
    if (!loaded || !visible || document.hidden) return;
    playing = true;
    previousTime = 0;
    armAudio();
    updateControls();
    status(
      scene.volume > 0
        ? "Let it roll. Draw another rail while the marbles play."
        : "Let it roll. Sound is off.",
    );
    redraw();
  }
  function animate(time) {
    frame = 0;
    if (!visible || document.hidden) return;
    if (playing) {
      const dt = previousTime
        ? clamp((time - previousTime) / 1000, 0, 0.05)
        : 0;
      previousTime = time;
      elapsed += dt;
      emitTime += dt;
      if (emitTime >= 1.5) {
        emitTime %= 1.5;
        for (const emitter of scene.emitters)
          addMarble(world, emitter.x, emitter.y + 10, {
            vx: Math.sin(elapsed * 1.4) * 22,
          });
      }
      const contacts = stepWorld(world, dt, scene.gravity);
      for (const hit of contacts) {
        hits++;
        rings.push({ x: hit.x, y: hit.y, note: hit.note, age: 0 });
        pluck(hit);
      }
      if (rings.length > 48) rings.splice(0, rings.length - 48);
      rings = rings.filter((ring) => (ring.age += dt) < 0.55);
      $("marble-hit-count").textContent = String(hits);
      $("marble-ball-count").textContent = String(world.marbles.length);
    }
    paint();
    if (playing) frame = requestAnimationFrame(animate);
  }
  function redraw() {
    if (visible && !document.hidden && !frame)
      frame = requestAnimationFrame(animate);
  }
  function resize() {
    const rect = stage.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    size = {
      width: rect.width,
      height: rect.height,
      dpr: window.devicePixelRatio || 1,
    };
    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    view.scale = Math.min(size.width / WIDTH, size.height / HEIGHT);
    view.x = (size.width - WIDTH * view.scale) / 2;
    view.y = (size.height - HEIGHT * view.scale) / 2;
    redraw();
  }
  function rounded(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
  function path(points) {
    ctx.beginPath();
    points.forEach((point, i) =>
      i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
    );
  }
  function rail(track, preview = false) {
    if (track.points.length < 2) return;
    const color = COLORS[track.note] || COLORS[0];
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = preview ? 0.65 : 1;
    ctx.shadowColor = "#66629028";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = RAIL_RADIUS * 2;
    path(track.points);
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#ffffff66";
    ctx.lineWidth = 3;
    ctx.translate(0, -2);
    path(track.points);
    ctx.stroke();
    ctx.restore();
    if (!preview) {
      const first = track.points[0];
      ctx.fillStyle = "#ffffffdb";
      ctx.beginPath();
      ctx.arc(first.x, first.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(NOTES[track.note], first.x, first.y + 0.5);
    }
  }
  function paint() {
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = "#efedf8";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    rounded(0, 0, WIDTH, HEIGHT, 24);
    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, "#f3edff");
    background.addColorStop(1, "#e6f3fc");
    ctx.fillStyle = background;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = "#8d91b230";
    for (let x = 24; x < WIDTH; x += 28)
      for (let y = 24; y < HEIGHT; y += 28) {
        ctx.beginPath();
        ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    for (const emitter of scene.emitters) {
      ctx.save();
      ctx.translate(emitter.x, emitter.y);
      ctx.rotate(playing ? Math.sin(elapsed * 1.3) * 0.15 : -0.08);
      ctx.fillStyle = "#eab978";
      ctx.shadowColor = "#caad7833";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5,
          radius = i % 2 ? 7 : 17;
        const x = Math.cos(angle) * radius,
          y = Math.sin(angle) * radius;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const track of scene.tracks) rail(track);
    if (active?.kind === "draw")
      rail({ points: active.points, note: active.note }, true);
    for (const ring of rings) {
      ctx.strokeStyle = COLORS[ring.note] || COLORS[0];
      ctx.globalAlpha = Math.max(0, 1 - ring.age / 0.55) * 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, 10 + ring.age * 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const marble of world.marbles) {
      const radius = marble.radius || 8;
      const gradient = ctx.createRadialGradient(
        marble.x - radius * 0.35,
        marble.y - radius * 0.4,
        radius * 0.1,
        marble.x,
        marble.y,
        radius,
      );
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.28, COLORS[(marble.id - 1) % COLORS.length]);
      gradient.addColorStop(1, "#5e528c");
      ctx.shadowColor = "#54547935";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(marble.x, marble.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#ffffffb0";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (hover && !active) {
      ctx.strokeStyle =
        tool === "drop"
          ? "#aa80d1"
          : COLORS[Number($("marble-note").value) || 0];
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, tool === "drop" ? 11 : 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.scale,
      y: (event.clientY - rect.top - view.y) / view.scale,
    };
  }
  function inside(point) {
    return (
      point.x >= 0 && point.x <= WIDTH && point.y >= 0 && point.y <= HEIGHT
    );
  }
  function bounded(point) {
    return { x: clamp(point.x, 0, WIDTH), y: clamp(point.y, 0, HEIGHT) };
  }
  function appendPoint(event) {
    const value = bounded(point(event)),
      previous = active.points.at(-1);
    if (
      !previous ||
      Math.hypot(value.x - previous.x, value.y - previous.y) >= 2
    )
      active.points.push(value);
    if (active.points.length > 1024)
      active.points = active.points.filter(
        (_, i, array) => i % 2 === 0 || i === array.length - 1,
      );
  }
  function cancelPointer() {
    const pointer = active?.pointerId;
    active = null;
    if (pointer != null && canvas.hasPointerCapture?.(pointer))
      canvas.releasePointerCapture(pointer);
    redraw();
  }
  function simplify(points, tolerance) {
    if (points.length <= 2) return points;
    const first = points[0],
      last = points.at(-1),
      dx = last.x - first.x,
      dy = last.y - first.y,
      length = dx * dx + dy * dy;
    let furthest = -1,
      distance = tolerance * tolerance;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i],
        t = length
          ? clamp(((p.x - first.x) * dx + (p.y - first.y) * dy) / length, 0, 1)
          : 0;
      const d = (p.x - first.x - t * dx) ** 2 + (p.y - first.y - t * dy) ** 2;
      if (d > distance) {
        distance = d;
        furthest = i;
      }
    }
    if (furthest < 0) return [first, last];
    return [
      ...simplify(points.slice(0, furthest + 1), tolerance).slice(0, -1),
      ...simplify(points.slice(furthest), tolerance),
    ];
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (
      !loaded ||
      !visible ||
      document.hidden ||
      active ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    const start = point(event);
    if (!inside(start)) return;
    event.preventDefault();
    active = {
      kind: tool,
      pointerId: event.pointerId,
      start,
      points: [bounded(start)],
      note: clamp(Number($("marble-note").value) || 0, 0, 7),
    };
    canvas.setPointerCapture(event.pointerId);
    redraw();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!loaded) return;
    const current = point(event);
    hover = event.pointerType === "touch" || !inside(current) ? null : current;
    if (active?.pointerId === event.pointerId) {
      event.preventDefault();
      if (active.kind === "draw") {
        const samples = event.getCoalescedEvents?.() || [];
        for (const sample of samples.length ? samples : [event])
          appendPoint(sample);
      }
    }
    redraw();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (active?.pointerId !== event.pointerId) return;
    const released = point(event),
      gesture = active;
    if (gesture.kind === "draw") {
      const final = bounded(released),
        previous = gesture.points.at(-1);
      if (final.x !== previous.x || final.y !== previous.y)
        gesture.points.push(final);
    }
    active = null;
    if (canvas.hasPointerCapture?.(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (gesture.kind === "drop") {
      if (
        inside(released) &&
        Math.hypot(released.x - gesture.start.x, released.y - gesture.start.y) <
          20
      ) {
        const marble = addMarble(world, released.x, released.y);
        status(
          marble
            ? "A new marble. Press Play whenever you’re ready."
            : "The board is full. Restart to release a fresh set.",
        );
      }
    } else {
      let tolerance = 1.5,
        points = simplify(gesture.points, tolerance);
      while (points.length > MAX_POINTS)
        points = simplify(gesture.points, (tolerance *= 1.5));
      const distance = points.reduce(
        (sum, point, i) =>
          i
            ? sum +
              Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y)
            : sum,
        0,
      );
      const total = scene.tracks.reduce(
        (sum, track) => sum + track.points.length,
        0,
      );
      if (points.length >= 2 && distance >= 10) {
        if (
          scene.tracks.length >= MAX_TRACKS ||
          total + points.length > MAX_TOTAL_POINTS
        ) {
          notify(
            "This board is full of rails. Undo or clear a few before adding another.",
          );
        } else {
          remember();
          scene.tracks.push({
            id: `rail-${Date.now().toString(36)}-${++railId}`,
            points,
            note: gesture.note,
          });
          rebuild({ preserve: true });
          saveSoon();
          status(`A ${NOTES[gesture.note]} rail, ready to play.`);
        }
      }
    }
    updateControls();
    redraw();
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (active?.pointerId === event.pointerId) cancelPointer();
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (active?.pointerId === event.pointerId) cancelPointer();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    redraw();
  });

  $("marble-play").onclick = () =>
    playing ? pause("Paused. Press Play to continue.") : play();
  $("marble-sound").onclick = () => {
    if (!loaded) return;
    if (scene.volume > 0) {
      setVolume(0);
      status("Sound off.");
    } else {
      setVolume(lastVolume || 0.5);
      armAudio();
      status(playing ? "Sound on." : "Sound on. Press Play to hear the rails.");
    }
  };
  for (const value of ["draw", "drop"])
    $(`marble-tool-${value}`).onclick = () => {
      if (!loaded) return;
      cancelPointer();
      tool = value;
      updateControls();
      redraw();
    };
  $("marble-undo").onclick = () => {
    if (!loaded || !history.length) return;
    const previous = history.pop();
    replaceScene(
      previous.kind === "tracks"
        ? { ...snapshot(), tracks: previous.scene.tracks }
        : previous.scene,
      "Last scene edit undone.",
      { record: false },
    );
  };
  $("marble-clear").onclick = () => {
    if (!loaded) return;
    pause();
    cancelPointer();
    remember();
    scene.tracks = [];
    hits = 0;
    rebuild();
    saveSoon();
    status("A fresh board. Draw your first rail.");
  };
  $("marble-reset").onclick = () => {
    if (!loaded) return;
    pause();
    cancelPointer();
    hits = 0;
    elapsed = 0;
    rebuild({ preview: true });
    status("Marbles reset. Your rails are ready for another run.");
  };
  $("marble-demo").onclick = () =>
    replaceScene(DEMO_SCENE, "Demo loaded. Press Play and listen.");
  $("marble-gravity").oninput = (event) => {
    if (!loaded) return;
    scene.gravity = clamp(Number(event.target.value) || 100, 100, 1200);
    world.gravity = scene.gravity;
    updateControls();
    saveSoon();
  };
  $("marble-volume").oninput = (event) => {
    if (!loaded) return;
    setVolume(Number(event.target.value) || 0);
    if (playing && scene.volume > 0) armAudio();
  };
  $("marble-note").onchange = redraw;
  $("marble-export").onclick = () => {
    if (!loaded) return;
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "marble-music.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify("Marble Music scene ready in Downloads.");
  };
  $("marble-import").onclick = () => {
    if (loaded) $("marble-file").click();
  };
  $("marble-file").onchange = async (event) => {
    const input = event.target,
      file = input.files[0];
    if (!file) return;
    if (!loaded) {
      input.value = "";
      return;
    }
    const atEpoch = sceneEpoch;
    try {
      if (file.size > 512 * 1024)
        throw new Error("Keep a Marble Music scene below 512 KB.");
      const value = validateScene(JSON.parse(await file.text()));
      if (!loaded || atEpoch !== sceneEpoch) return;
      replaceScene(value, "Scene imported. Press Play to try it.");
      notify("Marble Music scene imported.");
    } catch (error) {
      notify(`Import failed; your scene was kept. ${error.message || error}`);
    } finally {
      input.value = "";
    }
  };
  canvas.addEventListener("keydown", (event) => {
    if (!loaded) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      $("marble-undo").click();
    } else if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      $("marble-play").click();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelPointer();
      pause("Paused while you were away. Press Play to continue.");
      if (saveTimer) queueSave();
    } else if (visible) {
      resize();
      redraw();
    }
  });
  window.addEventListener("pagehide", () => {
    cancelPointer();
    pause("Paused. Press Play to continue.");
    if (saveTimer) queueSave();
  });
  new ResizeObserver(resize).observe(stage);
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  seedPreview();
  updateControls();
  resize();
  status("Opening your Marble Music scene…");
  const ready = Promise.resolve(loadScene)
    .then((saved) => {
      if (saved != null) scene = validateScene(saved);
      if (scene.volume > 0) lastVolume = scene.volume;
      world = createWorld(scene);
      seedPreview();
      status(
        saved != null
          ? "Your scene is ready. Press Play."
          : "Draw a little, listen a lot. Press Play to try the demo.",
      );
    })
    .catch((error) => {
      scene = validateScene(DEMO_SCENE);
      world = createWorld(scene);
      seedPreview();
      status("The demo is ready. Your saved scene could not open.");
      notify(`Marble Music opened the demo: ${error.message || error}`);
    })
    .then(() => {
      loaded = true;
      updateControls();
      resize();
      paint();
      canvas.dataset.ready = "true";
    });
  return {
    ready,
    snapshot,
    redraw,
    async replaceSavedScene(value, persistChange) {
      // Validation happens before queuing or disturbing the current scene.
      const next = validateScene(value === null ? DEMO_SCENE : value);
      if (typeof persistChange !== "function")
        throw new Error("A saved scene change needs a persistence callback.");
      const change = externalChanges.then(async () => {
        await ready;
        pause();
        cancelPointer();
        sceneEpoch++;
        if (saveTimer) queueSave();
        loaded = false;
        updateControls();
        try {
          await saveChain;
          status("Updating your saved scene…");
          await persistChange();
          scene = next;
          if (scene.volume > 0) lastVolume = scene.volume;
          hits = 0;
          elapsed = 0;
          history = [];
          revision++;
          rebuild({ preview: true });
          status("Your scene is ready. Press Play.");
        } catch (error) {
          status("The update failed. Your current scene was kept.");
          throw error;
        } finally {
          loaded = true;
          updateControls();
          if (visible && !document.hidden) paint();
          redraw();
        }
      });
      externalChanges = change.catch(() => {});
      await change;
    },
    setVisible(value) {
      visible = Boolean(value);
      if (!visible) {
        cancelPointer();
        pause("Paused. Press Play to continue.");
        if (saveTimer) queueSave();
      } else {
        resize();
        redraw();
      }
    },
  };
}
