import { freezeJSON } from "./moment-codec.js";
import { emptyMarkup, readMarkup, projectStroke, projectMapStroke } from './page-markup.js';
import { storageName } from './environment.js';

export function createDesignMarkup({ root, onAction, onStart = () => {} }) {
  const tools = document.createElement('details'); tools.className = 'design-markup-tools'; tools.innerHTML = `<summary>Pencil markup</summary><div class="design-markup-controls"><label><input id="markup-enabled" type="checkbox" checked> Pencil draws over this page</label><label><input id="markup-visible" type="checkbox" checked> Show marks</label><label>Ink <input id="markup-color" type="color" value="#ad405b"></label><label>Width <input id="markup-width" type="range" min="1" max="12" step="1" value="3"></label><button id="markup-undo" type="button" class="quiet-button">Undo mark</button><button id="markup-redo" type="button" class="quiet-button">Redo</button><button id="markup-clear" type="button" class="quiet-button">Clear marks</button><label><input id="markup-any-pointer" type="checkbox"> Draw with any pointer</label><p>Fingers keep normal selection and scrolling. Marks scale with their part of the page; text can reflow underneath. Draw with any pointer temporarily owns page gestures. Turn it off to read normally.</p><p id="markup-status" role="status">Marks save on this device and travel with your kept feedback.</p></div>`;
  root.querySelector('.design-footnote').append(tools);
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); overlay.classList.add('design-ink'); overlay.setAttribute('aria-hidden', 'true'); root.append(overlay);
  const enabled = tools.querySelector('#markup-enabled'), any = tools.querySelector('#markup-any-pointer'), status = tools.querySelector('#markup-status');
  const visible = tools.querySelector('#markup-visible');
  const visibility = document.createElement('button'); visibility.type = 'button'; visibility.id = 'design-marks-toggle'; visibility.className = 'quiet-button design-marks-toggle'; visibility.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17l-1 4 4-1L20 8l-4-4L5 17Zm9-11 4 4"/></svg>'; root.querySelector('.design-footnote').prepend(visibility);
  function showMarks() { overlay.style.visibility = visible.checked ? 'visible' : 'hidden'; visibility.setAttribute('aria-label', visible.checked ? 'Hide Pencil marks' : 'Show Pencil marks'); visibility.title = visible.checked ? 'Hide Pencil marks' : 'Show Pencil marks'; visibility.setAttribute('aria-pressed', String(visible.checked)); }
  const key = storageName('megaapp.design.markup.v1');
  let ink = emptyMarkup(), future = [], unreadable = '', current = null, started = 0, moved = false, paintPending = false, savedError = '';
  try {
    unreadable = localStorage.getItem(key) || '';
    if (unreadable) {
      const saved = JSON.parse(unreadable); ink = readMarkup(saved); ink.strokes.forEach(freezeJSON);
      if(saved.recovery !== undefined) {
        if(!Array.isArray(saved.recovery) || saved.recovery.length>60)throw new Error('Invalid mark recovery.');
        future=saved.recovery.map(strokes=>readMarkup({...emptyMarkup(),strokes}).strokes.map(freezeJSON));
        readMarkup({...emptyMarkup(),strokes:[...ink.strokes,...future.flat()]});
      }
      const prefs = saved.preferences;
      if (typeof prefs?.enabled === 'boolean') enabled.checked = prefs.enabled;
      if (typeof prefs?.visible === 'boolean') visible.checked = prefs.visible;
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
    if (id === 'context-map') return root.querySelector('.context-map');
    if (id === 'context-toy') return root.querySelector('#design-context-toy');
    if (id === 'masthead') return root.querySelector('.design-masthead');
    return root;
  }
  function areaFor(target, event) {
    if (target === overlay) {
      const areas = [...root.querySelectorAll(".context-map, .design-principle, #design-context-toy, .design-masthead")];
      target = areas.find(node => { const box = node.getBoundingClientRect(); return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom; }) || root;
    }
    if (target.closest?.('.context-map')) return 'context-map';
    const section = target.closest?.('.design-principle'); if (section) return `principle:${section.dataset.principle}`;
    if (target.closest?.('#design-context-toy')) return 'context-toy';
    if (target.closest?.('.design-masthead')) return 'masthead';
    return 'page';
  }
  function controls() { tools.querySelector('#markup-undo').disabled = Boolean(savedError) || !ink.strokes.length; tools.querySelector('#markup-redo').disabled = Boolean(savedError) || !future.length; tools.querySelector('#markup-clear').disabled = Boolean(savedError) || !ink.strokes.length; }
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ ...ink, recovery: future, preferences: { enabled: enabled.checked, visible: visible.checked, color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value) } })); status.textContent = `${ink.strokes.length} mark${ink.strokes.length === 1 ? '' : 's'} saved on this device. Kept feedback includes them.`; }
    catch { status.textContent = 'Marks are in this session. Saving failed; keep and export feedback before leaving.'; }
    controls();
  }
  // Retain committed paths. Only the active path changes while drawing.
  // Camera, reflow and resize explicitly invalidate saved projections.
  const paths = new Map();
  let geometryDirty = true;
  function render() {
    paintPending = false;
    const page = root.getBoundingClientRect();
    overlay.setAttribute('viewBox', `0 0 ${Math.max(1, page.width)} ${Math.max(1, page.height)}`);
    const strokes = [...ink.strokes, ...(current ? [current] : [])], ids = new Set(strokes.map(stroke => stroke.id));
    for (const [id, saved] of paths) if (!ids.has(id)) { saved.path.remove(); saved.clip?.remove(); paths.delete(id); }
    const areas = new Map();
    for (const stroke of strokes) {
      let saved = paths.get(stroke.id);
      if (saved && !geometryDirty && stroke !== current && saved.pointCount === stroke.points.length) continue;
      if (!areas.has(stroke.area)) {
        const node = areaNode(stroke.area), box = node?.getBoundingClientRect();
        areas.set(stroke.area, box && box.height >= 1 ? {box, area:{x:box.left-page.left,y:box.top-page.top,width:box.width,height:box.height}, camera:stroke.area==='context-map'?JSON.parse(node.dataset.camera || '{"x":0,"y":0,"zoom":1}'):null} : null);
      }
      const geometry = areas.get(stroke.area);
      if (!geometry) { if (saved) saved.path.style.display = 'none'; continue; }
      if (!saved) { const path = document.createElementNS('http://www.w3.org/2000/svg','path'); saved = {path}; paths.set(stroke.id,saved); overlay.append(path); }
      const {box,area,camera} = geometry, {path} = saved;
      path.style.display = ''; const points = camera ? projectMapStroke(stroke,area,camera) : projectStroke(stroke,area);
      path.setAttribute('d', points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ') + (points.length===1?' l .01 .01':''));
      saved.pointCount = stroke.points.length;
      path.setAttribute('stroke',stroke.color);
      path.setAttribute('stroke-width',String(stroke.width*box.width/stroke.geometry.width*(camera?camera.zoom/(stroke.geometry.zoom||1):1)));
      if (camera) {
        if (!saved.clip) { const clip=document.createElementNS('http://www.w3.org/2000/svg','clipPath'),rect=document.createElementNS('http://www.w3.org/2000/svg','rect'); clip.id=`map-ink-${stroke.id}`;clip.setAttribute('clipPathUnits','userSpaceOnUse');clip.append(rect);overlay.append(clip);saved.clip=clip;path.setAttribute('clip-path',`url(#${clip.id})`); }
        for (const [k,v] of Object.entries({x:area.x,y:area.y,width:area.width,height:area.height})) saved.clip.firstChild.setAttribute(k,String(v));
      }
    }
    geometryDirty = false;
  }
  function refresh() { if (!paintPending) { paintPending = true; requestAnimationFrame(render); } }
  function invalidate() { geometryDirty = true; refresh(); }
  const observer = new ResizeObserver(invalidate); observer.observe(root);
  for (const node of root.querySelectorAll('.design-principle, .design-masthead, #design-context-toy')) observer.observe(node);
  root.querySelector('#design-context-toy')?.addEventListener('toggle', invalidate);
  root.addEventListener('contextmapview', invalidate);
  const exempt = target => target.closest?.('.design-markup-tools, input, textarea, select, [contenteditable="true"], .design-page-tools, #design-marks-toggle, .context-detail, .context-home');
  function point(event) {
    const box = areaNode(current.area).getBoundingClientRect();
    const camera = current.area === 'context-map' ? JSON.parse(areaNode(current.area).dataset.camera) : {x:0,y:0,zoom:1};
    return { x: (event.clientX - box.left-camera.x) / Math.max(1, box.width) / camera.zoom, y: (event.clientY - box.top-camera.y) / Math.max(1, box.height) / camera.zoom, t: Math.max(0, Math.round(event.timeStamp - started)), pressure: Math.max(0, Math.min(1, Number.isFinite(event.pressure) ? event.pressure : .5)) };
  }
  function finish(commit, outcome) {
    if (!current) return;
    const pointerId = current.pointerId, { pointerId: _, ...stroke } = current; current = null;
    if (commit && stroke.points.length) { ink.strokes.push(freezeJSON(stroke)); future = []; save(); onAction('Draw page markup', outcome); }
    else onAction('Cancel page markup', 'Interrupted mark discarded; previous marks preserved');
    try { if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId); } catch { /* Already canceled by the browser. */ }
    refresh();
  }
  root.addEventListener('pointerdown', event => {
    if (!visible.checked || !enabled.checked || savedError || exempt(event.target) || event.button !== 0 || !event.isPrimary || (event.pointerType !== 'pen' && !any.checked)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (current) finish(false);
    if (ink.strokes.length >= 60 || ink.strokes.reduce((n, stroke) => n + stroke.points.length, 0) >= 11000) { status.textContent = 'This page has reached its ink limit. Keep/export feedback, then clear marks to continue.'; return; }
    onStart();
    const area = areaFor(event.target, event), box = areaNode(area).getBoundingClientRect(); started = event.timeStamp; moved = false;
    current = { id: crypto.randomUUID(), area, color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value), geometry: { width: Math.max(1, box.width), height: Math.max(1, box.height), ...(area === 'context-map' ? {zoom:JSON.parse(areaNode(area).dataset.camera).zoom} : {}) }, points: [], pointerId: event.pointerId };
    current.points.push(point(event)); try { root.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active hardware pointer. */ } refresh();
  }, true);
  root.addEventListener('pointermove', event => {
    if (!current || event.pointerId !== current.pointerId) return;
    if (event.buttons === 0) { finish(false); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (current.points.length >= 999) { status.textContent = 'Long mark ended at the point limit. Start another stroke.'; finish(true, 'Stroke saved at its point limit'); return; }
    const next = point(event), prev = current.points.at(-1);
    if (Math.hypot((next.x - prev.x) * current.geometry.width, (next.y - prev.y) * current.geometry.height) >= 2) { current.points.push(next); moved = true; refresh(); }
  }, true);
  root.addEventListener('pointerup', event => { if (current && event.pointerId === current.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); finish(true, moved ? 'Freehand stroke saved with area, geometry, timing and pressure' : 'Ink point saved with page context'); } }, true);
  for (const name of ['pointercancel', 'lostpointercapture']) root.addEventListener(name, event => { if (current?.pointerId === event.pointerId) finish(false); }, true);
  // Safari's stylus Touch Events guard preserves ordinary direct-finger events.
  // Mixed contacts remain browser/OS controlled; PointerEvent cancellation alone
  // cannot disable viewport panning. No global touch-action override for Pencil.
  function stylusGuard(event) {
    if (!visible.checked || !enabled.checked || savedError || exempt(event.target) || !event.cancelable) return;
    const changed = [...event.changedTouches];
    if (changed.length && changed.every(touch => touch.touchType === 'stylus') && ![...event.touches].some(touch => touch.touchType === 'direct')) event.preventDefault();
  }
  root.addEventListener('touchstart', stylusGuard, { passive: false }); root.addEventListener('touchmove', stylusGuard, { passive: false });
  // Defensive alternate cleanup if an OS interruption delivers a stylus
  // touch end without its pointer end. Leave the next contact ready.
  for (const type of ['touchend', 'touchcancel']) root.addEventListener(type, event => {
    if (current && [...event.changedTouches].some(touch => touch.touchType === 'stylus') && ![...event.touches].some(touch => touch.touchType === 'stylus')) finish(type === 'touchend', 'Stroke saved at stylus touch end');
  }, { passive: true });
  function mode() { if (savedError) { any.checked = false; status.textContent = savedError; return; } finish(false); if (!enabled.checked) any.checked = false; root.classList.toggle('design-draw-any', visible.checked && enabled.checked && any.checked); status.textContent = any.checked ? 'Drawing surface owns page gestures. Turn off Draw with any pointer to return to native reading.' : enabled.checked ? 'Pencil draws; fingers retain normal browser interaction.' : 'Native page input, including Pencil, passes through.'; if (!savedError) { try { localStorage.setItem(key, JSON.stringify({ ...ink, recovery: future, preferences: { enabled: enabled.checked, visible: visible.checked, color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value) } })); } catch { status.textContent += ' This choice could not be saved.'; } } onAction('Choose page input', status.textContent); }
  enabled.onchange = mode; any.onchange = mode;
  visible.onchange = () => { finish(false); showMarks(); if (!visible.checked) { any.checked=false; root.classList.remove('design-draw-any'); } if(!savedError)save(); onAction('Set page marks visibility',visible.checked?'Saved marks shown':'Marks hidden; saved drawings preserved'); };
  visibility.onclick = () => {visible.checked=!visible.checked;visible.onchange();};
  tools.querySelector('#markup-undo').onclick = () => { finish(false); if (ink.strokes.length) { future.push([ink.strokes.pop()]); save(); refresh(); onAction('Undo page markup', 'Last mark removed with recovery available'); } };
  tools.querySelector('#markup-redo').onclick = () => { finish(false); if (future.length) { ink.strokes.push(...future.pop()); save(); refresh(); onAction('Restore page markup', 'Removed marks restored'); } };
  tools.querySelector('#markup-clear').onclick = () => { finish(false); if (ink.strokes.length) { future.push(ink.strokes); ink = emptyMarkup(); save(); refresh(); onAction('Clear page markup', 'Marks cleared; Redo can restore them'); } };
  tools.querySelector('#markup-color').onchange = () => { if (!savedError) save(); onAction('Choose markup ink', 'Ink color changed'); };
  tools.querySelector('#markup-width').onchange = () => { if (!savedError) save(); onAction('Choose markup width', 'Stroke width changed'); };
  window.addEventListener('keydown', event => { if(event.key === 'Escape' && current){event.preventDefault();finish(false);} });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(false); }); window.addEventListener('blur', () => finish(false));
  controls(); showMarks(); refresh();
  function captureContext() {
    const page = root.getBoundingClientRect(), areas = {}, targets = [];
    for (const area of new Set(ink.strokes.map(stroke => stroke.area))) {
      const node = areaNode(area), box = node?.getBoundingClientRect(); if (!box) continue;
      areas[area] = { x: box.left - page.left, y: box.top - page.top, width: box.width, height: box.height, ...(area === 'context-map' ? {camera:JSON.parse(node.dataset.camera)} : {}) };
      for (const [index, target] of [...node.querySelectorAll('h1, h2, button, [data-term]')].entries()) {
        const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height || targets.length >= 100 || target.closest('.design-markup-tools')) continue;
        targets.push({ id: `${area}:${target.id || index}`, label: (target.getAttribute('aria-label') || target.dataset.term || target.textContent || '').slice(0, 120), area, x: rect.left - page.left, y: rect.top - page.top, width: rect.width, height: rect.height });
      }
    }
    return { ...ink, visible: visible.checked, pageGeometry: { width: page.width, height: page.height, areas, targets }, input: visible.checked && enabled.checked ? any.checked ? 'any-pointer' : 'pencil' : 'native', ink: { color: tools.querySelector('#markup-color').value, width: Number(tools.querySelector('#markup-width').value) }, currentStroke: current ? { area: current.area, color: current.color, width: current.width, geometry: current.geometry, points: current.points } : null };
  }
  return { refresh: invalidate, hide() { finish(false); }, captureContext };
}
