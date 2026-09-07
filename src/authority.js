// Trusted local human-decision authority for the standalone JobSSS runtime.
//
// Contract (BENCHMARK.md B36-B40):
//   - `./bin/jobsss decide --data <dir> --list` prints pending human decisions.
//   - A human completes a decision only through the trusted local CLI with the
//     exact entity id, integer revision, and lowercase SHA-256 content hash.
//   - A mismatched revision or content hash is a typed stale conflict
//     (stale_revision / content_hash_mismatch) and persists nothing.
//   - MCP can list and create non-authoritative handoffs only; it can never
//     complete or forge a human decision through tool names, arguments, labels,
//     or environment variables.
//   - Every trusted decision is committed atomically under PLUGIN_DATA with an
//     audit entry recording the entity id, action, and trusted-local human
//     actor. JobSSS never claims that it sent, submitted, applied, approved,
//     or interviewed on the human's behalf.
//
// Revision model: each pending entity carries its own integer revision in a
// per-entity decision ledger (`store.decisions[<entityId>].revision`), so
// completing one decision never invalidates the other pending decisions that
// were listed at the same time. The content hash is recomputed from the
// entity's stable canonical content on every list and every decide, so any
// change to the entity (or an already-completed decision) makes a previously
// listed hash or revision stale.

import { loadStore, commitStore, hashText, id, now, ensureDataDir, redactSecrets, evidenceFreshnessForStore } from './store.js';

export const TRUSTED_DECISION_ACTIONS = Object.freeze([
  'proof.verify',
  'artifact.approve',
  'artifact.reject',
  'contact.approve',
  'contact.suppress',
  'story.verify',
  'story.retire',
  'debrief.record',
  'debrief.correct',
  'outreach.sent',
  'outreach.outcome',
  'application.observe_status',
]);

const ACTIONS_BY_TYPE = Object.freeze({
  proof: ['proof.verify'],
  artifact: ['artifact.approve', 'artifact.reject'],
  contact: ['contact.approve', 'contact.suppress'],
  story: ['story.verify', 'story.retire'],
  debrief: ['debrief.record', 'debrief.correct'],
  outreach: ['outreach.sent', 'outreach.outcome'],
  application: ['application.observe_status'],
});

const HASH_RE = /^[a-f0-9]{64}$/;

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireProfile(store, profileId) {
  const value = String(profileId || '').trim();
  if (!value) throw typedError('missing_profile', 'profileId is required');
  const profile = store.profiles?.[value];
  if (!profile) throw typedError('unknown_profile', `Unknown profile: ${value}`);
  return profile;
}

function locateEntity(store, entityId) {
  const idValue = String(entityId || '');
  if (!idValue) return null;
  if (store.proofPoints?.[idValue]) return { entity: store.proofPoints[idValue], type: 'proof' };
  if (store.artifacts?.[idValue]) return { entity: store.artifacts[idValue], type: 'artifact' };
  if (store.contacts?.[idValue]) return { entity: store.contacts[idValue], type: 'contact' };
  if (store.interviewStories?.[idValue]) return { entity: store.interviewStories[idValue], type: 'story' };
  if (store.interviewPrep?.[idValue]) return { entity: store.interviewPrep[idValue], type: 'debrief' };
  if (store.outreachDrafts?.[idValue]) return { entity: store.outreachDrafts[idValue], type: 'outreach' };
  if (store.applications?.[idValue]) return { entity: store.applications[idValue], type: 'application' };
  return null;
}

/**
 * Stable canonical content for a decision entity. Only immutable identifying
 * and authored content is included, never mutable decision state (verification
 * flags, approval/rejection, delivered/outcome fields, observation records), so
 * a follow-on decision on the same entity (debrief record -> correct, outreach
 * sent -> outcome) keeps the same content hash.
 */
