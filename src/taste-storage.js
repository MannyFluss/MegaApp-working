import { storageName } from './environment.js';
import { validateWorkspace } from './taste-state.js';

export async function openTasteStorage() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(storageName('megaapp-feeling-v1'), 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Another tab is preventing the feeling store from opening.'));
  });
  db.onversionchange = () => db.close();
  let revision = 0, corruptRow;
  return {
    async load() {
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction('workspace'), request = tx.objectStore('workspace').get('current');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (!row) return { workspace: null };
      revision = row.revision;
      try {
        if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid saved revision.');
        return { workspace: validateWorkspace(row.data) };
      } catch (error) { corruptRow = row; return { corrupt: row, error: error.message }; }
    },
    save(workspace) {
      return new Promise((resolve, reject) => {
        if (corruptRow) { reject(new Error('Saved data is unreadable. Import a valid backup before replacing it.')); return; }
        const tx = db.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace');
        const request = store.get('current'); let conflict = false;
        request.onsuccess = () => {
          const row = request.result;
          if ((row?.revision || 0) !== revision) { conflict = true; tx.abort(); return; }
          store.put({ revision: revision + 1, data: workspace }, 'current');
        };
        tx.oncomplete = () => { revision++; resolve(); };
        tx.onabort = tx.onerror = () => reject(new Error(conflict ? 'Another tab saved a newer session. Export your session, then reload before making more choices.' : (tx.error?.message || 'The browser could not save this session.')));
      });
    },
    recover(workspace) {
      const validated = validateWorkspace(workspace);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace'), request = store.get('current');
        let nextRevision, conflict = false;
        request.onsuccess = () => {
          const row = request.result;
          if (!corruptRow || JSON.stringify(row) !== JSON.stringify(corruptRow)) { conflict = true; tx.abort(); return; }
          store.put(row, `unreadable-${Date.now()}`);
          nextRevision = Number.isSafeInteger(row.revision) ? row.revision + 1 : 1;
          store.put({ revision: nextRevision, data: validated }, 'current');
        };
        tx.oncomplete = () => { revision = nextRevision; corruptRow = null; resolve(); };
        tx.onabort = tx.onerror = () => reject(new Error(conflict ? 'The saved session changed in another tab. Reload before importing.' : (tx.error?.message || 'Recovery could not be saved. The original remains intact.')));
      });
    },
    close() { db.close(); },
  };
}
