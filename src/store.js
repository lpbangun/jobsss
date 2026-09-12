// Bundled JobSSS store — versioned, serialized, atomic persistence under PLUGIN_DATA.
// Attributed port: persistence concepts from JobOS src/db.js, src/workspace.js,
// and src/profiles.js (post-commit workspace projections, write serialization),
// reimplemented as plain JSON reviews for the standalone journey. JobOS remains
// MIT (see root LICENSE) and is never imported at runtime.
//
// Wave 1 contract (see BENCHMARK.md B14–B17):
//   - canonical store.json is schema/version >= 2 with an integer `revision`
//   - lossless migration from the legacy v1 store.json shape
//   - an audit/migration trail is kept (canonical `audit` array + projections/audit.md)
//   - writes are atomic (tmp + rename) under PLUGIN_DATA only
//   - `jobsss.lock` with a live external pid excludes concurrent writers
//   - a non-matching `expectedRevision` rejects a stale update instead of
//     silently overwriting
//   - post-commit projections are human-readable and secret-safe (no resumeText
//     dumps, no environment secrets, no sk-/private-key material)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

export const STORE_SCHEMA_VERSION = 2;
export const LOCK_FILE_NAME = 'jobsss.lock';

const COLLECTIONS = Object.freeze([
  'profiles', 'resumes', 'proofPoints', 'jobs', 'scores', 'applications', 'artifacts',
  'searches', 'tasks', 'answers', 'contacts', 'research', 'outreachPlans',
  'outreachDrafts', 'interviewStories', 'interviewPrep',
]);

export function slug(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'unknown';
  return text
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'unknown';
}

export function id(prefix, seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

export function now() {
  return new Date().toISOString();
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Canonical active-proof eligibility shared by every proof consumer.
 * Resume-import proof is eligible for current matching only when its id is in
 * the current resume's proof set (or its summary text is shared verbatim with
 * the current resume text). Independently added manual proof (any other
 * source) stays active unless explicitly retired. Historical-only proof stays
 * stored as history but is excluded from the returned set. Returns null when
 * the profile is unknown.
 */
export function activeProofIdsForStore(store, profileId) {
  const profile = store?.profiles?.[profileId];
  if (!profile) return null;
  const out = new Set();
  const currentText = String(profile.resumeText || '');
  for (const pid of (Array.isArray(profile.proofPointIds) ? profile.proofPointIds : [])) {
    const proof = store.proofPoints?.[pid];
    if (!proof || proof.profileId !== profileId) continue;
    if (proof.retiredAt || proof.status === 'retired') continue;
    out.add(pid);
  }
  if (currentText) {
    for (const proof of Object.values(store.proofPoints || {})) {
      if (proof.profileId !== profileId || proof.source !== 'resume_import') continue;
      if (proof.retiredAt || proof.status === 'retired') continue;
      if (proof.summary && currentText.includes(proof.summary)) out.add(proof.id);
    }
  }
  for (const proof of Object.values(store.proofPoints || {})) {
    if (proof.profileId !== profileId || proof.source === 'resume_import') continue;
    if (proof.retiredAt || proof.status === 'retired') continue;
    out.add(proof.id);
  }
  return out;
}

/** Readback-only evidence currency; never persisted or included in decision hashes. */
export function evidenceFreshnessForStore(store, record) {
  const active = activeProofIdsForStore(store, record.profileId);
  const reasons = new Set();
  const checkProof = proofId => {
    if (!active?.has(proofId)) reasons.add(`Proof ${proofId} is historical, retired, or unavailable`);
  };
  for (const proofId of record.proofPointIds || []) checkProof(proofId);
  for (const storyId of record.storyIds || []) {
    const story = store.interviewStories?.[storyId];
    if (!story || story.profileId !== record.profileId) {
      reasons.add(`Story ${storyId} is unavailable`);
      continue;
    }
    if (story.state === 'retired' || story.retiredAt) reasons.add(`Story ${storyId} is retired`);
    for (const proofId of story.proofPointIds || []) checkProof(proofId);
  }
  return { status: reasons.size ? 'stale' : 'current', reasons: [...reasons] };
}

export function ensureDataDir(dataDir) {
  if (!dataDir || typeof dataDir !== 'string') throw new Error('PLUGIN_DATA / --data directory is required');
  const abs = path.resolve(dataDir);
  if (abs === PLUGIN_ROOT || abs.startsWith(`${PLUGIN_ROOT}${path.sep}`)) {
    throw Object.assign(new Error('PLUGIN_DATA must be outside the installed plugin directory'), { code: 'unsafe_data_dir' });
  }
  fs.mkdirSync(abs, { recursive: true });
  const real = fs.realpathSync(abs);
  if (real === PLUGIN_ROOT || real.startsWith(`${PLUGIN_ROOT}${path.sep}`)) {
    throw Object.assign(new Error('PLUGIN_DATA must not resolve inside the installed plugin directory'), { code: 'unsafe_data_dir' });
  }
  return real;
}

export function storePath(dataDir) {
  return path.join(ensureDataDir(dataDir), 'store.json');
}

/**
 * Schema version currently on disk, or null when no canonical store file
 * exists yet. Read-only and side-effect free: callers that must report whether
 * a legacy migration actually ran (rc6) can compare it with
 * STORE_SCHEMA_VERSION before committing. An unreadable/corrupt store returns
 * null here; the following commitStore() raises the typed store error.
 */
export function storeSchemaVersionOnDisk(dataDir) {
  const p = storePath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = readStoreFile(p);
    const numeric = Number(parsed.version ?? parsed.schemaVersion ?? 1);
    return Number.isFinite(numeric) ? numeric : null;
  } catch { return null; }
}

