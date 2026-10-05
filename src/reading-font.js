import { storageName } from './environment.js';

// A font chosen from Files stays on this device. It is never a public asset,
// State value, document annotation, or part of a kept moment's binary content.
export const MAX_READING_FONT_BYTES = 4 * 1024 * 1024;
export function validateReadingFont(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12 || bytes.byteLength > MAX_READING_FONT_BYTES) throw new Error('Choose an OpenType, TrueType, WOFF or WOFF2 font up to 4 MB.');
  const header = new Uint8Array(bytes, 0, 4);
  const signature = String.fromCharCode(...header);
  if (!['OTTO', 'wOFF', 'wOF2'].includes(signature) && !header.every((value, index) => value === [0, 1, 0, 0][index])) throw new Error('This file is not an OpenType, TrueType, WOFF or WOFF2 font.');
  return bytes;
}

export function createReadingFont({ onChange = () => {} } = {}) {
  let database, opening, face, current, queue = Promise.resolve();
  document.documentElement.dataset.readingFont = 'default';
  const style = document.createElement('style'); style.dataset.readingFont = ''; document.head.append(style);
  const info = () => current ? { name: current.name, enabled: current.enabled, bytes: current.bytes.byteLength, persistent: current.persistent } : null;
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Font storage is unavailable.')); return; }
    const request = indexedDB.open(storageName('megaapp-reading-font'), 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fonts');
    request.onsuccess = () => { database = request.result; database.onversionchange = () => database.close(); resolve(database); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close another MegaApp tab and try again.'));
  });
  async function read() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('fonts').objectStore('fonts').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async function write(row) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('fonts', 'readwrite'), store = transaction.objectStore('fonts');
      // Retain the preceding file until the next deliberate replacement/removal.
      const previous = store.get('current');
      previous.onsuccess = () => { if (row) { if (previous.result) store.put(previous.result, 'previous'); store.put(row, 'current'); } else { store.delete('current'); store.delete('previous'); } };
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('Saving the font was interrupted.'));
    });
  }
  async function loadFace(bytes) {
    validateReadingFont(bytes);
    if (!globalThis.FontFace || !document.fonts) throw new Error('This browser cannot load a reading font.');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'font/otf' }));
    const loaded = new FontFace('MegaApp device reading font', `url("${url}")`);
    try { await loaded.load(); return { loaded, url }; } catch { URL.revokeObjectURL(url); throw new Error('This browser could not read that font. Your previous font remains.'); }
  }
  function present(next, loaded) {
    const previous = face; current = next; face = loaded;
    style.textContent = face ? `@font-face { font-family: "MegaApp device reading font"; src: url("${face.url}"); font-display: swap; }` : '';
    if (previous && previous !== face) URL.revokeObjectURL(previous.url);
    document.documentElement.dataset.readingFont = next?.enabled ? 'device' : 'default';
    onChange(info());
  }
  const ready = (async () => {
    try {
      const saved = await read();
      if (!saved) return null;
      if (saved.version !== 1 || typeof saved.name !== 'string' || typeof saved.enabled !== 'boolean') throw new Error('The saved reading font could not be read. Choose a font to replace it.');
      const loaded = await loadFace(saved.bytes);
      present({ ...saved, persistent: true }, loaded); return info();
    } catch (error) { return { error: error.message || 'The saved reading font could not be read. Choose a font to replace it.' }; }
  })();
  function mutate(operation) {
    const result = queue.then(async () => { await ready; return operation(); }); queue = result.catch(() => {}); return result;
  }
  return {
    ready, info,
    import(file) { return mutate(async () => {
      if (!file || file.size > MAX_READING_FONT_BYTES) throw new Error('Choose a font file up to 4 MB.');
      const bytes = await file.arrayBuffer(), loaded = await loadFace(bytes);
      const next = { version: 1, name: file.name.slice(0, 200), enabled: true, bytes };
      let persistent = true; try { await write(next); } catch { persistent = false; }
      present({ ...next, persistent }, loaded); return info();
    }); },
    enable(enabled) { return mutate(async () => {
      if (!current) return null;
      const next = { ...current, enabled: enabled === true };
      let persistent = true; try { await write(next); } catch { persistent = false; }
      present({ ...next, persistent }, face); return info();
    }); },
    remove() { return mutate(async () => {
      let persistent = true; try { await write(null); } catch { persistent = false; }
      present(null, null); return { persistent };
    }); },
  };
}
