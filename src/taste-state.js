// Portable evidence and an inspectable local comparison search, shared with CLI.
export const FEATURES = ['pace', 'softness', 'spacing', 'cohesion', 'response', 'light', 'warmth'];
export const FAMILIES = ['orbits', 'ribbons', 'field'];
const MATCHES = ['unsure', 'far', 'close', 'yes'];
const copy = value => structuredClone(value);
const freshId = () => globalThis.crypto?.randomUUID?.() || `feeling-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const clamp = value => Math.max(0, Math.min(1, value));
const roundNumber = value => Math.round(clamp(value) * 100000) / 100000;
const fail = message => { throw new Error(`Feeling file: ${message}`); };
const text = (value, max = 4000) => typeof value === 'string' && value.length <= max;
const id = value => text(value, 160) && value.length > 0;
const numbers = (value, length, min, max) => Array.isArray(value) && value.length === length && value.every(n => Number.isFinite(n) && n >= min && n <= max);
function validateCandidate(value) {
  if (!value || !id(value.id) || !FAMILIES.includes(value.family) || !numbers(value.values, FEATURES.length, 0, 1)) fail('invalid sketch.');
}
function validateRound(value) {
  if (!value || !id(value.id) || !Number.isSafeInteger(value.index) || value.index < 1 || !Array.isArray(value.candidates) || value.candidates.length !== 3) fail('invalid comparison round.');
  value.candidates.forEach(validateCandidate);
  if (new Set(value.candidates.map(c => c.id)).size !== 3) fail('duplicate sketch identities.');
}
function validateObservations(values, candidates) {
  if (!Array.isArray(values) || values.length > 3) fail('invalid play observations.');
  const ids = new Set();
  for (const value of values) {
    if (!value || !candidates.some(c => c.id === value.candidateId) || ids.has(value.candidateId) || !Array.isArray(value.samples) || value.samples.length > 96) fail('invalid play samples.');
    ids.add(value.candidateId);
    if (![value.starts, value.canceled, value.omitted].every(n => Number.isSafeInteger(n) && n >= 0)) fail('invalid contact count.');
    for (const sample of value.samples) if (!sample || !numbers([sample.x, sample.y], 2, 0, 1) || !Number.isFinite(sample.t) || sample.t < 0 || !['start', 'move', 'end', 'cancel'].includes(sample.phase) || !['mouse', 'touch', 'pen', 'keyboard'].includes(sample.source)) fail('invalid contact sample.');
  }
}
export function validateWorkspace(input) {
  if (!input || input.format !== 'megaapp-feeling' || input.version !== 1 || !Array.isArray(input.sessions) || input.sessions.length < 1 || input.sessions.length > 1000) fail('unsupported workspace.');
  const ids = new Set();
  for (const session of input.sessions) {
    if (!session || !id(session.id) || ids.has(session.id) || !text(session.target) || !session.target.trim() || !text(session.createdAt, 80) || !Number.isFinite(Date.parse(session.createdAt))) fail('invalid session.');
    ids.add(session.id);
    if (!Number.isSafeInteger(session.rng) || session.rng < 1 || session.rng > 0xffffffff || !numbers(session.weights, 10, -4, 4)) fail('invalid search state.');
    if (!['touch', 'watch'].includes(session.mode) || !session.draft || !text(session.draft.note) || !MATCHES.includes(session.draft.match) || (session.draft.target !== undefined && !text(session.draft.target))) fail('invalid working feedback.');
    validateRound(session.round);
    if (session.champion) validateCandidate(session.champion);
    if (!Array.isArray(session.feedback) || session.feedback.length > 20000) fail('too many comparisons in one session.');
    const feedbackIds = new Set();
    for (const record of session.feedback) {
      if (!record || !id(record.id) || feedbackIds.has(record.id) || !text(record.at, 80) || !Number.isFinite(Date.parse(record.at)) || !text(record.note) || !MATCHES.includes(record.match) || !['touch', 'watch'].includes(record.mode) || typeof record.voided !== 'boolean') fail('invalid judgment.');
      feedbackIds.add(record.id); validateRound(record.round);
      if (!['none', 'tie', ...record.round.candidates.map(c => c.id)].includes(record.choice)) fail('judgment does not identify a shown sketch.');
      if (!record.before || !numbers(record.before.weights, 10, -4, 4) || !Number.isSafeInteger(record.before.rng) || record.before.rng < 1 || record.before.rng > 0xffffffff) fail('invalid choice recovery.');
      if (record.before.champion) validateCandidate(record.before.champion);
      validateObservations(record.observations, record.round.candidates);
    }
  }
  if (!ids.has(input.activeSessionId)) fail('missing current session.');
  return copy(input);
}
function random(session) {
  let x = session.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  session.rng = (x >>> 0) || 1;
  return session.rng / 0x100000000;
}
function shuffle(session, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(session) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
function featureVector(candidate) {
  return [...candidate.values, ...FAMILIES.map(f => f === candidate.family ? 1 : 0)];
}
function candidate(session, index, slot, base = null) {
  const radius = Math.max(0.13, 0.32 / Math.sqrt(1 + index / 8));
  const values = FEATURES.map((_, i) => roundNumber(base
    ? base.values[i] + (random(session) - .5) * radius * 2
    : random(session) + Math.tanh(session.weights[i]) * .18));
  let family = base?.family;
  if (!family || random(session) < .15) {
    const biases = FAMILIES.map((_, i) => Math.exp(session.weights[7 + i] * .5) + 1);
    let draw = random(session) * biases.reduce((a, b) => a + b, 0);
    family = FAMILIES.find((_, i) => (draw -= biases[i]) < 0) || FAMILIES[2];
  }
  return { id: `${session.id}-r${index}-${slot}`, family, values };
}
function nextRound(session, explore = false) {
  const index = (session.round?.index || 0) + 1;
  const candidates = session.champion && !explore
    ? [copy(session.champion), candidate(session, index, 1, session.champion), candidate(session, index, 2)]
    : [0, 1, 2].map(i => candidate(session, index, i));
  if (index === 1) candidates.forEach((item, i) => { item.family = FAMILIES[i]; });
  session.round = { id: `${session.id}-r${index}`, index, candidates: shuffle(session, candidates) };
}
export function createSession(target = 'Quiet anticipation', { sessionId = freshId(), seed = Date.now() >>> 0, at = new Date().toISOString() } = {}) {
  if (!text(target) || !target.trim()) fail('describe a feeling first.');
  const session = { id: sessionId, target: target.trim(), createdAt: at, rng: seed || 1, weights: Array(10).fill(0), champion: null, feedback: [], mode: 'touch', draft: { note: '', match: 'unsure' } };
  nextRound(session);
  return session;
}
export function createWorkspace(target, options) {
  const session = createSession(target, options);
  return { format: 'megaapp-feeling', version: 1, activeSessionId: session.id, sessions: [session] };
}
export function currentSession(workspace) { return workspace.sessions.find(s => s.id === workspace.activeSessionId); }
export function addSession(workspace, target, options) {
  const result = copy(workspace), session = createSession(target, options);
  if (result.sessions.some(s => s.id === session.id)) fail('session identity already exists.');
  result.sessions.push(session); result.activeSessionId = session.id;
  return result;
}
export function judge(workspace, choice, { note, match, observations = [], at = new Date().toISOString(), recordId = freshId() } = {}) {
  const result = copy(workspace), session = currentSession(result);
  const winner = session.round.candidates.find(c => c.id === choice);
  if (!winner && !['none', 'tie'].includes(choice)) fail('choose a shown sketch.');
  note ??= session.draft.note; match ??= session.draft.match;
  if (!text(note) || !MATCHES.includes(match)) fail('invalid feedback.');
  if (session.feedback.length >= 20000) fail('this session holds 20,000 comparisons; export it and start another.');
  if (!id(recordId) || session.feedback.some(r => r.id === recordId)) fail('judgment identity already exists.');
  validateObservations(observations, session.round.candidates);
  const record = { id: recordId, at, round: copy(session.round), choice, match: choice === 'none' ? 'far' : match, note, mode: session.mode, observations: copy(observations), voided: false, before: { champion: copy(session.champion), weights: [...session.weights], rng: session.rng } };
  session.feedback.push(record);
  if (winner) {
    const win = featureVector(winner), others = session.round.candidates.filter(c => c.id !== choice).map(featureVector);
    session.weights = session.weights.map((weight, i) => Math.max(-4, Math.min(4, weight + .35 * (win[i] - (others[0][i] + others[1][i]) / 2))));
    session.champion = copy(winner);
  }
  session.draft = { note: '', match: 'unsure', target: session.draft.target ?? session.target };
  nextRound(session, !winner);
  return result;
}
export function undoJudgment(workspace) {
  const result = copy(workspace), session = currentSession(result);
  const record = session.feedback.findLast(r => !r.voided);
  if (!record) return result;
  record.voided = true;
  session.round = copy(record.round); session.champion = copy(record.before.champion);
  session.weights = [...record.before.weights]; session.rng = record.before.rng;
  session.draft = { note: record.note, match: record.match };
  return result;
}
export function generationBrief(workspace) {
  const session = copy(currentSession(validateWorkspace(workspace)));
  return { format: 'megaapp-feeling-generation-brief', version: 1,
    task: 'Create three live experiences aimed at the target feeling. Use actual comparisons and user explanations; treat inferred reasons as hypotheses. Refine a strong example, test an uncertainty, and explore a different behavior. Ask which is closest to the target and whether it actually reaches it.',
    boundary: 'The browser prototype uses local parameter search. Target wording and free-form notes have not been interpreted by a connected AI. Voided judgments are corrections, not preference evidence. Play samples describe contacts, not felt experience. No claim of model training or validated improvement.',
    featureNames: FEATURES, families: FAMILIES, session };
}