function defaultStore() {
  const at = now();
  return {
    version: STORE_SCHEMA_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: 0,
    profiles: {},
    proofPoints: {},
    jobs: {},
    scores: {},
    applications: {},
    artifacts: {},
    audit: [{ event: 'init', createdAt: at }],
    createdAt: at,
    updatedAt: at,
  };
}

function ensureCollections(store) {
  for (const name of COLLECTIONS) {
    if (!store[name] || typeof store[name] !== 'object' || Array.isArray(store[name])) store[name] = {};
  }
  return store;
}

function appendAudit(store, entry) {
  store.audit = Array.isArray(store.audit) ? store.audit : [];
  store.audit.push({ createdAt: now(), ...entry });
  return store;
}

/**
 * Normalize a parsed store into the current schema in memory (no disk write).
 * Lossless v1 migration: all existing records keep their ids and fields; only
 * the schema marker/version, integer revision, and a migration audit entry are
 * added. Already-current stores are touched only to guarantee an integer
 * revision and schema markers.
 *
 * Unsupported future schemas (version or schemaVersion above the bundled
 * STORE_SCHEMA_VERSION) are rejected without rewriting anything: the caller
 * receives a typed error and the canonical bytes remain untouched.
 */
function assertSupportedSchema(parsed) {
  for (const field of ['version', 'schemaVersion']) {
    const raw = parsed?.[field];
    if (raw == null) continue;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > STORE_SCHEMA_VERSION) {
      throw Object.assign(
        new Error(`Unsupported future store ${field} ${raw}: this runtime supports schema ${STORE_SCHEMA_VERSION}`),
        { code: 'unsupported_schema_version', details: { [field]: raw } }
      );
    }
  }
}
function normalizeStore(parsed) {
  assertSupportedSchema(parsed);
  const store = ensureCollections(parsed);
  const current = Number(store.version || store.schemaVersion || 1);
  store.version = STORE_SCHEMA_VERSION;
  store.schemaVersion = STORE_SCHEMA_VERSION;
  if (!Number.isInteger(store.revision) || store.revision < 1) store.revision = 1;
  if (current < STORE_SCHEMA_VERSION) {
    appendAudit(store, { event: 'migration', fromVersion: current });
  }
  return store;
}

