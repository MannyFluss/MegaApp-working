import { storageName } from './environment.js';
import { validateWorkspace } from './taste-state.js';
import { temporaryStateBlock, FEELING_STATE } from './state-block.js';

async function readLegacyFeeling() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(storageName('megaapp-feeling-v1'), 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Another tab is preventing the feeling store from opening.'));
  });
  try {
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction('workspace'), request = tx.objectStore('workspace').get('current');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      return row;
  } finally { db.close(); }
}

export async function openTasteStorage({ stateReady = temporaryStateBlock() } = {}) {
  const state = await stateReady;
  let revision = state.version(FEELING_STATE), corruptRow, hasCorrupt = false, legacyCorrupt = false;
  return {
    async load({ migrateLegacy = true } = {}) {
      await state.refresh();
      let value = state.read(FEELING_STATE);
      revision = state.version(FEELING_STATE);
      if (value === undefined) {
        if (!migrateLegacy) return { workspace: null };
        const legacy = await readLegacyFeeling();
        if (!legacy) return { workspace: null };
        try {
          if (!Number.isSafeInteger(legacy.revision) || legacy.revision < 1) throw new Error('Invalid saved revision.');
          value = validateWorkspace(legacy.data);
        } catch (error) { corruptRow = legacy; hasCorrupt = true; legacyCorrupt = true; return { corrupt: legacy, error: error.message }; }
        await state.writeMany([{ name: FEELING_STATE, value }, { name: 'apps.feeling.migration', value: { version: 1, from: 'megaapp-feeling-v1', legacyRevision: legacy.revision } }], { expectedVersions: { [FEELING_STATE]: revision } });
        revision = state.version(FEELING_STATE);
      }
      try { return { workspace: validateWorkspace(value) }; }
      catch (error) { corruptRow = value; hasCorrupt = true; return { corrupt: value && typeof value === 'object' ? value : { rawValue: value }, error: error.message }; }
    },
    async save(workspace) {
      if (hasCorrupt) throw new Error('Saved data is unreadable. Import a valid backup before replacing it.');
      await state.write(FEELING_STATE, validateWorkspace(workspace), { expectedVersion: revision });
      revision = state.version(FEELING_STATE);
    },
    async recover(workspace) {
      if (!hasCorrupt) throw new Error('There is no unreadable save to recover.');
      if (legacyCorrupt && JSON.stringify(await readLegacyFeeling()) !== JSON.stringify(corruptRow)) throw new Error('Another tab changed the legacy session. Reload before importing.');
      await state.writeMany([{ name: 'apps.feeling.recovery', value: { original: corruptRow, from: legacyCorrupt ? 'megaapp-feeling-v1' : 'State', at: new Date().toISOString() } }, { name: FEELING_STATE, value: validateWorkspace(workspace) }], { expectedVersions: { [FEELING_STATE]: revision } });
      revision = state.version(FEELING_STATE); corruptRow = null; hasCorrupt = false; legacyCorrupt = false;
    },
    close() { /* The singleton owns its lifetime, not this adapter. */ },
  };
}
