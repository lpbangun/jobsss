// P3 portable contracts — pure validators and canonicalization.
//
// Isolated proposal layer only: no MCP wiring, no store reads/writes, no
// network, no subprocesses. The live surfaces stay authoritative:
//   - MCP tool surface: src/mcp.js (unchanged)
//   - trusted local decisions: src/authority.js via `./bin/jobsss decide`
//   - intake dedup/validation: src/domain.js + src/discovery.js
// Validators here mirror those rules for OFFLINE PORTABLE ARTIFACTS
// (packet / outcome / bulk file-drop) so a future consumer can check shape
// before ever touching the live runtime. Validators here never grant
// authority and never attest remote action.
//
// Conventions shared by all three contracts:
//   - error entries: { code, message, ...context } with stable codes
//   - content hashes: lowercase SHA-256 hex, mirroring authority.js
//     (normalize with toLowerCase, then require /^[a-f0-9]{64}$/)
//   - portable paths: posix-style relative, no leading `/`, no drive
//     letters, no backslashes, no `..` segments
//   - remote attestation is always rejected: this plugin never claims it
//     sent, submitted, applied, approved, or interviewed on anyone's behalf

import { createHash } from 'node:crypto';

export const PACKET_FORMAT = 'jobsss.packet/v1';

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

export const PACKET_COMPONENTS = Object.freeze(['resumePdf', 'coverLetter', 'answers', 'checklist']);

// Boring explicit bulk limits (also documented in contracts/README.md).
export const MAX_BULK_RECORDS = 100;
export const MAX_BULK_BYTES = 1024 * 1024; // 1 MiB per drop
export const MAX_RECORD_TEXT_CHARS = 100_000;

const HASH_RE = /^[a-f0-9]{64}$/;

// Top-level boolean/claim fields that would attest a remote action as
// plugin-performed. `outreach.sent` / `application.observe_status` remain
// legitimate TRUSTED_DECISION_ACTIONS recorded by a human through the
// trusted CLI; a portable artifact may never carry them as its own claims.
const ATTESTATION_FIELDS = Object.freeze([
  'sent',
  'submitted',
  'applied',
  'sentAt',
  'submittedAt',
  'appliedAt',
]);

const ATTESTATION_VALUES = Object.freeze(['sent', 'submitted', 'applied']);

const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|bearer|credential|private[_-]?key|client[_-]?secret)/i;
const SECRET_VALUE_RE = /(sk-live-|sk-test-|ghp_|gho_|xox[bpas]-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const err = (code, message, extra = {}) => ({ code, message, ...extra });
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

export function sha256Hex(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// Stable canonical serialization: recursively sorted keys, compact JSON.
// Used as the documented hash input for packets.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Portable relative path: posix-style, no leading `/`, no drive prefix,
// no backslashes, no `..` segments, no empty segments.
export function isPortableRelPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 512) return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  return true;
}

// Canonical packet content for hashing: identity plus stable authored
// content. Excludes the hash itself, the readiness flag (a local
// presentation marker, not authored content), and anything outside the
// portable format (timestamps, absolute paths, secrets must never be here).
export function canonicalPacket(packet) {
  return {
    format: packet.format,
    jobId: packet.jobId,
    revision: packet.revision,
    components: packet.components,
    asks: packet.asks ?? [],
    answers: packet.answers ?? [],
    checklist: packet.checklist ?? [],
  };
}

export function computePacketHash(packet) {
  return sha256Hex(stableStringify(canonicalPacket(packet)));
}

function checkAttestationFields(obj, errors) {
  for (const field of ATTESTATION_FIELDS) {
    if (obj[field] !== undefined && obj[field] !== null && obj[field] !== false) {
      errors.push(err('remote_attestation', `field '${field}' attests remote action; portable artifacts never claim send/submit/apply`, { field }));
    }
  }
}

function normalizeHash(raw) {
  return typeof raw === 'string' ? raw.toLowerCase() : raw;
}

