import { buildContextGraph, contextNeighborhood, termId } from './context-graph.js';
import { layoutContextMap, zoomMapAt, fitContextMap } from './context-map.js';
import { storageName } from './environment.js';

export function createContextToy({ onAction }) {
  const element = document.createElement('details'); element.className = 'context-toy'; element.id = 'design-context-toy';
  element.innerHTML = `<summary>Explore my context <span>Toy</span></summary>
    <div class="context-toy-body"><div class="context-map" role="group" aria-label="Whole dictionary map" tabindex="0">
      <svg class="context-lines" aria-hidden="true"><g></g></svg><div class="context-nodes"></div>
      <button class="context-home" type="button" aria-label="Show the whole map" title="Show the whole map"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 8l8 8m0-8-8 8"/></svg></button>
      <aside class="context-detail" hidden aria-label="Concept meaning"><button class="context-dismiss" type="button" aria-label="Close meaning">×</button><p id="context-kind"></p><h3 id="context-title"></h3><p id="context-definition"></p><details class="context-connections"><summary id="context-count"></summary><ul id="context-connections"></ul></details></aside>
      <p class="context-hint">Move a word. Drag space. Pinch to explore.</p>
    </div><div class="context-map-footer"><p class="context-key">Filled points: meanings. Open rings: questions. Links are proposals.</p><details class="context-options"><summary>Map options</summary><label for="context-search">Find a word</label><input id="context-search" type="search" placeholder="Find a word…"><p id="context-empty" hidden>No matching concepts.</p><p id="context-total"></p><div class="context-access"><button id="context-fit" type="button" class="quiet-button">Whole map</button><button id="context-zoom-in" type="button" class="quiet-button">Zoom in</button><button id="context-zoom-out" type="button" class="quiet-button">Zoom out</button><button id="context-undo" type="button" class="quiet-button">Undo arrangement</button><button id="context-export" type="button" class="quiet-button">Export map JSON</button></div><p>Arrow keys move across the map; + / − zoom; Home shows everything. Focus a word and use Shift + arrows to arrange it. Word placement is visual arrangement. Export preserves definitions, proposed connections and this view.</p></details></div><p id="context-save" role="status"></p></div>`;
  const map = element.querySelector('.context-map'), lines = element.querySelector('.context-lines g'), nodes = element.querySelector('.context-nodes'), detail = element.querySelector('.context-detail');
  const key = storageName('megaapp.design.context-toy.v1');
  let graph, points = [], focused = termId('Design'), authored = {}, history = [], camera = { zoom: 1, x: 0, y: 0 }, width = 1000, height = 560, gesture = null, interaction = null, wheelTimer, wheelStart, restoredView = null, restorationReady = false;
  const pointers = new Map(), buttons = new Map(), edges = [];
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (typeof saved?.focused === 'string') focused = saved.focused;
    element.open = saved?.open === true;
    const validPoints = value => value && typeof value === 'object' && Object.keys(value).length <= 100 && Object.values(value).every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y) && p.x >= -1 && p.x <= 2 && p.y >= -1 && p.y <= 2);
    if (saved?.viewVersion === 2 && validPoints(saved.positions)) { authored = saved.positions; history = (Array.isArray(saved.history) ? saved.history : []).filter(validPoints).slice(-12); }
    if (saved?.viewVersion === 2 && Number.isFinite(saved.camera?.zoom) && saved.camera.zoom >= .25 && saved.camera.zoom <= 5 && Number.isFinite(saved.camera.x) && Number.isFinite(saved.camera.y) && Math.abs(saved.camera.x) <= 100000 && Math.abs(saved.camera.y) <= 100000) restoredView = { camera: saved.camera, viewport: saved.viewport };
  } catch { /* Navigation is recoverable; the editable dictionary remains separate. */ }
  const copy = value => JSON.parse(JSON.stringify(value));
  function persist() {
    try { localStorage.setItem(key, JSON.stringify({ viewVersion: 2, focused, open: element.open, positions: authored, history, camera: restoredView?.camera || camera, viewport: restoredView?.viewport || { width, height } })); element.querySelector('#context-save').textContent = ''; }
    catch { element.querySelector('#context-save').textContent = 'This map stays for this session; the device could not save the view. Export is still available.'; }
    element.querySelector('#context-undo').disabled = !history.length;
  }
  function currentPoint(id) { return points.find(p => p.id === id); }
  // A Design window may be under an outer canvas scale. The Toy's camera and
  // layout remain in its own CSS pixels, independent of that parent camera.
  function local(event) { const rect = map.getBoundingClientRect(); return { x: (event.clientX - rect.left)*map.offsetWidth/Math.max(1,rect.width), y: (event.clientY - rect.top)*map.offsetHeight/Math.max(1,rect.height) }; }
  function world(point) { return { x: (point.x-camera.x)/camera.zoom, y: (point.y-camera.y)/camera.zoom }; }
  function fit(record = true) { cancel(); camera = fitContextMap(points,width,height); detail.hidden = true; paint(); persist(); if (record) { interaction = { kind: 'overview', phase: 'completed' }; onAction('Show whole context map', 'All dictionary concepts and open questions brought into view'); } }
  function select(id, keyboard = false) {
    focused = id; detail.hidden = false; describe(); paint(); persist();
    if (keyboard) buttons.get(id)?.focus({ preventScroll: true });
    interaction = { kind: 'concept-focus', phase: 'completed', node: id };
    onAction('Explore context concept', 'Meaning shown on the whole dictionary map');
  }
  function describe() {
    const { focus, connections } = contextNeighborhood(graph,focused); focused = focus.id;
    element.querySelector('#context-kind').textContent = focus.kind === 'question' ? 'Open question' : focus.state === 'draft' ? 'Meaning still to write' : 'My dictionary';
    element.querySelector('#context-title').textContent = focus.label; element.querySelector('#context-definition').textContent = focus.definition || 'This meaning is still unwritten.';
    element.querySelector('#context-count').textContent = `${connections.length} proposed connection${connections.length === 1 ? '' : 's'}`;
    const list = element.querySelector('#context-connections'); list.replaceChildren();
    for (const { node, explanation } of connections) { const li = document.createElement('li'), link = document.createElement('button'); link.type = 'button'; link.className = 'context-relation'; link.textContent = node.label; link.onclick = e => select(node.id,e.detail === 0); const p = document.createElement('p'); p.textContent = explanation; li.append(link,p); list.append(li); }
  }
  function paint() {
    const transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`; nodes.style.transform = transform; lines.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.zoom})`);
    const neighbors = new Set(graph?.relations.filter(e => e.from === focused || e.to === focused).flatMap(e => [e.from,e.to]));
    for (const p of points) { const b = buttons.get(p.id); if (!b) continue; b.style.left = `${p.x}px`; b.style.top = `${p.y}px`; b.dataset.focused = String(!detail.hidden && p.id === focused); b.dataset.near = String(detail.hidden || neighbors.has(p.id)); b.dataset.moving = String(gesture?.kind === 'node' && gesture.id === p.id); }
    for (const { edge, path } of edges) { const a = currentPoint(edge.from), b = currentPoint(edge.to); if (!a || !b) continue; const bend = (hashEdge(edge.id)%2 ? 1 : -1)*Math.min(24,Math.hypot(b.x-a.x,b.y-a.y)*.06), mx=(a.x+b.x)/2, my=(a.y+b.y)/2; path.setAttribute('d', `M ${a.x} ${a.y-10} Q ${mx+bend} ${my-10-bend} ${b.x} ${b.y-10}`); path.dataset.active = String(!detail.hidden && (edge.from === focused || edge.to === focused)); }
    map.dataset.exploring = String(Boolean(gesture));
    map.dataset.camera = JSON.stringify(camera); map.dispatchEvent(new CustomEvent('contextmapview', { bubbles: true }));
    if (!detail.hidden) { const p = currentPoint(focused); if (p) { const x=p.x*camera.zoom+camera.x, y=p.y*camera.zoom+camera.y, dw=Math.min(310,width-24); detail.style.width=`${dw}px`; detail.style.left=`${Math.max(12,Math.min(width-dw-12,x+22))}px`; detail.style.top=`${Math.max(12,Math.min(height-220,y+22))}px`; } }
  }
  function hashEdge(id) { let h=0; for(const c of id) h=(h*31+c.charCodeAt(0))>>>0; return h; }
  function measure(force = false) {
    if (!graph || !element.open || !map.clientWidth) return;
    const nextWidth=map.clientWidth,nextHeight=map.clientHeight; if (!force && nextWidth===width && nextHeight===height) return;
    cancel(); width=nextWidth; height=nextHeight; points=layoutContextMap(graph,width,height);
    for(const p of points) if(authored[p.id]) { p.x=authored[p.id].x*width; p.y=authored[p.id].y*height; }
    for(const p of points) { const b=buttons.get(p.id); if(b) { b.style.width=`${p.width}px`; b.style.fontSize=`${p.font}px`; } }
    if (restorationReady && restoredView && restoredView.viewport?.width === width && restoredView.viewport?.height === height) camera = restoredView.camera;
    else camera=fitContextMap(points,width,height);
    // The containing Design window is built after this Toy. Keep the saved view
    // until that initial width has settled, rather than consuming it at the
    // temporary document width and losing the user's camera on reload.
    if (restorationReady) restoredView=null;
    paint();
  }
  function build() {
    const active=document.activeElement?.dataset.id;
    lines.replaceChildren(); nodes.replaceChildren(); buttons.clear(); edges.length=0;
    const oldPoints=new Map(points.map(p=>[p.id,p])); points=layoutContextMap(graph,width,height);
    for(const p of points) { if(authored[p.id]) { p.x=authored[p.id].x*width; p.y=authored[p.id].y*height; } else if(oldPoints.has(p.id)) { p.x=oldPoints.get(p.id).x; p.y=oldPoints.get(p.id).y; } }
    for(const node of graph.nodes) { const p=currentPoint(node.id), button=document.createElement('button'); button.type='button'; button.className='context-concept'; button.dataset.id=node.id; button.dataset.kind=node.kind; button.dataset.directInput=''; button.style.width=`${p.width}px`; button.style.fontSize=`${p.font}px`; button.setAttribute('aria-label', `${node.label}${node.kind==='question'?', open question':', dictionary meaning'}`);
      const dot=document.createElement('i'); dot.setAttribute('aria-hidden','true'); const label=document.createElement('span'); label.textContent=node.label; button.append(dot,label); button.onclick=e=>{ if(e.detail===0) select(node.id,true); }; nodes.append(button); buttons.set(node.id,button); }
    for(const edge of graph.relations) { const path=document.createElementNS('http://www.w3.org/2000/svg','path'); lines.append(path); edges.push({edge,path}); }
    describe(); paint(); filter(); if(active) buttons.get(active)?.focus({preventScroll:true});
    element.querySelector('#context-total').textContent=`${graph.nodes.filter(n=>n.kind==='term').length} meanings, ${graph.nodes.filter(n=>n.kind==='question').length} open questions`;
  }
  function filter() {
    const query=element.querySelector('#context-search').value.trim().toLocaleLowerCase(); let matches=0;
    for(const node of graph.nodes) { const match=!query || `${node.label} ${node.definition}`.toLocaleLowerCase().includes(query); buttons.get(node.id).dataset.match=String(match); if(match) matches++; }
    element.querySelector('#context-empty').hidden=matches!==0;
  }
  function begin(kind,id,point,event) { gesture={kind,id,start:point,last:point,from:copy(camera),positions:copy(authored),node:currentPoint(id)?{x:currentPoint(id).x,y:currentPoint(id).y}:null,moved:false,at:event.timeStamp,samples:[],types:[event.pointerType]}; detail.hidden=true; sample(point,event); paint(); }
  function sample(point,event) { if(!gesture) return; const last=gesture.samples.at(-1); if(!last || event.timeStamp-last.t>32) { gesture.samples.push({x:Math.round(point.x*10)/10,y:Math.round(point.y*10)/10,t:Math.round(event.timeStamp)}); if(gesture.samples.length>64) gesture.samples.shift(); } }
  function releaseCaptures() { const ids=[...pointers.keys()]; pointers.clear(); for(const id of ids) { try { if(map.hasPointerCapture(id)) map.releasePointerCapture(id); } catch {} } pointers.clear(); }
  function complete(cancelled = false) {
    if(!gesture) return;
    const old=gesture; gesture=null;
    if(cancelled) { camera=old.from; authored=old.positions; if(old.node && currentPoint(old.id)) Object.assign(currentPoint(old.id),old.node); }
    else if(old.kind==='node' && old.moved) { history.push(old.positions); history=history.slice(-12); const p=currentPoint(old.id); authored[old.id]={x:p.x/width,y:p.y/height}; }
    interaction={kind:old.kind,phase:cancelled?'cancelled':'completed',node:old.id||null,input:old.types,from:old.from,to:copy(camera),samples:old.samples,...(old.node?{fromNode:old.node,toNode:copy(currentPoint(old.id))}:{})};
    paint(); persist();
    if(cancelled) onAction('Cancel context map gesture','Previous arrangement and view restored');
    else if(old.moved || old.kind==='pinch') onAction(old.kind==='node'?'Arrange context concept':'Navigate context map',old.kind==='node'?'Visual position saved; meaning and connections unchanged':'Map view saved');
    else if(old.id) select(old.id);
  }
  function cancel() { if(gesture) complete(true); releaseCaptures(); }
  const excluded=target=>target.closest?.('.context-detail, .context-home');
  const drawing = () => element.closest('#design-guide')?.dataset.markupDrawing === 'true';
  map.addEventListener('pointerdown',event=>{
    if(drawing() || excluded(event.target) || pointers.size>=2 || event.button!==0 || (event.pointerType!=='touch' && !event.isPrimary)) return;
    event.preventDefault(); map.focus({preventScroll:true}); const point=local(event); pointers.set(event.pointerId,{...point,type:event.pointerType}); try{map.setPointerCapture(event.pointerId);}catch{}
    if(pointers.size===1) begin(event.target.closest('.context-concept')?'node':'pan',event.target.closest('.context-concept')?.dataset.id,point,event);
    else if(pointers.size===2) { if(gesture?.kind==='node' && gesture.node) Object.assign(currentPoint(gesture.id),gesture.node); const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2}; begin('pinch',null,mid,event); gesture.distance=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)); gesture.world=world(mid); gesture.types=[...pointers.values()].map(p=>p.type); }
  });
  map.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId) || !gesture) return; event.preventDefault(); map.focus({preventScroll:true}); const point=local(event); pointers.set(event.pointerId,{...point,type:event.pointerType}); const dx=point.x-gesture.start.x,dy=point.y-gesture.start.y;
    if(gesture.kind==='pinch' && pointers.size>=2) { const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},zoom=Math.max(.25,Math.min(5,gesture.from.zoom*Math.hypot(b.x-a.x,b.y-a.y)/gesture.distance)); camera={zoom,x:mid.x-gesture.world.x*zoom,y:mid.y-gesture.world.y*zoom}; gesture.moved=true; }
    else if(Math.hypot(dx,dy)>4 || gesture.moved) { gesture.moved=true; if(gesture.kind==='node') { const p=currentPoint(gesture.id); p.x=Math.max(-width,Math.min(width*2,gesture.node.x+dx/camera.zoom)); p.y=Math.max(-height,Math.min(height*2,gesture.node.y+dy/camera.zoom)); } else { camera={...gesture.from,x:Math.max(-width*4,Math.min(width*4,gesture.from.x+dx)),y:Math.max(-height*4,Math.min(height*4,gesture.from.y+dy))}; } }
    sample(point,event); gesture.last=point; paint();
  });
  map.addEventListener('pointerup',event=>{ if(!pointers.has(event.pointerId))return; pointers.delete(event.pointerId); complete(); try{if(map.hasPointerCapture(event.pointerId))map.releasePointerCapture(event.pointerId);}catch{} if(pointers.size===1)begin('pan',null,[...pointers.values()][0],event); });
  map.addEventListener('pointercancel',cancel); map.addEventListener('lostpointercapture',event=>{if(pointers.has(event.pointerId))cancel();});
  map.addEventListener('wheel',event=>{if(drawing()){event.preventDefault();return;}if(excluded(event.target))return;event.preventDefault(); if(!wheelStart)wheelStart=copy(camera); camera=zoomMapAt(camera,local(event),camera.zoom*Math.exp(-Math.max(-200,Math.min(200,event.deltaY))*.003)); detail.hidden=true;paint();clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{interaction={kind:'zoom',phase:'completed',input:['wheel'],from:wheelStart,to:copy(camera)};wheelStart=null;persist();onAction('Navigate context map','Zoomed map view saved');},180);},{passive:false});
  function zoom(factor) {cancel();const from=copy(camera);camera=zoomMapAt(camera,{x:width/2,y:height/2},camera.zoom*factor);paint();persist();interaction={kind:'zoom',phase:'completed',input:['keyboard-or-control'],from,to:copy(camera)};onAction('Navigate context map','Zoomed map view saved');}
  map.addEventListener('keydown',event=>{
    if(drawing()) return;
    if(excluded(event.target))return;
    if(event.key==='Escape'){event.preventDefault();if(gesture)cancel();else{detail.hidden=true;paint();}return;}
    if(event.key==='Home'){event.preventDefault();fit();return;}
    if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?.8:1.25);return;}
    const vector={ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key]; if(vector){event.preventDefault();cancel();const node=event.target.closest?.('.context-concept');
      if(event.shiftKey && node){const p=currentPoint(node.dataset.id),fromNode={x:p.x,y:p.y};history.push(copy(authored));history=history.slice(-12);p.x=Math.max(-width,Math.min(2*width,p.x-vector[0]*20/camera.zoom));p.y=Math.max(-height,Math.min(2*height,p.y-vector[1]*20/camera.zoom));authored[p.id]={x:p.x/width,y:p.y/height};detail.hidden=true;interaction={kind:'node',phase:'completed',node:p.id,input:['keyboard'],fromNode,toNode:{x:p.x,y:p.y}};paint();persist();onAction('Arrange context concept','Visual position saved; meaning and connections unchanged');return;}
      const from=copy(camera);camera.x+=vector[0]*40;camera.y+=vector[1]*40;detail.hidden=true;paint();persist();interaction={kind:'pan',phase:'completed',input:['keyboard'],from,to:copy(camera)};onAction('Navigate context map','Map view saved');}
  });
  element.querySelector('.context-dismiss').onclick=()=>{detail.hidden=true;paint();buttons.get(focused)?.focus({preventScroll:true});};
  element.querySelector('.context-home').onclick=()=>fit();element.querySelector('#context-fit').onclick=()=>fit();
  element.querySelector('#context-zoom-in').onclick=()=>zoom(1.25);element.querySelector('#context-zoom-out').onclick=()=>zoom(.8);
  element.querySelector('#context-undo').onclick=()=>{cancel();if(!history.length)return;authored=history.pop();points=layoutContextMap(graph,width,height);for(const p of points)if(authored[p.id]){p.x=authored[p.id].x*width;p.y=authored[p.id].y*height;}fit(false);persist();interaction={kind:'arrangement-undo',phase:'completed'};onAction('Restore context arrangement','Previous visual arrangement restored');};
  element.querySelector('#context-search').oninput=filter;
  element.querySelector('#context-export').onclick=()=>{const data={...graph,presentation:{format:'megaapp.context-map-view',version:1,...viewContext()}},url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='megaapp-design-context-map.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);onAction('Export context map','Dictionary and visual map exported');};
  element.addEventListener('toggle',event=>{if(event.target!==element || !graph)return;if(element.open){measure();onAction('Open context Toy','Whole dictionary map opened');}else {cancel();clearTimeout(wheelTimer);if(wheelStart){camera=wheelStart;wheelStart=null;paint();}}persist();});
  const observer=new ResizeObserver(()=>measure());observer.observe(map);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  requestAnimationFrame(()=>requestAnimationFrame(()=>{restorationReady=true;measure(true);persist();}));
  function viewContext(){return{camera:copy(camera),viewport:{width,height},positions:points.map(p=>({id:p.id,x:p.x/width,y:p.y/height})),placement:'visual-arrangement'};}
  return {element, interrupt: cancel,
    update(content){const next=buildContextGraph(content),different=JSON.stringify(next)!==JSON.stringify(graph);if(!different)return;cancel();graph=next;authored=Object.fromEntries(Object.entries(authored).filter(([id])=>graph.nodes.some(n=>n.id===id)));if(!graph.nodes.some(n=>n.id===focused))focused=graph.nodes[0].id;build();measure(true);persist();},
    hide(){cancel();clearTimeout(wheelTimer);if(wheelStart){camera=wheelStart;wheelStart=null;paint();persist();}},
    captureContext(){const focus=graph?.nodes.find(n=>n.id===focused);return{open:element.open,view:'whole-map',focused:focus?{id:focus.id,label:focus.label,kind:focus.kind}:null,connections:'assistant-proposals',...viewContext(),interaction:gesture?{kind:gesture.kind,phase:'active',node:gesture.id||null,samples:copy(gesture.samples)}:copy(interaction)};},
  };
}