function readStoreFile(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (error) {
    throw Object.assign(new Error(`Cannot read PLUGIN_DATA store: ${error.message}`), { code: 'invalid_store' });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error(`Cannot parse PLUGIN_DATA store: ${error.message}`), { code: 'invalid_store' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('Cannot read PLUGIN_DATA store: invalid store'), { code: 'invalid_store' });
  }
  return parsed;
}

/**
 * Load the canonical store, migrating a legacy v1 store losslessly in memory.
 * Read-only: does not persist. Pair with commitStore()/saveStore() to commit.
 */
export function loadStore(dataDir) {
  const p = storePath(dataDir);
  if (!fs.existsSync(p)) return defaultStore();
  return normalizeStore(readStoreFile(p));
}

/**
 * Atomic temp+rename file write. The temp file lives next to the target so the
 * rename stays on the same filesystem. On any failure the temp file is removed
 * (best effort) so a failed projection never leaves partial/tmp artifacts.
 */
export function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort cleanup */ }
    throw error;
  }
  return filePath;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * B27 — projection path confinement (BENCHMARK.md B27).
 *
 * Every projection is written beneath the real (non-symlinked) PLUGIN_DATA
 * directory while the store lock is held. Before any canonical mutation is
 * persisted, each directory segment of every projection target is checked
 * with lstat (no follow): an existing symlink/junction, a non-directory
 * component, or a component whose realpath escapes PLUGIN_DATA rejects the
 * whole transaction, so a rejected escape never bumps `revision` or changes
 * state. Missing components are safe to create fresh (their validated parent
 * is confined and we hold the exclusive write lock). The leaf file itself is
 * written with temp+rename (see `assertProjectionTargetSafe`).
 */
function assertProjectionPathSafe(dir, segments) {
  let current = dir;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') continue; // fresh path under a validated parent
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw Object.assign(
        new Error(`Projection path ${current} is a symlink; refusing to write outside PLUGIN_DATA.`),
        { code: 'unsafe_projection_path', details: { path: current } }
      );
    }
    if (!stat.isDirectory()) {
      throw Object.assign(
        new Error(`Projection path ${current} is not a directory; refusing to write a projection there.`),
        { code: 'unsafe_projection_path', details: { path: current } }
      );
    }
    const real = fs.realpathSync(current);
    if (real !== dir && !real.startsWith(`${dir}${path.sep}`)) {
      throw Object.assign(
        new Error(`Projection path ${current} resolves outside PLUGIN_DATA.`),
        { code: 'unsafe_projection_path', details: { path: current, real } }
      );
    }
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Derive the indexed (non-aggregate) projection targets from a committed store.
 * - `jobs/<id>/job.json` for every job that was explicitly acted on: an
 *   untracked discovery (`saved:false` with no application record) never gets
 *   a folder (B20); any saved/pursued/imported job or any job with a local
 *   application record does.
 * - `applications/<jobId>/application.json` for every local application record.
 *
 * Exported so the parent layer can rely on this one transaction owning every
 * durable and derived write.
 */
export function deriveProjectionTargets(store) {
  const targets = [];
  const applications = store.applications || {};
  for (const job of Object.values(store.jobs || {})) {
    if (!job || !job.id) continue;
    if (!SAFE_SEGMENT.test(String(job.id))) {
      throw Object.assign(new Error(`Unsafe job projection segment: ${job.id}`), { code: 'unsafe_projection_path', details: { path: job.id } });
    }
    const explicit = job.saved === true || Boolean(applications[job.id]);
    if (explicit) targets.push({ segments: ['jobs', String(job.id), 'job.json'], value: job });
  }
  for (const app of Object.values(applications)) {
    if (!app) continue;
    const jobId = app.jobId || app.id;
    if (!jobId) continue;
    if (!SAFE_SEGMENT.test(String(jobId))) {
      throw Object.assign(new Error(`Unsafe application projection segment: ${jobId}`), { code: 'unsafe_projection_path', details: { path: jobId } });
    }
    targets.push({ segments: ['applications', String(jobId), 'application.json'], value: app });
  }
  // P1b per-job Greenhouse application folders (additive): only for jobs
  // that explicitly carry a verbatim posting and/or linked application
  // detail. Discovery-only rows (no postingText/detail) emit nothing extra,
  // so unsaved discovery still creates no job folder.
  for (const job of Object.values(store.jobs || {})) {
    if (!job || !job.id) continue;
    const explicit = job.saved === true || Boolean(applications[job.id]);
    if (!explicit) continue;
    if (typeof job.postingText === 'string' && job.postingText) {
      targets.push({ segments: ['jobs', String(job.id), 'posting.md'], text: job.postingText });
    }
    const detail = job.applicationDetail;
    if (detail && Array.isArray(detail.questions)) {
      targets.push({ segments: ['jobs', String(job.id), 'application.json'], value: greenhouseApplicationFile(store, job) });
      targets.push({ segments: ['jobs', String(job.id), 'questions.md'], text: greenhouseQuestionsChecklist(job) });
    }
  }
  return targets;
}

