// Conversation is editorial guidance, never a source of candidate facts.
function invalid(message) { throw Object.assign(new Error(message), { code: 'invalid_tailoring_context' }); }
export function boundedText(value, field, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`${field} requires 1–${max} printable characters.`);
  return value.trim();
}
export function normalizeTailoringContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('context must be an object.');
  const allowed = ['roleFamily', 'roleThesis', 'companyInterests', 'feedback'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`Unknown context field: ${key}`);
  const result = { roleFamily: boundedText(value.roleFamily, 'roleFamily', 120), companyInterests: [] };
  for (const key of ['roleThesis', 'feedback']) if (value[key] !== undefined) result[key] = boundedText(value[key], key);
  if (value.companyInterests !== undefined) {
    if (!Array.isArray(value.companyInterests) || value.companyInterests.length > 2) invalid('companyInterests accepts at most two interests.');
    result.companyInterests = value.companyInterests.map(text => boundedText(text, 'companyInterest', 1000));
  }
  return result;
}
export function tailoringContext(profile, job) {
  const local = job.tailoringContext || null;
  const reusable = local ? profile.roleNarratives?.[`role:${local.roleFamily.toLowerCase()}`] || null : null;
  return { ...(reusable || {}), ...(local || {}),
    roleThesis: local?.roleThesis || reusable?.roleThesis || '',
    voice: reusable?.voice || profile.preferences?.coverLetterVoice || { samples: [] },
    source: local ? 'user_conversation' : 'not_supplied',
    factsPolicy: 'Editorial guidance only. Candidate claims require current resume or active proof evidence; company interests are user opinions, not verified company facts.' };
}
