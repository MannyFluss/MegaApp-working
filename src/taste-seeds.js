const sources = ['curtain', 'held-light', 'thread'];
let pending;
export function loadFeelingArtifacts() {
  pending ??= Promise.all(sources.map(async name => {
    const response = await fetch(new URL(`../feeling/${name}.html`, import.meta.url));
    if (!response.ok) throw new Error(`The ${name} HTML artifact could not be loaded (${response.status}).`);
    return { id: `feeling-html-${name}-v1`, kind: 'html', html: await response.text(), createdAt: '2026-10-07T03:32:00.000Z', provenance: { author: 'Codex', description: 'Standalone HTML experience authored for the editable Quiet anticipation starter. Code and behavior are the candidate.' } };
  })).catch(error => { pending = null; throw error; });
  return pending;
}
