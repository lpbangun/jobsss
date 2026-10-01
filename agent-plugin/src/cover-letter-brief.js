// Read-only preparation data for host-authored, proof-grounded cover letters.
// Voice examples are separated from factual evidence and never enter matching.
import { tailoringContext } from './tailoring-context.js';
import { postingRequirements } from './resume-compiler.js';

const STOP_WORDS = new Set(`a an and are as at be by for from has have in into is it its of on or our the their this to we will with you your ability experience work role team strong using including`.split(' '));
const PROJECT_SIGNAL = /\b(?:project|program|implementation|launch|rollout|delivery|migration)\b/i;
const PROBLEM_SIGNAL = /\b(?:problem|challenge|solve|improv\w*|reduc\w*|increas\w*|scal\w*|optimiz\w*|streamlin\w*)\b/i;
const CAREER_BRIDGE_SIGNAL = /\b(?:transferable (?:skills?|experience)|career changers?|non[- ]traditional|equivalent experience|adjacent backgrounds?|related field|career transition)\b/i;
const WORK_PREFERENCE_LINE = /^\s*(?:travel(?: preference)?|hybrid(?: preference)?|remote(?: work)?|remote only|on[ -]?site|work model|work arrangement|schedule|availability|location preference)\s*:/i;
const WORK_PREFERENCE_TEXT = /^\s*(?:remote only|hybrid preference|willing to travel|travel up to|target role|hard minimum|not seeking|no required office attendance)\b/i;

function words(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g)?.filter(word => word.length > 2 && !STOP_WORDS.has(word)) || []);
}

function jobTextSignals(job, matcher) {
  const lines = String(job.description || '').split(/\r?\n/);
  const matches = [];
  for (const [index, line] of lines.entries()) {
    const text = line.trim().replace(/^[-*•]\s*/, '');
    if (text && matcher.test(text)) matches.push({ text, sourceLine: index + 1 });
  }
  if (matcher.test(String(job.title || ''))) matches.unshift({ text: String(job.title), sourceLine: null, source: 'job_title' });
  return matches;
}

