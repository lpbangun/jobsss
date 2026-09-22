// Deterministic human-readable workspace projection for the bundled JobSSS
// runtime.
//
// Purpose (frozen G4/G5 output contract): the canonical versioned store under
// PLUGIN_DATA stays authoritative, and Markdown is a generated projection of
// it. Every file this module renders is a pure function of committed store
// state, so regenerating the same store yields byte-identical files (restart
// safe, no drift, no duplicated logical job or contact).
//
// Purity: no filesystem access, no network, no subprocess, no `Date.now()`.
// The only imported module is the shared pure readiness gate; this file must
// never import src/store.js (store.js imports this one to stage the projection
// writes inside the same serialized commit transaction).
//
// Authority: the projection cannot approve, verify, send, submit, or apply.
// Human-only state (proof verification, artifact approval, contact approval or
// suppression, delivered outreach, externally observed status) is rendered from
// the fields the trusted local CLI wrote and is never synthesized here.
import { createHash } from 'node:crypto';
import { unansweredRequiredFor } from './checklist.js';

export const WORKSPACE_PROJECTION_SCHEMA = 'jobsss.workspace-projection/v1';

// Path segments must match store.js SAFE_SEGMENT so a projection can never be
// rejected mid-transaction for a segment the canonical layer accepted.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Local task statuses that mean "this job is closed locally"; the projection
// keeps rendering them (history stays visible) but never implies pursuit.
const TERMINAL_LOCAL_STATUSES = new Set(['skipped', 'archived', 'withdrawn', 'rejected', 'ghosted']);

function text(value, fallback = '—') {
  const out = String(value == null ? '' : value).trim();
  return out || fallback;
}

function sortedIds(collection) {
  return Object.keys(collection || {}).sort((a, b) => a.localeCompare(b));
}

function list(items) {
  const values = (Array.isArray(items) ? items : []).filter(item => String(item == null ? '' : item).trim());
  return values.length ? values : ['(none recorded)'];
}

function timestamp(value) {
  const out = text(value, '');
  return out || 'not recorded';
}