function canonicalPayload(entity, type) {
  switch (type) {
    case 'proof':
      return { id: entity.id, profileId: entity.profileId, summary: entity.summary, skills: entity.skills, metrics: entity.metrics, source: entity.source };
    case 'artifact':
      return {
        id: entity.id, profileId: entity.profileId, jobId: entity.jobId, kind: entity.kind,
        title: entity.title, content: entity.content || null, proofPointIds: entity.proofPointIds || [],
        checklist: entity.checklist || [],
      };
    case 'contact':
      return { id: entity.id, profileId: entity.profileId, name: entity.name, role: entity.role, company: entity.company, email: entity.email, source: entity.source };
    case 'story':
      return {
        id: entity.id, profileId: entity.profileId, title: entity.title, situation: entity.situation,
        task: entity.task, action: entity.action, result: entity.result, reflection: entity.reflection,
        proofPointIds: entity.proofPointIds || [],
      };
    case 'debrief':
      return { id: entity.id, profileId: entity.profileId, jobId: entity.jobId || null, applicationId: entity.applicationId || null };
    case 'outreach':
      return {
        id: entity.id, profileId: entity.profileId, jobId: entity.jobId, contactId: entity.contactId || null,
        kind: entity.kind, goal: entity.goal, subject: entity.subject, body: entity.body,
      };
    case 'application':
      return { id: entity.id, jobId: entity.jobId, profileId: entity.profileId, status: entity.status };
    default:
      return { id: entity.id, profileId: entity.profileId };
  }
}

function canonicalHash(entity, type) {
  return hashText(JSON.stringify(canonicalPayload(entity, type)));
}

function pendingKindFor(entity, type) {
  switch (type) {
    case 'proof': return entity.verifiedAt ? null : 'proof.verify';
    case 'artifact': return entity.approvedAt || entity.rejectedAt ? null : 'artifact.approve';
    case 'contact': return entity.humanApproved || entity.doNotUse ? null : 'contact.approve';
    case 'story': return entity.state === 'verified' || entity.state === 'retired' ? null : 'story.verify';
    case 'debrief': return entity.debriefRecordedAt ? 'debrief.correct' : 'debrief.record';
    case 'outreach':
      if (!entity.delivered) return 'outreach.sent';
      return entity.outcomeRecordedAt || entity.outcome ? null : 'outreach.outcome';
    case 'application': return entity.observedStatus ? null : 'application.observe_status';
    default: return null;
  }
}

function itemTitle(entity, type) {
  switch (type) {
    case 'proof': return 'Proof candidate';
    case 'artifact': return entity.title || 'Draft artifact';
    case 'contact': return entity.name || 'Contact';
    case 'story': return entity.title || 'Interview story';
    case 'debrief': return 'Interview debrief';
    case 'outreach': return 'Outreach draft';
    case 'application': return 'Application status observation';
    default: return 'Decision';
  }
}

function ensureLedger(store) {
  if (!store.decisions || typeof store.decisions !== 'object' || Array.isArray(store.decisions)) {
    store.decisions = {};
  }
  return store.decisions;
}

/** Derive the pending decision items from the current store (no writes). */
export function pendingDecisionItems(store, { profileId } = {}) {
  const ledger = store.decisions && typeof store.decisions === 'object' && !Array.isArray(store.decisions) ? store.decisions : {};
  const items = [];
  const push = (entity, type) => {
    if (!entity || (profileId && entity.profileId !== profileId)) return;
    // Retired/skipped/archived artifacts remain in history but are absent
    // from current approval queues.
    if (type === 'artifact' && (entity.retiredAt || String(entity.status || '').startsWith('retired_'))) return;
    const kind = pendingKindFor(entity, type);
    if (!kind) return;
    const revision = Number.isInteger(ledger[entity.id]?.revision) && ledger[entity.id].revision >= 1 ? ledger[entity.id].revision : 1;
    const item = {
      id: entity.id,
      entityId: entity.id,
      kind,
      action: kind,
      type,
      entityType: type,
      revision,
      contentHash: canonicalHash(entity, type),
      profileId: entity.profileId || null,
      title: itemTitle(entity, type),
      allowedActions: ACTIONS_BY_TYPE[type],
      note: `Pending ${kind}; completion requires the trusted local CLI ./bin/jobsss decide with this exact id, revision, and content hash.`,
    };
    if (type === 'artifact' || type === 'story' || type === 'debrief') {
      item.freshness = evidenceFreshnessForStore(store, entity);
    }
    if (type === 'application') item.applicationId = entity.id;
    if (type === 'artifact') item.artifactId = entity.id;
    if (type === 'contact') item.contactId = entity.id;
    if (type === 'story') item.storyId = entity.id;
    if (type === 'outreach') item.outreachId = entity.id;
    if (type === 'proof') item.proofPointId = entity.id;
    items.push(item);
  };
  for (const entity of Object.values(store.proofPoints || {})) push(entity, 'proof');
  for (const entity of Object.values(store.artifacts || {})) push(entity, 'artifact');
  for (const entity of Object.values(store.contacts || {})) push(entity, 'contact');
  for (const entity of Object.values(store.interviewStories || {})) push(entity, 'story');
  for (const entity of Object.values(store.interviewPrep || {})) push(entity, 'debrief');
  for (const entity of Object.values(store.outreachDrafts || {})) push(entity, 'outreach');
  for (const entity of Object.values(store.applications || {})) push(entity, 'application');
  return items;
}