export function validatePacket(packet) {
  const errors = [];
  if (!isRecord(packet)) return { ok: false, errors: [err('invalid_packet', 'packet must be an object')], completeness: 'incomplete', missing: [] };

  if (packet.format !== PACKET_FORMAT) {
    errors.push(err('invalid_format', `format must be '${PACKET_FORMAT}'`));
  }
  if (!isNonEmptyString(packet.jobId)) {
    errors.push(err('missing_identity', 'jobId must be a non-empty string'));
  }
  if (!isPositiveInt(packet.revision)) {
    errors.push(err('invalid_revision', 'revision must be a positive integer (packet/job revision for the portable format, not MCP authority)'));
  }
  if (packet.contentHash === undefined || packet.contentHash === null || packet.contentHash === '') {
    errors.push(err('missing_binding', 'contentHash is required'));
  } else if (typeof packet.contentHash !== 'string' || !HASH_RE.test(normalizeHash(packet.contentHash))) {
    errors.push(err('invalid_content_hash', 'contentHash must be lowercase SHA-256 hex'));
  } else if (isNonEmptyString(packet.jobId) && isPositiveInt(packet.revision) && packet.format === PACKET_FORMAT) {
    const expected = computePacketHash(packet);
    if (normalizeHash(packet.contentHash) !== expected) {
      errors.push(err('content_hash_mismatch', 'contentHash does not match the canonical packet serialization', { expected }));
    }
    if (packet.contentHash !== normalizeHash(packet.contentHash)) {
      errors.push(err('content_hash_not_canonical', 'contentHash must already be lowercase'));
    }
  }

  checkAttestationFields(packet, errors);

  if (packet.readiness !== 'ready' && packet.readiness !== 'incomplete') {
    errors.push(err('invalid_readiness', "readiness must be 'ready' or 'incomplete'"));
  }

  const missing = [];
  if (!isRecord(packet.components)) {
    errors.push(err('missing_components', 'components must be an object'));
  } else {
    for (const name of PACKET_COMPONENTS) {
      const v = packet.components[name];
      if (v === null || v === undefined) {
        missing.push(`components.${name}`);
      } else if (!isPortableRelPath(v)) {
        errors.push(err('unsafe_path', `components.${name} must be a portable relative path`, { field: `components.${name}` }));
      }
    }
  }

  const asks = Array.isArray(packet.asks) ? packet.asks : null;
  const answers = Array.isArray(packet.answers) ? packet.answers : null;
  if (asks === null) errors.push(err('missing_asks', 'asks must be an array (possibly empty)'));
  if (answers === null) errors.push(err('missing_answers', 'answers must be an array (possibly empty)'));
  const askIds = new Set();
  if (asks !== null) {
    for (const [i, ask] of asks.entries()) {
      if (!isRecord(ask) || !isNonEmptyString(ask.id)) {
        errors.push(err('invalid_ask', `asks[${i}].id must be a non-empty string`, { index: i }));
      } else {
        askIds.add(ask.id);
      }
    }
  }
  const answeredIds = new Set();
  if (answers !== null) {
    for (const [i, a] of answers.entries()) {
      if (!isRecord(a) || !isNonEmptyString(a.askId)) {
        errors.push(err('invalid_answer', `answers[${i}].askId must be a non-empty string`, { index: i }));
        continue;
      }
      if (!askIds.has(a.askId)) {
        errors.push(err('unlinked_answer', `answers[${i}].askId has no matching ask id; missing questions stay missing, never fabricated`, { index: i, askId: a.askId }));
      } else {
        answeredIds.add(a.askId);
      }
    }
  }
  if (asks !== null) {
    for (const ask of asks) {
      if (isRecord(ask) && isNonEmptyString(ask.id) && !answeredIds.has(ask.id)) missing.push(ask.id);
    }
  }

  if (packet.checklist !== undefined && packet.checklist !== null) {
    if (!Array.isArray(packet.checklist)) {
      errors.push(err('invalid_checklist', 'checklist must be an array'));
    } else {
      for (const [i, item] of packet.checklist.entries()) {
        if (!isRecord(item) || !isNonEmptyString(item.label)) {
          errors.push(err('invalid_checklist', `checklist[${i}].label must be a non-empty string`, { index: i }));
        }
      }
    }
  }

  if (errors.length === 0 && packet.readiness === 'ready' && missing.length > 0) {
    errors.push(err('fabricated_readiness', 'readiness is ready but coverage is missing; incomplete packets must stay incomplete', { missing }));
  }

  const completeness = missing.length === 0 ? 'complete' : 'incomplete';
  return { ok: errors.length === 0, errors, completeness, missing };
}

