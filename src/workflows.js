// Bundled JobSSS workflow helpers — standalone store-object functions.
// Attributed ports: lifecycle/next-action concepts from JobOS src/lifecycle.js
// and src/utils.js validStatuses; artifacts and review state from
// src/artifacts.js / src/domain-tools.js; proof-grounded tailoring from
// src/tailoring.js and src/resume-tailoring.js; reusable answers from
// src/answers.js. Reimplemented as pure store-object helpers for the bundled
// runtime; JobOS is never imported or required (MIT, see root LICENSE).
//
// Design contract (frozen B21–B23 plus broader lifecycle):
//   - every job-scoped helper enforces profile ownership (profile_mismatch)
//   - save/skip/archive/pursue and status updates are local records only;
//     applied/submitted/sent/approved-style attestation is rejected
//   - pursue and status changes persist human-review tasks/next actions
//   - resume/cover-letter drafts cite only real profile proof ids and never
//     invent metrics; they are persisted as artifacts for the review queue
//   - answers are reusable, profile-owned, and never auto-filled
//   - preview/export payloads are secret-safe (no resume text dumps, no env
//     secrets) and never claim a sync or send happened
import { id, now, hashText, tokenize, activeProofIdsForStore, evidenceFreshnessForStore } from './store.js';

// Local, human-reviewable application states. Anything that would attest an
// external action (applied, submitted, sent, approved, ...) is rejected.
export const APPLICATION_LOCAL_STATUSES = Object.freeze([
  'saved',
  'researching',
  'materials-ready',
  'pursued',
  'preparing',
  'reviewing',
  'withdrawn',
  'archived',
  'skipped',
  'rejected',
  'ghosted',
  'offer-recorded',
]);

export const CANNOT_ATTEST_STATUSES = Object.freeze([
  'applied',
  'submitted',
  'sent',
  'approved',
  'attested',
  'hired',
  'accepted',
  'offer-accepted',
]);

export const ANSWER_SENSITIVITIES = Object.freeze(['public', 'personal', 'sensitive', 'restricted']);
export const ANSWER_REUSE_SCOPES = Object.freeze(['global', 'employer_specific', 'never_auto_fill']);

function ensure(store, collection) {
  if (!store[collection] || typeof store[collection] !== 'object' || Array.isArray(store[collection])) {
    store[collection] = {};
  }
  return store[collection];
}

export function requireProfile(store, profileId, label = 'A profile id is required') {
  if (!profileId || typeof profileId !== 'string' || !profileId.trim()) {
    throw Object.assign(new Error(label), { code: 'missing_profile' });
  }
  const profile = store.profiles?.[profileId];
  if (!profile) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  return profile;
}

export function requireJobOwned(store, jobId, profileId) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    throw Object.assign(new Error('A job id is required'), { code: 'missing_job' });
  }
  requireProfile(store, profileId, 'A profile id is required');
  const job = store.jobs?.[jobId];
  if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: 'unknown_job' });
  if (job.profileId !== profileId) {
    throw Object.assign(
      new Error(`Job ${jobId} belongs to profile ${job.profileId}, not ${profileId}`),
      { code: 'profile_mismatch' }
    );
  }
  return job;
}

function requireProofOwned(store, proofId, profileId) {
  const proof = store.proofPoints?.[proofId];
  if (!proof) throw Object.assign(new Error(`Unknown proof point: ${proofId}`), { code: 'unknown_proof_point' });
  if (proof.profileId !== profileId) {
    throw Object.assign(
      new Error(`Proof point ${proofId} belongs to profile ${proof.profileId}, not ${profileId}`),
      { code: 'proof_profile_mismatch' }
    );
  }
  return proof;
}

function persistProofIds(store, profileId, proofPointIds, label) {
  const ids = Array.isArray(proofPointIds) ? proofPointIds.filter(Boolean) : [];
  for (const proofId of ids) requireProofOwned(store, proofId, profileId);
  return [...new Set(ids)];
}

function applicationFor(store, jobId, profileId) {
  const applications = ensure(store, 'applications');
  const app = applications[jobId] || {
    id: jobId,
    jobId,
    profileId,
    status: 'new',
    localOnly: true,
    createdAt: now(),
    updatedAt: now(),
  };
  return app;
}

function writeApplication(store, jobId, profileId, patch) {
  const applications = ensure(store, 'applications');
  const app = applicationFor(store, jobId, profileId);
  Object.assign(app, patch, { localOnly: true, updatedAt: now() });
  applications[jobId] = app;
  return app;
}

/**
 * Coherent local lifecycle write: keep the owned job's durable `saved` and
 * `status` fields (plus a named timestamp and updatedAt) in lock step with the
 * application record so list_jobs never reports a leftover stale state.
 * Local-only; never attests an external action.
 */
const NOT_SAVED_LOCAL_STATUSES = new Set(['skipped', 'archived', 'withdrawn', 'rejected', 'ghosted']);