/** Read-only pending list for the trusted CLI (`decide --list`). */
export function listPendingDecisions(dataDir, { profileId } = {}) {
  ensureDataDir(dataDir);
  const store = loadStore(dataDir);
  const items = pendingDecisionItems(store, { profileId });
  return {
    ok: true,
    pending: items,
    items,
    decisions: items,
    count: items.length,
    message: 'Pending human decisions. A human completes each one with the trusted local CLI: ./bin/jobsss decide --data <dir> --action <action> --id <id> --revision <n> --content-hash <sha256>. MCP cannot complete these.',
  };
}

function applyDecisionEffect(entity, type, action, args, at) {
  switch (action) {
    case 'proof.verify':
      entity.verification = 'human_verified';
      entity.status = 'verified';
      entity.verifiedAt = at;
      entity.verifiedBy = 'trusted_local';
      break;
    case 'artifact.approve':
      entity.status = 'approved';
      entity.approvedAt = at;
      entity.approvedBy = 'trusted_local';
      break;
    case 'artifact.reject':
      entity.status = 'rejected';
      entity.rejectedAt = at;
      entity.rejectedBy = 'trusted_local';
      break;
    case 'contact.approve':
      entity.humanApproved = true;
      entity.approvedAt = at;
      entity.approvedBy = 'trusted_local';
      break;
    case 'contact.suppress':
      entity.doNotUse = true;
      entity.suppressedAt = at;
      entity.suppressedBy = 'trusted_local';
      break;
    case 'story.verify':
      entity.state = 'verified';
      entity.verifiedAt = at;
      entity.verifiedBy = 'trusted_local';
      break;
    case 'story.retire':
      entity.state = 'retired';
      entity.retiredAt = at;
      entity.retiredBy = 'trusted_local';
      break;
    case 'debrief.record':
      entity.debriefRecordedAt = at;
      entity.debriefRecordedBy = 'trusted_local';
      if (args.note) entity.debriefNote = String(args.note);
      break;
    case 'debrief.correct':
      entity.debriefCorrectedAt = at;
      entity.debriefCorrectedBy = 'trusted_local';
      if (args.note) entity.debriefCorrectionNote = String(args.note);
      break;
    case 'outreach.sent':
      entity.delivered = true;
      entity.deliveredAt = at;
      entity.deliveredBy = 'trusted_local';
      if (args.note) entity.deliveryNote = String(args.note);
      break;
    case 'outreach.outcome': {
      const outcome = String(args.outcome || '').trim();
      if (!outcome) throw typedError('missing_outreach_outcome', 'outreach.outcome requires --outcome');
      entity.outcome = outcome;
      entity.outcomeRecordedAt = at;
      entity.outcomeRecordedBy = 'trusted_local';
      break;
    }
    case 'application.observe_status': {
      const status = String(args.status || '').trim();
      if (!status) throw typedError('missing_observation_status', 'application.observe_status requires --status');
      entity.observedStatus = status;
      entity.observedAt = at;
      entity.observedBy = 'trusted_local';
      if (args.note) entity.observationNote = String(args.note);
      break;
    }
    default:
      throw typedError('unknown_decision_action', `Unknown trusted decision action: ${action}`);
  }
}

