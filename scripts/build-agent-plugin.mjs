#!/usr/bin/env node
/**
 * Build the thin Agent Plugins install package at ./agent-plugin/.
 *
 * Why this exists: the repository root is the canonical Agent Plugin, but it also
 * carries reviewer-owned benchmark evidence (BENCHMARK.md, docs/, evaluation/,
 * tests/) that no installer should ever copy. `hermes plugins install` scans the
 * whole tree it is pointed at, so the install surface must be an explicit,
 * self-contained subdirectory holding only what the product needs to run:
 *
 *   agent-plugin/
 *     plugin.json, mcp.json   — the two manifests, byte-identical to the root
 *     bin/, src/              — the bundled runtime (no JobOS import or spawn)
 *     skills/jobsss/**        — the single agent skill
 *
 * The package is a mechanical byte-for-byte mirror of the canonical root files;
 * it is never a second source of truth. `tests/agent-plugin-parity.test.mjs`
 * fails on any drift (missing, extra, or changed byte), so a fix applied to the
 * canonical tree without re-running this script is caught mechanically.
 *
 * Usage: node scripts/build-agent-plugin.mjs [--check]
 *   (no flag)  rewrite ./agent-plugin/ from the canonical tree
 *   --check    report drift and exit non-zero without writing anything
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_DIRNAME = 'agent-plugin';

/** Whole canonical directories mirrored into the package. */
export const MIRROR_DIRS = Object.freeze(['bin', 'src', 'skills']);
/** Canonical root metadata and manifests mirrored into the package. */
export const MIRROR_FILES = Object.freeze(['package.json', 'plugin.json', 'mcp.json']);

function listFiles(absDir, prefix) {
  const found = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(absDir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`package mirror must not contain symlinks: ${rel}`);
    if (entry.isDirectory()) found.push(...listFiles(abs, rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

/** Sorted POSIX-relative paths of every canonical file the package must contain. */
export function canonicalMirrorFiles(root = REPO_ROOT) {
  const rels = [...MIRROR_FILES];
  for (const dir of MIRROR_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) throw new Error(`canonical directory missing: ${dir}/`);
    rels.push(...listFiles(abs, dir));
  }
  return rels.sort();
}

export function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

/** Sorted POSIX-relative paths of every file currently inside the package dir. */
export function packageFiles(packageDir) {
  if (!fs.existsSync(packageDir)) return [];
  return listFiles(packageDir, '').map(rel => rel.replace(/^\//, '')).sort();
}

/**
 * Compare the package against the canonical tree: same file set, same bytes.
 * Returns `{ ok, missing, extra, changed, files }` — `changed` holds `{ rel, canonical, package }` digests.
 */
export function packageDrift(root = REPO_ROOT, packageDir = path.join(root, PACKAGE_DIRNAME)) {
  const canonical = canonicalMirrorFiles(root);
  const present = packageFiles(packageDir);
  const canonicalSet = new Set(canonical);
  const presentSet = new Set(present);
  const missing = canonical.filter(rel => !presentSet.has(rel));
  const extra = present.filter(rel => !canonicalSet.has(rel));
  const changed = [];
  for (const rel of canonical) {
    if (missing.includes(rel)) continue;
    const left = sha256File(path.join(root, rel));
    const right = sha256File(path.join(packageDir, rel));
    if (left !== right) changed.push({ rel, canonical: left, package: right });
  }
  return { ok: missing.length === 0 && extra.length === 0 && changed.length === 0, missing, extra, changed, files: canonical };
}

/** Rewrite the package from the canonical tree; returns the mirrored relative paths. */
export function buildPackage(root = REPO_ROOT, packageDir = path.join(root, PACKAGE_DIRNAME)) {
  const rels = canonicalMirrorFiles(root);
  fs.rmSync(packageDir, { recursive: true, force: true });
  for (const rel of rels) {
    const source = path.join(root, rel);
    const destination = path.join(packageDir, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, fs.lstatSync(source).mode & 0o777);
  }
  return rels;
}

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const drift = packageDrift();
    if (drift.ok) {
      console.log(`package: ${PACKAGE_DIRNAME}/ matches the canonical tree (${drift.files.length} files)`);
      return;
    }
    console.error(`package: ${PACKAGE_DIRNAME}/ drifts from the canonical tree`);
    for (const rel of drift.missing) console.error(`  missing: ${rel}`);
    for (const rel of drift.extra) console.error(`  extra:   ${rel}`);
    for (const item of drift.changed) console.error(`  changed: ${item.rel} (${item.canonical} -> ${item.package})`);
    process.exitCode = 1;
    return;
  }
  const rels = buildPackage();
  console.log(`package: wrote ${PACKAGE_DIRNAME}/ (${rels.length} files mirrored from the canonical tree)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