function evidenceMatches(requirements, proofPoints) {
  const matches = [];
  for (const requirement of requirements) {
    const requiredWords = words(requirement.text);
    for (const proof of proofPoints) {
      const proofWords = words(`${proof.summary || ''} ${(proof.skills || []).join(' ')}`);
      const matchedTerms = [...requiredWords].filter(word => proofWords.has(word)).sort();
      if (matchedTerms.length >= 2) matches.push({ requirement, proof, matchedTerms, score: matchedTerms.length });
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.proof.id.localeCompare(b.proof.id) || a.requirement.sourceLine - b.requirement.sourceLine);
}

function uniqueProofIds(matches) {
  return [...new Set(matches.map(item => item.proof.id))].slice(0, 3);
}

function suggestedNarrative(job, requirements, proofPoints) {
  const matches = evidenceMatches(requirements, proofPoints);
  const bridgeSignals = jobTextSignals(job, CAREER_BRIDGE_SIGNAL);
  const projectSignals = jobTextSignals(job, PROJECT_SIGNAL);
  const problemSignals = jobTextSignals(job, PROBLEM_SIGNAL);
  const projectMatches = matches.filter(item => PROJECT_SIGNAL.test(item.requirement.text)
    && PROJECT_SIGNAL.test(`${item.proof.summary || ''} ${(item.proof.skills || []).join(' ')}`));
  const problemMatches = matches.filter(item => PROBLEM_SIGNAL.test(item.requirement.text));

  let strategy = 'evidence_first';
  let signals = matches.slice(0, 3);
  let reason = matches.length
    ? 'Lead with the active proof that shares the most specific language with an exact posting requirement.'
    : 'The active proof does not share enough wording with a listed requirement for a direct match; keep claims evidence-led and avoid implying unsupported fit.';

  if (matches.length && bridgeSignals.length) {
    strategy = 'career_bridge';
    signals = matches.slice(0, 3);
    reason = 'The posting explicitly welcomes transferable or adjacent experience; connect the closest active proof to its stated requirements without claiming a career history the profile does not establish.';
  } else if (projectMatches.length && projectSignals.length) {
    strategy = 'project_led';
    signals = projectMatches.slice(0, 3);
    reason = 'The posting names project, implementation, launch, or delivery work and an active proof point uses related language; open with that concrete work.';
  } else if (problemMatches.length && problemSignals.length) {
    strategy = 'problem_led';
    signals = problemMatches.slice(0, 3);
    reason = 'The posting names a problem-solving or improvement need that overlaps with active proof; lead with the supported problem and result.';
  }

  const proofPointIds = uniqueProofIds(signals);
  const supportedJobSignals = [...new Map(signals.map(item => [item.requirement.sourceLine, {
    text: item.requirement.text,
    sourceLine: item.requirement.sourceLine,
    priority: item.requirement.priority,
    matchedTerms: item.matchedTerms,
  }])).values()];
  return {
    strategy,
    reason,
    supportedJobSignals,
    proofPointIds,
    outline: strategy === 'project_led'
      ? ['Open with the matched project or implementation proof.', 'Connect its supported skills to one exact posting requirement.', 'Close with interest in the stated work.']
      : strategy === 'career_bridge'
        ? ['Acknowledge the posting’s explicit openness to transferable experience.', 'Bridge from the closest active proof to the named requirement.', 'Keep the transition framing limited to the supplied evidence.']
        : strategy === 'problem_led'
          ? ['Name the posting’s supported problem or improvement need.', 'Use a matched active proof point and its recorded outcome.', 'Connect the evidence to the stated role.']
          : ['Lead with the strongest active proof match, when available.', 'Connect only to requirements supported by the listed proof.', 'Close with interest grounded in the supplied job context.'],
  };
}

function publicProof(proof) {
  return {
    proofPointId: proof.id,
    summary: String(proof.summary || ''),
    skills: Array.isArray(proof.skills) ? proof.skills.map(String) : [],
    metrics: Array.isArray(proof.metrics) ? proof.metrics : [],
    source: proof.source || null,
    verification: proof.verification || null,
    status: proof.status || null,
  };
}

// A few older stores contain work-arrangement preferences in proofPointIds.
// They remain in durable history, but this preparation surface never presents
// them as accomplishment evidence.
export function isCoverLetterEvidence(proof) {
  const summary = String(proof?.summary || '');
  return !WORK_PREFERENCE_LINE.test(summary) && !WORK_PREFERENCE_TEXT.test(summary);
}

function publicResearch(record) {
  return {
    researchId: record.id,
    jobId: record.jobId || null,
    company: record.company || record.subjectCompany || null,
    subjectName: record.subjectName || null,
    findings: Array.isArray(record.findings) ? record.findings.map(String) : [],
    notes: String(record.notes || ''),
    source: record.source || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function sameCompany(a, b) {
  return String(a || '').trim().toLocaleLowerCase() === String(b || '').trim().toLocaleLowerCase();
}

function publicUserAngle(preferences = {}) {
  const strings = value => Array.isArray(value) ? value.map(String) : [];
  return {
    targetRoleFamilies: strings(preferences.targetRoleFamilies),
    values: strings(preferences.values),
    missionKeywords: strings(preferences.missionKeywords),
    communicationStyle: String(preferences.communicationStyle || ''),
  };
}

/** Build a JSON-safe brief from already ownership-checked, locally stored data. */
export function buildCoverLetterBrief({ profile, job, proofPoints = [], research = [], artifacts = [] }) {
  const parsed = postingRequirements(job.description || '');
  const requirements = parsed.requirements.map(item => ({ ...item }));
  const ownedResearch = research.filter(record => record.profileId === profile.id
    && (record.jobId === job.id || (!record.jobId && sameCompany(record.company || record.subjectCompany, job.company))))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))
    .map(publicResearch);
  const revisions = artifacts.filter(artifact => artifact.profileId === profile.id && artifact.jobId === job.id
    && artifact.kind === 'cover_letter_draft' && !artifact.retiredAt)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, 5)
    .map(artifact => ({ artifactId: artifact.id, contentHash: artifact.contentHash || null,
      format: artifact.format || null, status: artifact.status || null, revision: artifact.revision || null,
      createdAt: artifact.createdAt || null, updatedAt: artifact.updatedAt || null }));

  return {
    ok: true,
    profileId: profile.id,
    jobId: job.id,
    job: {
      title: String(job.title || ''),
      company: String(job.company || ''),
      location: job.location || null,
      workModel: job.workModel || null,
      employmentType: job.employmentType || null,
      url: job.url || null,
      sourceHash: job.sourceHash || null,
      postingCompany: parsed.company || null,
    },
    requirements,
    activeProofPoints: proofPoints.map(publicProof),
    conversationContext: tailoringContext(profile, job),
    coverLetterVoice: tailoringContext(profile, job).voice,
    userAngle: publicUserAngle(profile.preferences || {}),
    employerResearch: ownedResearch,
    suggestedNarrative: suggestedNarrative(job, requirements, proofPoints),
    revisionBases: revisions,
    readOnly: true,
  };
}