function decisionMessage(action) {
  switch (action) {
    case 'proof.verify': return 'Proof verified through the trusted local CLI by a human. No external action was performed.';
    case 'artifact.approve': return 'Artifact approved through the trusted local CLI by a human for local use. No external action was performed.';
    case 'artifact.reject': return 'Artifact rejected through the trusted local CLI by a human. No external action was performed.';
    case 'contact.approve': return 'Contact approved for local use through the trusted local CLI by a human. Nothing was transmitted.';
    case 'contact.suppress': return 'Contact suppressed through the trusted local CLI by a human. Nothing was transmitted.';
    case 'story.verify': return 'Interview story verified through the trusted local CLI by a human. No interview was scheduled or performed.';
    case 'story.retire': return 'Interview story retired through the trusted local CLI by a human.';
    case 'debrief.record': return 'Debrief recorded through the trusted local CLI by a human. The plugin did not attend or attest the interview.';
    case 'debrief.correct': return 'Debrief corrected through the trusted local CLI by a human.';
    case 'outreach.sent': return 'Human confirmed the outreach send through the trusted local CLI; JobSSS performed no external action.';
    case 'outreach.outcome': return 'Outreach outcome recorded through the trusted local CLI by a human.';
    case 'application.observe_status': return 'Externally observed application status recorded through the trusted local CLI by a human. The plugin did not apply or submit anything.';
    default: return 'Trusted local decision recorded. No external action was performed.';
  }
}

/**
 * Validate the binding against a snapshot before committing (typed stale
 * pre-checks must persist nothing), then complete the decision inside the
 * serialized, atomic store commit with a fresh locked re-validation.
 */
export function applyHumanDecision(dataDir, args = {}) {
  const action = String(args.action || '').trim();
  const entityId = String(args.id || args.entityId || '').trim();
  const rawRevision = args.revision == null || args.revision === '' ? null : Number(args.revision);
  const contentHash = String(args.contentHash || '').trim().toLowerCase();

  if (!action || !entityId || rawRevision == null || !contentHash) {
    throw typedError('missing_binding', 'decide requires --action, --id, --revision, and --content-hash');
  }
  if (!TRUSTED_DECISION_ACTIONS.includes(action)) {
    throw typedError('unknown_decision_action', `Unknown trusted decision action: ${action}`);
  }
  if (!Number.isInteger(rawRevision) || rawRevision < 1) {
    throw typedError('invalid_revision', `--revision must be a positive integer (got ${args.revision})`);
  }
  if (!HASH_RE.test(contentHash)) {
    throw typedError('invalid_content_hash', '--content-hash must be lowercase SHA-256 hex');
  }

  ensureDataDir(dataDir);
  const snapshot = loadStore(dataDir);
  const found = locateEntity(snapshot, entityId);
  if (!found) throw typedError('unknown_decision_entity', `Unknown decision entity: ${entityId}`);
  if (!ACTIONS_BY_TYPE[found.type].includes(action)) {
    throw typedError('decision_action_incompatible', `Action ${action} does not apply to a ${found.type} entity`);
  }
  // Typed stale pre-checks against the current on-disk state; nothing persists.
  validateBinding(snapshot, found.entity, found.type, action, entityId, rawRevision, contentHash);

  let outcome;
  commitStore(dataDir, {}, locked => {
    const lockedFound = locateEntity(locked, entityId);
    if (!lockedFound) throw typedError('unknown_decision_entity', `Unknown decision entity: ${entityId}`);
    if (!ACTIONS_BY_TYPE[lockedFound.type].includes(action)) {
      throw typedError('decision_action_incompatible', `Action ${action} does not apply to a ${lockedFound.type} entity`);
    }
    // Re-validate under the exclusive lock so a concurrent trusted decision on
    // the same entity is rejected as stale instead of being overwritten.
    validateBinding(locked, lockedFound.entity, lockedFound.type, action, entityId, rawRevision, contentHash);
    const at = now();
    const ledger = ensureLedger(locked);
    const prior = ledger[entityId] || null;
    const nextRevision = (prior && Number.isInteger(prior.revision) && prior.revision >= 1 ? prior.revision : 1) + 1;
    applyDecisionEffect(lockedFound.entity, lockedFound.type, action, args, at);
    ledger[entityId] = {
      id: entityId,
      entityType: lockedFound.type,
      profileId: lockedFound.entity.profileId || null,
      revision: nextRevision,
      contentHash: canonicalHash(lockedFound.entity, lockedFound.type),
      kind: pendingKindFor(lockedFound.entity, lockedFound.type),
      createdAt: prior?.createdAt || at,
      updatedAt: at,
      history: [...(prior?.history || []), { action, revision: nextRevision, actor: 'trusted_local', createdAt: at, note: args.note ? String(args.note) : null }],
    };
    locked.audit = Array.isArray(locked.audit) ? locked.audit : [];
    locked.audit.push({
      event: 'human_decision',
      action,
      entityId,
      entityType: lockedFound.type,
      revision: nextRevision,
      actor: 'trusted_local',
      createdAt: at,
      note: args.note ? String(args.note) : null,
    });
    outcome = {
      ok: true,
      action,
      entityId,
      entityType: lockedFound.type,
      revision: nextRevision,
      actor: 'trusted_local',
      contentHash: ledger[entityId].contentHash,
      decision: {
        action,
        entityId,
        entityType: lockedFound.type,
        revision: nextRevision,
        actor: 'trusted_local',
        note: args.note ? String(args.note) : null,
      },
      entity: lockedFound.entity,
      message: decisionMessage(action),
    };
    return locked;
  });
  return outcome;
}