export function validateOutcome(outcome) {
  const errors = [];
  if (!isRecord(outcome)) return { ok: false, errors: [err('missing_binding', 'outcome must be an object')], normalized: null };

  if (outcome.action === undefined || outcome.action === null || outcome.action === '') {
    errors.push(err('missing_binding', 'action is required'));
  } else if (!TRUSTED_DECISION_ACTIONS.includes(outcome.action)) {
    errors.push(err('unknown_decision_action', `action must be one of the trusted CLI actions`, { action: outcome.action }));
  }
  if (!isNonEmptyString(outcome.id)) {
    errors.push(err('missing_binding', 'id is required'));
  }
  if (!isPositiveInt(outcome.revision)) {
    errors.push(err('missing_binding', 'revision must be a positive integer'));
  }
  let normalizedHash = null;
  if (outcome.contentHash === undefined || outcome.contentHash === null || outcome.contentHash === '') {
    errors.push(err('missing_binding', 'contentHash is required'));
  } else if (typeof outcome.contentHash !== 'string' || !HASH_RE.test(normalizeHash(outcome.contentHash))) {
    errors.push(err('invalid_content_hash', 'contentHash must be SHA-256 hex (lowercased before checking, mirroring authority.js)'));
  } else {
    normalizedHash = normalizeHash(outcome.contentHash);
  }

  // Only the trusted local actor can ever complete a decision. Anything
  // else — including anything shaped like an MCP tool call — is rejected.
  // These validators do not grant authority; live decide stays in
  // src/authority.js.
  if (outcome.actor === undefined || outcome.actor === null || outcome.actor === '') {
    errors.push(err('missing_binding', 'actor is required'));
  } else if (outcome.actor !== 'trusted_local') {
    errors.push(err('untrusted_actor', "actor must be 'trusted_local'", { actor: outcome.actor }));
  }
  if (outcome.tool !== undefined || outcome.expectedRevision !== undefined) {
    errors.push(err('missing_binding', 'MCP-shaped payloads (tool/expectedRevision) are not portable outcomes'));
  }

  checkAttestationFields(outcome, errors);
  for (const field of ['outcome', 'status']) {
    const v = outcome[field];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      errors.push(err('invalid_outcome_field', `${field} must be a string when present`, { field }));
    } else if (typeof v === 'string' && ATTESTATION_VALUES.includes(v.trim().toLowerCase())) {
      errors.push(err('remote_attestation', `${field} must not claim remote action as plugin-performed`, { field }));
    }
  }
  if (outcome.note !== undefined && outcome.note !== null && typeof outcome.note !== 'string') {
    errors.push(err('invalid_outcome_field', 'note must be a string when present', { field: 'note' }));
  }

  const normalized = errors.length === 0
    ? { action: outcome.action, id: outcome.id, revision: outcome.revision, contentHash: normalizedHash, actor: 'trusted_local' }
    : null;
  return { ok: errors.length === 0, errors, normalized };
}

// Public http/https only, mirroring assertPublicJobUrl rules: reject
// file:/other protocols, embedded credentials, and non-public hosts.
export function validatePublicUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return err('unsafe_url_protocol', 'url must be a non-empty string');
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return err('unsafe_url_protocol', 'url is not parseable as http/https', { url: raw });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return err('unsafe_url_protocol', 'only public http/https urls are accepted', { url: raw });
  }
  if (u.username !== '' || u.password !== '') {
    return err('credentialed_url', 'urls with credentials are rejected', { url: raw });
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const privateIPv4 = /^(127\.|10\.|192\.168\.|0\.0\.0\.0$)/.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const nonPublicName = host === 'localhost'
    || host === '::1'
    || host === '[::1]'
    || host.endsWith('.local')
    || host.endsWith('.localhost')
    || host.endsWith('.internal')
    || host.endsWith('.invalid')
    || host.endsWith('.test')
    || (!host.includes('.') && !isIPv4);
  if (isIPv4 ? privateIPv4 : nonPublicName || host === '::1' || host === '[::1]') {
    return err('non_public_host', 'url host is not public', { url: raw });
  }
  return null;
}

function scanRecordStrings(rec, errors, index) {
  for (const [key, value] of Object.entries(rec)) {
    if (SECRET_KEY_RE.test(key)) {
      errors.push(err('secret_like_field', `field '${key}' looks secret-bearing; drops carry postings, not credentials`, { index, field: key }));
      return;
    }
    if (typeof value === 'string' && SECRET_VALUE_RE.test(value)) {
      errors.push(err('secret_like_field', `field '${key}' holds a secret-looking value`, { index, field: key }));
      return;
    }
  }
  // No absolute path leakage: any auxiliary string field (outside the
  // posting text and url, which legitimately contain slashes) that looks
  // like an absolute or parent-referencing path is rejected.
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'text' || key === 'url' || key === 'note') continue;
    if (typeof value !== 'string') continue;
    if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.includes('..')) {
      errors.push(err('absolute_path_leak', `field '${key}' must not carry absolute paths`, { index, field: key }));
      return;
    }
  }
}

