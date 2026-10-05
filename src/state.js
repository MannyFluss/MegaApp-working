import { MEGAAPP_ASSET_REPOSITORY } from "./reading-config.js";
import { storageName } from "./environment.js";
export const TYPES = ["string", "number", "boolean", "object", "array", "null"];
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
export function validateSnapshot(data) {
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
    validateValue(row.type, row.value);
    if (seen.has(row.name)) throw new Error(`Duplicate variable: ${row.name}`);
    seen.add(row.name);
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > 2 * 1024 * 1024)
    throw new Error("Keep sample snapshots below 2 MB.");
  return {
    schemaVersion: 1,
    variables: data.variables.map(({ name, type, value }) => ({
      name,
      type,
      value: structuredClone(value),
    })),
  };
}
export function serializeValue(row) {
  return row.type === "string" ? row.value : JSON.stringify(row.value);
}
export async function createSampleStore() {
  let data = structuredClone(DEFAULTS),
    db = null,
    mode = "session",
    warning = "";
  const fallbackKey = storageName("megaapp.sample.v1");
  const testKey = storageName("megaapp.storage-test");
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(storageName("megaapp-sample"), 1);
      r.onupgradeneeded = () => r.result.createObjectStore("snapshot");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(new Error("Close another MegaApp tab to open storage."));
    });
    const saved = await new Promise((resolve, reject) => {
      const r = db
        .transaction("snapshot")
        .objectStore("snapshot")
        .get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (saved) data = validateSnapshot(saved);
    mode = "indexeddb";
    let fallback;
    try {
      const text = localStorage.getItem(fallbackKey);
      if (text) fallback = validateSnapshot(JSON.parse(text));
    } catch {
      warning = "A fallback snapshot could not be read.";
    }
    // A fallback exists only after localStorage saves. It may contain edits
    // made while IndexedDB was unavailable, even if IndexedDB has older data.
    if (fallback) await commit(fallback);
  } catch {
    db?.close();
    db = null;
    mode = "session";
    try {
      const saved = localStorage.getItem(fallbackKey);
      if (saved) data = validateSnapshot(JSON.parse(saved));
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      mode = "localstorage";
      warning = "Using local storage because IndexedDB could not open.";
    } catch {
      warning =
        "Storage is unavailable. Values last only for this session; export a copy.";
    }
  }
  let queue = Promise.resolve();
  function mutate(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function commit(next) {
    const validated = validateSnapshot(next);
    if (mode === "indexeddb") {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("snapshot", "readwrite");
        tx.objectStore("snapshot").put(validated, "current");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error || new Error("Saving was interrupted."));
      });
      try {
        localStorage.removeItem(fallbackKey);
      } catch {}
    } else if (mode === "localstorage")
      localStorage.setItem(fallbackKey, JSON.stringify(validated));
    data = validated;
    return rows();
  }
  function rows() {
    return structuredClone(data.variables).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  return {
    mode,
    warning,
    rows,
    snapshot: () => structuredClone(data),
    setMany(values) {
      const changes = values.map(({ name, type, value }) => ({ name: validateName(name), type, value: structuredClone(validateValue(type, value)) }));
      return mutate(() => {
        const next = structuredClone(data);
        for (const row of changes) {
          const index = next.variables.findIndex(value => value.name === row.name);
          if (index < 0) next.variables.push(row); else next.variables[index] = row;
        }
        return commit(next);
      });
    },
    set(name, type, value) {
      validateName(name);
      validateValue(type, value);
      const copiedValue = structuredClone(value);
      return mutate(() => {
        const next = structuredClone(data),
          i = next.variables.findIndex((r) => r.name === name),
          row = { name, type, value: copiedValue };
        if (i < 0) next.variables.push(row);
        else next.variables[i] = row;
        return commit(next);
      });
    },
    async remove(name) {
      return mutate(() =>
        commit({
          ...data,
          variables: data.variables.filter((r) => r.name !== name),
        }),
      );
    },
    replace: (next) => {
      const validated = validateSnapshot(next);
      return mutate(() => commit(validated));
    },
    reset: () => mutate(() => commit(structuredClone(DEFAULTS))),
  };
}
