import { buildContextGraph, contextNeighborhood, termId } from './context-graph.js';
import { storageName } from './environment.js';

export function createContextToy({ onAction }) {
  const element = document.createElement('details'); element.className = 'context-toy'; element.id = 'design-context-toy';
  element.innerHTML = `<summary>Explore my context <span>Toy</span></summary>
    <div class="context-toy-body"><p class="context-invitation">Start with a word. Follow a connection. Find a question.</p>
    <p class="context-key">My dictionary has meanings. Dashed connections are proposals to test. Open questions still need my attention.</p>
    <div class="context-workspace"><div class="context-map" role="group" aria-label="Concept and nearby connections"><svg viewBox="0 0 720 340" preserveAspectRatio="none" aria-hidden="true"></svg><div class="context-nodes"></div></div>
    <div class="context-detail"><p id="context-kind"></p><h3 id="context-title"></h3><p id="context-definition"></p><p id="context-count"></p><ul id="context-connections" aria-label="Proposed connections"></ul></div></div>
    <details class="context-index"><summary>Find a concept <span id="context-total"></span></summary><label for="context-search">Filter meanings and open questions</label><input id="context-search" type="search" placeholder="A word or an idea…"><div id="context-catalog" aria-label="All concepts"></div><p id="context-empty" hidden>No matching concepts.</p></details>
    <details class="context-portable"><summary>Take this map with me</summary><p>The current dictionary, open questions and proposed connections, in one readable file for me or an agent.</p><button id="context-export" type="button" class="quiet-button">Export map JSON</button></details>
    <p id="context-save" role="status"></p></div>`;
  let graph, focused = termId('Design'), lastFocus = null;
  const key = storageName('megaapp.design.context-toy.v1');
  try { const saved = JSON.parse(localStorage.getItem(key)); if (typeof saved?.focused === 'string') focused = saved.focused; element.open = saved?.open === true; } catch { /* Only navigation, never editable work, is stored here. */ }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify({ focused, open: element.open })); element.querySelector('#context-save').textContent = ''; }
    catch { element.querySelector('#context-save').textContent = 'This view stays for this session; the device could not save it.'; }
  }
  function select(id, keyboard = false) {
    focused = id; render(); persist();
    if (keyboard) element.querySelector('.context-node[data-focused="true"]')?.focus({ preventScroll: true });
    onAction('Explore context concept', 'Dictionary concept or open question brought into focus');
  }
  const svg = element.querySelector('svg'), nodes = element.querySelector('.context-nodes');
  function render() {
    const { focus, connections } = contextNeighborhood(graph, focused); focused = focus.id;
    element.querySelector('#context-kind').textContent = focus.kind === 'question' ? 'Open question' : focus.state === 'draft' ? 'Dictionary definition still to write' : 'From my dictionary';
    element.querySelector('#context-title').textContent = focus.label;
    element.querySelector('#context-definition').textContent = focus.definition || 'This word is in my dictionary; its meaning is still unwritten.';
    element.querySelector('#context-count').textContent = connections.length ? `${connections.length} proposed connection${connections.length === 1 ? '' : 's'}` : 'No proposed connections yet. This meaning still belongs here.';
    const list = element.querySelector('#context-connections'); list.replaceChildren();
    for (const { node, explanation } of connections) {
      const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'context-relation'; button.textContent = node.label;
      button.onclick = event => select(node.id, event.detail === 0);
      const text = document.createElement('p'); text.textContent = explanation; li.append(button, text); list.append(li);
    }
    svg.replaceChildren(); nodes.replaceChildren();
    const visible = connections.slice(0, 6), positions = [[19,18],[81,18],[19,50],[81,50],[19,82],[81,82]];
    // Fixed geometry: only the focused concept changes. No idle force simulation.
    const place = (node, x, y, center = false) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'context-node'; button.dataset.id = node.id; button.dataset.directInput = '';  button.dataset.focused = String(center); button.dataset.kind = node.kind;
      button.style.left = `${x}%`; button.style.top = `${y}%`; button.setAttribute('aria-label', `${node.label}${node.kind === 'question' ? ', open question' : ', dictionary meaning'}`);
      const label = document.createElement('span'); label.textContent = node.label; button.append(label);
      if (node.kind === 'question') { const state = document.createElement('small'); state.textContent = 'Open'; button.append(state); }
      button.onclick = event => { if (!center) select(node.id, event.detail === 0); };
      nodes.append(button);
    };
    place(focus, 50, 50, true);
    visible.forEach(({ node }, index) => {
      const [x, y] = positions[index];
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M 360 170 Q ${x * 7.2} 170 ${x * 7.2} ${y * 3.4}`); svg.append(path); place(node, x, y);
    });
    element.querySelector('#context-total').textContent = `${graph.nodes.filter(n => n.kind === 'term').length} meanings · ${graph.nodes.filter(n => n.kind === 'question').length} open questions`;
    renderCatalog(); lastFocus = focused;
  }
  function renderCatalog() {
    const query = element.querySelector('#context-search').value.trim().toLocaleLowerCase(), catalog = element.querySelector('#context-catalog'); catalog.replaceChildren();
    const matches = graph.nodes.filter(node => `${node.label} ${node.definition}`.toLocaleLowerCase().includes(query));
    for (const node of matches) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = node.label; button.setAttribute('aria-pressed', String(node.id === focused));
      if (node.kind === 'question') button.textContent += ' (open)';
      button.onclick = event => select(node.id, event.detail === 0); catalog.append(button);
    }
    element.querySelector('#context-empty').hidden = matches.length !== 0;
  }
  element.querySelector('#context-search').oninput = renderCatalog;
  element.addEventListener('toggle', () => { if (!graph) return; persist(); if (element.open) onAction('Open context Toy', 'Dictionary exploration opened'); });
  element.querySelector('#context-export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2) + '\n'], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'megaapp-design-context-map.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    onAction('Export context map', 'Dictionary meanings, open questions and proposed connections exported');
  };
  return { element,
    update(content) { graph = buildContextGraph(content); const active = element.contains(document.activeElement) ? document.activeElement?.dataset.id : null; render(); if (active) nodes.querySelector(`[data-focused="true"]`)?.focus({ preventScroll: true }); },
    captureContext() { const focus = graph?.nodes.find(node => node.id === lastFocus); return { open: element.open, view: 'concept-neighborhood', focused: focus ? { id: focus.id, label: focus.label, kind: focus.kind } : null, connections: 'assistant-proposals' }; },
  };
}
