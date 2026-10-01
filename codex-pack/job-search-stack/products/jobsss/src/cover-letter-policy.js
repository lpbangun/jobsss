// One policy for individual drafts, batches, tasks, and read-only briefs.
// Missing or degraded application detail is unknown, never a complete form.
export function coverLetterDecision(job = {}, requestedByUser) {
  if (requestedByUser !== undefined && typeof requestedByUser !== 'boolean') {
    throw Object.assign(new Error('requestedByUser must be a boolean.'), { code: 'invalid_cover_letter_request' });
  }
  const evidence = [];
  const add = (state, source, text) => evidence.push({ state, source, text });
  const texts = [...new Set([job.postingText, job.description].filter(value => typeof value === 'string' && value.trim()))];
  for (const text of texts) {
    const plain = text.replace(/<\/?(?:p|div|li|br|section|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/[’‘]/g, "'");
    for (const clause of plain.split(/[\n.!?;]+/)) {
      const sentence = clause.trim();
      if (!/\bcover[\s-]+letters?\b/i.test(sentence)) continue;
      const letter = 'cover[\\s-]+letters?';
      const matches = pattern => new RegExp(pattern, 'i').test(sentence);
      let state;
      if (matches(`(?:do not|don't|must not|please don't|never)\\s+(?:submit|send|include|attach|upload|provide)\\b.{0,60}${letter}`)
        || matches(`${letter}.{0,40}(?:not accepted|will not be (?:accepted|considered)|should not be (?:submitted|included)|must not be (?:submitted|included))`)
        || matches(`no\\s+${letter}.{0,25}(?:accepted|allowed)`)) state = 'prohibited';
      else if (matches(`(?:no|without)\\s+(?:a\\s+)?${letter}\\b`)
        || matches(`${letter}.{0,35}(?:not (?:required|needed|necessary|mandatory)|isn't (?:required|needed|necessary|mandatory)|is not needed|is unnecessary)`)
        || matches(`(?:do not|don't)\\s+(?:require|need)\\b.{0,35}${letter}`)
        || matches(`not (?:required|necessary)\\s+to\\s+(?:submit|include|provide|attach)\\b.{0,35}${letter}`)) state = 'not_required';
      else if (matches(`(?:optional|encouraged|welcome|if you (?:wish|want)|may (?:submit|include|provide|attach)).{0,60}${letter}|${letter}.{0,60}(?:optional|encouraged|welcome|if you (?:wish|want))`)) state = 'optional';
      else if (matches(`${letter}.{0,35}(?:required|mandatory|must be (?:submitted|included|attached))|(?:require|required|must|please|submit|send|include|attach|provide|upload)\\b.{0,60}${letter}`)) state = 'required';
      if (state) add(state, 'posting', sentence);
    }
  }
  const detail = job.applicationDetail;
  const complete = Boolean(detail && Array.isArray(detail.documents)
    && !detail.degraded && detail.status !== 'degraded' && detail.source !== 'degraded'
    && (job.detailCoverage?.status === 'ok' || detail.status === 'ok'));
  if (complete) {
    const documents = detail.documents.filter(item => item?.kind === 'cover_letter');
    if (documents.length) add(documents.some(item => item.required) ? 'required' : 'optional', 'application_form', 'Cover-letter upload field');
    else add('not_requested', 'application_form', 'Complete application form has no cover-letter field');
  }
  const states = new Set(evidence.map(item => item.state));
  const state = states.has('prohibited') ? 'prohibited'
    : states.has('required') && states.has('not_required') ? 'conflict'
    : states.has('required') ? 'required'
    : states.has('not_required') ? 'not_required'
    : states.has('optional') ? 'optional'
    : states.has('not_requested') ? 'not_requested' : 'unknown';
  const draft = state !== 'prohibited' && requestedByUser !== false
    && (requestedByUser === true || state === 'required');
  const reason = state === 'prohibited' ? 'employer_prohibits_cover_letter'
    : requestedByUser === false ? 'user_declined'
    : requestedByUser === true ? 'user_requested'
    : state === 'required' ? 'employer_requested'
    : state === 'conflict' ? 'conflicting_requirements'
    : state === 'unknown' ? 'requirements_unknown' : `employer_${state}`;
  return { schema: 'jobsss.cover-letter-decision/v1', state, draft, reason, evidence,
    requestedByUser: requestedByUser ?? null };
}