function writeJobLifecycle(store, job, { status, saved, savedAt = null, skippedAt = null, archivedAt = null, pursuedAt = null, updatedAt = null }) {
  const at = updatedAt || now();
  const next = {
    status: String(status),
    saved: Boolean(saved),
    localOnly: true,
    updatedAt: at,
  };
  if (savedAt) next.savedAt = savedAt;
  if (skippedAt) next.skippedAt = skippedAt;
  if (archivedAt) next.archivedAt = archivedAt;
  if (pursuedAt) next.pursuedAt = pursuedAt;
  Object.assign(job, next);
  return job;
}

function retireJobArtifacts(store, { jobId, profileId, reason }) {
  const retiredAt = now();
  for (const artifact of Object.values(ensure(store, 'artifacts'))) {
    if (artifact.jobId === jobId && artifact.profileId === profileId && !artifact.retiredAt) {
      artifact.status = `retired_${reason}`;
      artifact.retiredAt = retiredAt;
      artifact.retiredReason = reason;
      artifact.updatedAt = retiredAt;
    }
  }
}

const LOCAL_NOTE = 'Recorded locally under PLUGIN_DATA. No submission, sending, or other external action was performed; human review is required before any outside step.';

/**
 * syncTasksForApplication — persist a deterministic task set for a profile's
 * application so restart keeps the next actions visible. Deterministic ids
 * keep re-runs idempotent.
 */
export function syncTasksForApplication(store, { jobId, profileId, status }) {
  const tasks = ensure(store, 'tasks');
  if (NOT_SAVED_LOCAL_STATUSES.has(status)) {
    const closedAt = now();
    for (const task of Object.values(tasks)) {
      if (task.profileId === profileId && task.jobId === jobId && task.status === 'open') {
        task.status = 'cancelled';
        task.closedReason = status;
        task.closedAt = closedAt;
        task.updatedAt = closedAt;
      }
    }
    return tasks;
  }
  const base = [
    {
      kind: 'action',
      text: 'Human review of the local application record and any draft materials (an explicit human action is required before any outside step).',
    },
    {
      kind: 'action',
      text: 'Verify every proof point cited in drafts against the original resume before sharing (human-only).',
    },
    {
      kind: 'next',
      text: `Tailor resume and cover letter from stored proof candidates for ${String(jobId)}; human verification is still required.`,
    },
  ];
  if (status === 'pursued') {
    base.push({ kind: 'next', text: 'Decide the next human step for this opportunity and record it in the pipeline.' });
  }
  for (const item of base) {
    const taskId = id('task', `${profileId}:${jobId}:${item.text}`);
    if (!tasks[taskId]) {
      tasks[taskId] = {
        id: taskId,
        jobId,
        profileId,
        text: item.text,
        kind: item.kind,
        status: 'open',
        createdAt: now(),
        updatedAt: now(),
      };
    } else if (tasks[taskId].status === 'cancelled') {
      tasks[taskId].status = 'open';
      tasks[taskId].updatedAt = now();
      delete tasks[taskId].closedReason;
      delete tasks[taskId].closedAt;
    }
  }
  return tasks;
}

function requireUpdatableStatus(store, status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) throw Object.assign(new Error('update_application_status requires status'), { code: 'missing_status' });
  if (CANNOT_ATTEST_STATUSES.includes(value)) {
    throw Object.assign(
      new Error(`Cannot attest status "${value}": applied/submitted/sent/approved states are human-only and not available to MCP.`),
      { code: 'external_status_forbidden' }
    );
  }
  if (!APPLICATION_LOCAL_STATUSES.includes(value)) {
    throw Object.assign(new Error(`Unsupported application status: ${value}.`), { code: 'invalid_status' });
  }
  return value;
}

/**
 * saveJob — explicit "save" of a discovered/imported job. The job must already
 * exist in the canonical store. The application record stays purely local.
 */
export function saveJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const at = now();
  const application = writeApplication(store, jobId, profileId, { status: 'saved', savedAt: at });
  writeJobLifecycle(store, job, { status: 'saved', saved: true, savedAt: at, updatedAt: at });
  syncTasksForApplication(store, { jobId, profileId, status: 'saved' });
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    job: { id: job.id, saved: job.saved, status: job.status },
    application,
    message: 'Job saved locally. ' + LOCAL_NOTE,
  };
}

/** skipJob — explicit skip; local record only. */
export function skipJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const at = now();
  const application = writeApplication(store, jobId, profileId, { status: 'skipped', skippedAt: at });
  writeJobLifecycle(store, job, { status: 'skipped', saved: false, skippedAt: at, updatedAt: at });
  syncTasksForApplication(store, { jobId, profileId, status: 'skipped' });
  retireJobArtifacts(store, { jobId, profileId, reason: 'skipped' });
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    job: { id: job.id, saved: job.saved, status: job.status },
    application,
    message: 'Job skipped locally. ' + LOCAL_NOTE,
  };
}

/** archiveJob — explicit archive; local record only. */
export function archiveJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const at = now();
  const application = writeApplication(store, jobId, profileId, { status: 'archived', archivedAt: at });
  writeJobLifecycle(store, job, { status: 'archived', saved: false, archivedAt: at, updatedAt: at });
  syncTasksForApplication(store, { jobId, profileId, status: 'archived' });
  retireJobArtifacts(store, { jobId, profileId, reason: 'archived' });
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    job: { id: job.id, saved: job.saved, status: job.status },
    application,
    message: 'Job archived locally. ' + LOCAL_NOTE,
  };
}

