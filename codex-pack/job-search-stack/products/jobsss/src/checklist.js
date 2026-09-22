// Pure, dependency-free readiness-gate helper shared by the domain layer and
// the deterministic workspace projection.
//
// This module has its own file so both `src/domain.js` (MCP tools) and
// `src/projection.js`/`src/store.js` (derived Markdown projection) can use ONE
// implementation without an import cycle. It performs no I/O and has no imports.
//
// Semantics are unchanged from the original domain implementation (P1b):
// required questions without a saved answer plus required documents without a
// produced draft. Returns null when the job carries no linked ask list.
export function unansweredRequiredFor(store, job) {
  const detail = job && job.applicationDetail;
  if (!detail || !Array.isArray(detail.questions)) return null;
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const answered = new Set(
    Object.values(store.answers || {})
      .filter(item => item && item.profileId === job.profileId)
      .map(item => norm(item.question))
  );
  const unanswered = [];
  for (const item of detail.questions) {
    if (item && item.required && item.label && !answered.has(norm(item.label))) unanswered.push(String(item.label));
  }
  const artifacts = Object.values(store.artifacts || {})
    .filter(item => item && item.jobId === job.id && item.profileId === job.profileId && !item.retiredAt);
  const hasResume = artifacts.some(item => item.kind === 'resume_draft');
  const hasCover = artifacts.some(item => item.kind === 'cover_letter_draft');
  for (const item of Array.isArray(detail.documents) ? detail.documents : []) {
    if (!item || !item.required) continue;
    if (item.kind === 'resume' && hasResume) continue;
    if (item.kind === 'cover_letter' && hasCover) continue;
    unanswered.push(`Required document: ${item.kind}`);
  }
  return unanswered;
}
