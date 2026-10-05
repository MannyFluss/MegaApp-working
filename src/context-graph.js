// The dictionary is Manny's wording. These connections are assistant proposals,
// not new definitions, authority grants, or assessments of what Manny knows.
const proposals = [
  ['Design', 'Input system', 'Design includes how input becomes interaction.'],
  ['Design', 'Immersion', 'Immersion describes the experience the design should support.'],
  ['Design', 'Tool', 'Tools express the dependable design defaults.'],
  ['Design', 'Toy', 'Toys explore how those defaults can be reshaped.'],
  ['Design', 'Data control', 'Control of data is a governing design promise.'],
  ['Design', 'Mental model', 'Using the design can help revise the understanding behind it.'],
  ['Input system', 'Response', 'Response expresses the qualities of input.'],
  ['Response', 'Settling', 'Settling describes the return to rest after response.'],
  ['Response', 'Immersion', 'Subtle feedback may help attention stay with the interaction.'],
  ['Input system', 'Override', 'An input default can have a deliberate contextual override.'],
  ['Toy', 'Override', 'A Toy has more room to explore overrides.'],
  ['Tool', 'Override', 'A Tool can override a default while preserving its promises.'],
  ['Reading preferences', 'Override', 'An app can deliberately override a reading preference.'],
  ['Reading preferences', 'Immersion', 'Reading presentation can support absorbed attention.'],
  ['Policy', 'Protocol', 'Rules of authority and the way of interacting need to agree.'],
  ['Policy', 'Boundary', 'A boundary makes the reach of authority explicit.'],
  ['Policy', 'Data control', 'Data control informs the rules for use and sharing.'],
  ['Agent', 'Policy', 'Agent authority is governed by Manny’s rules.'],
  ['Agent', 'Protocol', 'An agent needs an agreed way to request and report actions.'],
  ['Agent', 'Internal context', 'Context about Manny can inform decisions for him.'],
  ['Internal context', 'External context', 'Personal context and encountered material can inform the same work.'],
  ['Internal context', 'Mental model', 'Personal patterns and a revisable understanding may inform one another.'],
  ['Moment', 'Internal context', 'A kept observation can provide evidence for exploring personal context.'],
  ['Moment', 'Data control', 'Manny chooses what to keep and share.'],
  ['Moment', 'Mental model', 'Feedback on a moment can help revise the understanding of an interaction.'],
];
const questions = [
  { id: 'question:pencil', label: 'Pencil input', definition: 'Pencil adds free markup over the page. How should marks relate to reflowing content, finger interaction and the Apple input handoff as this prototype evolves?', terms: ['Input system', 'Boundary', 'Override'] },
  { id: 'question:layers', label: 'Layers', definition: 'What is a layer, and how should its underlying organization become unambiguous styling without needing conscious management?', terms: ['Design', 'Reading preferences', 'Protocol'] },
  { id: 'question:authority', label: 'Agent authority', definition: 'Which actions may agents perform, in which contexts, and how should that authority be granted, limited and revoked?', terms: ['Agent', 'Policy', 'Boundary'] },
  { id: 'question:schema', label: 'Mental schema', definition: 'How should all the context I give AI systems be represented, connected and revised? The dictionary is a starting point; knowing a definition does not measure my understanding.', terms: ['Internal context', 'External context', 'Mental model'] },
];
export function termId(term) { return `term:${encodeURIComponent(term)}`; }
export function buildContextGraph(content) {
  const terms = content.terms;
  const nodes = Object.entries(terms).map(([label, definition]) => ({ id: termId(label), label, definition, kind: 'term', state: definition.trim() ? 'defined' : 'draft', source: 'design-edition-dictionary' }));
  nodes.push(...questions.map(({ terms: _, ...question }) => ({ ...question, kind: 'question', state: 'open', source: 'conversation-open-question' })));
  const relations = [];
  const add = (from, to, explanation) => relations.push({ id: `${from}~${to}`, from, to, explanation, state: 'proposed', source: 'assistant-proposal' });
  for (const [from, to, explanation] of proposals) if (Object.hasOwn(terms, from) && Object.hasOwn(terms, to)) add(termId(from), termId(to), explanation);
  for (const question of questions) for (const term of question.terms) if (Object.hasOwn(terms, term)) add(question.id, termId(term), 'This open question touches this dictionary concept.');
  return { format: 'megaapp.context-graph', version: 1, scope: 'Design dictionary and selected open questions; connections are assistant proposals, not a knowledge assessment.', nodes, relations };
}
export function contextNeighborhood(graph, id) {
  const focus = graph.nodes.find(node => node.id === id) || graph.nodes[0];
  const connections = graph.relations.filter(edge => edge.from === focus.id || edge.to === focus.id);
  return { focus, connections: connections.map(edge => ({ ...edge, node: graph.nodes.find(node => node.id === (edge.from === focus.id ? edge.to : edge.from)) })) };
}
