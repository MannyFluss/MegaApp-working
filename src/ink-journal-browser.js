import { emptyMarkup, readMarkup } from './page-markup.js';
import { inkManifest, readInkManifest, splitInkStroke, joinInkStroke } from './ink-journal.js';

function immutable(stroke) {
  if (Object.isFrozen(stroke) && Object.isFrozen(stroke.points)) return stroke;
  for (const point of stroke.points) Object.freeze(point);
  Object.freeze(stroke.points); Object.freeze(stroke.geometry); return Object.freeze(stroke);
}
const request = operation => new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error || new Error('Ink storage request failed.')); });
const completed = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || new Error('Ink transaction was canceled.'));
  transaction.onerror = () => {}; // Abort reports the final failure exactly once.
});
export async function openInkJournal(name) {
  if (!globalThis.indexedDB) throw new Error('Ink database is unavailable.');
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('strokes', { keyPath: 'id' });
    db.createObjectStore('chunks', { keyPath: ['strokeId', 'index'] });
    db.createObjectStore('state');
  };
  let blocked = false;
  const db = await new Promise((resolve, reject) => {
    opening.onsuccess = () => { if (blocked) opening.result.close(); else resolve(opening.result); };
    opening.onerror = () => reject(opening.error || new Error('Ink database could not open.'));
    opening.onblocked = () => { blocked = true; reject(new Error('Another tab is blocking ink storage.')); };
  });
  db.onversionchange = () => db.close();
  let revision = 0, legacyRaw = '', backupStored = false, known = new Map();
  async function raw() {
    const tx = db.transaction(['state', 'strokes', 'chunks'], 'readonly'), done = completed(tx);
    const [[manifest, headers, chunks, legacyRaw]] = await Promise.all([Promise.all([request(tx.objectStore('state').get('current')), request(tx.objectStore('strokes').getAll()), request(tx.objectStore('chunks').getAll()), request(tx.objectStore('state').get('legacy'))]), done]);
    return { manifest, headers, chunks, ...(legacyRaw === undefined ? {} : { legacyRaw }) };
  }
  async function load() {
    const data = await raw();
    if (!data.manifest) {
      if (data.headers.length || data.chunks.length || data.legacyRaw !== undefined) throw new Error('Ink storage has records without its index.');
      return null;
    }
    if (data.legacyRaw !== undefined && typeof data.legacyRaw !== 'string') throw new Error('Unreadable ink migration backup.');
    const manifest = readInkManifest(data.manifest), byId = new Map(), chunkGroups = new Map();
    for (const chunk of data.chunks) {
      if (!chunkGroups.has(chunk.strokeId)) chunkGroups.set(chunk.strokeId, []);
      chunkGroups.get(chunk.strokeId).push(chunk);
    }
    const headerIds = new Set(data.headers.map(header => header.id));
    if (data.chunks.some(chunk => !headerIds.has(chunk.strokeId))) throw new Error('Ink points have no stroke header.');
    for (const header of data.headers) {
      if (byId.has(header.id)) throw new Error('Duplicate ink record.');
      byId.set(header.id, immutable(joinInkStroke(header, (chunkGroups.get(header.id) || []).sort((a,b) => a.index - b.index))));
    }
    function resolve(id) { if (!byId.has(id)) throw new Error('Ink index refers to missing points.'); return byId.get(id); }
    const snapshot = { ...emptyMarkup(), strokes: manifest.active.map(resolve), recovery: manifest.recovery.map(group => group.map(resolve)), preferences: manifest.preferences };
    revision = manifest.revision; backupStored = data.legacyRaw !== undefined; legacyRaw = data.legacyRaw ?? manifest.legacyRaw ?? ''; known = byId;
    return { snapshot, revision, legacyRaw };
  }
  // Callers serialize saves. Only new immutable stroke chunks are written;
  // preferences and navigation through Undo/Clear update the identity index.
  async function save(snapshot, options = {}) {
    const additions = new Map();
    for (const stroke of [...snapshot.strokes, ...snapshot.recovery.flat()]) {
      const existing = known.get(stroke.id);
      if (existing && existing !== stroke && JSON.stringify(existing) !== JSON.stringify(stroke)) throw new Error('A saved stroke identity cannot change its points.');
      if (!existing) { readMarkup({ ...emptyMarkup(), strokes: [stroke] }, { copy: false }); additions.set(stroke.id, immutable(stroke)); }
    }
    const backup = legacyRaw || options.legacyRaw || '';
    if (typeof backup !== 'string') throw new Error('Invalid raw ink backup.');
    const writeBackup = !backupStored && Boolean(backup), manifest = inkManifest(snapshot, revision + 1);
    readInkManifest(manifest);
    const referenced = new Set([...manifest.active, ...manifest.recovery.flat()]);
    const discarded = [...known.values()].filter(stroke => !referenced.has(stroke.id));
    const tx = db.transaction(['state', 'strokes', 'chunks'], 'readwrite'), done = completed(tx);
    let conflict;
    const prior = tx.objectStore('state').get('current');
    prior.onsuccess = () => {
      if ((prior.result?.revision || 0) !== revision) { conflict = new Error('Ink changed in another tab. Export this session before reloading.'); tx.abort(); return; }
      try {
      for (const stroke of discarded) {
        tx.objectStore('strokes').delete(stroke.id);
        for (let index = 0; index < Math.ceil(stroke.points.length / 2048); index++) tx.objectStore('chunks').delete([stroke.id, index]);
      }
      for (const stroke of additions.values()) {
        const { header, chunks } = splitInkStroke(stroke);
        tx.objectStore('strokes').add(header);
        for (const chunk of chunks) tx.objectStore('chunks').add(chunk);
      }
      if (writeBackup) tx.objectStore('state').add(backup, 'legacy');
      tx.objectStore('state').put(manifest, 'current');
      } catch (error) { conflict = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw conflict || error; }
    revision = manifest.revision; legacyRaw = backup; if (writeBackup) backupStored = true;
    for (const stroke of discarded) known.delete(stroke.id);
    for (const stroke of [...snapshot.strokes, ...snapshot.recovery.flat()]) known.set(stroke.id, immutable(stroke));
    return { revision, writtenBackup: writeBackup, writtenStrokes: additions.size, writtenPoints: [...additions.values()].reduce((n,s) => n + s.points.length, 0) };
  }
  return { load, save, raw, close: () => db.close(), get revision() { return revision; } };
}
