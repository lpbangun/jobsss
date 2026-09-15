#!/usr/bin/env node
// Freeze / verify the authored evaluator package.
//
//   node evaluation/freeze-files.mjs            # verify every frozen hash
//   node evaluation/freeze-files.mjs --write    # record hashes into the manifest
//   node evaluation/freeze-files.mjs --paths    # print the frozen file list
//
// The manifest itself is excluded (a file cannot carry its own hash). Run
// --write once when the package lands, then --verify in the release gate: an
// implementer edit to any authored file invalidates the freeze.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EVALUATION_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(EVALUATION_DIR);
const MANIFEST_DEFAULT = path.join(EVALUATION_DIR, 'MANIFEST-sourcing-v1.json');

function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function loadManifest(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function run(argv) {
  const write = argv.includes('--write');
  const pathsOnly = argv.includes('--paths');
  const manifestFlag = argv.indexOf('--manifest');
  const manifestPath = manifestFlag === -1 ? MANIFEST_DEFAULT : path.resolve(argv[manifestFlag + 1]);
  const doc = loadManifest(manifestPath);
  const entries = (doc.files || []).filter(entry => entry.role !== 'manifest');
  const failures = [];
  const results = [];

  for (const entry of entries) {
    const abs = path.join(REPO_ROOT, entry.path);
    if (!existsSync(abs)) {
      failures.push({ code: 'file_missing', path: entry.path });
      results.push({ path: entry.path, sha256: null, status: 'missing' });
      continue;
    }
    const actual = sha256File(abs);
    if (write) {
      entry.sha256 = actual;
      results.push({ path: entry.path, sha256: actual, status: 'recorded' });
      continue;
    }
    if (String(entry.sha256 || '') !== actual) {
      failures.push({ code: entry.sha256 ? 'hash_mismatch' : 'not_frozen', path: entry.path, declared: entry.sha256 || null, actual });
      results.push({ path: entry.path, sha256: actual, status: 'unfrozen' });
      continue;
    }
    results.push({ path: entry.path, sha256: actual, status: 'verified' });
  }

  if (write && failures.length === 0) {
    doc.frozenAt = new Date().toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(doc, null, 2)}\n`);
  }

  if (pathsOnly) {
    process.stdout.write(`${entries.map(entry => entry.path).join('\n')}\n`);
    return failures.length === 0 ? 0 : 1;
  }

  const report = {
    rubric: doc.rubricVersion || null,
    manifest: path.relative(REPO_ROOT, manifestPath).split(path.sep).join('/'),
    mode: write ? 'write' : 'verify',
    ok: failures.length === 0,
    checked: entries.length,
    failures,
    files: results
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, failures: [{ code: 'tool_error', message: String(error?.stack || error) }] }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
