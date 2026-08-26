// Deterministic offline multidimensional fit scoring for the standalone journey.
// Attributed port: adapted from JobOS src/scoring.js `finalizeFitScore` and
// `deterministicProposal` (jobos.fit-score.v1 contract, seven weighted
// dimensions, JobOS scoreStatus semantics), reimplemented for the standalone
// bundled runtime using plain JSON profile/job objects with no external
// provider. JobOS remains MIT (see root LICENSE) and is never imported.
//
// Contract (BENCHMARK.md B19):
//   - returns jobos.fit-score.v1 in deterministic-degraded mode, provider null
//   - all seven dimensions: roleFit 28, domainFit 18, seniority 14,
//     locationWorkModel 12, compensation 8, missionInterest 14, networkAccess 6
//   - every dimension carries a weight and a human-readable reason
//   - scoreStatus follows JobOS semantics (scored / review_required /
//     insufficient_evidence)
//   - no external providers or API keys; no invented facts beyond local evidence
import { tokenize } from './store.js';

export const FIT_CONTRACT = 'jobos.fit-score.v1';

export const FIT_DIMENSION_WEIGHTS = Object.freeze({
  roleFit: 28,
  domainFit: 18,
  seniority: 14,
  locationWorkModel: 12,
  compensation: 8,
  missionInterest: 14,
  networkAccess: 6,
});

const DIMENSION_KEYS = Object.freeze(Object.keys(FIT_DIMENSION_WEIGHTS));

function clampInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function fieldRef(job, field) {
  return { kind: 'job_field', id: String(job?.id || ''), field };
}