/**
 * P1b `jobs/<id>/application.json` payload: normalized questions[] +
 * documents[] with Greenhouse provenance (board/detail URL), fetchedAt,
 * id, revision, hash, and the verbatim raw detail response.
 */
function greenhouseApplicationFile(store, job) {
  const detail = job.applicationDetail || {};
  const listing = detail.listing && typeof detail.listing === 'object' ? detail.listing : {};
  return {
    id: job.id,
    jobId: job.id,
    profileId: job.profileId,
    title: job.title,
    company: job.company,
    location: listing.location ?? job.location ?? '',
    compensation: listing.compensation ?? job.compensation ?? '',
    workModel: listing.workModel ?? job.workModel ?? '',
    board: detail.board || '',
    sourceUrl: job.url || detail.sourceUrl || '',
    detailUrl: detail.detailUrl || '',
    fetchedAt: detail.fetchedAt || null,
    revision: Number.isInteger(store.revision) ? store.revision : 1,
    hash: detail.hash || hashText(JSON.stringify(detail.rawDetail ?? null)),
    sourceHash: detail.hash || hashText(JSON.stringify(detail.rawDetail ?? null)),
    status: detail.status || (detail.degraded ? 'degraded' : 'ok'),
    degraded: Boolean(detail.degraded || detail.status === 'degraded'),
    ...(detail.reason ? { reason: String(detail.reason) } : {}),
    ...(detail.message ? { message: String(detail.message) } : {}),
    listing: {
      title: listing.title ?? job.title ?? '',
      company: listing.company ?? job.company ?? '',
      location: listing.location ?? job.location ?? '',
      compensation: listing.compensation ?? job.compensation ?? '',
      workModel: listing.workModel ?? job.workModel ?? '',
      url: listing.url ?? job.url ?? detail.sourceUrl ?? '',
    },
    questions: Array.isArray(detail.questions) ? detail.questions : [],
    documents: Array.isArray(detail.documents) ? detail.documents : [],
    detailCoverage: job.detailCoverage || null,
    questionsStatus: job.questionsStatus || null,
    rawDetail: detail.rawDetail ?? null,
  };
}

/**
 * P1b `jobs/<id>/questions.md`: human-readable checklist derived from
 * application.json with required questions and documents flagged.
 */
function greenhouseQuestionsChecklist(job) {
  const detail = job.applicationDetail || {};
  const questions = Array.isArray(detail.questions) ? detail.questions : [];
  const documents = Array.isArray(detail.documents) ? detail.documents : [];
  const required = questions.filter(item => item.required);
  const optional = questions.filter(item => !item.required);
  const lines = [
    `# Application questions: ${job.title || job.id}`,
    '',
    `Source: ${detail.detailUrl || job.url || ''}`,
    `Board: ${detail.board || ''} — fetched ${detail.fetchedAt || 'unknown'}`,
    '',
    '## Required questions',
    '',
  ];
  for (const item of required) {
    const options = Array.isArray(item.options) && item.options.length ? ` [options: ${item.options.join(', ')}]` : '';
    lines.push(`- [ ] ${item.label} (required)${options}`);
  }
  if (!required.length) lines.push('- [ ] (none)');
  lines.push('', '## Optional questions', '');
  for (const item of optional) lines.push(`- [ ] ${item.label}`);
  if (!optional.length) lines.push('- [ ] (none)');
  lines.push('', '## Required documents', '');
  const requiredDocs = documents.filter(item => item.required);
  for (const item of requiredDocs) {
    const spelled = String(item.kind).replace(/_/g, ' ');
    lines.push(`- [ ] ${item.kind} (${spelled}) (required)`);
  }
  if (!requiredDocs.length) lines.push('- [ ] (none)');
  const optionalDocs = documents.filter(item => !item.required);
  if (optionalDocs.length) {
    lines.push('', '## Optional documents', '');
    for (const item of optionalDocs) lines.push(`- [ ] ${item.kind} (${String(item.kind).replace(/_/g, ' ')})`);
  }
  lines.push('', 'Human verification required before any outside step.', '');
  return lines.join('\n');
}