/** pursueJob — local pursuit handoff; never claims any external action. */
export function pursueJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const at = now();
  const application = writeApplication(store, jobId, profileId, { status: 'pursued', pursuedAt: at });
  writeJobLifecycle(store, job, { status: 'pursued', saved: true, pursuedAt: at, updatedAt: at });
  syncTasksForApplication(store, { jobId, profileId, status: 'pursued' });
  const artifactId = id('artifact', `${profileId}:${jobId}:application-readiness`);
  if (!ensure(store, 'artifacts')[artifactId]) {
    ensure(store, 'artifacts')[artifactId] = {
      id: artifactId,
      jobId,
      profileId,
      kind: 'application_readiness',
      status: 'draft_needs_human_review',
      title: `Application readiness: ${job.title}`,
      proofPointIds: proofPointsFor(store, profileId).map(proof => proof.id),
      checklist: ['verify profile facts', 'verify proof points', 'review role fit', 'prepare materials'],
      createdAt: now(),
      updatedAt: now(),
    };
  }
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    application,
    artifactId,
    message: 'Pursuit recorded locally. No submission, sending, or external action was performed; human review required before any outside step.',
  };
}

/**
 * updateApplicationStatus — move a local application between LOCAL statuses.
 * Rejects attestation statuses (applied/submitted/sent/approved/...) and any
 * unknown value; never silently overwrites another profile's application.
 */
export function updateApplicationStatus(store, { jobId, applicationId, profileId, status }) {
  const job = requireJobOwned(store, jobId, profileId);
  const value = requireUpdatableStatus(store, status);
  if (applicationId && applicationId !== jobId) {
    const application = store.applications?.[applicationId];
    if (!application || application.jobId !== jobId || application.profileId !== profileId) {
      throw Object.assign(
        new Error(`Application ${applicationId} does not belong to job ${jobId} and profile ${profileId}`),
        { code: 'application_mismatch' }
      );
    }
  }
  const application = writeApplication(store, jobId, profileId, {
    status: value,
    ...(value === 'materials-ready' ? { materialsReadyAt: now() } : {}),
  });
  writeJobLifecycle(store, job, { status: value, saved: !NOT_SAVED_LOCAL_STATUSES.has(value) });
  syncTasksForApplication(store, { jobId, profileId, status: value });
  if (NOT_SAVED_LOCAL_STATUSES.has(value)) retireJobArtifacts(store, { jobId, profileId, reason: value });
  return {
    ok: true,
    jobId,
    profileId,
    status: value,
    job: { id: job.id, saved: job.saved, status: job.status },
    application,
    nextActions: nextActionsForApplication(store, jobId, profileId),
    message: 'Application status updated locally. ' + LOCAL_NOTE,
  };
}

export function nextActionsForApplication(store, jobId, profileId) {
  const tasks = Object.values(ensure(store, 'tasks'))
    .filter(task => task.profileId === profileId && task.jobId === jobId && task.status === 'open')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return tasks.map(task => ({ task: task.text, kind: task.kind, taskId: task.id }));
}

