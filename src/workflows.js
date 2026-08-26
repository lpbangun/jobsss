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
import { id, now, hashText, tokenize } from './store.js';

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

const LOCAL_NOTE = 'Recorded locally under PLUGIN_DATA. No submission, sending, or other external action was performed; human review is required before any outside step.';

/**
 * syncTasksForApplication — persist a deterministic task set for a profile's
 * application so restart keeps the next actions visible. Deterministic ids
 * keep re-runs idempotent.
 */
export function syncTasksForApplication(store, { jobId, profileId, status }) {
  const tasks = ensure(store, 'tasks');
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
      text: `Tailor resume and cover letter from verified proof points for ${String(jobId)}.`,
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
  const application = writeApplication(store, jobId, profileId, { status: 'saved', savedAt: now() });
  syncTasksForApplication(store, { jobId, profileId, status: 'saved' });
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    application,
    message: 'Job saved locally. ' + LOCAL_NOTE,
  };
}

/** skipJob — explicit skip; local record only. */
export function skipJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const application = writeApplication(store, jobId, profileId, { status: 'skipped', skippedAt: now() });
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    application,
    message: 'Job skipped locally. ' + LOCAL_NOTE,
  };
}

/** archiveJob — explicit archive; local record only. */
export function archiveJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const application = writeApplication(store, jobId, profileId, { status: 'archived', archivedAt: now() });
  return {
    ok: true,
    jobId,
    profileId,
    status: application.status,
    application,
    message: 'Job archived locally. ' + LOCAL_NOTE,
  };
}

/** pursueJob — local pursuit handoff; never claims any external action. */
export function pursueJob(store, { jobId, profileId }) {
  const job = requireJobOwned(store, jobId, profileId);
  const application = writeApplication(store, jobId, profileId, { status: 'pursued', pursuedAt: now() });
  syncTasksForApplication(store, { jobId, profileId, status: 'pursued' });
  const artifactId = id('artifact', `${profileId}:${jobId}:application-readiness`);
  ensure(store, 'artifacts')[artifactId] = {
    id: artifactId,
    jobId,
    profileId,
    kind: 'application_readiness',
    status: 'draft_needs_human_review',
    title: `Application readiness: ${job.title}`,
    proofPointIds: Object.values(ensure(store, 'proofPoints'))
      .filter(proof => proof.profileId === profileId)
      .map(proof => proof.id),
    checklist: ['verify profile facts', 'verify proof points', 'review role fit', 'prepare materials'],
    createdAt: now(),
    updatedAt: now(),
  };
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
  syncTasksForApplication(store, { jobId, profileId, status: value });
  return {
    ok: true,
    jobId,
    profileId,
    status: value,
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

function proofPointsFor(store, profileId) {
  return Object.values(ensure(store, 'proofPoints'))
    .filter(proof => proof.profileId === profileId)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function profileSummary(profile) {
  return String(profile?.summary || '');
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
  const proofIds = proofs.map(proof => proof.id);
  const bullets = proofs.map(proof => {
    const metricNote = Array.isArray(proof.metrics) && proof.metrics.length
      ? ` Metrics shown are copied verbatim from the stored proof (${proof.metrics.slice(0, 3).join(', ')}).`
      : ' No metric was added: this draft only restates the stored proof.';
    return `- ${proof.summary} _(proof: ${proof.id}; human verification required)_.${metricNote}`;
  }).join('\n');

  const heading = kind === 'cover_letter'
    ? `Cover letter draft — ${job.title} at ${job.company}`
    : `Resume draft tailored toward ${job.title} at ${job.company}`;
  const body = [
    `# ${heading}`,
    '',
    `Profile: ${profile.name}`,
    '',
    kind === 'cover_letter'
      ? `I am applying for the ${job.title} role at ${job.company} and offer the verified experience below.`
      : profileSummary(profile) || 'Professional summary: verified from the stored profile.',
    '',
    '## Proof-grounded highlights',
    '',
    bullets,
    '',
    'This draft cites only stored proof point ids and copies their summaries or metrics verbatim.',
    'Every proof requires explicit human verification before this material may be shared with anyone.',
    'No submission, sending, or external action was performed.',
    '',
  ].join('\n');

  const artifactId = id('artifact', `${profileId}:${jobId}:${kind}:${hashText(body).slice(0, 12)}`);
  const nowIso = now();
  const artifact = {
    id: artifactId,
    jobId,
    profileId,
    kind: kind === 'resume' ? 'resume_draft' : 'cover_letter_draft',
    title: kind === 'resume' ? `Resume draft: ${job.title}` : `Cover letter draft: ${job.title}`,
    status: 'draft_needs_human_review',
    proofPointIds: proofIds,
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
  }
  return {
    ok: true,
    jobId,
    profileId,
    artifactId,
    artifact,
    document: { content: body, format, kind, proofPointIds: proofIds, artifactId },
    proofPointIds: proofIds,
    format,
    message:
      'Draft generated from stored proof points only. No invention of metrics, no submission, no sending; human verification required before any outside step.',
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
    .filter(artifact => artifact.profileId === profileId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
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
  const answerText = String(answer || '').trim();
  if (!questionText) throw Object.assign(new Error('addAnswer requires a question'), { code: 'missing_question' });
  if (!answerText) throw Object.assign(new Error('addAnswer requires an answer'), { code: 'missing_answer' });
  if (!ANSWER_SENSITIVITIES.includes(sensitivity)) {
    throw Object.assign(new Error(`Unsupported answer sensitivity: ${sensitivity}`), { code: 'invalid_sensitivity' });
  }
  if (!ANSWER_REUSE_SCOPES.includes(reuseScope)) {
    throw Object.assign(new Error(`Unsupported answer reuse scope: ${reuseScope}`), { code: 'invalid_reuse_scope' });
  }
  const ids = persistProofIds(store, profileId, proofPointIds, 'proofPointIds');
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
  const answers = Object.values(ensure(store, 'answers'))
    .filter(item => item.profileId === profileId)
    .filter(item => !category || item.category === category)
    .filter(item => !status || item.status === status)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return { ok: true, profileId, answers, items: answers, count: answers.length };
}

export function matchAnswers(store, { profileId, questions = [], employer = '' }) {
  requireProfile(store, profileId);
  const pool = Object.values(ensure(store, 'answers'))
    .filter(item => item.profileId === profileId && item.status === 'unverified');
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