/**
 * Redact environment secrets, sk- tokens, and private key material from any
 * durable or derived output. Ordinary resume/job text remains available for
 * local scoring, while credential-shaped values are redacted everywhere.
 */
export function redactSecrets(text) {
  let out = String(text);
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || value.length < 8) continue;
    if (/(?:secret|token|api[_-]?key|passwd|password|auth|private)/i.test(key)) {
      out = out.replace(new RegExp(escapeRegExp(value), 'g'), '[redacted]');
    }
  }
  out = out.replace(/sk-[A-Za-z0-9]{8,}/g, '[redacted]');
  out = out.replace(/-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA |PGP |)PRIVATE KEY-----/gi, '[redacted]');
  return out;
}

function safeProfile(profile) {
  // Derived profile projections must not dump raw resume text; it stays in the
  // canonical store for scoring only.
  return Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'resumeText'));
}

/**
 * Build the aggregate projection payloads (`projections/*` including the
 * audit trail) as write descriptors. Nothing touches disk here; the staged
 * multi-file transaction performs all writes under the store lock.
 */
function buildAggregateProjectionWrites(store) {
  const counts = {};
  for (const name of COLLECTIONS) {
    counts[name] = Object.keys(store[name] || {}).length;
  }
  const projections = {
    'state.json': {
      schemaVersion: store.version,
      version: store.version,
      revision: store.revision,
      updatedAt: store.updatedAt,
      counts,
    },
    'profiles.json': Object.values(store.profiles || {}).map(safeProfile),
    'proof-points.json': Object.values(store.proofPoints || {}),
    'jobs.json': Object.values(store.jobs || {}),
    'applications.json': Object.values(store.applications || {}),
    'review.json': Object.values(store.artifacts || {}),
    'searches.json': Object.values(store.searches || {}),
    'tasks.json': Object.values(store.tasks || {}),
    'contacts.json': Object.values(store.contacts || {}),
    'network.json': {
      research: Object.values(store.research || {}),
      outreachPlans: Object.values(store.outreachPlans || {}),
      outreachDrafts: Object.values(store.outreachDrafts || {}),
    },
    'interviews.json': {
      stories: Object.values(store.interviewStories || {}),
      preparation: Object.values(store.interviewPrep || {}),
    },
  };
  const writes = [];
  for (const [name, value] of Object.entries(projections)) {
    writes.push({ segments: ['projections', name], content: redactSecrets(JSON.stringify(value, null, 2)) });
  }
  const trail = (store.audit || []).map(entry => {
    const parts = [`- ${entry.createdAt} ${entry.event}`];
    if (entry.action) parts.push(entry.action);
    if (entry.entityId) parts.push(entry.entityId);
    if (entry.entityType) parts.push(`(${entry.entityType})`);
    if (entry.actor) parts.push(`[${entry.actor}]`);
    if (entry.handoffId) parts.push(entry.handoffId);
    if (entry.fromVersion != null) parts.push(`from v${entry.fromVersion}`);
    return parts.join(' ');
  });
  const auditMd = redactSecrets(
    `# JobSSS audit trail\n\n` +
    `Schema version: ${store.version}\n` +
    `Revision: ${store.revision}\n` +
    `Updated: ${store.updatedAt}\n\n` +
    `${trail.join('\n')}\n`
  );
  writes.push({ segments: ['projections', 'audit.md'], content: auditMd });
  return writes;
}

