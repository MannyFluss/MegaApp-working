// Presentation only: text, document exports and annotations keep their words.
export function applyReadingStyle(root, enabled) {
  for (const target of root.querySelectorAll('[data-reading-text]')) {
    for (const word of target.querySelectorAll('.reading-word')) word.replaceWith(document.createTextNode(word.textContent));
    target.normalize();
    if (!enabled) continue;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const fragment = document.createDocumentFragment(); let start = 0;
      for (const match of node.data.matchAll(/\p{L}[\p{L}\p{M}\p{N}’'-]*/gu)) {
        fragment.append(document.createTextNode(node.data.slice(start, match.index)));
        const letters = Array.from(match[0]), split = Math.ceil(letters.length / 2);
        const word = document.createElement('span'); word.className = 'reading-word';
        const prefix = document.createElement('b'); prefix.textContent = letters.slice(0, split).join('');
        word.append(prefix, document.createTextNode(letters.slice(split).join(''))); fragment.append(word);
        start = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.data.slice(start))); node.replaceWith(fragment);
    }
  }
}
