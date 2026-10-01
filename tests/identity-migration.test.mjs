import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCapture } from '../src/compat-probe.js';
import {
  IDENTITY_CONTRACT_MIGRATION_VERSION,
  migrateIdentityContractsInPlace,
} from '../src/identity-migrations.js';

const root = path.resolve(import.meta.dirname, '..');

test('identity contract read migration is lossless and idempotent', () => {
  const persisted = {
    revision: 8,
    profiles: { p1: { id: 'p1', name: 'Synthetic Reviewer' } },
    scores: {
      s1: {
        contract: 'jobos.fit-score.v1',
        jobId: 'j1',
        overall: 74,
        reasoning: 'jobos.fit-score.v1 is preserved as literal historical prose.',
        dimensions: { roleFit: { score: 80, evidenceRefs: [{ kind: 'proof_point', id: 'proof-1' }] } },
      },
    },
    discoveries: [{ postingLiveness: { contract: 'jobos.posting-liveness.v1', status: 'open' } }],
    custom: { contract: 'unrecognized.v1', bytes: [0, 1, 2], enabled: false },
    audit: [{ note: 'retain', revision: 7 }],
  };
  const before = structuredClone(persisted);
  const report = migrateIdentityContractsInPlace(persisted);

  assert.equal(IDENTITY_CONTRACT_MIGRATION_VERSION, 1);
  assert.deepEqual(report, { version: 1, changed: true, migrated: 2 });
  assert.equal(persisted.scores.s1.contract, 'jobsss.fit-score.v1');
  assert.equal(persisted.discoveries[0].postingLiveness.contract, 'jobsss.posting-liveness.v1');
  before.scores.s1.contract = 'jobsss.fit-score.v1';
  before.discoveries[0].postingLiveness.contract = 'jobsss.posting-liveness.v1';
  assert.deepEqual(persisted, before, 'only the two recognized contract fields change');

  const snapshot = structuredClone(persisted);
  assert.deepEqual(migrateIdentityContractsInPlace(persisted), { version: 1, changed: false, migrated: 0 });
  assert.deepEqual(persisted, snapshot, 'repeated migration preserves the migrated store');
});

test('compatibility probe timeout settles when a descendant keeps stdout open', async () => {
  const descendantScript = [
    "import { spawn } from 'node:child_process';",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'inherit' });",
    'child.unref();',
  ].join('\n');
  const started = Date.now();
  const result = await runCapture(
    process.execPath,
    ['--input-type=module', '-e', descendantScript],
    process.env,
    300,
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 1);
  assert.ok(Date.now() - started < 2_000, 'timeout must settle without waiting for inherited pipes to close');
});
test('active contracts and product metadata use the JobSSS namespace', () => {
  const activeFiles = [
    'src/scoring.js',
    'src/compat-probe.js',
    'skills/jobsss/SKILL.md',
    'skills/jobsss/references/standalone-journey.md',
    'skills/jobsss/references/human-only-handoffs.md',
    'skills/jobsss/references/resume-workflow.md',
    'README.md',
    'INSTALL.md',
    'plugin.json',
  ];
  for (const rel of activeFiles) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /jobos\.(?:fit-score|posting-liveness)\.v1/, `${rel} has a legacy contract identifier`);
    assert.doesNotMatch(text, /\bJOBOS_[A-Z0-9_]+\b/, `${rel} has a legacy environment variable`);
  }
  for (const rel of [
    'src/compat-probe.js',
    'skills/jobsss/SKILL.md',
    'skills/jobsss/references/standalone-journey.md',
    'skills/jobsss/references/human-only-handoffs.md',
    'skills/jobsss/references/resume-workflow.md',
    'README.md',
    'INSTALL.md',
    'plugin.json',
  ]) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /\bJobOS\b/i, `${rel} contains active legacy product language`);
  }
});

test('repository-wide identity references are limited to documented exceptions', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'identity-reference-audit.json'), 'utf8'));
  assert.equal(policy.version, 1);
  const extensions = new Set(policy.scanExtensions);
  const skipped = new Set(policy.skip.map(item => item.path));
  const markers = policy.markers.map(item => ({ ...item, regex: new RegExp(item.pattern, item.flags) }));
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const rel = path.relative(root, absolute).split(path.sep).join('/');
        if (skipped.has(rel)) continue;
        if (extensions.has(path.extname(entry.name)) || ['LICENSE', 'NOTICE'].includes(entry.name)) {
          files.push([rel, fs.readFileSync(absolute, 'utf8')]);
        }
      }
    }
  };
  visit(root);

  const allowlisted = policy.allowlist.flatMap(group => group.paths.map(pattern => ({ ...group, pattern })));
  const matchesPattern = (rel, pattern) => {
    if (!pattern.includes('*')) return rel === pattern;
    if (pattern.endsWith('/**')) return rel.startsWith(pattern.slice(0, -2));
    throw new Error(`Unsupported identity audit pattern: ${pattern}`);
  };
  const unclassified = [];
  for (const [rel, content] of files) {
    const found = markers.filter(marker => marker.regex.test(content)).map(marker => marker.name);
    if (!found.length) continue;
    const category = allowlisted.find(item => matchesPattern(rel, item.pattern))?.category;
    if (!category) unclassified.push(`${rel}: ${found.join(', ')}`);
  }
  assert.deepEqual(unclassified, [], `Unclassified legacy identity references:\n${unclassified.join('\n')}`);
});
