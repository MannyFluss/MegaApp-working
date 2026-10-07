import { createSampleStore, PRIVATE_STATE_NAMES } from './state.js';

export const FEELING_STATE = 'apps.feeling.workspace';
export const OLLAMA_STATE = 'system.ollama.connection';
export const OLLAMA_KEY = 'system.ollama.apiKey';
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

// New consumers depend on this interface, not IndexedDB or the typed-row schema.
// Replace this factory/injected stateReady when the future block is available.
export function createStateBlock(store) {
  return {
    store, // Compatibility adapter for the existing State UI and older apps.
    privateDurable: store.mode === 'indexeddb',
    read: name => store.read(name),
    readPrivate(name) { if (!PRIVATE_STATE_NAMES.has(name)) throw new Error('Unknown private State value.'); return store.read(name, { privateValue: true }); },
    hasPrivate: name => !!store.read(name, { privateValue: true }),
    version: name => store.version(name),
    write(name, value, { expectedVersion } = {}) {
      return store.writeBlock([{ name, type: typeOf(value), value }], { expectedVersions: expectedVersion === undefined ? {} : { [name]: expectedVersion } });
    },
    writeMany(values, options) { return store.writeBlock(values.map(({ name, value }) => ({ name, type: typeOf(value), value })), options); },
    remove: name => store.remove(name),
    subscribe: callback => store.subscribe(callback),
    refresh: () => store.refresh(),
    snapshot: () => store.snapshot(),
  };
}
let singleton;
export function temporaryStateBlock() {
  return singleton ||= createSampleStore().then(createStateBlock);
}
