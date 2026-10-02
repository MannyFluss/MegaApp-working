import { exportFileRecord } from "./file-export.js";

export const MAX_FILE_SIZE = 512 * 1024 * 1024;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const sharedLocks = new Map();
function locked(id, task) {
  if (globalThis.navigator?.locks)
    return navigator.locks.request(`megaapp-file-save:${id}`, task);
  const key = id;
  const previous = sharedLocks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  sharedLocks.set(key, next);
  next.finally(() => { if (sharedLocks.get(key) === next) sharedLocks.delete(key); }).catch(() => {});
  return next;
}
function validate({ name, mimeType, blob }) {
  if (typeof name !== "string" || !name.trim() || name.length > 180)
    throw new Error("Give this file a name of 1–180 characters.");
  if (!(blob instanceof Blob)) throw new Error("Choose a file or a draft to save.");
  if (blob.size > MAX_FILE_SIZE) throw new Error("This first version supports files up to 512 MB.");
  return { name: name.trim(), mimeType: mimeType || blob.type || "application/octet-stream", blob };
}
function newRecord(input) {
  return { ...validate(input), id: uuid(), size: input.blob.size, remote: null,
    status: "local", dirty: true, revision: 0, contentRevision: 1,
    history: [], conflict: null, operation: null, error: "", createdAt: now(), updatedAt: now() };
}
function checkpoint(history, row, kind, version, contentRevision = row.contentRevision) {
  const fileId = row.id ?? null;
  if (history.some((value) => value.kind === kind && value.version === version && value.contentRevision === contentRevision && (value.fileId ?? null) === fileId)) return history;
  return [...history, { blob: row.blob, name: row.name, kind, version: version ?? null, contentRevision, fileId, savedAt: now() }];
}
function preserveOpenedOriginal(row) {
  if (row.dirty || !row.remote || row.history.some((item) => item.fileId === row.id && item.contentRevision === row.contentRevision && item.version === row.remote.version)) return row.history;
  return checkpoint(row.history, row, "opened-original", row.remote.version);
}
function preservePendingIntent(row) {
  const intent = row.operation;
  if (!intent || intent.contentRevision === row.contentRevision || row.history.some((item) => item.fileId === row.id && item.contentRevision === intent.contentRevision)) return row.history;
  return checkpoint(row.history, { ...intent, id: row.id }, "preserved-save-intent", intent.remote?.version ?? null);
}
function copyName(name) {
  const at = name.lastIndexOf("."), suffix = ` (my copy ${now().replace(/[:.]/g, "-")})`;
  return (at > 0 ? name.slice(0, at) + suffix + name.slice(at) : name + suffix).slice(0, 180);
}

