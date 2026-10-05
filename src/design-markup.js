import { freezeJSON } from "./moment-codec.js";
import { emptyMarkup, readMarkup, projectStroke, projectMapStroke, MAX_MARKUP_POINTS, markupPointCount, remainingMarkupPoints } from './page-markup.js';
import { storageName } from './environment.js';

export function createDesignMarkup({ root, onAction, onStart = () => {} }) {
  const tools = document.createElement('section'); tools.className = 'design-markup-tools'; tools.id = 'design-markup-palette'; tools.hidden = true; tools.setAttribute('aria-label', 'Pencil markup');
  tools.innerHTML = `<header class="design-markup-heading"><strong>Pencil markup</strong><button id="markup-close" type="button" class="quiet-button" aria-label="Close Pencil markup">×</button></header><div class="design-markup-controls"><div class="design-markup-brush"><label>Ink <input id="markup-color" type="color" value="#ad405b"></label><label class="design-markup-width">Width <output id="markup-width-value" for="markup-width">3</output><input id="markup-width" type="range" min="1" max="12" step="1" value="3"></label></div><div class="design-markup-actions"><button id="markup-undo" type="button" class="quiet-button">Undo mark</button><button id="markup-redo" type="button" class="quiet-button">Redo</button><label><input id="markup-visible" type="checkbox" checked> Show marks</label></div><details class="design-markup-options"><summary>Page input and saved marks</summary><label><input id="markup-enabled" type="checkbox" checked> Pencil draws over this page</label><label><input id="markup-any-pointer" type="checkbox"> Draw with any pointer</label><p>Fingers keep normal selection and scrolling. Any-pointer drawing takes over page gestures until turned off.</p><div class="design-markup-actions"><button id="markup-export" type="button" class="quiet-button">Save marks JSON</button><button id="markup-clear" type="button" class="quiet-button">Clear marks</button></div><p>Redo restores cleared marks, including after reload.</p></details><p id="markup-status" role="status">Marks save on this device.</p></div>`;
  root.append(tools);
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); overlay.classList.add('design-ink'); overlay.style.pointerEvents = 'none'; overlay.setAttribute('aria-hidden', 'true'); root.append(overlay);
  const enabled = tools.querySelector('#markup-enabled'), any = tools.querySelector('#markup-any-pointer'), status = tools.querySelector('#markup-status');
  const visible = tools.querySelector('#markup-visible'), color = tools.querySelector('#markup-color'), width = tools.querySelector('#markup-width');
  const visibility = document.createElement('button'); visibility.type = 'button'; visibility.id = 'design-marks-toggle'; visibility.className = 'quiet-button design-marks-toggle'; visibility.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17l-1 4 4-1L20 8l-4-4L5 17Zm9-11 4 4"/></svg>'; visibility.setAttribute('aria-controls', tools.id); visibility.setAttribute('aria-expanded', 'false'); visibility.setAttribute('aria-label', 'Pencil markup'); visibility.title = 'Pencil markup'; root.append(visibility);
  function showMarks() { overlay.style.visibility = visible.checked ? 'visible' : 'hidden'; visibility.classList.toggle('has-visible-marks', visible.checked); }
  function brush() { tools.querySelector('#markup-width-value').value = width.value; visibility.style.setProperty('--markup-ink', color.value); }
  function palette(open, { restoreFocus = false, record = true } = {}) {
    if (open === !tools.hidden) return;
    const focusInside = tools.contains(document.activeElement);
    tools.hidden = !open; visibility.setAttribute('aria-expanded', String(open));
    if (!open) tools.querySelector('.design-markup-options').open = false;
    if (restoreFocus && focusInside) visibility.focus({ preventScroll: true });
    if (record) onAction('Open Pencil controls', open ? 'Pencil palette opened beside the pen button' : 'Pencil palette dismissed; page input continues');
  }
  function revealRecovery() { palette(true); tools.querySelector('.design-markup-options').open = true; }
  const key = storageName('megaapp.design.markup.v1');
  let ink = emptyMarkup(), future = [], unreadable = '', current = null, started = 0, moved = false, paintPending = false, currentPointBudget = 0, lastSaveFailed = false, savedError = '';
  try {
    unreadable = localStorage.getItem(key) || '';
    if (unreadable) {
      const saved = JSON.parse(unreadable); ink = readMarkup(saved); ink.strokes.forEach(freezeJSON);
      if(saved.recovery !== undefined) {
        if(!Array.isArray(saved.recovery) || saved.recovery.length>MAX_MARKUP_POINTS)throw new Error('Invalid mark recovery.');
        // Reject oversized or repeated recovery before copying any of its points.
        let recoveryPoints = markupPointCount(ink.strokes);
        const identities = new Set(ink.strokes.map(stroke => stroke.id));
        for (const group of saved.recovery) {
          if (!Array.isArray(group) || group.length > MAX_MARKUP_POINTS) throw new Error('Invalid mark recovery.');
          for (const stroke of group) {
            if (!Array.isArray(stroke?.points) || !stroke.points.length || identities.has(stroke.id)) throw new Error('Invalid mark recovery.');
            recoveryPoints += stroke.points.length;
            if (recoveryPoints > MAX_MARKUP_POINTS) throw new Error('Invalid mark recovery: point budget exceeded.');
            identities.add(stroke.id);
          }
        }
        future=saved.recovery.map(strokes=>readMarkup({...emptyMarkup(),strokes}).strokes.map(freezeJSON));
      }
      const prefs = saved.preferences;
      if (typeof prefs?.enabled === 'boolean') enabled.checked = prefs.enabled;
      if (typeof prefs?.visible === 'boolean') visible.checked = prefs.visible;
      if (/^#[\da-f]{6}$/i.test(prefs?.color || '')) color.value = prefs.color;
      if (Number.isFinite(prefs?.width) && prefs.width >= 1 && prefs.width <= 12) width.value = String(prefs.width);
    }
  }
  catch {
    if (unreadable) {
      savedError = 'Existing marks could not be read. They remain in storage; export or recover them before drawing new marks.'; status.textContent = savedError; enabled.checked = false; enabled.disabled = true;
      const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'quiet-button'; recover.textContent = 'Export unreadable marks';
      recover.onclick = () => { const url = URL.createObjectURL(new Blob([unreadable], { type: 'text/plain' })), link = document.createElement('a'); link.href = url; link.download = 'megaapp-unreadable-page-marks.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
      tools.querySelector('.design-markup-controls').append(recover);
    } else status.textContent = 'Device storage is unavailable. Marks can stay in this session; save marks JSON before leaving.';
  }
  function areaNode(id) {
    if (id.startsWith('principle:')) return [...root.querySelectorAll('.design-principle')].find(node => node.dataset.principle === id.slice(10));
    if (id === 'context-map') return root.querySelector('.context-map');
    if (id === 'context-toy') return root.querySelector('#design-context-toy');
    if (id === 'masthead') return root.querySelector('.design-masthead');
    if (id === 'footnote') return root.querySelector('.design-footnote');
    return root;
  }
  // The viewport and its HUD stay untransformed. The page's windows live in a
  // separate world; derive its current transform without changing saved ink.
  function canvasCamera() { return JSON.parse(root.dataset.canvasCamera || '{"x":0,"y":0,"zoom":1}'); }
  function outerScale(node) { const box = node.getBoundingClientRect(); return { x: box.width / Math.max(1, node.offsetWidth), y: box.height / Math.max(1, node.offsetHeight) }; }
  function areaFor(target, event) {
    if (target === overlay) {
      // Resolve through the drawing overlay in paint order, including overlapping
      // windows and the nested Toy. DOM order alone can select a covered window.
      target = document.elementsFromPoint(event.clientX,event.clientY).find(node => root.contains(node) && node !== overlay && !overlay.contains(node)) || root;
    }
    if (target.closest?.('.context-map')) return 'context-map';
    const section = target.closest?.('.design-principle'); if (section) return `principle:${section.dataset.principle}`;
    if (target.closest?.('#design-context-toy')) return 'context-toy';
    if (target.closest?.('.design-masthead')) return 'masthead';
    if (target.closest?.('.design-footnote')) return 'footnote';
    return root.designCanvas ? 'canvas' : 'page';
  }
  function controls() { tools.querySelector('#markup-undo').disabled = Boolean(savedError) || !ink.strokes.length; tools.querySelector('#markup-redo').disabled = Boolean(savedError) || !future.length; tools.querySelector('#markup-clear').disabled = Boolean(savedError) || !ink.strokes.length; }
  function save() {
    try { lastSaveFailed = false; localStorage.setItem(key, JSON.stringify({ ...ink, recovery: future, preferences: { enabled: enabled.checked, visible: visible.checked, color: color.value, width: Number(width.value) } })); status.textContent = `${ink.strokes.length} mark${ink.strokes.length === 1 ? '' : 's'} saved on this device.`; }
    catch { lastSaveFailed = true; revealRecovery(); status.textContent = 'Marks are in this session. Saving failed; save marks JSON before leaving.'; }
    controls();
  }
  // Retain committed paths. Only the active path changes while drawing.
  // Camera, reflow and resize explicitly invalidate saved projections.
  const paths = new Map(), windowMasks = new Map();
  let geometryDirty = true;
  function render() {
    paintPending = false;
    const page = root.getBoundingClientRect();
    overlay.setAttribute('viewBox', `0 0 ${Math.max(1, page.width)} ${Math.max(1, page.height)}`);
    const strokes = [...ink.strokes, ...(current ? [current] : [])], ids = new Set(strokes.map(stroke => stroke.id));
    for (const [id, saved] of paths) if (!ids.has(id)) { saved.path.remove(); saved.clip?.remove(); paths.delete(id); }
    const windows = [...root.querySelectorAll('.design-window')].map((node,index)=>({node,index,z:Number(getComputedStyle(node).zIndex)||0,box:node.getBoundingClientRect()}));
    if (geometryDirty) for (const window of windows) {
      const front=windows.filter(w=>w.z>window.z || (w.z===window.z && w.index>window.index));
      let mask=windowMasks.get(window.node);
      if (!front.length) { mask?.remove();windowMasks.delete(window.node);continue; }
      if (!mask) { mask=document.createElementNS('http://www.w3.org/2000/svg','mask');mask.id='window-ink-'+window.node.dataset.window;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('maskContentUnits','userSpaceOnUse');overlay.append(mask);windowMasks.set(window.node,mask); }
      mask.replaceChildren();
      for (const [key,value] of Object.entries({x:0,y:0,width:page.width,height:page.height})) mask.setAttribute(key,String(value));
      for (const w of [{box:page,white:true},...front]) {
        const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
        for (const [key,value] of Object.entries({x:w.box.left-page.left,y:w.box.top-page.top,width:w.box.width,height:w.box.height})) rect.setAttribute(key,String(value));
        rect.setAttribute('fill',w.white?'white':'black');
        if (w.node) rect.setAttribute('rx',String(parseFloat(getComputedStyle(w.node).borderRadius)*outerScale(w.node).x||0));
        mask.append(rect);
      }
    }
    const areas = new Map();
    for (const stroke of strokes) {
      let saved = paths.get(stroke.id);
      if (saved && !geometryDirty && stroke !== current && saved.pointCount === stroke.points.length) continue;
      if (!areas.has(stroke.area)) {
        const node = areaNode(stroke.area), box = node?.getBoundingClientRect();
        const scale = node ? outerScale(node) : {x:1,y:1};
        const mapCamera = stroke.area === 'context-map' ? JSON.parse(node.dataset.camera || '{"x":0,"y":0,"zoom":1}') : null;
        const window = windows.find(w=>w.node===node?.closest('.design-window'));
        areas.set(stroke.area, box && box.height >= 1 ? {box, scale, window, area:{x:box.left-page.left,y:box.top-page.top,width:box.width,height:box.height}, camera:mapCamera ? { ...mapCamera, x:mapCamera.x*scale.x, y:mapCamera.y*scale.y } : null} : null);
      }
      const geometry = areas.get(stroke.area);
      if (!geometry) { if (saved) saved.path.style.display = 'none'; continue; }
      if (!saved) { const path = document.createElementNS('http://www.w3.org/2000/svg','path'); saved = {path}; paths.set(stroke.id,saved); overlay.append(path); }
      const {box,area,camera} = geometry, {path} = saved;
      const worldInk = root.designCanvas && (stroke.area === 'canvas' || stroke.area === 'page');
      const pageCamera = canvasCamera();
      // Old page marks retain their original page dimensions and origin in the
      // world. New blank-space ink has an explicit, stable world basis.
      const inkArea = worldInk ? { x:pageCamera.x, y:pageCamera.y, width:stroke.geometry.width*pageCamera.zoom, height:stroke.geometry.height*pageCamera.zoom } : area;
      path.style.display = ''; const points = camera ? projectMapStroke(stroke,area,camera) : projectStroke(stroke,inkArea);
      path.setAttribute('d', points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ') + (points.length===1?' l .01 .01':''));
      saved.pointCount = stroke.points.length;
      path.setAttribute('stroke',stroke.color);
      path.setAttribute('stroke-width',String(stroke.width*(worldInk?pageCamera.zoom:box.width/stroke.geometry.width)*(camera?camera.zoom/(stroke.geometry.zoom||1):1)));
      // Section ink belongs to its window. Higher windows cover it in the same
      // paint order as their content; blank-space canvas ink remains global.
      const mask=windowMasks.get(geometry.window?.node);
      if (mask) path.setAttribute('mask','url(#'+mask.id+')');
      else path.removeAttribute('mask');
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
  for (const node of root.querySelectorAll('.design-principle, .design-masthead, #design-context-toy, .design-footnote')) observer.observe(node);
  root.querySelector('#design-context-toy')?.addEventListener('toggle', invalidate);
  root.addEventListener('contextmapview', invalidate);
  root.addEventListener('designcanvasview', invalidate);
  const exempt = target => target.closest?.('.design-markup-tools, input, textarea, select, [contenteditable="true"], .design-page-tools, .design-canvas-controls, .design-window-chrome, .design-window-resize, #design-marks-toggle, .context-detail, .context-home');
  function point(event) {
    if (current.area === 'canvas') {
      const page = root.getBoundingClientRect(), camera = canvasCamera();
      return observation(event, (event.clientX-page.left-camera.x)/camera.zoom/current.geometry.width, (event.clientY-page.top-camera.y)/camera.zoom/current.geometry.height);
    }
    const box = areaNode(current.area).getBoundingClientRect();
    const camera = current.area === 'context-map' ? JSON.parse(areaNode(current.area).dataset.camera) : {x:0,y:0,zoom:1};
    const scale = outerScale(areaNode(current.area));
    return observation(event, (event.clientX-box.left-camera.x*scale.x)/Math.max(1,box.width)/camera.zoom, (event.clientY-box.top-camera.y*scale.y)/Math.max(1,box.height)/camera.zoom);
  }
  function observation(event, x, y) {
    return { x, y, t: Math.max(0, Math.round(event.timeStamp - started), current.points.at(-1)?.t || 0), pressure: Math.max(0, Math.min(1, Number.isFinite(event.pressure) ? event.pressure : .5)) };
  }
  function admit(point) {
    return ['x','y','t','pressure'].every(key=>Number.isFinite(point[key])) && Math.abs(point.x)<=100 && Math.abs(point.y)<=100 && point.t>=0 && point.t<=3600000 && point.pressure>=0 && point.pressure<=1;
  }
  function observationLimit() {
    const accepted = current.points.length > 0;
    finish(accepted, 'Stroke ended at its recording range; every accepted point preserved');
    palette(true);
    status.textContent = `This mark exceeded its coordinate or one-hour recording range.${accepted ? ' Its accepted points are kept.' : ' Previous marks are kept.'}${lastSaveFailed ? ' Saving failed; save marks JSON before leaving.' : ''}`;
  }
  function finish(commit, outcome) {
    if (!current) return;
    const pointerId = current.pointerId, { pointerId: _, ...stroke } = current; current = null; delete root.dataset.markupDrawing;
    if (commit && stroke.points.length) { ink.strokes.push(freezeJSON(stroke)); future = []; save(); onAction('Draw page markup', outcome); }
    else onAction('Cancel page markup', 'Interrupted mark discarded; previous marks preserved');
    try { if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId); } catch { /* Already canceled by the browser. */ }
    refresh();
  }
  root.addEventListener('pointerdown', event => {
    if (!visible.checked || !enabled.checked || savedError || exempt(event.target) || event.button !== 0 || !event.isPrimary || (event.pointerType !== 'pen' && !any.checked)) return;
    // A second primary contact of another pointer type cannot replace an active
    // Pencil stroke (for example, a direct finger while any-pointer mode is on).
    if (current) return;
    event.preventDefault(); event.stopImmediatePropagation();
    currentPointBudget = remainingMarkupPoints(ink.strokes);
    if (!currentPointBudget) { revealRecovery(); status.textContent = `This page has reached its ink budget.${lastSaveFailed ? ' Saving failed; marks remain in this session.' : ''} Save marks JSON before clearing; Redo can restore cleared marks.`; onAction('Page ink budget reached', 'New mark blocked; exact marks and recovery remain'); return; }
    onStart(); root.designCanvas?.interrupt();
    const area = areaFor(event.target, event), box = areaNode(area).getBoundingClientRect(); started = event.timeStamp; moved = false;
    const scale = outerScale(areaNode(area));
    // At the smallest overview scale a viewport pixel can represent 100000 world
    // pixels. This fixed basis also covers the camera's full ±1m range without
    // exceeding the portable format's ±100 normalized-coordinate bound.
    const canvasBasis = 1e12;
    current = { id: crypto.randomUUID(), area, color: color.value, width: Number(width.value), geometry: { width: area === 'canvas' ? canvasBasis : Math.max(1,box.width/scale.x), height: area === 'canvas' ? canvasBasis : Math.max(1,box.height/scale.y), ...(area === 'context-map' ? {zoom:JSON.parse(areaNode(area).dataset.camera).zoom} : {}) }, points: [], pointerId: event.pointerId };
    root.dataset.markupDrawing = 'true';
    const first = point(event); if (!admit(first)) { observationLimit(); return; }
    current.points.push(first); try { root.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active hardware pointer. */ } refresh();
  }, true);
  root.addEventListener('pointermove', event => {
    if (!current || event.pointerId !== current.pointerId) return;
    if (event.buttons === 0) { finish(false); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (current.points.length >= currentPointBudget) { finish(true, 'Stroke saved at the page ink budget; every accepted point preserved'); revealRecovery(); status.textContent = `This page has reached its ink budget. Your mark is preserved.${lastSaveFailed ? ' Saving failed; marks remain in this session.' : ''} Save marks JSON before clearing; Redo can restore cleared marks.`; return; }
    const next = point(event), prev = current.points.at(-1);
    if (!admit(next)) { observationLimit(); return; }
    if (Math.hypot((next.x - prev.x) * current.geometry.width, (next.y - prev.y) * current.geometry.height) >= 2) { current.points.push(next); moved = true; refresh(); }
  }, true);
  root.addEventListener('pointerup', event => {
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    // The release endpoint belongs to the mark, even below the move sampling gap.
    const next = point(event), prev = current.points.at(-1);
    if (!admit(next)) { observationLimit(); return; }
    if (current.points.length < currentPointBudget && (next.x !== prev.x || next.y !== prev.y)) { current.points.push(next); moved = true; }
    finish(true, moved ? 'Freehand stroke saved with area, geometry, timing and pressure' : 'Ink point saved with page context');
    if (!remainingMarkupPoints(ink.strokes)) { revealRecovery(); status.textContent = `This page has reached its ink budget. Your mark is preserved.${lastSaveFailed ? ' Saving failed; marks remain in this session.' : ''} Save marks JSON before clearing; Redo can restore cleared marks.`; }
  }, true);
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
  function inputMode() { const drawing = visible.checked && enabled.checked && any.checked; root.classList.toggle('design-draw-any', drawing); root.style.touchAction = drawing ? 'none' : ''; }
  function mode() { if (savedError) { any.checked = false; inputMode(); status.textContent = savedError; return; } finish(false); if (!enabled.checked) any.checked = false; inputMode(); status.textContent = any.checked ? 'Drawing surface owns page gestures. Turn off Draw with any pointer to return to native reading.' : enabled.checked ? 'Pencil draws; fingers retain normal browser interaction.' : 'Native page input, including Pencil, passes through.'; if (!savedError) { try { localStorage.setItem(key, JSON.stringify({ ...ink, recovery: future, preferences: { enabled: enabled.checked, visible: visible.checked, color: color.value, width: Number(width.value) } })); } catch { revealRecovery(); status.textContent += ' This choice could not be saved. Save marks JSON before leaving.'; } } onAction('Choose page input', status.textContent); }
  enabled.onchange = mode; any.onchange = mode;
  visible.onchange = () => { finish(false); showMarks(); if (!visible.checked) any.checked=false; inputMode(); if(!savedError)save(); onAction('Set page marks visibility',visible.checked?'Saved marks shown':'Marks hidden; saved drawings preserved'); };
  visibility.onclick = event => { const open = tools.hidden; palette(open); if (open && event.detail === 0) color.focus({ preventScroll: true }); };
  tools.querySelector('#markup-close').onclick = () => palette(false, { restoreFocus: true });
  document.addEventListener('pointerdown', event => {
    if (tools.contains(event.target) || visibility.contains(event.target)) return;
    // Drawing keeps the brush at hand. Native reading dismisses it naturally.
    if (visible.checked && enabled.checked && !savedError && !exempt(event.target) && (event.pointerType === 'pen' || any.checked)) return;
    palette(false);
  }, true);
  tools.querySelector('#markup-undo').onclick = () => { finish(false); if (ink.strokes.length) { future.push([ink.strokes.pop()]); save(); refresh(); onAction('Undo page markup', 'Last mark removed with recovery available'); } };
  tools.querySelector('#markup-redo').onclick = () => { finish(false); if (future.length) { ink.strokes.push(...future.pop()); save(); refresh(); onAction('Restore page markup', 'Removed marks restored'); } };
  tools.querySelector('#markup-clear').onclick = () => { finish(false); if (ink.strokes.length) { future.push(ink.strokes); ink = emptyMarkup(); save(); refresh(); onAction('Clear page markup', 'Marks cleared; Redo can restore them'); } };
  color.onchange = () => { brush(); if (!savedError) save(); onAction('Choose markup ink', 'Ink color changed'); };
  width.oninput = brush;
  width.onchange = () => { brush(); if (!savedError) save(); onAction('Choose markup width', 'Stroke width changed'); };
  tools.querySelector('.design-markup-options').addEventListener('toggle', () => { if (!tools.hidden) onAction('Inspect Pencil options', tools.querySelector('.design-markup-options').open ? 'Page input and saved marks controls opened' : 'Page input and saved marks controls folded'); });
  tools.querySelector('#markup-export').onclick = () => {
    finish(false);
    const snapshot = savedError ? unreadable : JSON.stringify({ ...ink, recovery: future, preferences: { enabled: enabled.checked, visible: visible.checked, color: color.value, width: Number(width.value) } }, null, 2);
    const url = URL.createObjectURL(new Blob([snapshot], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'megaapp-page-marks.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    onAction('Export page markup', 'Exact marks and recovery JSON prepared for browser download');
  };
  window.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (current) { event.preventDefault(); finish(false); } if (!tools.hidden) { event.preventDefault(); palette(false, { restoreFocus: true }); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { finish(false); palette(false, { record: false }); } }); window.addEventListener('blur', () => finish(false));
  controls(); showMarks(); inputMode(); brush(); refresh();
  function captureContext() {
    const page = root.getBoundingClientRect(), areas = {}, targets = [];
    for (const area of new Set(ink.strokes.map(stroke => stroke.area))) {
      const node = areaNode(area), box = node?.getBoundingClientRect(); if (!box) continue;
      const scale = outerScale(node), camera = area === 'context-map' ? JSON.parse(node.dataset.camera) : null;
      areas[area] = { x: box.left - page.left, y: box.top - page.top, width: box.width, height: box.height, ...(camera ? { camera:{...camera,x:camera.x*scale.x,y:camera.y*scale.y}, localCamera:camera, outerScale:scale } : {}) };
      for (const [index, target] of [...node.querySelectorAll('h1, h2, button, [data-term]')].entries()) {
        const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height || targets.length >= 100 || target.closest('.design-markup-tools')) continue;
        targets.push({ id: `${area}:${target.id || index}`, label: (target.getAttribute('aria-label') || target.dataset.term || target.textContent || '').slice(0, 120), area, x: rect.left - page.left, y: rect.top - page.top, width: rect.width, height: rect.height });
      }
    }
    return { ...ink, visible: visible.checked, controls: { open: !tools.hidden, optionsOpen: tools.querySelector('.design-markup-options').open }, pageGeometry: { width: page.width, height: page.height, areas, targets, ...(root.designCanvas ? {canvas:{camera:canvasCamera(),placement:'world-relative',legacyPagePlacement:'original-stroke-geometry-at-world-origin'}} : {}) }, input: visible.checked && enabled.checked ? any.checked ? 'any-pointer' : 'pencil' : 'native', ink: { color: color.value, width: Number(width.value) }, currentStroke: current ? { area: current.area, color: current.color, width: current.width, geometry: current.geometry, points: current.points } : null };
  }
  return { refresh: invalidate, hide() { finish(false); palette(false, { record: false }); }, captureContext };
}