function normalizeIdentityPart(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Stable logical identity of a person record: name + company + known address.
 * Two records with the same normalized identity are the SAME logical contact,
 * so a deterministic re-run reuses one artifact file instead of duplicating it.
 */
export function contactArtifactKey({ name, company, email } = {}) {
  const identity = [normalizeIdentityPart(name), normalizeIdentityPart(company), normalizeIdentityPart(email)].join('|');
  return `contact_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}

/** Portable relative path (never absolute) for an exported document record. */
export function portableDocumentPath(exportRecord) {
  if (!exportRecord) return null;
  const raw = String(exportRecord.relativePath || exportRecord.path || exportRecord.filePath || '').trim();
  if (!raw) return null;
  const base = raw.split('/').pop();
  if (!base || base === '.' || base === '..' || /\\/.test(base)) return null;
  return base;
}

function requireSegment(segment, label) {
  const value = String(segment == null ? '' : segment);
  if (!SAFE_SEGMENT.test(value)) {
    throw Object.assign(new Error(`Unsafe ${label} projection segment: ${value}`), {
      code: 'unsafe_projection_path',
      details: { path: value },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Shared render helpers
// ---------------------------------------------------------------------------

function proofLine(proof) {
  const verification = proof.verification === 'human_verified' || proof.verifiedAt
    ? `human-verified${proof.verifiedAt ? ` ${proof.verifiedAt}` : ''}`
    : 'needs human verification';
  return `- ${proof.id} — ${text(proof.summary)} (${verification})`;
}

function decisionLines(store, profileId) {
  const decisions = store.decisions || {};
  const out = [];
  for (const entityId of sortedIds(decisions)) {
    const ledger = decisions[entityId];
    if (!ledger || (ledger.profileId && ledger.profileId !== profileId)) continue;
    for (const entry of (Array.isArray(ledger.history) ? ledger.history : [])) {
      out.push(`- ${timestamp(entry.createdAt)} ${text(entry.action, 'decision')} on ${entityId} `
        + `(revision ${text(entry.revision, '1')}, actor ${text(entry.actor, 'unknown')})`
        + `${entry.note ? ` — ${entry.note}` : ''}`);
    }
  }
  return out;
}

function artifactsFor(store, profileId, jobId, kind) {
  return Object.values(store.artifacts || {})
    .filter(item => item && item.profileId === profileId && item.jobId === jobId && item.kind === kind && !item.retiredAt)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
}

function explicitJobsFor(store, profileId) {
  return Object.values(store.jobs || {})
    .filter(job => job && job.profileId === profileId)
    .filter(job => job.saved === true || Boolean((store.applications || {})[job.id]))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Jobs that own an application packet directory. A packet exists only for a
 * job the profile actually started preparing (an application record exists);
 * a merely saved/imported posting is listed in tracker.md and keeps its record
 * in the canonical store, but materializes no packet folder. This also keeps a
 * logical duplicate (untracked on detection) from leaving a stale second
 * packet directory behind.
 */
function packetJobsFor(store, profileId) {
  return Object.values(store.jobs || {})
    .filter(job => job && job.profileId === profileId && Boolean((store.applications || {})[job.id]))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function applicationFor(store, jobId) {
  return (store.applications || {})[jobId] || null;
}

function discoveriesFor(store, profileId, jobId) {
  return Object.values(store.contactDiscoveries || {})
    .filter(record => record && record.profileId === profileId && record.jobId === jobId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function outreachFor(store, profileId, jobId) {
  const plans = Object.values(store.outreachPlans || {})
    .filter(item => item && item.profileId === profileId && item.jobId === jobId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const drafts = Object.values(store.outreachDrafts || {})
    .filter(item => item && item.profileId === profileId && item.jobId === jobId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { plans, drafts };
}

/**
 * Fit rationale rendered from the stored deterministic score only. Unknown or
 * unavailable dimensions are stated as unknown; nothing is inferred.
 */
export function fitRationaleLines(score) {
  if (!score) return ['- No stored fit score yet. Run score_job for this job and profile.'];
  const lines = [
    `- Overall: ${score.overall == null ? `unknown (${text(score.scoreStatus, 'score unavailable')})` : score.overall}`,
    `- Eligibility: ${text(score.eligibility?.status, 'unknown')}`
      + `${score.eligibility?.actionable === false ? ' (not actionable as scored)' : ''}`,
    `- Evidence coverage: ${score.evidenceCoverage == null ? 'unknown' : score.evidenceCoverage}`
      + `${score.confidence ? ` (confidence ${score.confidence})` : ''}`,
  ];
  const hard = (score.eligibility?.hardFailures || []).map(item => `${text(item.dimension, 'constraint')}: ${text(item.detail || item.reason, 'confirmed failure')}`);
  lines.push(...(hard.length ? hard.map(item => `- Hard failure: ${item}`) : ['- Hard failures: none confirmed']));
  const dimensions = score.dimensions || {};
  for (const key of sortedIds(dimensions)) {
    const dimension = dimensions[key] || {};
    lines.push(`- ${key}: ${dimension.status === 'unknown' || dimension.score == null ? 'unknown' : dimension.score}`
      + `${dimension.weight == null ? '' : ` (weight ${dimension.weight})`}`
      + `${dimension.status === 'unknown' ? ' — evidence missing, not assumed' : ''}`);
  }
  const unknowns = score.unknowns || score.eligibility?.unknowns;
  if (Array.isArray(unknowns) && unknowns.length) lines.push(`- Unknowns recorded: ${unknowns.map(item => String(item)).join('; ')}`);
  return lines;
}

function materialSection(store, profileId, jobId, kind, heading) {
  const artifacts = artifactsFor(store, profileId, jobId, kind);
  const lines = [`### ${heading}`, ''];
  if (!artifacts.length) {
    lines.push('- Not produced (review-gap truth: no artifact exists for this job yet).', '');
    return lines;
  }
  for (const artifact of artifacts) {
    const approval = artifact.approvedAt
      ? `human-approved ${artifact.approvedAt}`
      : artifact.rejectedAt
        ? `human-rejected ${artifact.rejectedAt}`
        : 'needs human review';
    lines.push(`- ${artifact.id} (${text(artifact.format, 'markdown')}, ${approval})`);
    lines.push(`  - content hash: ${text(artifact.contentHash, 'not recorded')}`);
    const pdfPath = portableDocumentPath(artifact.export);
    if (pdfPath) {
      lines.push(`  - rendered PDF (portable path relative to PLUGIN_DATA): ${pdfPath}`);
      lines.push(`  - PDF sha256: ${text(artifact.export.sha256, 'not recorded')}; pages: ${text(artifact.export.pageCount, 'unknown')}; engine: ${text(artifact.export.engine, 'unknown')}`);
    }
    const gaps = (artifact.document && Array.isArray(artifact.document.gaps) ? artifact.document.gaps : []);
    if (gaps.length) {
      lines.push(`  - coverage gaps (honest, not filled): ${gaps.map(gap => `${text(gap.requirementId, 'requirement')} "${String(gap.sourceText || '').trim()}"`).join('; ')}`);
    } else {
      lines.push('  - coverage gaps: none recorded for the extracted requirements');
    }
  }
  lines.push('');
  return lines;
}

function answersSection(store, profileId, jobId) {
  const answers = Object.values(store.answers || {})
    .filter(item => item && item.profileId === profileId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const job = (store.jobs || {})[jobId] || {};
  const required = new Set(((job.applicationDetail?.questions) || []).filter(item => item && item.required).map(item => String(item.label)));
  const lines = ['### Answers and notes', ''];
  if (!answers.length) {
    lines.push('- No stored reusable answers for this profile yet.', '');
    return lines;
  }
  for (const answer of answers) {
    const scope = required.has(String(answer.question)) ? 'job ask list' : 'profile-owned reusable answer';
    lines.push(`- ${answer.id} (${text(answer.sensitivity, 'personal')}, ${text(answer.reuseScope, 'global')}, ${scope}): ${text(answer.question)}`);
    lines.push(`  - ${text(answer.answer, answer.text || '(no stored text)')}`);
  }
  const tasks = Object.values(store.tasks || {})
    .filter(task => task && task.profileId === profileId && task.jobId === jobId && task.status === 'open')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  lines.push('', '### Next actions (local)', '');
  lines.push(...list(tasks.map(task => `${task.kind === 'next' ? 'next' : 'action'}: ${task.text}`)));
  lines.push('');
  return lines;
}

function peopleSection(store, profileId, jobId, { includeDetail = true } = {}) {
  const discoveries = discoveriesFor(store, profileId, jobId);
  const lines = ['### People and contact evidence', ''];
  if (!discoveries.length) {
    lines.push('- No contact evidence or miss recorded for this job yet.', '');
    return lines;
  }
  for (const record of discoveries) {
    const key = record.contactKey || contactArtifactKey(record.subject || {});
    const subject = `${text(record.subject?.name, '(unnamed)')}${record.subject?.company ? ` at ${record.subject.company}` : ''}`;
    const status = record.status === 'contact_brief'
      ? `contact brief available (email ${record.emailStatus === 'provider_reported' ? 'provider-reported' : 'not checked'})`
      : `contact miss — ${text(record.missReason?.code, 'unspecified')}`;
    lines.push(`- ${key} — ${subject}: ${status}`);
    if (record.missReason?.detail) lines.push(`  - miss detail: ${record.missReason.detail}`);
    if (includeDetail) lines.push(`  - evidence class: ${text(record.class, 'unspecified')}; per-contact artifact: applications/${jobId}/contacts/${key}.md`);
  }
  lines.push('');
  const outreach = outreachFor(store, profileId, jobId);
  lines.push('### Unsent outreach drafts', '');
  if (!outreach.plans.length && !outreach.drafts.length) {
    lines.push('- No outreach plan or draft recorded yet.', '');
    return lines;
  }
  for (const plan of outreach.plans) {
    lines.push(`- plan ${plan.id}: goal ${text(plan.goal, 'informational')}; reachable ${plan.reachable === true ? 'yes' : 'no'}; status ${text(plan.status, 'draft_plan')}`);
  }
  for (const draft of outreach.drafts) {
    const delivery = draft.delivered ? `delivered ${draft.deliveredAt || '(timestamp missing)'}` : 'UNSENT (no send capability exists)';
    lines.push(`- draft ${draft.id} (${text(draft.kind, 'initial')}, ${delivery})`);
    lines.push(`  - subject: ${text(draft.subject, '(none)')}`);
    for (const bodyLine of String(draft.body || '').split('\n')) lines.push(`  > ${bodyLine}`);
  }
  lines.push('');
  return lines;
}

function outcomeSection(store, profileId, jobId) {
  const application = applicationFor(store, jobId);
  const lines = ['### Outcome history', ''];
  const history = [];
  if (application) {
    for (const entry of (Array.isArray(application.history) ? application.history : [])) {
      history.push(`- ${timestamp(entry.createdAt)} ${text(entry.status, 'status')}${entry.actor ? ` [${entry.actor}]` : ''}${entry.note ? ` — ${entry.note}` : ''}`);
    }
    if (application.observedStatus) {
      history.push(`- ${timestamp(application.observedAt)} externally observed status "${application.observedStatus}" recorded by ${text(application.observedBy, 'human')} (human observation, not a JobSSS action)${application.observationNote ? ` — ${application.observationNote}` : ''}`);
    }
    for (const entry of (Array.isArray(application.outcomes) ? application.outcomes : [])) {
      history.push(`- ${timestamp(entry.recordedAt || entry.createdAt)} outcome: ${text(entry.outcome || entry.status, 'recorded')}${entry.note ? ` — ${entry.note}` : ''}`);
    }
  }
  if (!history.length) {
    history.push(`- Recorded local status: ${text(application?.status, 'not pursued locally')} (updated ${timestamp(application?.updatedAt)}). No external outcome has been recorded by a human yet.`);
  }
  lines.push(...history);
  lines.push('');
  lines.push('No submission, sending, approval, or application was performed by JobSSS. External outcomes are recorded only by a human.');
  lines.push('');
  return lines;
}

// ---------------------------------------------------------------------------
// Markdown builders
// ---------------------------------------------------------------------------

/** Profile-level projection: identity, preferences, proof inventory, decisions. */
export function profileMarkdown(store, profileId) {
  const profile = (store.profiles || {})[profileId];
  if (!profile) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const preferences = profile.preferences || {};
  const resume = profile.currentResumeId ? (store.resumes || {})[profile.currentResumeId] : null;
  const proofs = Object.values(store.proofPoints || {})
    .filter(proof => proof && proof.profileId === profileId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const lines = [
    `# ${text(profile.name, 'Profile')}`,
    '',
    `- profileId: ${profileId}`,
    `- current resume revision: ${text(profile.currentResumeId, 'none imported')}`,
    `- resume source hash: ${text(resume?.sourceHash, 'not recorded')}`,
    `- resume verification: ${text(resume?.verificationStatus, 'needs_verification')}`,
    `- raw resume text: kept only in the canonical store (PLUGIN_DATA/store.json), never copied into this projection`,
    `- last update: ${timestamp(profile.updatedAt)}`,
    '',
    '## Preferences',
    '',
    `- target role families: ${list(preferences.targetRoleFamilies).join('; ')}`,
    `- locations: ${list(preferences.locations).join('; ')}`,
    `- work model: ${text(preferences.workModel, 'not stated')}`,
    `- salary floor/ceiling: ${preferences.salary?.min == null ? 'not stated' : preferences.salary.min}`
      + ` / ${preferences.salary?.max == null ? 'not stated' : preferences.salary.max} ${text(preferences.salary?.currency, '')}`.trimEnd(),
    `- dealbreakers: ${list(preferences.dealbreakers).join('; ')}`,
    `- excluded role families: ${list(preferences.excludeRoles).join('; ')}`,
    `- skills: ${list(preferences.skills).join('; ')}`,
    '',
    '## Proof inventory (human verification required)',
    '',
    ...(proofs.length ? proofs.map(proofLine) : ['- (no proof candidates imported yet)']),
    '',
    '## Decisions (recorded by a human through the trusted local CLI)',
    '',
    ...list(decisionLines(store, profileId)),
    '',
  ];
  return `${lines.join('\n')}`;
}

/**
 * Profile tracker: one row per explicitly-tracked job with employer, role,
 * status, next action, deadline, links, and last update. A deadline that was
 * never recorded is rendered as "not recorded" instead of being invented.
 */
export function trackerMarkdown(store, profileId) {
  const profile = (store.profiles || {})[profileId];
  if (!profile) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const jobs = explicitJobsFor(store, profileId);
  const lines = [
    `# Application tracker — ${text(profile.name, profileId)}`,
    '',
    `Generated from the canonical store; profileId ${profileId}; last update ${timestamp(profile.updatedAt)}.`,
    'Statuses are local preparation states only. No submission or external action is claimed or possible.',
    '',
    '| Employer | Role | Status | Next action | Deadline | Links | Last update |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  if (!jobs.length) {
    lines.push('| (no tracked jobs yet) | — | — | source jobs, score them, then pursue | not recorded | — | — |');
  }
  for (const job of jobs) {
    const application = applicationFor(store, job.id) || {};
    const status = text(application.status || job.status, 'not pursued');
    const tasks = Object.values(store.tasks || {})
      .filter(task => task && task.profileId === profileId && task.jobId === job.id && task.status === 'open')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const nextAction = tasks.length ? tasks[0].text : 'no open local next action';
    const deadline = text(job.deadline || job.applicationDetail?.deadline || application.deadline, 'not recorded');
    const links = [job.url, job.applicationDetail?.detailUrl]
      .filter(Boolean)
      .map(url => String(url))
      .join(' ');
    lines.push(`| ${text(job.company, 'unknown employer')} | ${text(job.title, 'untitled role')} | ${status} `
      + `| ${String(nextAction).replace(/\|/g, '/')} | ${deadline} | ${links || '—'} | ${timestamp(application.updatedAt || job.updatedAt)} |`);
  }
  lines.push('', `Jobs tracked: ${jobs.length}`, '');
  return lines.join('\n');
}

/** Per-job application packet projection (the frozen G4 output contract). */
export function applicationMarkdown(store, jobId, profileId) {
  const job = (store.jobs || {})[jobId];
  if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: 'unknown_job' });
  if (job.profileId !== profileId) {
    throw Object.assign(new Error(`Job ${jobId} belongs to profile ${job.profileId}, not ${profileId}`), { code: 'profile_mismatch' });
  }
  const application = applicationFor(store, jobId) || {};
  const score = (store.scores || {})[jobId] || null;
  const unanswered = unansweredRequiredFor(store, job);
  const postingHash = job.sourceHash || job.hash || null;
  const lines = [
    `# ${text(job.title, 'Untitled role')} — ${text(job.company, 'unknown employer')}`,
    '',
    'Local preparation packet. JobSSS prepares and records locally; it never submits an application or sends anything.',
    '',
    '## Job and source snapshot',
    '',
    `- jobId: ${jobId}`,
    `- employer: ${text(job.company, 'unknown')}`,
    `- role: ${text(job.title, 'unknown')}`,
    `- location: ${text(job.location, 'not stated')}`,
    `- compensation: ${text(job.compensation, 'not stated')}`,
    `- work model: ${text(job.workModel, 'not stated')}`,
    `- source: ${text(job.source || job.provenance?.source, 'not recorded')}`,
    `- source url: ${text(job.url, 'not recorded')}`,
    `- posting hash: ${text(postingHash, 'not recorded')} (verbatim posting retained in the canonical store)`,
    `- imported: ${timestamp(job.createdAt)}; last update: ${timestamp(job.updatedAt)}`,
    `- local status: ${text(application.status || job.status, 'not pursued')}`
      + `${TERMINAL_LOCAL_STATUSES.has(String(application.status)) ? ' (closed locally; history retained)' : ''}`,
    '',
    '## Fit rationale (deterministic offline score)',
    '',
    ...fitRationaleLines(score),
    '',
    '## Materials (proof-grounded drafts; human review required)',
    '',
  ];
  lines.push(...materialSection(store, profileId, jobId, 'resume_draft', 'Tailored resume'));
  lines.push(...materialSection(store, profileId, jobId, 'cover_letter_draft', 'Cover letter (only when the job justifies one)'));
  lines.push('### Application checklist / review-gap truth', '');
  if (unanswered === null) {
    lines.push('- No linked ask list is available for this job; required questions and documents are unknown, not assumed.', '');
  } else if (!unanswered.length) {
    lines.push('- Every stored required question has a saved answer and every required document has a produced draft.', '');
  } else {
    for (const gap of unanswered) lines.push(`- [ ] ${gap}`);
    lines.push('');
  }
  lines.push(...answersSection(store, profileId, jobId));
  lines.push(...peopleSection(store, profileId, jobId));
  lines.push(...outcomeSection(store, profileId, jobId));
  return lines.join('\n');
}

/** Per-contact artifact: identity, provenance, evidence class, miss reason. */
export function contactMarkdown(store, record) {
  const key = record.contactKey || contactArtifactKey(record.subject || {});
  const contact = record.contactId ? (store.contacts || {})[record.contactId] : null;
  const lines = [
    `# Contact evidence — ${text(record.subject?.name, '(unnamed)')}`,
    '',
    `- contactKey: ${key}`,
    `- profileId: ${text(record.profileId)}`,
    `- jobId: ${text(record.jobId, '(profile-level)')}`,
    `- name: ${text(record.subject?.name, 'unknown')}`,
    `- company: ${text(record.subject?.company, 'unknown')}`,
    `- role: ${text(record.subject?.role, 'not recorded')}`,
    `- evidence class: ${text(record.class, 'unspecified')}`,
    `- status: ${text(record.status, 'unspecified')}`,
    '',
  ];
  if (record.status === 'contact_brief') {
    lines.push(
      `- email: ${text(record.email, 'none')}`,
      `- email status: ${text(record.emailStatus, 'not_checked')} — a provider-reported address is not a verified mailbox`,
      `- provider: ${text(record.provider?.name, 'host-supplied')}`
        + `${record.provider?.runId ? ` (run ${record.provider.runId})` : ''}`,
      '',
    );
  } else {
    lines.push(
      `- miss reason code: ${text(record.missReason?.code, 'unspecified')}`,
      `- miss detail: ${text(record.missReason?.detail, 'none recorded')}`,
      '- a contact miss is non-fatal bounded preparation: it never blocks the application packet and never fabricates an address',
      '',
    );
  }
  lines.push(
    '## Provenance and human authority',
    '',
    `- contact record: ${text(contact?.id, 'none (miss records no contact)')}`,
    `- contact source: ${text(contact?.provenance || contact?.source, 'not recorded')}`,
    `- human approved: ${contact?.humanApproved === true ? `yes (${text(contact.approvedAt)})` : 'no'}`,
    `- human suppressed: ${contact?.doNotUse === true ? `yes (${text(contact.suppressedAt)})` : 'no'}`,
    `- evidence refs: ${list((record.evidence || []).map(item => `${item.kind || 'ref'}:${item.ref || item.value || ''}`)).join('; ')}`,
    `- recorded: ${timestamp(record.createdAt)}; last update: ${timestamp(record.updatedAt)}`,
    '',
    'Nothing here is a verified mailbox, permission, or referral. No message was composed or transmitted by JobSSS.',
    '',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Write descriptors consumed by the store commit transaction
// ---------------------------------------------------------------------------

/**
 * Every deterministic workspace projection write for a committed store:
 *   profiles/<profileId>/profile.md, profiles/<profileId>/tracker.md,
 *   applications/<jobId>/application.md,
 *   applications/<jobId>/resume.md and cover-letter.md when the draft exists,
 *   applications/<jobId>/contacts/<contactKey>.md per recorded contact/miss.
 *
 * Pure: returns descriptors, never touches disk. The caller (store.js) stages
 * them inside the same locked transaction as the canonical store, so a restart
 * always regenerates the identical files and no logical job or contact gains a
 * second directory.
 */
export function workspaceProjectionWrites(store) {
  const writes = [];
  const profiles = store.profiles || {};
  for (const profileId of sortedIds(profiles)) {
    const safeProfile = requireSegment(profileId, 'profile');
    writes.push({ segments: ['profiles', safeProfile, 'profile.md'], content: profileMarkdown(store, profileId) });
    writes.push({ segments: ['profiles', safeProfile, 'tracker.md'], content: trackerMarkdown(store, profileId) });
    for (const job of packetJobsFor(store, profileId)) {
      const safeJob = requireSegment(job.id, 'job');
      writes.push({ segments: ['applications', safeJob, 'application.md'], content: applicationMarkdown(store, job.id, profileId) });
      const resumeArtifacts = artifactsFor(store, profileId, job.id, 'resume_draft');
      const coverArtifacts = artifactsFor(store, profileId, job.id, 'cover_letter_draft');
      const latest = items => (items.length ? items[items.length - 1] : null);
      const resume = latest(resumeArtifacts);
      if (resume && typeof resume.content === 'string' && resume.content) {
        writes.push({ segments: ['applications', safeJob, 'resume.md'], content: resume.content });
      }
      const cover = latest(coverArtifacts);
      if (cover && typeof cover.content === 'string' && cover.content) {
        writes.push({ segments: ['applications', safeJob, 'cover-letter.md'], content: cover.content });
      }
      for (const record of discoveriesFor(store, profileId, job.id)) {
        const key = requireSegment(record.contactKey || contactArtifactKey(record.subject || {}), 'contact');
        writes.push({ segments: ['applications', safeJob, 'contacts', `${key}.md`], content: contactMarkdown(store, record) });
      }
    }
  }
  return writes;
}
