import { validatePDF, pdfHash } from "./reading-assets.js";
import { createWorkspace, validateWorkspace } from "./pdf-workspace.js";
import { LocalRevisionError } from "./file-repository.js";
export const READING_DATABASE = "megaapp-reading-assets-v1";
export const CACHE_LIMIT = 100 * 1024 * 1024;
export function createReadingLibrary({ repository, storage, getAccount }) {
  const now = () => new Date().toISOString();
  function checkedWorkspace(value, hash) {
    const workspace = validateWorkspace(value);
    if (workspace.pdfHash !== hash) throw new Error("This workspace belongs to a different PDF. Your saved work is kept.");
    return workspace;
  }
  function initialized(record) {
    return { ...record, workspaceId: record.workspaceId || crypto.randomUUID(),
      workspace: record.workspace || { ...createWorkspace(record.hash), view: { x: 0, y: 0, zoom: 1, page: record.page || 1 } },
      workspaceBaseSha: record.workspaceBaseSha || null, workspaceDirty: record.workspaceDirty ?? true };
  }
  function owned(record, owner) {
    if (!owner) throw new Error("Connect GitHub before syncing.");
    if (record.owner && record.owner !== owner) throw new Error("This workspace belongs to another repository. Reconnect that repository.");
    if (getAccount()?.id !== owner) throw new Error("The account changed during sync. Reconnect the original repository.");
  }
  function preserved(record, workspace, label) {
    return { ...record, id: crypto.randomUUID(), workspaceId: crypto.randomUUID(),
      name: `${record.name.replace(/\.pdf$/i, "").slice(0, 155)} (${label}).pdf`,
      workspace: structuredClone(workspace), workspaceBaseSha: null, workspaceDirty: true,
      workspaceConflict: null, conflictCopyOf: record.id, created: now() };
  }
  async function saveSyncResult(id, sent, result, owner) {
    owned(sent, owner);
    // A save may have happened while GitHub was responding. Preserve that newer
    // edit and only advance its baseline when it descends from the sent snapshot.
    return repository.update(id, (current) => {
      owned(current, owner);
      if (current.workspaceId !== sent.workspaceId || current.workspaceBaseSha !== sent.workspaceBaseSha)
        throw new LocalRevisionError();
      if (result.status === "conflict") return { ...current, workspaceConflict: { remote: result.remote, detectedAt: now() } };
      const unchanged = JSON.stringify(current.workspace) === JSON.stringify(sent.workspace);
      if (!sent.workspaceDirty && !unchanged)
        return { ...current, workspaceConflict: { remote: result.remote, detectedAt: now() } };
      return { ...current, workspace: unchanged ? result.remote.workspace : current.workspace,
        workspaceBaseSha: result.remote.sha, workspaceDirty: !unchanged, workspaceConflict: null,
        cloudChecked: now(), cloudAvailable: true };
    });
  }
  async function room(size, exclude = "") {
    const used = (await repository.list()).filter((r) => r.id !== exclude).reduce((sum, r) => sum + (r.blob?.size || 0), 0);
    if (used + size > CACHE_LIMIT) throw new Error("This sample's 100 MB local cache is full. Your PDFs are kept; use another browser or export copies.");
  }
  const library = {
    repository,
    async import(blob, name, { sample = false, newCopy = false } = {}) {
      await validatePDF(blob);
      const hash = await pdfHash(blob);
      if (!newCopy) {
        const existing = (await repository.list()).find((r) => r.hash === hash && !r.conflictCopyOf && (!r.owner || !getAccount()?.id || r.owner === getAccount().id));
        if (existing) return library.workspace(existing.id);
      }
      await room(blob.size);
      return repository.put({ id: crypto.randomUUID(), name: String(name || "Untitled.pdf").slice(0, 200),
        blob: new Blob([blob], { type: "application/pdf" }), hash, page: 1, sample,
        workspaceId: crypto.randomUUID(), workspace: createWorkspace(hash), workspaceBaseSha: null, workspaceDirty: true,
        owner: "", remoteId: "", uploaded: false, created: now() });
    },
    async upload(id, onProgress) {
      const owner = getAccount()?.id;
      if (!owner) throw new Error("Connect GitHub before uploading.");
      let record = await repository.get(id);
      if (!record) throw new Error("The local PDF is missing.");
      if (record.owner && record.owner !== owner) throw new Error("This PDF's pending upload belongs to another repository. Reconnect that repository.");
      // Bind and reserve before sending any file bytes. CAS stops stale tabs
      // from reserving and uploading different IDs for the same local PDF.
      if (!record.owner) record = await repository.put({ ...record, owner }, { expectedRevision: record.revision });
      if (!record.remoteId) {
        const remoteId = await storage.reserveId(record);
        record = await repository.put({ ...record, remoteId }, { expectedRevision: record.revision });
      }
      owned(record, owner);
      await storage.upload(record, onProgress);
      if (getAccount()?.id !== owner) throw new Error("The account changed during upload. Reconnect the original account to verify the file.");
      return repository.update(id, (current) => {
        owned(current, owner);
        return { ...current, uploaded: true, cloudChecked: now(), cloudAvailable: true };
      });
    },
    async refresh() {
      const owner = getAccount()?.id;
      if (!owner) throw new Error("Connect GitHub to refresh the library.");
      const files = await storage.list();
      if (getAccount()?.id !== owner) throw new Error("The account changed. Refresh again.");
      const ids = new Set(files.map((file) => `${file.path || file.id}:${file.hash}`));
      for (const record of await repository.list()) {
        if (record.owner === owner && record.uploaded)
          await repository.update(record.id, (r) => {
            owned(r, owner);
            return { ...r, cloudAvailable: ids.has(`${r.remoteId}:${r.hash}`), cloudChecked: now() };
          });
      }
      return files;
    },
    async cache(file) {
      const owner = getAccount()?.id;
      if (!owner) throw new Error("Connect GitHub to download this PDF.");
      const remoteId = file.path || file.id;
      const id = `git:${owner}:${file.workspaceId || file.id}:${file.hash}`;
      const existing = (await repository.list()).find((r) => r.owner === owner && r.remoteId === remoteId && r.hash === file.hash && (!file.workspaceId || r.workspaceId === file.workspaceId));
      if (existing) return existing;
      await room(file.size);
      const blob = await storage.download(file);
      if (getAccount()?.id !== owner) throw new Error("The account changed. Download again from the selected account.");
      await room(blob.size);
      const workspace = file.workspace ? checkedWorkspace(file.workspace, file.hash) : createWorkspace(file.hash);
      if (getAccount()?.id !== owner) throw new Error("The account changed. Download again from the selected account.");
      return repository.put({ id, owner, remoteId, hash: file.hash, name: file.name, blob, page: workspace.view.page,
        workspaceId: file.workspaceId || crypto.randomUUID(), workspace, workspaceBaseSha: file.workspaceSha || null, workspaceDirty: !file.workspaceSha,
        uploaded: true, cloudAvailable: true, cloudChecked: now(), created: now() });
    },
    async page(id, page) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("Invalid page number.");
      return repository.update(id, (record) => ({ ...record, page }));
    },
    async workspace(id, snapshot, { expectedRevision } = {}) {
      let record = await repository.get(id);
      if (!record) throw new Error("The local PDF is missing.");
      if (snapshot === undefined) {
        if (record.workspace && record.workspaceId) { checkedWorkspace(record.workspace, record.hash); return record; }
        return repository.update(id, initialized);
      }
      const workspace = checkedWorkspace(snapshot, record.hash);
      const next = { ...initialized(record), workspace, page: workspace.view.page, workspaceDirty: true };
      try {
        return await repository.put(next, { expectedRevision: expectedRevision ?? record.revision });
      } catch (error) {
        if (error.code !== "LOCAL_CONFLICT") throw error;
        // A stale tab must never replace a later edit. Its complete draft and
        // original PDF remain available as an independent workspace instead.
        error.record = await repository.put(preserved(next, workspace, "preserved tab"));
        throw error;
      }
    },
    async copy(id) {
      const record = await library.workspace(id);
      await room(record.blob.size);
      return repository.put({ ...preserved(record, createWorkspace(record.hash), "new copy"), conflictCopyOf: null });
    },
    async exportWorkspace(id) {
      const record = await library.workspace(id);
      return new Blob([`${JSON.stringify({ version: 1, id: record.workspaceId, pdfHash: record.hash, name: record.name, workspace: record.workspace }, null, 2)}\n`], { type: "application/json" });
    },
    async syncWorkspace(id) {
      const owner = getAccount()?.id;
      let record = await library.workspace(id);
      owned(record, owner);
      if (record.workspaceConflict) return { status: "conflict", record, conflict: record.workspaceConflict };
      if (!record.uploaded) record = await library.upload(id);
      if (!record.workspaceDirty) {
        const remote = await storage.readWorkspace(record);
        owned(record, owner);
        if (remote?.sha === record.workspaceBaseSha) return { status: "synced", record: await repository.get(id) };
        const result = { status: remote ? "synced" : "conflict", remote };
        const saved = await saveSyncResult(id, record, result, owner);
        return saved.workspaceConflict ? { status: "conflict", record: saved, conflict: saved.workspaceConflict } : { status: "synced", record: saved };
      }
      const result = await storage.syncWorkspace(record, { expectedSha: record.workspaceBaseSha });
      const saved = await saveSyncResult(id, record, result, owner);
      return { status: result.status, record: saved, ...(result.status === "conflict" ? { conflict: saved.workspaceConflict } : {}) };
    },
    async resolveWorkspace(id, choice) {
      if (!["local", "remote"].includes(choice)) throw new Error("Choose the device or GitHub workspace.");
      const owner = getAccount()?.id;
      let record = await library.workspace(id);
      owned(record, owner);
      if (!record.workspaceConflict) throw new Error("This workspace has no unresolved sync conflict.");
      const remote = await storage.readWorkspace(record);
      owned(record, owner);
      if ((remote?.sha || null) !== (record.workspaceConflict.remote?.sha || null)) {
        record = await repository.put({ ...record, workspaceConflict: { remote, detectedAt: now() } }, { expectedRevision: record.revision });
        return { status: "conflict", record, conflict: record.workspaceConflict };
      }
      if (choice === "remote") {
        const copy = preserved(record, record.workspace, "device version");
        const next = { ...record, workspace: remote?.workspace || createWorkspace(record.hash),
          workspaceBaseSha: remote?.sha || null, workspaceDirty: !remote, workspaceConflict: null,
          page: remote?.workspace.view.page || 1 };
        const [saved] = await repository.putMany([{ record: next, expectedRevision: record.revision }, { record: copy, expectedRevision: null }]);
        return { status: "synced", record: saved, preserved: copy.id };
      }
      // Preserve the other device's complete editable version before replacing
      // the shared record. This copy can be inspected, exported, or synced later.
      if (remote && !record.workspaceConflict.preservedId) {
        const copy = preserved(record, remote.workspace, "GitHub version");
        const [saved] = await repository.putMany([
          { record: { ...record, workspaceConflict: { ...record.workspaceConflict, preservedId: copy.id } }, expectedRevision: record.revision },
          { record: copy, expectedRevision: null },
        ]);
        record = saved;
      }
      const result = await storage.syncWorkspace(record, { expectedSha: remote?.sha || null });
      const saved = await saveSyncResult(id, record, result, owner);
      return { status: result.status, record: saved, ...(result.status === "conflict" ? { conflict: saved.workspaceConflict } : {}) };
    },
  };
  return library;
}
