// Plain, portable homework state. Coordinates are displayed PDF points at scale 1.
const KINDS = new Set(["pen", "highlight", "erase"]);
const finite = (value, limit = 10000000) => Number.isFinite(value) && Math.abs(value) <= limit;
const color = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export function createWorkspace(pdfHash) {
  return { version: 1, pdfHash, operations: [], cursor: 0,
    view: { x: 0, y: 0, zoom: 1, page: 1 },
    tool: { kind: "pen", color: "#182b49", width: 2, finger: false },
    updatedAt: new Date().toISOString() };
}
export function validateWorkspace(value, pdfHash) {
  const bad = () => { throw new Error("This editable workspace is invalid; existing work was kept."); };
  if (!value || value.version !== 1 || !/^[0-9a-f]{64}$/.test(value.pdfHash || "") ||
      (pdfHash && value.pdfHash !== pdfHash) || !Array.isArray(value.operations) ||
      value.operations.length > 30000 || !Number.isInteger(value.cursor) ||
      value.cursor < 0 || value.cursor > value.operations.length) bad();
  let points = 0;
  const ids = new Set();
  const operations = value.operations.map((op) => {
    if (!op || !KINDS.has(op.kind) || typeof op.id !== "string" || !op.id || op.id.length > 100 ||
        ids.has(op.id) || !color(op.color) || !finite(op.width, 200) || op.width <= 0 ||
        !Array.isArray(op.points) || !op.points.length) bad();
    ids.add(op.id); points += op.points.length;
    if (points > 1000000) bad();
    return { id: op.id, kind: op.kind, color: op.color, width: op.width,
      points: op.points.map((point) => {
        if (!point || !finite(point.x) || !finite(point.y)) bad();
        return { x: point.x, y: point.y };
      }) };
  });
  const { view, tool } = value;
  if (!view || !finite(view.x) || !finite(view.y) || !finite(view.zoom, 8) || view.zoom < 0.1 ||
      !Number.isInteger(view.page) || view.page < 1 || !tool ||
      (!KINDS.has(tool.kind) && tool.kind !== "move") || !color(tool.color) ||
      !finite(tool.width, 200) || tool.width <= 0 || typeof tool.finger !== "boolean" ||
      typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) bad();
  const hasSize = view.viewportWidth !== undefined || view.viewportHeight !== undefined;
  if (hasSize && (!finite(view.viewportWidth, 100000) || view.viewportWidth <= 0 ||
      !finite(view.viewportHeight, 100000) || view.viewportHeight <= 0)) bad();
  if (tool.pen && (!color(tool.pen.color) || !finite(tool.pen.width, 200) || tool.pen.width <= 0)) bad();
  return { version: 1, pdfHash: value.pdfHash, operations, cursor: value.cursor,
    view: { x: view.x, y: view.y, zoom: view.zoom, page: view.page,
      ...(hasSize ? { viewportWidth: view.viewportWidth, viewportHeight: view.viewportHeight } : {}) },
    tool: { kind: tool.kind, color: tool.color, width: tool.width, finger: tool.finger,
      ...(tool.pen ? { pen: { color: tool.pen.color, width: tool.pen.width } } : {}) },
    updatedAt: value.updatedAt };
}
export function addOperation(workspace, operation) {
  const op = { ...operation, id: operation.id || crypto.randomUUID() };
  // Validate the complete prospective history before changing any saved work.
  const operations = [...workspace.operations.slice(0, workspace.cursor), op];
  const next = validateWorkspace({ ...workspace, operations, cursor: operations.length,
    updatedAt: new Date().toISOString() });
  workspace.operations = next.operations; workspace.cursor = next.cursor;
  workspace.updatedAt = next.updatedAt;
  return workspace;
}
export function undoWorkspace(workspace) {
  if (workspace.cursor) { workspace.cursor--; workspace.updatedAt = new Date().toISOString(); }
  return workspace;
}
export function redoWorkspace(workspace) {
  if (workspace.cursor < workspace.operations.length) { workspace.cursor++; workspace.updatedAt = new Date().toISOString(); }
  return workspace;
}
export function operationBounds(op) {
  const radius = op.width / 2;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of op.points) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  return { left: left - radius, top: top - radius, right: right + radius, bottom: bottom + radius };
}
export function renderWorkspaceInk(ctx, workspace, { offsetX = 0, offsetY = 0, scale = 1 } = {}) {
  ctx.save(); ctx.scale(scale, scale); ctx.translate(offsetX, offsetY);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const op of workspace.operations.slice(0, workspace.cursor)) {
    ctx.globalCompositeOperation = op.kind === "erase" ? "destination-out" : "source-over";
    ctx.globalAlpha = op.kind === "highlight" ? 0.28 : 1;
    ctx.strokeStyle = ctx.fillStyle = op.color; ctx.lineWidth = op.width;
    const first = op.points[0]; ctx.beginPath();
    if (op.points.length === 1) { ctx.arc(first.x, first.y, op.width / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.moveTo(first.x, first.y); for (const p of op.points.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); }
  }
  ctx.restore();
}

// Add only transparent ink appearances, leaving original text/vectors untouched.
// Using the same replay renderer makes partial erasure match the screen exactly.
export async function exportWorkspacePDF(pdf, workspace, pages) {
  validateWorkspace(workspace);
  if (!workspace.cursor) return new Blob([await pdf.getData()], { type: "application/pdf" });
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function")
    throw new Error("This browser cannot export the ink layer. Your editable work is saved; export from a current iPad or browser.");
  const keys = [], bitmaps = [];
  try {
    for (const [index, layout] of pages.entries()) {
      const active = workspace.operations.slice(0, workspace.cursor).filter((op) => {
        const b = operationBounds(op);
        return b.right >= layout.x && b.left <= layout.x + layout.width && b.bottom >= layout.y && b.top <= layout.y + layout.height;
      });
      if (!active.some((op) => op.kind !== "erase")) continue;
      const scale = Math.min(3, Math.sqrt(8000000 / (layout.width * layout.height)));
      const canvas = new OffscreenCanvas(Math.ceil(layout.width * scale), Math.ceil(layout.height * scale));
      const ctx = canvas.getContext("2d");
      renderWorkspaceInk(ctx, { ...workspace, operations: active, cursor: active.length }, { offsetX: -layout.x, offsetY: -layout.y, scale });
      // Skip fully erased pages instead of adding invisible PDF objects.
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hasInk = false; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { hasInk = true; break; }
      if (!hasInk) continue;
      const bitmap = await createImageBitmap(canvas); bitmaps.push(bitmap);
      const pageNumber = layout.pageNumber || index + 1;
      const source = await pdf.getPage(pageNumber);
      const key = `pdfjs_internal_editor_megaapp_${pageNumber}`;
      keys.push(key);
      pdf.annotationStorage.setValue(key, { annotationType: 13, pageIndex: pageNumber - 1,
        bitmapId: key, bitmap, rect: source.view.slice(), rotation: source.rotate,
        isSvg: false, accessibilityData: { type: "Figure", alt: "Homework handwriting and highlights" } });
    }
    const bytes = keys.length ? await pdf.saveDocument() : await pdf.getData();
    return new Blob([bytes], { type: "application/pdf" });
  } finally {
    for (const key of keys) pdf.annotationStorage.remove(key);
    for (const bitmap of bitmaps) bitmap.close();
  }
}
