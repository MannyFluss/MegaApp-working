import { createWorkspace, currentSession, addSession, judge, undoJudgment, validateWorkspace, generationBrief } from './taste-state.js';
import { openTasteStorage } from './taste-storage.js';
import { createTasteSketch } from './taste-sketch.js';

export function createTaste({ notify, onMoment } = {}) {
  const panel = document.getElementById('panel-taste');
  const $ = id => panel.querySelector(`#taste-${id}`);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let workspace = createWorkspace(), storage, sketches = [], visible = false, ready = false, blocked = false, corrupt;
  let saveQueue = Promise.resolve(), draftTimer, error = '', busy = false, saveToken = 0;
  const labels = ['A', 'B', 'C'];
  const button = (label, action, className = 'quiet-button') => {
    const node = document.createElement('button'); node.type = 'button'; node.className = className;
    node.textContent = label; node.onclick = action; return node;
  };
  function status(message = '', failed = false) {
    $('save').textContent = message; $('save').hidden = !message; $('save').dataset.error = String(failed);
    $('retry').hidden = !failed || blocked; $('backup').hidden = !corrupt;
  }
  function download(value, name) {
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  function persist() {
    clearTimeout(draftTimer);
    draftTimer = undefined;
    if (!ready || blocked) return saveQueue;
    const snapshot = structuredClone(workspace);
    const token = ++saveToken; panel.dataset.saved = 'false';
    saveQueue = saveQueue.then(async () => {
      if (blocked) return;
      try {
        if (!storage) throw new Error('Local storage is unavailable.');
        await storage.save(snapshot); error = ''; status(); if (token === saveToken) panel.dataset.saved = 'true';
      } catch (e) {
        error = e.message;
        panel.dataset.saved = 'session';
        if (/Another tab/.test(error)) { blocked = true; renderControls(); }
        status(`${error} Your current session is still available through Export data.`, true);
      }
    });
    return saveQueue;
  }
  function session() { return currentSession(workspace); }
  function available() { return ready && !blocked && !busy; }
  function renderControls() {
    for (const node of panel.querySelectorAll('[data-taste-edit]')) node.disabled = !available();
    $('undo').disabled = !available() || !session().feedback.some(r => !r.voided);
    $('export').disabled = !ready || !!corrupt; $('brief').disabled = !ready || !!corrupt;
    $('import').disabled = !ready || busy || (blocked && !corrupt);
  }
  function renderHistory() {
    const select = $('sessions'); select.replaceChildren();
    for (const item of workspace.sessions) {
      const option = document.createElement('option'); option.value = item.id;
      option.textContent = item.target; option.selected = item.id === workspace.activeSessionId; select.append(option);
    }
    const history = $('history'); history.replaceChildren();
    const records = session().feedback.filter(r => !r.voided), matchLabels = { far: 'Still far away', close: 'Getting close', yes: 'This has the feeling', unsure: 'Match not rated' };
    $('record-count').textContent = `${records.length} saved ${records.length === 1 ? 'comparison' : 'comparisons'}`;
    for (const record of records.slice(-20).reverse()) {
      const li = document.createElement('li'), caption = document.createElement('p');
      const index = record.round.candidates.findIndex(c => c.id === record.choice);
      caption.textContent = `Round ${record.round.index}: ${index >= 0 ? `chose ${labels[index]}` : record.choice === 'none' ? 'none matched' : 'could not distinguish'}. ${matchLabels[record.match]}.`;
      li.append(caption);
      if (record.note) { const note = document.createElement('p'); note.className = 'taste-history-note'; note.textContent = record.note; li.append(note); }
      history.append(li);
    }
    if (!records.length) { const li = document.createElement('li'); li.textContent = 'Your first choice starts the history.'; history.append(li); }
  }
  function render() {
    sketches.forEach(s => s.dispose()); sketches = [];
    const value = session(), views = $('views'); views.replaceChildren();
    $('target').value = value.draft.target ?? value.target; $('note').value = value.draft.note; $('match').value = value.draft.match;
    $('round').textContent = `Round ${value.round.index}`;
    $('mode').setAttribute('aria-pressed', String(value.mode === 'watch'));
    $('mode').textContent = value.mode === 'watch' ? 'Return to touch' : 'Watch motion';
    $('gesture').textContent = motion.matches ? 'Tap or drag to explore. Reduced motion is on.' : value.mode === 'watch' ? 'Watch each attempt, then choose the closest.' : 'Tap or drag inside each view. Arrow keys and space work too.';
    value.round.candidates.forEach((candidate, index) => {
      const section = document.createElement('section'); section.className = 'taste-attempt'; section.dataset.candidateId = candidate.id;
      const canvas = document.createElement('canvas'); canvas.className = 'taste-canvas'; canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Live attempt ${labels[index]}. Tap, drag, or use arrow keys and space to explore.`);
      canvas.setAttribute('aria-describedby', 'taste-gesture');
      const footer = document.createElement('div'); footer.className = 'taste-attempt-footer';
      const label = document.createElement('span'); label.textContent = labels[index]; label.className = 'taste-letter';
      const choose = button('Closest to the feeling', () => pick(candidate.id), 'primary-button taste-choose');
      choose.setAttribute('aria-label', `Choose ${labels[index]} as closest to the feeling`); choose.setAttribute('data-taste-edit', '');
      footer.append(label, choose); section.append(canvas, footer); views.append(section);
      const sketch = createTasteSketch(canvas, candidate, { mode: value.mode, reduced: motion.matches }); sketches.push(sketch); sketch.setVisible(visible && !document.hidden);
    });
    renderHistory(); renderControls();
  }
  function captureContext() {
    const value = session();
    return { app: 'taste', coverage: 'Current target, procedural candidates and latest explicit judgment; bounded play samples are saved with judgments in the feeling workspace.', feeling: { sessionId: value.id, target: value.target, round: value.round, mode: value.mode, comparisons: value.feedback.filter(r => !r.voided).length, lastJudgment: value.feedback.findLast(r => !r.voided) || null, generation: 'Local parameter search; free-form words are retained without AI interpretation.' } };
  }
  function pick(choice) {
    if (!available()) return;
    try {
      const previous = session(), selected = previous.round.candidates.findIndex(c => c.id === choice);
      workspace = judge(workspace, choice, { observations: sketches.map(s => s.observation()) });
      render(); persist();
      if (selected >= 0) panel.querySelectorAll('.taste-choose')[selected]?.focus({ preventScroll: true });
      $('outcome').textContent = selected >= 0 ? `Kept ${labels[selected]} and made two alternatives.` : choice === 'none' ? 'Trying three different directions.' : 'Kept the uncertainty and made three new attempts.';
      onMoment?.({ kind: 'action', app: 'taste', action: 'Compare feeling attempts', outcome: $('outcome').textContent, context: captureContext() });
    } catch (e) { status(e.message, true); }
  }
  $('none').onclick = () => pick('none'); $('tie').onclick = () => pick('tie');
  $('undo').onclick = () => {
    if (!available()) return;
    workspace = undoJudgment(workspace); render(); persist(); $('outcome').textContent = 'Returned to the previous three. The corrected choice is kept in your export.';
  };
  $('start').onclick = () => {
    if (!available()) return;
    try {
      const target = $('target').value.trim();
      if (target === session().target) { $('outcome').textContent = 'Already exploring this feeling. Choose an attempt below.'; return; }
      const previous = structuredClone(workspace); currentSession(previous).draft.target = session().target;
      workspace = addSession(previous, target); render(); persist(); $('outcome').textContent = 'Started a new feeling. Your previous session is kept in History & data.';
    } catch (e) { status(e.message, true); }
  };
  $('target').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('start').click(); } };
  $('target').oninput = () => { if (!available()) return; session().draft.target = $('target').value; clearTimeout(draftTimer); draftTimer = setTimeout(persist, 300); };
  $('target').addEventListener('change', persist);
  $('mode').onclick = () => {
    if (!available()) return;
    session().mode = session().mode === 'watch' ? 'touch' : 'watch';
    sketches.forEach(s => s.configure(session().mode, motion.matches));
    sketches.forEach(s => s.setVisible(visible && !document.hidden));
    $('mode').setAttribute('aria-pressed', String(session().mode === 'watch'));
    $('mode').textContent = session().mode === 'watch' ? 'Return to touch' : 'Watch motion';
    $('gesture').textContent = motion.matches ? 'Tap or drag to explore. Reduced motion is on.' : session().mode === 'watch' ? 'Watch each attempt, then choose the closest.' : 'Tap or drag inside each view. Arrow keys and space work too.';
    persist();
  };
  function saveDraft() {
    if (!available()) return;
    session().draft.note = $('note').value; session().draft.match = $('match').value;
    clearTimeout(draftTimer); draftTimer = setTimeout(persist, 300);
  }
  $('note').addEventListener('input', saveDraft); $('note').addEventListener('change', () => { saveDraft(); persist(); });
  $('match').addEventListener('change', () => { saveDraft(); persist(); });
  $('sessions').onchange = () => {
    if (!available()) return;
    workspace.activeSessionId = $('sessions').value; render(); persist(); $('outcome').textContent = 'Returned to this feeling.';
  };
  $('export').onclick = () => download(workspace, 'megaapp-feeling.json');
  $('brief').onclick = () => download(generationBrief(workspace), 'feeling-ai-brief.json');
  $('backup').onclick = () => download(corrupt, 'unreadable-feeling-backup.json');
  $('retry').onclick = () => persist();
  $('import').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const file = $('file').files[0]; $('file').value = ''; if (!file) return;
    busy = true; renderControls();
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error('Import accepts files up to 128 MB.');
      const imported = validateWorkspace(JSON.parse(await file.text()));
      if (corrupt) {
        if (!storage) throw new Error('Local storage must be available to preserve the unreadable save before recovery.');
        await saveQueue; await storage.recover(imported);
        workspace = imported; corrupt = null; blocked = false; panel.dataset.saved = 'true'; status();
      } else {
        const next = structuredClone(workspace);
        for (const item of imported.sessions) {
          const existing = next.sessions.find(s => s.id === item.id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error('This file has a different version of an existing session. Your current sessions are intact; use another browser to inspect the competing copy.');
          if (!existing) next.sessions.push(item);
        }
        next.activeSessionId = imported.activeSessionId; workspace = validateWorkspace(next); await persist();
      }
      $('outcome').textContent = 'Imported the feeling sessions. Existing sessions were preserved.'; render();
    } catch (e) { status(`Import failed: ${e.message}`, true); }
    finally { busy = false; renderControls(); }
  };
  motion.addEventListener('change', () => {
    sketches.forEach(s => s.configure(session().mode, motion.matches)); sketches.forEach(s => s.setVisible(visible && !document.hidden));
    $('gesture').textContent = motion.matches ? 'Tap or drag to explore. Reduced motion is on.' : session().mode === 'watch' ? 'Watch each attempt, then choose the closest.' : 'Tap or drag inside each view. Arrow keys and space work too.';
  });
  document.addEventListener('visibilitychange', () => { sketches.forEach(s => s.setVisible(visible && !document.hidden)); if (document.hidden && draftTimer) persist(); });
  render();
  const loaded = (async () => {
    let existing = false;
    try {
      storage = await openTasteStorage(); const saved = await storage.load();
      if (saved.corrupt) { corrupt = saved.corrupt; blocked = true; error = saved.error; }
      else if (saved.workspace) { workspace = saved.workspace; existing = true; }
    } catch (e) { error = e.message; }
    ready = true; render();
    panel.dataset.ready = 'true';
    if (error) status(corrupt ? `The saved feeling workspace is unreadable. It has not been changed. Export its backup or import a valid file to recover. ${error}` : `Session only: ${error} Export data to keep your work.`, true);
    else if (existing) panel.dataset.saved = 'true';
    else await persist();
  })();
  return { loaded, captureContext,
    setVisible(value) { visible = value; sketches.forEach(s => s.setVisible(value && !document.hidden)); if (!value && draftTimer) persist(); },
  };
}
