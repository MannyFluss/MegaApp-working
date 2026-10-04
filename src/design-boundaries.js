// Word boundaries are half-open ranges. Applying a disjoint edit rebases the
// remaining ranges, so their original material stays reserved even after growth.
export const boundariesOverlap = (a, b) => a.start < b.end && b.start < a.end;
export function createBoundaryExample(text, saved) {
  const split = value => value.trim().split(/\s+/).filter(Boolean);
  let words = split(text), edits = [], selection = null, next = 1, history = [];
  const state = () => ({ words: [...words], edits: edits.map(e => ({ ...e })), selection: selection && { ...selection } });
  const remember = () => { history.push(state()); history = history.slice(-8); };
  function valid(range) { return range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start && range.end <= words.length; }
  if (saved && Array.isArray(saved.words) && saved.words.length > 0 && saved.words.length <= 300 && saved.words.every(w => typeof w === 'string' && w.length <= 1000)) {
    words = [...saved.words];
    if (Array.isArray(saved.edits)) for (const edit of saved.edits.slice(0, 20)) {
      if (valid(edit) && typeof edit.replacement === 'string' && !edits.some(e => boundariesOverlap(e, edit))) {
        const id = Number.isSafeInteger(edit.id) && edit.id > 0 && edit.id < 1e9 && !edits.some(e => e.id === edit.id) ? edit.id : next;
        edits.push({ start: edit.start, end: edit.end, replacement: edit.replacement.slice(0, 10000), id, label: `Edit ${id}` }); next = Math.max(next, id + 1);
      }
    }
    if (valid(saved.selection)) selection = { ...saved.selection };
  }
  if (Array.isArray(saved?.history)) history = saved.history.slice(-8).filter(item => Array.isArray(item?.words) && item.words.length).map(item => {
    const clean = createBoundaryExample(text, { words: item.words, edits: item.edits, selection: item.selection }).snapshot();
    return { words: clean.words, edits: clean.edits, selection: clean.selection };
  });
  return {
    reset(value) { remember(); words = split(value); edits = []; selection = null; },
    get canUndo() { return history.length > 0; },
    undo() {
      const before = history.pop(); if (!before) return false;
      words = [...before.words]; edits = before.edits.map(e => ({ ...e })); selection = before.selection && { ...before.selection };
      next = Math.max(next, ...edits.map(e => e.id + 1)); return true;
    },
    get words() { return [...words]; }, get edits() { return edits.map(e => ({ ...e })); }, get selection() { return selection && { ...selection }; },
    get collision() { return Boolean(selection && edits.some(edit => boundariesOverlap(edit, selection))); },
    select(start, end) { const range = { start: Math.min(start, end), end: Math.max(start, end) }; if (!valid(range)) return false; selection = range; return true; },
    begin() {
      if (!selection) return { outcome: 'Choose a boundary first.' };
      if (this.collision) return { outcome: 'Blocked: overlapping active boundary' };
      const edit = { ...selection, id: next++, label: `Edit ${next - 1}`, replacement: words.slice(selection.start, selection.end).join(' ') };
      edits.push(edit); selection = null; return { edit: { ...edit }, outcome: 'Boundary reserved' };
    },
    draft(id, value) { const edit = edits.find(e => e.id === id); if (edit) edit.replacement = value.slice(0, 10000); },
    apply(id) {
      const edit = edits.find(e => e.id === id); if (!edit) return false;
      const replacement = split(edit.replacement); const delta = replacement.length - (edit.end - edit.start);
      if (words.length + delta > 300 || words.length + delta === 0) return false;
      remember(); words.splice(edit.start, edit.end - edit.start, ...replacement);
      edits = edits.filter(e => e !== edit).map(e => e.start >= edit.end ? { ...e, start: e.start + delta, end: e.end + delta } : e);
      selection = null; return true;
    },
    cancel(id) { edits = edits.filter(e => e.id !== id); },
    replace(value) { const nextWords = split(value); if (!nextWords.length || nextWords.length > 300 || edits.length) return false; remember(); words = nextWords; selection = null; return true; },
    snapshot() { return { ...state(), history: history.map(item => ({ ...item, words: [...item.words], edits: item.edits.map(e => ({ ...e })), selection: item.selection && { ...item.selection } })) }; },
  };
}
