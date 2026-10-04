import { createDesignEdition, designEnvelope, readDesignEnvelope, designMarkdown } from './design-edition.js';
import { storageName } from './environment.js';

export function createDesignEditor({ root, sections, defaults, onRender, onMutation, onModeChange }) {
  const key = storageName('megaapp.design.document.v1');
  let saved, raw, loadError, unreadableCopy, editing = false, drag, edition, importGeneration = 0;
  try { raw = localStorage.getItem(key); if (raw) saved = JSON.parse(raw); edition = createDesignEdition(defaults, saved); }
  catch (error) { loadError = error.message; edition = createDesignEdition(defaults); }
  try { unreadableCopy = loadError && raw ? raw : localStorage.getItem(`${key}.unreadable`); } catch { /* Export of the current in-memory edition still works. */ }
  const toggle = document.createElement('button'); toggle.id = 'design-reshape'; toggle.className = 'quiet-button design-reshape'; toggle.type = 'button'; toggle.textContent = 'Reshape this page'; toggle.setAttribute('aria-pressed', 'false');
  const signature = root.querySelector('.design-signature'), right = document.createElement('div'); right.className = 'design-masthead-right'; signature.replaceWith(right); right.append(signature, toggle);
  const editionLabel = document.createElement('span'); editionLabel.className = 'design-edition-label'; editionLabel.textContent = 'My local edition'; right.append(editionLabel);
  const tools = document.createElement('div'); tools.className = 'design-edit-tools'; tools.hidden = true;
  tools.innerHTML = `<div class="design-edit-actions"><button id="design-page-undo" type="button" class="quiet-button">Undo</button><button id="design-page-redo" type="button" class="quiet-button">Redo</button><label>Page shape <select id="design-page-columns"><option value="2">Two columns</option><option value="1">One column</option></select></label><button id="design-page-export" type="button" class="quiet-button">Export for agents</button><button id="design-page-markdown" type="button" class="quiet-button">Export readable guide</button><button id="design-page-import" type="button" class="quiet-button">Import edition</button><input id="design-page-file" type="file" accept=".json,application/json" hidden></div><details class="design-page-versions"><summary>Earlier versions</summary><div id="design-page-history"></div><button id="design-page-reset" type="button" class="quiet-button">Restore published starting point</button></details><p id="design-page-status" role="status"></p><p class="design-edit-explanation">Write directly in the page. Move a principle with its handle or arrows. Your edition saves here; export it to share its wording and arrangement with agents.</p>`;
  root.querySelector('.design-masthead').after(tools);
  if (unreadableCopy) { const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'quiet-button'; recover.textContent = 'Export unreadable save'; recover.onclick = () => download(new Blob([unreadableCopy], { type: 'text/plain' }), 'megaapp-design-unreadable.txt'); tools.querySelector('.design-page-versions').append(recover); }
  const status = tools.querySelector('#design-page-status'), container = root.querySelector('.design-principles');
  const fields = [], controls = new Map();
  function field(read, name, fieldName, id, max) {
    const input = document.createElement('textarea'); input.rows = 1; input.maxLength = max; input.className = `design-page-field design-page-${id ? fieldName === 'title' ? 'heading' : 'wording' : fieldName}`; input.setAttribute('aria-label', name); input.hidden = true;
    read.after(input); fields.push({ input, read, fieldName, id });
    input.oninput = () => { edition.set(fieldName, input.value, id); persist(); render(); onMutation(`Change ${id ? 'principle ' + id : fieldName}`, 'Local design edition updated'); };
    input.onblur = () => edition.endGroup();
  }
  field(root.querySelector('h1'), 'Design title', 'title', null, 300);
  field(root.querySelector('.design-introduction'), 'Design introduction', 'introduction', null, 4000);
  field(root.querySelector('.design-about p'), 'Design page note', 'note', null, 4000);
  for (const [id, section] of sections) {
    field(section.querySelector('h2'), `Heading for ${id} principle`, 'title', id, 300);
    field(section.querySelector(':scope > p'), `Wording for ${id} principle`, 'text', id, 6000);
    const bar = document.createElement('div'); bar.className = 'design-principle-shape'; bar.hidden = true;
    bar.innerHTML = `<button type="button" class="quiet-button design-move-handle" data-direct-input aria-label="Drag to move ${id} principle">⠿</button><button type="button" class="quiet-button design-move-earlier" aria-label="Move ${id} principle earlier">↑</button><button type="button" class="quiet-button design-move-later" aria-label="Move ${id} principle later">↓</button><label><input type="checkbox" class="design-full-width">Full width</label>`;
    section.prepend(bar); controls.set(id, bar);
    bar.querySelector('.design-move-earlier').onclick = () => { const order = edition.content.layout.order, index = order.indexOf(id); if (index > 0) move(id, order[index - 1]); };
    bar.querySelector('.design-move-later').onclick = () => { const order = edition.content.layout.order, index = order.indexOf(id); if (index < order.length - 1) move(id, order[index + 2] || null); };
    bar.querySelector('.design-full-width').onchange = event => { const wide = edition.content.layout.wide.filter(value => value !== id); if (event.target.checked) wide.push(id); edition.layout({ wide }); persist(); render(); onMutation('Change principle width', 'Local layout updated'); };
    const handle = bar.querySelector('.design-move-handle');
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || drag) return;
      event.preventDefault(); edition.endGroup();
      const ghost = document.createElement('div'); ghost.className = 'design-order-ghost'; ghost.textContent = edition.content.principles.find(p => p.id === id).title || 'Move this principle'; document.body.append(ghost);
      drag = { id, pointer: event.pointerId, handle, ghost, before: undefined }; handle.setPointerCapture(event.pointerId); section.dataset.moving = 'true'; updateDrag(event);
    });
    handle.addEventListener('pointermove', event => { if (drag?.pointer === event.pointerId) updateDrag(event); });
    handle.addEventListener('pointerup', event => {
      if (drag?.pointer !== event.pointerId) return;
      const before = drag.before; endDrag(); if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (before !== undefined) move(id, before); handle.focus({ preventScroll: true });
    });
    for (const event of ['pointercancel', 'lostpointercapture']) handle.addEventListener(event, endDrag);
  }
  function endDrag() {
    if (!drag) return; drag.ghost.remove(); delete sections.get(drag.id).dataset.moving;
    for (const section of sections.values()) delete section.dataset.drop;
    drag = null;
  }
  function updateDrag(event) {
    drag.ghost.style.transform = `translate(${Math.max(12, Math.min(innerWidth - drag.ghost.offsetWidth - 12, event.clientX + 16))}px, ${Math.max(8, Math.min(innerHeight - drag.ghost.offsetHeight - 8, event.clientY - 22))}px)`;
    for (const section of sections.values()) delete section.dataset.drop;
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('.design-principle');
    if (!hovered || hovered === sections.get(drag.id) || !container.contains(hovered)) { drag.before = undefined; return; }
    const target = [...sections].find(([, section]) => section === hovered)[0], box = hovered.getBoundingClientRect(), after = event.clientY > box.y + box.height / 2;
    const order = edition.content.layout.order.filter(id => id !== drag.id), index = order.indexOf(target);
    drag.before = after ? order[index + 1] || null : target; hovered.dataset.drop = after ? 'after' : 'before';
    // Only this explicit handle scrolls the page during a drag.
    if (event.clientY < 48) window.scrollBy(0, -12); else if (event.clientY > innerHeight - 48) window.scrollBy(0, 12);
  }
  function move(id, before) { if (!edition.move(id, before)) return; persist(); render(); onMutation('Rearrange design principles', 'Local layout updated'); }
  function persist() {
    try {
      if (loadError && raw) { localStorage.setItem(`${key}.unreadable`, raw); loadError = null; }
      localStorage.setItem(key, JSON.stringify(edition.snapshot())); status.textContent = 'Your edition is saved on this device.';
    } catch { status.textContent = 'Could not save. Export a copy to keep this edition.'; }
  }
  function size(input) { if (input.hidden) return; input.style.height = '0px'; input.style.height = `${Math.max(44, input.scrollHeight + 2)}px`; }
  function render() {
    const content = edition.content;
    root.dataset.editing = String(editing); root.dataset.edition = edition.changed ? 'local' : 'published';
    editionLabel.hidden = !edition.changed;
    const sourceLink = root.querySelector('a[href$="docs/design.md"]'); if (sourceLink) sourceLink.textContent = edition.changed ? 'Published guide' : 'Read source document';
    toggle.textContent = editing ? 'Done reshaping' : 'Reshape this page'; toggle.setAttribute('aria-pressed', String(editing)); tools.hidden = !editing;
    for (const { input, read, fieldName, id } of fields) {
      const value = id ? content.principles.find(p => p.id === id)[fieldName] : content[fieldName];
      read.hidden = editing; input.hidden = !editing;
      if (input.value !== value) input.value = value; size(input);
    }
    for (const [index, id] of content.layout.order.entries()) {
      const section = sections.get(id); if (container.children[index] !== section) container.insertBefore(section, container.children[index] || null);
      section.style.gridColumn = content.layout.wide.includes(id) ? '1 / -1' : 'auto'; section.style.gridRow = 'auto';
      const bar = controls.get(id); bar.hidden = !editing; bar.querySelector('.design-full-width').checked = content.layout.wide.includes(id);
      bar.querySelector('.design-move-earlier').disabled = index === 0; bar.querySelector('.design-move-later').disabled = index === content.layout.order.length - 1;
    }
    container.dataset.columns = String(content.layout.columns);
    tools.querySelector('#design-page-columns').value = String(content.layout.columns);
    tools.querySelector('#design-page-undo').disabled = !edition.canUndo; tools.querySelector('#design-page-redo').disabled = !edition.canRedo;
    tools.querySelector('#design-page-reset').disabled = !edition.changed;
    const history = tools.querySelector('#design-page-history'); history.replaceChildren();
    edition.versions.forEach((version, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = `${version.label} · ${new Date(version.at).toLocaleString()}`;
      button.onclick = () => { edition.restore(index); persist(); render(); tools.querySelector('.design-page-versions summary').focus({ preventScroll: true }); onMutation('Restore design version', 'Earlier edition restored'); }; history.prepend(button);
    });
    if (!edition.versions.length) history.textContent = 'Your earlier versions appear as you reshape the page.';
    onRender(content, editing); scheduleSize();
  }
  toggle.onclick = () => { editing = !editing; edition.endGroup(); endDrag(); onModeChange?.(); render(); if (editing) fields[0].input.focus({ preventScroll: true }); onMutation('Reshape design document', editing ? 'Editing enabled' : 'Reading view restored'); };
  for (const [id, action] of [['design-page-undo', 'undo'], ['design-page-redo', 'redo'], ['design-page-reset', 'reset']]) tools.querySelector(`#${id}`).onclick = () => { edition[action](); persist(); render(); onMutation(action + ' design document', 'Local edition restored'); };
  tools.querySelector('#design-page-columns').onchange = event => { edition.layout({ columns: Number(event.target.value) }); persist(); render(); onMutation('Change design columns', 'Local layout updated'); };
  function download(blob, name) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  tools.querySelector('#design-page-export').onclick = () => { download(new Blob([JSON.stringify(designEnvelope(edition.content), null, 2) + '\n'], { type: 'application/json' }), 'megaapp-design.json'); onMutation('Export design edition', 'Portable agent-readable edition created'); };
  tools.querySelector('#design-page-markdown').onclick = () => download(new Blob([designMarkdown(edition.content)], { type: 'text/markdown' }), 'megaapp-design.md');
  const file = tools.querySelector('#design-page-file'); tools.querySelector('#design-page-import').onclick = () => file.click();
  file.onchange = async () => {
    const chosen = file.files?.[0]; if (!chosen) return; const generation = ++importGeneration;
    try { if (chosen.size > 1024 * 1024) throw new Error('Choose an edition smaller than 1 MB.'); const content = readDesignEnvelope(JSON.parse(await chosen.text())); if (generation !== importGeneration) return; edition.replace(content); persist(); render(); onMutation('Import design edition', 'Edition loaded; previous work retained'); }
    catch (error) { if (generation === importGeneration) status.textContent = `Could not import: ${error.message}`; } finally { if (generation === importGeneration) file.value = ''; }
  };
  let resizeFrame, observedWidth;
  function scheduleSize() { if (resizeFrame) return; resizeFrame = requestAnimationFrame(() => { resizeFrame = null; for (const { input } of fields) size(input); }); }
  const resize = new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width === observedWidth) return; observedWidth = width; scheduleSize(); }); resize.observe(root);
  root.querySelector('.design-about').addEventListener('toggle', scheduleSize);
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && drag) { event.preventDefault(); const { handle, pointer } = drag; endDrag(); if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer); } });
  window.addEventListener('blur', endDrag); document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag(); });
  status.textContent = loadError ? `Your saved edition could not be read: ${loadError}. The saved data will be kept as a backup when you edit.` : edition.sourceChanged ? 'The published starting point changed. Your local edition is retained.' : saved ? 'Your local edition is restored on this device.' : 'Changes save on this device. Export to share them with an agent.';
  render();
  return { get content() { return edition.content; }, hide() { endDrag(); edition.endGroup(); }, get editing() { return editing; } };
}
