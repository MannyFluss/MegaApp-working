// A versioned file identity, computed without reading the whole Blob at once.
// It binds retry IDs to bytes; it is not an authorization token or an upload URL.
export const FILE_FINGERPRINT_CHUNK_SIZE = 8 * 1024 * 1024;
export async function fingerprintBlob(blob, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!subtle || !Number.isSafeInteger(blob?.size) || blob.size < 0 || typeof blob.slice !== "function") {
    const error = new Error("This browser could not check the file before uploading. Your local draft is safe.");
    error.code = "FINGERPRINT_UNAVAILABLE"; throw error;
  }
  const initial = new TextEncoder().encode(`MegaApp file fingerprint sha256-chain-v1\n${blob.size}`);
  let digest = new Uint8Array(await subtle.digest("SHA-256", initial));
  for (let offset = 0, index = 0; offset < blob.size; offset += FILE_FINGERPRINT_CHUNK_SIZE, index++) {
    const part = blob.slice(offset, Math.min(offset + FILE_FINGERPRINT_CHUNK_SIZE, blob.size));
    const chunkHash = new Uint8Array(await subtle.digest("SHA-256", await part.arrayBuffer()));
    const frame = new Uint8Array(80), view = new DataView(frame.buffer);
    frame.set(digest, 0); frame.set(chunkHash, 32);
    view.setBigUint64(64, BigInt(index)); view.setBigUint64(72, BigInt(part.size));
    digest = new Uint8Array(await subtle.digest("SHA-256", frame));
  }
  return `sha256-chain-v1:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
