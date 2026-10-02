import {
  VIEW_WIDTH,
  VIEW_HEIGHT,
  LEVEL,
  createGame,
  stepGame,
} from "./platformer-engine.js";

const INK = "#173e51";
const KEY_ACTIONS = new Map([
  ["ArrowLeft", "left"],
  ["KeyA", "left"],
  ["ArrowRight", "right"],
  ["KeyD", "right"],
  ["ArrowUp", "jump"],
  ["KeyW", "jump"],
  ["Space", "jump"],
]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createPlatformer({ notify = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const canvas = $("platformer-canvas"),
    stage = $("platformer-stage");
  const panel =
    $("panel-jump") || stage.closest("[role=tabpanel]") || stage.parentElement;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("The Pocket Jump canvas could not open.");
  let game = createGame();
  game.phase = "ready";
  let visible = !panel.hidden,
    frame = 0,
    previousTime = 0,
    elapsed = 0,
    cameraX = 0,
    stomps = 0;
  let size = { width: VIEW_WIDTH, height: VIEW_HEIGHT, dpr: 1 },
    view = { scale: 1, x: 0, y: 0 };
  let sound = true,
    audio = null,
    master = null,
    unavailable = false;
  let particles = [];
  const voices = new Set(),
    keys = new Map(),
    pointers = new Map();
  const input = {
    left: false,
    right: false,
    jump: false,
    jumpPressed: false,
    jumpReleased: false,
  };

  function collectedCoins() {
    if (typeof game.coinCount === "number") return game.coinCount;
    if (typeof game.collectedCoins === "number") return game.collectedCoins;
    return Array.isArray(game.coins)
      ? game.coins.filter((coin) => coin.collected).length
      : Number(game.coins) || 0;
  }
  function announce(message) {
    $("platformer-status").textContent = message;
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
  function updateHud() {
    const coins = collectedCoins();
    $("platformer-score").textContent = String(game.score || 0);
    $("platformer-coins").textContent = String(coins);
    $("platformer-lives").textContent =
      "♥".repeat(Math.max(0, game.lives || 0)) || "0";
    $("platformer-lives").setAttribute(
      "aria-label",
      `${game.lives || 0} lives`,
    );
    canvas.dataset.phase = game.phase;
    canvas.dataset.x = game.player.x.toFixed(2);
    canvas.dataset.y = game.player.y.toFixed(2);
    canvas.dataset.grounded = String(game.player.grounded);
    canvas.dataset.coins = String(coins);
    canvas.dataset.score = String(game.score || 0);
    canvas.dataset.lives = String(game.lives || 0);
    canvas.dataset.enemies = String(
      game.enemies.filter((enemy) => enemy.alive).length,
    );
    canvas.dataset.stomps = String(stomps);
  }
  function updateOverlay() {
    const phase = game.phase;
    $("platformer-overlay").hidden = phase === "playing";
    const copy = {
      ready: [
        "Pocket Jump",
        "A little sprout, a big adventure. Collect coins and hop over the purple blobs.",
        "Start",
      ],
      paused: [
        "Paused",
        "Your sprout is right where you left it. Ready for another hop?",
        "Resume",
      ],
      won: [
        "You made it!",
        `${collectedCoins()} coins in your pocket. The hill is yours.`,
        "Play again",
      ],
      gameover: [
        "One more hop?",
        "A fresh start, with three new hearts. You’ve got this.",
        "Play again",
      ],
    }[phase];
    if (copy) {
      $("platformer-overlay-title").textContent = copy[0];
      $("platformer-overlay-text").textContent = copy[1];
      $("platformer-action").textContent = copy[2];
    }
    $("platformer-play").textContent =
      phase === "playing" ? "Pause" : copy?.[2] || "Start";
    $("platformer-play").setAttribute(
      "aria-pressed",
      String(phase === "playing"),
    );
    $("platformer-sound").textContent = sound ? "Sound on" : "Sound off";
    $("platformer-sound").setAttribute("aria-pressed", String(sound));
    for (const action of ["left", "right", "jump"])
      $("platformer-" + action).disabled = phase !== "playing";
    updateHud();
  }
  function refreshInput() {
    const previousJump = input.jump;
    for (const action of ["left", "right", "jump"]) {
      input[action] =
        [...keys.values()].includes(action) ||
        [...pointers.values()].some((pointer) => pointer.action === action);
      const button = $("platformer-" + action);
      button.dataset.held = String(input[action]);
      button.setAttribute("aria-pressed", String(input[action]));
    }
    if (!previousJump && input.jump) input.jumpPressed = true;
    if (previousJump && !input.jump) input.jumpReleased = true;
  }
  function clearInput() {
    keys.clear();
    const held = [...pointers.entries()];
    pointers.clear();
    for (const [id, pointer] of held) {
      if (pointer.button.hasPointerCapture?.(id))
        pointer.button.releasePointerCapture(id);
    }
    refreshInput();
    input.jumpPressed = false;
  }

  function stopVoices() {
    if (!audio) return;
    for (const voice of voices) {
      try {
        voice.oscillator.stop(audio.currentTime);
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
    if (audio && audio.state !== "closed")
      audio.suspend().then(audioState).catch(audioState);
    audioState();
  }
  function armAudio() {
    if (!sound || !visible || document.hidden) return;
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) {
          if (!unavailable)
            notify("Sound is unavailable here. Your sprout can still play.");
          unavailable = true;
          audioState();
          return;
        }
        audio = new Audio();
        master = audio.createGain();
        master.gain.value = 0.2;
        master.connect(audio.destination);
        audio.addEventListener("statechange", audioState);
      }
      // Preserve the Start/Sound button's activation by resuming immediately.
      const resumed = audio.resume();
      audioState();
      Promise.resolve(resumed)
        .then(() => {
          audioState();
          if (!sound || !visible || document.hidden || game.phase !== "playing")
            silence();
        })
        .catch((error) =>
          notify(`Sound could not start: ${error.message || error}`),
        );
    } catch (error) {
      notify(`Sound could not start: ${error.message || error}`);
      audioState();
    }
  }
  function tone(frequency, end, duration = 0.18, delay = 0, type = "sine") {
    if (
      !sound ||
      !audio ||
      audio.state !== "running" ||
      !visible ||
      document.hidden ||
      voices.size >= 10
    )
      return;
    const oscillator = audio.createOscillator(),
      gain = audio.createGain(),
      now = audio.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    gain.gain.linearRampToValueAtTime(0, now + duration + 0.02);
    oscillator.connect(gain);
    gain.connect(master);
    const voice = { oscillator, gain };
    voices.add(voice);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      voices.delete(voice);
      if (!voices.size && game.phase !== "playing") silence();
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }
  function eventSound(type) {
    if (type === "jump") tone(250, 510, 0.14, 0, "triangle");
    if (type === "coin") {
      tone(880, 880, 0.1);
      tone(1320, 1320, 0.18, 0.08);
    }
    if (type === "stomp") tone(220, 90, 0.13, 0, "triangle");
    if (type === "hurt") tone(180, 75, 0.25, 0, "triangle");
    if (type === "win")
      [330, 440, 660, 880].forEach((frequency, i) =>
        tone(frequency, frequency, 0.3, i * 0.1),
      );
  }

  function pause(message = "Paused. Press Resume when you’re ready.") {
    if (game.phase === "playing") game.phase = "paused";
    previousTime = 0;
    clearInput();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    silence();
    updateOverlay();
    if (game.phase === "paused") announce(message);
    redraw();
  }
  function reset() {
    pause();
    game = createGame();
    game.phase = "ready";
    cameraX = 0;
    elapsed = 0;
    particles = [];
    stomps = 0;
    input.jumpReleased = false;
    updateOverlay();
    announce("A fresh adventure. Press Start to play.");
    redraw();
  }
  function start() {
    if (!visible || document.hidden) return;
    if (game.phase === "won" || game.phase === "gameover") reset();
    game.phase = "playing";
    previousTime = 0;
    armAudio();
    updateOverlay();
    announce("Off you go. Move left or right, and hold jump for a higher hop.");
    redraw();
    canvas.focus({ preventScroll: true });
  }
  function action() {
    game.phase === "playing" ? pause() : start();
  }
  function burst(x, y, color) {
    for (let i = 0; i < 7; i++)
      particles.push({
        x,
        y,
        vx: Math.cos((i * Math.PI * 2) / 7) * 70,
        vy: Math.sin((i * Math.PI * 2) / 7) * 70 - 45,
        age: 0,
        color,
      });
    if (particles.length > 70) particles.splice(0, particles.length - 70);
  }
  function handleEvents(events) {
    for (const event of events) {
      const type = typeof event === "string" ? event : event.type;
      eventSound(type);
      const x = event.x ?? game.player.x + game.player.w / 2,
        y = event.y ?? game.player.y;
      if (type === "coin") {
        burst(x, y, "#ffda69");
        const count = collectedCoins();
        if (count === 1 || count % 5 === 0)
          announce(`${count} coin${count === 1 ? "" : "s"} in your pocket.`);
      } else if (type === "stomp") {
        stomps++;
        burst(x, y, "#b39bea");
        announce("A good hop. Blob bounced!");
      } else if (type === "hurt") {
        burst(x, y, "#f3a184");
        announce(
          `${game.lives} heart${game.lives === 1 ? "" : "s"} left. Take your time.`,
        );
      } else if (type === "checkpoint")
        announce("Checkpoint! Your next fresh start will be here.");
      else if (type === "win")
        announce(
          `You made it to the pennant with ${collectedCoins()} coins. Well hopped.`,
        );
      else if (type === "gameover")
        announce("The adventure is over. Press Play again for a fresh start.");
    }
  }
  function animate(time) {
    frame = 0;
    if (!visible || document.hidden) return;
    if (game.phase === "playing") {
      const dt = previousTime
        ? clamp((time - previousTime) / 1000, 0, 0.05)
        : 0;
      previousTime = time;
      if (dt) {
        const oldPhase = game.phase;
        handleEvents(stepGame(game, input, dt));
        input.jumpPressed = false;
        input.jumpReleased = false;
        elapsed += dt;
        particles = particles.filter((particle) => {
          particle.age += dt;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vy += 180 * dt;
          return particle.age < 0.55;
        });
        cameraX = game.cameraX;
        if (game.phase !== oldPhase) {
          clearInput();
          updateOverlay();
          if (game.phase === "gameover")
            announce(
              "The adventure is over. Press Play again for a fresh start.",
            );
          if (game.phase !== "won") silence();
        }
      }
      updateHud();
    }
    paint();
    if (game.phase === "playing") frame = requestAnimationFrame(animate);
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
    view.scale = Math.min(size.width / VIEW_WIDTH, size.height / VIEW_HEIGHT);
    view.x = (size.width - VIEW_WIDTH * view.scale) / 2;
    view.y = (size.height - VIEW_HEIGHT * view.scale) / 2;
    redraw();
  }
  function rectangle(x, y, width, height, fill, outline = true) {
    ctx.fillStyle = outline ? INK : fill;
    ctx.fillRect(Math.round(x), Math.round(y), width, height);
    if (outline) {
      ctx.fillStyle = fill;
      ctx.fillRect(
        Math.round(x) + 3,
        Math.round(y) + 3,
        Math.max(0, width - 6),
        Math.max(0, height - 6),
      );
    }
  }
  function cloud(x, y, scale = 1) {
    ctx.fillStyle = "#f7fcff";
    ctx.fillRect(x, y + 16 * scale, 96 * scale, 24 * scale);
    ctx.fillRect(x + 15 * scale, y + 5 * scale, 54 * scale, 30 * scale);
    ctx.fillRect(x + 37 * scale, y, 32 * scale, 36 * scale);
    ctx.fillStyle = "#d9f0f7";
    ctx.fillRect(x + 9 * scale, y + 37 * scale, 78 * scale, 3 * scale);
  }
  function hill(x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width * 0.2, y - height * 0.65);
    ctx.lineTo(x + width * 0.38, y - height);
    ctx.lineTo(x + width * 0.62, y - height);
    ctx.lineTo(x + width * 0.8, y - height * 0.65);
    ctx.lineTo(x + width, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff25";
    ctx.fillRect(x + width * 0.38, y - height + 12, width * 0.24, 8);
  }
  function solid(block) {
    const x = block.x,
      y = block.y,
      width = block.w ?? block.width,
      height = block.h ?? block.height;
    if (x + width < cameraX - 4 || x > cameraX + VIEW_WIDTH + 4) return;
    const special =
      block.type === "block" ||
      block.type === "bonus" ||
      block.type === "question";
    rectangle(x, y, width, height, special ? "#e7b763" : "#b8785c");
    if (special && !block.used) {
      ctx.fillStyle = "#fff0b8";
      const middle = x + width / 2;
      ctx.beginPath();
      ctx.moveTo(middle, y + 11);
      ctx.lineTo(middle + 9, y + height / 2);
      ctx.lineTo(middle, y + height - 11);
      ctx.lineTo(middle - 9, y + height / 2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 3, y + 3, width - 6, height - 6);
      ctx.clip();
      ctx.fillStyle = "#945c4e";
      for (let row = 0; row < height; row += 24) {
        ctx.fillRect(x, y + row + 22, width, 2);
        for (let col = row % 48 ? -24 : 0; col < width; col += 48)
          ctx.fillRect(x + col + 46, y + row, 2, 24);
      }
      ctx.restore();
      if (block.type === "ground" || block.type === "platform") {
        ctx.fillStyle = "#64b78c";
        ctx.fillRect(x + 3, y + 3, width - 6, 7);
        ctx.fillStyle = "#8ed5a5";
        ctx.fillRect(x + 3, y + 3, width - 6, 3);
      }
    }
  }
  function coin(coin) {
    if (coin.collected) return;
    const x = coin.x,
      y = coin.y,
      radius = coin.r ?? coin.radius ?? 11;
    if (x < cameraX - radius || x > cameraX + VIEW_WIDTH + radius) return;
    const width = Math.max(
      5,
      Math.abs(Math.cos(elapsed * 3.5 + x * 0.025)) * 16,
    );
    rectangle(x - width / 2, y - radius, width, radius * 2, "#f5ce62");
    ctx.fillStyle = "#fff3b3";
    ctx.fillRect(
      x - width / 2 + 3,
      y - radius + 4,
      Math.max(2, width / 3),
      radius * 2 - 8,
    );
  }
  function enemy(enemy) {
    if (enemy.alive === false || enemy.dead) return;
    const x = Math.round(enemy.x),
      y = Math.round(enemy.y),
      width = enemy.w ?? 34,
      height = enemy.h ?? 28;
    if (x + width < cameraX || x > cameraX + VIEW_WIDTH) return;
    const bob = game.phase === "playing" ? Math.sin(elapsed * 9 + x) * 1.5 : 0;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 4, y + bob, width - 8, height - 3);
    ctx.fillRect(x, y + 8 + bob, width, height - 11);
    ctx.fillStyle = "#a08bd1";
    ctx.fillRect(x + 7, y + 3 + bob, width - 14, height - 9);
    ctx.fillRect(x + 3, y + 11 + bob, width - 6, height - 17);
    ctx.fillStyle = "#f4eeff";
    ctx.fillRect(x + 8, y + 10 + bob, 6, 7);
    ctx.fillRect(x + width - 14, y + 10 + bob, 6, 7);
    ctx.fillStyle = INK;
    ctx.fillRect(x + 10, y + 12 + bob, 3, 4);
    ctx.fillRect(x + width - 13, y + 12 + bob, 3, 4);
    ctx.fillRect(x + 5, y + height - 5, 9, 5);
    ctx.fillRect(x + width - 14, y + height - 5, 9, 5);
  }
  function hero() {
    const p = game.player,
      x = Math.round(p.x),
      y = Math.round(p.y),
      width = p.w,
      height = p.h;
    if (p.invincible > 0 && Math.floor(elapsed * 14) % 2)
      ctx.globalAlpha = 0.45;
    const stride =
      p.grounded && Math.abs(p.vx) > 20 && game.phase === "playing"
        ? Math.sin(elapsed * 16) * 3
        : 0;
    rectangle(x + 3, y + 10, width - 6, height - 17, "#63bd87");
    rectangle(x + 8, y + 3, width - 14, 12, "#9ad79b");
    ctx.fillStyle = "#4a976a";
    ctx.fillRect(x + width / 2 - 2, y, 4, 9);
    ctx.fillRect(x + width / 2 + 1, y + 1, 9, 4);
    const eyes = p.facing < 0 ? x + 6 : x + width - 16;
    ctx.fillStyle = "#f7fff1";
    ctx.fillRect(eyes, y + 17, 5, 6);
    ctx.fillRect(eyes + 7, y + 17, 5, 6);
    ctx.fillStyle = INK;
    ctx.fillRect(eyes + (p.facing < 0 ? 0 : 2), y + 19, 3, 4);
    ctx.fillRect(eyes + 7 + (p.facing < 0 ? 0 : 2), y + 19, 3, 4);
    rectangle(x + 2, y + height - 10 + stride, 13, 10, "#eca889");
    rectangle(x + width - 15, y + height - 10 - stride, 13, 10, "#eca889");
    ctx.globalAlpha = 1;
  }
  function pennant(item, active, isGoal = false) {
    if (!item) return;
    const x = item.x,
      floor = item.y + (item.h || item.height || 0) || 432,
      height = isGoal ? 140 : 86;
    rectangle(x, floor - height, 7, height, "#c0e3dc");
    ctx.fillStyle = active || isGoal ? "#f1ba68" : "#93c8c5";
    ctx.beginPath();
    ctx.moveTo(x + 7, floor - height + 5);
    ctx.lineTo(x + 61, floor - height + 20);
    ctx.lineTo(x + 7, floor - height + 39);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#fff4b8";
    ctx.fillRect(x + 14, floor - height + 16, 9, 9);
    rectangle(x - 12, floor - 4, 33, 8, "#71b894");
  }
  function paint() {
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = "#173e51";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();
    ctx.fillStyle = "#87cfea";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.fillStyle = "#a8dff0";
    ctx.fillRect(0, 280, VIEW_WIDTH, 260);
    for (let i = -1; i < 8; i++) {
      const x = i * 240 - cameraX * 0.14;
      cloud(x + 60, 64 + (i % 3) * 26, i % 2 ? 0.8 : 1.1);
      hill(x - 100, 435, 410, 128 + (i % 3) * 25, "#a1d6c6");
    }
    for (let i = -1; i < 13; i++)
      hill(i * 270 - cameraX * 0.3, 461, 330, 88 + (i % 2) * 25, "#76bca5");
    ctx.save();
    ctx.translate(-Math.round(cameraX), 0);
    for (const block of game.solids || []) solid(block);
    pennant(LEVEL.checkpoint, Boolean(game.checkpointActive));
    pennant(LEVEL.goal, game.phase === "won", true);
    for (const item of Array.isArray(game.coins)
      ? game.coins
      : LEVEL.coins || [])
      coin(item);
    for (const blob of game.enemies || []) enemy(blob);
    hero();
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, 1 - particle.age / 0.55);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x - 3, particle.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();
  }

  function keyboardAllowed(event) {
    const target = document.activeElement || event.target;
    if (
      !visible ||
      document.hidden ||
      game.phase !== "playing" ||
      !panel.contains(target)
    )
      return false;
    if (target.matches?.("input, textarea, select, [contenteditable=true]"))
      return false;
    if (
      event.code === "Space" &&
      target.tagName === "BUTTON" &&
      !["platformer-left", "platformer-right", "platformer-jump"].includes(
        target.id,
      )
    )
      return false;
    return true;
  }
  document.addEventListener("keydown", (event) => {
    const target = document.activeElement || event.target;
    const control = ["left", "right", "jump"].find(
      (name) => target.id === "platformer-" + name,
    );
    const action =
      control && ["Space", "Enter"].includes(event.code)
        ? control
        : KEY_ACTIONS.get(event.code);
    if (!action || !keyboardAllowed(event)) return;
    event.preventDefault();
    keys.set(event.code, action);
    refreshInput();
  });
  document.addEventListener("keyup", (event) => {
    if (!keys.has(event.code)) return;
    if (visible && !document.hidden) event.preventDefault();
    keys.delete(event.code);
    refreshInput();
  });
  for (const name of ["left", "right", "jump"]) {
    const button = $("platformer-" + name);
    button.addEventListener("pointerdown", (event) => {
      if (
        !visible ||
        document.hidden ||
        game.phase !== "playing" ||
        event.button !== 0
      )
        return;
      event.preventDefault();
      pointers.set(event.pointerId, { action: name, button });
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic events do not own a native pointer. */
      }
      refreshInput();
      canvas.focus({ preventScroll: true });
    });
    const release = (event) => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer || pointer.button !== button) return;
      pointers.delete(event.pointerId);
      if (button.hasPointerCapture?.(event.pointerId))
        button.releasePointerCapture(event.pointerId);
      refreshInput();
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }
  $("platformer-play").onclick = action;
  $("platformer-action").onclick = action;
  $("platformer-restart").onclick = reset;
  $("platformer-sound").onclick = () => {
    sound = !sound;
    sound ? armAudio() : silence();
    updateOverlay();
    announce(sound ? "Sound on." : "Sound off.");
  };
  document.addEventListener("focusin", (event) => {
    if (!panel.contains(event.target)) clearInput();
  });
  window.addEventListener("blur", () =>
    pause("Paused while you were away. Press Resume to keep hopping."),
  );
  window.addEventListener("pagehide", () => pause());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden)
      pause("Paused while you were away. Press Resume to keep hopping.");
    else if (visible) {
      resize();
      redraw();
    }
  });
  new ResizeObserver(resize).observe(stage);
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  refreshInput();
  updateOverlay();
  resize();
  paint();
  canvas.dataset.ready = "true";
  audioState();
  announce("Press Start, then move and jump. Hold jump for a higher hop.");
  return {
    redraw,
    setVisible(value) {
      visible = Boolean(value);
      if (!visible) pause();
      else {
        resize();
        redraw();
      }
    },
    snapshot() {
      return {
        phase: game.phase,
        x: game.player.x,
        y: game.player.y,
        vx: game.player.vx,
        vy: game.player.vy,
        grounded: game.player.grounded,
        score: game.score || 0,
        coins: collectedCoins(),
        lives: game.lives,
        cameraX,
        enemies: game.enemies.filter((enemy) => enemy.alive).length,
        stomps,
        checkpointActive: game.checkpointActive,
      };
    },
  };
}
