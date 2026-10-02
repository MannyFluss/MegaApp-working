const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
async function crc32(blob) {
  let crc = 0xffffffff;
  // Bound memory while exporting large originals. ZIP output reuses Blobs.
  for (let offset = 0; offset < blob.size; offset += 65536) {
    const chunk = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
    for (const b of chunk) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size) {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  return { bytes, u16: (p, n) => view.setUint16(p, n, true), u32: (p, n) => view.setUint32(p, n, true) };
}
export function safeFilename(name) {
  return String(name).replace(/[\\/\u0000-\u001f:*?"<>|]/g, "_").slice(0, 180) || "untitled";
}
export async function createPortableZip(entries) {
  if (entries.length > 65535) throw new Error("Export fewer than 65,536 versions at a time.");
  const parts = [], central = []; let offset = 0;
  for (const { name, blob } of entries) {
    if (offset + blob.size > 0xffffffff) throw new Error("Export this collection in smaller parts (below 4 GB).");
    const filename = encoder.encode(name), crc = await crc32(blob);
    const local = header(30); local.u32(0, 0x04034b50); local.u16(4, 20); local.u16(6, 0x800);
    local.u32(14, crc); local.u32(18, blob.size); local.u32(22, blob.size); local.u16(26, filename.length);
    parts.push(local.bytes, filename, blob);
    const c = header(46); c.u32(0, 0x02014b50); c.u16(4, 20); c.u16(6, 20); c.u16(8, 0x800);
    c.u32(16, crc); c.u32(20, blob.size); c.u32(24, blob.size); c.u16(28, filename.length); c.u32(42, offset);
    central.push(c.bytes, filename); offset += 30 + filename.length + blob.size;
  }
  const size = central.reduce((sum, value) => sum + value.length, 0), end = header(22);
  if (offset + size + 22 > 0xffffffff) throw new Error("Export this collection in smaller parts (below 4 GB).");
  end.u32(0, 0x06054b50); end.u16(8, entries.length); end.u16(10, entries.length); end.u32(12, size); end.u32(16, offset);
  return new Blob([...parts, ...central, end.bytes], { type: "application/zip" });
}
export async function exportFileRecord(record) {
  const entries = [], versions = [];
  function add(blob, name, kind, version) {
    if (!blob) return;
    const path = `${String(entries.length + 1).padStart(3, "0")}-${kind}/${safeFilename(name)}`;
    entries.push({ name: path, blob }); versions.push({ path, kind, name, size: blob.size, version: version ?? null });
  }
  add(record.blob, record.name, "current-draft", record.remote?.version);
  if (record.operation?.blob && record.operation.contentRevision !== record.contentRevision)
    add(record.operation.blob, record.operation.name, "pending-save", record.operation.baseVersion);
  for (const item of record.history) add(item.blob, item.name, item.kind, item.version);
  add(record.conflict?.blob, record.conflict?.metadata?.name || record.name, "drive-conflict", record.conflict?.metadata?.version);
  // Explicit allowlist: never serialize repository, adapter, sessions, or credentials.
  const manifest = { format: "megaapp-file-export", schemaVersion: 1, name: record.name, mimeType: record.mimeType, status: record.status, exportedAt: new Date().toISOString(), versions };
  entries.push({ name: "manifest.json", blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) });
  return { blob: await createPortableZip(entries), name: `${safeFilename(record.name)}.megaapp.zip` };
}
