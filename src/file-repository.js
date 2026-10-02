// Independent from megaapp-sample. Blobs, drafts, and preserved versions never
// enter ordinary settings, agent tools, or the app-shell cache.
export class LocalRevisionError extends Error {
  constructor() {
    super("This file changed in another tab. Your edit can be kept as a separate draft.");
    this.code = "LOCAL_CONFLICT";
  }
}
const copy = (value) => value == null ? value : structuredClone(value);
function checked(current, expectedRevision) {
  if (expectedRevision === null ? current != null : current?.revision !== expectedRevision)
    throw new LocalRevisionError();
}
export function createMemoryFileRepository() {
  const files = new Map(), remote = new Map();
  return {
    mode: "memory",
    warning: "Session only. Export your files before closing this page.",
    async get(id) { return copy(files.get(id)); },
    async list() { return [...files.values()].map(copy); },
    async put(record, { expectedRevision = null } = {}) {
      return (await this.putMany([{ record, expectedRevision }]))[0];
    },
    async putMany(entries) {
      for (const { record, expectedRevision } of entries) checked(files.get(record.id), expectedRevision);
      const saved = entries.map(({ record }) => ({ ...copy(record), revision: (files.get(record.id)?.revision ?? 0) + 1 }));
      for (const value of saved) files.set(value.id, value);
      return saved.map(copy);
    },
    async update(id, transform) {
      const current = copy(files.get(id));
      if (!current) throw new Error("This local file is missing.");
      const next = transform(current);
      return this.put(next, { expectedRevision: current.revision });
    },
    async getRemote(id) { return copy(remote.get(id)); },
    async listRemote() { return [...remote.values()].map(copy); },
    async putRemote(value, expectedVersion = null) {
      const old = remote.get(value.id);
      if (expectedVersion === null ? old != null : old?.version !== expectedVersion) {
        const e = new Error("The Drive copy has changed."); e.code = "CONFLICT"; e.remote = copy(old); throw e;
      }
      remote.set(value.id, copy(value));
      return copy(value);
    },
    close() {},
  };
}
export async function createFileRepository({ indexedDB = globalThis.indexedDB, name = "megaapp-files-v1" } = {}) {
  if (!indexedDB) return createMemoryFileRepository();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 2);
      let blocked = false;
      r.onupgradeneeded = () => {
        for (const store of ["files", "simulated-drive", "binary-chunks"])
          if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store, { keyPath: "id" });
      };
      r.onsuccess = () => { if (blocked) r.result.close(); else resolve(r.result); };
      r.onerror = () => reject(r.error);
      r.onblocked = () => { blocked = true; reject(new Error("Close another Files tab to open storage.")); };
    });
  } catch { return createMemoryFileRepository(); }
  db.onversionchange = () => db.close();
  function read(store, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store), r = id === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(id);
      let result, failure;
      r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = (event) => { failure = event.target?.error || tx.error; };
      tx.onabort = () => reject(failure || tx.error || new Error("Local files could not be read."));
    });
  }
  function write(store, run) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      let result, failure;
      const fail = (error) => { if (failure) return; failure = error; try { tx.abort(); } catch {} };
      try { run(tx.objectStore(store), (value) => { result = value; }, fail); } catch (e) { fail(e); }
      tx.oncomplete = () => resolve(result);
      // WebKit's request error precedes tx.error. Wait for the abort so no
      // caller can start an upload before the failed transaction has settled.
      tx.onerror = (event) => { failure ||= event.target?.error || tx.error; };
      tx.onabort = () => reject(failure || tx.error || new Error("Local save failed. Export the open draft to keep it."));
    });
  }
  const CHUNK_BYTES = 1024 * 1024, MARKER = "megaapp-binary-chunks-v1";
  const blobReferences = new WeakMap();
  let chunkCodec = false;
  function reference(value) {
    if (!value || typeof value !== "object" || value.encoding !== MARKER) return false;
    if (Object.keys(value).sort().join(",") !== "chunks,encoding,id,size,type" ||
      typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id) ||
      !Number.isSafeInteger(value.size) || value.size < 0 ||
      !Number.isSafeInteger(value.chunks) || value.chunks !== Math.ceil(value.size / CHUNK_BYTES) ||
      typeof value.type !== "string") throw new Error("This local file's binary storage reference is invalid. Export another preserved copy.");
    return true;
  }
  function hasReference(value) {
    if (!value || typeof value !== "object" || value instanceof Blob) return false;
    return reference(value) || Object.values(value).some(hasReference);
  }
  async function encode(value) {
    if (value instanceof Blob) {
      if (blobReferences.has(value)) return blobReferences.get(value);
      const manifest = { encoding: MARKER, id: crypto.randomUUID(), size: value.size, type: value.type, chunks: Math.ceil(value.size / CHUNK_BYTES) };
      // Stage append-only chunks before the final record CAS. A failed or stale
      // save can leave unnamed chunks, never a partially committed file.
      for (let i = 0; i < manifest.chunks; i++) {
        const bytes = await value.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).arrayBuffer();
        await write("binary-chunks", (store, done) => { store.put({ id: `${manifest.id}:${i}`, bytes }); done(); });
      }
      blobReferences.set(value, manifest);
      return manifest;
    }
    if (!value || typeof value !== "object") return value;
    if (reference(value)) return value;
    if (Array.isArray(value)) {
      const result = []; for (const item of value) result.push(await encode(item)); return result;
    }
    const result = {}; for (const [key, item] of Object.entries(value)) result[key] = await encode(item); return result;
  }
  async function decode(value, decoded = new Map()) {
    if (!value || typeof value !== "object" || value instanceof Blob) return value;
    if (reference(value)) {
      chunkCodec = true;
      if (decoded.has(value.id)) return decoded.get(value.id);
      const parts = [];
      for (let i = 0; i < value.chunks; i++) {
        const chunk = await read("binary-chunks", `${value.id}:${i}`);
        const expected = Math.min(CHUNK_BYTES, value.size - i * CHUNK_BYTES);
        if (!(chunk?.bytes instanceof ArrayBuffer) || chunk.bytes.byteLength !== expected)
          throw new Error("This local file has an incomplete stored chunk. Your other preserved copies are kept.");
        parts.push(new Blob([chunk.bytes]));
      }
      const blob = new Blob(parts, { type: value.type });
      blobReferences.set(blob, value); decoded.set(value.id, blob); return blob;
    }
    if (Array.isArray(value)) {
      const result = []; for (const item of value) result.push(await decode(item, decoded)); return result;
    }
    const result = {}; for (const [key, item] of Object.entries(value)) result[key] = await decode(item, decoded); return result;
  }
  async function compatible(nativeWrite, encodedWrite) {
    if (!chunkCodec) {
      try { return await nativeWrite(); }
      catch (error) {
        if (error.code !== "CHUNK_CODEC_REQUIRED" && !/preparing Blob\/File data|Blob.*serializ/i.test(error.message || "")) throw error;
        chunkCodec = true;
      }
    }
    return encodedWrite();
  }
  function commitMany(entries) {
    return write("files", (store, done, fail) => {
      const saved = new Array(entries.length); let remaining = entries.length;
      if (!remaining) { done([]); return; }
      for (const [i, { record, expectedRevision }] of entries.entries()) {
        const r = store.get(record.id);
        r.onsuccess = () => {
          try {
            checked(r.result, expectedRevision);
            saved[i] = { ...record, revision: (r.result?.revision ?? 0) + 1 };
            store.put(saved[i]);
            if (--remaining === 0) done(saved);
          } catch (e) { fail(e); }
        };
      }
    });
  }
  function commitRemote(value, expectedVersion) {
    return write("simulated-drive", (store, done, fail) => {
      const r = store.get(value.id);
      r.onsuccess = () => {
        if (expectedVersion === null ? r.result != null : r.result?.version !== expectedVersion) {
          const e = new Error("The Drive copy has changed."); e.code = "CONFLICT"; e.remote = r.result; fail(e); return;
        }
        store.put(value); done(value);
      };
    });
  }
  const repository = {
    mode: "indexeddb", warning: "",
    get: async (id) => decode(await read("files", id)), list: async () => decode(await read("files")),
    async put(record, { expectedRevision = null } = {}) { return (await this.putMany([{ record, expectedRevision }]))[0]; },
    async putMany(entries) {
      return compatible(() => commitMany(entries), async () => {
        const encoded = [];
        for (const entry of entries) encoded.push({ ...entry, record: await encode(entry.record) });
        return decode(await commitMany(encoded));
      });
    },
    async update(id, transform) {
      return compatible(() => write("files", (store, done, fail) => {
        const r = store.get(id);
        r.onsuccess = () => {
          try {
            if (!r.result) throw new Error("This local file is missing.");
            if (hasReference(r.result)) { const error = new Error("Decode the local binary chunks first."); error.code = "CHUNK_CODEC_REQUIRED"; throw error; }
            const next = { ...transform(r.result), revision: r.result.revision + 1 };
            store.put(next); done(next);
          } catch (e) { fail(e); }
        };
      }), async () => {
        // Decoding/encoding cannot keep an IDB transaction alive. CAS the
        // resulting record and reapply the transform if another tab won.
        for (let attempt = 0; attempt < 5; attempt++) {
          const current = await repository.get(id);
          if (!current) throw new Error("This local file is missing.");
          const next = transform(current);
          try { return await repository.put(next, { expectedRevision: current.revision }); }
          catch (error) { if (error.code !== "LOCAL_CONFLICT" || attempt === 4) throw error; }
        }
      });
    },
    getRemote: async (id) => decode(await read("simulated-drive", id)), listRemote: async () => decode(await read("simulated-drive")),
    async putRemote(value, expectedVersion = null) {
      try {
        return await compatible(() => commitRemote(value, expectedVersion), async () => decode(await commitRemote(await encode(value), expectedVersion)));
      } catch (error) {
        if (error.remote) error.remote = await decode(error.remote);
        throw error;
      }
    },
    close: () => db.close(),
  };
  return repository;
}