function bumpMeta(store) {
  store.version = STORE_SCHEMA_VERSION;
  store.schemaVersion = STORE_SCHEMA_VERSION;
  store.updatedAt = now();
  return store;
}

function incrementRevision(store) {
  store.revision = Math.max(1, (Number.isInteger(store.revision) ? store.revision : 0) + 1);
  return store;
}

/**
 * Backward-compatible snapshot writer. Persists a caller-supplied store
 * through the serialized, locked, stale-safe transaction.
 *
 * Accepts optional `expectedRevision`; when omitted, it defaults to the
 * snapshot's own integer `revision` so that a stale snapshot (an object
 * loaded or derived earlier than the current on-disk revision) is rejected
 * instead of silently overwriting newer state. A snapshot without an integer
 * revision is treated as no expected revision (fresh/legacy callers).
 */
export function saveStore(dataDir, store, opts = {}) {
  const explicit = opts && opts.expectedRevision != null ? Number(opts.expectedRevision) : null;
  const snapshotRevision = store && Number.isInteger(store.revision) ? store.revision : null;
  const expectedRevision = explicit != null ? explicit : snapshotRevision;
  return commitStore(dataDir, { expectedRevision }, () => store).storePath;
}

/**
 * Validate the aggregate projection roots (projections/, jobs/, applications/)
 * on every commit: any durable/derived write may land beneath them.
 */
function assertProjectionTargetSafe(dir, target) {
  // Only directory components are confinement-checked. The file itself is
  // written with temp+rename, which atomically replaces any existing symlink
  // at that path instead of following it, so the leaf cannot redirect a write
  // outside PLUGIN_DATA.
  assertProjectionPathSafe(dir, target.segments.slice(0, -1));
}
function assertProjectionRootsSafe(dir) {
  assertProjectionPathSafe(dir, ['projections']);
  assertProjectionPathSafe(dir, ['jobs']);
  assertProjectionPathSafe(dir, ['applications']);
}

function isLivePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(dir) {
  const p = path.join(dir, LOCK_FILE_NAME);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(p, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: now() }));
      fs.closeSync(fd);
      return { path: p, owned: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holderPid = null;
      try {
        holderPid = Number(JSON.parse(fs.readFileSync(p, 'utf8')).pid);
      } catch {
        holderPid = null;
      }
      if (holderPid != null && isLivePid(holderPid)) {
        throw Object.assign(
          new Error(`PLUGIN_DATA is locked by another live process (pid ${holderPid}); a write cannot proceed concurrently.`),
          { code: 'store_locked' }
        );
      }
      // Stale lock from a dead pid: remove and retry.
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    }
  }
  throw Object.assign(new Error('Could not acquire the PLUGIN_DATA write lock.'), { code: 'store_locked' });
}

function releaseLock(lock) {
  if (!lock || !lock.owned) return;
  try { fs.unlinkSync(lock.path); } catch { /* already gone */ }
}