function uniqueEvidence(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const key = `${value.kind}:${value.id}:${value.field || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function unknownDimension(key, reason, evidenceRefs = []) {
  return { status: 'unknown', score: null, weight: FIT_DIMENSION_WEIGHTS[key], reason, evidenceRefs: uniqueEvidence(evidenceRefs) };
}

function scoredDimension(key, scoreValue, reason, evidenceRefs = []) {
  return { status: 'scored', score: clampInteger(scoreValue), weight: FIT_DIMENSION_WEIGHTS[key], reason, evidenceRefs: uniqueEvidence(evidenceRefs) };
}

function tokenScore(candidateText, jobText, { base = 20, perHit = 15, ceiling = 95 } = {}) {
  const candidate = [...new Set(tokenize(candidateText).filter(value => value.length > 1))];
  const job = new Set(tokenize(jobText));
  const hits = candidate.filter(value => job.has(value));
  return { score: Math.min(ceiling, base + hits.length * perHit), hits };
}

function profileEvidence(profile) {
  const refs = [];
  if (String(profile?.name || '').trim()) refs.push({ kind: 'profile_preference', id: String(profile.id || ''), field: 'name' });
  if (String(profile?.preferences_json || '').trim()) refs.push({ kind: 'profile_preference', id: String(profile.id || ''), field: 'preferences' });
  const proofPoints = profile?.proofPoints || [];
  for (const proof of proofPoints) {
    if (proof?.id) refs.push({ kind: 'proof_point', id: String(proof.id) });
  }
  return uniqueEvidence(refs);
}

function proofSignals(profile) {
  const prefs = {};
  try {
    const parsed = typeof profile?.preferences_json === 'string' ? JSON.parse(profile.preferences_json) : (profile?.preferences || {});
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(prefs, parsed);
  } catch {
    // ignore malformed preferences; fall through to resume-derived evidence
  }
  const proofs = Array.isArray(profile?.proofPoints) ? profile.proofPoints : [];
  const proofText = proofs.map(proof => `${proof?.summary || ''} ${Array.isArray(proof?.skills) ? proof.skills.join(' ') : ''}`).join(' ');
  return { prefs, proofs, proofText };
}

function parseCompensation(job) {
  const text = String(job?.compensation || job?.description || '');
  const structured = job?.compensationJson && typeof job.compensationJson === 'object' ? job.compensationJson : {};
  let min = structured?.min, max = structured?.max;
  if (min == null && max == null) {
    const match = text.match(/\$\s?([\d,]+)(?:\s*-\s*\$?\s?([\d,]+))?/i);
    if (match) {
      min = Number(match[1].replaceAll(',', ''));
      max = match[2] ? Number(match[2].replaceAll(',', '')) : min;
    }
  }
  return {
    text,
    min: min == null || min === '' ? null : Number(min),
    max: max == null || max === '' ? null : Number(max),
  };
}

function deterministicProposal({ profile, job }) {
  const { prefs, proofs, proofText } = proofSignals(profile);
  const resume = String(profile?.resumeText || '');
  const name = String(profile?.name || '');
  const fullCandidate = `${name}\n${resume}\n${proofText}`;
  const jobText = [
    job?.title || '',
    job?.company || '',
    job?.location || '',
    job?.workModel || '',
    job?.description || '',
    Array.isArray(job?.requirements) ? job.requirements.join('\n') : '',
  ].join('\n');
  const fullText = `${jobText}\n${String(job?.description || '')}`;

  // Candidate role / domain preferences: explicit if present, else resume+proof derived.
  const rolePreference = [
    ...(Array.isArray(prefs.targetRoleFamilies) ? prefs.targetRoleFamilies : []),
    ...(Array.isArray(prefs.skills) ? prefs.skills : []),
    resume,
    proofText,
  ].filter(Boolean).join(' ');
  const domainPreference = [
    ...(Array.isArray(prefs.industries) ? prefs.industries : []),
    ...(Array.isArray(prefs.missionKeywords) ? prefs.missionKeywords : []),
    resume,
    proofText,
  ].filter(Boolean).join(' ');

  const dimensions = {};
  const pRefs = profileEvidence(profile);

  // roleFit (28)
  const role = tokenScore(rolePreference, `${job?.title || ''}\n${jobText}`, { base: 20, perHit: 15, ceiling: 95 });
  dimensions.roleFit = scoredDimension(
    'roleFit',
    role.score,
    `Role fit compares resume and isolated proof signals against the posting title and requirements: ${role.hits.length} overlapping token(s).`,
    [...pRefs, fieldRef(job, 'title')]
  );

  // domainFit (18)
  const domain = tokenScore(domainPreference, fullText, { base: 20, perHit: 12, ceiling: 90 });
  dimensions.domainFit = scoredDimension(
    'domainFit',
    domain.score,
    `Domain fit compares resume/proof domain language against the full posting: ${domain.hits.length} overlapping token(s).`,
    [...pRefs, fieldRef(job, 'description')]
  );

  // seniority (14)
  const target = String(prefs.targetRoleFamilies?.[0] || name) || '';
  if (!String(job?.title || '').trim() || !target.trim()) {
    dimensions.seniority = unknownDimension('seniority', 'Seniority cannot be compared without a posting title and a candidate target role.', [fieldRef(job, 'title')]);
  } else {
    const seniorTerms = /\b(senior|staff|principal|lead|head of|director|executive|sr\.?|vp|vice president)\b/i;
    const jobSenior = seniorTerms.test(`${job.title}\n${jobText}`);
    const profileSenior = seniorTerms.test(`${target}\n${resume}`);
    const scoreValue = jobSenior && !profileSenior ? 55 : jobSenior && profileSenior ? 85 : !jobSenior && profileSenior ? 65 : 75;
    dimensions.seniority = scoredDimension(
      'seniority',
      scoreValue,
      `Seniority compares explicit level language in the posting with candidate target-role/resume evidence (job senior: ${jobSenior}, candidate senior: ${profileSenior}).`,
      [...pRefs, fieldRef(job, 'title')]
    );
  }

  // locationWorkModel (12)
  const candidateLocation = [...(Array.isArray(prefs.locations) ? prefs.locations : []), String(prefs.workModel || '')]
    .filter(Boolean).join(' ') || resume;
  const jobLocation = [job?.location || '', job?.workModel && job.workModel !== 'unknown' ? job.workModel : ''].filter(Boolean).join(' ');
  if (!candidateLocation.trim() || !jobLocation.trim()) {
    dimensions.locationWorkModel = unknownDimension('locationWorkModel', 'Location or work-model evidence is missing on the candidate or posting side.', [fieldRef(job, 'location')]);
  } else {
    const candidateRemote = /\bremote\b/i.test(candidateLocation);
    const jobOnsite = /\b(on[- ]?site|in office|five days|5 days)\b/i.test(`${jobLocation}\n${job?.description || ''}`) && !/remote work is available/i.test(String(job?.description || ''));
    const jobRemote = /\bremote\b/i.test(`${jobLocation}\n${job?.description || ''}`);
    const locationMatch = tokenScore(candidateLocation, `${jobLocation}\n${job?.description || ''}`, { base: 40, perHit: 20, ceiling: 90 });
    const scoreValue = candidateRemote && jobOnsite ? 10 : candidateRemote && jobRemote ? 90 : locationMatch.score;
    dimensions.locationWorkModel = scoredDimension(
      'locationWorkModel',
      scoreValue,
      `Location and work-model fit compares the candidate's stated location/work-model preference with posting location/work-model evidence.`,
      [...pRefs, fieldRef(job, 'location')]
    );
  }

  // compensation (8)
  const salary = prefs.salary && typeof prefs.salary === 'object' ? prefs.salary : {};
  const candidateMinimum = Number(salary.min);
  const compensation = parseCompensation(job);
  if (!Number.isFinite(candidateMinimum) || candidateMinimum <= 0 || (compensation.max === null && !compensation.text.trim())) {
    dimensions.compensation = unknownDimension('compensation', 'Candidate salary preference or posting compensation evidence is missing.', [fieldRef(job, 'description')]);
  } else {
    let scoreValue = 65;
    if (/equity only|no salary|no cash compensation/i.test(compensation.text)) scoreValue = 0;
    else if (compensation.max !== null && compensation.max < candidateMinimum) scoreValue = 20;
    else if (compensation.max !== null) scoreValue = 85;
    dimensions.compensation = scoredDimension(
      'compensation',
      scoreValue,
      `Compensation fit compares the candidate salary floor with direct posting compensation evidence.`,
      [...pRefs, fieldRef(job, 'description')]
    );
  }

  // missionInterest (14)
  const missionPreference = [
    ...(Array.isArray(prefs.missionKeywords) ? prefs.missionKeywords : []),
    ...(Array.isArray(prefs.values) ? prefs.values : []),
    resume,
    proofText,
  ].filter(Boolean).join(' ');
  if (!missionPreference.trim() || !String(job?.description || '').trim()) {
    dimensions.missionInterest = unknownDimension('missionInterest', 'Mission/value preference or posting mission evidence is missing.', [fieldRef(job, 'description')]);
  } else {
    const mission = tokenScore(missionPreference, fullText, { base: 25, perHit: 12, ceiling: 85 });
    dimensions.missionInterest = scoredDimension(
      'missionInterest',
      mission.score,
      `Mission interest compares candidate mission/value/domain language with posting description evidence: ${mission.hits.length} overlapping token(s).`,
      [...pRefs, fieldRef(job, 'description')]
    );
  }

  // networkAccess (6) — no people-research run exists in the standalone runtime.
  dimensions.networkAccess = unknownDimension('networkAccess', 'No completed people-research run provides local network-path evidence.');

  const constraints = [];
  // Remote-candidate / on-site-job contradiction, only when the candidate states a remote preference.
  const candidateRemote = /\bremote\b/i.test(String(prefs.workModel || '')) || /\bremote\b/i.test(resume);
  const jobOnsiteText = String(job?.description || '');
  const jobOnsite = /\b(on[- ]?site|in office|five days|5 days)\b/i.test(`${job?.location || ''}\n${job?.workModel || ''}\n${jobOnsiteText}`) && !/remote work is available/i.test(jobOnsiteText);
  if (candidateRemote && jobOnsite) {
    constraints.push({
      id: `constraint-${job?.id}-remote-onsite`,
      kind: 'contradiction',
      dimension: 'locationWorkModel',
      status: 'confirmed',
      preferenceRef: { kind: 'profile_preference', id: String(profile?.id || ''), field: 'workModel' },
      jobEvidenceRefs: [fieldRef(job, 'work_model'), fieldRef(job, 'description')],
      reason: 'The candidate states a remote work-model preference while the posting shows a direct on-site requirement.',
    });
    dimensions.locationWorkModel = { ...dimensions.locationWorkModel, status: 'contradicted', score: Math.min(dimensions.locationWorkModel.score ?? 10, 10) };
  }
  for (const [index, raw] of (Array.isArray(prefs.dealbreakers) ? prefs.dealbreakers : []).entries()) {
    const dealbreaker = String(raw || '').trim();
    if (!dealbreaker) continue;
    const normalized = dealbreaker.toLowerCase();
    let matched = false;
    let unknown = true;
    let dimension = 'roleFit';
    let evidence = fieldRef(job, 'description');
    if (/equity.*only|no cash|no salary/.test(normalized)) {
      dimension = 'compensation';
      evidence = fieldRef(job, 'compensation');
      matched = /equity only|no salary|no cash compensation/.test(compensation.text.toLowerCase());
      unknown = !/equity only|no salary|no cash compensation/.test(compensation.text.toLowerCase());
    } else if (/remote|on[- ]?site|office/.test(normalized) && candidateRemote) {
      dimension = 'locationWorkModel';
      evidence = fieldRef(job, 'location');
      matched = jobOnsite;
      unknown = !matched && !jobOnsite;
    }
    constraints.push({
      id: `constraint-${job?.id}-dealbreaker-${index}`,
      kind: 'dealbreaker',
      dimension,
      status: matched ? 'confirmed' : unknown ? 'unknown' : 'cleared',
      preferenceRef: { kind: 'profile_preference', id: String(profile?.id || ''), field: 'dealbreakers' },
      jobEvidenceRefs: matched ? [evidence] : [],
      reason: matched
        ? `The explicit dealbreaker “${dealbreaker}” matches direct structured posting evidence.`
        : unknown
          ? `The posting does not contain enough structured evidence to clear or confirm the explicit dealbreaker “${dealbreaker}”.`
          : `Direct structured posting evidence does not trigger the explicit dealbreaker “${dealbreaker}”.`,
    });
  }

  const postingRisks = [
    'urgent',
    'immediate start',
    'must hit ground running',
    'guaranteed',
    'unlimited earning',
    'no experience necessary',
    'work from home — no skills',
    'act now',
  ]
    .filter(term => fullText.toLowerCase().includes(term))
    .map(term => ({
      code: `posting_risk_${term.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      status: 'observed',
      reason: `The posting contains review signal “${term}”. This is non-numeric and requires diligence.`,
      evidenceRefs: [fieldRef(job, 'description')],
    }));

  return {
    dimensions,
    constraints,
    postingRisks,
    reasoning: 'Deterministic degraded scoring finalized resume/proof-derived preferences, structured job evidence, and local evidence without hidden boosts or penalties.',
  };
}

function finalizeFitScore(proposal, { profile, job }) {
  const dimensions = {};
  for (const key of DIMENSION_KEYS) {
    const value = proposal.dimensions?.[key];
    if (!value || typeof value !== 'object') throw new Error(`Missing fit dimension: ${key}`);
    dimensions[key] = { ...value, weight: FIT_DIMENSION_WEIGHTS[key] };
  }
  const constraints = Array.isArray(proposal.constraints) ? proposal.constraints : [];
  const postingRisks = Array.isArray(proposal.postingRisks) ? proposal.postingRisks : [];
  const known = Object.values(dimensions).filter(value => value.status !== 'unknown');
  const knownWeight = known.reduce((sum, value) => sum + Number(value.weight || 0), 0);
  const evidenceCoverage = Math.max(0, Math.min(100, knownWeight));
  const coreKnown = dimensions.roleFit.status !== 'unknown' && dimensions.seniority.status !== 'unknown';
  const sufficient = coreKnown && knownWeight >= 70;
  const baseOverall = sufficient
    ? Math.max(0, Math.min(100, Math.round(known.reduce((sum, value) => sum + value.weight * value.score, 0) / knownWeight)))
    : null;
  const confirmedDealbreaker = constraints.some(value => value.kind === 'dealbreaker' && value.status === 'confirmed');
  const confirmedContradiction = constraints.some(value => value.kind === 'contradiction' && value.status === 'confirmed');
  const unresolvedConstraint = constraints.some(value => ['possible', 'unknown'].includes(value.status));
  let overall = baseOverall;
  let scoreStatus = 'scored';
  if (confirmedDealbreaker) {
    overall = 0;
    scoreStatus = 'review_required';
  } else if (!sufficient) {
    overall = null;
    scoreStatus = 'insufficient_evidence';
  } else if (confirmedContradiction) {
    overall = Math.min(baseOverall, 59);
    scoreStatus = 'review_required';
  } else if (evidenceCoverage < 85 || unresolvedConstraint) {
    scoreStatus = 'review_required';
  }
  const noConstraintConcern = !confirmedDealbreaker && !confirmedContradiction && !unresolvedConstraint;
  const confidence = evidenceCoverage === 100 && noConstraintConcern
    ? 'high'
    : evidenceCoverage >= 85 && noConstraintConcern
      ? 'medium'
      : 'low';
  return {
    contract: FIT_CONTRACT,
    jobId: String(job?.id || ''),
    profileId: String(profile?.id || ''),
    overall,
    baseOverall,
    scoreStatus,
    evidenceCoverage,
    confidence,
    mode: 'deterministic-degraded',
    dimensions,
    constraints,
    postingRisks,
    reasoning: String(proposal.reasoning || 'Fit was finalized from the displayed evidence-backed dimensions.'),
    provider: null,
    providerError: null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic offline multidimensional fit score for one profile/job pair.
 * No external provider or API key is used. Returns the jobos.fit-score.v1
 * contract with all seven weighted dimensions.
 */
export function localScore({ profile, job }) {
  const proposal = deterministicProposal({ profile, job });
  return finalizeFitScore(proposal, { profile, job });
}
