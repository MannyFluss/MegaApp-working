// Portable ink: geometry and observations, never guessed drawing semantics.
export function emptyMarkup() { return { format: 'megaapp.page-markup', version: 1, placement: 'area-relative', strokes: [] }; }
export function readMarkup(value) {
  if (value?.format !== 'megaapp.page-markup' || value.version !== 1 || value.placement !== 'area-relative' || !Array.isArray(value.strokes) || value.strokes.length > 60) throw new Error('Expected page markup version 1, at most 60 strokes.');
  let count = 0;
  const strokes = value.strokes.map(stroke => {
    if (typeof stroke.id !== 'string' || stroke.id.length > 80 || typeof stroke.area !== 'string' || stroke.area.length > 80 || !/^#[\da-f]{6}$/i.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 12 || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 1000 || !Number.isFinite(stroke.geometry?.width) || stroke.geometry.width <= 0 || !Number.isFinite(stroke.geometry?.height) || stroke.geometry.height <= 0) throw new Error('Invalid stroke.');
    if (stroke.geometry.zoom !== undefined && (!Number.isFinite(stroke.geometry.zoom) || stroke.geometry.zoom < .25 || stroke.geometry.zoom > 5)) throw new Error('Invalid map ink scale.');
    count += stroke.points.length;
    const points = stroke.points.map(point => {
      if (['x', 'y', 't', 'pressure'].some(key => !Number.isFinite(point[key])) || Math.abs(point.x) > 100 || Math.abs(point.y) > 100 || point.t < 0 || point.t > 3600000 || point.pressure < 0 || point.pressure > 1) throw new Error('Invalid ink point.');
      return { x: point.x, y: point.y, t: point.t, pressure: point.pressure };
    });
    return { id: stroke.id, area: stroke.area, color: stroke.color, width: stroke.width, geometry: { width: stroke.geometry.width, height: stroke.geometry.height, ...(stroke.geometry.zoom === undefined ? {} : { zoom: stroke.geometry.zoom }) }, points };
  });
  if (count > 12000 || new Set(strokes.map(stroke => stroke.id)).size !== strokes.length) throw new Error('Too much ink or duplicate stroke identity.');
  return { ...emptyMarkup(), strokes };
}
export function projectStroke(stroke, area) {
  return stroke.points.map(point => ({ x: area.x + point.x * area.width, y: area.y + point.y * area.height, t: point.t, pressure: point.pressure }));
}

// World-relative map ink keeps its location as the camera moves. Old area-relative
// records retain their existing projection; they are never silently migrated.
export function projectMapStroke(stroke, area, camera) {
  return stroke.points.map(point => ({ x: area.x + camera.x + point.x * area.width * camera.zoom, y: area.y + camera.y + point.y * area.height * camera.zoom, t: point.t, pressure: point.pressure }));
}
