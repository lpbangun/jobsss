import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PRODUCTIZATION_REVIEW_REL,
  PRODUCTIZATION_REVIEW_RULES,
  RELEASE_REPORT_REL,
  RELEASE_REPORT_RULES,
  REQUIRED_PACKAGING_TARGETS,
  SEA_FIXTURE_BLOB,
  PACKAGING_MODULE_REL,
  assertCanonicalTargetLayout,
  assertDocumentRules,
  assertMismatchThrown,
  assertNativeSeaInjection,
  assertNoInjectionInProductBehavior,
  assertPackagingSeparatedFromProduct,
  assertPackagingTargetsDeclared,
  assertUnverifiedTarget,
  extractSeaBlob,
  getPackagingApi,
  hostMatchesTarget,
  identifyExecutable,
  launcherPath,
  loadPackagingModule,
  makeFixture,
  packagingModulePath,
  readRepoFile,
  readSeaFuse,
  resolveTargetPluginRoot,
  targetEntry
} from './helpers/jobsss-cross-platform.mjs';
import { isolate } from './helpers/jobsss-live-mcp.mjs';
import {
  builderEnv,
  readReleaseManifest,
  runRepoJobsss
} from './helpers/jobsss-productization.mjs';

function blobFor(targetId) {
  return Buffer.concat([SEA_FIXTURE_BLOB, Buffer.from(`\n${targetId}\n`)]);
}

async function packagingApi() {
  const mod = await loadPackagingModule();
  return { mod, api: getPackagingApi(mod) };
}

test('B42 inspectable executable ELF Mach-O PE build definitions separated from product behavior', async () => {
  const abs = packagingModulePath();
  assert.equal(existsSync(abs), true, `missing required product file ${PACKAGING_MODULE_REL}`);
  const src = readRepoFile(PACKAGING_MODULE_REL);
  assertPackagingSeparatedFromProduct(src);
  assertNoInjectionInProductBehavior();
  const { mod, api } = await packagingApi();
  assertPackagingTargetsDeclared(mod);
  for (const target of REQUIRED_PACKAGING_TARGETS) {
    const fixture = makeFixture(target.format, target.arch);
    const ident = api.identifyExecutable(fixture);
    assert.equal(ident.format, target.format, `${target.id} definition must identify ${target.format}`);
    assert.equal(ident.arch, target.arch, `${target.id} definition must identify ${target.arch}`);
  }
});

test('B43 format/architecture validation and native SEA container injection contract', async () => {
  const { api } = await packagingApi();
  for (const target of REQUIRED_PACKAGING_TARGETS) {
    const executable = makeFixture(target.format, target.arch);
    const oracle = identifyExecutable(executable);
    assert.deepEqual(
      { format: oracle.format, arch: oracle.arch },
      { format: target.format, arch: target.arch },
      `synthetic ${target.id} fixture must be a ${target.format}/${target.arch} executable`
    );
    const identified = api.identifyExecutable(executable);
    assert.equal(identified.format, target.format, `${PACKAGING_MODULE_REL} must validate ${target.id} as ${target.format}`);
    assert.equal(identified.arch, target.arch, `${PACKAGING_MODULE_REL} must validate ${target.id} as ${target.arch}`);
    const blob = blobFor(target.id);
    const injected = api.injectSeaPayload({ target: target.id, executable, blob });
    assertNativeSeaInjection(injected, {
      format: target.format,
      arch: target.arch,
      blob,
      target: target.id
    });
    assert.equal(
      extractSeaBlob(executable),
      null,
      `uninjected ${target.format} fixture must not already contain ${target.id} SEA payload`
    );
    assert.equal(readSeaFuse(executable).enabled, false, `uninjected ${target.id} fixture fuse must start at :0`);
  }

  const elfX64 = makeFixture('elf', 'x64');
  const machoArm = makeFixture('macho', 'arm64');
  const peX64 = makeFixture('pe', 'x64');
  const blob = blobFor('mismatch');
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'linux-x64', executable: machoArm, blob }),
    'ELF linux-x64 injector + Mach-O input'
  );
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'darwin-arm64', executable: elfX64, blob }),
    'Mach-O darwin-arm64 injector + ELF input'
  );
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'darwin-arm64', executable: makeFixture('macho', 'x64'), blob }),
    'darwin-arm64 injector + darwin-x64 Mach-O'
  );
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'win-x64', executable: elfX64, blob }),
    'PE win-x64 injector + ELF input'
  );
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'linux-arm64', executable: elfX64, blob }),
    'linux-arm64 injector + linux-x64 ELF'
  );
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'win-x64', executable: peX64.subarray(0, 8), blob }),
    'PE injector + truncated garbage'
  );
  assertMismatchThrown(
    () => api.injectSeaPayload({ target: 'solaris-x64', executable: elfX64, blob }),
    'unsupported target solaris-x64'
  );
});

