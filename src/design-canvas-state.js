// Presentation only: document identities and wording stay in the design edition.
export const CANVAS_FORMAT = 'megaapp-design-canvas';
export const CANVAS_VERSION = 1;
export const CANVAS_LIMIT = 1000000;
export const MIN_CANVAS_ZOOM = .00001;
export const clampCanvas = value => Math.max(-CANVAS_LIMIT, Math.min(CANVAS_LIMIT, value));
export function canvasZoomAt(camera, point, zoom) {
  zoom = Math.max(MIN_CANVAS_ZOOM, Math.min(3, zoom));
  return { zoom, x: clampCanvas(point.x - (point.x-camera.x)/camera.zoom*zoom), y: clampCanvas(point.y - (point.y-camera.y)/camera.zoom*zoom) };
}
export function fitCanvasWindows(windows, width, height, margin = 28) {
  if (!windows.length) return { x: margin, y: margin, zoom: 1 };
  const left = Math.min(...windows.map(w=>w.x)), top = Math.min(...windows.map(w=>w.y));
  const right = Math.max(...windows.map(w=>w.x+w.width)), bottom = Math.max(...windows.map(w=>w.y+(w.height || 80)));
  const zoom = Math.max(MIN_CANVAS_ZOOM, Math.min(1, (width-margin*2)/Math.max(1,right-left), (height-margin*2)/Math.max(1,bottom-top)));
  return { zoom, x: clampCanvas((width-(right-left)*zoom)/2-left*zoom), y: clampCanvas((height-(bottom-top)*zoom)/2-top*zoom) };
}
export function readCanvasSave(value, ids) {
  const fail = () => { throw new Error('Unreadable canvas arrangement'); };
  if (!value || value.format !== CANVAS_FORMAT || value.version !== CANVAS_VERSION) fail();
  const finite = (n,min,max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const snapshot = source => {
    if (!source?.camera || !finite(source.camera.x,-CANVAS_LIMIT,CANVAS_LIMIT) || !finite(source.camera.y,-CANVAS_LIMIT,CANVAS_LIMIT) || !finite(source.camera.zoom,MIN_CANVAS_ZOOM,3) || !Array.isArray(source.windows) || source.windows.length !== ids.length) fail();
    const found = new Set();
    const windows = source.windows.map(w=>{
      if (!w || !ids.includes(w.id) || found.has(w.id) || !finite(w.x,-CANVAS_LIMIT,CANVAS_LIMIT) || !finite(w.y,-CANVAS_LIMIT,CANVAS_LIMIT) || !finite(w.width,260,1600)) fail();
      found.add(w.id); return { id:w.id,x:w.x,y:w.y,width:w.width };
    });
    return { camera: { x: source.camera.x, y: source.camera.y, zoom: source.camera.zoom }, windows };
  };
  const state = snapshot(value);
  if (value.history !== undefined && (!Array.isArray(value.history) || value.history.length > 12)) fail();
  return { ...state, history: (value.history || []).map(snapshot) };
}
export function canvasSave(state, history = []) { return { format: CANVAS_FORMAT, version: CANVAS_VERSION, camera: { ...state.camera }, windows: state.windows.map(w=>({ id:w.id,x:w.x,y:w.y,width:w.width })), history: history.slice(-12).map(s=>({camera:{...s.camera},windows:s.windows.map(w=>({...w}))})) }; }
