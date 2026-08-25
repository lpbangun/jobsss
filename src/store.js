// Bundled JobSSS store — minimal persistence under PLUGIN_DATA.
// Attributed port: inspired by JobOS src/db.js, src/workspace.js, and
// src/profiles.js persistence concepts, reimplemented as plain JSON
// for the standalone journey. JobOS remains MIT (see root LICENSE).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

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

export function loadStore(dataDir) {
  const dir = ensureDataDir(dataDir);
  const p = path.join(dir, 'store.json');
  if (!fs.existsSync(p)) {
    const init = { version: 1, profiles: {}, proofPoints: {}, jobs: {}, scores: {}, applications: {}, artifacts: {}, createdAt: now(), updatedAt: now() };
    return init;
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid store');
    parsed.profiles = parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
    parsed.proofPoints = parsed.proofPoints && typeof parsed.proofPoints === 'object' ? parsed.proofPoints : {};
    parsed.jobs = parsed.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    parsed.scores = parsed.scores && typeof parsed.scores === 'object' ? parsed.scores : {};
    parsed.applications = parsed.applications && typeof parsed.applications === 'object' ? parsed.applications : {};
    parsed.artifacts = parsed.artifacts && typeof parsed.artifacts === 'object' ? parsed.artifacts : {};
    parsed.version = 1;
    return parsed;
  } catch (error) {
    throw Object.assign(new Error(`Cannot read PLUGIN_DATA store: ${error.message}`), { code: 'invalid_store' });
  }
}

export function saveStore(dataDir, store) {
  const dir = ensureDataDir(dataDir);
  const p = path.join(dir, 'store.json');
  store.updatedAt = now();
  store.version = 1;
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  // Derived, human-inspectable workspace projections. store.json remains canonical.
  const projDir = path.join(dir, 'projections');
  fs.mkdirSync(projDir, { recursive: true });
  const projections = {
    'state.json': { version: 1, updatedAt: store.updatedAt },
    'profiles.json': Object.values(store.profiles),
    'proof-points.json': Object.values(store.proofPoints),
    'jobs.json': Object.values(store.jobs),
    'applications.json': Object.values(store.applications),
    'review.json': Object.values(store.artifacts),
  };
  for (const [name, value] of Object.entries(projections)) {
    fs.writeFileSync(path.join(projDir, name), JSON.stringify(value, null, 2), 'utf8');
  }
  return p;
}

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function dedupeKeyForJob({ title, company, location }) {
  return [company || '', title || '', location || ''].map(v => String(v).trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
}
