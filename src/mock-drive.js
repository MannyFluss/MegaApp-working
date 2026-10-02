// A simulation, stored separately from local drafts. Never calls Google.
export function createMockDriveAdapter(repository, { online = true } = {}) {
  let failure = false;
  const metadata = ({ id, name, mimeType, blob, version, operationId }) => ({ id, name, mimeType, size: blob.size, version, operationId });
  function available(mutation = false) {
    if (!online) { const e = new Error("You are offline. The local draft is safe."); e.code = "OFFLINE"; throw e; }
    if (failure && mutation) { failure = false; const e = new Error("The simulated upload was interrupted. Try Save again."); e.code = "UNAVAILABLE"; throw e; }
  }
  const adapter = {
    kind: "simulation", get online() { return online; },
    setOnline(value) { online = Boolean(value); },
    failNext() { failure = true; },
    async list() { available(); return (await repository.listRemote()).map(metadata); },
    async recoverOperation(operationId) {
      available();
      const row = (await repository.listRemote()).find((value) => value.operationId === operationId);
      return row ? metadata(row) : null;
    },
    async metadata(id) {
      available(); const row = await repository.getRemote(id);
      if (!row) { const e = new Error("The Drive copy could not be found. Your local draft is kept."); e.code = "NOT_FOUND"; throw e; }
      return metadata(row);
    },
    async download(id) {
      available(); const row = await repository.getRemote(id);
      if (!row) { const e = new Error("The Drive copy could not be found."); e.code = "NOT_FOUND"; throw e; }
      return { metadata: metadata(row), blob: row.blob };
    },
    async create({ name, mimeType, blob, operationId }) {
      available(true);
      const id = `sim-${operationId}`;
      const existing = await repository.getRemote(id);
      if (existing) return metadata(existing);
      const row = { id, name, mimeType, blob, version: "1", operationId };
      try { return metadata(await repository.putRemote(row)); }
      catch (e) { if (e.code === "CONFLICT") return metadata(await repository.getRemote(id)); throw e; }
    },
    async save(id, { name, mimeType, blob, expectedVersion, operationId }) {
      available(true); const current = await repository.getRemote(id);
      if (!current) { const e = new Error("The Drive copy could not be found."); e.code = "NOT_FOUND"; throw e; }
      if (current.operationId === operationId) return metadata(current);
      if (current.version !== expectedVersion) { const e = new Error("The Drive copy changed since you opened it."); e.code = "CONFLICT"; e.remote = metadata(current); throw e; }
      return metadata(await repository.putRemote({ id, name, mimeType, blob, version: String(Number(current.version) + 1), operationId }, expectedVersion));
    },
    async externalEdit(id, blob) {
      // This is a different simulated device: its edits can arrive while this
      // device is offline. It never touches the local cache or drafts.
      const current = await repository.getRemote(id);
      if (!current) throw new Error("Save a file to simulated Drive first.");
      return metadata(await repository.putRemote({ ...current, blob, version: String(Number(current.version) + 1), operationId: `external-${crypto.randomUUID()}` }, current.version));
    },
  };
  return adapter;
}
