import { emptyMarkup, readMarkup, projectStroke } from './page-markup.js';
import { storageName } from './environment.js';

export function createDesignMarkup({ root, onAction }) {
  const tools = document.createElement('details'); tools.className = 'design-markup-tools'; tools.innerHTML = `<summary>Pencil markup</summary><div class="design-markup-controls"><label><input id="markup-enabled" type="checkbox" checked> Pencil draws over this page</label><label>Ink <input id="markup-color" type="color" value="#ad405b"></label><label>Width <input id="markup-width" type="range" min="1" max="12" step="1" value="3"></label><button id="markup-undo" type="button" class="quiet-button">Undo mark</button><button id="markup-redo" type="button" class="quiet-button">Redo</button><button id="markup-clear" type="button" class="quiet-button">Clear marks</button><label><input id="markup-any-pointer" type="checkbox"> Draw with any pointer</label><p>Fingers keep normal selection and scrolling. Marks scale with their part of the page; text can reflow underneath. Draw with any pointer temporarily owns page gestures. Turn it off to read normally.</p><p id="markup-status" role="status">Marks save on this device and travel with your kept feedback.</p></div>`;
  root.querySelector('.design-footnote').append(tools);
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); overlay.classList.add('design-ink'); overlay.setAttribute('aria-hidden', 'true'); root.append(overlay);
  const enabled = tools.querySelector('#markup-enabled'), any = tools.querySelector('#markup-any-pointer'), status = tools.querySelector('#markup-status');
  const key = storageName('megaapp.design.markup.v1');
  let ink = emptyMarkup(), future = [], unreadable = '', current = null, started = 0, moved = false, paintPending = false, savedError = '';
  try {
    unreadable = localStorage.getItem(key) || '';
    if (unreadable) {
      const saved = JSON.parse(unreadable); ink = readMarkup(saved);
      const prefs = saved.preferences;
      if (typeof prefs?.enabled === 'boolean') enabled.checked = prefs.enabled;
      if (/^#[\da-f]{6}$/i.test(prefs?.color || '')) tools.querySelector('#markup-color').value = prefs.color;
      if (Number.isFinite(prefs?.width) && prefs.width >= 1 && prefs.width <= 12) tools.querySelector('#markup-width').value = String(prefs.width);
    }
  }
  catch {
    if (unreadable) {
      savedError = 'Existing marks could not be read. They remain in storage; export or recover them before drawing new marks.'; status.textContent = savedError; enabled.checked = false; enabled.disabled = true;
      const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'quiet-button'; recover.textContent = 'Export unreadable marks';
      recover.onclick = () => { const url = URL.createObjectURL(new Blob([unreadable], { type: 'text/plain' })), link = document.createElement('a'); link.href = url; link.download = 'megaapp-unreadable-page-marks.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
      tools.querySelector('.design-markup-controls').append(recover);
    } else status.textContent = 'Device storage is unavailable. Marks can stay in this session; keep and export feedback before leaving.';
  }
  function areaNode(id) {
    if (id.startsWith('principle:')) return [...root.querySelectorAll('.design-principle')].find(node => node.dataset.principle === id.slice(10));
    if (id === 'context-toy') return root.querySelector('#design-context-toy');
    if (id === 'masthead') return root.querySelector('.design-masthead');
    return root;
  }
  function areaFor(target, event) {
    if (target === overlay) {
      const areas = [...root.querySelectorAll(".design-principle, #design-context-toy, .design-masthead")];
      target = areas.find(node => { const box = node.getBoundingClientRect(); return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom; }) || root;
    }
    const section = target.closest?.('.design-principle'); if (section) return `principle:${section.dataset.principle}`;
    if (target.closest?.('#design-context-toy')) return 'context-toy';
    if (target.closest?.('.design-masthead')) return 'masthead';
    return 'page';
  }
  function controls() { tools.querySelector('#markup-undo').disabled = !ink.strokes.length; tools.querySelector('#markup-redo').disabled = !future.length; tools.querySelector('#markup-clear').disabled = !ink.strokes.length; }
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ ...ink, preferences: { enabled: enabled.checked, color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value) } })); status.textContent = `${ink.strokes.length} mark${ink.strokes.length === 1 ? '' : 's'} saved on this device. Kept feedback includes them.`; }
    catch { status.textContent = 'Marks are in this session. Saving failed; keep and export feedback before leaving.'; }
    controls();
  }
  function render() {
    paintPending = false; const page = root.getBoundingClientRect(); overlay.setAttribute('viewBox', `0 0 ${Math.max(1, page.width)} ${Math.max(1, page.height)}`); overlay.replaceChildren();
    for (const stroke of [...ink.strokes, ...(current ? [current] : [])]) {
      const node = areaNode(stroke.area); if (!node || node.getBoundingClientRect().height < 1) continue;
      const box = node.getBoundingClientRect(), points = projectStroke(stroke, { x: box.left - page.left, y: box.top - page.top, width: box.width, height: box.height });
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + (points.length === 1 ? ` l .01 .01` : ''));
      path.setAttribute('stroke', stroke.color); path.setAttribute('stroke-width', String(stroke.width * box.width / stroke.geometry.width)); overlay.append(path);
    }
  }
  function refresh() { if (!paintPending) { paintPending = true; requestAnimationFrame(render); } }
  const observer = new ResizeObserver(refresh); observer.observe(root);
  for (const node of root.querySelectorAll('.design-principle, .design-masthead, #design-context-toy')) observer.observe(node);
  root.querySelector('#design-context-toy')?.addEventListener('toggle', refresh);
  const exempt = target => target.closest?.('.design-markup-tools, input, textarea, select, [contenteditable="true"], .design-page-tools');
  function point(event) {
    const box = areaNode(current.area).getBoundingClientRect();
    return { x: (event.clientX - box.left) / Math.max(1, box.width), y: (event.clientY - box.top) / Math.max(1, box.height), t: Math.max(0, Math.round(event.timeStamp - started)), pressure: Math.max(0, Math.min(1, Number.isFinite(event.pressure) ? event.pressure : .5)) };
  }
  function finish(commit, outcome) {
    if (!current) return;
    const pointerId = current.pointerId, { pointerId: _, ...stroke } = current; current = null;
    if (commit && stroke.points.length) { ink.strokes.push(stroke); future = []; save(); onAction('Draw page markup', outcome); }
    else onAction('Cancel page markup', 'Interrupted mark discarded; previous marks preserved');
    try { if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId); } catch { /* Already canceled by the browser. */ }
    refresh();
  }
  root.addEventListener('pointerdown', event => {
    if (!enabled.checked || savedError || exempt(event.target) || event.button !== 0 || !event.isPrimary || (event.pointerType !== 'pen' && !any.checked)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (current) finish(false);
    if (ink.strokes.length >= 60 || ink.strokes.reduce((n, stroke) => n + stroke.points.length, 0) >= 11000) { status.textContent = 'This page has reached its ink limit. Keep/export feedback, then clear marks to continue.'; return; }
    const area = areaFor(event.target, event), box = areaNode(area).getBoundingClientRect(); started = event.timeStamp; moved = false;
    current = { id: crypto.randomUUID(), area, color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value), geometry: { width: Math.max(1, box.width), height: Math.max(1, box.height) }, points: [], pointerId: event.pointerId };
    current.points.push(point(event)); try { root.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active hardware pointer. */ } refresh();
  }, true);
  root.addEventListener('pointermove', event => {
    if (!current || event.pointerId !== current.pointerId) return; event.preventDefault(); event.stopImmediatePropagation();
    if (current.points.length >= 999) { status.textContent = 'Long mark ended at the point limit. Start another stroke.'; finish(true, 'Stroke saved at its point limit'); return; }
    const next = point(event), prev = current.points.at(-1);
    if (Math.hypot((next.x - prev.x) * current.geometry.width, (next.y - prev.y) * current.geometry.height) >= 2) { current.points.push(next); moved = true; refresh(); }
  }, true);
  root.addEventListener('pointerup', event => { if (current && event.pointerId === current.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); finish(true, moved ? 'Freehand stroke saved with area, geometry, timing and pressure' : 'Ink point saved with page context'); } }, true);
  for (const name of ['pointercancel', 'lostpointercapture']) root.addEventListener(name, () => finish(false), true);
  // Safari's stylus Touch Events guard preserves ordinary direct-finger events.
  // Mixed contacts remain browser/OS controlled; PointerEvent cancellation alone
  // cannot disable viewport panning. No global touch-action override for Pencil.
  function stylusGuard(event) {
    if (!enabled.checked || savedError || exempt(event.target) || !event.cancelable) return;
    const changed = [...event.changedTouches];
    if (changed.length && changed.every(touch => touch.touchType === 'stylus') && ![...event.touches].some(touch => touch.touchType === 'direct')) event.preventDefault();
  }
  root.addEventListener('touchstart', stylusGuard, { passive: false }); root.addEventListener('touchmove', stylusGuard, { passive: false });
  function mode() { if (savedError) { any.checked = false; status.textContent = savedError; return; } finish(false); if (!enabled.checked) any.checked = false; root.classList.toggle('design-draw-any', enabled.checked && any.checked); status.textContent = any.checked ? 'Drawing surface owns page gestures. Turn off Draw with any pointer to return to native reading.' : enabled.checked ? 'Pencil draws; fingers retain normal browser interaction.' : 'Native page input, including Pencil, passes through.'; if (!savedError) { try { localStorage.setItem(key, JSON.stringify({ ...ink, preferences: { enabled: enabled.checked, color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value) } })); } catch { status.textContent += ' This choice could not be saved.'; } } onAction('Choose page input', status.textContent); }
  enabled.onchange = mode; any.onchange = mode;
  tools.querySelector('#markup-undo').onclick = () => { finish(false); if (ink.strokes.length) { future.push([ink.strokes.pop()]); save(); refresh(); onAction('Undo page markup', 'Last mark removed with recovery available'); } };
  tools.querySelector('#markup-redo').onclick = () => { if (future.length) { ink.strokes.push(...future.pop()); save(); refresh(); onAction('Restore page markup', 'Removed marks restored'); } };
  tools.querySelector('#markup-clear').onclick = () => { finish(false); if (ink.strokes.length) { future.push(ink.strokes); ink = emptyMarkup(); save(); refresh(); onAction('Clear page markup', 'Marks cleared; Redo can restore them in this session'); } };
  tools.querySelector('#markup-color').onchange = () => { if (!savedError) save(); onAction('Choose markup ink', 'Ink color changed'); };
  tools.querySelector('#markup-width').onchange = () => { if (!savedError) save(); onAction('Choose markup width', 'Stroke width changed'); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(false); }); window.addEventListener('blur', () => finish(false));
  controls(); refresh();
  function captureContext() {
    const page = root.getBoundingClientRect(), areas = {}, targets = [];
    for (const area of new Set(ink.strokes.map(stroke => stroke.area))) {
      const node = areaNode(area), box = node?.getBoundingClientRect(); if (!box) continue;
      areas[area] = { x: box.left - page.left, y: box.top - page.top, width: box.width, height: box.height };
      for (const [index, target] of [...node.querySelectorAll('h1, h2, button, [data-term]')].entries()) {
        const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height || targets.length >= 100 || target.closest('.design-markup-tools')) continue;
        targets.push({ id: `${area}:${target.id || index}`, label: (target.getAttribute('aria-label') || target.dataset.term || target.textContent || '').slice(0, 120), area, x: rect.left - page.left, y: rect.top - page.top, width: rect.width, height: rect.height });
      }
    }
    return { ...ink, pageGeometry: { width: page.width, height: page.height, areas, targets }, input: enabled.checked ? any.checked ? 'any-pointer' : 'pencil' : 'native', ink: { color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value) }, currentStroke: current ? { area: current.area, color: current.color, width: current.width, geometry: current.geometry, points: current.points } : null };
  }
  return { refresh, hide() { finish(false); }, captureContext };
}
