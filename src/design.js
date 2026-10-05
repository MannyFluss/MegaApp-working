import { createDesignMarkup } from "./design-markup.js";
import { createContextToy } from "./context-toy.js";
import { designContent } from "./design-content.js";
import { createPhysicalSurface } from "./input.js";
import { createBoundaryExample } from "./design-boundaries.js";
import { createDesignEditor } from "./design-editor.js";
import { storageName } from "./environment.js";
import { applyReadingStyle } from "./reading-style.js";

export function createDesign({ input, onSettings, notify, onMoment = () => {}, onFeedback = () => {} }) {
  let editor, emphasis = false;
  const root = document.getElementById("design-guide");
  root.innerHTML = `<header class="design-masthead"><div><h1></h1><p class="design-introduction"></p></div><div class="design-signature">MegaApp<br><span>Manny’s design</span></div></header><div class="design-principles"></div><footer class="design-footnote"><details class="design-about"><summary>About this page</summary><p></p></details><details class="design-dictionary"><summary>Dictionary</summary><div class="design-term-links" aria-label="Dictionary terms"></div></details></footer>`;
  root.querySelector("h1").textContent = designContent.title;
  root.querySelector(".design-introduction").textContent = designContent.introduction;
  root.querySelector(".design-about p").textContent = designContent.note;
  root.querySelector(".design-footnote").prepend(root.parentElement.querySelector(".design-reading-actions"));
  const sections = new Map();
  for (const principle of designContent.principles) {
    const section = document.createElement("section");
    section.className = `design-principle design-${principle.id}`; section.dataset.principle = principle.id;
    const title = document.createElement("h2"), text = document.createElement("p");
    title.textContent = principle.title; text.textContent = principle.text;
    section.append(title, text); sections.set(principle.id, section);
    text.dataset.readingText = '';
    root.querySelector(".design-principles").append(section);
  }
  for (const node of root.querySelectorAll('.design-introduction, .design-about p')) node.dataset.readingText = '';
  const feedback = document.createElement('button'); feedback.id = 'design-feedback'; feedback.type = 'button'; feedback.className = 'quiet-button design-feedback'; feedback.textContent = 'Give feedback';
  feedback.onclick = () => { record('Give design feedback', 'Keeping a moment for my explanation'); onFeedback(); };
  sections.get('context').append(feedback);
  const demo = document.createElement("div");
  demo.innerHTML = `<div id="design-touch-board" class="design-touch-board"><span class="design-touch-instruction">Move this with your hand.</span><button id="design-touch-object" class="design-touch-object" data-direct-input type="button" aria-label="Move the surface. Drag, or use arrow keys. Enter resets its position."><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 18h18M15 24h18M15 30h18"/></svg><span>Follow me</span></button></div><details class="design-input-settings"><summary>Tune the shared response</summary><div class="design-tuning"><label for="design-response"><button type="button" class="design-help-term" data-term="Response" aria-haspopup="dialog">Response</button><output id="design-response-value"></output></label><input id="design-response" type="range" min="0" max="1.5" step="0.05" value="0.8"><label for="design-settling"><button type="button" class="design-help-term" data-term="Settling" aria-haspopup="dialog">Settling</button><output id="design-settling-value"></output></label><input id="design-settling" type="range" min="120" max="500" step="10" value="280"><button id="design-input-reset" class="quiet-button" type="button">Restore defaults</button><span id="design-input-status" role="status">Hold a term to understand it. Try a slow drag, then a quick release.</span></div></details>`;
  sections.get("touch").append(demo);
  const surface = createPhysicalSurface(root.querySelector("#design-touch-object"), root.querySelector("#design-touch-board"), input, () => record("Surface position", "Recorded position", "frame"));
  const response = root.querySelector("#design-response"), settling = root.querySelector("#design-settling");
  let saveChain = Promise.resolve(), generation = 0;
  function controls() {
    root.querySelector("#design-response-value").textContent = `${Math.round(input.response * 100)}%`;
    root.querySelector("#design-settling-value").textContent = `${input.settling} ms`;
  }
  function preview() {
    input.configure({ "system.input.response": { value: Number(response.value) }, "system.input.settling": { value: Number(settling.value) } });
    controls();
    record("Tune shared response", "Preview updated");
  }
  function save() {
    const values = { response: Number(response.value), settling: Number(settling.value) }, current = ++generation;
    root.querySelector("#design-input-status").textContent = "Saving response…";
    saveChain = saveChain.catch(() => {}).then(async () => {
      try {
        await onSettings(values);
        if (current === generation) root.querySelector("#design-input-status").textContent = "Response saved on this device.";
      } catch (error) {
        if (current === generation) root.querySelector("#design-input-status").textContent = "Could not save. Try adjusting again.";
        notify(`Response could not be saved: ${error.message}`);
      }
    });
  }
  for (const control of [response, settling]) { control.addEventListener("input", preview); control.addEventListener("change", save); }
  root.querySelector("#design-input-reset").onclick = () => { response.value = "0.8"; settling.value = "280"; preview(); surface.reset(); save(); };

  const scope = document.createElement("div");
  scope.className = "design-scope-example";
  scope.innerHTML = `<div id="design-scope-text" class="design-scope-text" tabindex="0" aria-label="Choose your text boundary. Drag across words, tap the first and last word, or use Shift and arrow keys."></div><p class="design-scope-hint">Drag across words, or tap a beginning and an end.</p><div class="design-scope-actions"><button id="design-edit-selection" class="quiet-button" type="button" disabled>Edit my selection</button><details class="design-boundary-controls"><summary>Adjust boundary</summary><div><label>From word <input id="design-boundary-start" type="number" min="1" value="1"></label><label>Through word <input id="design-boundary-end" type="number" min="1" value="1"></label></div></details><details class="design-material"><summary>Use my own text</summary><label for="design-material-text">Working material</label><textarea id="design-material-text" rows="3" maxlength="10000"></textarea><button id="design-material-apply" class="quiet-button" type="button">Use this text</button></details></div><p id="design-scope-status" role="status">You define the boundary. Nothing changes until you apply an edit.</p><div id="design-active-edits" class="design-active-edits"></div><button id="design-example-undo" class="design-example-reset quiet-button" type="button" hidden>Undo last change</button><button id="design-example-reset" class="design-example-reset quiet-button" type="button">Restore original example</button><p id="design-work-save" class="design-scope-hint" role="status"></p>`;
  sections.get("scope").append(scope);
  const original = "I learn by making things, asking questions, and returning to what matters.";
  const workKey = storageName("megaapp.design.example.v1");
  let saved;
  try { saved = JSON.parse(localStorage.getItem(workKey)); } catch { /* Corrupt/unavailable saves leave the original intact. */ }
  let example = createBoundaryExample(original, saved), anchor = null, dragging = false, keyboardWord = 0, touchTap = null, selectionSave, lastRenderedWords;
  const text = scope.querySelector("#design-scope-text"), status = scope.querySelector("#design-scope-status"), editButton = scope.querySelector("#design-edit-selection");
  function persist() {
    try { localStorage.setItem(workKey, JSON.stringify({ ...example.snapshot(), materialDraft: scope.querySelector("#design-material-text").value })); scope.querySelector("#design-work-save").textContent = "Your material and unfinished edits stay on this device."; }
    catch { scope.querySelector("#design-work-save").textContent = "Could not save this example. Keep this page open to retain it."; }
  }
  function paintBoundary() {
    const { selection, edits, collision } = example;
    for (const span of text.querySelectorAll("[data-word]")) {
      const index = Number(span.dataset.word), active = edits.find(e => index >= e.start && index < e.end), selected = selection && index >= selection.start && index < selection.end;
      span.className = [active ? "scope-occupied" : "", selected ? "scope-selected" : "", selected && active ? "scope-collision" : "", active && index === active.start ? "scope-start" : "", active && index === active.end - 1 ? "scope-end" : ""].filter(Boolean).join(" ");
      span.dataset.edit = active?.label || "";
    }
    scope.dataset.activeCount = String(edits.length); scope.dataset.collision = String(collision);
    editButton.disabled = !selection;
    editButton.textContent = collision ? "Check overlapping selection" : "Edit my selection";
    const start = scope.querySelector("#design-boundary-start"), end = scope.querySelector("#design-boundary-end");
    start.max = end.max = String(example.words.length);
    if (selection) { start.value = String(selection.start + 1); end.value = String(selection.end); }
    scope.querySelector("#design-example-undo").hidden = !example.canUndo;
    scope.querySelector("#design-material-apply").disabled = Boolean(edits.length);
    scope.querySelector("#design-example-reset").hidden = !edits.length && example.words.join(" ") === original && !selection;
  }
  function renderWords() {
    text.replaceChildren();
    example.words.forEach((word, index) => { const span = document.createElement("span"); span.dataset.word = String(index); span.textContent = word + (index === example.words.length - 1 ? "" : " "); text.append(span); });
    const material = scope.querySelector("#design-material-text"), value = example.words.join(" ");
    if (lastRenderedWords === undefined || material.value === lastRenderedWords) material.value = value;
    lastRenderedWords = value;
    paintBoundary();
  }
  function renderEdits() {
    const list = scope.querySelector("#design-active-edits"); list.replaceChildren();
    for (const edit of example.edits) {
      const row = document.createElement("div"); row.className = "design-active-edit";
      const label = document.createElement("label"); label.textContent = `${edit.label} · “${example.words.slice(edit.start, edit.end).join(" ")}”`;
      const draft = document.createElement("textarea"); draft.rows = 2; draft.maxLength = 10000; draft.value = edit.replacement; draft.setAttribute("aria-label", `Replacement for ${edit.label.toLowerCase()}`);
      draft.oninput = () => { example.draft(edit.id, draft.value); persist(); };
      label.append(draft);
      const finish = document.createElement("button"); finish.type = "button"; finish.className = "quiet-button"; finish.textContent = "Apply"; finish.setAttribute("aria-label", `Apply ${edit.label.toLowerCase()}`);
      finish.onclick = () => {
        if (!example.apply(edit.id)) { status.textContent = "Keep between 1 and 300 words in the working material."; return; }
        anchor = null; renderWords(); renderEdits(); persist(); text.focus({ preventScroll: true }); status.textContent = "Your selected text changed. Other boundaries kept their material.";
        record(`Apply ${edit.label.toLowerCase()}`, "Text changed");
      };
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "quiet-button"; cancel.textContent = "Cancel"; cancel.setAttribute("aria-label", `Cancel ${edit.label.toLowerCase()}`);
      cancel.onclick = () => { example.cancel(edit.id); paintBoundary(); renderEdits(); persist(); text.focus({ preventScroll: true }); status.textContent = "Edit cancelled. Your text is unchanged."; record(`Cancel ${edit.label.toLowerCase()}`, "Text kept"); };
      row.append(label, finish, cancel); list.append(row);
    }
  }
  function choose(start, end, announce = true) {
    if (!example.select(start, end)) return;
    paintBoundary(); clearTimeout(selectionSave); if (announce) persist(); else selectionSave = setTimeout(persist, 120);
    status.textContent = example.collision ? "Your selection crosses an active edit. The striped seam shows the overlap; finish or cancel that edit first." : `Your boundary: “${example.words.slice(example.selection.start, example.selection.end).join(" ")}”. You can reshape it before editing.`;
    if (announce) record("Define my boundary", "Selection changed");
  }
  const wordAt = event => Number(event.target.closest?.("[data-word]")?.dataset.word ?? -1);
  // Mouse drag is confined to the material. Touch retains native scrolling and
  // selection; two taps offer a direct alternative to the system's text handles.
  text.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse") {
      if (wordAt(event) >= 0) touchTap = { id: event.pointerId, index: wordAt(event), x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0 || wordAt(event) < 0) return;
    event.preventDefault(); anchor = wordAt(event); dragging = true; text.setPointerCapture(event.pointerId); choose(anchor, anchor + 1);
  });
  text.addEventListener("pointermove", event => {
    if (touchTap && Math.hypot(event.clientX - touchTap.x, event.clientY - touchTap.y) > 10) touchTap = null;
    if (!dragging) return;
    const span = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-word]");
    if (span && text.contains(span)) { const end = Number(span.dataset.word); choose(Math.min(anchor, end), Math.max(anchor, end) + 1, false); }
  });
  text.addEventListener("pointerup", event => {
    if (touchTap?.id === event.pointerId) {
      const index = touchTap.index, native = getSelection(); touchTap = null;
      if (!native || native.isCollapsed || !text.contains(native.anchorNode)) {
        if (anchor === null) { anchor = index; choose(index, index + 1); }
        else { choose(Math.min(anchor, index), Math.max(anchor, index) + 1); anchor = null; }
      }
    }
    if (!dragging) return;
    dragging = false; anchor = null; clearTimeout(selectionSave); persist();
    if (text.hasPointerCapture(event.pointerId)) text.releasePointerCapture(event.pointerId);
    record("Define my boundary", "Selection changed");
  });
  const cancelDrag = () => { dragging = false; anchor = null; touchTap = null; };
  text.addEventListener("pointercancel", cancelDrag);
  text.addEventListener("lostpointercapture", () => { if (dragging) cancelDrag(); });
  document.addEventListener("selectionchange", () => {
    const selected = getSelection(); if (dragging || selected?.isCollapsed || !selected?.rangeCount || !text.contains(selected.anchorNode) || !text.contains(selected.focusNode)) return;
    const range = selected.getRangeAt(0), spans = [...text.querySelectorAll("[data-word]")].filter(span => range.intersectsNode(span));
    if (spans.length) choose(Number(spans[0].dataset.word), Number(spans.at(-1).dataset.word) + 1, false);
  });
  text.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); editButton.click(); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); if (!event.shiftKey || anchor === null) anchor = keyboardWord;
    keyboardWord = Math.max(0, Math.min(example.words.length - 1, event.key === "Home" ? 0 : event.key === "End" ? example.words.length - 1 : keyboardWord + (event.key === "ArrowRight" ? 1 : -1)));
    choose(event.shiftKey ? Math.min(anchor, keyboardWord) : keyboardWord, (event.shiftKey ? Math.max(anchor, keyboardWord) : keyboardWord) + 1);
  });
  for (const id of ["design-boundary-start", "design-boundary-end"]) scope.querySelector(`#${id}`).oninput = () => { const start = Number(scope.querySelector("#design-boundary-start").value), end = Number(scope.querySelector("#design-boundary-end").value); if (start >= 1 && end >= start) choose(start - 1, end); };
  editButton.onclick = () => {
    const result = example.begin(); paintBoundary(); renderEdits(); persist();
    status.textContent = result.edit ? "This boundary is reserved. Write its replacement, then apply or cancel. You can select another region." : "These regions overlap. Finish or cancel the existing edit before starting here.";
    record("Begin my edit", result.outcome);
    if (result.edit) scope.querySelector(".design-active-edit:last-child textarea").focus({ preventScroll: true });
  };
  scope.querySelector("#design-material-apply").onclick = () => {
    if (!example.replace(scope.querySelector("#design-material-text").value)) { status.textContent = "Use 1–300 words, and finish or cancel existing edits first."; return; }
    anchor = null; renderWords(); persist(); scope.querySelector(".design-material").open = false; status.textContent = "Your material is ready. Define the part you want to change."; record("Use my own text", "Working material changed");
  };
  scope.querySelector("#design-example-undo").onclick = () => {
    if (!example.undo()) return;
    anchor = null; renderWords(); renderEdits(); persist(); status.textContent = "Restored the material and boundaries from before your last change."; record("Undo text change", "Previous work restored");
  };
  scope.querySelector("#design-example-reset").onclick = () => { example.reset(original); anchor = null; renderWords(); renderEdits(); persist(); status.textContent = "Original example restored. You define the next boundary."; record("Reset text example", "Original text restored"); };
  renderWords(); renderEdits();
  scope.querySelector("#design-material-text").oninput = persist;
  if (typeof saved?.materialDraft === "string" && saved.materialDraft.length <= 10000) { scope.querySelector("#design-material-text").value = saved.materialDraft; if (saved.materialDraft !== example.words.join(" ")) scope.querySelector(".design-material").open = true; }
  if (saved) scope.querySelector("#design-work-save").textContent = "Your working material restored on this device.";

  const dialog = document.createElement("dialog"); dialog.className = "design-term-dialog"; dialog.id = "design-term-dialog"; dialog.setAttribute("aria-labelledby", "design-term-title");
  dialog.innerHTML = `<div class="design-term-heading"><h2 id="design-term-title"></h2><button class="quiet-button" type="button">Close</button></div><p id="design-term-definition" data-reading-text></p><p class="design-term-note">Working vocabulary. The full dictionary is a separate decision.</p>`;
  document.body.append(dialog);
  let priorTerm;
  dialog.addEventListener("close", () => { if (priorTerm?.isConnected && !priorTerm.closest("[hidden], [inert]")) priorTerm.focus({ preventScroll: true }); });
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { const box = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close(); });
  function explain(term, trigger) {
    if (dialog.open) return;
    priorTerm = trigger; dialog.querySelector("h2").textContent = term;
    dialog.querySelector("#design-term-definition").textContent = (editor?.content || designContent).terms[term]; applyReadingStyle(dialog, emphasis); dialog.showModal();
    record(`Understand ${term}`, "Definition shown in context");
  }
  const termCancellations = new Set(), termCleanup = new WeakMap();
  let proseContact, proseTimer, proseTarget;
  function cancelProseTerm() { proseContact = proseTarget = null; clearTimeout(proseTimer); proseTimer = null; }
  termCancellations.add(cancelProseTerm);
  const proseTerm = target => target.closest?.('.design-vocabulary');
  // Keep native selection/callouts in charge during contact. A brief release
  // grace period lets a repeated click become word/paragraph selection before
  // a modal explanation can take focus.
  document.addEventListener('pointerdown', cancelProseTerm, true);
  root.addEventListener('pointerdown', event => {
    const element = proseTerm(event.target);
    if (!element || event.defaultPrevented || !event.isPrimary || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    proseContact = { element, id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
  });
  document.addEventListener('pointermove', event => {
    if (proseContact?.id === event.pointerId && Math.hypot(event.clientX - proseContact.x, event.clientY - proseContact.y) > 10) cancelProseTerm();
  });
  document.addEventListener('pointerup', event => {
    if (proseContact?.id !== event.pointerId) return;
    const contact = proseContact; proseContact = null;
    if (event.defaultPrevented || event.button !== 0 || proseTerm(event.target) !== contact.element || performance.now() - contact.started > 350 || Math.hypot(event.clientX - contact.x, event.clientY - contact.y) > 10 || !getSelection()?.isCollapsed) return;
    proseTarget = contact.element;
    proseTimer = setTimeout(() => {
      proseTimer = proseTarget = null;
      if (contact.element.isConnected && !contact.element.closest('[hidden], [inert]') && getSelection()?.isCollapsed) explain(contact.element.dataset.term, contact.element);
    }, 350);
  });
  for (const name of ['pointercancel', 'contextmenu']) document.addEventListener(name, cancelProseTerm, true);
  // Touch's implicit capture is normally released after a successful pointerup.
  document.addEventListener('lostpointercapture', event => { if (proseContact?.id === event.pointerId) cancelProseTerm(); }, true);
  document.addEventListener('scroll', cancelProseTerm, { capture: true, passive: true });
  document.addEventListener('wheel', cancelProseTerm, { passive: true });
  document.addEventListener('selectionchange', () => { if (!getSelection()?.isCollapsed) cancelProseTerm(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelProseTerm(); });
  window.addEventListener('blur', cancelProseTerm);
  window.addEventListener('hashchange', cancelProseTerm);
  root.addEventListener('click', event => {
    const element = proseTerm(event.target);
    if (!element) return;
    if (event.detail > 1) cancelProseTerm();
    // Accessibility activation need not deliver a pointer sequence.
    if (event.detail === 0 && !event.pointerType) { cancelProseTerm(); explain(element.dataset.term, element); }
  });
  root.addEventListener('focusout', event => {
    const target = proseContact?.element || proseTarget;
    if (target && event.relatedTarget !== target && !target.contains(event.relatedTarget)) cancelProseTerm();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancelProseTerm();
    const element = proseTerm(event.target);
    if (!element || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); cancelProseTerm(); if (!event.repeat) explain(element.dataset.term, element);
  });
  function bindTerm(element, term) {
    element.setAttribute("aria-haspopup", "dialog");
    let timer, point, held = false;
    const cancel = () => { clearTimeout(timer); timer = null; }; termCancellations.add(cancel); termCleanup.set(element, () => { cancel(); termCancellations.delete(cancel); });
    element.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary) return;
      cancel();
      held = false; point = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { held = true; explain(term, element); }, 500);
    });
    element.addEventListener("pointermove", event => { if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 10) cancel(); });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) element.addEventListener(event, cancel);
    element.addEventListener("contextmenu", event => event.preventDefault());
    element.addEventListener("click", event => { event.preventDefault(); cancel(); if (!held || event.detail === 0) explain(term, element); held = false; });
  }
  function vocabulary(paragraph, value, terms, editing = false) {
    for (const link of paragraph.querySelectorAll("[data-term]")) termCleanup.get(link)?.();
    paragraph.replaceChildren();
    if (editing) { paragraph.textContent = value; return; }
    const names = Object.keys(terms).sort((a,b) => b.length - a.length), escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b(${names.map(escape).join("|")})\\b`, "gi"); let position = 0, match;
    while ((match = pattern.exec(value))) {
      paragraph.append(document.createTextNode(value.slice(position, match.index)));
      const term = names.find(t => t.toLowerCase() === match[0].toLowerCase()), link = document.createElement("span");
      link.className = "design-vocabulary"; link.textContent = match[0]; link.dataset.term = term;
      link.tabIndex = 0; link.setAttribute('role', 'button'); link.setAttribute('aria-haspopup', 'dialog'); link.setAttribute('aria-label', `Understand ${term}`);
      paragraph.append(link); position = pattern.lastIndex;
    }
    paragraph.append(document.createTextNode(value.slice(position)));
  }
  for (const button of root.querySelectorAll("[data-term]")) bindTerm(button, button.dataset.term);
  function renderReading() { root.dataset.selection = 'browser'; applyReadingStyle(root, emphasis); }
  const contextToy = createContextToy({ onAction: (action, outcome) => record(action, outcome) });
  root.querySelector('.design-footnote').before(contextToy.element);
  const markup = createDesignMarkup({ root, onStart: contextToy.interrupt, onAction: (action, outcome) => record(action, outcome) });
  let renderedTerms, selectedExplanation;
  editor = createDesignEditor({ root, sections, defaults: designContent,
    onModeChange() { termCancellations.forEach(cancel => cancel()); if (dialog.open) dialog.close(); selectedExplanation?.remove(); },
    onRender(content, editing) {
      cancelProseTerm();
      root.querySelector("h1").textContent = content.title;
      root.querySelector(".design-introduction").textContent = content.introduction;
      root.querySelector(".design-about p").textContent = content.note;
      for (const principle of content.principles) { const section = sections.get(principle.id); vocabulary(section.querySelector('h2'), principle.title, content.terms, editing); vocabulary(section.querySelector(":scope > p"), principle.text, content.terms, editing); }
      if (renderedTerms !== JSON.stringify(content.terms)) {
        const links = root.querySelector(".design-term-links"); for (const link of links.children) termCleanup.get(link)?.(); links.replaceChildren();
        for (const [term] of Object.entries(content.terms)) { const button = document.createElement("button"); button.className = "design-term-link"; button.type = "button"; button.textContent = term; bindTerm(button, term); links.append(button); }
        renderedTerms = JSON.stringify(content.terms);
      }
      contextToy.update(content); renderReading(); markup.refresh();
    },
    onMutation: (action, outcome, interaction) => record(action, outcome, 'action', interaction),
  });
  document.addEventListener("selectionchange", () => {
    const selected = getSelection(), term = Object.keys(editor?.content.terms || designContent.terms).find(t => t.toLowerCase() === selected?.toString().trim().toLowerCase());
    selectedExplanation?.remove(); selectedExplanation = null;
    if (!term || selected?.isCollapsed) return;
    const parent = selected.anchorNode?.parentElement?.closest(".design-principle");
    if (!parent || !root.contains(parent) || text.contains(selected.anchorNode)) return;
    const button = document.createElement("button"); button.type = "button"; button.className = "quiet-button design-selected-help"; button.textContent = `About ${term}`;
    button.onpointerdown = event => event.preventDefault();
    button.onclick = () => explain(term, button); parent.append(button); selectedExplanation = button;
  });
  function captureContext() {
    const board = root.querySelector("#design-touch-board"), tile = root.querySelector("#design-touch-object"), position = new DOMMatrix(getComputedStyle(tile).transform);
    return { app: "design", coverage: "Design document edition, example frames, text boundaries, context Toy, page markup, outcomes and shared tuning", title: editor ? editor.content.title : designContent.title, designDocument: editor?.content,
      surface: { x: position.m41 / Math.max(1, board.clientWidth), y: position.m42 / Math.max(1, board.clientHeight), dragging: tile.dataset.dragging === "true" },
      words: example.words, edits: example.edits.map(({ start, end, label }) => ({ start, end, label })),
      selection: example.selection, collision: example.collision,
      message: scope.querySelector("#design-scope-status").textContent, response: input.response, settling: input.settling,
      presentation: { theme: document.documentElement.dataset.theme || 'light', viewport: { width: innerWidth, height: innerHeight, pageTop: root.getBoundingClientRect().top } },
      contextToy: contextToy.captureContext(),
      markup: markup.captureContext(),
      reading: { wordEmphasis: emphasis, selection: 'browser' } };
  }
  function record(action, outcome, kind = "action", interaction) { onMoment({ kind, app: "design", action, outcome, context: { ...captureContext(), ...(interaction ? { interaction } : {}) } }); }
  return {
    captureContext,
    applyReadingPreference(enabled) { if (emphasis === enabled) return; emphasis = enabled; renderReading(); applyReadingStyle(dialog, emphasis); },
    applySettings() { if (document.activeElement === response || document.activeElement === settling) return; response.value = String(input.response); settling.value = String(input.settling); controls(); },
    setVisible(visible) { if (!visible) { surface.reset(); cancelDrag(); markup.hide(); contextToy.hide(); editor?.hide(); termCancellations.forEach(cancel => cancel()); selectedExplanation?.remove(); if (dialog.open) dialog.close(); } },
  };
}