export function validateBulkRecord(rec, index = 0) {
  const errors = [];
  if (!isRecord(rec)) {
    return { ok: false, errors: [err('record_invalid', 'record must be an object', { index })], record: null };
  }
  if (rec.id !== undefined && (typeof rec.id !== 'string' || rec.id.trim() === '')) {
    errors.push(err('record_invalid', 'id must be a non-empty string when present', { index }));
  }
  if (rec.provenance !== 'host_provided') {
    errors.push(err('invalid_provenance', "provenance must be 'host_provided': the host supplies content, the plugin never fetches in this validator", { index }));
  }
  const hasText = typeof rec.text === 'string' && rec.text.length > 0;
  const hasUrl = typeof rec.url === 'string' && rec.url.trim() !== '';
  if (!hasText && !hasUrl) {
    errors.push(err('missing_content', 'record needs posting text and/or url', { index }));
  }
  if (hasText && rec.text.length > MAX_RECORD_TEXT_CHARS) {
    errors.push(err('record_over_limit', `text exceeds ${MAX_RECORD_TEXT_CHARS} chars`, { index }));
  }
  if (hasUrl) {
    const urlErr = validatePublicUrl(rec.url);
    if (urlErr) errors.push({ ...urlErr, index });
  }
  if (rec.stagedPath !== undefined && rec.stagedPath !== null) {
    if (!isPortableRelPath(rec.stagedPath)) {
      errors.push(err('unsafe_path', 'stagedPath must be a portable relative path (drops stage under PLUGIN_DATA; no traversal, no absolute paths)', { index, field: 'stagedPath' }));
    }
  }
  if (rec.url !== undefined && rec.url !== null && typeof rec.url === 'string' && /^\s*file:/i.test(rec.url)) {
    errors.push(err('unsafe_url_protocol', 'file: urls are rejected', { index }));
  }
  scanRecordStrings(rec, errors, index);

  if (errors.length > 0) return { ok: false, errors, record: null };
  const accepted = { provenance: rec.provenance };
  if (rec.id !== undefined) accepted.id = rec.id;
  if (hasText) accepted.text = rec.text;
  if (hasUrl) accepted.url = rec.url.trim();
  if (rec.stagedPath !== undefined && rec.stagedPath !== null) accepted.stagedPath = rec.stagedPath;
  if (hasText) accepted.dedupKey = sha256Hex(rec.text);
  return { ok: true, errors: [], record: accepted };
}

// JSONL bulk file-drop: one record per line, blank lines skipped.
// Per-record errors are collected without aborting the whole drop; only
// hard limits (max records / max bytes) fail the drop outright.
export function parseBulkJsonl(text) {
  if (typeof text !== 'string') {
    return { ok: false, errors: [err('bulk_invalid', 'drop must be text')], records: [], duplicates: [] };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BULK_BYTES) {
    return { ok: false, errors: [err('bulk_over_limit', `drop exceeds ${MAX_BULK_BYTES} bytes`)], records: [], duplicates: [] };
  }
  const lines = text.split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  if (nonBlank.length > MAX_BULK_RECORDS) {
    return { ok: false, errors: [err('bulk_over_limit', `drop exceeds ${MAX_BULK_RECORDS} records`, { count: nonBlank.length })], records: [], duplicates: [] };
  }
  const errors = [];
  const records = [];
  const duplicates = [];
  const seenText = new Map(); // dedupKey -> first index
  nonBlank.forEach((line, lineNo) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(err('record_invalid', 'line is not valid JSON', { index: lineNo }));
      return;
    }
    const r = validateBulkRecord(parsed, lineNo);
    if (!r.ok) {
      errors.push(...r.errors);
      return;
    }
    if (r.record.dedupKey !== undefined) {
      if (seenText.has(r.record.dedupKey)) {
        duplicates.push({ index: lineNo, id: r.record.id, duplicateOf: seenText.get(r.record.dedupKey), dedupKey: r.record.dedupKey });
        return;
      }
      seenText.set(r.record.dedupKey, lineNo);
    }
    records.push(r.record);
  });
  return { ok: errors.length === 0, errors, records, duplicates };
}

export default {
  PACKET_FORMAT,
  TRUSTED_DECISION_ACTIONS,
  PACKET_COMPONENTS,
  MAX_BULK_RECORDS,
  MAX_BULK_BYTES,
  MAX_RECORD_TEXT_CHARS,
  sha256Hex,
  stableStringify,
  isPortableRelPath,
  canonicalPacket,
  computePacketHash,
  validatePacket,
  validateOutcome,
  validatePublicUrl,
  validateBulkRecord,
  parseBulkJsonl,
};
