import { createFileRepository } from "./file-repository.js";
import { createReadingLibrary, READING_DATABASE } from "./reading-library.js";
import { createReadingGit, parseRepository } from "./reading-git.js";
import { MEGAAPP_ASSET_REPOSITORY, READING_SAMPLE_HASH } from "./reading-config.js";
import { validatePDF, pdfHash } from "./reading-assets.js";
import { storageName } from "./environment.js";
import { createWorkspace, validateWorkspace, addOperation, undoWorkspace, redoWorkspace, renderWorkspaceInk, exportWorkspacePDF } from "./pdf-workspace.js";

const $ = (name) => document.getElementById(`reading-${name}`);
const sizeLabel = (size) => size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const PAGE_GAP = 96;

export function createReading({ notify, stateReady, onRepositorySaved }) {
  const surface = $("surface"), canvas = $("canvas"), ctx = canvas.getContext("2d", { alpha: false });
  const ink = document.createElement("canvas"), inkContext = ink.getContext("2d");
  const dialog = $("document-dialog"), pointers = new Map(), pageCache = new Map();
  let visible = false, library, account = null, remote = [], current, pdf, pdfjs, activeLoading;
  let workspace = null, pages = [], epoch = 0, busy = false, storage, session;
  let stage = { width: 1, height: 1, dpr: 1 }, frame = 0, renderSerial = 0, rendering = null;
  let renderQueue = [], active = null, navigation = null, pinch = null, penActive = false;
  let saveTimer, saveChain = Promise.resolve(), changed = 0, saved = 0, saveFailure = null;
  let textEpoch = 0, resumeId = "", rememberedPen = { color: "#182b49", width: 2 };
  const textCache = new Map(), viewKey = storageName("megaapp-reading-view-v1");
  try { const value = localStorage.getItem(viewKey); if (value && value.length < 600) resumeId = value; } catch { /* Session view. */ }
  let repositoryURL = MEGAAPP_ASSET_REPOSITORY;
  $("repository").value = repositoryURL;
  const status = (message) => { $("status").textContent = message; };
  const badge = (message, state = "saved") => { $("save-state").textContent = message; $("save-state").dataset.state = state; };
  function rememberDocument() {
    resumeId = current?.id || "";
    try { localStorage.setItem(viewKey, resumeId); } catch { /* Session view. */ }
  }
  function disconnect() {
    session = null; storage = null; account = null; remote = [];
    $("key").value = ""; $("connect").textContent = "Connect library";
  }
  const savedRepository = stateReady.then(async (store) => {
    let setting = store.rows().find((row) => row.name === "MEGAAPP_ASSET_REPOSITORY");
    if (!setting) {
      await store.set("MEGAAPP_ASSET_REPOSITORY", "string", MEGAAPP_ASSET_REPOSITORY);
      onRepositorySaved(); setting = { type: "string", value: MEGAAPP_ASSET_REPOSITORY };
    }
    if (setting.type !== "string") throw new Error("MEGAAPP_ASSET_REPOSITORY must be a string repository link.");
    repositoryURL = parseRepository(setting.value).url; $("repository").value = repositoryURL;
  }).catch((error) => { status(error.message); $("setup").open = true; });
  const ready = createFileRepository({ name: storageName(READING_DATABASE) }).then(async (repository) => {
    const proxy = Object.fromEntries(["reserveId", "upload", "list", "download", "readWorkspace", "syncWorkspace"].map((name) => [name, (...args) => {
      if (!storage) throw new Error("Connect your GitHub library first.");
      return storage[name](...args);
    }]));
    library = createReadingLibrary({ repository, storage: proxy, getAccount: () => account });
    if (repository.warning) { badge("Session only", "error"); status(repository.warning); $("cache-warning").hidden = false; $("cache-warning").textContent = repository.warning; }
    let rows = await repository.list();
    for (const record of rows.filter((r) => r.owner && !r.owner.startsWith("github:"))) {
      await repository.update(record.id, ({ driveId: _old, ...local }) => ({ ...local, owner: "", remoteId: "", uploaded: false, cloudAvailable: false }));
    }
    const oldSample = rows.find((r) => r.sample && !r.uploaded && r.hash !== READING_SAMPLE_HASH);
    if (!rows.length || oldSample) {
      try {
        const response = await fetch("./output/pdf/a-place-for-papers.pdf");
        if (!response.ok) throw new Error("Open Reading online once to load the sample PDF.");
        const blob = await validatePDF(await response.blob()), hash = await pdfHash(blob);
        if (hash !== READING_SAMPLE_HASH) throw new Error("The sample update needs the new offline shell. Existing cached papers are available.");
        if (oldSample && !oldSample.workspace?.operations?.length) await repository.update(oldSample.id, (record) => record.uploaded || record.workspace?.operations?.length ? record : { ...record, blob, hash, page: 1, remoteId: "", workspaceId: crypto.randomUUID(), workspace: createWorkspace(hash), workspaceBaseSha: null, workspaceDirty: true, workspaceConflict: null });
        else if (oldSample) await library.import(blob, "A place for papers.pdf", { sample: true });
        else await library.import(blob, "A place for papers.pdf", { sample: true });
      } catch (error) { if (!rows.length) throw error; status(error.message); }
    }
    await renderLibrary();
    return library;
  });
  ready.catch((error) => { status(error.message); badge("Open a PDF to begin", "error"); });

  function controls() {
    const usable = !!pdf && !!workspace && !busy;
    $("upload").disabled = !usable || !account?.writable || (current.owner && current.owner !== account.id);
    $("upload").textContent = current?.workspaceConflict ? "Resolve versions" : "Sync workspace";
    $("refresh").disabled = busy || !account;
    $("import").disabled = busy;
    $("new-copy").disabled = !usable;
    $("download").disabled = !usable;
    $("original").disabled = busy || !current;
    $("workspace-export").disabled = !usable;
    $("connect").disabled = busy || !!session;
    for (const name of ["repository", "key", "save-repository", "disconnect"]) $(name).disabled = busy;
    $("account").textContent = account ? account.email : "GitHub disconnected";
    $("disconnect").hidden = !session; $("key-label").hidden = !!session; $("key").hidden = !!session;
    $("prev").disabled = !usable || workspace.view.page <= 1;
    $("next").disabled = !usable || workspace.view.page >= pages.length;
    $("fit").disabled = !usable;
    $("page-input").disabled = !usable;
    $("zoom-out").disabled = !usable || workspace.view.zoom <= 0.1;
    $("zoom-in").disabled = !usable || workspace.view.zoom >= 8;
    $("undo").disabled = !usable || workspace.cursor === 0;
    $("redo").disabled = !usable || workspace.cursor >= workspace.operations.length;
    $("conflict").hidden = !current?.workspaceConflict;
    $("conflict-local").disabled = busy || !account?.writable;
    $("conflict-remote").disabled = busy || !account;
    for (const button of dialog.querySelectorAll(".reading-paper")) button.disabled = busy;
    for (const kind of ["pen", "highlight", "erase", "move"]) {
      const button = $(`tool-${kind}`); button.disabled = !usable;
      button.setAttribute("aria-pressed", String(workspace?.tool.kind === kind));
    }
    $("tool-options-button").disabled = !usable;
    if (workspace) {
      surface.dataset.tool = workspace.tool.kind;
      $("color").value = workspace.tool.color;
      $("color-swatch").style.backgroundColor = workspace.tool.color;
      $("size").value = String(workspace.tool.width);
      $("size-label").value = String(workspace.tool.width);
      $("finger").checked = workspace.tool.finger;
      $("zoom-label").textContent = `${Math.round(workspace.view.zoom * 100)}%`;
      $("page-input").value = String(workspace.view.page);
      $("page-label").textContent = `Page ${workspace.view.page} of ${pages.length}`;
    }
  }
  async function action(run) {
    if (busy) return;
    finishPointer(); busy = true; controls();
    try { await ready; await run(); }
    catch (error) { status(error.message); notify(error.message); }
    finally { busy = false; controls(); if (changed !== saved && !saveFailure) flushSave(); }
  }
  function openMenu() {
    hideToolOptions(); renderLibrary().catch((error) => status(error.message));
    if (!dialog.open) dialog.showModal();
  }
  function closeMenu() { if (dialog.open) dialog.close(); surface.focus({ preventScroll: true }); }
  $("menu").onclick = openMenu;
  $("menu-close").onclick = closeMenu;
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeMenu();
  });
  function hideToolOptions() { $("tool-options").hidden = true; $("tool-options-button").setAttribute("aria-expanded", "false"); }
  $("tool-options-button").onclick = () => {
    const showing = $("tool-options").hidden;
    $("tool-options").hidden = !showing;
    $("tool-options-button").setAttribute("aria-expanded", String(showing));
  };

  function edited() {
    if (!workspace) return;
    workspace.updatedAt = new Date().toISOString(); changed++; saveFailure = null;
    badge(library?.repository.mode === "memory" ? "Session only" : "Saving here…", library?.repository.mode === "memory" ? "error" : "saving");
    clearTimeout(saveTimer);
    const saveWhenReady = () => { if (busy) saveTimer = setTimeout(saveWhenReady, 250); else flushSave(); };
    saveTimer = setTimeout(saveWhenReady, 250);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveChain = saveChain.then(async () => {
      if (!current || !workspace || changed === saved) return;
      const atEpoch = epoch, record = current, atVersion = changed;
      let snapshot;
      try {
        snapshot = validateWorkspace(workspace, record.hash);
        const result = await library.workspace(record.id, snapshot, { expectedRevision: record.revision });
        if (atEpoch !== epoch || current?.id !== record.id) return;
        current = result; saved = atVersion; saveFailure = null;
        if (changed === saved) badge(library.repository.mode === "memory" ? "Session only" : "Saved here", library.repository.mode === "memory" ? "error" : "saved");
      } catch (error) {
        if (atEpoch !== epoch || current?.id !== record.id) return;
        if (error.record) {
          current = error.record; saved = atVersion; rememberDocument();
          badge("Saved as a separate copy"); status("Another tab changed this workspace. Your complete work was kept as a separate copy.");
          notify("Another tab changed this workspace. Your work was kept as a separate copy.");
          renderLibrary().catch(() => {});
        } else {
          saveFailure = error; badge("Save failed — back up your work", "error"); status(error.message); notify(error.message);
        }
      }
    });
    return saveChain;
  }
  async function requireSaved() { await flushSave(); if (saveFailure) throw saveFailure; }
  function rowButton(record, cloud = false) {
    const button = document.createElement("button"); button.className = "reading-paper";
    button.setAttribute("aria-pressed", String(!cloud && current?.id === record.id)); button.disabled = busy;
    const title = document.createElement("strong"); title.textContent = record.name;
    const detail = document.createElement("span");
    detail.textContent = cloud ? `In GitHub · ${sizeLabel(record.size)} · Open workspace` :
      `${sizeLabel(record.blob.size)} · ${record.workspaceConflict ? "Two saved versions" : record.workspaceDirty ? "Saved here" : record.uploaded ? record.cloudAvailable === false ? "GitHub copy unavailable" : "Synced" : record.sample ? "Sample" : "On this device"}`;
    button.append(title, detail);
    button.onclick = () => action(async () => {
      await requireSaved();
      const savedRecord = cloud ? await library.cache(record) : await library.workspace(record.id);
      await open(savedRecord); await renderLibrary(); closeMenu();
    });
    return button;
  }
  async function renderLibrary() {
    if (!library) return;
    const records = (await library.repository.list()).filter((r) => !r.owner || !account || r.owner === account.id);
    $("local-list").replaceChildren(...records.map((r) => rowButton(r)));
    const uncached = remote.filter((file) => !records.some((r) => r.owner === account?.id && r.hash === file.hash &&
      (file.workspaceId ? r.workspaceId === file.workspaceId : r.remoteId === file.id)));
    $("cloud-list").replaceChildren(...uncached.map((file) => rowButton(file, true)));
    $("cloud-empty").hidden = uncached.length > 0;
    $("cloud-empty").textContent = account ? remote.length ? "All library workspaces are on this device." : "No PDFs here yet. Sync a workspace to add it." : "Connect your private repository to open work from another device.";
    $("count").textContent = `${records.length} ${records.length === 1 ? "workspace" : "workspaces"} ${library.repository.mode === "memory" ? "in this session" : "on this device"}`;
    controls();
  }

  function cancelRendering() {
    renderSerial++; renderQueue = []; rendering?.task?.cancel(); rendering = null;
  }
  function clearPageCache() { cancelRendering(); for (const entry of pageCache.values()) { entry.canvas.width = 0; entry.canvas.height = 0; } pageCache.clear(); }
  async function open(record) {
    if (!record?.blob) throw new Error("This cached PDF is missing.");
    finishPointer(); await requireSaved();
    const request = ++epoch; textEpoch++; textCache.clear(); clearPageCache();
    await activeLoading?.destroy(); activeLoading = null; pdf = null; pages = []; workspace = null;
    current = await library.workspace(record.id); changed = saved = 0; saveFailure = null;
    canvas.dataset.ready = "false";
    $("title").textContent = current.name; $("page-label").textContent = "Opening PDF…"; $("text").textContent = "";
    badge("Opening…"); controls(); invalidate();
    pdfjs ||= await import("../vendor/pdfjs/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
    const loading = pdfjs.getDocument({ data: new Uint8Array(await current.blob.arrayBuffer()),
      standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
      wasmUrl: new URL("../vendor/pdfjs/wasm/", import.meta.url).href,
      isEvalSupported: false, enableXfa: false, maxImageSize: 16000000 });
    activeLoading = loading;
    let passwordRequired = false;
    loading.onPassword = () => { passwordRequired = true; loading.destroy(); };
    let doc;
    try { doc = await loading.promise; }
    catch {
      if (request === epoch) { $("page-label").textContent = "PDF unavailable"; badge("Choose another PDF", "error"); }
      throw new Error(passwordRequired ? "Password-protected PDFs need a decrypted copy." : "This PDF could not be opened. Choose another paper; your existing copies are kept.");
    }
    if (request !== epoch) { await loading.destroy(); return; }
    // Page geometry is cheap; raster canvases are created only near the view.
    const geometry = [];
    for (let offset = 0; offset < doc.numPages; offset += 4) {
      const batch = await Promise.all(Array.from({ length: Math.min(4, doc.numPages - offset) }, async (_, i) => {
        const pageNumber = offset + i + 1, page = await doc.getPage(pageNumber), viewport = page.getViewport({ scale: 1 });
        return { pageNumber, viewport, width: viewport.width, height: viewport.height };
      }));
      if (request !== epoch) return;
      geometry.push(...batch);
    }
    const widest = geometry.reduce((width, page) => Math.max(width, page.width), 0);
    let y = 0;
    pages = geometry.map((page) => { const layout = { ...page, x: (widest - page.width) / 2, y }; y += page.height + PAGE_GAP; return layout; });
    pdf = doc; workspace = current.workspace ? validateWorkspace(current.workspace, current.hash) : createWorkspace(current.hash);
    workspace.view.page = clamp(workspace.view.page, 1, pages.length);
    rememberedPen = workspace.tool.pen || (workspace.tool.kind === "pen" ? { color: workspace.tool.color, width: workspace.tool.width } : { color: "#182b49", width: 2 });
    rememberDocument(); resize();
    if (!workspace.operations.length && workspace.view.x === 0 && workspace.view.y === 0 && workspace.view.zoom === 1) fitPage(workspace.view.page);
    $("page-input").max = String(pages.length); badge(library.repository.mode === "memory" ? "Session only" : "Saved here", library.repository.mode === "memory" ? "error" : "saved");
    if (current.workspaceConflict) status("This workspace has two saved versions. Resolve them before syncing.");
    controls(); invalidate(); if ($("text-details").open) readPageText();
  }
  function local(event) { const r = surface.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function world(point) { const v = workspace.view; return { x: (point.x - v.x) / v.zoom, y: (point.y - v.y) / v.zoom }; }
  function resize() {
    const rect = surface.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
    stage = { width: rect.width, height: rect.height, dpr: Math.min(devicePixelRatio || 1, 2) };
    canvas.width = Math.round(stage.width * stage.dpr); canvas.height = Math.round(stage.height * stage.dpr);
    ink.width = canvas.width; ink.height = canvas.height;
    if (workspace) {
      const v = workspace.view, changedSize = v.viewportWidth !== stage.width || v.viewportHeight !== stage.height;
      if (v.viewportWidth && v.viewportHeight) {
        v.x += (stage.width - v.viewportWidth) / 2;
        v.y += (stage.height - v.viewportHeight) / 2;
      }
      v.viewportWidth = stage.width; v.viewportHeight = stage.height;
      if (changedSize) edited();
    }
    invalidate();
  }
  function invalidate() { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(paint); }
  function visibleLayouts(margin = 0) {
    if (!workspace) return [];
    const v = workspace.view;
    return pages.filter((page) => {
      const x = v.x + page.x * v.zoom, y = v.y + page.y * v.zoom;
      return x < stage.width + margin && x + page.width * v.zoom > -margin && y < stage.height + margin && y + page.height * v.zoom > -margin;
    });
  }
  function updatePagePosition() {
    if (!pages.length || !workspace) return;
    const target = world({ x: stage.width / 2, y: stage.height / 2 });
    const nearest = pages.reduce((best, page) => Math.abs(page.y + page.height / 2 - target.y) < Math.abs(best.y + best.height / 2 - target.y) ? page : best, pages[0]);
    if (workspace.view.page !== nearest.pageNumber) { workspace.view.page = nearest.pageNumber; controls(); if ($("text-details").open) readPageText(); }
  }
  function paint() {
    frame = 0;
    if (!visible || document.hidden) return;
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    ctx.fillStyle = getComputedStyle($("surface").parentElement).getPropertyValue("--reading-desk").trim() || "#e7ebed";
    ctx.fillRect(0, 0, stage.width, stage.height);
    if (!workspace || !pdf) return;
    const v = workspace.view;
    ctx.save(); ctx.translate(v.x, v.y); ctx.scale(v.zoom, v.zoom);
    for (const page of visibleLayouts(30)) {
      ctx.fillStyle = "#fff"; ctx.fillRect(page.x, page.y, page.width, page.height);
      const entry = pageCache.get(page.pageNumber);
      if (entry?.ready) ctx.drawImage(entry.canvas, page.x, page.y, page.width, page.height);
      ctx.strokeStyle = "#8e9ca6"; ctx.lineWidth = 1 / v.zoom; ctx.strokeRect(page.x, page.y, page.width, page.height);
      ctx.fillStyle = "#75848e"; ctx.font = `${11 / v.zoom}px -apple-system, sans-serif`;
      ctx.fillText(String(page.pageNumber), page.x, page.y + page.height + 19 / v.zoom);
    }
    ctx.restore();
    inkContext.setTransform(1, 0, 0, 1, 0, 0); inkContext.clearRect(0, 0, ink.width, ink.height);
    const shown = active ? { ...workspace, operations: [...workspace.operations.slice(0, workspace.cursor), active], cursor: workspace.cursor + 1 } : workspace;
    renderWorkspaceInk(inkContext, shown, { offsetX: v.x / v.zoom, offsetY: v.y / v.zoom, scale: v.zoom * stage.dpr });
    ctx.drawImage(ink, 0, 0, stage.width, stage.height);
    updatePagePosition(); preparePages();
    canvas.dataset.ready = "true"; canvas.dataset.operations = String(workspace.cursor); canvas.dataset.pages = String(pages.length);
  }
  function preparePages() {
    if (!pdf || !workspace) return;
    const v = workspace.view;
    let pixels = 0;
    const wanted = visibleLayouts(Math.max(stage.height, stage.width) / 2).sort((a, b) =>
      Math.abs(v.y + (a.y + a.height / 2) * v.zoom - stage.height / 2) - Math.abs(v.y + (b.y + b.height / 2) * v.zoom - stage.height / 2)).slice(0, 8).filter((page) => {
        const scale = Math.min(3, Math.max(0.5, v.zoom * stage.dpr), Math.sqrt(8000000 / (page.width * page.height)));
        const count = page.width * page.height * scale * scale;
        if (pixels && pixels + count > 24000000) return false;
        pixels += count; return true;
      });
    const keep = new Set(wanted.map((page) => page.pageNumber));
    for (const [number, entry] of pageCache) {
      if (!keep.has(number) && rendering?.pageNumber !== number) { entry.canvas.width = 0; entry.canvas.height = 0; pageCache.delete(number); }
    }
    renderQueue = wanted.filter((page) => {
      const entry = pageCache.get(page.pageNumber);
      const desired = Math.min(3, Math.max(0.5, v.zoom * stage.dpr), Math.sqrt(8000000 / (page.width * page.height)));
      return !entry || (!entry.failed && Math.abs(Math.log(desired / entry.scale)) > 0.45);
    });
    if (rendering && !keep.has(rendering.pageNumber)) { rendering.task?.cancel(); rendering = null; renderSerial++; }
    if (!rendering && renderQueue.length) renderNext();
  }
  async function renderNext() {
    const layout = renderQueue.shift(); if (!layout || !pdf || !workspace || !visible || document.hidden) return;
    const atEpoch = epoch, doc = pdf, serial = ++renderSerial;
    const marker = { pageNumber: layout.pageNumber, task: null }; rendering = marker;
    const target = document.createElement("canvas");
    try {
      const source = await doc.getPage(layout.pageNumber);
      if (atEpoch !== epoch || serial !== renderSerial || !visible) return;
      const scale = Math.min(3, Math.max(0.5, workspace.view.zoom * stage.dpr), Math.sqrt(8000000 / (layout.width * layout.height)));
      const viewport = source.getViewport({ scale }); target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      marker.task = source.render({ canvasContext: target.getContext("2d"), viewport, background: "white" });
      await marker.task.promise;
      if (atEpoch !== epoch || serial !== renderSerial || !visible) { target.width = 0; target.height = 0; return; }
      const previous = pageCache.get(layout.pageNumber); if (previous) { previous.canvas.width = 0; previous.canvas.height = 0; }
      pageCache.set(layout.pageNumber, { canvas: target, scale, ready: true });
    } catch (error) {
      target.width = 0; target.height = 0;
      if (error.name !== "RenderingCancelledException" && atEpoch === epoch) { pageCache.set(layout.pageNumber, { canvas: target, scale: 1, ready: false, failed: true }); status(`Page ${layout.pageNumber} could not render: ${error.message}`); notify(`Page ${layout.pageNumber} could not render.`); }
    } finally {
      if (rendering === marker) rendering = null;
      if (atEpoch === epoch && serial === renderSerial) invalidate();
    }
  }

  function setView(x, y, zoom = workspace.view.zoom) {
    const v = workspace.view;
    v.x = clamp(x, -10000000, 10000000); v.y = clamp(y, -10000000, 10000000); v.zoom = clamp(zoom, 0.1, 8);
    edited(); controls(); invalidate();
  }
  function zoomAt(factor, anchor = { x: stage.width / 2, y: stage.height / 2 }) {
    if (!workspace) return;
    const point = world(anchor), zoom = clamp(workspace.view.zoom * factor, 0.1, 8);
    setView(anchor.x - point.x * zoom, anchor.y - point.y * zoom, zoom);
  }
  function fitPage(number = workspace?.view.page) {
    const page = pages[number - 1]; if (!page || !workspace) return;
    const zoom = clamp(Math.min((stage.width - 70) / page.width, (stage.height - 160) / page.height), 0.1, 2);
    workspace.view.page = page.pageNumber;
    setView(stage.width / 2 - (page.x + page.width / 2) * zoom, 78 - page.y * zoom, zoom);
  }
  function movePage(number) { if (Number.isInteger(number) && number >= 1 && number <= pages.length) { fitPage(number); closeMenu(); } }
  function chooseTool(kind) {
    if (!workspace || busy) return;
    finishPointer();
    if (workspace.tool.kind === "pen") rememberedPen = { color: workspace.tool.color, width: workspace.tool.width };
    workspace.tool.pen = { ...rememberedPen };
    if (kind === "pen") Object.assign(workspace.tool, rememberedPen);
    else if (kind === "highlight") Object.assign(workspace.tool, { color: "#edc739", width: 20 });
    else if (kind === "erase") workspace.tool.width = 18;
    workspace.tool.kind = kind; edited(); controls(); invalidate();
  }
  for (const kind of ["pen", "highlight", "erase", "move"]) $(`tool-${kind}`).onclick = () => chooseTool(kind);
  $("color").oninput = (event) => { if (workspace) { workspace.tool.color = event.target.value; if (workspace.tool.kind === "pen") workspace.tool.pen = { color: workspace.tool.color, width: workspace.tool.width }; edited(); controls(); } };
  $("size").oninput = (event) => { if (workspace) { workspace.tool.width = Number(event.target.value); if (workspace.tool.kind === "pen") workspace.tool.pen = { color: workspace.tool.color, width: workspace.tool.width }; edited(); controls(); } };
  $("finger").onchange = (event) => { if (workspace) { workspace.tool.finger = event.target.checked; edited(); controls(); } };
  $("undo").onclick = () => { if (workspace && !busy) { finishPointer(); undoWorkspace(workspace); edited(); controls(); invalidate(); } };
  $("redo").onclick = () => { if (workspace && !busy) { finishPointer(); redoWorkspace(workspace); edited(); controls(); invalidate(); } };
  function finishPointer(commit = true) {
    if (active && workspace && commit) {
      try { addOperation(workspace, active); edited(); }
      catch (error) { status(error.message); notify(error.message); }
    }
    active = null; navigation = null; pinch = null; penActive = false;
    for (const id of pointers.keys()) if (surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id);
    pointers.clear(); surface.dataset.moving = "false"; controls(); invalidate();
  }
  function beginPinch() {
    const touches = [...pointers.values()].filter((p) => p.type === "touch"); if (touches.length < 2) return;
    if (active?.pointerType === "touch") active = null;
    navigation = null;
    const [a, b] = touches, center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: workspace.view.zoom, world: world(center) };
    surface.dataset.moving = "true"; invalidate();
  }
  surface.addEventListener("pointerdown", (event) => {
    if (!pdf || !workspace || busy || dialog.open || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.pointerType === "touch" && penActive) return;
    if (active && event.pointerType !== "touch") finishPointer();
    hideToolOptions(); surface.focus({ preventScroll: true });
    const point = local(event); pointers.set(event.pointerId, { ...point, type: event.pointerType }); surface.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch" && [...pointers.values()].filter((p) => p.type === "touch").length > 1) { beginPinch(); return; }
    const panning = workspace.tool.kind === "move" || (event.pointerType === "touch" && !workspace.tool.finger) || event.altKey;
    if (panning) { navigation = { id: event.pointerId, point, x: workspace.view.x, y: workspace.view.y }; surface.dataset.moving = "true"; return; }
    if (event.pointerType === "pen") {
      penActive = true; navigation = null; pinch = null;
      for (const [id, p] of pointers) if (p.type === "touch") { pointers.delete(id); if (surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id); }
    }
    active = { id: crypto.randomUUID(), pointerId: event.pointerId, pointerType: event.pointerType,
      kind: workspace.tool.kind, color: workspace.tool.color, width: workspace.tool.width, points: [world(point)] };
    invalidate();
  });
  surface.addEventListener("pointermove", (event) => {
    if (!workspace || !pointers.has(event.pointerId)) return;
    const point = local(event); pointers.set(event.pointerId, { ...point, type: event.pointerType });
    if (pinch) {
      const touches = [...pointers.values()].filter((p) => p.type === "touch");
      if (touches.length >= 2) {
        const [a, b] = touches, zoom = clamp(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance), 0.1, 8);
        setView((a.x + b.x) / 2 - pinch.world.x * zoom, (a.y + b.y) / 2 - pinch.world.y * zoom, zoom);
      }
      return;
    }
    if (navigation?.id === event.pointerId) { setView(navigation.x + point.x - navigation.point.x, navigation.y + point.y - navigation.point.y); return; }
    if (active?.pointerId !== event.pointerId) return;
    const coalesced = event.getCoalescedEvents?.(), samples = coalesced?.length ? coalesced : [event];
    for (const sample of samples) {
      const p = world(local(sample)), last = active.points.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.25 && active.points.length < 100000) active.points.push(p);
    }
    invalidate();
  });
  function pointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    if (active?.pointerId === event.pointerId) {
      if (event.type === "pointerup") {
        const p = world(local(event)), last = active.points.at(-1);
        if (Math.hypot(p.x - last.x, p.y - last.y) > 0.01) active.points.push(p);
      }
      const mark = active; active = null;
      try { addOperation(workspace, mark); edited(); } catch (error) { status(error.message); notify(error.message); }
    }
    pointers.delete(event.pointerId);
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (event.pointerType === "pen") penActive = false;
    if (navigation?.id === event.pointerId) navigation = null;
    if ([...pointers.values()].filter((p) => p.type === "touch").length < 2) {
      pinch = null;
      const remaining = [...pointers.entries()].find(([, p]) => p.type === "touch");
      if (remaining) navigation = { id: remaining[0], point: remaining[1], x: workspace.view.x, y: workspace.view.y };
    }
    surface.dataset.moving = String(!!navigation || !!pinch); controls(); invalidate();
  }
  surface.addEventListener("pointerup", pointerEnd);
  surface.addEventListener("pointercancel", pointerEnd);
  surface.addEventListener("lostpointercapture", pointerEnd);
  surface.addEventListener("wheel", (event) => {
    if (!workspace || busy || dialog.open) return;
    event.preventDefault(); finishPointer();
    if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.004), local(event));
    else setView(workspace.view.x - event.deltaX, workspace.view.y - event.deltaY);
  }, { passive: false });
  surface.addEventListener("keydown", (event) => {
    if (!workspace || busy || event.target !== surface) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); event.shiftKey ? $("redo").click() : $("undo").click(); }
    else if ((event.ctrlKey || event.metaKey) && key === "s") { event.preventDefault(); flushSave(); }
    else if (key === "+" || key === "=") { event.preventDefault(); zoomAt(1.2); }
    else if (key === "-") { event.preventDefault(); zoomAt(1 / 1.2); }
    else if (key === "0") { event.preventDefault(); fitPage(); }
    else if (["p", "h", "e", "v"].includes(key) && !event.metaKey && !event.ctrlKey) chooseTool({ p: "pen", h: "highlight", e: "erase", v: "move" }[key]);
    else if (event.key === "Escape") { finishPointer(); hideToolOptions(); }
    else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault(); const d = event.shiftKey ? 200 : 60;
      setView(workspace.view.x + (event.key === "ArrowLeft" ? d : event.key === "ArrowRight" ? -d : 0), workspace.view.y + (event.key === "ArrowUp" ? d : event.key === "ArrowDown" ? -d : 0));
    }
  });

  $("prev").onclick = () => movePage(workspace.view.page - 1);
  $("next").onclick = () => movePage(workspace.view.page + 1);
  $("page-form").onsubmit = (event) => { event.preventDefault(); movePage(Number($("page-input").value)); };
  $("fit").onclick = () => { fitPage(); closeMenu(); };
  $("zoom-out").onclick = () => zoomAt(1 / 1.25);
  $("zoom-in").onclick = () => zoomAt(1.25);
  $("import").onclick = () => $("file").click();
  $("file").onchange = () => {
    const file = $("file").files[0]; $("file").value = ""; if (!file) return;
    action(async () => {
      await requireSaved(); const record = await library.import(file, file.name); await open(record); await renderLibrary(); closeMenu();
      status(library.repository.mode === "memory" ? "Session only. Export your PDF and workspace before closing." : "Work saves on this device. Sync workspace when you want it on another device.");
    });
  };
  $("new-copy").onclick = () => action(async () => { await requireSaved(); await open(await library.copy(current.id)); await renderLibrary(); closeMenu(); status("A fresh working copy. Your previous work is kept in the library."); });
  function applySynced(result) {
    current = result.record; workspace = validateWorkspace(current.workspace, current.hash); changed = saved = 0; rememberDocument();
    rememberedPen = workspace.tool.pen || (workspace.tool.kind === "pen" ? { color: workspace.tool.color, width: workspace.tool.width } : { color: "#182b49", width: 2 });
    resize(); controls(); invalidate();
    if (result.status === "conflict") { status("Another device saved different work. Choose which version to continue; both will be kept."); openMenu(); }
    else { status("Workspace synced. On your other device, refresh the library or sync its existing copy."); badge("Synced"); }
  }
  $("upload").onclick = () => action(async () => {
    await requireSaved(); status("Syncing the PDF and workspace…");
    const result = await library.syncWorkspace(current.id); remote = await library.refresh();
    // Adopt the remote view only after refresh has established its durable revision.
    result.record = await library.workspace(result.record.id); applySynced(result); await renderLibrary();
  });
  for (const choice of ["local", "remote"]) $(`conflict-${choice}`).onclick = () => action(async () => {
    await requireSaved(); status("Keeping both versions…"); applySynced(await library.resolveWorkspace(current.id, choice)); await renderLibrary();
  });
  $("refresh").onclick = () => action(async () => {
    await requireSaved(); status("Refreshing the library…"); remote = await library.refresh();
    if (current) current = await library.workspace(current.id);
    await renderLibrary(); status("Library refreshed. Choose a workspace to open it here.");
  });
  $("save-repository").onclick = () => action(async () => {
    const value = parseRepository($("repository").value).url, store = await stateReady;
    await store.set("MEGAAPP_ASSET_REPOSITORY", "string", value); onRepositorySaved();
    repositoryURL = value; $("repository").value = value; disconnect(); await renderLibrary();
    status("Repository location saved in State. Paste its key to connect on this device.");
  });
  $("connect").onclick = () => {
    if (busy) return;
    const key = $("key").value.trim(); $("key").value = "";
    return action(async () => {
      await requireSaved(); await savedRepository;
      const value = parseRepository($("repository").value).url;
      if (!/^github_pat_[a-zA-Z0-9_]{20,250}$/.test(key)) throw new Error("Paste a fine-grained GitHub key for this repository. The repository link alone does not grant access.");
      disconnect();
      const connected = { key, expires: Date.now() + 60 * 60 * 1000 }; session = connected;
      storage = createReadingGit({ repository: value, getToken: () => session === connected && Date.now() < connected.expires ? connected.key : "" });
      try {
        status("Checking the private library…"); account = await storage.account();
        const store = await stateReady;
        await store.set("MEGAAPP_ASSET_REPOSITORY", "string", value); onRepositorySaved(); repositoryURL = value;
        remote = await library.refresh(); if (current) current = await library.workspace(current.id);
      } catch (error) { disconnect(); await renderLibrary(); throw error; }
      await renderLibrary(); $("connect").textContent = "Connected";
      status(account.writable ? "Connected. Sync a workspace or open work from your library." : "Connected for reading. Sync needs Contents read/write access.");
    });
  };
  $("repository").oninput = () => { disconnect(); renderLibrary().catch((error) => status(error.message)); };
  $("disconnect").onclick = () => { disconnect(); renderLibrary().catch((error) => status(error.message)); status("Disconnected. Your key was forgotten; cached PDFs and workspaces remain here."); };
  setInterval(() => {
    if (session && Date.now() >= session.expires) { disconnect(); renderLibrary().catch((error) => status(error.message)); status("Connection expired after one hour. Paste your key to reconnect; local work remains available."); }
  }, 30000);
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("download").onclick = () => action(async () => {
    await requireSaved(); status("Preparing the marked PDF…");
    download(await exportWorkspacePDF(pdf, workspace, pages), current.name.replace(/\.pdf$/i, "") + " marked.pdf");
    status("Marked PDF exported. Surrounding scratch work stays in the workspace."); notify("Marked PDF exported.");
  });
  $("original").onclick = () => { if (current && !busy) download(current.blob, current.name); };
  $("workspace-export").onclick = () => action(async () => {
    // Backup must still work after a local save failure.
    await flushSave();
    const envelope = { version: 1, id: current.workspaceId, pdfHash: current.hash, name: current.name, workspace: validateWorkspace(workspace, current.hash) };
    download(new Blob([JSON.stringify(envelope, null, 2) + "\n"], { type: "application/json" }), current.name.replace(/\.pdf$/i, "") + " workspace.json");
    status("Workspace backup exported. Keep it with the original PDF.");
  });
  async function readPageText() {
    if (!pdf || !workspace || !$("text-details").open) return;
    const atEpoch = epoch, serial = ++textEpoch, pageNumber = workspace.view.page, doc = pdf;
    $("text").textContent = "Reading page text…";
    try {
      if (!textCache.has(pageNumber)) textCache.set(pageNumber, doc.getPage(pageNumber).then((page) => page.getTextContent()).then((text) => text.items.map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`).join("")));
      const text = await textCache.get(pageNumber);
      if (atEpoch === epoch && serial === textEpoch) $("text").textContent = text.trim() || "This page has no selectable text.";
    } catch { if (atEpoch === epoch && serial === textEpoch) $("text").textContent = "Text could not be extracted from this page."; }
  }
  $("text-details").addEventListener("toggle", readPageText);
  new ResizeObserver(resize).observe(surface);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { finishPointer(); flushSave(); cancelRendering(); }
    else if (visible) { resize(); invalidate(); }
  });
  window.addEventListener("pagehide", () => { finishPointer(); flushSave(); });
  window.addEventListener("offline", () => status("Offline. Your workspace saves here; sync needs a connection."));
  controls();
  return {
    setVisible(value) {
      visible = value;
      if (!value) { finishPointer(); flushSave(); cancelRendering(); closeMenu(); hideToolOptions(); return; }
      ready.then(async () => {
        await savedRepository;
        if (!busy) {
          try {
            const setting = (await stateReady).rows().find((row) => row.name === "MEGAAPP_ASSET_REPOSITORY");
            if (setting && setting.type !== "string") throw new Error("MEGAAPP_ASSET_REPOSITORY must be a string repository link.");
            const next = parseRepository(setting?.value ?? MEGAAPP_ASSET_REPOSITORY).url;
            if (next !== repositoryURL) { disconnect(); repositoryURL = next; $("repository").value = next; await renderLibrary(); }
          } catch (error) { disconnect(); await renderLibrary(); status(error.message); $("setup").open = true; }
        }
        if (!visible) return;
        if (!current) {
          const rows = await library.repository.list(), record = rows.find((r) => r.id === resumeId) || rows.find((r) => r.sample) || rows[0];
          if (record) await open(record); else { $("title").textContent = "Open PDF"; openMenu(); }
        } else { resize(); invalidate(); }
      }).catch((error) => { status(error.message); notify(error.message); });
    },
  };
}