function pathExists(abs) {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function unsafeProjectionError(abs, reason) {
  const detail = reason ? ` (${reason})` : '';
  return Object.assign(
    new Error(`Projection path ${abs}${detail} is unsafe; refusing to write outside PLUGIN_DATA.`),
    { code: 'unsafe_projection_path', details: { path: String(abs), ...(reason ? { reason } : {}) } }
  );
}

/**
 * Validate one already-existing directory entry in a projection chain.
 * Rejects symlinks/junctions, non-directories, and any component whose
 * realpath escapes the real PLUGIN_DATA directory (no follow).
 */
function validateProjectionDirectory(stat, abs, dir) {
  if (stat.isSymbolicLink()) throw unsafeProjectionError(abs, 'symlink');
  if (!stat.isDirectory()) throw unsafeProjectionError(abs, 'not a directory');
  let real;
  try { real = fs.realpathSync(abs); }
  catch (error) { throw unsafeProjectionError(abs, 'realpath failed'); }
  if (real !== dir && !real.startsWith(`${dir}${path.sep}`)) {
    throw unsafeProjectionError(abs, `escapes PLUGIN_DATA (${real})`);
  }
}

/**
 * Ensure an ordered directory chain exists beneath `dir`, creating missing
 * components one level at a time and lstat-validating each immediately after
 * creation, then re-validating the whole chain. This narrows the symlink
 * TOCTOU window around mkdir so a symlink introduced at any point (or a
 * component that already exists as a symlink/non-directory) rejects the
 * transaction before any file is written.
 */
function ensureSafeDirectoryChain(dir, segments) {
  let current = dir;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw unsafeProjectionError(current, String(error.code));
      try { fs.mkdirSync(current); }
      catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw unsafeProjectionError(current, String(mkdirError.code));
      }
      try { stat = fs.lstatSync(current); }
      catch { throw unsafeProjectionError(current, 're-stat failed'); }
    }
    validateProjectionDirectory(stat, current, dir);
  }
  // Re-validate the complete chain after creation with the same no-follow lens.
  assertProjectionPathSafe(dir, segments);
}

/**
 * Multi-file transaction over one or more write descriptors (canonical store
 * plus every aggregate and indexed projection). Holds the exclusive store
 * lock for its whole duration.
 *
 * Phase 1 (stage): every parent directory chain is ensured + revalidated
 * immediately before the temp payload is written next to its target, so each
 * leaf write stays temp+rename atomic on the same filesystem while the
 * directory confinement is re-checked right before the actual write.
 *
 * Phase 2 (commit): the chains are revalidated again immediately before the
 * renames begin. Each existing target is first moved to a unique backup path
 * (a rename moves the entry itself, so a malicious leaf symlink is never
 * followed), then the staged temp is renamed into place.
 *
 * Phase 3 (rollback): if any step throws, previously committed entries are
 * restored in reverse order (backup rename-back for pre-existing files,
 * removal for freshly created ones) and every temp/backup file is removed,
 * so an exception leaves the canonical store and all projections exactly as
 * they were, with no tmp/backup leftovers.
 *
 * Phase 4 (cleanup): on success every backup and any stray temp file is
 * removed.
 *
 * Crash atomicity is NOT claimed: a hard kill between renames can still leave
 * a mix of old/new files (that is impossible to make atomic across files with
 * plain POSIX renames). The guarantee here is accurate exception rollback and
 * leftover cleanup while the lock is held.
 */
function commitFilesTransaction(dir, writes) {
  const staged = [];
  const committed = [];
  try {
    for (const write of writes) {
      const parentSegments = write.segments.slice(0, -1);
      ensureSafeDirectoryChain(dir, parentSegments);
      assertProjectionPathSafe(dir, parentSegments);
      const existed = pathExists(write.abs);
      if (existed) {
        const leaf = fs.lstatSync(write.abs);
        if (leaf.isDirectory() || (!leaf.isFile() && !leaf.isSymbolicLink())) {
          throw unsafeProjectionError(write.abs, 'leaf is not a regular file');
        }
      }
      const tmp = `${write.abs}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tmp, write.content, 'utf8');
      staged.push({ abs: write.abs, tmp, backup: null, existed });
    }
    // Narrow the TOCTOU window: revalidate every chain immediately before the
    // renames are issued.
    for (const write of writes) {
      assertProjectionPathSafe(dir, write.segments.slice(0, -1));
    }
    for (const item of staged) {
      if (item.existed) {
        item.backup = `${item.abs}.bak.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        fs.renameSync(item.abs, item.backup);
      }
      committed.push(item);
      fs.renameSync(item.tmp, item.abs);
    }
  } catch (error) {
    rollbackTransaction(staged, committed);
    throw error;
  }
  cleanupTransaction(staged);
}

