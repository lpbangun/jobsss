// Host composition for autonomous multi-job application preparation.
//
// Purpose: let one host request ("select the best five eligible jobs and complete
// preparation for each") become one bounded, restart-safe JobSSS state change,
// WITHOUT moving provider-specific logic into this plugin.
//
// Boundaries this module deliberately keeps:
//   * provider-neutral: JobSSS never searches for people, never fetches job
//     boards here, never sends email, never submits an application. Job
//     selection uses jobs already in the canonical store; people evidence is
//     supplied by the host (people-finder / contact-brief) and only recorded,
//     normalized, and joined here.
//   * one implementation per behaviour: every step calls the SAME public
//     operation the explicit tool/skill route calls (score_job, pursue_job,
//     tailor_resume, draft_cover_letter, import_contact, record_research,
//     plan_outreach, draft_outreach). The batch is a composition of those
//     calls, not a second code path, so natural-language routing and explicit
//     skill routing converge on the same durable state.
//   * bounded: at most MAX_BATCH_ITEMS jobs and MAX_CONTACTS_PER_JOB contacts
//     per request; no queue, no scheduler, no retry loop, no daemon.
//   * honest: per-item status is 'prepared' | 'partial' | 'failed' | 'blocked'
//     | 'duplicate' | 'skipped'; one item's failure never collapses the batch,
//     and a contact miss is non-fatal bounded preparation with a structured
//     reason code. Nothing is fabricated to reach a target count.
//   * evidence class is mandatory: every host-supplied people result is
//     recorded as class 'live' | 'replay' | 'fixture'. 'live' requires
//     current-run metadata (provider + run id or capture time) so a replayed or
//     synthetic payload can never be presented as a fresh live discovery.
import {
  loadStore, commitStore, ensureDataDir, id, now, dedupeKeyForJob,
} from './store.js';
import { contactArtifactKey } from './projection.js';
import { unansweredRequiredFor } from './checklist.js';
import {
  scoreJob, pursueJob, tailorResume, draftCoverLetter,
} from './domain.js';
import {
  importContact, recordResearch, planOutreach, draftOutreach,
} from './relationships.js';

export const BATCH_SCHEMA = 'jobsss.preparation-batch/v1';
export const EVIDENCE_CLASSES = Object.freeze(['live', 'replay', 'fixture']);
export const BATCH_ITEM_STATUSES = Object.freeze(['prepared', 'partial', 'failed', 'blocked', 'duplicate', 'skipped']);

// Closed miss vocabulary. A contact miss must name one of these; free text
// never satisfies the structured-reason requirement.
export const CONTACT_MISS_CODES = Object.freeze([
  'no_public_channel',
  'not_found',
  'identity_mismatch',
  'uncertain',
  'not_enriched',
  'no_candidates',
  'budget_exhausted',
  'provider_error',
  'timeout',
  'rate_limited',
  'replay_no_match',
]);

// Bounded fan-out: a request may prepare at most this many jobs, with at most
// this many people per job. These are request bounds, not a scheduler.
export const MAX_BATCH_ITEMS = 5;
export const MAX_CONTACTS_PER_JOB = 8;

// Local statuses that mean the job is closed locally; a batch never reopens
// one, and the projection keeps rendering the closed history.
const TERMINAL_LOCAL_STATUSES = new Set(['skipped', 'archived', 'withdrawn', 'rejected', 'ghosted']);

