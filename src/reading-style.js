// Presentation only: text, document exports and annotations keep their words.
// This local word-emphasis renderer is not the licensed Bionic Reading font.
export const DEFAULT_READING_PREFIX = .5;
export function readingPrefix(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(.25, Math.min(.75, value)) : DEFAULT_READING_PREFIX;
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const words = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
function emphasize(word, coverage) {
  const clusters = graphemes ? [...graphemes.segment(word)].map(part => part.segment) : word.match(/\P{M}\p{M}*|\p{M}+/gu) || [];
  const count = clusters.filter(part => /[\p{L}\p{N}]/u.test(part)).length;
  let remaining = Math.ceil(count * coverage), boundary = 0;
  for (const cluster of clusters) {
    if (remaining <= 0) break;
    boundary += cluster.length;
    if (/[\p{L}\p{N}]/u.test(cluster)) remaining--;
  }
  return { text: word, prefix: word.slice(0, boundary), suffix: word.slice(boundary) };
}

// Shared by browser rendering and CLI callers; concatenating text is lossless.
export function splitReadingWords(text, coverage = DEFAULT_READING_PREFIX) {
  coverage = readingPrefix(coverage);
  if (words) return [...words.segment(text)].map(part => part.isWordLike && /\p{L}/u.test(part.segment)
    ? emphasize(part.segment, coverage) : { text: part.segment, prefix: '', suffix: part.segment });
  const parts = []; let start = 0;
  for (const match of text.matchAll(/\p{L}[\p{L}\p{M}\p{N}’'-]*/gu)) {
    if (match.index > start) parts.push({ text: text.slice(start, match.index), prefix: '', suffix: text.slice(start, match.index) });
    parts.push(emphasize(match[0], coverage)); start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start), prefix: '', suffix: text.slice(start) });
  return parts;
}

export function applyReadingStyle(root, preference) {
  const enabled = typeof preference === 'object' && preference !== null ? preference.enabled === true : preference === true;
  const coverage = readingPrefix(preference?.prefix);
  const doc = root.ownerDocument;
  const nativeText = 'input, textarea, [contenteditable]:not([contenteditable="false"]), [data-reading-ignore]';
  for (const target of root.querySelectorAll('[data-reading-text]')) {
    if (target.closest(nativeText)) continue;
    for (const word of target.querySelectorAll('.reading-word')) word.replaceWith(doc.createTextNode(word.textContent));
    target.normalize();
    if (!enabled) continue;
    const walker = doc.createTreeWalker(target, doc.defaultView.NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest(`script, style, ${nativeText}`)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const fragment = doc.createDocumentFragment();
      for (const part of splitReadingWords(node.data, coverage)) {
        if (!part.prefix) { fragment.append(doc.createTextNode(part.text)); continue; }
        const word = doc.createElement('span'); word.className = 'reading-word';
        const prefix = doc.createElement('b'); prefix.textContent = part.prefix;
        word.append(prefix, doc.createTextNode(part.suffix)); fragment.append(word);
      }
      node.replaceWith(fragment);
    }
  }
}