test('B44 deterministic repeatability and canonical target release layout', { timeout: 60_000 }, async t => {
  const { api } = await packagingApi();
  for (const target of REQUIRED_PACKAGING_TARGETS) {
    const executable = makeFixture(target.format, target.arch);
    const blob = blobFor(`repeat-${target.id}`);
    const first = api.injectSeaPayload({ target: target.id, executable, blob });
    const second = api.injectSeaPayload({ target: target.id, executable, blob });
    assert.equal(
      Buffer.from(first).equals(Buffer.from(second)),
      true,
      `${target.id} SEA injection must be byte-identical for identical inputs`
    );
    assertNativeSeaInjection(first, {
      format: target.format,
      arch: target.arch,
      blob,
      target: target.id
    });
  }

  const ctx = isolate(t, 'jobsss-xplat-layout');
  const target = REQUIRED_PACKAGING_TARGETS.find(entry => entry.id === 'darwin-arm64');
  const parent = mkdtempSync(path.join(tmpdir(), 'jobsss-xplat-out-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const base = path.join(parent, 'darwin-arm64-node');
  const outA = path.join(parent, 'out-a');
  const outB = path.join(parent, 'out-b');
  writeFileSync(base, makeFixture(target.format, target.arch));
  const env = builderEnv(ctx.trap);
  const first = await runRepoJobsss(
    ['release', '--out', outA, '--target', 'darwin-arm64', '--node-binary', base],
    env,
    { timeoutMs: 45_000 }
  );
  const second = await runRepoJobsss(
    ['release', '--out', outB, '--target', 'darwin-arm64', '--node-binary', base],
    env,
    { timeoutMs: 45_000 }
  );
  assert.equal(
    first.code,
    0,
    `./bin/jobsss release --target darwin-arm64 --node-binary <synthetic Mach-O> must exit 0 (got ${first.code}): stdout=${first.stdout.slice(0, 400)} stderr=${first.stderr.slice(0, 400)}`
  );
  assert.equal(second.code, 0, `repeated darwin-arm64 fixture release must exit 0 (got ${second.code}): ${second.stderr.slice(0, 400)}`);
  const pluginA = resolveTargetPluginRoot(outA, 'darwin-arm64');
  const pluginB = resolveTargetPluginRoot(outB, 'darwin-arm64');
  assert.ok(pluginA, 'darwin-arm64 release must write the canonical portable plugin layout');
  assert.ok(pluginB, 'repeated darwin-arm64 release must write the canonical portable plugin layout');
  assertCanonicalTargetLayout(pluginA);
  assertCanonicalTargetLayout(pluginB);
  const binA = readFileSync(launcherPath(pluginA));
  const binB = readFileSync(launcherPath(pluginB));
  assert.equal(binA.equals(binB), true, 'repeated darwin-arm64 fixture releases must be byte-identical for bin/jobsss');
  const ident = identifyExecutable(binA);
  assert.equal(ident.format, 'macho', 'darwin-arm64 released launcher must be Mach-O');
  assert.equal(ident.arch, 'arm64', 'darwin-arm64 released launcher must be arm64');
});

test('B45 truthful unverified labels; synthetic fixtures never attest platform runtime support', { timeout: 60_000 }, async t => {
  const { api } = await packagingApi();
  const ctx = isolate(t, 'jobsss-xplat-labels');
  const parent = mkdtempSync(path.join(tmpdir(), 'jobsss-xplat-labels-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const env = builderEnv(ctx.trap);

  const missingHost = await runRepoJobsss(
    ['release', '--out', path.join(parent, 'missing-darwin'), '--target', 'darwin-arm64'],
    env,
    { timeoutMs: 20_000 }
  );
  assert.notEqual(missingHost.code, 0, 'darwin-arm64 without a matching --node-binary must fail clearly on a non-darwin host');
  assert.match(
    `${missingHost.stdout}\n${missingHost.stderr}`,
    /\b(unverified|unsupported|unavailable|mismatch|missing)\b/i,
    `darwin-arm64 unavailable-host failure must be explicit: stdout=${missingHost.stdout.slice(0, 300)} stderr=${missingHost.stderr.slice(0, 300)}`
  );

  const macho = path.join(parent, 'macho-arm64');
  const elf = path.join(parent, 'elf-x64');
  writeFileSync(macho, makeFixture('macho', 'arm64'));
  writeFileSync(elf, makeFixture('elf', 'x64'));
  const mismatched = await runRepoJobsss(
    ['release', '--out', path.join(parent, 'mismatch'), '--target', 'linux-x64', '--node-binary', macho],
    env,
    { timeoutMs: 20_000 }
  );
  assert.notEqual(mismatched.code, 0, 'linux-x64 must reject a Mach-O --node-binary');
  assert.match(
    `${mismatched.stdout}\n${mismatched.stderr}`,
    /\b(mismatch|mismatched|unsupported|invalid|unrecognized)\b/i,
    `mismatched --node-binary failure must name the format/architecture problem: ${mismatched.stderr.slice(0, 400)}`
  );

  const darwinOut = path.join(parent, 'darwin-out');
  mkdirSync(darwinOut, { recursive: true });
  const darwinRel = await runRepoJobsss(
    ['release', '--out', darwinOut, '--target', 'darwin-arm64', '--node-binary', macho],
    env,
    { timeoutMs: 45_000 }
  );
  assert.equal(
    darwinRel.code,
    0,
    `fixture-level darwin-arm64 definition must be executable (got ${darwinRel.code}): ${darwinRel.stderr.slice(0, 400)}`
  );
  const darwinRoot = resolveTargetPluginRoot(darwinOut, 'darwin-arm64');
  assert.ok(darwinRoot, 'darwin-arm64 fixture release must produce the canonical layout');
  const darwinManifest = readReleaseManifest(darwinOut, darwinRoot);
  assertUnverifiedTarget(
    darwinManifest.doc,
    'darwin-arm64',
    'on this host and when the definition is exercised only with a synthetic Mach-O fixture'
  );
  if (targetEntry(darwinManifest.doc, 'win-x64')) {
    assertUnverifiedTarget(darwinManifest.doc, 'win-x64', 'unless exercised on a real matching Windows host');
  }

  const winOut = path.join(parent, 'win-out');
  const pe = path.join(parent, 'pe-x64');
  writeFileSync(pe, makeFixture('pe', 'x64'));
  const winRel = await runRepoJobsss(
    ['release', '--out', winOut, '--target', 'win-x64', '--node-binary', pe],
    env,
    { timeoutMs: 45_000 }
  );
  assert.equal(winRel.code, 0, `fixture-level win-x64 definition must be executable (got ${winRel.code}): ${winRel.stderr.slice(0, 400)}`);
  const winRoot = resolveTargetPluginRoot(winOut, 'win-x64');
  assert.ok(winRoot, 'win-x64 fixture release must produce the canonical layout');
  assertCanonicalTargetLayout(winRoot, { windows: true });
  const winManifest = readReleaseManifest(winOut, winRoot);
  assertUnverifiedTarget(
    winManifest.doc,
    'win-x64',
    'on this host and when the definition is exercised only with a synthetic PE fixture'
  );

  for (const target of REQUIRED_PACKAGING_TARGETS) {
    if (hostMatchesTarget(target)) continue;
    const blob = blobFor(`label-${target.id}`);
    const injected = api.injectSeaPayload({
      target: target.id,
      executable: makeFixture(target.format, target.arch),
      blob
    });
    assertNativeSeaInjection(injected, {
      format: target.format,
      arch: target.arch,
      blob,
      target: target.id
    });
  }
});

test('B46 PRODUCTIZATION_REVIEW.md contains every revised-goal section', () => {
  assertDocumentRules(PRODUCTIZATION_REVIEW_REL, PRODUCTIZATION_REVIEW_RULES);
});

test('B47 RELEASE_REPORT.md contains every revised-goal section and identity rule', () => {
  assertDocumentRules(RELEASE_REPORT_REL, RELEASE_REPORT_RULES);
});