function validateBinding(store, entity, type, action, entityId, revision, contentHash) {
  const currentHash = canonicalHash(entity, type);
  if (contentHash !== currentHash) {
    throw typedError(
      'content_hash_mismatch',
      `stale_conflict: content hash for ${entityId} does not match the current entity content`
    );
  }
  const ledger = store.decisions && typeof store.decisions === 'object' && !Array.isArray(store.decisions) ? store.decisions : {};
  const currentRevision = Number.isInteger(ledger[entityId]?.revision) && ledger[entityId].revision >= 1 ? ledger[entityId].revision : 1;
  if (revision !== currentRevision) {
    throw typedError(
      'stale_revision',
      `stale_conflict: revision ${revision} does not match current revision ${currentRevision} for ${entityId}`
    );
  }
  return { currentHash, currentRevision };
}

/**
 * MCP handoff surface: list the profile's pending decisions as
 * non-authoritative handoffs. Completing any of them requires the trusted
 * local CLI and is never possible through MCP.
 */
export function listDecisionHandoffs(dataDir, args = {}) {
  ensureDataDir(dataDir);
  const store = loadStore(dataDir);
  const profileId = String(args.profileId || '').trim();
  if (profileId) requireProfile(store, profileId);
  const items = pendingDecisionItems(store, { profileId: profileId || null });
  const history = Object.values(store.decisionHandoffs || {})
    .filter(handoff => !profileId || handoff.profileId === profileId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    ok: true,
    profileId: profileId || null,
    handoffs: items,
    items,
    pending: items,
    history,
    count: items.length,
    message: 'Non-authoritative decision handoffs. Humans complete decisions with the trusted local CLI ./bin/jobsss decide; MCP cannot complete or forge them.',
  };
}

/**
 * MCP handoff surface: create a non-authoritative local handoff marker for
 * human review. Grants no authority, performs no action, and ignores any
 * approval/authority arguments or environment variables.
 */
