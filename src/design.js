import { designContent } from "./design-content.js";
import { createPhysicalSurface } from "./input.js";

export function createDesign({ input, onSettings, notify }) {
  const root = document.getElementById("design-guide");
  root.innerHTML = `<header class="design-masthead"><div><h1></h1><p class="design-introduction"></p></div><div class="design-signature">MegaApp<br><span>Manny’s design</span></div></header><div class="design-principles"></div><footer class="design-footnote"><details class="design-about"><summary>About this page</summary><p></p></details><details class="design-dictionary"><summary>Dictionary</summary><div class="design-term-links" aria-label="Dictionary terms"></div></details></footer>`;
  root.querySelector("h1").textContent = designContent.title;
  root.querySelector(".design-introduction").textContent = designContent.introduction;
  root.querySelector(".design-about p").textContent = designContent.note;
  root.querySelector(".design-footnote").prepend(root.parentElement.querySelector(".design-reading-actions"));
  const sections = new Map();
  for (const principle of designContent.principles) {
    const section = document.createElement("section");
    section.className = `design-principle design-${principle.id}`;
    const title = document.createElement("h2"), text = document.createElement("p");
    title.textContent = principle.title; text.textContent = principle.text;
    section.append(title, text); sections.set(principle.id, section);
    root.querySelector(".design-principles").append(section);
  }
  const demo = document.createElement("div");
  demo.innerHTML = `<div id="design-touch-board" class="design-touch-board"><span class="design-touch-instruction">Move this with your hand.</span><button id="design-touch-object" class="design-touch-object" data-direct-input type="button" aria-label="Move the surface. Drag, or use arrow keys. Enter resets its position."><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 18h18M15 24h18M15 30h18"/></svg><span>Follow me</span></button></div><details class="design-input-settings"><summary>Tune the shared response</summary><div class="design-tuning"><label for="design-response">Response <output id="design-response-value"></output></label><input id="design-response" type="range" min="0" max="1.5" step="0.05" value="0.8"><label for="design-settling">Settling <output id="design-settling-value"></output></label><input id="design-settling" type="range" min="120" max="500" step="10" value="280"><button id="design-input-reset" class="quiet-button" type="button">Restore defaults</button><span id="design-input-status" role="status">Applies to the shared response across apps.</span></div></details>`;
  sections.get("touch").append(demo);
  const surface = createPhysicalSurface(root.querySelector("#design-touch-object"), root.querySelector("#design-touch-board"), input);
  const response = root.querySelector("#design-response"), settling = root.querySelector("#design-settling");
  let saveChain = Promise.resolve(), generation = 0;
  function controls() {
    root.querySelector("#design-response-value").textContent = `${Math.round(input.response * 100)}%`;
    root.querySelector("#design-settling-value").textContent = `${input.settling} ms`;
  }
  function preview() {
    input.configure({ "system.input.response": { value: Number(response.value) }, "system.input.settling": { value: Number(settling.value) } });
    controls();
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
  scope.innerHTML = `<div id="design-scope-text" class="design-scope-text" aria-label="Example text with visible edit boundaries"></div><div class="design-scope-actions"><button id="design-edit-first" class="quiet-button" type="button">Edit beginning</button><button id="design-edit-overlap" class="quiet-button" type="button">Try overlapping edit</button><button id="design-edit-separate" class="quiet-button" type="button">Edit ending</button></div><p id="design-scope-status" role="status">A local example. Choose a region to begin an edit.</p><div id="design-active-edits" class="design-active-edits"></div><button id="design-example-reset" class="design-example-reset quiet-button" type="button">Reset example</button>`;
  sections.get("scope").append(scope);
  const original = "I learn by making things, asking questions, and returning to what matters.".split(" ");
  let words = [...original], edits = [], selection, collision;
  const regions = {
    first: { start: 0, end: 5, label: "Beginning", replacement: "I understand through making things,".split(" ") },
    overlap: { start: 3, end: 9, label: "Middle", replacement: "exploring ideas, posing questions, then returning".split(" ") },
    separate: { start: 9, end: 12, label: "Ending", replacement: "the next idea.".split(" ") },
  };
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  function renderScopes() {
    const text = scope.querySelector("#design-scope-text"); text.replaceChildren();
    words.forEach((word, index) => {
      const span = document.createElement("span"); span.textContent = word;
      const occupied = edits.some(edit => index >= edit.start && index < edit.end);
      const selected = selection && index >= selection.start && index < selection.end;
      span.className = `${occupied ? "scope-occupied" : ""} ${selected && collision ? "scope-collision" : ""}`;
      span.dataset.word = String(index); text.append(span, document.createTextNode(" "));
    });
    const list = scope.querySelector("#design-active-edits"); list.replaceChildren();
    for (const edit of edits) {
      const row = document.createElement("div"); row.className = "design-active-edit";
      const name = document.createElement("span"); name.textContent = `${edit.label} selected`;
      const finish = document.createElement("button"); finish.type = "button"; finish.className = "quiet-button"; finish.textContent = "Apply"; finish.setAttribute("aria-label", `Apply ${edit.label.toLowerCase()} edit`);
      finish.onclick = () => {
        words.splice(edit.start, edit.end - edit.start, ...edit.replacement);
        edits = edits.filter(value => value !== edit); selection = null; collision = false; renderScopes();
        scope.querySelector("#design-scope-status").textContent = `${edit.label} changed. Other regions kept their place.`;
      };
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "quiet-button"; cancel.textContent = "Cancel"; cancel.setAttribute("aria-label", `Cancel ${edit.label.toLowerCase()} edit`);
      cancel.onclick = () => { edits = edits.filter(value => value !== edit); selection = null; collision = false; renderScopes(); scope.querySelector("#design-scope-status").textContent = `${edit.label} edit cancelled. Text kept.`; };
      row.append(name, finish, cancel); list.append(row);
    }
    scope.dataset.activeCount = String(edits.length);
    scope.dataset.collision = String(Boolean(collision));
    scope.querySelector("#design-example-reset").hidden = edits.length === 0 && words.join(" ") === original.join(" ") && !collision;
  }
  function begin(id) {
    selection = regions[id]; collision = edits.some(edit => overlaps(edit, selection));
    if (!collision) edits.push({ ...selection });
    renderScopes();
    scope.querySelector("#design-scope-status").textContent = collision
      ? "These regions overlap. Finish or cancel the existing edit before starting here."
      : `${selection.label} boundary shown. Apply or cancel this local edit.`;
  }
  scope.querySelector("#design-edit-first").onclick = () => begin("first");
  scope.querySelector("#design-edit-overlap").onclick = () => begin("overlap");
  scope.querySelector("#design-edit-separate").onclick = () => begin("separate");
  scope.querySelector("#design-example-reset").onclick = () => { words = [...original]; edits = []; selection = null; collision = false; renderScopes(); scope.querySelector("#design-scope-status").textContent = "Example restored. Choose a region to begin an edit."; };
  renderScopes();

  const dialog = document.createElement("dialog"); dialog.className = "design-term-dialog"; dialog.id = "design-term-dialog"; dialog.setAttribute("aria-labelledby", "design-term-title");
  dialog.innerHTML = `<div class="design-term-heading"><h2 id="design-term-title"></h2><button class="quiet-button" type="button">Close</button></div><p id="design-term-definition"></p><p class="design-term-note">Working vocabulary. The full dictionary is a separate decision.</p>`;
  document.body.append(dialog);
  let priorTerm;
  dialog.addEventListener("close", () => { if (priorTerm?.isConnected && !priorTerm.closest("[hidden], [inert]")) priorTerm.focus({ preventScroll: true }); });
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { const box = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close(); });
  for (const [term, definition] of Object.entries(designContent.terms)) {
    const button = document.createElement("button"); button.className = "design-term-link"; button.type = "button"; button.textContent = term; button.setAttribute("aria-haspopup", "dialog");
    button.onclick = () => { priorTerm = button; dialog.querySelector("h2").textContent = term; dialog.querySelector("#design-term-definition").textContent = definition; dialog.showModal(); };
    root.querySelector(".design-term-links").append(button);
  }
  return {
    applySettings() { if (document.activeElement === response || document.activeElement === settling) return; response.value = String(input.response); settling.value = String(input.settling); controls(); },
    setVisible(visible) { if (!visible) { surface.reset(); if (dialog.open) dialog.close(); } },
  };
}
