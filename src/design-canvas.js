import { storageName } from './environment.js';
import { canvasZoomAt, fitCanvasWindows, readCanvasSave, canvasSave, clampCanvas } from './design-canvas-state.js';

export function createDesignCanvas({ root, sections, onAction = () => {}, onInterrupt = () => {} }) {
  const key = storageName('megaapp.design.canvas.v1');
  const background = document.createElement('div'); background.className = 'design-canvas-background'; background.setAttribute('aria-hidden','true');
  const world = document.createElement('div'); world.className = 'design-canvas-world';
  const masthead = root.querySelector('.design-masthead'), editorTools = root.querySelector('.design-edit-tools');
  const mastheadBody = document.createElement('div'); mastheadBody.className = 'design-canvas-masthead-body';
  while (masthead.firstChild) mastheadBody.append(masthead.firstChild);
  masthead.append(mastheadBody, editorTools);
  world.append(masthead, root.querySelector('.design-principles'));
  const toy = root.querySelector('#design-context-toy'), toyWindow = document.createElement('section'); toyWindow.className = 'design-canvas-toy'; toyWindow.append(toy);
  world.append(toyWindow,root.querySelector('.design-footnote'));
  root.prepend(background,world); root.classList.add('design-canvas'); root.tabIndex = 0;
  root.setAttribute('aria-label', 'Design canvas. Drag empty space to navigate. Use the window chooser, or focus the canvas and use arrow keys.');
  const nodes = new Map([['masthead',masthead],...sections,['context-toy',toyWindow],['footnote',world.querySelector('.design-footnote')]]);
  const names = {masthead:'Beginning','context-toy':'Context Toy',footnote:'Reading and dictionary'};
  const controls = document.createElement('nav'); controls.id = 'design-canvas-controls'; controls.className = 'design-canvas-controls'; controls.setAttribute('aria-label','Canvas navigation');
  controls.innerHTML = `<div class="design-canvas-navigation"><button id="design-canvas-home" type="button" class="quiet-button">Beginning</button><select id="design-canvas-window" aria-label="Go to window"><option value="">Go to…</option></select><button id="design-canvas-overview" type="button" class="quiet-button">Whole space</button><details class="design-canvas-options"><summary aria-label="Canvas view and arrangement"><span id="design-canvas-zoom">100%</span></summary><div><div class="design-canvas-zoom-actions"><button id="design-canvas-zoom-out" type="button" class="quiet-button" aria-label="Zoom canvas out">−</button><button id="design-canvas-actual" type="button" class="quiet-button">100%</button><button id="design-canvas-zoom-in" type="button" class="quiet-button" aria-label="Zoom canvas in">+</button></div><p>Drag empty space to move. Use two fingers over reading material or empty space to move and zoom. Control and the scroll wheel also zoom. Drag a window’s title to arrange it. Arrow keys on its title move it; its corner changes width.</p><button id="design-canvas-undo" type="button" class="quiet-button">Undo arrangement</button><button id="design-canvas-reset" type="button" class="quiet-button">Arrange from document</button><button id="design-canvas-export" type="button" class="quiet-button">Save canvas JSON</button><button id="design-canvas-import" type="button" class="quiet-button">Import canvas JSON</button><input id="design-canvas-file" type="file" accept=".json,application/json" hidden><button id="design-canvas-export-unreadable" type="button" class="quiet-button" hidden>Save unreadable arrangement</button><p id="design-canvas-status" role="status"></p></div></details></div>`;
  root.append(controls);
  const status = controls.querySelector('#design-canvas-status'), chooser = controls.querySelector('#design-canvas-window');
  let camera = {x:28,y:92,zoom:1}, windows = [], history = [], gesture, touchGesture, saveTimer, layoutReady = false, raw, unreadable, frame, lastViewport, dirty=false, importGeneration=0;
  const contacts = new Map();
  function viewport() { return {width:root.clientWidth || innerWidth,height:root.clientHeight || innerHeight}; }
  function snapshot() { return {camera:{...camera},windows:windows.map(w=>({id:w.id,x:w.x,y:w.y,width:w.width}))}; }
  function remember(before) { if (JSON.stringify(before) === JSON.stringify(snapshot())) return; history.push(before); history=history.slice(-12); }
  function persist() {
    if(!dirty)return true;
    try {
      if (unreadable) { localStorage.setItem(`${key}.unreadable`,unreadable); unreadable=null; }
      localStorage.setItem(key,JSON.stringify(canvasSave(snapshot(),history))); status.textContent='Your view and windows are saved on this device.'; dirty=false; return true;
    } catch { status.textContent='Could not save this canvas. Save canvas JSON to keep this arrangement.'; controls.querySelector('.design-canvas-options').open=true; return false; }
  }
  function changed(action,outcome,interaction) { dirty=true; const saved=persist(); onAction(action,saved?outcome:'View retained in session; local save failed',{...interaction,persistence:saved?'saved':'session-only'}); }
  function local(event) { const r=root.getBoundingClientRect(); return {x:event.clientX-r.left,y:event.clientY-r.top}; }
  function windowState(id) { return windows.find(w=>w.id===id); }
  function bringForward(id) { const index=windows.findIndex(w=>w.id===id);if(index<0 || index===windows.length-1)return;const [w]=windows.splice(index,1);windows.push(w);dirty=true;paint(); }
  function measured() { return windows.map(w=>({...w,height:nodes.get(w.id).offsetHeight})); }
  function screenToWorld(x,y) { const r=root.getBoundingClientRect(); return {x:(x-r.left-camera.x)/camera.zoom,y:(y-r.top-camera.y)/camera.zoom}; }
  function paint() {
    if (!layoutReady) return;
    camera.x=clampCanvas(camera.x);camera.y=clampCanvas(camera.y);
    world.style.transform=`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    root.dataset.canvasCamera=JSON.stringify(camera); root.dataset.canvasZoom=String(camera.zoom);
    for (const [index,w] of windows.entries()) { const node=nodes.get(w.id);node.style.zIndex=String(index+1); node.style.left=`${w.x}px`; node.style.top=`${w.y}px`; node.style.width=`${w.width}px`; }
    controls.querySelector('#design-canvas-zoom').textContent=camera.zoom<.01?'<1%':`${Math.round(camera.zoom*100)}%`;
    controls.querySelector('#design-canvas-undo').disabled=!history.length;
    background.style.backgroundImage=camera.zoom<.2?'none':'';
    background.style.backgroundPosition=`${camera.x}px ${camera.y}px`; background.style.backgroundSize=`${40*camera.zoom}px ${40*camera.zoom}px`;
    root.dispatchEvent(new CustomEvent('designcanvasview',{bubbles:true,detail:{camera:{...camera},windows:measured()}}));
  }
  function schedule() { if (!frame) frame=requestAnimationFrame(()=>{frame=null;paint();}); }
  function defaults() {
    const v=viewport(), width=Math.max(280,Math.min(1100,v.width-56)), gap=32, columns=Number(root.querySelector('.design-principles').dataset.columns || 2)===1 || width<760 ? 1:2;
    const values=[{id:'masthead',x:0,y:0,width}];
    masthead.style.width=`${width}px`;
    let heights=Array(columns).fill(masthead.offsetHeight+gap);
    const wide=(id)=>sections.get(id).style.gridColumn==='1 / -1';
    for(const section of root.querySelector('.design-principles').children) {
      const id=section.dataset.principle, full=columns===1 || wide(id), col=heights.indexOf(Math.min(...heights)), w=full?width:(width-gap)/2;
      section.style.width=`${w}px`; const y=full?Math.max(...heights):heights[col];
      values.push({id,x:full?0:col*(w+gap),y,width:w});
      if(full)heights=heights.map(()=>y+section.offsetHeight+gap);else heights[col]=y+section.offsetHeight+gap;
    }
    const y=Math.max(...heights); toyWindow.style.width=`${width}px`; values.push({id:'context-toy',x:0,y,width});
    const footnote=nodes.get('footnote'); footnote.style.width=`${width}px`; values.push({id:'footnote',x:0,y:y+toyWindow.offsetHeight+gap,width});
    return values;
  }
  function focusWindow(id,{save=true}={}) {
    if(!layoutReady || !nodes.has(id) || root.dataset.markupDrawing==='true')return;
    onInterrupt(); interrupt();
    const w=windowState(id), v=viewport(), top=84, margin=24;
    if(v.width<=650 && w.width>v.width-margin*2){const before=snapshot();w.width=Math.max(260,v.width-margin*2);remember(before);}
    const zoom=Math.max(.1,Math.min(1,(v.width-margin*2)/w.width));
    camera={zoom,x:(v.width-w.width*zoom)/2-w.x*zoom,y:top-w.y*zoom};
    bringForward(id);chooser.value=id; paint(); if(save)changed('Focus canvas window',`Showing ${label(id)}`,{operation:'canvas-focus',window:id});
  }
  function label(id) { return names[id] || sections.get(id)?.querySelector('h2')?.textContent || id; }
  function interrupt(reason='Canvas interaction interrupted') {
    if(touchGesture){const ended=touchGesture;touchGesture=null;camera=ended.before.camera;windows=ended.before.windows;dirty=true;paint();persist();if(ended.moved)onAction('Cancel canvas gesture','Previous view and arrangement kept',{operation:'canvas-cancel',reason});}
    clearTimeout(saveTimer); saveTimer=null;
    if(gesture) { const before=gesture.before; const moved=gesture.moved; release(); camera=before.camera; windows=before.windows; dirty=true;paint();persist(); if(moved)onAction('Cancel canvas gesture','Previous view and arrangement kept',{operation:'canvas-cancel',reason}); }
    contacts.clear();
  }
  function release() { const current=gesture; gesture=null; if(current?.handle?.hasPointerCapture(current.pointer))current.handle.releasePointerCapture(current.pointer); }
  function sample(event) { if(!gesture)return; const p=local(event); gesture.samples.push({x:p.x,y:p.y,t:Math.max(0,event.timeStamp-gesture.started)}); if(gesture.samples.length>64)gesture.samples.splice(1,1); }
  function begin(event,kind,id,handle) {
    if(event.button!==0 || event.pointerType==='pen' || (root.classList.contains('design-draw-any') || root.dataset.markupDrawing === 'true'))return;
    if(gesture || touchGesture)interrupt(); onInterrupt(); event.preventDefault();
    const p=local(event), before=snapshot(); gesture={kind,id,handle,pointer:event.pointerId,start:p,before,started:event.timeStamp,moved:false,samples:[]}; sample(event);
    try { handle.setPointerCapture(event.pointerId); } catch { /* Synthetic evidence has no hardware capture. */ } if(id){bringForward(id);handle.focus({preventScroll:true});}
  }
  for(const [id,node] of nodes) {
    node.classList.add('design-window'); node.dataset.window=id;
    const bar=document.createElement('div'); bar.className='design-window-chrome';
    const handle=document.createElement('button'); handle.type='button'; handle.className='design-window-handle'; handle.dataset.directInput=''; handle.textContent=label(id); handle.setAttribute('aria-label',`Move ${label(id)} window. Arrow keys move it.`);
    const focus=document.createElement('button'); focus.type='button'; focus.className='design-window-focus'; focus.textContent='↗'; focus.setAttribute('aria-label',`Focus ${label(id)} window`); focus.onclick=()=>focusWindow(id);
    bar.append(handle,focus); node.prepend(bar);
    const resize=document.createElement('button'); resize.type='button'; resize.className='design-window-resize'; resize.textContent='◢'; resize.setAttribute('aria-label',`Resize ${label(id)} window. Left and right arrows change width.`); node.append(resize);
    handle.onpointerdown=e=>begin(e,'move',id,handle); resize.onpointerdown=e=>begin(e,'resize',id,resize);
    for(const button of [handle,resize])button.onkeydown=e=>{
      if(root.dataset.markupDrawing==='true')return;
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return; e.preventDefault();e.stopPropagation();interrupt();onInterrupt(); const before=snapshot(),w=windowState(id),step=e.shiftKey?32:8;
      if(button===resize) { if(e.key==='ArrowLeft'||e.key==='ArrowRight')w.width=Math.max(260,Math.min(1600,w.width+(e.key==='ArrowRight'?step:-step))); }
      else { w.x=clampCanvas(w.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0));w.y=clampCanvas(w.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)); }
      remember(before);paint();changed(button===resize?'Resize canvas window':'Move canvas window','Arrangement updated',{operation:button===resize?'canvas-resize':'canvas-move',window:id,keyboard:true});
    };
    chooser.add(new Option(label(id),id));
  }
  background.onpointerdown=event=>{
    if(event.pointerType==='pen' || root.classList.contains('design-draw-any'))return;
    const p=local(event);contacts.set(event.pointerId,p);
    if(contacts.size===1)begin(event,'pan',null,background);
    else if(contacts.size===2 && gesture?.kind==='pan') {
      event.preventDefault(); try { background.setPointerCapture(event.pointerId); } catch { /* Synthetic contact. */ } const [a,b]=contacts.values();gesture.kind='pinch';gesture.distance=Math.hypot(a.x-b.x,a.y-b.y);gesture.mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};gesture.pinchCamera={...camera};
    }
  };
  root.addEventListener('pointermove',event=>{
    if(!gesture)return;const p=local(event);
    if(contacts.has(event.pointerId))contacts.set(event.pointerId,p);
    if(gesture.kind==='pinch') {
      if(contacts.size!==2)return;const [a,b]=contacts.values(),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      camera=canvasZoomAt(gesture.pinchCamera,gesture.mid,gesture.pinchCamera.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,gesture.distance));camera.x=clampCanvas(camera.x+mid.x-gesture.mid.x);camera.y=clampCanvas(camera.y+mid.y-gesture.mid.y);
    } else {
      if(gesture.pointer!==event.pointerId)return;const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
      if(gesture.kind==='pan')camera={...gesture.before.camera,x:clampCanvas(gesture.before.camera.x+dx),y:clampCanvas(gesture.before.camera.y+dy)};
      else { const w=windowState(gesture.id),start=gesture.before.windows.find(w=>w.id===gesture.id);if(gesture.kind==='move'){w.x=clampCanvas(start.x+dx/camera.zoom);w.y=clampCanvas(start.y+dy/camera.zoom);}else w.width=Math.max(260,Math.min(1600,start.width+dx/camera.zoom)); }
    }
    event.preventDefault();gesture.moved=true;sample(event);paint();
  });
  root.addEventListener('pointerup',event=>{
    contacts.delete(event.pointerId);if(!gesture || (gesture.pointer!==event.pointerId && gesture.kind!=='pinch'))return;
    const ended=gesture;if(ended.moved)remember(ended.before);release();for(const id of contacts.keys())if(background.hasPointerCapture(id))background.releasePointerCapture(id);contacts.clear();paint();
    if(!ended.moved)persist();
    if(ended.moved)changed(ended.kind==='move'?'Move canvas window':ended.kind==='resize'?'Resize canvas window':'Navigate design canvas','View and arrangement kept',{operation:`canvas-${ended.kind}`,window:ended.id,started:ended.started,samples:ended.samples});
  });
  root.addEventListener('pointercancel',()=>{if(gesture)interrupt('Pointer canceled');});
  root.addEventListener('lostpointercapture',event=>{if(gesture?.pointer===event.pointerId)interrupt('Capture lost');});
  // Two contacts on reading material navigate the space; one keeps native
  // selection and callouts. A nested Toy or editing control owns its contacts.
  const touchPair=touches=>{const a=local(touches[0]),b=local(touches[1]);return{mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.hypot(a.x-b.x,a.y-b.y)};};
  root.addEventListener('touchstart',event=>{
    if(event.touches.length!==2 || !event.target.closest('.design-window') || [...event.touches].some(t=>t.touchType==='stylus' || t.target?.closest('.context-map, .design-canvas-controls, .design-markup-tools, textarea, input, select, button, a, summary, [contenteditable], #design-touch-board')) || root.dataset.markupDrawing==='true' || root.classList.contains('design-draw-any'))return;
    event.preventDefault();interrupt();onInterrupt();const pair=touchPair(event.touches);touchGesture={before:snapshot(),camera:{...camera},...pair,started:event.timeStamp,moved:false,samples:[]};
  },{passive:false});
  root.addEventListener('touchmove',event=>{
    if(!touchGesture)return;if(event.touches.length!==2){interrupt('Touch count changed');return;}event.preventDefault();const pair=touchPair(event.touches);
    camera=canvasZoomAt(touchGesture.camera,touchGesture.mid,touchGesture.camera.zoom*pair.distance/Math.max(1,touchGesture.distance));camera.x=clampCanvas(camera.x+pair.mid.x-touchGesture.mid.x);camera.y=clampCanvas(camera.y+pair.mid.y-touchGesture.mid.y);touchGesture.moved=true;touchGesture.samples.push({x:pair.mid.x,y:pair.mid.y,distance:pair.distance,t:Math.max(0,event.timeStamp-touchGesture.started)});if(touchGesture.samples.length>64)touchGesture.samples.splice(1,1);paint();
  },{passive:false});
  root.addEventListener('touchend',event=>{if(!touchGesture)return;event.preventDefault();const ended=touchGesture;touchGesture=null;if(ended.moved){remember(ended.before);paint();changed('Navigate design canvas','View and arrangement kept',{operation:'canvas-pinch',surface:'reading-window',started:ended.started,samples:ended.samples});}},{passive:false});
  root.addEventListener('touchcancel',()=>{if(touchGesture)interrupt('Touch canceled');});
  root.addEventListener('wheel',event=>{
    if(root.dataset.markupDrawing==='true'){event.preventDefault();return;}
    if(event.defaultPrevented || event.target.closest('.context-map, .design-canvas-controls, .design-markup-tools, textarea, input, select') || root.classList.contains('design-draw-any'))return;
    onInterrupt();if(gesture || touchGesture)interrupt();event.preventDefault();const p=local(event),factor=event.deltaMode===1?16:event.deltaMode===2?root.clientHeight:1;
    if(event.ctrlKey || event.metaKey)camera=canvasZoomAt(camera,p,camera.zoom*Math.exp(-event.deltaY*factor*.002));
    else {camera.x=clampCanvas(camera.x-event.deltaX*factor);camera.y=clampCanvas(camera.y-event.deltaY*factor);}
    dirty=true;paint();clearTimeout(saveTimer);saveTimer=setTimeout(()=>changed('Navigate design canvas','Viewing position saved',{operation:event.ctrlKey?'canvas-zoom':'canvas-pan'}),180);
  },{passive:false});
  root.addEventListener('keydown',event=>{
    if(root.dataset.markupDrawing==='true')return;
    if(event.key==='Escape' && (gesture || touchGesture)){event.preventDefault();interrupt('Escape');return;}
    if(event.target!==root && event.target!==background)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const step=event.shiftKey?120:40;camera.x=clampCanvas(camera.x+(event.key==='ArrowRight'?-step:event.key==='ArrowLeft'?step:0));camera.y=clampCanvas(camera.y+(event.key==='ArrowDown'?-step:event.key==='ArrowUp'?step:0));paint();changed('Navigate design canvas','Viewing position saved',{operation:'canvas-pan',keyboard:true});}
    else if(event.key==='Home'){event.preventDefault();focusWindow('masthead');}
    else if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?1/1.2:1.2);}
  });
  function zoom(factor) {if(root.dataset.markupDrawing==='true')return;onInterrupt();interrupt();const v=viewport();camera=canvasZoomAt(camera,{x:v.width/2,y:v.height/2},camera.zoom*factor);paint();changed('Zoom design canvas','Viewing scale saved',{operation:'canvas-zoom'});}
  controls.querySelector('#design-canvas-home').onclick=()=>focusWindow('masthead');
  chooser.onchange=()=>focusWindow(chooser.value);
  controls.querySelector('#design-canvas-overview').onclick=()=>{if(root.dataset.markupDrawing==='true')return;onInterrupt();interrupt();const v=viewport();camera=fitCanvasWindows(measured(),v.width,v.height-76,36);camera.y+=76;paint();changed('Show whole design canvas','All windows in view',{operation:'canvas-overview'});};
  controls.querySelector('#design-canvas-zoom-in').onclick=()=>zoom(1.2);controls.querySelector('#design-canvas-zoom-out').onclick=()=>zoom(1/1.2);controls.querySelector('#design-canvas-actual').onclick=()=>zoom(1/camera.zoom);
  controls.querySelector('#design-canvas-undo').onclick=()=>{if(root.dataset.markupDrawing==='true')return;interrupt();if(!history.length)return;const restored=history.pop();camera=restored.camera;windows=restored.windows;paint();changed('Undo canvas arrangement','Previous view and windows restored',{operation:'canvas-undo'});};
  controls.querySelector('#design-canvas-reset').onclick=()=>{if(root.dataset.markupDrawing==='true')return;interrupt();remember(snapshot()); const before=snapshot();windows=defaults();focusWindow('masthead',{save:false});remember(before);paint();changed('Arrange design canvas','Document order arranged; previous windows kept in Undo',{operation:'canvas-arrange'});};
  function download(content,name) {const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  controls.querySelector('#design-canvas-export').onclick=()=>{download(JSON.stringify({...canvasSave(snapshot(),history),windows:measured()},null,2)+'\n','megaapp-design-canvas.json');onAction('Export design canvas','Portable arrangement created',{operation:'canvas-export'});};
  const importFile=controls.querySelector('#design-canvas-file');
  controls.querySelector('#design-canvas-import').onclick=()=>importFile.click();
  importFile.onchange=async()=>{const file=importFile.files?.[0];if(!file)return;const generation=++importGeneration;
    try{if(file.size>256*1024)throw new Error('Choose a canvas file smaller than 256 KB.');const imported=readCanvasSave(JSON.parse(await file.text()),[...nodes.keys()]);if(generation!==importGeneration)return;if(root.dataset.markupDrawing==='true')throw new Error('Finish drawing before importing an arrangement.');interrupt();onInterrupt();const before=snapshot();camera=imported.camera;windows=imported.windows;history=[...imported.history,before].slice(-12);paint();changed('Import design canvas','Imported arrangement loaded; preceding windows kept in Undo',{operation:'canvas-import'});}
    catch(error){if(generation===importGeneration)status.textContent='Could not import: '+error.message;}finally{if(generation===importGeneration)importFile.value='';}
  };
  controls.querySelector('#design-canvas-export-unreadable').onclick=()=>download(unreadable || raw,'megaapp-design-canvas-unreadable.json');
  // Pointer focus must not move a control between contact and release. Keyboard
  // focus and a different programmatically focused field can still reveal it.
  let pointerFocus;
  root.addEventListener('pointerdown',event=>{
    const label=event.target.closest('label');
    const target=event.target.closest('button, input, textarea, select, summary, a, [tabindex], [contenteditable]');
    pointerFocus={id:event.pointerId,target:target===root ? label?.control || event.target : target || label?.control || event.target,expires:performance.now()+2000};
  },true);
  document.addEventListener('pointerup',event=>{
    if(pointerFocus?.id!==event.pointerId)return;
    const hint=pointerFocus;hint.expires=performance.now()+600;
    setTimeout(()=>{if(pointerFocus===hint)pointerFocus=null;},600);
  },true);
  document.addEventListener('pointercancel',event=>{if(pointerFocus?.id===event.pointerId)pointerFocus=null;},true);
  document.addEventListener('keydown',()=>{pointerFocus=null;},true);
  root.addEventListener('pointerdown',event=>{const node=event.target.closest('.design-window');if(node && layoutReady){bringForward(node.dataset.window);if(!gesture)persist();}});
  root.addEventListener('focusin',event=>{
    const node=event.target.closest('.design-window');if(!node || !layoutReady)return;bringForward(node.dataset.window);if(!gesture)persist();
    if(pointerFocus && performance.now()<=pointerFocus.expires && (pointerFocus.target===event.target || pointerFocus.target.contains(event.target)))return;
    let rect=event.target.getBoundingClientRect();const bounds=root.getBoundingClientRect(),top=bounds.top+84,bottom=bounds.bottom-64,left=bounds.left+12,right=bounds.right-12;
    if(rect.left<left || rect.right>right || rect.top<top || rect.bottom>bottom){
      focusWindow(node.dataset.window,{save:false});rect=event.target.getBoundingClientRect();
      camera.x=clampCanvas(camera.x+(rect.width>right-left || rect.left<left?left-rect.left:rect.right>right?right-rect.right:0));
      camera.y=clampCanvas(camera.y+(rect.height>bottom-top || rect.top<top?top-rect.top:rect.bottom>bottom?bottom-rect.bottom:0));
      paint();changed('Focus canvas window',`Showing ${label(node.dataset.window)}`,{operation:'canvas-focus',window:node.dataset.window,target:event.target.id || event.target.tagName.toLowerCase()});
    }
  });
  root.addEventListener('scroll',()=>{root.scrollTop=0;root.scrollLeft=0;},{passive:true});
  function refresh() {
    for(const[id,node]of nodes){const text=label(id);const handle=node.querySelector('.design-window-handle');handle.textContent=text;handle.setAttribute('aria-label',`Move ${text} window. Arrow keys move it.`);node.querySelector('.design-window-focus').setAttribute('aria-label',`Focus ${text} window`);node.querySelector('.design-window-resize').setAttribute('aria-label',`Resize ${text} window. Left and right arrows change width.`);const option=[...chooser.options].find(o=>o.value===id);if(option)option.textContent=text;}
    schedule();
  }
  const resize=new ResizeObserver(()=>{
    if(!root.clientWidth || !root.clientHeight)return;
    if(!layoutReady){windows=defaults();layoutReady=true;
      try{raw=localStorage.getItem(key);if(raw){const saved=readCanvasSave(JSON.parse(raw),[...nodes.keys()]);camera=saved.camera;windows=saved.windows;history=saved.history;status.textContent='Your canvas is restored on this device.';}else focusWindow('masthead',{save:false});}
      catch{unreadable=raw;status.textContent='Your saved arrangement could not be read. Its original is kept; save a copy below. New changes keep a backup before saving.';controls.querySelector('#design-canvas-export-unreadable').hidden=false;controls.querySelector('.design-canvas-options').open=true;focusWindow('masthead',{save:false});}
      dirty=false;for(const node of nodes.values())resize.observe(node);
    }else if(lastViewport){const v=viewport();if(v.width!==lastViewport.width || v.height!==lastViewport.height){camera.x=clampCanvas(camera.x+(v.width-lastViewport.width)/2);camera.y=clampCanvas(camera.y+(v.height-lastViewport.height)/2);dirty=true;}}
    lastViewport=viewport();schedule();
  });resize.observe(root);
  const api={world,get camera(){return {...camera};},screenToWorld,worldToScreen(x,y){const r=root.getBoundingClientRect();return{x:r.left+camera.x+x*camera.zoom,y:r.top+camera.y+y*camera.zoom};},focusWindow,refresh,interrupt,captureContext(){return{...canvasSave(snapshot(),history),viewport:viewport(),windows:measured(),gesture:gesture?{operation:gesture.kind,window:gesture.id,samples:gesture.samples.slice()}:touchGesture?{operation:'pinch',surface:'reading-window',samples:touchGesture.samples.slice()}:null};},hide(){++importGeneration;importFile.value='';interrupt('App hidden');controls.querySelector('.design-canvas-options').open=false;if(layoutReady)persist();}};
  root.designCanvas=api;
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && gesture){event.preventDefault();interrupt('Escape');}});
  window.addEventListener('pagehide',()=>{interrupt('Page left');if(layoutReady)persist();});
  window.addEventListener('blur',()=>interrupt('Window blurred'));document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt('Page hidden');});
  return api;
}
