// Three small live materials. The local search changes their visible properties.
export function createTasteSketch(canvas, candidate, { mode = 'touch', reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  const [pace, softness, spacing, cohesion, response, light, warmth] = candidate.values;
  const hue = 235 - warmth * 207, bright = light > .48;
  let width = 1, height = 1, frame = 0, visible = false, elapsed = 0, last = 0;
  let pointer = null, target = { x: .5, y: .5 }, hand = { ...target }, energy = 0;
  const observation = { candidateId: candidate.id, starts: 0, canceled: 0, omitted: 0, samples: [] };
  const began = performance.now();
  function observe(phase, x, y, source) {
    const sample = { phase, x, y, source: ['mouse', 'touch', 'pen', 'keyboard'].includes(source) ? source : 'mouse', t: Math.round(performance.now() - began) };
    if (observation.samples.length >= 96) { observation.samples.splice(1, 1); observation.omitted++; }
    observation.samples.push(sample);
  }
  function location(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function draw() {
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, `hsl(${hue} 27% ${bright ? 90 : 12}%)`);
    bg.addColorStop(1, `hsl(${hue + 24} 35% ${bright ? 79 : 23}%)`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    const cx = width * (.5 + (hand.x - .5) * energy * (.25 + response * .7));
    const cy = height * (.5 + (hand.y - .5) * energy * (.25 + response * .7));
    const scale = Math.min(width, height), time = elapsed * (.14 + pace * 1.15);
    const tint = (alpha = 1, offset = 0) => `hsla(${hue + offset} ${32 + softness * 35}% ${bright ? 26 + softness * 12 : 71 + softness * 13}% / ${alpha})`;
    ctx.lineCap = 'round';
    if (candidate.family === 'ribbons') {
      const count = 7 + Math.round((1 - spacing) * 13);
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        for (let j = 0; j <= 48; j++) {
          const x = j / 48 * width;
          const y = cy + (i - (count - 1) / 2) * scale * (.015 + spacing * .033)
            + Math.sin(j / 48 * Math.PI * (1.3 + cohesion * 1.8) + time + i * (.06 + (1 - cohesion) * .2)) * scale * (.06 + softness * .09 + energy * .06);
          j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = tint(.15 + .65 * Math.sin((i + 1) / (count + 1) * Math.PI), i * 2);
        ctx.lineWidth = 1 + softness * 4; ctx.stroke();
      }
    } else if (candidate.family === 'orbits') {
      const count = 4 + Math.round((1 - spacing) * 9);
      for (let i = 0; i < count; i++) {
        const radius = scale * (.13 + i / count * (.22 + spacing * .08));
        const angle = time * (i % 2 ? 1 : -1) + i * 2.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius, radius * (.45 + cohesion * .5), softness * .8, 0, Math.PI * 2);
        ctx.lineWidth = .6 + softness * 1.8; ctx.strokeStyle = tint(.14 + .28 * (1 - i / count)); ctx.stroke();
        const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius * (.45 + cohesion * .5);
        const size = scale * (.016 + softness * .026) * (1 - i / count * .4);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
        glow.addColorStop(0, tint(.3)); glow.addColorStop(1, tint(0));
        ctx.fillStyle = glow; ctx.fillRect(x - size * 4, y - size * 4, size * 8, size * 8);
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fillStyle = tint(.85, i * 9); ctx.fill();
      }
    } else {
      const columns = 5 + Math.round((1 - spacing) * 7), rows = Math.round(columns * height / width);
      for (let i = 0; i <= columns; i++) for (let j = 0; j <= rows; j++) {
        let x = (i + .5) / (columns + 1) * width, y = (j + .5) / (rows + 1) * height;
        const distance = Math.hypot(x - cx, y - cy) / scale;
        const wave = Math.sin(distance * (5 + cohesion * 10) - time * 2);
        const pull = energy * response * Math.max(0, 1 - distance) * .35;
        x += (cx - x) * pull; y += (cy - y) * pull;
        const radius = scale * (.004 + softness * .012) * (1.4 + wave * .7 + energy * .3);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = tint(.25 + (wave + 1) * .28, distance * 36); ctx.fill();
      }
    }
    if (pointer !== null || energy > .04) {
      ctx.beginPath(); ctx.arc(hand.x * width, hand.y * height, scale * (.017 + energy * .009), 0, Math.PI * 2);
      ctx.strokeStyle = tint(.8); ctx.lineWidth = 1; ctx.stroke();
    }
  }
  function animate(now) {
    frame = 0;
    if (!visible) return;
    const dt = Math.min(.035, (now - (last || now)) / 1000); last = now;
    elapsed += dt;
    const follow = reduced ? 1 : Math.min(1, dt * (3 + response * 22));
    hand.x += (target.x - hand.x) * follow; hand.y += (target.y - hand.y) * follow;
    if (pointer === null) energy = reduced ? 0 : Math.max(0, energy - dt * (.35 + pace * .7));
    draw();
    if ((mode === 'watch' && !reduced) || pointer !== null || energy > .005) frame = requestAnimationFrame(animate);
    else last = 0;
  }
  function wake() { if (visible && !frame) frame = requestAnimationFrame(animate); }
  function stopPointer(canceled = true) {
    if (pointer === null) return;
    if (canceled) { observation.canceled++; observe('cancel', target.x, target.y, pointer.source); }
    const held = pointer.id; pointer = null;
    if (canvas.hasPointerCapture?.(held)) canvas.releasePointerCapture(held);
    energy = 0; last = 0;
  }
  canvas.addEventListener('pointerdown', event => {
    if (mode !== 'touch' || pointer !== null || event.button > 0) return;
    target = location(event); pointer = { id: event.pointerId, source: event.pointerType };
    canvas.setPointerCapture(event.pointerId); observation.starts++; energy = 1;
    observe('start', target.x, target.y, event.pointerType); canvas.focus({ preventScroll: true }); wake();
  });
  canvas.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    target = location(event); energy = 1; observe('move', target.x, target.y, event.pointerType); wake();
  });
  canvas.addEventListener('pointerup', event => {
    if (pointer?.id !== event.pointerId) return;
    target = location(event); observe('end', target.x, target.y, event.pointerType);
    pointer = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); wake();
  });
  canvas.addEventListener('pointercancel', event => { if (pointer?.id === event.pointerId) stopPointer(); });
  canvas.addEventListener('lostpointercapture', event => { if (pointer?.id === event.pointerId) stopPointer(); });
  canvas.addEventListener('blur', () => stopPointer());
  canvas.addEventListener('keydown', event => {
    if (mode !== 'touch' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return;
    event.preventDefault();
    const delta = { ArrowLeft: [-.1, 0], ArrowRight: [.1, 0], ArrowUp: [0, -.1], ArrowDown: [0, .1], ' ': [0, 0] }[event.key];
    target = { x: Math.max(0, Math.min(1, target.x + delta[0])), y: Math.max(0, Math.min(1, target.y + delta[1])) };
    observation.starts++; observe('start', target.x, target.y, 'keyboard'); observe('end', target.x, target.y, 'keyboard'); energy = 1; wake();
  });
  const observer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  });
  observer.observe(canvas);
  function configure(nextMode, nextReduced) {
    stopPointer(); mode = nextMode; reduced = nextReduced;
    canvas.style.touchAction = mode === 'touch' ? 'none' : 'pan-y';
    canvas.dataset.mode = mode; canvas.dataset.family = candidate.family;
    if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; draw();
    if (mode === 'watch' && !reduced) wake();
  }
  configure(mode, reduced);
  return {
    setVisible(value) {
      visible = value;
      if (!value) { stopPointer(); cancelAnimationFrame(frame); frame = 0; last = 0; }
      else { draw(); if (mode === 'watch' && !reduced) wake(); }
      canvas.dataset.running = String(value && mode === 'watch' && !reduced);
    },
    configure,
    observation: () => structuredClone(observation),
    dispose() { visible = false; stopPointer(); cancelAnimationFrame(frame); observer.disconnect(); },
  };
}