export function listTasks(store, { profileId }) {
  requireProfile(store, profileId);
  const tasks = Object.values(ensure(store, 'tasks'))
    .filter(task => task.profileId === profileId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const nextActions = [];
  for (const jobId of new Set(tasks.map(task => task.jobId).filter(Boolean))) {
    nextActions.push(...nextActionsForApplication(store, jobId, profileId));
  }
  return { ok: true, profileId, tasks, items: tasks, count: tasks.length, nextActions };
}

export function updateTask(store, { profileId, taskId, status }) {
  requireProfile(store, profileId);
  const task = ensure(store, 'tasks')[String(taskId || '')];
  if (!task) throw Object.assign(new Error(`Unknown task: ${taskId}`), { code: 'unknown_task' });
  if (task.profileId !== profileId) {
    throw Object.assign(new Error(`Task ${taskId} belongs to profile ${task.profileId}, not ${profileId}`), { code: 'profile_mismatch' });
  }
  const value = String(status || '').trim().toLowerCase();
  if (!['open', 'completed'].includes(value)) throw Object.assign(new Error(`Unsupported task status: ${value}`), { code: 'invalid_task_status' });
  task.status = value;
  task.updatedAt = now();
  if (value === 'completed') task.completedAt = now();
  else delete task.completedAt;
  return { ok: true, profileId, taskId: task.id, task, message: 'Local task state updated; no external action was performed.' };
}

// Single shared eligibility definition lives in store.js
// (activeProofIdsForStore): retired ids lingering in a profile set are never
// admitted, so historical-only proof cannot leak into answer matching.
function activeProofIdsFor(store, profileId) {
  return activeProofIdsForStore(store, profileId);
}
function proofPointsFor(store, profileId) {
  const active = activeProofIdsFor(store, profileId);
  return Object.values(ensure(store, 'proofPoints'))
    .filter(proof => proof.profileId === profileId)
    .filter(proof => {
      if (proof.retiredAt || proof.status === 'retired') return false;
      if (!active) return true;
      if (active.has(proof.id)) return true;
      // Historical-only proof stays stored but never contributes current evidence.
      return false;
    })
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function profileSummary(profile) {
  return String(profile?.summary || '');
}

// ---------------------------------------------------------------------------
// Job-specific requirement extraction and proof selection.
// Attributed port: deterministic inventory/coverage concepts from JobOS
// src/requirements.js (extractRequirementInventory, buildRequirementCoverage)
// reimplemented here as pure store-object helpers (no external providers).
// ---------------------------------------------------------------------------

const REQUIREMENT_SKILL_PHRASES = Object.freeze([
  'user research', 'product management', 'project management', 'data analysis',
  'machine learning', 'artificial intelligence', 'cross-functional',
  'stakeholder management', 'software development', 'product strategy', 'roadmap',
  'discovery', 'activation', 'sql', 'python', 'javascript', 'react', 'figma',
]);

const REQUIREMENT_STOP = new Set([
  'must', 'have', 'with', 'years', 'year', 'experience', 'required', 'preferred',
  'qualification', 'qualifications', 'responsibilities', 'responsibility',
  'ability', 'strong', 'excellent', 'including', 'role', 'work', 'working',
  'and', 'for', 'the', 'of', 'to', 'a', 'an', 'in', 'on', 'at', 'or', 'is',
  'will', 'you', 'your', 'this', 'that', 'are', 'be', 'as', 'by', 'with', 'from',
]);

function cleanLineValue(value) {
  return String(value || '').trim()
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
}

function requirementSectionHeading(line) {
  const value = cleanLineValue(String(line).replace(/^#{1,6}\s*/, '')).replace(/:$/, '').toLowerCase();
  if (/^(what you.ll do|responsibilities|the role|you will|duties)$/.test(value)) return 'responsibilities';
  if (/^(minimum|required|basic|preferred|desired|nice to have)?\s*(qualifications?|requirements?)$/.test(value)) {
    return value.includes('preferred') || value.includes('desired') || value.includes('nice') ? 'preferred' : 'requirements';
  }
  if (/^(preferred|nice to have|bonus)$/.test(value)) return 'preferred';
  return '';
}

function requirementPriorityFor(sourceText, section) {
  if (section === 'preferred' || /\b(preferred|nice to have|bonus|ideally|a plus)\b/i.test(sourceText)) return 'preferred';
  return 'must_have';
}

function requirementCategoryFor(sourceText, section) {
  const value = String(sourceText || '').toLowerCase();
  if (requirementPriorityFor(sourceText, section) === 'preferred') return 'preferred_qualification';
  if (/\b(certif|license|degree|bachelor|master|phd|mba|credential)\b/.test(value)) return 'credential';
  if (/\b(remote|hybrid|on[- ]site|travel|timezone|relocat)\b/.test(value)) return 'work_model';
  if (/\b(senior|lead|manager|director|executive|staff|principal)\b/.test(value)) return 'seniority';
  if (/\b\d+\+?\s+years?\b/.test(value)) return 'experience';
  if (/\b(industry|domain|healthcare|education|edtech|fintech|saas|marketplace|enterprise)\b/.test(value)) return 'domain';
  if (section === 'responsibilities' || /\b(lead|own|build|create|deliver|manage|develop|design|drive|conduct|collaborate|partner)\b/.test(value)) return 'responsibility';
  return 'skill';
}

function requirementMatchTerms(sourceText) {
  const lower = String(sourceText || '').toLowerCase();
  const phrases = REQUIREMENT_SKILL_PHRASES.filter(term => lower.includes(term));
  const words = tokenize(sourceText).filter(term => !REQUIREMENT_STOP.has(term) && !/^\d+$/.test(term));
  const informative = words.filter(term => term.length >= 4).slice(0, 10);
  return [...new Set([...phrases.flatMap(term => tokenize(term)), ...informative])].slice(0, 12);
}

function requirementLine(line, section) {
  const trimmed = String(line || '').trim();
  if (!trimmed || requirementSectionHeading(trimmed)) return false;
  if (/^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
    return Boolean(section) || /\b(must|required|preferred|experience|ability|responsib|proficien|knowledge|years)\b/i.test(trimmed);
  }
  return /\b(must|required|preferred|minimum of|years? of experience|responsible for|you will|ability to|proficien|knowledge of)\b/i.test(trimmed);
}

function extractRequirements(job = {}) {
  const source = `${String(job.title || '')}\n${String(job.description || '')}`;
  const requirements = [];
  const seen = new Set();
  let section = '';
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const nextSection = requirementSectionHeading(raw);
    if (nextSection) { section = nextSection; continue; }
    if (!requirementLine(raw, section)) continue;
    const sourceText = cleanLineValue(raw);
    if (!sourceText || seen.has(sourceText.toLowerCase())) continue;
    seen.add(sourceText.toLowerCase());
    const normalizedTerms = requirementMatchTerms(sourceText);
    requirements.push({
      id: id('requirement', `${index}:${sourceText}`),
      sourceText,
      category: requirementCategoryFor(sourceText, section),
      priority: requirementPriorityFor(sourceText, section),
      normalizedTerms,
      matchTerms: normalizedTerms,
    });
  }
  if (!requirements.length && String(job.title || '').trim()) {
    const title = job.title.trim();
    const normalizedTerms = requirementMatchTerms(title);
    requirements.push({
      id: id('requirement', `title:${title}`),
      sourceText: title,
      category: 'responsibility',
      priority: 'must_have',
      normalizedTerms,
      matchTerms: normalizedTerms,
    });
  }
  return requirements.slice(0, 16);
}

function proofTermSet(proof) {
  const skills = Array.isArray(proof.skills) ? proof.skills : [];
  return new Set(tokenize(`${String(proof.summary || '')} ${skills.join(' ')}`));
}

function proofStrengthForRequirement(requirement, proof) {
  const requirementTerms = new Set(requirement.matchTerms || []);
  const terms = proofTermSet(proof);
  const matchedTerms = [...requirementTerms].filter(term => terms.has(term));
  return { matchedTerms, strength: matchedTerms.length };
}

const WEAK_MATCH_TERMS = new Set([
  'team', 'teams', 'time', 'work', 'worked', 'working', 'managed', 'management',
  'product', 'products', 'data', 'design', 'software', 'experience', 'years',
  'related', 'strong', 'learning', 'outcomes', 'customer', 'customers',
]);

function meaningfulRequirementMatch(match) {
  if (match.strength >= 2) return true;
  return match.strength === 1 && !WEAK_MATCH_TERMS.has(match.matchedTerms[0]);
}

function selectRelevantProofs(store, profileId, requirements) {
  const proofs = proofPointsFor(store, profileId);
  const entries = [];
  for (const proof of proofs) {
    const matches = [];
    let totalStrength = 0;
    for (const requirement of requirements) {
      const match = proofStrengthForRequirement(requirement, proof);
      if (meaningfulRequirementMatch(match)) {
        matches.push({ requirementId: requirement.id, matchedTerms: match.matchedTerms, strength: match.strength });
        totalStrength += match.strength;
      }
    }
    entries.push({ proof, matches, totalStrength });
  }
  const ranked = entries.sort((a, b) =>
    b.totalStrength - a.totalStrength || String(a.proof.id).localeCompare(String(b.proof.id))
  );
  const selected = ranked.filter(entry => entry.totalStrength > 0).slice(0, 8);
  return { ranked, selected };
}

function buildCoverage(requirements, selected) {
  const items = requirements.map(requirement => {
    const supporters = selected
      .map(entry => ({ entry, match: entry.matches.find(match => match.requirementId === requirement.id) }))
      .filter(item => item.match);
    if (!supporters.length) {
      return { requirementId: requirement.id, sourceText: requirement.sourceText, status: 'gap', proofPointIds: [], matchedTerms: [] };
    }
    supporters.sort((a, b) => b.match.strength - a.match.strength || String(a.entry.proof.id).localeCompare(String(b.entry.proof.id)));
    const best = supporters[0];
    return {
      requirementId: requirement.id,
      sourceText: requirement.sourceText,
      status: best.match.strength >= 2 ? 'matched' : 'partial',
      proofPointIds: [best.entry.proof.id],
      matchedTerms: best.match.matchedTerms,
    };
  });
  return {
    items,
    matches: items.filter(item => item.status !== 'gap'),
    gaps: items.filter(item => item.status === 'gap'),
  };
}

/**
 * buildMaterialDraft — proof-grounded, deterministic draft. Only text already
 * present in profile proof points may appear as achievements; no metrics are
 * invented. Persists a review artifact and returns the document content.
 */
function buildMaterialDraft(store, { jobId, profileId, kind, format = 'markdown' }) {
  const job = requireJobOwned(store, jobId, profileId);
  const profile = requireProfile(store, profileId);
  const proofs = proofPointsFor(store, profileId);
  if (!proofs.length) {
    throw Object.assign(
      new Error('No profile proof points are available; import and verify a resume before drafting materials.'),
      { code: 'no_proofs' }
    );
  }
  const requirements = extractRequirements(job);
  const ranked = selectRelevantProofs(store, profileId, requirements);
  const selected = ranked.selected;
  const selectedIds = selected.map(entry => entry.proof.id);
  const coverage = buildCoverage(requirements, selected);
  const selectedById = new Map(selected.map(entry => [entry.proof.id, entry.proof]));

  const metricNote = proof => {
    if (Array.isArray(proof.metrics) && proof.metrics.length) {
      return ` Metrics shown are copied verbatim from the stored proof (${proof.metrics.slice(0, 3).join(', ')}).`;
    }
    return ' No metric was added: this draft only restates the stored proof.';
  };

  const heading = kind === 'cover_letter'
    ? `Cover letter draft — ${job.title} at ${job.company}`
    : `Resume draft tailored toward ${job.title} at ${job.company}`;
  const requirementLines = coverage.items.map(item =>
    `- ${item.sourceText}${item.status === 'gap' ? ' _(no owned proof matches yet; evidence required)_' : ''}`
  ).join('\n');
  const matchedBlocks = coverage.matches.map(match => {
    const proofLines = match.proofPointIds
      .map(id => selectedById.get(id)).filter(Boolean)
      .map(proof => `- ${proof.summary} _(proof: ${proof.id}; human verification required)_${metricNote(proof)}`)
      .join('\n');
    return [`### ${match.sourceText}`, '', proofLines].join('\n');
  }).join('\n\n');
  const gapLines = coverage.gaps.map(gap => `- ${gap.sourceText}`).join('\n');
  const body = [
    `# ${heading}`,
    '',
    `Profile: ${profile.name}`,
    '',
    kind === 'cover_letter'
      ? `This cover-letter draft for the ${job.title} role at ${job.company} uses only the stored proof candidates below.`
      : profileSummary(profile) || 'Professional summary draft from the stored profile; human verification is required.',
    '',
    `## Requirements extracted from the posting (${coverage.items.length})`,
    '',
    requirementLines,
    '',
    `## Matched owned proof (${coverage.matches.length} requirement${coverage.matches.length === 1 ? '' : 's'})`,
    '',
    matchedBlocks || '_No owned proof matched any extracted requirement; evidence must be verified before use._',
    '',
    `## Coverage gaps (${coverage.gaps.length})`,
    '',
    gapLines || '_None._',
    '',
    'This draft cites only stored proof point ids and copies their summaries or metrics verbatim.',
    'Selected proof candidates require explicit human verification before this material may be shared with anyone.',
    'No submission, sending, or external action was performed.',
    '',
  ].join('\n');

  const artifactId = id('artifact', `${profileId}:${jobId}:${kind}:${hashText(body).slice(0, 12)}`);
  const nowIso = now();
  const existingArtifact = ensure(store, 'artifacts')[artifactId];
  // Unchanged regeneration must retain trusted artifact approvals/rejections,
  // actor/timestamps, and decision ledger/history: identical content returns
  // the existing record untouched. Changed content mints a distinct id above
  // and never inherits an unrelated human approval.
  if (existingArtifact && existingArtifact.contentHash === hashText(body) && existingArtifact.content === body) {
    return {
      ok: true,
      jobId,
      profileId,
      artifactId,
      artifact: existingArtifact,
      requirements,
      selectedProofPointIds: existingArtifact.proofPointIds || selectedIds,
      selectedProofIds: existingArtifact.proofPointIds || selectedIds,
      coverage: { matches: coverage.matches, gaps: coverage.gaps },
      gaps: coverage.gaps,
      document: {
        content: body,
        format: existingArtifact.format || format,
        kind,
        proofPointIds: existingArtifact.proofPointIds || selectedIds,
        selectedProofPointIds: existingArtifact.proofPointIds || selectedIds,
        requirements,
        gaps: coverage.gaps,
      },
      proofPointIds: existingArtifact.proofPointIds || selectedIds,
      format: existingArtifact.format || format,
      message: 'Unchanged draft already exists; trusted human review state was preserved with no overwrite.',
    };
  }
  const artifact = {
    id: artifactId,
    jobId,
    profileId,
    kind: kind === 'resume' ? 'resume_draft' : 'cover_letter_draft',
    title: kind === 'resume' ? `Resume draft: ${job.title}` : `Cover letter draft: ${job.title}`,
    status: 'draft_needs_human_review',
    proofPointIds: selectedIds,
    contentHash: hashText(body),
    format,
    content: body,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  ensure(store, 'artifacts')[artifactId] = artifact;
  const application = applicationFor(store, jobId, profileId);
  if (['new', 'researching', 'saved', 'pursued'].includes(application.status)) {
    writeApplication(store, jobId, profileId, { status: 'materials-ready', materialsReadyAt: nowIso });
    writeJobLifecycle(store, job, { status: 'materials-ready', saved: true, updatedAt: nowIso });
  }
  return {
    ok: true,
    jobId,
    profileId,
    artifactId,
    artifact,
    requirements,
    selectedProofPointIds: selectedIds,
    selectedProofIds: selectedIds,
    coverage: { matches: coverage.matches, gaps: coverage.gaps },
    gaps: coverage.gaps,
    document: {
      content: body,
      format,
      kind,
      proofPointIds: selectedIds,
      selectedProofPointIds: selectedIds,
      requirements,
      gaps: coverage.gaps,
    },
    proofPointIds: selectedIds,
    format,
    message:
      'Draft selected the owned proof candidates most relevant to the extracted posting requirements. No invention of metrics, no submission, no sending; human verification required before any outside step.',
  };
}

export function tailorResume(store, { jobId, profileId, format = 'markdown' }) {
  return buildMaterialDraft(store, { jobId, profileId, kind: 'resume', format });
}

export function draftCoverLetter(store, { jobId, profileId, format = 'markdown' }) {
  return buildMaterialDraft(store, { jobId, profileId, kind: 'cover_letter', format });
}

export function createArtifact(store, { jobId, profileId, kind = 'note', title, content = '', proofPointIds = [], format = 'md' }) {
  requireProfile(store, profileId);
  if (jobId && jobId !== 'profile') requireJobOwned(store, jobId, profileId);
  const ids = persistProofIds(store, profileId, proofPointIds, 'proofPointIds');
  const artifactId = id('artifact', `${profileId}:${jobId || 'profile'}:${kind}:${title || content || 'artifact'}`);
  const nowIso = now();
  const artifact = {
    id: artifactId,
    jobId: jobId && jobId !== 'profile' ? jobId : null,
    profileId,
    kind,
    title: String(title || `${kind} artifact`),
    content,
    format,
    proofPointIds: ids,
    status: 'draft_needs_human_review',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  ensure(store, 'artifacts')[artifactId] = artifact;
  return { ok: true, artifactId, artifact, profileId };
}

export function listReviewArtifacts(store, { profileId }) {
  requireProfile(store, profileId);
  const artifacts = Object.values(ensure(store, 'artifacts'))
    .filter(artifact => artifact.profileId === profileId && !artifact.retiredAt)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(artifact => ({ ...artifact, freshness: evidenceFreshnessForStore(store, artifact) }));
  return { ok: true, profileId, artifacts, items: artifacts, queue: artifacts, count: artifacts.length };
}

export function addAnswer(store, {
  profileId,
  question,
  answer,
  category = 'general',
  sensitivity = 'personal',
  reuseScope = 'global',
  source = 'inline',
  proofPointIds = [],
}) {
  requireProfile(store, profileId);
  const questionText = String(question || '').trim();
  let answerText = String(answer || '').trim();
  if (!questionText) throw Object.assign(new Error('addAnswer requires a question'), { code: 'missing_question' });
  if (!ANSWER_SENSITIVITIES.includes(sensitivity)) {
    throw Object.assign(new Error(`Unsupported answer sensitivity: ${sensitivity}`), { code: 'invalid_sensitivity' });
  }
  if (!ANSWER_REUSE_SCOPES.includes(reuseScope)) {
    throw Object.assign(new Error(`Unsupported answer reuse scope: ${reuseScope}`), { code: 'invalid_reuse_scope' });
  }
  const ids = persistProofIds(store, profileId, proofPointIds, 'proofPointIds');
  if (!ids.length) {
    throw Object.assign(
      new Error('A reusable answer draft must cite at least one profile-owned proofPointId; arbitrary ungrounded answers are not persisted.'),
      { code: 'answer_proof_required' }
    );
  }
  const selectedProofs = ids.map(proofId => requireProofOwned(store, proofId, profileId));
  const canonicalDraft = selectedProofs.map(proof => proof.summary).join('\n');
  const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();
  if (answerText && normalized(answerText) !== normalized(canonicalDraft)
      && !selectedProofs.some(proof => normalized(answerText) === normalized(proof.summary))) {
    throw Object.assign(
      new Error('Answer text is not an exact stored proof summary. Omit answer to generate from the selected proofPointIds, or use the stored proof wording exactly.'),
      { code: 'answer_not_grounded' }
    );
  }
  answerText = answerText || canonicalDraft;
  const answers = ensure(store, 'answers');
  const answerId = id('answer', `${profileId}:${questionText}`);
  const nowIso = now();
  answers[answerId] = {
    id: answerId,
    profileId,
    question: questionText,
    answer: answerText,
    category: String(category || 'general'),
    sensitivity,
    reuseScope,
    source,
    status: 'unverified',
    groundingStatus: 'proof_linked_needs_human_verification',
    proofPointIds: ids,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return {
    ok: true,
    answerId,
    answer: answers[answerId],
    message: 'Answer stored locally as an unverified draft; never auto-filled or sent.',
  };
}

export function listAnswers(store, { profileId, category = null, status = null }) {
  requireProfile(store, profileId);
  const active = activeProofIdsFor(store, profileId);
  const answers = Object.values(ensure(store, 'answers'))
    .filter(item => item.profileId === profileId)
    .filter(item => !category || item.category === category)
    .filter(item => !status || item.status === status)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    // Explicit active/current versus historical-only distinction: answers
    // grounded entirely in currently active proof are current matching
    // candidates; anything else remains readable history only.
    .map(item => {
      const ids = Array.isArray(item.proofPointIds) ? item.proofPointIds : [];
      const proofCurrency = ids.length && active && ids.every(pid => active.has(pid)) ? 'active' : 'historical';
      return { ...item, proofCurrency };
    });
  return { ok: true, profileId, answers, items: answers, count: answers.length };
}

export function matchAnswers(store, { profileId, questions = [], employer = '' }) {
  requireProfile(store, profileId);
  const active = activeProofIdsFor(store, profileId);
  const pool = Object.values(ensure(store, 'answers'))
    .filter(item => item.profileId === profileId && item.status === 'unverified')
    // Historical-only proof cannot contribute reusable-answer matching:
    // only answers grounded entirely in currently active proof remain eligible.
    .filter(item => {
      const ids = Array.isArray(item.proofPointIds) ? item.proofPointIds : [];
      if (!ids.length) return false;
      if (!active) return true;
      return ids.every(pid => active.has(pid));
    });
  const asked = Array.isArray(questions) ? questions.map(String).filter(Boolean) : [];
  const matches = asked.map(question => {
    const questionTokens = new Set(tokenize(question));
    let best = null;
    let bestScore = 0;
    for (const item of pool) {
      const text = `${item.question} ${item.answer}`;
      const hits = [...questionTokens].filter(token => tokenize(text).includes(token)).length;
      const score = questionTokens.size ? hits / questionTokens.size : 0;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return {
      question,
      ...(best
        ? {
            answerId: best.id,
            answer: best.answer,
            matchScore: Math.round(bestScore * 100),
            sensitivity: best.sensitivity,
            reuseScope: best.reuseScope,
            status: 'unverified',
            note: 'Suggested draft only; requires human verification and is never auto-filled or sent.',
          }
        : { answer: null, matchScore: 0, note: 'No stored answer matched; do not fabricate one.' }),
    };
  });
  return { ok: true, profileId, employer, matches, items: matches, count: matches.length };
}

function safePublic(store, profileId) {
  const profile = store.profiles?.[profileId] || {};
  const { resumeText, ...rest } = profile; // never dump raw resume text into previews/exports
  return rest;
}

function previewCollections(store, profileId) {
  requireProfile(store, profileId);
  const applications = Object.values(ensure(store, 'applications'))
    .filter(item => item.profileId === profileId)
    .map(({ id: _ignored, ...app }) => ({ ...app, profileId }));
  const jobs = Object.values(ensure(store, 'jobs')).filter(job => job.profileId === profileId);
  const tasks = Object.values(ensure(store, 'tasks')).filter(task => task.profileId === profileId);
  const artifacts = Object.values(ensure(store, 'artifacts')).filter(artifact => artifact.profileId === profileId);
  const answers = Object.values(ensure(store, 'answers')).filter(item => item.profileId === profileId);
  const scores = Object.values(ensure(store, 'scores') || {})
    .filter(score => score.profileId === profileId || (jobs.some(job => job.id === score.jobId)));
  const contacts = Object.values(ensure(store, 'contacts')).filter(item => item.profileId === profileId);
  const research = Object.values(ensure(store, 'research')).filter(item => item.profileId === profileId);
  const outreachPlans = Object.values(ensure(store, 'outreachPlans')).filter(item => item.profileId === profileId);
  const outreachDrafts = Object.values(ensure(store, 'outreachDrafts')).filter(item => item.profileId === profileId);
  const interviewStories = Object.values(ensure(store, 'interviewStories')).filter(item => item.profileId === profileId);
  const interviewPrep = Object.values(ensure(store, 'interviewPrep')).filter(item => item.profileId === profileId);
  return { profile: safePublic(store, profileId), applications, jobs, tasks, artifacts, answers, scores, contacts, research, outreachPlans, outreachDrafts, interviewStories, interviewPrep };
}

/**
 * Secret-safe serializer for preview/export payloads. Guards against replacing
 * short, JSON-syntax-bearing env values (e.g. `true`) while still redacting
 * real secret values: secrets named in the environment are redacted only when
 * their value is long enough to be a genuine credential, and sk-/private-key
 * patterns are always redacted. Canonical preview content never contains these
 * values, so the result re-parses as valid JSON.
 */
function serialized(value) {
  let out = JSON.stringify(value, null, 2);
  for (const [key, envValue] of Object.entries(process.env)) {
    if (typeof envValue !== 'string' || envValue.length < 8) continue;
    if (/(?:secret|token|api[_-]?key|passwd|password|auth|private)/i.test(key)) {
      out = out.split(envValue).join('[redacted]');
    }
  }
  out = out.replace(/sk-[A-Za-z0-9]{8,}/g, '[redacted]');
  out = out.replace(/-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA |PGP |)PRIVATE KEY-----/gi, '[redacted]');
  return out;
}

/**
 * previewSync — a secret-safe, human-readable preview of the local state that
 * would be included in any future sync/export. It never performs or claims a
 * sync, and never dumps resume text or environment secrets.
 */
export function previewSync(store, { profileId }) {
  const preview = previewCollections(store, profileId);
  const text = serialized({
    ok: true,
    preview: true,
    profileId,
    updatedAt: now(),
    counts: {
      profiles: preview.profile && Object.keys(preview.profile).length ? 1 : 0,
      jobs: preview.jobs.length,
      applications: preview.applications.length,
      tasks: preview.tasks.length,
      artifacts: preview.artifacts.length,
      answers: preview.answers.length,
      scores: preview.scores.length,
    },
    items: preview,
    message: 'Preview only. Nothing was synced, sent, submitted, or exported externally.',
  });
  return JSON.parse(text);
}

/**
 * previewExport — same secret-safe content, shaped as a local export preview
 * with a suggested filename; nothing is written outside PLUGIN_DATA.
 */
export function previewExport(store, { profileId }) {
  const preview = previewCollections(store, profileId);
  const text = serialized({
    ok: true,
    export: true,
    preview: true,
    profileId,
    filename: `jobsss-profile-${String(profileId).replace(/[^a-z0-9]+/gi, '-')}-preview.json`,
    updatedAt: now(),
    counts: {
      jobs: preview.jobs.length,
      applications: preview.applications.length,
      tasks: preview.tasks.length,
      artifacts: preview.artifacts.length,
      answers: preview.answers.length,
    },
    items: preview,
    message: 'Export preview generated locally. Nothing was transmitted or written outside PLUGIN_DATA.',
  });
  return JSON.parse(text);
}