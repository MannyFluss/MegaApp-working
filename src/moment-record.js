// Deterministic capture data. No DOM, model, network, or inferred intent.
export const MOMENT_FORMAT = "megaapp-moment";
const copy = value => JSON.parse(JSON.stringify(value));
export function validateMoment(moment) {
  if (!moment || moment.format !== MOMENT_FORMAT || moment.version !== 1 || typeof moment.id !== "string" || typeof moment.capturedAt !== "string" ||
      !Number.isFinite(moment.duration) || moment.duration < 0 || moment.duration > 600000 || !Array.isArray(moment.events) || moment.events.length > 50000 ||
      typeof moment.explanation !== "string" || moment.explanation.length > 12000 ||
      (moment.title !== undefined && (typeof moment.title !== "string" || moment.title.length > 160))) throw new Error("Expected a MegaApp moment (version 1).");
  let previous = -1;
  for (const event of moment.events) {
    if (!event || !Number.isFinite(event.time) || event.time < 0 || event.time < previous || event.time > moment.duration || typeof event.kind !== "string" || typeof event.action !== "string") throw new Error("Moment events must be ordered inside the captured interval.");
    previous = event.time;
  }
  return moment;
}
export function createMomentBuffer({ now = () => performance.now(), wall = () => new Date().toISOString(), seconds = 60, maxBytes = 2000000 } = {}) {
  let events = [], bytes = 0, sequence = 0, paused = false, boundary = "Session began";
  function prune(time) {
    while (events.length && (time - events[0].time > seconds * 1000 || bytes > maxBytes)) {
      bytes -= events.shift().bytes; boundary = "Earlier history expired";
    }
  }
  return {
    record(event) {
      if (paused) return;
      const value = copy({ ...event, sequence: ++sequence, time: now(), at: wall() });
      const size = new TextEncoder().encode(JSON.stringify(value)).length;
      if (size > maxBytes) { boundary = "An oversized event was omitted"; return; }
      events.push({ ...value, bytes: size }); bytes += size; prune(value.time);
    },
    setPaused(value) {
      if (paused === Boolean(value)) return;
      paused = Boolean(value); events = []; bytes = 0;
      boundary = paused ? "Recording paused; recent history cleared" : "Recording resumed; earlier activity was not recorded";
    },
    get paused() { return paused; },
    setWindow(value) { seconds = Math.max(1, Math.min(600, value)); prune(now()); },
    clear(reason = "Recent history cleared") { events = []; bytes = 0; boundary = reason; },
    snapshot(context) {
      const end = now(); prune(end);
      const rows = events.map(({ bytes: ignored, ...event }) => event);
      const start = rows[0]?.time ?? end;
      return { format: MOMENT_FORMAT, version: 1, id: crypto.randomUUID(), capturedAt: wall(),
        duration: Math.max(0, end - start), boundary, limitSeconds: seconds,
        events: rows.map(event => ({ ...copy(event), time: event.time - start })),
        context: copy(context), explanation: "", includeContext: true };
    },
  };
}
export function selectMoment(moment, start = 0, end = moment.duration, includeContext = true) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > moment.duration) throw new Error("Choose a range inside this moment.");
  const events = moment.events.filter(event => event.time >= start && event.time <= end).map(event => {
    const value = copy(event); value.time -= start;
    if (!includeContext) delete value.context;
    return value;
  });
  // A frame immediately before the range supplies an honest baseline for replay.
  const prior = moment.events.filter(event => event.time < start && event.context).at(-1);
  const { audio: ignoredAudio, review: ignoredReview, ...portable } = moment;
  const selected = { ...copy(portable), duration: end - start, selection: { start, end }, events, includeContext };
  if (!includeContext) { delete selected.context; delete selected.baseline; }
  else if (prior) selected.baseline = copy(prior.context);
  if (includeContext && end < moment.duration) selected.context = copy(moment.events.filter(event => event.time <= end && event.context).at(-1)?.context || {});
  return selected;
}
export function momentTitle(moment) {
  const app = moment.context?.app || moment.events.find(event => event.app)?.app || "MegaApp";
  return moment.title?.trim() || `${app[0].toUpperCase()}${app.slice(1)} moment`;
}
export function momentFilename(moment, extension) {
  const title = momentTitle(moment).normalize("NFKC").replace(/[^\p{L}\p{N}\p{M} _-]/gu, " ").trim().replace(/[\s_]+/g, "-").toLowerCase();
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.exec(moment.capturedAt)?.[0].replace(/[T:]/g, "-") || "undated";
  const id = moment.id.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "record";
  return `${Array.from(title || "moment").slice(0, 70).join("")}-${date}-${id}.${extension === "zip" ? "zip" : "json"}`;
}
export function momentMarkdown(moment, { standalone = false } = {}) {
  const lines = [`# ${momentTitle(moment).replace(/[\r\n]+/g, " ")}`, "", `Moment: ${moment.id}`, `Captured: ${moment.capturedAt}`, `Duration: ${(moment.duration / 1000).toFixed(1)} seconds`, `History boundary: ${moment.boundary}`, "", "## My explanation", "", moment.explanation || "No explanation supplied.", "", "## Observed interactions", ""];
  let previous = moment.includeContext ? moment.baseline : undefined;
  if (previous) lines.push("Starting context (immediately before the selected range):", "", "```json", JSON.stringify(previous, null, 2), "```", "");
  for (const event of moment.events.filter(event => event.kind !== "frame" && event.action !== "Pointer moved")) {
    lines.push(`- ${(event.time / 1000).toFixed(2)}s · ${event.app || "shell"} · ${event.action || event.kind}${event.target ? ` · ${event.target}` : ""}${event.outcome ? ` · ${event.outcome}` : ""}`);
    if (event.kind === "action" && moment.includeContext && event.context) {
      const changes = Object.fromEntries(Object.entries(event.context).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous?.[key])));
      const removed = Object.keys(previous || {}).filter(key => !Object.hasOwn(event.context, key));
      if (Object.keys(changes).length || removed.length) lines.push("", "Declared context at this action (changed fields; removed fields listed separately):", "", "```json", JSON.stringify({ changed: changes, removed }, null, 2), "```", "");
      previous = event.context;
    }
  }
  lines.push("", standalone ? "This text includes action boundaries and declared context changes. Continuous pointer samples and visual frames are omitted; Copy full JSON preserves those separately." : "Detailed physical-input samples and visual frames are retained in moment.json. This readable timeline lists action boundaries and declared context changes.");
  if (moment.includeContext && moment.context) lines.push("", "## Captured app context", "", "```json", JSON.stringify(moment.context, null, 2), "```");
  if (!moment.includeContext) lines.push("", "Captured content and app state excluded by my choice.");
  if (moment.voiceNote) lines.push("", "A voice note exists. Audio is included only in the ZIP export; it is not transcribed into this text.");
  lines.push("", "This is recorded evidence and the user's explanation. No AI interpretation is included.", "Visual replay reconstructs the Design example from recorded frames; it is not a screen video or a replay of other apps.");
  return lines.join("\n");
}
export async function createMomentStore({ indexedDB = globalThis.indexedDB, name = "megaapp-moments-v1" } = {}) {
  if (!indexedDB) return memoryStore();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("moments", { keyPath: "id" });
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); }; request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error("Close another Moments tab to open storage.")); };
    });
  } catch { return memoryStore(); }
  db.onversionchange = () => db.close();
  function run(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("moments", mode), request = operation(tx.objectStore("moments"));
      let value; request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || request.error || new Error("Moment could not be saved. Export it to keep a copy."));
    });
  }
  return { mode: "device", put: moment => run("readwrite", store => store.put(moment)),
    list: () => run("readonly", store => store.getAll()), remove: id => run("readwrite", store => store.delete(id)) };
}
function memoryStore() {
  const records = new Map();
  return { mode: "session", async put(moment) { records.set(moment.id, structuredClone(moment)); },
    async list() { return [...records.values()].map(value => structuredClone(value)); }, async remove(id) { records.delete(id); } };
}
