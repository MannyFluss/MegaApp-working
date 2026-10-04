// One portable, deterministic document shared by the browser and agent CLI.
const IDS = ['touch', 'still', 'scope', 'capability', 'context', 'continuity', 'override'];
const DEFAULT_ORDER = ['touch', 'scope', 'still', 'capability', 'context', 'continuity', 'override'];
const copy = value => JSON.parse(JSON.stringify(value));
function string(value, name, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text of at most ${max} characters.`);
  return value;
}
export function normalizeDesign(content) {
  if (!content || typeof content !== 'object') throw new Error('Missing design content.');
  if (!Array.isArray(content.principles) || content.principles.length !== IDS.length || new Set(content.principles.map(p => p?.id)).size !== IDS.length || content.principles.some(p => !IDS.includes(p?.id))) throw new Error('Keep each of the seven principle identities exactly once.');
  const layout = content.layout || { order: DEFAULT_ORDER, wide: ['override'], columns: 2 };
  if (![1, 2].includes(layout.columns) || !Array.isArray(layout.order) || layout.order.length !== IDS.length || new Set(layout.order).size !== IDS.length || layout.order.some(id => !IDS.includes(id))) throw new Error('Layout must contain each principle once, in one or two columns.');
  if (!Array.isArray(layout.wide) || layout.wide.some(id => !IDS.includes(id)) || new Set(layout.wide).size !== layout.wide.length) throw new Error('Invalid full-width principles.');
  if (!content.terms || typeof content.terms !== 'object' || Array.isArray(content.terms)) throw new Error('Invalid dictionary.');
  const entries = Object.entries(content.terms);
  if (!entries.length || entries.length > 80 || entries.some(([key]) => !key.trim() || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Invalid dictionary.');
  return { title: string(content.title, 'Title', 300), introduction: string(content.introduction, 'Introduction', 4000),
    principles: content.principles.map(p => ({ id: p.id, title: string(p.title, 'Principle heading', 300), text: string(p.text, 'Principle wording', 6000) })),
    terms: Object.fromEntries(entries.map(([term, definition]) => [string(term, 'Term', 100), string(definition, 'Definition', 4000)])),
    note: string(content.note, 'Page note', 4000), layout: { order: [...layout.order], wide: [...layout.wide], columns: layout.columns } };
}
export function designEnvelope(content) { return { format: 'megaapp.design', version: 1, content: normalizeDesign(content) }; }
export function readDesignEnvelope(value) {
  if (value?.format !== 'megaapp.design' || value.version !== 1) throw new Error('Expected a MegaApp design edition, version 1.');
  return normalizeDesign(value.content);
}
export function designMarkdown(content, { dictionary = true } = {}) {
  const doc = normalizeDesign(content), byId = new Map(doc.principles.map(p => [p.id, p]));
  const heading = value => value.replace(/\s+/g, ' ').trim();
  return `# ${heading(doc.title) || 'Untitled design'}\n\n${doc.introduction}\n\n${doc.layout.order.map(id => { const p = byId.get(id); return `## ${heading(p.title) || 'Untitled principle'}\n\n${p.text}`; }).join('\n\n')}\n\n${doc.note}\n\n${dictionary ? Object.entries(doc.terms).map(([term, definition]) => `### ${heading(term)}\n\n${definition}`).join('\n\n') + '\n\n' : ''}<!-- MegaApp layout: ${JSON.stringify(doc.layout)} -->\n`;
}
export function createDesignEdition(defaults, saved) {
  const base = normalizeDesign(defaults);
  if (saved && (saved.version !== 1 || !saved.document || !saved.base)) throw new Error('Unsupported saved edition.');
  let document = saved?.document ? normalizeDesign(saved.document) : copy(base), history = [], future = [], group = null;
  const sourceChanged = Boolean(saved?.base && JSON.stringify(normalizeDesign(saved.base)) !== JSON.stringify(base));
  if (Array.isArray(saved?.history)) history = saved.history.slice(-12).map(item => ({ label: string(item.label, 'Version name', 300), at: string(item.at, 'Version date', 100), document: normalizeDesign(item.document) }));
  if (Array.isArray(saved?.future)) future = saved.future.slice(-12).map(item => ({ label: string(item.label, 'Version name', 300), at: string(item.at, 'Version date', 100), document: normalizeDesign(item.document) }));
  function checkpoint(label) { history.push({ label, at: new Date().toISOString(), document: copy(document) }); history = history.slice(-12); future = []; }
  function change(label, key, update) { if (group !== key || key === null) checkpoint(label); group = key; update(); }
  return {
    get content() { return copy(document); }, get changed() { return JSON.stringify(document) !== JSON.stringify(base); }, get sourceChanged() { return sourceChanged; },
    get versions() { return copy(history); }, get canUndo() { return Boolean(history.length); }, get canRedo() { return Boolean(future.length); },
    endGroup() { group = null; },
    set(field, value, id) {
      const key = `${id || 'page'}.${field}`, next = copy(document);
      if (id) { if (!['title', 'text'].includes(field)) throw new Error('Unknown principle field.'); const p = next.principles.find(p => p.id === id); if (!p) throw new Error('Unknown principle.'); p[field] = value; }
      else { if (!['title', 'introduction', 'note'].includes(field)) throw new Error('Unknown page field.'); next[field] = value; }
      const valid = normalizeDesign(next); if (JSON.stringify(valid) === JSON.stringify(document)) return;
      change(`Before changing ${id ? 'a principle' : field}`, key, () => { document = valid; });
    },
    move(id, beforeId) {
      const order = document.layout.order.filter(value => value !== id);
      if (!IDS.includes(id) || (beforeId !== null && !order.includes(beforeId))) return false;
      order.splice(beforeId === null ? order.length : order.indexOf(beforeId), 0, id);
      if (JSON.stringify(order) === JSON.stringify(document.layout.order)) return false;
      change('Before rearranging principles', null, () => { document.layout.order = order; }); return true;
    },
    layout({ columns = document.layout.columns, wide = document.layout.wide }) {
      const next = normalizeDesign({ ...document, layout: { ...document.layout, columns, wide } });
      if (JSON.stringify(next) === JSON.stringify(document)) return;
      change('Before changing the page layout', null, () => { document = next; });
    },
    replace(value, label = 'Before importing an edition') { const next = normalizeDesign(value); change(label, null, () => { document = next; }); },
    reset() { this.replace(base, 'Before restoring the published design'); },
    undo() { const prior = history.pop(); if (!prior) return false; future.push({ label: 'Before Undo', at: new Date().toISOString(), document: copy(document) }); document = prior.document; group = null; return true; },
    redo() { const next = future.pop(); if (!next) return false; history.push({ label: 'Before Redo', at: new Date().toISOString(), document: copy(document) }); document = next.document; group = null; return true; },
    restore(index) { const prior = history[index]; if (!prior) return false; this.replace(prior.document, 'Before restoring a saved version'); return true; },
    snapshot() { return { version: 1, base: copy(base), document: copy(document), history: copy(history), future: copy(future) }; },
  };
}
