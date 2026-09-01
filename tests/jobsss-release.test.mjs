import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  callRequest,
  initializeRequest,
  jobFixture,
  listRelFiles,
  listToolsRequest,
  parseToolValue,
  pickId,
  requireOk,
  resumeFixture
} from './helpers/jobsss-live-mcp.mjs';
import {
  INTENDED_RELEASE_TARGETS,
  assertCompleteReleaseDeterminism,
  assertHonestStatus,
  assertNoBuildPathLeakage,
  assertNoNodeUse,
  assertPortableReleaseEvidence,
  assertPortableReleaseTree,
  assertReleasedRuntimeHasNoCheckoutDependency,
  buildSecondRelease,
  ensureCurrentHostRelease,
  entryStatus,
  isolateReleaseMcp,
  matrixTargets,
  readReleaseManifest,
  requireBothReleaseManifests,
  runReleaseMcp,
  sha256File
} from './helpers/jobsss-productization.mjs';

function hashedCore(pluginRoot) {
  return {
    plugin: sha256File(path.join(pluginRoot, 'plugin.json')),
    mcp: sha256File(path.join(pluginRoot, 'mcp.json')),
    skill: sha256File(path.join(pluginRoot, 'skills', 'jobsss', 'SKILL.md')),
    bin: sha256File(path.join(pluginRoot, 'bin', 'jobsss'))
  };
}

test('B30 deterministic portable current-host release layout', { timeout: 180_000 }, async () => {
  const first = await ensureCurrentHostRelease();
  assertPortableReleaseTree(first.pluginRoot);
  const manifest = readReleaseManifest(first.outDir, first.pluginRoot);
  const targets = matrixTargets(manifest.doc);
  assert.ok(targets.length >= 1, `release-manifest.json must list release targets: ${JSON.stringify(manifest.doc)}`);
  const ids = targets.map(entry => String(entry.id || entry.target || entry.name || '').trim());
  for (const required of INTENDED_RELEASE_TARGETS) {
    assert.ok(
      ids.includes(required),
      `release-manifest.json must list intended target ${required} as verified, built, intended, or unverified`
    );
  }
  for (const entry of targets) {
    const id = String(entry.id || entry.target || entry.name || '').trim();
    const status = entryStatus(entry);
    assertHonestStatus(status, `target ${id}`);
    if (id !== 'current-host' && status === 'verified') {
      const platform = String(entry.platform || entry.os || '');
      const arch = String(entry.arch || '');
      const matchesHost = (
        (platform === process.platform || (platform === 'linux' && process.platform === 'linux'))
        && (!arch || arch === process.arch)
      );
      assert.equal(
        matchesHost,
        true,
        `target ${id} must not be labeled verified on this host without a matching platform/arch exercise`
      );
    }
  }
  const current = targets.find(entry => String(entry.id || entry.target || entry.name) === 'current-host');
  assert.ok(current, 'release-manifest.json must include current-host');
  assert.match(entryStatus(current), /^(verified|built)$/, 'current-host must be verified or built after a successful current-host release');

  const second = await buildSecondRelease(first.trap);
  assertPortableReleaseTree(second.pluginRoot);
  assert.deepEqual(
    hashedCore(second.pluginRoot),
    hashedCore(first.pluginRoot),
    'repeated clean current-host releases must be byte-identical for plugin.json, mcp.json, SKILL.md, and bin/jobsss'
  );
  const leaked = listRelFiles(first.pluginRoot).filter(rel => (
    rel.includes('.env') || rel.endsWith('.pem') || rel.includes('node_modules') || rel.startsWith('.git')
  ));
  assert.deepEqual(leaked, [], `release tree contains unjustified files: ${leaked.join(', ')}`);

  const firstManifests = requireBothReleaseManifests(first.outDir, first.pluginRoot);
  const secondManifests = requireBothReleaseManifests(second.outDir, second.pluginRoot);
  assertNoBuildPathLeakage(first);
  assertNoBuildPathLeakage(second);
  assertReleasedRuntimeHasNoCheckoutDependency(first);
  assertReleasedRuntimeHasNoCheckoutDependency(second);
  assertPortableReleaseEvidence(firstManifests.doc, first);
  assertPortableReleaseEvidence(secondManifests.doc, second);
  assertCompleteReleaseDeterminism(first, second);
});

test('B31 released bin/jobsss starts generic stdio MCP with Node and JobOS absent from PATH', { timeout: 180_000 }, async t => {
  const release = await ensureCurrentHostRelease();
  const ctx = isolateReleaseMcp(t, release.pluginRoot, release.trap);
  const session = await runReleaseMcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'doctor', {}),
    callRequest(4, 'start', {})
  ]);
  requireOk(session, 3, 'released doctor');
  requireOk(session, 4, 'released start');
  const init = session.frames.find(frame => frame.id === 1);
  assert.ok(init?.result, `released MCP initialize failed: ${JSON.stringify(init || session.stderr)}`);
  const names = session.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [];
  for (const tool of ['doctor', 'start', 'create_profile', 'import_job', 'list_jobs']) {
    assert.ok(names.includes(tool), `released tools/list missing ${tool}`);
  }
  assertNoNodeUse(ctx.trap);
  assert.equal(existsSync(ctx.trap.marker), false, 'released runtime must not execute the jobos PATH trap');
  assert.deepEqual(listRelFiles(ctx.trap.jobosHome), [], 'JOBOS_HOME must remain unused');
  assert.deepEqual(
    listRelFiles(release.pluginRoot),
    ctx.pluginBefore,
    'released MCP must not write into the release plugin tree'
  );
});

test('B32 released MCP persists only under temp PLUGIN_DATA and survives restart', { timeout: 180_000 }, async t => {
  const release = await ensureCurrentHostRelease();
  const ctx = isolateReleaseMcp(t, release.pluginRoot, release.trap);
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const setup = await runReleaseMcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Release Persist', resumePath, path: resumePath })
  ], { timeoutMs: 45_000 });
  requireOk(setup, 2, 'released start');
  const profileId = pickId(requireOk(setup, 3, 'released create_profile'), ['profileId', 'id']);
  const imported = await runReleaseMcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'released import_job'), ['jobId', 'id']);
  const restarted = await runReleaseMcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_jobs', { profileId })
  ]);
  const listed = requireOk(restarted, 2, 'released list_jobs after restart');
  const jobs = listed.jobs || listed.items || [];
  assert.ok(
    jobs.some(job => pickId(job, ['jobId', 'id']) === jobId),
    `released restart must list imported job ${jobId}: ${JSON.stringify(listed).slice(0, 500)}`
  );
  assert.equal(existsSync(path.join(ctx.dataDir, 'store.json')), true, 'PLUGIN_DATA/store.json must exist');
  assert.equal(lstatSync(path.join(ctx.dataDir, 'store.json')).isFile(), true);
  const createdInRelease = listRelFiles(release.pluginRoot).filter(rel => !ctx.pluginBefore.includes(rel));
  assert.deepEqual(createdInRelease, [], `user state leaked into release tree: ${createdInRelease.join(', ')}`);
  assertNoNodeUse(ctx.trap);
  assert.equal(existsSync(ctx.trap.marker), false, 'released runtime must not execute jobos');
  const stray = parseToolValue(restarted.frames.find(frame => frame.id === 2));
  assert.doesNotMatch(JSON.stringify(stray || {}), /\b(submitted|sent|applied|approved)\b/);
});
