import { MEGAAPP_ASSET_REPOSITORY } from "./reading-config.js";
import { storageName } from "./environment.js";
export const TYPES = ["string", "number", "boolean", "object", "array", "null"];
export const MAX_STATE_BYTES = 128 * 1024 * 1024;
export const PRIVATE_STATE_NAMES = new Set(['system.ollama.apiKey']);
export const DEFAULTS = {
  schemaVersion: 1,
  variables: [
    { name: "MEGAAPP_ASSET_REPOSITORY", type: "string", value: MEGAAPP_ASSET_REPOSITORY },
    { name: "system.theme", type: "string", value: "auto" },
    { name: "apps.canvas.brushSize", type: "number", value: 8 },
    { name: "apps.canvas.pressure", type: "boolean", value: true },
    {
      name: "apps.demo.palette",
      type: "array",
      value: ["#3558f5", "#ed7356", "#d3bcff"],
    },
    {
      name: "apps.demo.project",
      type: "object",
      value: { title: "Something good", tempo: 120 },
    },
    { name: "apps.demo.nextIdea", type: "null", value: null },
  ],
};
export function validateName(name) {
  if (
    typeof name !== "string" ||
    !name.length ||
    name.length > 100 ||
    !/^[a-zA-Z][\w.-]*$/.test(name) ||
    name
      .split(".")
      .some((s) => ["__proto__", "constructor", "prototype"].includes(s))
  )
    throw new Error(
      "Use a name starting with a letter, followed by letters, numbers, dots, dashes, or underscores.",
    );
  return name;
}
export function validateValue(type, value) {
  if (!TYPES.includes(type))
    throw new Error("Choose a supported variable type.");
  const valid =
    type === "null"
      ? value === null
      : type === "array"
        ? Array.isArray(value)
        : type === "object"
          ? value !== null && typeof value === "object" && !Array.isArray(value)
          : type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : typeof value === type;
  if (!valid)
    throw new Error(
      `The value must be ${type === "object" ? "a JSON object" : type === "array" ? "a JSON array" : type === "number" ? "a finite number" : type === "null" ? "null" : `a ${type}`}.`,
    );
  validateJson(value);
  return value;
}
function validateJson(value, depth = 0) {
  if (depth > 100) throw new Error("Keep JSON nesting below 100 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateJson(entry, depth + 1);
    return;
  }
  if (
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    for (const entry of Object.values(value)) validateJson(entry, depth + 1);
    return;
  }
  throw new Error(
    "Use JSON values with finite numbers; undefined and non-JSON objects cannot be saved.",
  );
}
export function parseValue(type, raw) {
  let value;
  if (type === "string") value = raw;
  else if (type === "null") value = null;
  else {
    if (!raw.trim()) throw new Error("Enter a value.");
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(
        type === "boolean"
          ? "Use true or false."
          : "Enter valid JSON for this type.",
      );
    }
  }
  return validateValue(type, value);
}
export function validateSnapshot(data, { privateValues = false } = {}) {
  if (
    !data ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.variables) ||
    data.variables.length > 1000
  )
    throw new Error(
      "This is not a MegaApp sample snapshot (schema version 1).",
    );
  const seen = new Set();
  for (const row of data.variables) {
    if (!row || typeof row !== "object")
      throw new Error("Each variable needs a name, type, and value.");
    validateName(row.name);
    if (PRIVATE_STATE_NAMES.has(row.name))
      throw new Error('Set private keys through their connection controls.');
    validateValue(row.type, row.value);
    if (seen.has(row.name)) throw new Error(`Duplicate variable: ${row.name}`);
    seen.add(row.name);
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_STATE_BYTES)
    throw new Error("Keep State snapshots below 128 MB.");
  if (privateValues && data._versions) for (const [name, version] of Object.entries(data._versions)) {
    validateName(name);
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid State revision.');
  }
  if (privateValues && data._private) for (const [name, value] of Object.entries(data._private)) {
    if (!PRIVATE_STATE_NAMES.has(name) || !value || typeof value.key !== 'string' || !value.key.trim() || value.key.length > 4096 || /[\r\n\0]/.test(value.key) || typeof value.origin !== 'string') throw new Error('Invalid private State value.');
  }
  return {
    schemaVersion: 1,
    variables: data.variables.map(({ name, type, value }) => ({
      name,
      type,
      value: structuredClone(value),
      ...(PRIVATE_STATE_NAMES.has(name) ? { private: true } : {}),
    })),
    ...(privateValues && data._versions ? { _versions: { ...data._versions } } : {}),
    ...(privateValues && data._private ? { _private: structuredClone(data._private) } : {}),
  };
}
export function serializeValue(row) {
  if (row.private) return 'Key set · private';
  return row.type === "string" ? row.value : JSON.stringify(row.value);
}
export async function createSampleStore() {
  let data = structuredClone(DEFAULTS), db = null, mode = 'session', warning = '';
  let queue = Promise.resolve();
  const listeners = new Set(), fallbackKey = storageName('megaapp.sample.v1');
  const privateRow = row => PRIVATE_STATE_NAMES.has(row.name);
  const publicSnapshot = value => ({ schemaVersion: 1, variables: structuredClone(value.variables.filter(row => !privateRow(row))) });
  const internal = value => validateSnapshot(value, { privateValues: true });
  const rows = () => [...structuredClone(data.variables), ...Object.keys(data._private || {}).map(name => ({ name, type: 'object', value: null, private: true }))].sort((a, b) => a.name.localeCompare(b.name));
  const channel = typeof window !== 'undefined' && typeof BroadcastChannel === 'function' ? new BroadcastChannel(storageName('megaapp-state-notify-v1')) : null;
  function emit(names) { for (const callback of listeners) { try { callback(names); } catch { /* A view cannot roll back committed state. */ } } }
  function prepare(base, operation) {
    const next = internal(operation(structuredClone(base))), versions = { ...base._versions };
    const names = new Set([...base.variables.map(row => row.name), ...next.variables.map(row => row.name), ...Object.keys(base._private || {}), ...Object.keys(next._private || {})]), changed = [];
    for (const name of names) {
      const before = PRIVATE_STATE_NAMES.has(name) ? base._private?.[name] : base.variables.find(row => row.name === name);
      const after = PRIVATE_STATE_NAMES.has(name) ? next._private?.[name] : next.variables.find(row => row.name === name);
      if (JSON.stringify(before) !== JSON.stringify(after)) { versions[name] = (versions[name] || 0) + 1; changed.push(name); }
    }
    if (Object.keys(versions).length) next._versions = versions;
    return { next, changed };
  }
  async function change(operation) {
    let result;
    if (mode === 'indexeddb') {
      result = await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshot', 'readwrite'), objectStore = tx.objectStore('snapshot'), request = objectStore.get('current');
        let prepared, issue;
        request.onsuccess = () => {
          try { prepared = prepare(request.result ? internal(request.result) : structuredClone(DEFAULTS), operation); objectStore.put(prepared.next, 'current'); }
          catch (error) { issue = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(prepared);
        tx.onabort = tx.onerror = () => reject(issue || tx.error || new Error('State could not be saved.'));
      });
      try { localStorage.removeItem(fallbackKey); } catch { /* IndexedDB owns the block. */ }
    } else {
      result = prepare(data, operation);
      // Private values never spill into the weaker compatibility fallback.
      if (mode === 'localstorage') localStorage.setItem(fallbackKey, JSON.stringify(publicSnapshot(result.next)));
    }
    data = result.next; emit(result.changed); channel?.postMessage(result.changed);
    return rows();
  }
  function mutate(operation) { const result = queue.then(() => change(operation)); queue = result.catch(() => {}); return result; }
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(storageName('megaapp-sample'), 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshot');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close another MegaApp tab to open State.'));
    });
    db.onversionchange = () => db.close();
    const saved = await new Promise((resolve, reject) => {
      const request = db.transaction('snapshot').objectStore('snapshot').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (saved) data = internal(saved);
    mode = 'indexeddb';
    let fallback;
    try {
      const savedFallback = localStorage.getItem(fallbackKey);
      if (savedFallback) fallback = validateSnapshot(JSON.parse(savedFallback));
    } catch { warning = 'A fallback State snapshot could not be read.'; }
    if (fallback) await change(base => ({ ...fallback, ...(base._private ? { _private: base._private } : {}) }));
  } catch {
    db?.close(); db = null; mode = 'session';
    try {
      const saved = localStorage.getItem(fallbackKey); if (saved) data = validateSnapshot(JSON.parse(saved));
      const testKey = storageName('megaapp.storage-test'); localStorage.setItem(testKey, '1'); localStorage.removeItem(testKey);
      mode = 'localstorage'; warning = 'Using local storage; private keys last only for this session.';
    } catch { warning = 'Storage is unavailable. State lasts for this session; export a copy.'; }
  }
  if (channel) channel.onmessage = async event => {
    if (!db || !Array.isArray(event.data)) return;
    try {
      const saved = await new Promise((resolve, reject) => { const request = db.transaction('snapshot').objectStore('snapshot').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (saved) { data = internal(saved); emit(event.data.filter(name => typeof name === 'string')); }
    } catch { /* Next atomic mutation still validates the durable block. */ }
  };
  function writeValues(values, { privateValues = false, expectedVersions = {} } = {}) {
    const changes = values.map(({ name, type, value }) => {
      validateName(name); if (PRIVATE_STATE_NAMES.has(name) && !privateValues) throw new Error('Set private keys through their connection controls.');
      if (PRIVATE_STATE_NAMES.has(name) && (type !== 'object' || !value || typeof value.key !== 'string' || !value.key.trim() || value.key.length > 4096 || /[\r\n\0]/.test(value.key) || typeof value.origin !== 'string')) throw new Error('Enter a valid private key and destination.');
      return { name, type, value: structuredClone(validateValue(type, value)), ...(PRIVATE_STATE_NAMES.has(name) ? { private: true } : {}) };
    });
    return mutate(base => {
      for (const [name, version] of Object.entries(expectedVersions)) if ((base._versions?.[name] || 0) !== version) throw new Error('Another tab saved a newer session. Export your session, then reload before making more choices.');
      for (const row of changes) {
        if (PRIVATE_STATE_NAMES.has(row.name)) { base._private ||= {}; base._private[row.name] = row.value; }
        else { const index = base.variables.findIndex(value => value.name === row.name); if (index < 0) base.variables.push(row); else base.variables[index] = row; }
      }
      return base;
    });
  }
  return {
    mode, warning, rows,
    snapshot: () => publicSnapshot(data),
    read(name, { privateValue = false } = {}) { if (PRIVATE_STATE_NAMES.has(name)) return privateValue ? structuredClone(data._private?.[name]) : undefined; return structuredClone(data.variables.find(row => row.name === name)?.value); },
    version: name => data._versions?.[name] || 0,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async refresh() {
      await queue;
      if (db) {
        const saved = await new Promise((resolve, reject) => { const request = db.transaction('snapshot').objectStore('snapshot').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        if (saved) data = internal(saved);
      }
      return rows();
    },
    setMany: values => writeValues(values),
    set: (name, type, value) => writeValues([{ name, type, value }]),
    // Internal block adapter only. Public exports/UI/tools always use redacted views.
    writeBlock: (values, options) => writeValues(values, { ...options, privateValues: true }),
    remove(name) { validateName(name); return mutate(base => { base.variables = base.variables.filter(row => row.name !== name); if (base._private) delete base._private[name]; return base; }); },
    replace(value) { const next = validateSnapshot(value); return mutate(base => ({ ...next, ...(base._private ? { _private: base._private } : {}) })); },
    reset: () => mutate(() => structuredClone(DEFAULTS)),
    close() { channel?.close(); db?.close(); },
  };
}
