import { createWorkspace, currentSession, judge, undoJudgment, validateWorkspace, generationBrief, createArtifactWorkspace, addArtifactSession, isArtifactRound, artifactFor, installArtifactRound, sameFeelingValue } from './taste-state.js';
import { openTasteStorage } from './taste-storage.js';
import { createTasteSketch } from './taste-sketch.js';
import { createTasteArtifact } from './taste-artifact.js';
import { loadFeelingArtifacts } from './taste-seeds.js';
import { focusedGenerationBrief } from './taste-generation.js';

export function createTaste({ notify, onMoment, connection, openConnection, stateReady } = {}) {
  const panel = document.getElementById('panel-taste');
  const $ = id => panel.querySelector(`#taste-${id}`);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let workspace = createWorkspace(), storage, sketches = [], visible = false, ready = false, blocked = false, corrupt;
  let saveQueue = Promise.resolve(), draftTimer, error = '', busy = false, saveToken = 0;
  let largePreview;
  let generationController, generationNumber = 0;
  const labels = ['A', 'B', 'C'];
  const button = (label, action, className = 'quiet-button') => {
    const node = document.createElement('button'); node.type = 'button'; node.className = className;
    node.textContent = label; node.onclick = action; return node;
  };
  function status(message = '', failed = false, retrySave = false) {
    $('save').textContent = message; $('save').hidden = !message; $('save').dataset.error = String(failed);
    $('retry').hidden = !failed || blocked || !retrySave; $('backup').hidden = !corrupt;
  }
  function download(value, name) {
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  function downloadHTML(artifact) {
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([artifact.html], { type: 'text/html' }));
    link.href = url; link.download = `${artifact.id}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  function updatePreviewVisibility() {
    sketches.forEach(s => s.setVisible(visible && !document.hidden && !$('preview').open));
    largePreview?.setVisible(visible && !document.hidden && $('preview').open);
  }
  function openLarge(artifact, label) {
    largePreview?.dispose(); const frame = document.createElement('iframe'); frame.className = 'taste-large-frame'; frame.title = `Live HTML attempt ${label}, larger view`;
    $('preview-body').replaceChildren(frame); $('preview-title').textContent = `Live attempt ${label}`;
    largePreview = createTasteArtifact(frame, artifact, { onIssue: message => { $('preview-issue').hidden = !message; $('preview-issue').textContent = message ? `Runtime reported: ${message}` : ''; } }); $('preview-download').onclick = () => downloadHTML(artifact);
    $('preview').showModal(); updatePreviewVisibility(); $('preview-close').focus();
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
        await storage.save(snapshot); if (token === saveToken) { error = ''; status(); panel.dataset.saved = 'true'; }
      } catch (e) {
        error = e.message;
        panel.dataset.saved = 'session';
        if (/Another tab/.test(error)) { blocked = true; renderControls(); }
        status(`${error} Your current session is still available through Export data.`, true, !!storage);
      }
    });
    return saveQueue;
  }
  function session() { return currentSession(workspace); }
  function available() { return ready && !blocked && !busy; }
  function renderControls() {
    for (const node of panel.querySelectorAll('[data-taste-edit]')) node.disabled = !available();
    for (const node of panel.querySelectorAll('[data-taste-judge]')) node.disabled = !available() || !!session().waitingForArtifacts;
    $('note').disabled = $('match').disabled = !available() || !!session().waitingForArtifacts;
    $('undo').disabled = !available() || !session().feedback.some(r => !r.voided);
    $('export').disabled = !ready || !!corrupt; $('brief').disabled = !ready || !!corrupt;
    $('import').disabled = !ready || busy || (blocked && !corrupt);
    $('import').textContent = session().waitingForArtifacts ? 'Import next round' : 'Import data';
    $('next-actions').hidden = !session().waitingForArtifacts;
    $('next-brief').disabled = !ready || !!corrupt; $('next-import').disabled = $('import').disabled;
    $('generate').hidden = !isArtifactRound(session());
    $('generate').disabled = !available();
    $('generate').textContent = connection?.info().connected ? 'Generate three' : 'Ollama setup';
    $('cancel-generation').hidden = !generationController;
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
    const htmlRound = isArtifactRound(value); panel.dataset.format = htmlRound ? 'html' : 'sketch';
    $('target').value = value.draft.target ?? value.target; $('note').value = value.draft.note; $('match').value = value.draft.match;
    $('round').textContent = `Round ${value.round.index}`;
    $('mode').hidden = htmlRound; $('start').textContent = htmlRound ? 'Try this feeling' : 'Try HTML artifacts';
    $('method').textContent = htmlRound ? connection?.info().connected ? 'Ollama creates complete HTML programs from your target and saved feedback. A choice generates the next three.' : 'These are runnable HTML artifacts. Export the AI brief and import the next code round; Ollama setup is in Meta.' : 'This saved session uses the earlier parameter sketches. Try HTML artifacts to start a code session.';
    $('mode').setAttribute('aria-pressed', String(value.mode === 'watch'));
    $('mode').textContent = value.mode === 'watch' ? 'Return to touch' : 'Watch motion';
    $('gesture').textContent = htmlRound ? 'Try each live experience. Open larger to give it more room.' : motion.matches ? 'Tap or drag to explore. Reduced motion is on.' : value.mode === 'watch' ? 'Watch each attempt, then choose the closest.' : 'Tap or drag inside each view. Arrow keys and space work too.';
    value.round.candidates.forEach((candidate, index) => {
      const section = document.createElement('section'); section.className = 'taste-attempt'; section.dataset.candidateId = candidate.id;
      const artifact = artifactFor(workspace, candidate);
      const canvas = document.createElement(artifact ? 'iframe' : 'canvas'); canvas.className = artifact ? 'taste-frame' : 'taste-canvas';
      if (artifact) canvas.title = `Live HTML attempt ${labels[index]}`;
      else { canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Live attempt ${labels[index]}. Tap, drag, or use arrow keys and space to explore.`); }
      canvas.setAttribute('aria-describedby', 'taste-gesture');
      const footer = document.createElement('div'); footer.className = 'taste-attempt-footer';
      const label = document.createElement('span'); label.textContent = labels[index]; label.className = 'taste-letter';
      const choose = button('Closest to the feeling', () => pick(candidate.id), 'primary-button taste-choose');
      choose.setAttribute('aria-label', `Choose ${labels[index]} as closest to the feeling`); choose.setAttribute('data-taste-edit', '');
      choose.setAttribute('data-taste-judge', '');
      footer.append(label, choose); section.append(canvas, footer); views.append(section);
      if (artifact) {
        const actions = document.createElement('div'); actions.className = 'taste-artifact-actions';
        actions.append(button('Open larger', () => openLarge(artifact, labels[index])), button('Save HTML', () => downloadHTML(artifact)));
        const details = document.createElement('details'), summary = document.createElement('summary'), source = document.createElement('textarea');
        summary.textContent = 'Source'; source.readOnly = true; source.value = artifact.html; source.setAttribute('aria-label', `HTML source for attempt ${labels[index]}`); source.className = 'taste-source';
        details.append(summary, source); section.append(actions, details);
      }
      const issue = document.createElement('p'); issue.className = 'taste-runtime-issue'; issue.hidden = true;
      if (artifact) section.append(issue);
      const sketch = artifact ? createTasteArtifact(canvas, artifact, { onIssue: message => { issue.hidden = !message; issue.textContent = message ? `Runtime reported: ${message}` : ''; } }) : createTasteSketch(canvas, candidate, { mode: value.mode, reduced: motion.matches });
      sketches.push(sketch); sketch.setVisible(visible && !document.hidden && !$('preview').open);
    });
    if (value.waitingForArtifacts) $('outcome').textContent = 'Choice saved. Export the AI brief to generate three new HTML artifacts, then import their round bundle.';
    renderHistory(); renderControls();
  }
  function captureContext() {
    const value = session();
    return { app: 'taste', coverage: 'Current target, candidate identities and latest explicit judgment. Exact HTML source lives in the Feeling export; arbitrary iframe input is not recorded by the shell.', feeling: { sessionId: value.id, target: value.target, round: value.round, mode: value.mode, comparisons: value.feedback.filter(r => !r.voided).length, lastJudgment: value.feedback.findLast(r => !r.voided) || null, generation: isArtifactRound(value) ? 'Runnable HTML artifacts; next code round imports against the saved judgment.' : 'Legacy local parameter search.' } };
  }
  function pick(choice) {
    if (!available()) return;
    try {
      const previous = session(), selected = previous.round.candidates.findIndex(c => c.id === choice);
      const presentation = isArtifactRound(previous) ? { version: 1, renderer: 'opaque-srcdoc-v1', width: innerWidth, height: innerHeight, reducedMotion: motion.matches, views: [...panel.querySelectorAll('.taste-attempt')].map((view, index) => { const rect = view.querySelector('iframe').getBoundingClientRect(); return { id: view.dataset.candidateId, width: rect.width, height: rect.height, diagnostics: sketches[index].diagnostics() }; }) } : null;
      workspace = judge(workspace, choice, { observations: sketches.map(s => s.observation()).filter(Boolean), presentation });
      render(); persist();
      if (session().waitingForArtifacts) $('next-brief').focus({ preventScroll: true });
      else if (selected >= 0) panel.querySelectorAll('.taste-choose')[selected]?.focus({ preventScroll: true });
      $('outcome').textContent = session().waitingForArtifacts ? `Choice saved${selected >= 0 ? ` for ${labels[selected]}` : ''}. Export the AI brief for three new HTML artifacts, then import the round bundle.` : selected >= 0 ? `Kept ${labels[selected]} and made two alternatives.` : choice === 'none' ? 'Trying three different directions.' : 'Kept the uncertainty and made three new attempts.';
      onMoment?.({ kind: 'action', app: 'taste', action: 'Compare feeling attempts', outcome: $('outcome').textContent, context: captureContext() });
      if (session().waitingForArtifacts && connection?.info().connected) generateNext();
    } catch (e) { status(e.message, true); }
  }
  $('none').onclick = () => pick('none'); $('tie').onclick = () => pick('tie');
  $('undo').onclick = () => {
    if (!available()) return;
    workspace = undoJudgment(workspace); render(); persist(); $('outcome').textContent = 'Returned to the previous three. The corrected choice is kept in your export.';
  };
  $('start').onclick = async () => {
    if (!available()) return;
    let created = false;
    try {
      const target = $('target').value.trim();
      if (target === session().target && isArtifactRound(session())) { $('outcome').textContent = 'Already exploring this feeling. Choose an attempt below.'; return; }
      busy = true; saveToken++; panel.dataset.saved = 'false'; renderControls();
      const artifacts = await loadFeelingArtifacts();
      const previous = structuredClone(workspace); currentSession(previous).draft.target = session().target;
      workspace = addArtifactSession(previous, target, artifacts); created = true; render(); await persist(); $('outcome').textContent = 'Started a runnable HTML session. Your previous feeling is kept in History & data.';
    } catch (e) { status(e.message, true); }
    finally { busy = false; renderControls(); }
    if (created && connection?.info().connected && isArtifactRound(session())) generateNext();
  };
  async function generateNext() {
    if (!available()) return;
    if (!connection?.info().connected) { openConnection?.(); return; }
    const number = ++generationNumber, controller = new AbortController(); generationController = controller;
    busy = true; renderControls(); $('outcome').textContent = `Ollama is writing three experiences with ${connection.info().model}… Your current code is kept until the new round is ready.`;
    try {
      await persist();
      const brief = focusedGenerationBrief(workspace);
      const bundle = await connection.generate(brief, { signal: controller.signal });
      if (controller.signal.aborted || number !== generationNumber) return;
      workspace = installArtifactRound(workspace, bundle); render(); await persist();
      $('outcome').textContent = 'Three new HTML programs are ready. Try them and choose the closest to your feeling.';
      onMoment?.({ kind: 'action', app: 'taste', action: 'Generate feeling code', outcome: 'Three validated HTML programs installed', context: captureContext() });
    } catch (error) {
      if (number === generationNumber) $('outcome').textContent = controller.signal.aborted ? 'Generation canceled. Your preceding programs and feedback are kept.' : `${error.message} Your preceding programs and feedback are kept.`;
    } finally { if (number === generationNumber) { generationController = null; busy = false; renderControls(); } }
  }
  $('generate').onclick = generateNext;
  $('cancel-generation').onclick = () => { generationController?.abort(); };
  connection?.subscribe(() => { renderControls(); if (isArtifactRound(session())) $('method').textContent = connection.info().connected ? 'Ollama creates complete HTML programs from your target and saved feedback. A choice generates the next three.' : 'These are runnable HTML artifacts. Export the AI brief and import the next code round; Ollama setup is in Meta.'; });
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
  $('next-brief').onclick = $('brief').onclick;
  $('backup').onclick = () => download(corrupt, 'unreadable-feeling-backup.json');
  $('retry').onclick = () => persist();
  $('import').onclick = () => $('file').click();
  $('next-import').onclick = $('import').onclick;
  $('file').onchange = async () => {
    const file = $('file').files[0]; $('file').value = ''; if (!file) return;
    busy = true; renderControls();
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error('Import accepts files up to 128 MB.');
      const raw = JSON.parse(await file.text());
      if (raw.format === 'megaapp-feeling-round') {
        if (blocked) throw new Error('Recover or reload your workspace before importing a code round.');
        workspace = installArtifactRound(workspace, raw); await persist(); render(); $('outcome').textContent = 'Loaded three new HTML artifacts from the saved feedback.';
        return;
      }
      const imported = validateWorkspace(raw);
      if (corrupt) {
        if (!storage) throw new Error('Local storage must be available to preserve the unreadable save before recovery.');
        await saveQueue; await storage.recover(imported);
        workspace = imported; corrupt = null; blocked = false; panel.dataset.saved = 'true'; status();
      } else {
        const next = structuredClone(workspace);
        for (const artifact of imported.artifacts) {
          const existing = next.artifacts.find(a => a.id === artifact.id);
          if (existing && !sameFeelingValue(existing, artifact)) throw new Error('An existing artifact identity has different source. Your original is intact.');
          if (!existing) next.artifacts.push(artifact);
        }
        for (const item of imported.sessions) {
          const existing = next.sessions.find(s => s.id === item.id);
          if (existing && !sameFeelingValue(existing, item)) throw new Error('This file has a different version of an existing session. Your current sessions are intact; use another browser to inspect the competing copy.');
          if (!existing) next.sessions.push(item);
        }
        next.activeSessionId = imported.activeSessionId; workspace = validateWorkspace(next); await persist();
      }
      $('outcome').textContent = 'Imported the feeling sessions. Existing sessions were preserved.'; render();
    } catch (e) { status(`Import failed: ${e.message}`, true); }
    finally { busy = false; renderControls(); }
  };
  motion.addEventListener('change', () => {
    sketches.forEach(s => s.configure(session().mode, motion.matches)); updatePreviewVisibility();
    $('gesture').textContent = isArtifactRound(session()) ? 'Try each live experience. Open larger to give it more room.' : motion.matches ? 'Tap or drag to explore. Reduced motion is on.' : session().mode === 'watch' ? 'Watch each attempt, then choose the closest.' : 'Tap or drag inside each view. Arrow keys and space work too.';
  });
  $('preview-close').onclick = () => $('preview').close();
  $('preview').addEventListener('close', () => { largePreview?.dispose(); largePreview = null; $('preview-body').replaceChildren(); updatePreviewVisibility(); });
  document.addEventListener('visibilitychange', () => { updatePreviewVisibility(); if (document.hidden && draftTimer) persist(); });
  render();
  const loaded = (async () => {
    let existing = false;
    try {
      storage = await openTasteStorage({ stateReady }); const saved = await storage.load();
      if (saved.corrupt) { corrupt = saved.corrupt; blocked = true; error = saved.error; }
      else if (saved.workspace) { workspace = saved.workspace; existing = true; }
    } catch (e) { error = e.message; }
    if (!existing && !corrupt) {
      try { workspace = createArtifactWorkspace('Quiet anticipation', await loadFeelingArtifacts()); }
      catch (e) { error = `HTML candidates could not load: ${e.message}`; }
    }
    ready = true; render();
    panel.dataset.ready = 'true';
    if (error) status(corrupt ? `The saved feeling workspace is unreadable. It has not been changed. Export its backup or import a valid file to recover. ${error}` : `Session only: ${error} Export data to keep your work.`, true);
    else if (existing) panel.dataset.saved = 'true';
    else await persist();
  })();
  return { loaded, captureContext,
    async replaceSavedWorkspace(value, commit) {
      const next = value == null ? createArtifactWorkspace('Quiet anticipation', await loadFeelingArtifacts()) : validateWorkspace(value);
      await loaded; clearTimeout(draftTimer); draftTimer = undefined;
      generationController?.abort(); generationNumber++; generationController = null; busy = false;
      await saveQueue; await commit();
      // Refresh the adapter's revision before subsequent app edits.
      const saved = await storage.load({ migrateLegacy: false });
      workspace = saved.workspace || next; corrupt = null; blocked = false;
      render(); panel.dataset.saved = 'true';
      if (!saved.workspace) await persist();
    },
    setVisible(value) { visible = value; if (!value && $('preview').open) $('preview').close(); updatePreviewVisibility(); if (!value && draftTimer) persist(); },
  };
}
