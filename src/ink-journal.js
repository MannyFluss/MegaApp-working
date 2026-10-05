import { emptyMarkup, readMarkup, markupPointCount } from './page-markup.js';

// Portable ink stays version 1. This manifest is the local storage index, not a
// second drawing format: strokes are immutable and recovery contains identities.
export const INK_CHUNK_POINTS = 2048;
export const INK_JOURNAL_FORMAT = 'megaapp.ink-journal';
export function readInkSnapshot(value) {
  const ink = readMarkup(value);
  if (value.recovery !== undefined && !Array.isArray(value.recovery)) throw new Error('Invalid mark recovery.');
  const ids = new Set(ink.strokes.map(s => s.id));
  const recovery = (value.recovery || []).map(group => {
    const strokes = readMarkup({ ...emptyMarkup(), strokes: group }).strokes;
    for (const stroke of strokes) {
      if (ids.has(stroke.id)) throw new Error('Invalid mark recovery: duplicate stroke identity.');
      ids.add(stroke.id);
    }
    return strokes;
  });
  const p = value.preferences || {};
  const preferences = {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
    visible: typeof p.visible === 'boolean' ? p.visible : true,
    color: /^#[\da-f]{6}$/i.test(p.color || '') ? p.color : '#ad405b',
    width: Number.isFinite(p.width) && p.width >= 1 && p.width <= 12 ? p.width : 3,
  };
  return { ...ink, recovery, preferences };
}
export function inkManifest(snapshot, revision) {
  return { format: INK_JOURNAL_FORMAT, version: 1, revision,
    active: snapshot.strokes.map(s => s.id), recovery: snapshot.recovery.map(group => group.map(s => s.id)),
    preferences: { ...snapshot.preferences } };
}
export function readInkManifest(value) {
  if (value?.format !== INK_JOURNAL_FORMAT || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.active) || !Array.isArray(value.recovery)) throw new Error('Unreadable ink journal index.');
  const ids = [...value.active];
  for (const group of value.recovery) {
    if (!Array.isArray(group)) throw new Error('Unreadable ink recovery index.');
    ids.push(...group);
  }
  if (ids.some(id => typeof id !== 'string' || !id || id.length > 80) || new Set(ids).size !== ids.length || value.legacyRaw !== undefined && typeof value.legacyRaw !== 'string') throw new Error('Unreadable ink identities.');
  const p = value.preferences;
  if (!p || typeof p.enabled !== 'boolean' || typeof p.visible !== 'boolean' || !/^#[\da-f]{6}$/i.test(p.color || '') || !Number.isFinite(p.width) || p.width < 1 || p.width > 12) throw new Error('Unreadable ink preferences.');
  return value;
}
export function splitInkStroke(stroke) {
  const { points, ...metadata } = stroke;
  const chunks = [];
  for (let index = 0; index * INK_CHUNK_POINTS < points.length; index++) chunks.push({ strokeId: stroke.id, index, points: points.slice(index * INK_CHUNK_POINTS, (index + 1) * INK_CHUNK_POINTS) });
  return { header: { ...metadata, pointCount: points.length, chunkCount: chunks.length }, chunks };
}
export function joinInkStroke(header, chunks) {
  if (!Number.isSafeInteger(header?.pointCount) || header.pointCount < 1 || header.chunkCount !== Math.ceil(header.pointCount / INK_CHUNK_POINTS) || chunks.length !== header.chunkCount) throw new Error('Incomplete saved ink stroke.');
  const points = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index], expected = Math.min(INK_CHUNK_POINTS, header.pointCount - index * INK_CHUNK_POINTS);
    if (chunk?.strokeId !== header.id || chunk.index !== index || !Array.isArray(chunk.points) || chunk.points.length !== expected) throw new Error('Incomplete saved ink points.');
    for (const point of chunk.points) points.push(point);
  }
  const { pointCount, chunkCount, ...metadata } = header;
  return readMarkup({ ...emptyMarkup(), strokes: [{ ...metadata, points }] }).strokes[0];
}
export function inspectInkSnapshot(value) {
  const snapshot = readInkSnapshot(value);
  const strokes = [...snapshot.strokes, ...snapshot.recovery.flat()];
  return { format: snapshot.format, version: snapshot.version, activeStrokes: snapshot.strokes.length,
    activePoints: markupPointCount(snapshot.strokes), recoveryGroups: snapshot.recovery.length,
    recoveryStrokes: strokes.length - snapshot.strokes.length, recoveryPoints: markupPointCount(strokes) - markupPointCount(snapshot.strokes),
    areas: [...new Set(strokes.map(s => s.area))], preferences: snapshot.preferences };
}

export function mergeInkSnapshots(existingValue, incomingValue) {
  const existing = readInkSnapshot(existingValue), incoming = readInkSnapshot(incomingValue);
  const byId = new Map([...existing.strokes, ...existing.recovery.flat()].map(s => [s.id, s]));
  for (const stroke of [...incoming.strokes, ...incoming.recovery.flat()]) {
    const old = byId.get(stroke.id);
    if (old && JSON.stringify(old) !== JSON.stringify(stroke)) throw new Error('Import has different points under an existing stroke identity.');
    if (!old) byId.set(stroke.id, stroke);
  }
  const active = [...existing.strokes], activeIds = new Set(active.map(s => s.id));
  for (const stroke of incoming.strokes) if (!activeIds.has(stroke.id)) { active.push(byId.get(stroke.id)); activeIds.add(stroke.id); }
  const kept = new Set(activeIds), recovery = [];
  for (const group of [...existing.recovery, ...incoming.recovery]) {
    const unique = group.filter(s => !kept.has(s.id)).map(s => byId.get(s.id));
    for (const stroke of unique) kept.add(stroke.id);
    if (unique.length) recovery.push(unique);
  }
  return { ...emptyMarkup(), strokes: active, recovery, preferences: incoming.preferences };
}
export function packInkJournal(value) {
  const snapshot = readInkSnapshot(value), headers = [], chunks = [];
  for (const stroke of [...snapshot.strokes, ...snapshot.recovery.flat()]) {
    const split = splitInkStroke(stroke); headers.push(split.header); chunks.push(...split.chunks);
  }
  return { format: 'megaapp.ink-journal-export', version: 1, manifest: inkManifest(snapshot, 1), headers, chunks };
}
export function unpackInkJournal(value) {
  const raw = value?.format === 'megaapp-unreadable-ink-journal' ? value.journal : value;
  if (!raw?.manifest || !Array.isArray(raw.headers) || !Array.isArray(raw.chunks)) throw new Error('Expected an ink journal export.');
  const manifest = readInkManifest(raw.manifest), grouped = new Map(), strokes = new Map();
  for (const chunk of raw.chunks) { if (!grouped.has(chunk.strokeId)) grouped.set(chunk.strokeId, []); grouped.get(chunk.strokeId).push(chunk); }
  for (const header of raw.headers) {
    if (strokes.has(header.id)) throw new Error('Duplicate saved ink header.');
    strokes.set(header.id, joinInkStroke(header, (grouped.get(header.id) || []).sort((a,b) => a.index - b.index)));
  }
  const resolve = id => { if (!strokes.has(id)) throw new Error('Missing saved ink stroke.'); return strokes.get(id); };
  return readInkSnapshot({ ...emptyMarkup(), strokes: manifest.active.map(resolve), recovery: manifest.recovery.map(g => g.map(resolve)), preferences: manifest.preferences });
}
