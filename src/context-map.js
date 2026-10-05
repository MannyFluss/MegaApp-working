// Map geometry is presentation. Definitions and proposed relations live in the
// dictionary graph; moving a point does not silently alter either of them.
export function mapLabelSize(node, width) {
  const font = width < 500 ? 12 : 15;
  const max = width < 500 ? 88 : 142;
  const labelWidth = Math.min(max, Math.max(52, Math.max(node.label.length * font * .55 + 20, Math.max(...node.label.split(/\s+/).map(word => word.length)) * font * .7 + 16)));
  return { font, width: labelWidth, height: Math.max(44, 22 + Math.ceil(node.label.length * font * .55 / (labelWidth - 8)) * font * 1.2) };
}
const anchors = {
  Design: [.43,.12], Immersion: [.14,.1], 'Input system': [.2,.34], Response: [.1,.52], Settling: [.15,.8], Tool: [.43,.36], Toy: [.32,.57], Override: [.47,.74], 'Reading preferences': [.32,.9],
  Policy: [.69,.12], Protocol: [.85,.32], Boundary: [.63,.34], Agent: [.8,.5], 'Data control': [.57,.91], Moment: [.67,.72], 'Mental model': [.57,.55], 'Internal context': [.89,.74], 'External context': [.86,.91],
  'Pencil input': [.35,.32], Layers: [.47,.5], 'Agent authority': [.91,.1], 'Mental schema': [.93,.56],
};
function hash(value) { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function layoutContextMap(graph, width, height) {
  width = Math.max(240, width); height = Math.max(360, height);
  const nodes = [...graph.nodes].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(node => {
    const size = mapLabelSize(node, width), seed = anchors[node.label] || [.1 + hash(node.id) % 800 / 1000, .1 + hash(node.id + ':y') % 800 / 1000];
    return { id: node.id, ...size, x: 18 + size.width / 2 + seed[0] * (width - size.width - 36), y: 22 + size.height / 2 + seed[1] * (height - size.height - 44) };
  });
  const byId = new Map(nodes.map(node => [node.id,node]));
  // Resolve label collisions once. This is deterministic, bounded layout work,
  // not a live force simulation. Nothing moves after the map comes to rest.
  for (let pass = 0; pass < 280; pass++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x, dy = b.y - a.y;
      const overlapX = (a.width + b.width) / 2 + 10 - Math.abs(dx), overlapY = (a.height + b.height) / 2 + 8 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      const horizontalRoom = dx >= 0 ? a.x-a.width/2>14 && b.x+b.width/2<width-14 : b.x-b.width/2>14 && a.x+a.width/2<width-14;
      if (overlapX < overlapY && horizontalRoom) { const step = Math.min(7, overlapX * .28), sign = dx >= 0 ? 1 : -1; a.x -= step * sign; b.x += step * sign; }
      else { const step = Math.min(7, overlapY * .28), sign = dy >= 0 ? 1 : -1; a.y -= step * sign; b.y += step * sign; }
    }
    if (pass < 90 && width > 600) for (const edge of graph.relations) {
      const a = byId.get(edge.from), b = byId.get(edge.to); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1, pull = Math.max(0, distance - width * .27) * .002;
      a.x += dx / distance * pull; a.y += dy / distance * pull; b.x -= dx / distance * pull; b.y -= dy / distance * pull;
    }
    for (const n of nodes) { n.x = Math.max(12 + n.width / 2, Math.min(width - 12 - n.width / 2, n.x)); n.y = Math.max(14 + n.height / 2, Math.min(height - 14 - n.height / 2, n.y)); }
  }
  // A crowded small viewport can trap relaxation against its edges. Place
  // those labels in the nearest free space instead of leaving overlaps.
  const collides = (a,b) => Math.abs(a.x-b.x)<(a.width+b.width)/2+4 && Math.abs(a.y-b.y)<(a.height+b.height)/2+4;
  if (nodes.some((a,i)=>nodes.slice(i+1).some(b=>collides(a,b)))) {
    const placed=[];
    for(const n of [...nodes].sort((a,b)=>b.width*b.height-a.width*a.height || a.id.localeCompare(b.id))) {
      let best=null,score=Infinity;
      for(let y=12+n.height/2;y<=height*2-n.height/2;y+=8) for(let x=12+n.width/2;x<=width-12-n.width/2;x+=8) {
        const distance=(x-n.x)**2+(y-n.y)**2;
        if(distance>=score || placed.some(p=>collides({...n,x,y},p)))continue;
        best={x,y};score=distance;
      }
      if(best)Object.assign(n,best);placed.push(n);
    }
  }
  return nodes;
}
export function zoomMapAt(camera, point, zoom) {
  zoom = Math.max(.25, Math.min(5, zoom));
  return { zoom, x: point.x - (point.x - camera.x) / camera.zoom * zoom, y: point.y - (point.y - camera.y) / camera.zoom * zoom };
}
export function fitContextMap(points, width, height) {
  if (!points.length) return { zoom: 1, x: 0, y: 0 };
  const x1 = Math.min(...points.map(p => p.x - p.width / 2)), x2 = Math.max(...points.map(p => p.x + p.width / 2));
  const y1 = Math.min(...points.map(p => p.y - p.height / 2)), y2 = Math.max(...points.map(p => p.y + p.height / 2));
  const zoom = Math.max(.25, Math.min(1, (width - 24) / Math.max(1, x2-x1), (height - 24) / Math.max(1, y2-y1)));
  return { zoom, x: (width - (x2-x1)*zoom)/2 - x1*zoom, y: (height-(y2-y1)*zoom)/2-y1*zoom };
}