export function createDecisionHandoff(dataDir, args = {}) {
  ensureDataDir(dataDir);
  const profileId = String(args.profileId || '').trim();
  if (!profileId) throw typedError('missing_profile', 'create_decision_handoff requires profileId');
  // expectedRevision participates in the canonical atomic write contract:
  // a stale revision rejects before any persistent change.
  const expectedRevision = args.expectedRevision == null || args.expectedRevision === ''
    ? null
    : Number(args.expectedRevision);
  if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw typedError('invalid_revision', `--expectedRevision must be an integer (got ${args.expectedRevision})`);
  }
  const note = args.note == null ? null : String(args.note);
  let outcome;
  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const kindRaw = String(args.kind || 'decision_handoff').trim().toLowerCase();
    const kind = /^[a-z0-9._-]{1,64}$/.test(kindRaw) ? kindRaw : 'decision_handoff';
    if (!store.decisionHandoffs || typeof store.decisionHandoffs !== 'object' || Array.isArray(store.decisionHandoffs)) {
      store.decisionHandoffs = {};
    }
    const at = now();
    const handoffId = id('handoff', `${profileId}:${kind}:${at}`);
    const record = { id: handoffId, profileId, kind, note, createdAt: at, actor: 'agent_requested_human_review' };
    store.decisionHandoffs[handoffId] = record;
    store.audit = Array.isArray(store.audit) ? store.audit : [];
    store.audit.push({ event: 'decision_handoff_created', handoffId, profileId, kind, note, createdAt: at });
    outcome = {
      ok: true,
      handoffId,
      id: handoffId,
      created: true,
      kind,
      note,
      handoff: record,
      message: 'Handoff created for human review. No authority was granted; a human must complete it with the trusted local CLI ./bin/jobsss decide using the exact entity id, revision, and content hash.',
    };
    return store;
  });
  return outcome;
}

// --- Trusted CLI dispatch (`./bin/jobsss decide`) -----------------------------

function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1] != null) return argv[idx + 1];
  const eq = argv.find(arg => arg.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : null;
}

export function decidePrintHelp() {
  console.log(`jobsss decide — trusted local human-decision surface

Usage:
  jobsss decide --data <dir> --list
      List pending human decisions with exact id, revision, and content hash.

  jobsss decide --data <dir> --action <action> --id <id> --revision <n> --content-hash <sha256> [--note <text>] [--outcome <value>] [--status <value>]
      Complete one human decision. Bindings must match exactly; stale
      revisions or content hashes fail with a typed stale conflict and
      persist nothing.

Actions:
  proof.verify  artifact.approve  artifact.reject  contact.approve  contact.suppress
  story.verify  story.retire  debrief.record  debrief.correct
  outreach.sent  outreach.outcome  application.observe_status

This surface records human observation and decision only. JobSSS never sends,
submits, applies, approves externally, or performs an interview.`);
}

export function decideCommand(argv = []) {
  const dataDir = flagValue(argv, '--data') || process.env.PLUGIN_DATA;
  const print = value => {
    // The trusted-local surface gets the same secret redaction as every durable
    // write and MCP payload: env secrets and sk- tokens must never leak through
    // decide stdout (entity content and echoed notes are included in the JSON).
    console.log(redactSecrets(JSON.stringify(value, null, 2)));
  };
  const fail = (code, message) => {
    print({ ok: false, error: { code, message } });
    process.exit(1);
  };
  if (!dataDir) {
    fail('missing_data', 'decide requires --data <dir> (or PLUGIN_DATA)');
    return;
  }
  try {
    const wantsList = argv.includes('--list') || (!argv.includes('--action') && !argv.includes('--id'));
    if (wantsList) {
      print(listPendingDecisions(dataDir));
      process.exit(0);
      return;
    }
    const result = applyHumanDecision(dataDir, {
      action: flagValue(argv, '--action'),
      id: flagValue(argv, '--id'),
      revision: flagValue(argv, '--revision'),
      contentHash: flagValue(argv, '--content-hash'),
      note: flagValue(argv, '--note'),
      outcome: flagValue(argv, '--outcome'),
      status: flagValue(argv, '--status'),
    });
    print(result);
    process.exit(0);
  } catch (cause) {
    fail(cause?.code || 'decision_error', cause?.message || String(cause));
  }
}