export function createFileWorkspace({ repository, adapter }) {
  const seen = new Map(), queues = new Map();
  function remember(row) { if (row) seen.set(row.id, row.revision); return row; }
  function serialized(id, task) {
    const previous = queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(id, next); next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  }
  async function required(id) {
    const row = await repository.get(id);
    if (!row) throw new Error("This local file could not be found.");
    return row;
  }
  async function markConflict(id, metadata, preservedCopy = null, preservedContentRevision = null) {
    let download, error = "";
    const sourceUnavailable = !metadata;
    const local = await required(id);
    metadata ||= local.remote || { id: "unavailable", name: local.name, mimeType: local.mimeType, version: "unknown" };
    if (sourceUnavailable) error = preservedCopy
      ? "The original Drive file is unavailable. Your draft and uploaded copy are kept. Export them or keep your draft as a separate file."
      : "The Drive file is unavailable. Your local copy is kept. Export it or keep it as a separate file.";
    else {
      try { download = await adapter.download(metadata.id); }
      catch { error = "The Drive copy changed. Reconnect and refresh to load both copies."; }
    }
    return remember(await repository.update(id, (current) => ({ ...current, status: "conflict", dirty: true,
      conflict: { metadata: download?.metadata || metadata, blob: download?.blob || null, preservedCopy, preservedContentRevision, sourceUnavailable }, error, updatedAt: now() })));
  }
  async function refreshUnlocked(id) {
    let row = await required(id);
    if (!adapter.online) return remember(row);
    if (row.operation && !row.conflict && adapter.recoverOperation) {
      try {
        const recovered = await adapter.recoverOperation(row.operation.id);
        if (recovered) return finishUpload(id, { ...row, ...row.operation, remote: row.operation.remote, operation: row.operation }, recovered);
      } catch (e) {
        if (e.code === "CONFLICT") return markConflict(id, e.remote, e.preservedCopy, row.operation.contentRevision);
        return remember(await repository.update(id, (current) => ({ ...current, error: e.message })));
      }
    }
    const target = row.conflict?.metadata || row.remote;
    if (!target) return remember(row);
    let metadata;
    try { metadata = await adapter.metadata(target.id); }
    catch (e) {
      if (["NOT_FOUND", "ACCESS_DENIED"].includes(e.code))
        return markConflict(id, undefined, row.conflict?.preservedCopy, row.conflict?.preservedContentRevision);
      return remember(await repository.update(id, (current) => ({ ...current, error: e.message,
        status: current.dirty && current.status !== "conflict" ? "pending" : current.status })));
    }
    if (metadata.version === row.remote.version && row.status !== "conflict") {
      if (row.error) row = await repository.update(id, (current) => ({ ...current, error: "" }));
      return remember(row);
    }
    const download = await adapter.download(target.id);
    // Compare inside the durable transaction: an edit may have happened while
    // downloading, even in another browser tab.
    return remember(await repository.update(id, (current) => {
      if (download.metadata.version === current.remote?.version && !current.conflict) return current;
      if (current.dirty || current.conflict) return { ...current, status: "conflict", dirty: true,
        history: current.conflict?.blob && current.conflict.metadata.version !== download.metadata.version
          ? checkpoint(current.history, { id: current.id, blob: current.conflict.blob, name: current.conflict.metadata.name, contentRevision: 0 }, "earlier-drive-conflict", current.conflict.metadata.version) : current.history,
        conflict: { ...download, preservedCopy: current.conflict?.preservedCopy || null, preservedContentRevision: current.conflict?.preservedContentRevision ?? null }, error: "", updatedAt: now() };
      return { ...current, name: download.metadata.name, mimeType: download.metadata.mimeType,
        blob: download.blob, size: download.blob.size, remote: download.metadata,
        contentRevision: current.contentRevision + 1,
        history: checkpoint(current.history, current, "previous-cache", current.remote.version),
        status: "synced", dirty: false, conflict: null, operation: null, error: "", updatedAt: now() };
    }));
  }
  async function finishUpload(id, sent, metadata) {
    return remember(await repository.update(id, (current) => {
      const sameDraft = current.contentRevision === sent.contentRevision;
      const conflict = current.conflict && (current.conflict.metadata.id !== metadata.id || current.conflict.metadata.version !== metadata.version) ? current.conflict : null;
      const history = checkpoint(current.history, { ...sent, id }, "drive-version", metadata.version);
      if (current.operation?.id !== sent.operation.id)
        return { ...current, history };
      return { ...current, remote: metadata, status: conflict ? "conflict" : sameDraft ? "synced" : "local", dirty: Boolean(conflict) || !sameDraft,
        history,
        operation: null, conflict, error: "", updatedAt: now() };
    }));
  }
  async function saveUnlocked(id, remaining = 2) {
    let row = await required(id);
    if (row.status === "conflict") return remember(row);
    if (!row.dirty && row.remote && !row.operation) return refreshUnlocked(id);
    // Commit intent before any network mutation. A retry reuses this operation
    // after uncertain responses, including a successful upload with failed ack.
    row = await repository.update(id, (current) => ({ ...current, status: "pending", error: "",
      operation: current.operation || { id: uuid(), contentRevision: current.contentRevision,
        baseVersion: current.remote?.version ?? null, remote: current.remote,
        blob: current.blob, name: current.name, mimeType: current.mimeType }, updatedAt: now() }));
    if (!adapter.online) return remember(row);
    // Upload the committed intent, even after further edits. This retains an
    // uncertain earlier upload for recovery while the newest draft stays local.
    const sent = { ...row, blob: row.operation.blob, name: row.operation.name,
      mimeType: row.operation.mimeType, contentRevision: row.operation.contentRevision,
      remote: row.operation.remote };
    async function completed(metadata) {
      const latest = await finishUpload(id, sent, metadata);
      return latest.dirty && latest.status !== "conflict" && remaining > 0
        ? saveUnlocked(id, remaining - 1) : latest;
    }
    try {
      if (adapter.recoverOperation) {
        const recovered = await adapter.recoverOperation(row.operation.id);
        if (recovered) return completed(recovered);
      }
      if (sent.remote) {
        const metadata = await adapter.metadata(sent.remote.id);
        if (metadata.operationId === row.operation.id) return completed(metadata);
        if (metadata.version !== sent.remote.version) return markConflict(id, metadata);
      }
      const input = { name: sent.name, mimeType: sent.mimeType, blob: sent.blob,
        operationId: row.operation.id, expectedVersion: row.operation.baseVersion };
      const metadata = sent.remote ? await adapter.save(sent.remote.id, input) : await adapter.create(input);
      return await completed(metadata);
    } catch (e) {
      if (e.code === "CONFLICT") {
        let metadata = e.remote;
        if (!metadata && !e.preservedCopy) {
          try { metadata = await adapter.metadata(sent.remote.id); } catch {}
        }
        return markConflict(id, metadata, e.preservedCopy, sent.contentRevision);
      }
      // Saving this error can fail too. The previously committed draft and
      // operation remain recoverable; never switch to a fresh upload silently.
      return remember(await repository.update(id, (current) => ({ ...current, status: "pending", error: e.message })));
    }
  }
  const saveWithLock = (id) => locked(id, () => saveUnlocked(id));
  const workspace = {
    repository, adapter,
    async list() { return (await repository.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async get(id) { return remember(await repository.get(id)); },
    async create(input) { return remember(await repository.put(newRecord(input))); },
    async open(id) {
      return serialized(id, async () => {
        let row = await repository.get(id);
        if (!row) {
          const cached = (await repository.list()).find((value) => value.remote?.id === id);
          if (cached) return locked(cached.id, () => refreshUnlocked(cached.id));
          const download = await adapter.download(id);
          row = newRecord({ name: download.metadata.name, mimeType: download.metadata.mimeType, blob: download.blob });
          row.remote = download.metadata; row.status = "synced"; row.dirty = false;
          row = await repository.put(row);
        }
        return locked(row.id, () => refreshUnlocked(row.id));
      });
    },
    edit(id, blob, { expectedRevision = seen.get(id) } = {}) {
      return serialized(id, async () => {
        const row = await required(id);
        validate({ name: row.name, mimeType: row.mimeType, blob });
        try {
          return remember(await repository.put({ ...row, blob, size: blob.size, contentRevision: row.contentRevision + 1,
            history: preserveOpenedOriginal(row), dirty: true, status: row.status === "conflict" ? "conflict" : "local", error: "", updatedAt: now() },
            { expectedRevision: expectedRevision ?? row.revision }));
        } catch (e) {
          if (e.code !== "LOCAL_CONFLICT") throw e;
          // A stale editor never overwrites another tab. Its attempted content
          // receives its own durable row, even if the other tab uploaded first.
          e.recovery = await workspace.create({ name: copyName(row.name), mimeType: row.mimeType, blob });
          throw e;
        }
      });
    },
    save: (id) => serialized(id, () => saveWithLock(id)),
    refresh: (id) => serialized(id, () => locked(id, () => refreshUnlocked(id))),
    resolve(id, choice) {
      return serialized(id, () => locked(id, async () => {
        if (!["keep-both", "use-remote"].includes(choice)) throw new Error("Choose Keep both or Use Drive copy.");
        let current = await required(id);
        if (!current.conflict) return remember(current);
        // Resolve against the latest remote copy, not an older comparison.
        if (adapter.online) await refreshUnlocked(id);
        current = await required(id);
        if (!current.conflict?.blob && !(choice === "keep-both" && (current.conflict?.preservedCopy || current.conflict?.sourceUnavailable)))
          throw new Error("Reconnect and refresh to load the Drive copy before choosing, or export your draft.");
        const remote = current.conflict;
        const preservedHistory = preservePendingIntent(current);
        const accepted = remote.blob ? { ...current, blob: remote.blob, size: remote.blob.size, name: remote.metadata.name,
          mimeType: remote.metadata.mimeType, remote: remote.metadata, contentRevision: current.contentRevision + 1,
          status: "synced", dirty: false, conflict: null, operation: null, error: "",
          history: checkpoint(preservedHistory, current, "preserved-draft", current.remote?.version), updatedAt: now() }
          : { ...current, remote: null, previousSource: current.remote, status: "local", dirty: true,
            conflict: null, operation: null, history: checkpoint(preservedHistory, current, "preserved-draft", current.remote?.version), updatedAt: now() };
        if (choice === "use-remote") return remember(await repository.put(accepted, { expectedRevision: current.revision }));
        const localCopy = newRecord({ name: copyName(current.name), mimeType: current.mimeType, blob: current.blob });
        localCopy.history = preservedHistory.slice();
        localCopy.derivedFrom = current.id;
        if (current.conflict.preservedCopy && current.conflict.preservedContentRevision === current.contentRevision) {
          localCopy.remote = current.conflict.preservedCopy;
          localCopy.status = "synced"; localCopy.dirty = false;
        }
        const [, kept] = await repository.putMany([{ record: accepted, expectedRevision: current.revision }, { record: localCopy, expectedRevision: null }]);
        remember(kept);
        return kept.dirty ? saveWithLock(kept.id) : kept;
      }));
    },
    async export(id) { return exportFileRecord(await required(id)); },
  };
  return workspace;
}
