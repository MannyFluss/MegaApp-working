// Shared between the in-app viewer and the exported, self-contained replay.
export function mountMomentReplay(root, moment) {
  root.innerHTML = `<div class="moment-replay-stage"><div class="moment-replay-tile">Follow me</div><p class="moment-replay-words"></p><p class="moment-replay-message"></p></div><details class="moment-replay-document" hidden><summary>Design document at this moment</summary><h3></h3><p class="moment-replay-introduction"></p><div class="moment-replay-principles"></div><p class="moment-replay-layout"></p></details><div class="moment-replay-controls"><button type="button">Play replay</button><label>Replay position <input type="range" min="0" max="1" step="1" value="0"></label><output></output></div><p class="moment-replay-limit"></p>`;
  const stage = root.querySelector(".moment-replay-stage"), tile = root.querySelector(".moment-replay-tile"), words = root.querySelector(".moment-replay-words"), message = root.querySelector(".moment-replay-message"), play = root.querySelector("button"), range = root.querySelector("input"), clock = root.querySelector("output");
  range.max = String(Math.max(1, moment.duration));
  const frames = moment.events.filter(event => event.context).map(event => ({ time: event.time, state: event.context }));
  const initial = moment.baseline || frames[0]?.state || moment.context || null;
  let animation, started, position = 0;
  function draw(time) {
    position = Math.max(0, Math.min(moment.duration, time)); range.value = String(position);
    clock.textContent = `${(position / 1000).toFixed(1)} / ${(moment.duration / 1000).toFixed(1)} s`;
    const frame = frames.filter(value => value.time <= position).at(-1)?.state || initial;
    stage.hidden = frame?.app !== "design";
    root.querySelector(".moment-replay-limit").textContent = frame?.app === "design"
      ? "A reconstruction of the Design example. Scrub to inspect motion and text boundaries. The live app stays untouched."
      : "No Design frame at this point. This app has an interaction timeline; visual replay is not yet available for it.";
    const documentView = root.querySelector(".moment-replay-document"), design = frame?.designDocument;
    documentView.hidden = frame?.app !== "design" || !design;
    if (!documentView.hidden) {
      documentView.querySelector("h3").textContent = design.title;
      documentView.querySelector(".moment-replay-introduction").textContent = design.introduction;
      documentView.querySelector(".moment-replay-layout").textContent = `${design.layout.columns} column${design.layout.columns === 1 ? "" : "s"}; full width: ${design.layout.wide.join(", ") || "none"}.`;
      const body = documentView.querySelector(".moment-replay-principles"); body.replaceChildren();
      for (const id of design.layout.order) { const principle = design.principles.find(p => p.id === id); if (!principle) continue; const heading = document.createElement("h4"), text = document.createElement("p"); heading.textContent = principle.title; text.textContent = principle.text; body.append(heading, text); }
    }
    if (frame?.app !== "design") return;
    // Coordinates are fractions of the recorded board, preserving the gesture at any viewer size.
    const movement = frame.surface || { x: 0, y: 0 };
    tile.style.transform = `translate(${movement.x * stage.clientWidth}px,${movement.y * 115}px)`;
    tile.dataset.dragging = String(Boolean(movement.dragging));
    words.replaceChildren();
    for (const [index, word] of (frame.words || []).entries()) {
      const span = document.createElement("span"); span.textContent = `${word} `;
      const active = frame.edits?.find(edit => index >= edit.start && index < edit.end);
      if (active) { span.classList.add("moment-word-active"); if (index === active.start) span.classList.add("moment-word-start"); if (index === active.end - 1) span.classList.add("moment-word-end"); }
      if (frame.selection && index >= frame.selection.start && index < frame.selection.end) span.classList.add("moment-word-selected");
      if (frame.collision && active && frame.selection && index >= frame.selection.start && index < frame.selection.end) span.classList.add("moment-word-collision");
      words.append(span);
    }
    message.textContent = frame.message || "Recorded Design example";
  }
  function stop() { if (animation) cancelAnimationFrame(animation); animation = null; play.textContent = "Play replay"; }
  function tick(time) { draw(time - started); if (position >= moment.duration) stop(); else animation = requestAnimationFrame(tick); }
  play.onclick = () => {
    if (animation) { stop(); return; }
    if (position >= moment.duration) position = 0;
    started = performance.now() - position; play.textContent = "Pause replay"; animation = requestAnimationFrame(tick);
  };
  range.oninput = () => { stop(); draw(Number(range.value)); };
  const available = initial?.app === "design" || frames.some(frame => frame.state.app === "design");
  play.disabled = !available || !moment.duration; range.disabled = !available;
  root.querySelector(".moment-replay-limit").textContent = available
    ? "A reconstruction of the Design example. Scrub to inspect motion and text boundaries. The live app stays untouched."
    : "No Design frames in this range. This moment has an interaction timeline; visual replay is not yet available for this app.";
  draw(0);
  const observer = new ResizeObserver(() => draw(position)); observer.observe(root);
  return { dispose() { stop(); observer.disconnect(); }, draw };
}
export function momentReplayHTML(moment) {
  const data = JSON.stringify(moment).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My MegaApp moment</title><style>body{margin:24px auto;padding:0 20px;max-width:760px;font:16px/1.5 system-ui;background:#f0f0f3;color:#27262e}h1{font:36px Georgia}button,input{font:inherit;min-height:44px}button{padding:8px 16px;border:1px solid #d9d7e1;border-radius:12px;background:#fcfcfd}label{display:flex;align-items:center;gap:12px;flex:1}input{min-width:0;flex:1}.moment-replay-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.moment-replay-stage{position:relative;padding:138px 16px 16px;border:1px solid #d9d7e1;border-radius:20px;background:#e5e4eb;overflow:hidden}.moment-replay-tile{position:absolute;top:28px;left:calc(50% - 65px);width:130px;height:60px;display:grid;place-items:center;border:1px solid #d9d7e1;border-radius:16px;background:#fcfcfd;box-shadow:0 8px 24px #27262e15}.moment-replay-words{font:20px/1.6 Georgia}.moment-word-active{border-block:1px solid #27262e;background:#e5e4eb}.moment-word-start{border-left:2px solid #27262e}.moment-word-end{border-right:2px solid #27262e}.moment-word-selected{box-shadow:inset 0 -3px #5750b5}.moment-word-collision{background-image:repeating-linear-gradient(135deg,transparent,transparent 4px,#27262e33 4px,#27262e33 6px)}.moment-replay-document{margin:16px 0}.moment-replay-document summary{min-height:44px;cursor:pointer}.moment-replay-document p{white-space:pre-wrap}.moment-replay-message,.moment-replay-limit{font-size:14px;color:#696674}#note{white-space:pre-wrap}</style><h1>My moment.</h1><p id="note"></p><main id="replay"></main><script>const moment=${data};document.getElementById('note').textContent=moment.explanation||'No explanation supplied.';(${mountMomentReplay.toString()})(document.getElementById('replay'),moment);</script></html>`;
}
