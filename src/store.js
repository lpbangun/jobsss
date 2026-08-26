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
 */
function normalizeStore(parsed) {
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

function writeStoreAtomic(dir, store) {
  const p = path.join(dir, 'store.json');
  const tmp = `${p}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  return p;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact environment secrets, sk- tokens, and private key material from any
 * derived, human-readable output. Canonical store.json is excluded from this
 * (it may retain resume text for scoring), but projections are secret-safe.
 */
export function redactSecrets(text) {
  let out = String(text);
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || !value) continue;
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

function writeProjections(dir, store) {
  const projDir = path.join(dir, 'projections');
  fs.mkdirSync(projDir, { recursive: true });
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
  for (const [name, value] of Object.entries(projections)) {
    const file = path.join(projDir, name);
    fs.writeFileSync(file, redactSecrets(JSON.stringify(value, null, 2)), 'utf8');
  }
  // Human-readable audit/migration trail.
  const trail = (store.audit || []).map(entry =>
    `- ${entry.createdAt} ${entry.event}${entry.fromVersion != null ? ` from v${entry.fromVersion}` : ''}`
  );
  const auditMd = redactSecrets(
    `# JobSSS audit trail\n\n` +
    `Schema version: ${store.version}\n` +
    `Revision: ${store.revision}\n` +
    `Updated: ${store.updatedAt}\n\n` +
    `${trail.join('\n')}\n`
  );
  fs.writeFileSync(path.join(projDir, 'audit.md'), auditMd, 'utf8');
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
 * Backward-compatible raw writer. Loads via commitStore() for serialized,
 * lock-checked, stale-safe writes; this variant simply stamps schema/revision
 * and persists atomically under PLUGIN_DATA. Kept for existing callers.
 *
 * Accepts optional { expectedRevision } to reject stale updates.
 */
export function saveStore(dataDir, store, opts = {}) {
  const dir = ensureDataDir(dataDir);
  const expectedRevision = opts && opts.expectedRevision != null ? Number(opts.expectedRevision) : null;
  const currentRevision = Number.isInteger(store.revision) ? store.revision : 0;
  if (expectedRevision != null && expectedRevision !== currentRevision) {
    throw Object.assign(
      new Error(`Stale write rejected: expectedRevision ${expectedRevision} does not match current revision ${currentRevision}`),
      { code: 'stale_revision' }
    );
  }
  bumpMeta(store);
  incrementRevision(store);
  const p = writeStoreAtomic(dir, store);
  writeProjections(dir, store);
  return p;
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

/**
 * Serialized read-modify-write transaction.
 *
 * Acquires an exclusive `jobsss.lock` (rejecting a concurrent live holder),
 * loads the current canonical store (migrating a legacy v1 store in memory),
 * optionally rejects a stale `expectedRevision`, runs `mutate(store)` (in
 * place or returning a new store), stamps the next integer revision, persists
 * atomically under PLUGIN_DATA, writes post-commit projections, then releases
 * the lock. Any thrown error (including a rejected stale write) leaves the
 * store untouched.
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
    bumpMeta(result);
    incrementRevision(result);
    writeStoreAtomic(dir, result);
    writeProjections(dir, result);
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
