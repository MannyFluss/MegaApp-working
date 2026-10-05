import { createValuePool, encodeMoment, decodeMoment } from "./moment-codec.js";
// Deterministic capture data. No DOM, model, network, or inferred intent.
export const MOMENT_FORMAT = "megaapp-moment";
export const MOMENT_NAMING_STANDARD = "megaapp-moment-name";
const copy = value => JSON.parse(JSON.stringify(value));
export function validateMoment(moment) {
  moment = decodeMoment(moment);
  if (!moment || moment.format !== MOMENT_FORMAT || moment.version !== 1 || typeof moment.id !== "string" || typeof moment.capturedAt !== "string" ||
      !Number.isFinite(moment.duration) || moment.duration < 0 || moment.duration > 600000 || !Array.isArray(moment.events) || moment.events.length > 50000 ||
      typeof moment.explanation !== "string" || moment.explanation.length > 12000 ||
      (moment.title !== undefined && (typeof moment.title !== "string" || moment.title.length > 160))) throw new Error("Expected a MegaApp moment (version 1, 2 or 3).");
  if (moment.naming !== undefined) {
    const n = moment.naming;
    if (!n || n.standard !== MOMENT_NAMING_STANDARD || n.version !== 1 || !["automatic", "custom"].includes(n.mode) || !["moment", "feedback"].includes(n.kind) ||
        [n.app, n.topic, n.result].some(value => typeof value !== "string" || !value || value.length > 80)) throw new Error("Expected a supported moment naming standard.");
  }
  let previous = -1;
  for (const event of moment.events) {
    if (!event || !Number.isFinite(event.time) || event.time < 0 || event.time < previous || event.time > moment.duration || typeof event.kind !== "string" || typeof event.action !== "string") throw new Error("Moment events must be ordered inside the captured interval.");
    previous = event.time;
  }
  return moment;
}
export function createMomentBuffer({ now = () => performance.now(), wall = () => new Date().toISOString(), seconds = 60, maxBytes = 2000000, maxInkBytes = 64000000 } = {}) {
  let events = [], bytes = 0, sequence = 0, paused = false, boundary = "Session began";
  const pool = createValuePool();
  function removeFirst() { const row = events.shift(); bytes -= row.bytes; if (row.context !== undefined) pool.release(row.context); }
  function clearEvents() { while (events.length) removeFirst(); }
  function prune(time) {
    while (events.length && (time - events[0].time > seconds * 1000 || bytes + pool.bytes - pool.inkBytes > maxBytes || pool.inkBytes > maxInkBytes)) {
      const inkLimit = pool.inkBytes > maxInkBytes;
      removeFirst(); boundary = inkLimit ? "Earlier ink history exceeded the recording memory budget; current marks remain in the capture" : "Earlier history expired";
    }
  }
  return {
    record(event) {
      if (paused) return;
      const { context, ...fields } = event;
      const value = copy({ ...fields, sequence: ++sequence, time: now(), at: wall() });
      if (context !== undefined) { value.context = pool.encode(context); pool.retain(value.context); }
      const size = new TextEncoder().encode(JSON.stringify(value)).length;
      if (size > maxBytes) { if (value.context !== undefined) pool.release(value.context); boundary = "An oversized event was omitted"; return; }
      events.push({ ...value, bytes: size }); bytes += size; prune(value.time);
    },
    setPaused(value) {
      if (paused === Boolean(value)) return;
      paused = Boolean(value); clearEvents();
      boundary = paused ? "Recording paused; recent history cleared" : "Recording resumed; earlier activity was not recorded";
    },
    get paused() { return paused; },
    setWindow(value) { seconds = Math.max(1, Math.min(600, value)); prune(now()); },
    clear(reason = "Recent history cleared") { clearEvents(); boundary = reason; },
    get retainedBytes() { return bytes + pool.bytes; },
    snapshot(context) {
      const end = now(); prune(end);
      const rows = events.map(({ bytes: ignored, ...event }) => event);
      const start = rows[0]?.time ?? end;
      const decoded = new Map();
      return { format: MOMENT_FORMAT, version: 1, id: crypto.randomUUID(), capturedAt: wall(),
        duration: Math.max(0, end - start), boundary, limitSeconds: seconds,
        events: rows.map(event => ({ ...copy(event), time: event.time - start, ...(event.context === undefined ? {} : { context: pool.decode(event.context, decoded) }) })),
        context: copy(context), explanation: "", includeContext: true };
    },
  };
}
export function selectMoment(moment, start = 0, end = moment.duration, includeContext = true) {
  moment = decodeMoment(moment);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > moment.duration) throw new Error("Choose a range inside this moment.");
  const events = structuredClone(moment.events.filter(event => event.time >= start && event.time <= end).map(event => {
    const value = { ...event }; value.time -= start;
    if (!includeContext) delete value.context;
    return value;
  }));
  // A frame immediately before the range supplies an honest baseline for replay.
  const prior = moment.events.filter(event => event.time < start && event.context).at(-1);
  const { audio: ignoredAudio, review: ignoredReview, events: ignoredEvents, context: ignoredContext, baseline: ignoredBaseline, ...portable } = moment;
  const selected = { ...copy(portable), ...(includeContext && moment.context !== undefined ? { context: structuredClone(moment.context) } : {}), ...(includeContext && moment.baseline !== undefined ? { baseline: structuredClone(moment.baseline) } : {}), duration: end - start, selection: { start, end }, events, includeContext };
  if (!includeContext) { delete selected.context; delete selected.baseline; }
  else if (prior) selected.baseline = copy(prior.context);
  if (includeContext && end < moment.duration) selected.context = copy(moment.events.filter(event => event.time <= end && event.context).at(-1)?.context || {});
  return selected;
}
const appNames = { design: "Design", reading: "Reading", canvas: "Canvas", marble: "Marble", jump: "Jump", files: "Files", device: "Device", state: "State" };
// Versioned, inspectable labels: only recorded operations/outcomes determine a
// default. Free text, document titles and guessed intent never become labels.
function namedActivity(event, fallback = false) {
  const { action, outcome = "" } = event;
  const label = (topic, result, title) => ({ topic, result, title });
  if (event.app === "design") {
    if (action === "Begin my edit") {
      if (outcome === "Blocked: overlapping active boundary") return label("edit-boundary", "overlap-blocked", "Edit boundary overlap blocked");
      if (outcome === "Boundary reserved") return label("edit-boundary", "reserved", "Edit boundary reserved");
      return label("edit-boundary", "observed", "Edit boundary interaction");
    }
    if (action === "Define my boundary") return label("text-boundary", "selected", "Text boundary selected");
    if (/^Apply edit \d+$/.test(action) && outcome === "Text changed") return label("text-edit", "applied", "Text replacement applied");
    if (/^Cancel edit \d+$/.test(action)) return label("text-edit", "cancelled", "Text edit cancelled");
    if (action === "Undo text change") return label("text-edit", "undone", "Text change undone");
    if (action === "Use my own text") return label("working-text", "changed", "Working text changed");
    if (action === "Reset text example") return label("working-text", "reset", "Text example reset");
    if (action === "Change introduction") return label("introduction", "changed", "Introduction changed");
    if (action === "Change title") return label("document-title", "changed", "Document title changed");
    if (action === "Change note") return label("document-note", "changed", "Document note changed");
    if (/^Change principle (touch|still|scope|capability|context|continuity|override)$/.test(action)) return label("principle", "changed", "Design principle changed");
    if (["Rearrange design principles", "Change principle width", "Change design columns"].includes(action)) return label("document-layout", "changed", "Document layout changed");
    if (action === "Finish principle drag") return outcome === "Principle placed at the shown insertion point" ? label("document-layout", "changed", "Design principle moved") : label("document-layout", "kept", "Design order kept");
    if (action === "Cancel principle drag") return label("document-layout", "cancelled", "Principle move cancelled");
    if (/^(undo|redo|reset) design document$/.test(action) || action === "Restore design version") return label("document-version", "restored", "Design version restored");
    if (action === "Export design edition") return label("design-edition", "exported", "Design edition exported");
    if (action === "Import design edition") return label("design-edition", "imported", "Design edition imported");
    if (event.target === "design-touch-object" && action === "Pointer moved") return label("surface", "drag-observed", "Surface drag");
    if (event.target === "design-touch-object" && action === "Control key") return label("surface", "key-observed", "Surface key input");
    if (action === "Set page marks visibility") return label("page-markup", outcome === "Saved marks shown" ? "shown" : "hidden", outcome === "Saved marks shown" ? "Page marks shown" : "Page marks hidden");
    if (action === "Draw page markup") return label("page-markup", "drawn", "Page markup drawn");
    if (action === "Cancel page markup") return label("page-markup", "cancelled", "Page mark cancelled");
    if (action === "Clear page markup") return label("page-markup", "cleared", "Page marks cleared");
    if (action === "Undo page markup") return label("page-markup", "undone", "Page mark undone");
    if (action === "Restore page markup") return label("page-markup", "restored", "Page marks restored");
    if (action === "Arrange context concept") return label("context-map", "arranged", "Context map arranged");
    if (action === "Navigate context map") return label("context-map", "navigated", "Context map explored");
    if (action === "Restore context arrangement") return label("context-map", "restored", "Context arrangement restored");
    if (action === "Cancel context map gesture") return label("context-map", "cancelled", "Map gesture cancelled");
    if (action === "Export context map") return label("context-map", "exported", "Context map exported");
    if (["Navigate design canvas", "Zoom design canvas", "Focus canvas window", "Show whole design canvas"].includes(action)) return label("design-canvas", "navigated", "Design canvas explored");
    if (["Move canvas window", "Resize canvas window", "Arrange design canvas"].includes(action)) return label("canvas-arrangement", "changed", "Design windows arranged");
    if (action === "Undo canvas arrangement") return label("canvas-arrangement", "restored", "Window arrangement restored");
    if (action === "Cancel canvas gesture") return label("design-canvas", "cancelled", "Canvas gesture cancelled");
    if (action === "Export design canvas") return label("canvas-arrangement", "exported", "Canvas arrangement exported");
    if (action === "Import design canvas") return label("canvas-arrangement", "imported", "Canvas arrangement imported");
    if (fallback && action === "Explore context concept") return label("context-map", "explored", "Context concept explored");
    if (action === "Tune shared response") return label("input-response", "previewed", "Input response previewed");
    if (fallback && action.startsWith("Understand ")) return label("dictionary", "opened", "Dictionary meaning opened");
    if (fallback && action === "Choose text interaction") return outcome.includes("Browser selection enabled") ? label("text-selection", "enabled", "Browser text selection enabled") : label("dictionary", "restored", "Dictionary interaction restored");
    if (fallback && action === "Reshape design document") return label("document-mode", "changed", "Document editing mode changed");
  }
  if (action === "Set reading preference") return label("reading-preference", "changed", "Reading preference changed");
  if (action === "Set Meta reach") return label("control-reach", "changed", "Control reach changed");
  if (event.kind === "control") {
    const controls = { "reading-prev": ["page", "requested", "Previous page requested"], "reading-next": ["page", "requested", "Next page requested"], "reading-fit": ["page-view", "requested", "Page fit requested"], "reading-zoom-in": ["page-view", "requested", "Zoom in requested"], "reading-zoom-out": ["page-view", "requested", "Zoom out requested"], "draw-tool": ["drawing-tool", "activated", "Drawing tool activated"] };
    if (controls[event.target]) return label(...controls[event.target]);
  }
  return null;
}
export function suggestMomentName(moment) {
  moment = decodeMoment(moment);
  const events = [...(moment.events || [])].reverse();
  const rawApp = events.find(event => appNames[event.app])?.app || moment.context?.app || moment.naming?.app;
  const app = Object.hasOwn(appNames, rawApp) ? rawApp : "megaapp", appName = appNames[app] || "MegaApp";
  const kind = moment.naming?.kind === "feedback" || events.some(event => event.action === "Give design feedback") || moment.title === `${appName} feedback` ? "feedback" : "moment";
  const local = events.filter(event => event.app === app);
  const activity = local.map(event => namedActivity(event)).find(Boolean) || local.map(event => namedActivity(event, true)).find(Boolean) || { topic: "interaction", result: "recorded", title: "Recent interactions" };
  return { title: `${appName} ${kind} — ${activity.title}`, naming: { standard: MOMENT_NAMING_STANDARD, version: 1, mode: "automatic", kind, app, topic: activity.topic, result: activity.result } };
}
export function hasCustomMomentName(moment) {
  if (!moment.title?.trim()) return false;
  if (moment.naming?.mode) return moment.naming.mode === "custom";
  // The preceding release used these exact generic automatic titles. All other
  // legacy names remain personal overrides; no existing evidence is rewritten.
  return !Object.values(appNames).concat("MegaApp").some(app => [app + " moment", app + " feedback"].includes(moment.title.trim()));
}
export function nameMoment(moment, customTitle) {
  const suggested = suggestMomentName(moment), title = customTitle?.trim();
  return { ...moment, ...suggested, ...(title ? { title, naming: { ...suggested.naming, mode: "custom" } } : {}) };
}
export function momentTitle(moment) {
  if (hasCustomMomentName(moment) || (moment.naming?.standard === MOMENT_NAMING_STANDARD && moment.naming.version === 1 && moment.title?.trim())) return moment.title.trim();
  return suggestMomentName(moment).title;
}
export function momentFilename(moment, extension) {
  const title = momentTitle(moment).normalize("NFKC").replace(/[^\p{L}\p{N}\p{M} _-]/gu, " ").trim().replace(/[\s_]+/g, "-").toLowerCase();
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.exec(moment.capturedAt)?.[0].replace(/[T:]/g, "-") || "undated";
  const id = moment.id.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "record";
  return `${Array.from(title || "moment").slice(0, 70).join("")}-${date}-${id}.${extension === "zip" ? "zip" : "json"}`;
}
export function momentMarkdown(moment, { standalone = false } = {}) {
  moment = decodeMoment(moment);
  // Interned children usually have the same identity. Walk only changed
  // branches instead of serializing the whole ink workspace at each action.
  function equal(a,b) {
    if (a===b) return true;
    if (!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b)) return false;
    const keys=Object.keys(a),other=Object.keys(b);
    return keys.length===other.length && keys.every((key,i)=>key===other[i] && equal(a[key],b[key]));
  }
  const inkRecords = [], inkKeys = new Map(), strokeKeys = new WeakMap();
  function inkReference(stroke) {
    let key = strokeKeys.get(stroke);
    if (!key) { key=JSON.stringify(stroke);strokeKeys.set(stroke,key); }
    if (!inkKeys.has(key)) { inkKeys.set(key, inkRecords.length + 1); inkRecords.push(stroke); }
    return { inkRecord: inkKeys.get(key), ...(stroke.id ? { id: stroke.id } : {}), area: stroke.area, pointCount: stroke.points?.length || 0 };
  }
  function present(context) {
    if (!context?.markup) return context;
    const markup = context.markup;
    return { ...context, markup: { ...markup, ...(Array.isArray(markup.strokes) ? { strokes: markup.strokes.map(inkReference) } : {}), ...(markup.currentStroke ? { currentStroke: inkReference(markup.currentStroke) } : {}) } };
  }
  const lines = [`# ${momentTitle(moment).replace(/[\r\n]+/g, " ")}`, "", `Moment: ${moment.id}`, `Captured: ${moment.capturedAt}`, `Duration: ${(moment.duration / 1000).toFixed(1)} seconds`, `History boundary: ${moment.boundary}`, "", "## My explanation", "", moment.explanation || "No explanation supplied.", "", "## Observed interactions", ""];
  let previous = moment.includeContext ? moment.baseline : undefined;
  if (previous) lines.push("Starting context (immediately before the selected range):", "", "```json", JSON.stringify(present(previous), null, 2), "```", "");
  for (const event of moment.events.filter(event => event.kind !== "frame" && event.action !== "Pointer moved")) {
    lines.push(`- ${(event.time / 1000).toFixed(2)}s · ${event.app || "shell"} · ${event.action || event.kind}${event.target ? ` · ${event.target}` : ""}${event.outcome ? ` · ${event.outcome}` : ""}`);
    if (event.kind === "action" && moment.includeContext && event.context) {
      const changes = Object.fromEntries(Object.entries(event.context).filter(([key, value]) => !equal(value,previous?.[key])));
      const removed = Object.keys(previous || {}).filter(key => !Object.hasOwn(event.context, key));
      if (Object.keys(changes).length || removed.length) lines.push("", "Declared context at this action (changed fields; removed fields listed separately):", "", "```json", JSON.stringify({ changed: present(changes), removed }, null, 2), "```", "");
      previous = event.context;
    }
  }
  lines.push("", standalone ? "This text includes action boundaries and declared context changes. Continuous pointer samples and visual frames are omitted; Copy full JSON preserves those separately." : "Detailed physical-input samples and visual frames are retained in moment.json. This readable timeline lists action boundaries and declared context changes.");
  if (moment.includeContext && moment.context) lines.push("", "## Captured app context", "", "```json", JSON.stringify(present(moment.context), null, 2), "```");
  if (inkRecords.length) {
    lines.push("", "## Ink evidence", "", "Each inkRecord refers to one exact observed stroke below. Repeated strokes appear once. Point fields are x, y, t (milliseconds), pressure; coordinates and pressure are unrounded.");
    for (const [index, stroke] of inkRecords.entries()) {
      const tuples = stroke.points?.every(point => Object.keys(point).sort().join(',') === 'pressure,t,x,y');
      const record = tuples ? { ...stroke, pointFields: ['x', 'y', 't', 'pressure'], points: stroke.points.map(p => [p.x, p.y, p.t, p.pressure]) } : stroke;
      lines.push("", `Ink record ${index + 1}:`, "", "```json", JSON.stringify(record), "```");
    }
  }
  if (!moment.includeContext) lines.push("", "Captured content and app state excluded by my choice.");
  if (moment.voiceNote) lines.push("", "A voice note exists. Audio is included only in the ZIP export; it is not transcribed into this text.");
  lines.push("", "This is recorded evidence and the user's explanation. No AI interpretation is included.", "Visual replay reconstructs recorded Design ink, target locations, the example and document. Handwriting is not transcribed; other apps retain interaction timelines.");
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
  return { mode: "device", put: moment => run("readwrite", store => store.put(encodeMoment(moment))),
    list: async () => (await run("readonly", store => store.getAll())).map(decodeMoment), remove: id => run("readwrite", store => store.delete(id)) };
}
function memoryStore() {
  const records = new Map();
  return { mode: "session", async put(moment) { records.set(moment.id, structuredClone(moment.format === MOMENT_FORMAT ? encodeMoment(moment) : moment)); },
    async list() { return [...records.values()].map(value => decodeMoment(structuredClone(value))); }, async remove(id) { records.delete(id); } };
}