function rollbackTransaction(staged, committed) {
  for (const item of [...committed].reverse()) {
    try {
      if (item.backup) {
        fs.renameSync(item.backup, item.abs);
        item.backup = null;
      } else if (pathExists(item.abs)) fs.rmSync(item.abs, { force: true });
    } catch { /* leave an unrestored backup in place rather than deleting evidence/state */ }
  }
  for (const item of staged) {
    try { fs.rmSync(item.tmp, { force: true }); } catch { /* best effort */ }
  }
}

function cleanupTransaction(staged) {
  for (const item of staged) {
    try { if (item.backup) fs.rmSync(item.backup, { force: true }); } catch { /* already gone */ }
    try { fs.rmSync(item.tmp, { force: true }); } catch { /* already renamed away */ }
  }
}

/**
 * Serialized read-modify-write transaction.
 *
 * Acquires an exclusive `jobsss.lock` (rejecting a concurrent live holder),
 * loads the current canonical store (migrating a legacy v1 store in memory),
 * optionally rejects a stale `expectedRevision`, runs `mutate(store)` (in
 * place or returning a new store), stamps the next integer revision, then
 * commits ALL durable and derived writes through one staged multi-file
 * transaction while the lock is still held: aggregate `projections/*` files,
 * the derived indexed projections (`jobs/<id>/job.json`,
 * `applications/<id>/application.json`), and finally the canonical
 * `store.json` (the last file renamed, acting as the logical commit point).
 *
 * Every projection write is temp+rename atomic, redacted, and confined
 * beneath real non-symlinked PLUGIN_DATA paths; a symlink/junction/
 * non-directory/escape target rejects the whole transaction BEFORE any file
 * is staged or renamed, so a rejected path never bumps `revision` or changes
 * state. An exception mid-commit rolls the transaction back (restoring every
 * previously committed file and removing all temp/backup files), so the
 * canonical store and projections are left exactly as they were.
 *
 * Cross-file crash atomicity is not claimed (plain POSIX renames cannot make
 * multiple files atomic); the guarantee is accurate exception rollback and
 * leftover cleanup while the lock is held.
 *
 * Returns `{ store, revision, storePath }` on success.
 */
export function commitStore(dataDir, { expectedRevision = null } = {}, mutate = store => store) {
  const dir = ensureDataDir(dataDir);
  const lock = acquireLock(dir);
  try {
    const p = path.join(dir, 'store.json');
    const store = fs.existsSync(p) ? normalizeStore(readStoreFile(p)) : defaultStore();
    const currentRevision = Number.isInteger(store.revision) ? store.revision : 0;
    if (expectedRevision != null && Number(expectedRevision) !== currentRevision) {
      throw Object.assign(
        new Error(`Stale write rejected: expectedRevision ${expectedRevision} does not match current revision ${currentRevision}`),
        { code: 'stale_revision' }
      );
    }
    const result = mutate(store) || store;
    // B27: reject symlink/junction/non-directory projection targets BEFORE any
    // write is staged or persisted. A rejected escape throws here, so the
    // on-disk store, revision, and state remain untouched and no file is
    // written outside PLUGIN_DATA.
    assertProjectionRootsSafe(dir);
    const targets = deriveProjectionTargets(result);
    for (const target of targets) assertProjectionTargetSafe(dir, target);
    bumpMeta(result);
    incrementRevision(result);
    const writes = [
      ...buildAggregateProjectionWrites(result).map(write => ({ ...write, abs: path.join(dir, ...write.segments) })),
      ...targets.map(target => ({
        segments: target.segments,
        abs: path.join(dir, ...target.segments),
        content: target.text != null
          ? redactSecrets(String(target.text))
          : redactSecrets(JSON.stringify(target.value, null, 2)),
      })),
      // Canonical store is the last file renamed: it is the logical commit point.
      { segments: [], abs: p, content: redactSecrets(JSON.stringify(result, null, 2)) },
    ];
    commitFilesTransaction(dir, writes);
    return { store: result, revision: result.revision, storePath: p };
  } finally {
    releaseLock(lock);
  }
}

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function dedupeKeyForJob({ title, company, location }) {
  return [company || '', title || '', location || ''].map(v => String(v).trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
}
