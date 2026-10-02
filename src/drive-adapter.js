// Main-workspace boundary: only same-origin broker requests. This adapter never
// receives a Google token, a Picker key, or a resumable upload URL. Picker tokens
// are used only in the broker's separate, uncached bridge page.
import { fingerprintBlob } from "./file-fingerprint.js";
export class DriveAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DriveAdapterError";
    this.code = code;
    if (details.remote) this.remote = details.remote;
    if (details.preservedCopy) this.preservedCopy = details.preservedCopy;
  }
}

export function createGoogleDriveAdapter({ fetch: transport = globalThis.fetch, basePath = "/api/drive", onProgress = () => {}, isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(basePath) || basePath.startsWith("//"))
    throw new Error("The Drive broker must use a path on this origin.");
  let csrf;
  async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
    if (method !== "GET" && !csrf) await session();
    let response;
    try {
      response = await transport(`${basePath}${path}`, {
        method, credentials: "same-origin", cache: "no-store", redirect: "error", signal,
        headers: { ...headers, ...(method === "GET" ? {} : { "X-MegaApp-CSRF": csrf }) }, body,
      });
    } catch {
      if (signal?.aborted) throw new DriveAdapterError("ABORTED", "The file selection was cancelled.");
      throw new DriveAdapterError("UNAVAILABLE", "Drive could not be reached. Your local draft is safe; try Save again.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) csrf = undefined;
      throw new DriveAdapterError(data.code || "UNAVAILABLE", data.message || "Drive could not finish this request. Your local draft is safe.", data);
    }
    return response;
  }
  const json = async (path, options) => (await request(path, options)).json();
  const post = (path, value) => json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  async function session() {
    const value = await json("/session");
    csrf = value.csrf;
    return value;
  }
  async function upload({ sourceId, expectedVersion, name, mimeType, blob, operationId }) {
    if (!(blob instanceof Blob) || !operationId) throw new Error("A file and stable save operation ID are required.");
    const descriptor = { sourceId, expectedVersion, name, mimeType: mimeType || blob.type || "application/octet-stream", size: blob.size, operationId,
      contentFingerprint: await fingerprintBlob(blob) };
    let failures = 0, noProgress = 0;
    let state = await post("/uploads", descriptor);
    if (state.metadata) return state.metadata;
    do {
      const end = Math.min(state.offset + state.chunkSize, blob.size);
      try {
        const previousOffset = state.offset;
        const next = await json(`/uploads/${encodeURIComponent(state.uploadId)}?offset=${state.offset}`, {
          method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: blob.slice(state.offset, end),
        });
        state = { ...state, ...next };
        onProgress({ uploaded: state.offset, total: blob.size });
        if (state.metadata) return state.metadata;
        if (!Number.isSafeInteger(state.offset) || state.offset < 0 || state.offset > blob.size || (state.offset <= previousOffset && ++noProgress > 2))
          throw new DriveAdapterError("UNAVAILABLE", "The upload paused. Your local draft is safe; try Save again.");
      } catch (error) {
        if (error.code !== "UNAVAILABLE" || ++failures > 2) throw error;
        // A lost response can mean the chunk completed. Ask the broker/Drive
        // for the acknowledged position instead of guessing or creating again.
        state = await post("/uploads", descriptor);
        if (state.metadata) return state.metadata;
      }
    } while (state.offset <= blob.size);
    throw new DriveAdapterError("UNAVAILABLE", "The upload is still pending. Your local draft is safe; try Save again.");
  }
  const validNonce = (nonce) => typeof nonce === "string" && /^[A-Za-z0-9_-]{16,200}$/.test(nonce);
  function requireNonce(nonce) {
    if (!validNonce(nonce)) throw new DriveAdapterError("INVALID", "The file chooser session is invalid. Try opening it again.");
  }
  function safePickerResult(value) {
    if (value?.state === "pending" || value?.state === "cancelled") return { state: value.state };
    if (value?.state === "failed") return { state: "failed", message: "The file chooser could not finish. Your open file is unchanged; try again." };
    const files = value?.files;
    if (value?.state !== "picked" || !Array.isArray(files) || files.length !== 1 || !files[0] ||
      typeof files[0].id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(files[0].id) || typeof files[0].name !== "string" || files[0].name.length > 1000 ||
      typeof files[0].mimeType !== "string" || /^application\/vnd\.google-apps\./.test(files[0].mimeType) ||
      !(typeof files[0].size === "number" || (typeof files[0].size === "string" && /^\d+$/.test(files[0].size))) ||
      !Number.isSafeInteger(Number(files[0].size)) || Number(files[0].size) < 0 || Number(files[0].size) > 512 * 1024 * 1024)
      throw new DriveAdapterError("INVALID", "The file chooser returned an invalid selection. Your open file is unchanged; try again.");
    const file = files[0];
    return { state: "picked", files: [{ id: file.id, name: file.name, mimeType: file.mimeType, size: Number(file.size) }] };
  }
  return {
    kind: "google-drive", writeStrategy: "successor-copy", get online() { return Boolean(isOnline()); },
    session,
    connect: () => post("/auth/start", {}),
    async startPicker() {
      const value = await post("/picker/start", {});
      requireNonce(value.nonce);
      const expected = `${basePath}/picker?nonce=${encodeURIComponent(value.nonce)}`;
      if (value.bridgeUrl !== expected) throw new DriveAdapterError("INVALID", "The file chooser returned an unexpected address.");
      return { nonce: value.nonce, bridgeUrl: expected };
    },
    async pickerResult(nonce, { signal } = {}) {
      requireNonce(nonce); return safePickerResult(await json(`/picker/result?nonce=${encodeURIComponent(nonce)}`, { signal }));
    },
    async cancelPicker(nonce) { requireNonce(nonce); await post("/picker/cancel", { nonce }); return { state: "cancelled" }; },
    async disconnect() { await post("/disconnect", {}); csrf = undefined; },
    list: () => json("/files"),
    metadata: (id) => json(`/files/${encodeURIComponent(id)}`),
    recoverOperation: (operationId) => json(`/operations/${encodeURIComponent(operationId)}`),
    async download(id) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = await this.metadata(id);
        const response = await request(`/files/${encodeURIComponent(id)}/content`);
        const blob = await response.blob();
        const after = await this.metadata(id);
        if (before.version === after.version && blob.size === Number(after.size)) return { metadata: after, blob };
        if (attempt) throw new DriveAdapterError("CONFLICT", "The Drive copy changed while opening. Refresh to try again; your existing local files are safe.", { remote: after });
      }
    },
    create: (value) => upload(value),
    save: (id, value) => upload({ ...value, sourceId: id }),
  };
}
