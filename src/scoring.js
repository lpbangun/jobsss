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
import { parseCompensation } from './compensation.js';

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
  const stop = new Set('the and with from this that for not no only work role team years experience candidate required source fictional internal profile have has was were are into after before during through then than their they them about over under'.split(' '));
  const candidate = [...new Set(tokenize(candidateText).filter(value => value.length > 2 && !stop.has(value) && !/^\d+$/.test(value)))];
  const job = new Set(tokenize(jobText));
  const hits = candidate.filter(value => job.has(value));
  return { score: Math.min(ceiling, base + (candidate.length ? hits.length / Math.sqrt(candidate.length) : 0) * perHit), hits };
}

function profileEvidence(profile) {
  const refs = [];
  if (String(profile?.resumeText || '').trim()) refs.push({ kind: 'profile_field', id: String(profile.id || ''), field: 'resumeText' });
  if (profile?.preferences_json || profile?.preferences) refs.push({ kind: 'profile_preference', id: String(profile.id || ''), field: 'preferences' });
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


function requiresOffice(text) {
  const stated = String(text || '').replace(/\b(?:no|not|without)\s+(?:required\s+)?(?:weekly\s+)?(?:office attendance|on[- ]?site work|in[- ]office work)/gi, '');
  return /\b(?:required (?:weekly )?office attendance|weekly office attendance|must (?:work|attend) (?:in|the) office)\b/i.test(stated)
    || (/\b(?:on[- ]?site|in office|five days|5 days)\b/i.test(stated) && !/remote work is available/i.test(stated));
}

function deterministicProposal({ profile, job }) {
  const { prefs, proofs, proofText } = proofSignals(profile);
  const resume = String(profile?.resumeText || '');
  const positiveResume = resume.split(/\r?\n/).filter(line => !/^(?:Missing:|Exposure only:|No |Target:|Hard minimum:|Work authorization:)/i.test(line)).join('\n');
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
    positiveResume,
    proofText,
  ].filter(Boolean).join(' ');
  const domainPreference = [
    ...(Array.isArray(prefs.industries) ? prefs.industries : []),
    ...(Array.isArray(prefs.missionKeywords) ? prefs.missionKeywords : []),
    positiveResume,
    proofText,
  ].filter(Boolean).join(' ');

  const dimensions = {};
  const pRefs = profileEvidence(profile);
  const preferenceRef = field => ({ kind: 'profile_preference', id: String(profile.id || ''), field: `preferences.${field}` });
  const resumeRef = { kind: 'profile_field', id: String(profile.id || ''), field: 'resumeText' };

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
    // Discovered greenhouse descriptions are flattened to one blob, so a
    // `Level:` section may sit mid-line rather than on its own line. Slice
    // the Level segment up to the next labeled posting section instead of
    // requiring a line-anchored heading.
    const levelSegment = `${job.title || ''} ${jobText.match(/Level\s*:([\s\S]*?)(?=(?:Base salary|Salary|Compensation|Work|Required|Preferred|Hiring process|Location|Company|Source)\s*:|$)/i)?.[0] || ''}`;
    const levelEvidence = `${job.title}\n${levelSegment}`.replace(/\b(?:no|not)\b[^.\n]*/gi, '');
    const candidateLevel = `${target}\n${resume.split(/\r?\n/).filter(line => !/not seeking|not a|no .*ownership|open to/i.test(line)).join('\n')}`;
    const jobSenior = seniorTerms.test(levelEvidence);
    const profileSenior = seniorTerms.test(candidateLevel);
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
    const jobOnsite = requiresOffice(`${jobLocation}\n${job?.description || ''}`);
    const jobRemote = /\bremote\b/i.test(`${jobLocation}\n${job?.description || ''}`);
    const locationMatch = tokenScore(candidateLocation, `${jobLocation}\n${job?.description || ''}`, { base: 40, perHit: 20, ceiling: 90 });
    const scoreValue = candidateRemote && jobOnsite ? 10 : candidateRemote && jobRemote ? 90 : locationMatch.score;
    dimensions.locationWorkModel = scoredDimension(
      'locationWorkModel',
      scoreValue,
      `Location and work-model fit compares the candidate's stated location/work-model preference with posting location/work-model evidence.`,
      [prefs.locations?.length ? preferenceRef('locations') : resumeRef, prefs.workModel ? preferenceRef('workModel') : resumeRef, fieldRef(job, 'location'), fieldRef(job, 'description')]
    );
  }

  // compensation (8)
  const salary = prefs.salary && typeof prefs.salary === 'object' ? prefs.salary : {};
  const candidateMinimum = Number(salary.min);
  const compensation = parseCompensation(job.compensationJson || job.compensation || job.description);
  const floorSource = resume.match(/(?:hard minimum|minimum (?:base|salary)|base[- ]pay floor)[:\s]*((?:USD|GBP|EUR|CAD|AUD|[$£€])[\d\s,.kK]+[^\n]*)/i);
  const sourceFloor = floorSource ? parseCompensation(floorSource[1]) : {};
  const minimum = candidateMinimum > 0 ? candidateMinimum : sourceFloor.min;
  const candidateCurrency = String(salary.currency || sourceFloor.currency || '').toUpperCase();
  const comparablePay = minimum > 0 && candidateCurrency && candidateCurrency === compensation.currency && compensation.baseStatus !== 'unknown' && ['year', 'unknown'].includes(compensation.interval);
  if (!comparablePay || (compensation.max === null && compensation.min === null)) {
    dimensions.compensation = unknownDimension('compensation', 'Comparable annual base-pay evidence is missing or currency differs; no exchange rate or bonus/equity substitution is assumed.', [candidateMinimum > 0 ? preferenceRef('salary') : resumeRef, fieldRef(job, 'description')]);
  } else {
    let scoreValue = 65;
    if (/equity only|no salary|no cash compensation/i.test(compensation.text)) scoreValue = 0;
    else if (compensation.max !== null && compensation.max < minimum) scoreValue = 20;
    else if (compensation.max !== null) scoreValue = 85;
    dimensions.compensation = scoredDimension(
      'compensation',
      scoreValue,
      `Compensation fit compares the candidate salary floor with direct posting compensation evidence.`,
      [candidateMinimum > 0 ? preferenceRef('salary') : resumeRef, fieldRef(job, 'description')]
    );
  }

  // missionInterest (14)
  const missionPreference = [
    ...(Array.isArray(prefs.missionKeywords) ? prefs.missionKeywords : []),
    ...(Array.isArray(prefs.values) ? prefs.values : []),
    positiveResume,
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
  const candidateRemote = /remote[- ]only|remote.*(?:required|must)|no.*(?:office attendance|relocation)/i.test(`${prefs.workModel || ''}\n${resume}\n${(prefs.dealbreakers || []).join(' ')}`);
  const jobOnsiteText = String(job?.description || '');
  const jobOnsite = requiresOffice(`${job?.location || ''}\n${job?.workModel || ''}\n${jobOnsiteText}`);
  if (candidateRemote && jobOnsite) {
    constraints.push({
      id: `constraint-${job?.id}-remote-onsite`,
      kind: 'contradiction',
      dimension: 'locationWorkModel',
      status: 'confirmed',
      preferenceRef: prefs.workModel ? preferenceRef('workModel') : resumeRef,
      jobEvidenceRefs: [fieldRef(job, 'workModel'), fieldRef(job, 'description')],
      reason: 'The candidate states a remote work-model preference while the posting shows a direct on-site requirement.',
    });
    dimensions.locationWorkModel = { ...dimensions.locationWorkModel, status: 'contradicted', score: Math.min(dimensions.locationWorkModel.score ?? 10, 10) };
  }
  const hardFailure = (key, dimension, reason, candidateEvidence, postingEvidence) => {
    constraints.push({ id: `constraint-${job?.id}-${key}`, kind: 'dealbreaker', dimension, status: 'confirmed',
      preferenceRef: key === 'base-floor' && candidateMinimum > 0 ? preferenceRef('salary') : resumeRef,
      jobEvidenceRefs: [fieldRef(job, 'description')], candidateEvidence, postingEvidence, reason });
    dimensions[dimension] = { ...dimensions[dimension], status: 'contradicted', score: 0, reason };
  };
  if (comparablePay && compensation.max !== null && compensation.max < minimum) {
    hardFailure('base-floor', 'compensation', `The maximum guaranteed base ${compensation.currency} ${compensation.max} is below the candidate floor ${minimum}; bonus/equity cannot close this gap.`, salary.min ? salary : floorSource?.[0], compensation.text);
  }
  const countryGroups = [ ['UK', 'United Kingdom', 'Britain'], ['US', 'United States', 'USA'], ['EU', 'European Union'] ];
  for (const group of countryGroups) {
    const names = group.join('|');
    const restricted = new RegExp(`(?:only within|must reside in|remote only|resident(?:s)? (?:of|in))[^.\n]{0,35}\\b(?:${names})\\b|(?:existing|unrestricted)[^.\n]{0,20}\\b(?:${names})\\b[^.\n]{0,20}(?:work authorization|right to work)`, 'i');
    const lacks = new RegExp(`(?:no|without|lack)[^.\n]{0,30}\\b(?:${names})\\b[^.\n]{0,30}(?:authorization|right to work)`, 'i');
    const posting = jobText.match(restricted), candidate = resume.match(lacks);
    if (posting && candidate) hardFailure(`authorization-${group[0].toLowerCase()}`, 'locationWorkModel', 'Required residence/work authorization conflicts with the candidate’s explicit authorization limits.', candidate[0], posting[0]);
  }
  // A skill counts as explicitly missing only when the missing clause names
  // that skill: a `Missing:` inventory that also lists held skills must not
  // mark the held skills missing merely by co-mention.
  function skillMarkedMissing(line, skill) {
    const text = String(line || '');
    const escaped = String(skill).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const missingAt = text.search(/\bMissing:/i);
    const scope = missingAt >= 0 ? text.slice(missingAt) : text;
    if (!new RegExp(`\\b${escaped}\\b`, 'i').test(scope)) return false;
    if (missingAt >= 0) return true;
    return /^(?:No\b|Exposure only:)/i.test(text.trim()) || /\bno (?:production|experience|deployment)\b/i.test(text);
  }
  const stack = ['java', 'kafka', 'flink', 'kubernetes', 'terraform', 'airflow', 'databricks', 'spark', 'pyspark', 'snowflake', 'dbt', 'python', 'sql'];
  const requiredStack = [];
  const seenRequired = new Set();
  // An explicit negation (`not required`, `no ... requirement`) removes a
  // technology from the mandatory stack even when an earlier section named it;
  // preferred and negated requirements are never exclusions.
  const explicitlyNotRequired = new Set();
  for (const line of jobText.split(/\r?\n/)) {
    if (!/(?:not\s+(?:required|mandatory|needed|necessary)|no\s+[^.\n]{0,50}\brequirement\b|without\s+[^.\n]{0,40}\brequirement\b)/i.test(line)) continue;
    for (const skill of stack) {
      if (new RegExp(`\\b${skill}\\b`, 'i').test(line)) explicitlyNotRequired.add(skill);
    }
  }
  let requiredSection = false;
  for (const line of jobText.split(/\r?\n/)) {
    // A new labeled posting section ends the previous required block unless
    // the header itself opens a required or preferred block. This keeps a
    // later process/contact section from inheriting required-stack status.
    if (/^[^:\n]{1,60}:/.test(line) && !/^(?:required|mandatory|minimum qualifications|requirements|preferred|nice to have|bonus)\b/i.test(line)) requiredSection = false;
    if (/^(?:preferred|nice to have|bonus)/i.test(line)) requiredSection = false;
    if (/^(?:required|mandatory|minimum qualifications|requirements)[:\s]/i.test(line)) requiredSection = true;
    if (!requiredSection && !/\b(?:mandatory|required|must have)\b/i.test(line)) continue;
    if (/preferred|not required|no .{0,70}requirement|can learn|not mandatory/i.test(line)) continue;
    for (const skill of stack) {
      if (!new RegExp(`\\b${skill}\\b`, 'i').test(line)) continue;
      if (seenRequired.has(skill)) continue;
      if (explicitlyNotRequired.has(skill)) continue;
      seenRequired.add(skill);
      const missingLine = resume.split(/\r?\n/).find(source => skillMarkedMissing(source, skill));
      const supportedLine = positiveResume.split(/\r?\n/).find(source => new RegExp(`\\b${skill}\\b`, 'i').test(source));
      requiredStack.push({ skill, postingEvidence: line, candidateEvidence: missingLine || supportedLine || null,
        status: missingLine ? 'confirmed' : supportedLine ? 'cleared' : 'unknown' });
      if (missingLine) hardFailure(`required-${skill}`, 'roleFit', `The posting requires ${skill}; the candidate explicitly reports missing this production experience.`, missingLine, line);
    }
    if (/^[^:]+:/.test(line) && !/^(?:required|mandatory|requirements|minimum)/i.test(line)) requiredSection = false;
  }
  // Same flattened-blob-tolerant Level slice used for mandatory seniority
  // scope and experience-floor parsing: discovery strips posting newlines,
  // so `Level:` rarely starts its own line on stored jobs.
  const levelSlice = jobText.match(/Level\s*:([\s\S]*?)(?=(?:Base salary|Salary|Compensation|Work|Required|Preferred|Hiring process|Location|Company|Source)\s*:|$)/i)?.[0];
  const levelLine = levelSlice || jobText.split(/\r?\n/).find(line => /^Level:/i.test(line)) || String(job.title || '');
  const excludedLevelMatch = resume.match(/(?:not seeking|do not want|exclude(?:d|s)?|no)\s+(?:staff|principal|management|lead accountability)[^\.\n]*/i);
  const excludedLevel = excludedLevelMatch?.[0]
    || [...(Array.isArray(prefs.dealbreakers) ? prefs.dealbreakers : [])].map(String)
      .find(item => /(?:not seeking|do not want|exclude|no)\s+(?:staff|principal|management|lead accountability)/i.test(item))
    || null;
  if (excludedLevel && /\b(?:staff|principal|director|head of)\b/i.test(levelLine) && !/no (?:direct reports or )?staff|not (?:a )?staff/i.test(levelLine)) {
    hardFailure('seniority', 'seniority', 'The mandatory posting level conflicts with the candidate’s explicitly excluded seniority scope.', excludedLevel, levelLine);
  }
  const wordsToYears = value => ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }[String(value).toLowerCase()] ?? Number(value));
  const yearsPattern = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';
  const requiredYears = levelLine.match(new RegExp(`(?:minimum|at least) ${yearsPattern} years`, 'i'));
  const candidateYears = resume.match(new RegExp(
    `(?:approximately|about|over|cover)\\s+${yearsPattern}\\s+years|${yearsPattern}\\s+years(?:'?\\s*experience)?\\s*inclusive|inclusive\\s+${yearsPattern}\\s+years`,
    'i'
  ));
  const candidateYearValue = match => match?.slice(1).find(Boolean);
  if (requiredYears && candidateYears && wordsToYears(candidateYearValue(candidateYears)) < wordsToYears(requiredYears[1])) {
    hardFailure('experience-floor', 'seniority', 'The explicit relevant-experience minimum exceeds the candidate’s stated experience.', candidateYears[0], requiredYears[0]);
  }

  // Resolve each explicit gate from the same evidence used for hard failures.
  // Absence of a contradiction alone is never a clearance.
  const gate = (dimension, status, candidateEvidence, postingEvidence, reason) => ({ dimension, status, candidateEvidence, postingEvidence, reason });
  const unknownGate = dimension => gate(dimension, 'unknown', null, null, 'The supplied facts are insufficient to resolve this gate.');
  const failureGate = (dimension, suffix) => {
    const failures = constraints.filter(item => item.status === 'confirmed' && item.dimension === dimension && suffix.test(item.id));
    return failures.length ? gate(dimension, 'confirmed', failures.map(item => item.candidateEvidence), failures.map(item => item.postingEvidence), failures.map(item => item.reason).join(' ')) : null;
  };
  const noCashPay = /equity[- ]only|no cash compensation|no salary(?:[.;]|$)/i.test(compensation.text);
  const payGate = failureGate('compensation', /base-floor$/) || (noCashPay
    ? gate('compensation', 'confirmed', candidateMinimum > 0 ? salary : floorSource?.[0], compensation.text, 'The posting explicitly offers no guaranteed cash salary; equity cannot satisfy a base-pay requirement.')
    : comparablePay && compensation.min !== null && compensation.min >= minimum
    ? gate('compensation', 'cleared', candidateMinimum > 0 ? salary : floorSource?.[0], compensation.text, 'The entire stated guaranteed-base band meets the candidate floor in the same currency; bonus/equity is excluded.')
    : unknownGate('compensation'));
  const remoteLine = jobText.split(/\r?\n/).find(line => /\bremote\b/i.test(line) && !/no remote|not remote/i.test(line));
  const officeGate = candidateRemote && jobOnsite
    ? gate('locationWorkModel', 'confirmed', prefs.workModel || resume, jobOnsiteText, 'Required office attendance conflicts with the explicit remote-only constraint.')
    : candidateRemote && remoteLine && !jobOnsite
      ? gate('locationWorkModel', 'cleared', prefs.workModel || resume, remoteLine, 'The posting explicitly supports remote work without a stated required office attendance conflict.')
      : unknownGate('locationWorkModel');
  let authorizationGate = failureGate('locationWorkModel', /authorization-/) || unknownGate('locationWorkModel');
  const locationLine = jobText.split(/\r?\n/).find(line => /^(?:Location|Location\/authorization):/i.test(line)) || `${job.location || ''}`;
  const candidateState = resume.match(/^Location:\s*[^,\n]+,\s*([^,\n]+),/im)?.[1]?.trim();
  const stateSupported = !candidateState || locationLine.toLowerCase().includes(candidateState.toLowerCase()) || /nationwide|all (?:US|United States) states/i.test(locationLine);
  if (authorizationGate.status !== 'confirmed') {
    for (const group of countryGroups) {
      const names = group.join('|');
      const candidate = resume.match(new RegExp(`(?:\\b(?:${names})\\b citizen|authorized to work in (?:the )?(?:${names}))[^.\\n]*`, 'i'));
      const posting = locationLine.match(new RegExp(`\\b(?:${names})\\b[^.\\n]*(?:authorization|authorized)|(?:authorization|authorized)[^.\\n]*\\b(?:${names})\\b`, 'i'));
      if (candidate && posting && stateSupported && remoteLine && !jobOnsite) {
        authorizationGate = gate('locationWorkModel', 'cleared', candidate[0], locationLine, 'The stated remote hiring location includes the candidate location and requires authorization the candidate explicitly supplies.');
        break;
      }
    }
  }
  const stackGate = failureGate('roleFit', /required-/) || (requiredStack.length && requiredStack.every(item => item.status === 'cleared')
    ? gate('roleFit', 'cleared', requiredStack.map(item => item.candidateEvidence), [...new Set(requiredStack.map(item => item.postingEvidence))], 'The explicitly required production technologies have candidate source support; preferred and negated requirements are not exclusions.')
    : unknownGate('roleFit'));
  const levelYears = levelLine.match(new RegExp(`${yearsPattern}(?:\\s*[–—-]\\s*\\d+|\\+)?\\s+years`, 'i'));
  const levelKnown = /\b(?:mid[- ]level|individual contributor|IC|junior|senior)\b/i.test(levelLine);
  const scopeCompatible = /no (?:direct reports|management|people.management)|\bIC\b/i.test(levelLine)
    && !/\b(?:staff|principal|director|head of)\b/i.test(levelLine.replace(/\bno (?:direct reports or )?staff[^.\n]*|\bnot (?:a )?staff[^.\n]*/gi, ''));
  const seniorityGate = failureGate('seniority', /seniority$|experience-floor$/) || (levelKnown && scopeCompatible && levelYears && (candidateYears ? wordsToYears(candidateYearValue(candidateYears)) >= wordsToYears(levelYears[1]) : !requiredYears)
    ? gate('seniority', 'cleared', [candidateYears?.[0], excludedLevel].filter(Boolean), levelLine, 'The stated IC scope and relevant-experience band are compatible with the supplied candidate level facts; no explicit years floor conflict is present.')
    : unknownGate('seniority'));
  // Travel caps and collaboration/overlap hours use the same gate shape:
  // clear only when the posting states compatible evidence, exceed only on
  // a stated over-limit cap, otherwise unknown. No numeric constants.
  const travelLine = jobText.split(/\r?\n/).find(line => /\btravel\b/i.test(line)) || null;
  const travelCap = travelLine && !/\bno travel\b/i.test(travelLine)
    ? Number(travelLine.match(/(?:up to|cap(?:ped)?(?: at)?|max(?:imum)?|within[^.\n]{0,24}?|\(+\s*)\s*(\d+)\s*%|(\d+)\s*%\s*(?:travel|cap|max)/i)?.[1] ?? travelLine.match(/(\d+)\s*%/)?.[1] ?? NaN)
    : (/\bno travel\b/i.test(String(travelLine || '')) ? 0 : NaN);
  const travelLimitSource = [...(Array.isArray(prefs.dealbreakers) ? prefs.dealbreakers : []), resume]
    .map(entry => String(entry || ''))
    .find(entry => /\btravel\b/i.test(entry) && (/\bno travel\b/i.test(entry) || /\d+\s*%/.test(entry)));
  const travelLimit = travelLimitSource == null ? null
    : /\bno travel\b/i.test(travelLimitSource) ? 0
    : Number(travelLimitSource.match(/(?:above|over|more than|exceed(?:ing|s)?|up to|at most|within|max(?:imum)?|cap(?:ped)?(?: at)?)\s*(\d+)\s*%|travel[^.\n]{0,48}(?:above|over|more than|up to|at most|within|max(?:imum)?|cap(?:ped)?(?: at)?)\s*(\d+)\s*%|(\d+)\s*%\s*(?:max|cap|limit)/i)?.slice(1).find(Boolean) ?? NaN);
  const travelGate = travelLimitSource == null || travelLimit == null || Number.isNaN(travelLimit) || travelLine == null || Number.isNaN(travelCap)
    ? unknownGate('locationWorkModel')
    : travelCap <= travelLimit
      ? gate('locationWorkModel', 'cleared', travelLimitSource, travelLine, 'The stated posting travel cap is within the candidate travel limit.')
      : gate('locationWorkModel', 'confirmed', travelLimitSource, travelLine, 'The stated posting travel cap exceeds the candidate travel limit.');
  // Shift/scheduling dealbreakers (collaboration overlap, core hours, and
  // overnight/night-shift availability) use one gate: clear only on stated
  // daytime/overlap evidence, confirm on a stated overnight requirement, and
  // stay unknown when the posting supplies no schedule facts.
  const scheduleLine = jobText.split(/\r?\n/).find(line => /\bshift\b|\bovernight\b|\bnights?\b|collaborat|core hours|\boverlap\b|\bhours\b/i.test(line)) || null;
  const scheduleLimitSource = [...(Array.isArray(prefs.dealbreakers) ? prefs.dealbreakers : []), resume]
    .map(entry => String(entry || ''))
    .find(entry => /shift|overnight|night|collaborat|\boverlap\b|core hours|schedule|\bhours\b|availab|\d{1,2}:\d{2}/i.test(entry));
  const nightLine = jobText.split(/\r?\n/).find(line => /\bovernight\b|\bnight shift\b|\bworking nights\b|\bnights?\s+operations\b/i.test(line) && !/\b(?:no|not|without|except|never)\b[^.\n]{0,35}(?:overnight|night\b)/i.test(line)) || null;
  const postingOvernight = Boolean(nightLine);
  const postingDaytime = /\bdaytime\b|standard\s+(?:business\s+)?hours|no\s+(?:a\s+)?(?:permanent\s+)?overnight|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[–—-]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(jobText);
  const scheduleGate = scheduleLimitSource == null
    ? unknownGate('locationWorkModel')
    : postingOvernight
      ? gate('locationWorkModel', 'confirmed', scheduleLimitSource, nightLine, 'The posting requires overnight or night work that conflicts with the candidate stated schedule constraint.')
      : postingDaytime && scheduleLine
        ? gate('locationWorkModel', 'cleared', scheduleLimitSource, scheduleLine, 'The posting states a daytime schedule or collaboration/overlap hours compatible with the candidate schedule constraint.')
        : unknownGate('locationWorkModel');
  // Native travel/hours compatibility from stated facts on both sides: a
  // resolved travel or schedule gate is recorded even when no explicit
  // dealbreaker names it, so canonical create_profile + discovered-job
  // scoring clears compatible J01/J03-style postings. Over-limit travel or
  // a stated overnight requirement is a confirmed exclusion; silence on
  // either side stays unknown and adds no constraint. Preferences are never
  // mandatory and never invented here.
  if (travelGate.status === 'confirmed') {
    hardFailure('travel-cap', 'locationWorkModel', 'The stated posting travel cap exceeds the candidate travel limit.', travelGate.candidateEvidence, travelGate.postingEvidence);
  } else if (travelGate.status === 'cleared') {
    constraints.push({ id: `constraint-${job?.id}-travel-compatibility`, kind: 'compatibility', dimension: 'locationWorkModel', status: 'cleared',
      preferenceRef: resumeRef, jobEvidenceRefs: [fieldRef(job, 'description')],
      candidateEvidence: travelGate.candidateEvidence, postingEvidence: travelGate.postingEvidence,
      reason: 'The stated posting travel cap is within the candidate travel limit.' });
  }
  if (scheduleGate.status === 'confirmed') {
    hardFailure('schedule-overnight', 'locationWorkModel', 'The posting requires overnight or night work that conflicts with the candidate stated schedule constraint.', scheduleGate.candidateEvidence, scheduleGate.postingEvidence);
  } else if (scheduleGate.status === 'cleared') {
    constraints.push({ id: `constraint-${job?.id}-schedule-compatibility`, kind: 'compatibility', dimension: 'locationWorkModel', status: 'cleared',
      preferenceRef: resumeRef, jobEvidenceRefs: [fieldRef(job, 'description')],
      candidateEvidence: scheduleGate.candidateEvidence, postingEvidence: scheduleGate.postingEvidence,
      reason: 'The posting states a daytime schedule or collaboration/overlap hours compatible with the candidate schedule constraint.' });
  }
  for (const [index, raw] of (Array.isArray(prefs.dealbreakers) ? prefs.dealbreakers : []).entries()) {
    const dealbreaker = String(raw || '').trim();
    if (!dealbreaker) continue;
    let resolved = unknownGate('roleFit');
    if (/\b(?:salary|base(?:[- ]?(?:pay|salary))?|compensation|pay floor|bonus|equity)\b/i.test(dealbreaker)) resolved = payGate;
    else if (/stack|technolog|streaming|production (?:experience|skill)|(?:Java|Kafka|Flink|Kubernetes|Terraform)/i.test(dealbreaker)) resolved = stackGate;
    else if (/staff|principal|seniority|management|years|experience (?:minimum|beyond)|lead accountability/i.test(dealbreaker)) resolved = seniorityGate;
    else if (/office|on[- ]?site|attendance|hybrid/i.test(dealbreaker)) resolved = officeGate;
    else if (/authoriz|residen|relocat|foreign|country|US[- ]only|\bUK\b|\bEU\b/i.test(dealbreaker)) resolved = authorizationGate;
    else if (/remote/i.test(dealbreaker)) resolved = officeGate;
    else if (/\btravel\b/i.test(dealbreaker)) resolved = travelGate;
    else if (/collaborat|\boverlap\b|core hours|shift|overnight|night|schedule|\bhours\b|on[\s-]?call/i.test(dealbreaker)) resolved = scheduleGate;
    constraints.push({
      id: `constraint-${job?.id}-dealbreaker-${index}`, kind: 'dealbreaker', ...resolved,
      preferenceRef: preferenceRef('dealbreakers'), candidateEvidenceRefs: [preferenceRef('dealbreakers'), resumeRef, ...(resolved.dimension === 'compensation' && candidateMinimum > 0 ? [preferenceRef('salary')] : [])],
      jobEvidenceRefs: resolved.postingEvidence ? [fieldRef(job, 'description')] : [],
      reason: `Explicit dealbreaker “${dealbreaker}”: ${resolved.reason}`,
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
  const eligibilityUnknown = unresolvedConstraint || ['roleFit', 'seniority', 'locationWorkModel', 'compensation'].some(key => dimensions[key].status === 'unknown');
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
    eligibility: { status: confirmedDealbreaker || confirmedContradiction ? 'excluded' : eligibilityUnknown ? 'unknown' : 'eligible_for_review', actionable: !confirmedDealbreaker && !confirmedContradiction && !eligibilityUnknown, hardFailures: constraints.filter(value => value.status === 'confirmed') },
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
