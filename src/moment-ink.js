// Recorded vector geometry only. Labels are captured UI labels, never OCR.
// These functions also run in the standalone replay without app dependencies.
export function inkScene(context) {
  const markup = context?.markup, geometry = markup?.pageGeometry || {};
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const box = r => r && ['x','y','width','height'].every(k=>finite(r[k])) && r.width>0 && r.height>0;
  const viewport = {x:0,y:0,width:Math.max(1,finite(geometry.width)?geometry.width:1),height:Math.max(1,finite(geometry.height)?geometry.height:1)};
  const camera = geometry.canvas?.camera;
  const windows = camera && Array.isArray(context.canvas?.windows) ? context.canvas.windows.map(w=>({id:w.id,x:camera.x+w.x*camera.zoom,y:camera.y+w.y*camera.zoom,width:w.width*camera.zoom,height:w.height*camera.zoom})).filter(box) : [];
  const areas = Object.entries(geometry.areas || {}).filter(([,r])=>box(r)).map(([id,r])=>({id,...r}));
  const marks = [], unavailable = [];
  const strokes = [...(Array.isArray(markup?.strokes)?markup.strokes:[]),...(markup?.currentStroke?[{...markup.currentStroke,id:'current'}]:[])];
  for (const stroke of strokes) {
    const area = geometry.areas?.[stroke.area];
    const world = camera && ['canvas','page'].includes(stroke.area);
    if ((!world && !box(area)) || !Array.isArray(stroke.points) || !stroke.points.length || !finite(stroke.geometry?.width) || stroke.geometry.width<=0 || !finite(stroke.geometry.height) || stroke.geometry.height<=0 || !/^#[a-f\d]{6}$/i.test(stroke.color) || !finite(stroke.width) || stroke.width<=0) { unavailable.push(stroke.id); continue; }
    const local = area?.camera;
    const origin = world ? camera : {x:area.x+(local?.x||0),y:area.y+(local?.y||0)};
    const sx = world ? stroke.geometry.width*camera.zoom : area.width*(local?.zoom||1);
    const sy = world ? stroke.geometry.height*camera.zoom : area.height*(local?.zoom||1);
    const points = stroke.points.map(p=>({x:origin.x+p.x*sx,y:origin.y+p.y*sy}));
    if (points.some(p=>!finite(p.x)||!finite(p.y))) {unavailable.push(stroke.id);continue;}
    const width = stroke.width*(world?camera.zoom:area.width/stroke.geometry.width)*(local?local.zoom/(stroke.geometry.zoom||1):1);
    const windowId = stroke.area === 'context-map' ? 'context-toy' : stroke.area.startsWith('principle:') ? stroke.area.slice(10) : stroke.area;
    const index = world ? -1 : windows.findIndex(w=>w.id===windowId);
    marks.push({id:stroke.id,area:stroke.area,color:stroke.color,width,points,clip:local?area:null,cover:index<0?[]:windows.slice(index+1)});
  }
  const targets = (geometry.targets || []).filter(box).filter((t,i,all)=>all.findIndex(a=>a.x===t.x&&a.y===t.y&&a.label===t.label)===i);
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const mark of marks) for(const p of mark.points) {left=Math.min(left,p.x-mark.width);top=Math.min(top,p.y-mark.width);right=Math.max(right,p.x+mark.width);bottom=Math.max(bottom,p.y+mark.width);}
  const whole = finite(left) ? {x:left-20,y:top-20,width:Math.max(1,right-left+40),height:Math.max(1,bottom-top+40)} : viewport;
  return {viewport,whole,areas,windows,targets,marks,unavailable,visible:markup?.visible!==false,pointCount:marks.reduce((n,m)=>n+m.points.length,0)};
}
export function momentInkSVG(context, { view = 'whole', scene = inkScene(context) } = {}) {
  const escape = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const bounds = view==='captured'?scene.viewport:scene.whole;
  const maskBounds = {x:Math.min(scene.viewport.x,scene.whole.x),y:Math.min(scene.viewport.y,scene.whole.y),width:Math.max(scene.viewport.x+scene.viewport.width,scene.whole.x+scene.whole.width)-Math.min(scene.viewport.x,scene.whole.x),height:Math.max(scene.viewport.y+scene.viewport.height,scene.whole.y+scene.whole.height)-Math.min(scene.viewport.y,scene.whole.y)};
  const rect = r => `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`;
  const surfaces = scene.windows.length?scene.windows:scene.areas.filter(a=>!['page','canvas','context-map'].includes(a.id));
  const defs = scene.marks.map((m,i)=>`${m.clip?`<clipPath id="ink-clip-${i}"><rect ${rect(m.clip)}/></clipPath>`:''}${m.cover.length?`<mask id="ink-cover-${i}" maskUnits="userSpaceOnUse" ${rect(maskBounds)}><rect ${rect(maskBounds)} fill="white"/>${m.cover.map(w=>`<rect ${rect(w)} fill="black" rx="12"/>`).join('')}</mask>`:''}`).join('');
  const paths = scene.marks.map((m,i)=>`<path data-ink-id="${escape(m.id)}" data-ink-area="${escape(m.area)}" d="${m.points.map((p,j)=>`${j?'L':'M'} ${p.x} ${p.y}`).join(' ')}${m.points.length===1?' l .01 .01':''}" fill="none" stroke="${m.color}" stroke-width="${m.width}" stroke-linecap="round" stroke-linejoin="round"${m.clip?` clip-path="url(#ink-clip-${i})"`:''}${m.cover.length?` mask="url(#ink-cover-${i})"`:''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="moment-ink-svg" role="img" aria-label="Recorded ink and captured target locations" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" data-strokes="${scene.marks.length}" data-points="${scene.pointCount}"><title>Recorded ink</title><desc>Exact observed vector positions projected with recorded geometry. Captured target labels supply location context. Text layout is a reconstruction; handwriting is not transcribed. ${scene.unavailable.length} strokes lack usable recorded geometry. Saved marks were ${scene.visible?'shown':'hidden'}.</desc><defs>${defs}</defs><g fill="#fcfcfd" stroke="#d9d7e1">${surfaces.map(r=>`<rect ${rect(r)} rx="12"/>`).join('')}</g><g fill="#696674" font-family="system-ui,sans-serif">${scene.targets.map(t=>`<text x="${t.x}" y="${t.y+Math.min(t.height,16)}" font-size="${Math.min(14,t.height*.7)}">${escape(t.label)}</text>`).join('')}</g><g>${paths}</g></svg>`;
}
export function mountInkView(root) {
  root.innerHTML='<h3>Recorded ink</h3><p class="moment-ink-status"></p><div class="moment-ink-stage"></div><div class="moment-ink-controls"><button type="button" data-ink-view="captured">Captured view</button><button type="button" data-ink-view="whole">Whole ink</button><label>Ink area <select aria-label="Ink area"><option value="">Choose area</option></select></label><button type="button" data-ink-zoom="in" aria-label="Zoom into recorded ink">+</button><button type="button" data-ink-zoom="out" aria-label="Zoom out of recorded ink">−</button></div><p class="moment-ink-help">Drag or zoom to inspect your marks. Labels show captured locations. Handwriting is preserved as strokes.</p>';
  const stage=root.querySelector('.moment-ink-stage'),status=root.querySelector('.moment-ink-status'),select=root.querySelector('select');
  let scene,svg,view,mode='captured',area='',previous,pointer;
  const same = c => c?.markup===previous?.markup && c?.canvas===previous?.canvas;
  function setView(next) {view={...next};svg?.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);}
  function zoom(ratio,x=.5,y=.5) {const width=Math.max(.001,Math.min(1e15,view.width*ratio)),height=width*view.height/view.width;setView({x:view.x+(view.width-width)*x,y:view.y+(view.height-height)*y,width,height});}
  for(const button of root.querySelectorAll('[data-ink-view]')) button.onclick=()=>{mode=button.dataset.inkView;area='';select.value='';setView(mode==='whole'?scene.whole:scene.viewport);};
  for(const button of root.querySelectorAll('[data-ink-zoom]')) button.onclick=()=>zoom(button.dataset.inkZoom==='in'?.7:1/.7);
  select.onchange=()=>{area=select.value;const r=scene.areas.find(a=>a.id===area);if(r)setView({x:r.x-20,y:r.y-20,width:r.width+40,height:r.height+40});};
  stage.addEventListener('wheel',event=>{if(!svg)return;event.preventDefault();const r=svg.getBoundingClientRect();zoom(Math.exp(Math.max(-.7,Math.min(.7,event.deltaY*.002))),(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height);},{passive:false});
  stage.onpointerdown=event=>{if(!svg||event.button!==0)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...view}};stage.setPointerCapture(event.pointerId);};
  stage.onpointermove=event=>{if(pointer?.id!==event.pointerId)return;const r=svg.getBoundingClientRect(),scale=Math.max(pointer.view.width/r.width,pointer.view.height/r.height);setView({...pointer.view,x:pointer.view.x-(event.clientX-pointer.x)*scale,y:pointer.view.y-(event.clientY-pointer.y)*scale});};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,()=>{pointer=null;});
  return {draw(context){if(same(context))return;previous=context;scene=inkScene(context);root.hidden=!context?.markup || !((context.markup.strokes?.length||0)+Boolean(context.markup.currentStroke));if(root.hidden)return;stage.innerHTML=momentInkSVG(context,{view:mode,scene});svg=stage.querySelector('svg');status.textContent=`${scene.marks.length} strokes · ${scene.pointCount.toLocaleString()} points${scene.visible?'':' · marks were hidden'}${scene.unavailable.length?` · ${scene.unavailable.length} without recorded geometry`:''}`;status.dataset.strokes=String(scene.marks.length);status.dataset.points=String(scene.pointCount);select.replaceChildren();const first=document.createElement('option');first.value='';first.textContent='Choose area';select.append(first);for(const r of scene.areas){const option=document.createElement('option');option.value=r.id;option.textContent=r.id;select.append(option);}select.value=area;const selected=scene.areas.find(a=>a.id===area);setView(selected?{x:selected.x-20,y:selected.y-20,width:selected.width+40,height:selected.height+40}:mode==='whole'?scene.whole:scene.viewport);},dispose(){pointer=null;}};
}