// Local statuses at or beyond recorded pursuit. Re-running a batch must not
// regress a job that has already advanced (pursue_job always writes
// `pursued`), so pursuit is reused instead of rewritten.
const PURSUED_OR_LATER = new Set(['pursued', 'materials-ready', 'preparing', 'reviewing', 'offer-recorded']);

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function field(value, fallback = '') {
  return String(value == null ? '' : value).trim() || fallback;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function requireProfileRecord(store, profileId) {
  const value = field(profileId);
  if (!value) throw typedError('missing_profile', 'prepare/record requires profileId');
  const profile = (store.profiles || {})[value];
  if (!profile) throw typedError('unknown_profile', 'Unknown profile: ' + value);
  if (profile.archivedAt) throw typedError('archived_profile', 'Profile ' + value + ' is archived; restore it before using it');
  return profile;
}

function normalizeClass(value, { required = false } = {}) {
  const raw = field(value).toLowerCase();
  if (!raw) {
    if (required) throw typedError('missing_evidence_class', 'An explicit evidence class is required (live | replay | fixture)');
    return 'fixture';
  }
  if (!EVIDENCE_CLASSES.includes(raw)) {
    throw typedError('invalid_evidence_class', `Evidence class must be one of ${EVIDENCE_CLASSES.join(', ')}`);
  }
  return raw;
}

/**
 * A live claim must carry current-run metadata; a replay must name its original
 * run. This is the product-side guard against a fake live envelope.
 */
function assertClassMetadata(evidenceClass, { provider, runId, capturedAt }) {
  if (evidenceClass === 'live') {
    if (!field(provider)) throw typedError('live_evidence_unattributed', 'Live evidence requires the provider name that produced it');
    if (!field(runId) && !field(capturedAt)) {
      throw typedError('live_evidence_without_run', 'Live evidence requires a run id or capture timestamp from the current run');
    }
  }
  if (evidenceClass === 'replay' && !field(runId)) {
    throw typedError('replay_without_origin', 'Replay evidence must name the original run it re-presents');
  }
  return evidenceClass;
}

/** Stable logical job identity: two postings with one company/title/location are one logical job. */
export function logicalJobKey(job) {
  if (!job) return null;
  const key = dedupeKeyForJob({ title: job.title, company: job.company, location: job.location });
  return field(key, String(job.id || ''));
}

function explicitTrackedJobs(store, profileId) {
  return Object.values(store.jobs || {})
    .filter(job => job && job.profileId === profileId)
    .filter(job => job.saved === true || Boolean((store.applications || {})[job.id]))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function eligibleRankedJobs(store, profileId) {
  const ranked = [];
  for (const job of explicitTrackedJobs(store, profileId)) {
    const application = (store.applications || {})[job.id] || {};
    const score = (store.scores || {})[job.id] || null;
    const excluded = score?.eligibility?.status === 'excluded';
    ranked.push({
      job,
      score,
      excluded,
      terminal: TERMINAL_LOCAL_STATUSES.has(String(application.status || job.status || '')),
      overall: typeof score?.overall === 'number' ? score.overall : null,
    });
  }
  ranked.sort((a, b) => {
    const aOverall = a.overall == null ? -1 : a.overall;
    const bOverall = b.overall == null ? -1 : b.overall;
    return bOverall - aOverall || String(a.job.id).localeCompare(String(b.job.id));
  });
  return ranked;
}

/**
 * Pure, deterministic batch plan: which jobs to prepare, in what order, which
 * are duplicates of another selected job, and which are skipped with a reason.
 * No I/O, no mutation.
 */
export function planPreparationBatch(store, { profileId, jobIds = null, limit = MAX_BATCH_ITEMS } = {}) {
  requireProfileRecord(store, profileId);
  const bound = Math.max(1, Math.min(Number.isInteger(limit) ? limit : MAX_BATCH_ITEMS, MAX_BATCH_ITEMS));
  const requested = Array.isArray(jobIds) ? jobIds.map(String).map(value => value.trim()).filter(Boolean) : [];
  const items = [];
  const duplicates = [];
  const skipped = [];
  const seenKeys = new Map();
  const candidates = requested.length
    ? requested.map(jobId => {
      const job = (store.jobs || {})[jobId];
      const application = (store.applications || {})[jobId] || {};
      const score = (store.scores || {})[jobId] || null;
      return {
        job,
        jobId,
        score,
        excluded: score?.eligibility?.status === 'excluded',
        terminal: TERMINAL_LOCAL_STATUSES.has(String(application.status || job?.status || '')),
        overall: typeof score?.overall === 'number' ? score.overall : null,
      };
    })
    : eligibleRankedJobs(store, profileId).map(entry => ({ ...entry, jobId: entry.job.id }));

  for (const candidate of candidates) {
    if (items.length >= bound) {
      skipped.push({ jobId: candidate.jobId, reason: 'over_batch_bound', detail: `Batch bound is ${bound} items.` });
      continue;
    }
    if (!candidate.job) {
      items.push({ jobId: candidate.jobId, status: 'blocked', reason: 'unknown_job' });
      continue;
    }
    if (candidate.job.profileId !== profileId) {
      items.push({ jobId: candidate.jobId, status: 'blocked', reason: 'profile_mismatch' });
      continue;
    }
    const key = logicalJobKey(candidate.job);
    if (seenKeys.has(key)) {
      const original = seenKeys.get(key);
      duplicates.push({ jobId: candidate.jobId, duplicateOf: original, logicalKey: key });
      items.push({ jobId: candidate.jobId, logicalKey: key, status: 'duplicate', reason: `duplicate_of:${original}` });
      continue;
    }
    seenKeys.set(key, candidate.jobId);
    if (candidate.terminal) {
      skipped.push({ jobId: candidate.jobId, reason: 'terminal_local_state_preserved' });
      items.push({ jobId: candidate.jobId, logicalKey: key, status: 'skipped', reason: 'terminal_local_state_preserved' });
      continue;
    }
    if (candidate.excluded) {
      skipped.push({ jobId: candidate.jobId, reason: 'hard_exclusion' });
      items.push({ jobId: candidate.jobId, logicalKey: key, status: 'skipped', reason: 'hard_exclusion' });
      continue;
    }
    items.push({ jobId: candidate.jobId, logicalKey: key, status: 'pending' });
  }
  return {
    profileId,
    bound,
    requestedJobIds: requested,
    selectedJobIds: items.filter(item => item.status === 'pending').map(item => item.jobId),
    items,
    duplicates,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Contact evidence (host-supplied; bounded preparation)
// ---------------------------------------------------------------------------

function normalizeContactItem(args = {}) {
  const subject = asObject(args.subject);
  const name = field(args.subjectName, field(subject.name, field(args.name)));
  const company = field(args.subjectCompany, field(subject.company, field(args.company)));
  const role = field(args.role, field(subject.role));
  const email = field(args.email).toLowerCase();
  const emailStatus = email ? 'provider_reported' : null;
  return { name, company, role, email, emailStatus };
}

function existingLogicalContact(store, profileId, { name, company, email }) {
  const wanted = contactArtifactKey({ name, company, email });
  return Object.values(store.contacts || {}).find(contact => contact
    && contact.profileId === profileId
    && contactArtifactKey({ name: contact.name, company: contact.company, email: contact.email }) === wanted) || null;
}

/**
 * Record one bounded contact-discovery outcome for a profile/job: either
 * attributed contact evidence or an honest structured miss. Never searches,
 * never sends, never marks human approval, never promotes a provider-reported
 * address to a verified mailbox.
 */
export function recordContactDiscovery(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const jobId = field(args.jobId) || null;
  const subject = normalizeContactItem(args);
  if (!subject.name && !subject.company) {
    throw typedError('missing_subject', 'record_contact_discovery requires subjectName or subjectCompany');
  }
  const evidenceClass = normalizeClass(args.class);
  const providerName = field(args.provider, field(asObject(args.providerRecord).name));
  const runId = field(args.runId, field(asObject(args.providerRecord).runId));
  const capturedAt = field(args.capturedAt, field(asObject(args.providerRecord).retrievedAt));
  assertClassMetadata(evidenceClass, { provider: providerName, runId, capturedAt });

  const declaredStatus = field(args.status, subject.email ? 'contact_brief' : 'miss').toLowerCase();
  const status = declaredStatus === 'contact_brief' ? 'contact_brief' : declaredStatus === 'miss' ? 'miss' : null;
  if (!status) throw typedError('invalid_contact_status', "status must be 'contact_brief' or 'miss'");
  if (status === 'contact_brief' && !subject.email) {
    throw typedError('contact_brief_without_address', 'A contact brief requires the provider-reported address it is based on');
  }
  if (status === 'contact_brief' && !providerName) {
    // An address must be attributed: JobSSS never invents or guesses patterns.
    throw typedError('unattributed_address', 'A provider-reported address requires the provider that reported it');
  }
  const missCode = field(args.missReasonCode, field(asObject(args.missReason).code));
  const missDetail = field(args.missReasonDetail, field(asObject(args.missReason).detail));
  if (status === 'miss' && !CONTACT_MISS_CODES.includes(missCode)) {
    throw typedError('missing_miss_reason', `A contact miss requires a structured reason code: ${CONTACT_MISS_CODES.join(', ')}`);
  }
  const evidence = (Array.isArray(args.evidence) ? args.evidence : [])
    .map(item => asObject(item))
    .filter(item => field(item.ref, field(item.value, field(item.kind))))
    .slice(0, 8);
  const notes = field(args.notes);
  const expectedRevision = args.expectedRevision != null ? args.expectedRevision : null;
  const contactKey = contactArtifactKey({ name: subject.name, company: subject.company, email: subject.email });

  let outcome = null;
  commitStore(dataDir, { expectedRevision }, store => {
    requireProfileRecord(store, profileId);
    if (jobId) {
      const job = (store.jobs || {})[jobId];
      if (!job) throw typedError('unknown_job', `Unknown job: ${jobId}`);
      if (job.profileId !== profileId) throw typedError('profile_mismatch', `Job ${jobId} belongs to profile ${job.profileId}, not ${profileId}`);
    }
    const discoveries = store.contactDiscoveries || (store.contactDiscoveries = {});
    const discoveryId = id('discovery', `${profileId}:${jobId || ''}:${contactKey}`);
    const prior = discoveries[discoveryId] || null;
    const at = now();
    const existingContact = existingLogicalContact(store, profileId, subject);
    // A human-suppressed contact stays suppressed: bounded preparation records
    // the protection instead of rewriting the evidence or resurrecting the
    // person, and no outreach is generated for it.
    const suppressed = Boolean(existingContact && existingContact.doNotUse);
    const record = {
      id: discoveryId,
      schema: 'jobsss.contact-discovery/v1',
      profileId,
      jobId,
      contactKey,
      class: evidenceClass,
      status,
      subject: { name: subject.name || null, company: subject.company || null, role: subject.role || null },
      email: status === 'contact_brief' ? subject.email : null,
      emailStatus: status === 'contact_brief' ? 'provider_reported' : 'not_checked',
      provider: providerName ? { name: providerName, runId: runId || null, retrievedAt: capturedAt || null } : null,
      evidence,
      missReason: status === 'miss' ? { code: missCode, detail: missDetail || null } : null,
      notes,
      contactId: prior?.contactId || (existingContact ? existingContact.id : null),
      researchId: prior?.researchId || null,
      humanProtected: [
        ...(existingContact?.humanApproved ? ['humanApproved'] : []),
        ...(suppressed ? ['doNotUse'] : []),
      ],
      history: [...(Array.isArray(prior?.history) ? prior.history : []), {
        status, class: evidenceClass, at,
        provider: providerName || null, runId: runId || null,
        reason: suppressed ? 'existing_contact_suppressed' : (status === 'miss' ? missCode : null),
      }],
      createdAt: prior?.createdAt || at,
      updatedAt: at,
    };
    discoveries[discoveryId] = record;
    outcome = { discoveryId, id: discoveryId, discovery: record, created: !prior };
    return store;
  });

  // Durable joins into the existing relationship surfaces (unchanged
  // semantics): an attributed brief becomes a local contact record
  // (humanApproved always false), and every outcome is a research record so
  // map_reachable_network / record_research readback sees the same evidence.
  const store = loadStore(dataDir);
  const record = store.contactDiscoveries?.[outcome.discoveryId] || outcome.discovery;
  let contactJoin = null;
  if (record.status === 'contact_brief' && record.email && !record.contactId) {
    const imported = importContact(dataDir, {
      profileId,
      name: record.subject.name || record.subject.company,
      email: record.email,
      company: record.subject.company || '',
      role: record.subject.role || '',
      source: `contact_discovery:${record.class}`,
      notes: record.notes || `Supplied by ${record.provider?.name || 'host'}${record.provider?.runId ? ` (run ${record.provider.runId})` : ''}; provider-reported, not a verified mailbox.`,
      expectedRevision: null,
    });
    contactJoin = imported;
  }
  const research = record.researchId
    ? { researchId: record.researchId, reused: true }
    : recordResearch(dataDir, {
      profileId,
      jobId: jobId || '',
      subjectName: record.subject.name || '',
      subjectCompany: record.subject.company || '',
      source: `contact_discovery:${record.status}`,
      notes: record.status === 'contact_brief'
        ? 'Host-supplied contact evidence recorded as bounded preparation; no message composed or sent.'
        : `Contact miss recorded as bounded preparation (${record.missReason?.code}): ${record.missReason?.detail || 'no detail'}`,
      findings: record.evidence.map(item => `${field(item.kind, 'ref')}:${field(item.ref, field(item.value, ''))}`),
      expectedRevision: null,
    });
  const linked = commitStore(dataDir, { expectedRevision: null }, storeToLink => {
    const target = storeToLink.contactDiscoveries?.[outcome.discoveryId];
    if (target) {
      target.contactId = contactJoin ? contactJoin.contactId : target.contactId;
      target.researchId = research.researchId;
      target.updatedAt = now();
    }
    return storeToLink;
  }).store;
  const finalRecord = linked.contactDiscoveries?.[outcome.discoveryId] || record;
  return {
    ok: true,
    profileId,
    jobId,
    discoveryId: finalRecord.id,
    discovery: finalRecord,
    contact: finalRecord.contactId ? linked.contacts?.[finalRecord.contactId] || null : null,
    researchId: finalRecord.researchId,
    fatal: false,
    message: finalRecord.status === 'contact_brief'
      ? 'Contact evidence recorded locally. The address is provider-reported, not a verified mailbox; nothing was sent.'
      : 'Contact miss recorded locally with a structured reason. A miss is non-fatal bounded preparation and does not block the application packet.',
  };
}

// ---------------------------------------------------------------------------
// Multi-job preparation batch
// ---------------------------------------------------------------------------

function coverLetterDecision(store, job, profileId, request) {
  if (request === false) return { draft: false, reason: 'not_requested' };
  if (request === true) return { draft: true, reason: 'requested' };
  const posting = String(job.description || job.postingText || '');
  const proofs = Object.values(store.proofPoints || {}).filter(proof => proof && proof.profileId === profileId && !proof.retiredAt);
  if (!proofs.length) return { draft: false, reason: 'no_profile_proof' };
  if (posting.trim().length < 120) return { draft: false, reason: 'posting_text_too_thin_to_address' };
  return { draft: true, reason: 'auto_justified' };
}

function existingOutreachFor(store, profileId, jobId) {
  const plans = Object.values(store.outreachPlans || {})
    .filter(item => item && item.profileId === profileId && item.jobId === jobId);
  const drafts = Object.values(store.outreachDrafts || {})
    .filter(item => item && item.profileId === profileId && item.jobId === jobId && item.kind === 'initial');
  return { plan: plans[0] || null, draft: drafts[0] || null };
}

function batchRecordId(profileId, jobIds, evidenceClass) {
  return id('batch', `${profileId}:${jobIds.join(',')}:${evidenceClass}`);
}

/**
 * Prepare up to MAX_BATCH_ITEMS owned jobs for one profile in one bounded
 * request, recording one durable batch record with honest per-item statuses.
 *
 * Each item runs the same public operations the explicit tool route runs, in
 * the same order, so both routing styles leave identical durable state:
 *   score_job -> pursue_job -> tailor_resume -> draft_cover_letter (when
 *   justified) -> contact evidence (host-supplied) -> unsent outreach draft
 *   (only when a reachable supplied channel exists and none is stored yet).
 *
 * Failure isolation: an item that throws is recorded as failed/blocked and the
 * remaining items still run. A contact miss is recorded, not fatal. Re-running
 * the same request updates the same batch record and adds no duplicate logical
 * job, artifact, contact, research record, or outreach draft.
 */
export function prepareApplicationsBatch(dataDir, args = {}) {
  ensureDataDir(dataDir);
  const profileId = field(args.profileId);
  const store = loadStore(dataDir);
  requireProfileRecord(store, profileId);
  const evidenceClass = normalizeClass(args.class);
  if (evidenceClass === 'live') {
    assertClassMetadata('live', {
      provider: field(args.provider, field(asObject(args.providerRecord).name)),
      runId: field(args.runId, field(asObject(args.providerRecord).runId)),
      capturedAt: field(args.capturedAt, field(asObject(args.providerRecord).retrievedAt)),
    });
  }
  const format = field(args.format, 'markdown').toLowerCase();
  const plan = planPreparationBatch(store, { profileId, jobIds: args.jobIds, limit: args.limit });
  const suppliedContacts = new Map();
  for (const raw of (Array.isArray(args.contacts) ? args.contacts : [])) {
    const item = asObject(raw);
    const jobId = field(item.jobId);
    if (!jobId) continue;
    suppliedContacts.set(jobId, [...(suppliedContacts.get(jobId) || []), item].slice(0, MAX_CONTACTS_PER_JOB));
  }
  const batchId = batchRecordId(profileId, plan.items.map(item => item.jobId), evidenceClass);
  const previous = store.preparationBatches?.[batchId] || null;
  const results = [];

  // A logical duplicate is NOT a second tracked job: the losing posting keeps
  // its record (database-only, like any untracked discovery) and is marked with
  // the job it duplicates, so no second application packet directory is
  // materialized and a re-run stays deterministic.
  if (plan.duplicates.length) {
    commitStore(dataDir, { expectedRevision: null }, storeToMark => {
      const at = now();
      for (const duplicate of plan.duplicates) {
        const job = (storeToMark.jobs || {})[duplicate.jobId];
        if (!job) continue;
        job.duplicateOf = duplicate.duplicateOf;
        job.duplicateOfLogicalKey = duplicate.logicalKey;
        job.localDuplicate = true;
        job.saved = false;
        job.updatedAt = at;
      }
      storeToMark.audit = Array.isArray(storeToMark.audit) ? storeToMark.audit : [];
      for (const duplicate of plan.duplicates) {
        storeToMark.audit.push({
          event: 'logical_duplicate_untracked',
          entityId: duplicate.jobId,
          entityType: 'job',
          duplicateOf: duplicate.duplicateOf,
          logicalKey: duplicate.logicalKey,
          actor: 'local_composition',
          createdAt: at,
        });
      }
      return storeToMark;
    });
  }

  for (const planned of plan.items) {
    if (planned.status !== 'pending') {
      results.push({ ...planned, contact: null, artifacts: {}, prepared: false });
      continue;
    }
    const jobId = planned.jobId;
    const item = {
      jobId,
      logicalKey: planned.logicalKey,
      status: 'pending',
      reason: null,
      class: evidenceClass,
      score: null,
      pursuit: null,
      evidence: null,
      artifacts: {},
      reviewGaps: null,
      contacts: [],
      outreach: null,
      preservedProtectedFields: [],
      errors: [],
    };
    try {
      // 1. deterministic offline score (same call as score_job)
      const scoreResult = scoreJob(dataDir, { jobId, profileId });
      item.score = {
        overall: scoreResult.overall ?? null,
        scoreStatus: scoreResult.scoreStatus ?? null,
        eligibility: scoreResult.eligibility?.status ?? 'unknown',
        hardFailures: (scoreResult.eligibility?.hardFailures || []).map(failure => field(failure.dimension, 'constraint')),
      };
      // 2. local pursuit record (same call as pursue_job). A job already at or
      // beyond pursuit keeps its advanced local status instead of regressing.
      const beforePursuit = loadStore(dataDir);
      const currentStatus = String((beforePursuit.applications || {})[jobId]?.status || '');
      if (PURSUED_OR_LATER.has(currentStatus)) {
        item.pursuit = { reused: true, status: currentStatus };
      } else {
        pursueJob(dataDir, { jobId, profileId });
        item.pursuit = { reused: false, status: 'pursued' };
      }
      // 3. tailored resume (same call as tailor_resume)
      const resume = tailorResume(dataDir, { jobId, profileId, format });
      const requirementCount = Array.isArray(resume.requirements) ? resume.requirements.length : 0;
      const matchedCount = resume.coverage?.matches?.length ?? 0;
      item.evidence = { requirements: requirementCount, matchedRequirements: matchedCount, coverageGaps: (resume.gaps || []).length };
      item.artifacts.resume = {
        artifactId: resume.artifactId,
        format: resume.format || format,
        coverageGaps: (resume.gaps || []).map(gap => field(gap.requirementId, 'requirement')),
        pdfRelativePath: resume.document?.path ? String(resume.document.path).split('/').pop() : null,
        pdfSha256: resume.document?.sha256 || null,
      };
      // 4. cover letter only when the job justifies one
      const beforeCover = loadStore(dataDir);
      const cover = coverLetterDecision(beforeCover, (beforeCover.jobs || {})[jobId] || {}, profileId, args.coverLetter);
      if (cover.draft) {
        const letter = draftCoverLetter(dataDir, { jobId, profileId, format });
        item.artifacts.coverLetter = {
          artifactId: letter.artifactId,
          reason: cover.reason,
          coverageGaps: (letter.gaps || []).map(gap => field(gap.requirementId, 'requirement')),
        };
      } else {
        item.artifacts.coverLetter = { artifactId: null, reason: cover.reason };
      }
      // 5. host-supplied people evidence (bounded, labelled, non-fatal)
      for (const supplied of (suppliedContacts.get(jobId) || [])) {
        try {
          const recorded = recordContactDiscovery(dataDir, {
            ...supplied,
            profileId,
            jobId,
            class: field(supplied.class, evidenceClass),
            provider: field(supplied.provider, field(args.provider, field(asObject(args.providerRecord).name))),
            runId: field(supplied.runId, field(args.runId, field(asObject(args.providerRecord).runId))),
            capturedAt: field(supplied.capturedAt, field(args.capturedAt, field(asObject(args.providerRecord).retrievedAt))),
          });
          item.contacts.push({
            discoveryId: recorded.discoveryId,
            contactKey: recorded.discovery.contactKey,
            status: recorded.discovery.status,
            missReason: recorded.discovery.missReason?.code || null,
            contactId: recorded.discovery.contactId || null,
            fatal: false,
          });
        } catch (error) {
          item.contacts.push({ status: 'failed', error: { code: error.code || 'contact_error', message: String(error.message || error) }, fatal: false });
        }
      }
      // 6. unsent outreach draft for the first reachable supplied channel
      const fresh = loadStore(dataDir);
      const reachable = item.contacts
        .map(entry => (entry.contactId ? fresh.contacts?.[entry.contactId] : null))
        .find(contact => contact && contact.email && !contact.doNotUse);
      if (reachable) {
        const existing = existingOutreachFor(fresh, profileId, jobId);
        if (existing.plan && existing.draft) {
          item.outreach = { planId: existing.plan.id, draftId: existing.draft.id, created: false, reason: 'existing_unsent_draft_preserved' };
        } else {
          const planResult = existing.plan || planOutreach(dataDir, { jobId, profileId, goal: field(args.outreachGoal, 'informational'), contactId: reachable.id });
          const draftResult = existing.draft || draftOutreach(dataDir, { jobId, profileId, goal: field(args.outreachGoal, 'informational'), contactId: reachable.id });
          item.outreach = {
            planId: planResult.planId || planResult.id,
            draftId: draftResult.draftId || draftResult.id,
            created: !(existing.plan && existing.draft),
            delivered: false,
          };
        }
      } else if (item.contacts.length) {
        item.outreach = { planId: null, draftId: null, created: false, reason: 'no_reachable_supplied_channel' };
      }
      const after = loadStore(dataDir);
      const job = (after.jobs || {})[jobId] || {};
      item.reviewGaps = unansweredRequiredFor(after, job);
      // Human-protected state this item observed and deliberately preserved.
      const preserved = new Set();
      for (const entry of item.contacts) {
        const contact = entry.contactId ? after.contacts?.[entry.contactId] : null;
        if (contact?.humanApproved) preserved.add('humanApproved');
        if (contact?.doNotUse) preserved.add('doNotUse');
      }
      for (const artifact of Object.values(after.artifacts || {})) {
        if (artifact && artifact.jobId === jobId && artifact.profileId === profileId && artifact.approvedAt) preserved.add('artifact.approved');
      }
      item.preservedProtectedFields = [...preserved].sort();
      // Honest partial packet: the local record and materials exist, but either
      // the deterministic score could not be computed from stored evidence or
      // no profile proof supports any extracted requirement (the posting has
      // nothing this profile can honestly answer with).
      if (item.score.overall == null) {
        item.status = 'partial';
        item.reason = 'score_unknown_from_stored_evidence';
      } else if (item.evidence.matchedRequirements === 0) {
        item.status = 'partial';
        item.reason = 'no_requirement_matched_by_profile_proof';
      } else {
        item.status = 'prepared';
        item.reason = null;
      }
    } catch (error) {
      const code = error?.code || 'item_error';
      const blocked = ['unknown_job', 'unknown_profile', 'profile_mismatch', 'no_proofs'].includes(code);
      item.status = blocked ? 'blocked' : 'failed';
      item.reason = code;
      item.errors.push({ code, message: String(error?.message || error) });
    }
    results.push(item);
  }

  const summary = {
    requested: plan.items.length,
    prepared: results.filter(item => item.status === 'prepared').length,
    partial: results.filter(item => item.status === 'partial').length,
    failed: results.filter(item => item.status === 'failed').length,
    blocked: results.filter(item => item.status === 'blocked').length,
    duplicates: results.filter(item => item.status === 'duplicate').length,
    skipped: results.filter(item => item.status === 'skipped').length,
    contactMisses: results.reduce((total, item) => total + (item.contacts || []).filter(entry => entry.status === 'miss').length, 0),
    externalActions: 0,
  };
  const batchStatus = summary.requested === 0
    ? 'no_items'
    : summary.failed + summary.blocked === summary.requested
      ? 'failed'
      : summary.failed + summary.blocked > 0 || summary.partial > 0 || summary.skipped > 0 || summary.duplicates > 0
        ? 'partial_success'
        : 'prepared';

  let committed = null;
  commitStore(dataDir, { expectedRevision: null }, storeToWrite => {
    const at = now();
    storeToWrite.preparationBatches = storeToWrite.preparationBatches || {};
    const prior = storeToWrite.preparationBatches[batchId] || null;
    const record = {
      id: batchId,
      schema: BATCH_SCHEMA,
      profileId,
      class: evidenceClass,
      requestedJobIds: plan.items.map(item => item.jobId),
      items: results,
      duplicates: plan.duplicates,
      skipped: plan.skipped,
      summary,
      status: batchStatus,
      runs: (prior?.runs || 0) + 1,
      createdAt: prior?.createdAt || at,
      updatedAt: at,
      boundaries: {
        localPreparationOnly: true,
        externalActions: 0,
        sent: false,
        submitted: false,
        applied: false,
        providerNeutral: true,
      },
      message: 'Bounded local preparation batch. JobSSS prepared and recorded materials and people evidence; it did not search for people, send, submit, or apply.',
    };
    storeToWrite.preparationBatches[batchId] = record;
    committed = record;
    return storeToWrite;
  });

  return {
    ok: true,
    profileId,
    batchId,
    batch: committed,
    status: batchStatus,
    summary,
    items: results,
    projections: results
      .filter(item => item.status === 'prepared' || item.status === 'partial')
      .map(item => ({
        jobId: item.jobId,
        application: `applications/${item.jobId}/application.md`,
        contacts: (item.contacts || []).filter(entry => entry.contactKey)
          .map(entry => `applications/${item.jobId}/contacts/${entry.contactKey}.md`),
      })),
    duplicateBatchRuns: (previous?.runs || 0) + 1,
    message: batchStatus === 'no_items'
      ? 'No owned jobs were eligible to prepare; nothing was fabricated to reach a target count.'
      : 'Bounded local preparation batch recorded. No sending, submission, or application was performed.',
  };
}

/** Restart readback of recorded preparation batches and their per-item statuses. */
export function listPreparationBatches(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const store = loadStore(dataDir);
  requireProfileRecord(store, profileId);
  const batches = Object.values(store.preparationBatches || {})
    .filter(batch => batch && batch.profileId === profileId)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  return {
    ok: true,
    profileId,
    batches,
    items: batches,
    count: batches.length,
    perItemStatuses: batches.flatMap(batch => (batch.items || []).map(item => ({ batchId: batch.id, jobId: item.jobId, status: item.status, reason: item.reason || null }))),
    message: 'Recorded preparation batches read back from PLUGIN_DATA. Statuses are local preparation states only.',
  };
}

/** Read-only projection of the bounded contact-discovery evidence for a profile. */
export function listContactDiscoveries(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const store = loadStore(dataDir);
  requireProfileRecord(store, profileId);
  const jobId = field(args.jobId) || null;
  const discoveries = Object.values(store.contactDiscoveries || {})
    .filter(record => record && record.profileId === profileId && (!jobId || record.jobId === jobId))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    ok: true,
    profileId,
    jobId,
    discoveries,
    items: discoveries,
    count: discoveries.length,
    misses: discoveries.filter(record => record.status === 'miss').length,
    message: 'Local bounded contact evidence. Provider-reported addresses are not verified mailboxes, and a miss is non-fatal.',
  };
}
