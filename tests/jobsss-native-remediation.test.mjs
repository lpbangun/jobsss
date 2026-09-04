import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { pluginPath, REPO_ROOT, readRequired } from './helpers/jobsss-gate0.mjs';
import { isolate, listRelFiles } from './helpers/jobsss-live-mcp.mjs';
import {
  CHECKSUM_FAIL_RE,
  OFFICIAL_NODE_INPUTS,
  PACKAGING_LOCK_REL,
  POSTJECT_PIN,
  assertChecksum,
  assertNoCommittedLargeArtifacts,
  assertPackagingLockSchema,
  ensureOfficialExecutable,
  readPackagingLock,
  sha256
} from './helpers/jobsss-native-inputs.mjs';
import {
  VALIDATOR_PINS,
  assertLockPinsIndependentValidators,
  assertValidatorChecksumRejectsDrift,
  inspectNativeWithPinnedValidators,
  writeTempBinary
} from './helpers/jobsss-native-validators.mjs';
import { builderEnv, resolveReleasePluginRoot, runRepoJobsss } from './helpers/jobsss-productization.mjs';
import {
  INDEPENDENT_BLOB,
  assertElfInjectionInvariants,
  assertMachoInjectionInvariants,
  assertPeInjectionInvariants,
  identifyExecutableIndependent,
  makeIndependentMacho,
  makeIndependentPe,
  parseMachoIndependent,
  parsePeIndependent
} from './helpers/jobsss-native-format.mjs';

const PACKAGING_REL = 'src/packaging.js';
const FROZEN_TEST_FILES = Object.freeze([
  'tests/jobsss-gate0.test.mjs',
  'tests/jobsss-mcp-compat.test.mjs',
  'tests/jobsss-journey.test.mjs',
  'tests/jobsss-persistence.test.mjs',
  'tests/jobsss-discovery.test.mjs',
  'tests/jobsss-workflows.test.mjs',
  'tests/jobsss-integrity.test.mjs',
  'tests/jobsss-release.test.mjs',
  'tests/jobsss-adapters.test.mjs',
  'tests/jobsss-authority.test.mjs',
  'tests/jobsss-cross-platform.test.mjs',
  'tests/jobsss-native-remediation.test.mjs',
  'tests/jobsss-native-evidence.test.mjs'
]);
const INTERMEDIATE_SHAS = Object.freeze([
  'ba2123ef5f6f24bcf6ae994a125b67501b970785',
  '8b2db255e7868397d336f8b015c489552b84bf0e'
]);

function blobFor(label) {
  return Buffer.concat([INDEPENDENT_BLOB, Buffer.from(`\n${label}\n`)]);
}

function countFrozenTests() {
  let count = 0;
  for (const rel of FROZEN_TEST_FILES) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    count += [...text.matchAll(/^\s*test\(/gm)].length;
  }
  return count;
}

async function loadPackaging() {
  const abs = pluginPath(PACKAGING_REL);
  assert.equal(existsSync(abs), true, `missing required product file ${PACKAGING_REL}`);
  return import(pathToFileURL(abs).href);
}

function injectOrThrow(api, args, label) {
  assert.equal(typeof api.injectSeaPayload === 'function', true, `${PACKAGING_REL} must export injectSeaPayload`);
  return api.injectSeaPayload(args);
}

function srcFiles() {
  return ['src/packaging.js', 'src/sea-build.js', 'src/release.js']
    .filter(rel => existsSync(pluginPath(rel)))
    .map(rel => ({ rel, text: readFileSync(pluginPath(rel), 'utf8') }));
}

test('B48 checked-in small lock manifest pins official URLs/versions/SHA256/tool identity and rejects checksum drift', async () => {
  const { abs, doc } = readPackagingLock();
  assert.equal(path.basename(abs), 'packaging.lock.json');
  assertPackagingLockSchema(doc);

  const sources = srcFiles();
  assert.ok(
    sources.some(entry => entry.text.includes('packaging.lock.json')),
    'build definitions must consult src/packaging.lock.json rather than silently installing latest tooling'
  );
  assert.ok(
    sources.some(entry => /sha256|createHash\(\s*['"]sha256['"]\s*\)/i.test(entry.text)),
    'build definitions must verify pinned SHA-256 checksums before injection'
  );

  const mod = await loadPackaging();
  const verify = mod.verifyPinnedChecksum || mod.assertPinnedChecksum || mod.verifyChecksum;
  assert.equal(
    typeof verify === 'function',
    true,
    `${PACKAGING_REL} must export verifyPinnedChecksum(bytes, sha256) so mismatched downloads/tools fail before injection`
  );
  const good = Buffer.from('jobsss-pinned-checksum-probe');
  const digest = sha256(good);
  verify(good, digest);
  let mismatch;
  try {
    verify(Buffer.from('jobsss-pinned-checksum-corrupt'), digest);
  } catch (err) {
    mismatch = err;
  }
  assert.ok(mismatch, 'verifyPinnedChecksum must throw on a corrupt or mismatched digest');
  assert.match(
    String(mismatch.message || mismatch),
    CHECKSUM_FAIL_RE,
    `checksum rejection must name checksum/sha256/mismatch: ${mismatch.message || mismatch}`
  );
});

test('B49 ad hoc Mach-O/PE mutators are removed and injection uses pinned Node-supported tooling', async () => {
  const packaging = readFileSync(pluginPath(PACKAGING_REL), 'utf8');
  assert.equal(
    /function\s+injectMacho\s*\(/.test(packaging),
    false,
    'ad hoc injectMacho mutator must be removed or disabled; do not patch its malformed-output defects'
  );
  assert.equal(
    /function\s+injectPe\s*\(/.test(packaging),
    false,
    'ad hoc injectPe mutator must be removed or disabled; do not patch its malformed-output defects'
  );
  assert.equal(
    /writeU64\(\s*out\s*,\s*newCmdOff\s*\+\s*32\s*,\s*0\s*\)/.test(packaging),
    false,
    'Mach-O injector must not emit a NODE_SEA segment with vmsize 0'
  );
  assert.equal(
    /padName\(\s*['"]\.rsrc['"]/.test(packaging),
    false,
    'PE injector must not ad hoc-append a .rsrc section header as the SEA container'
  );
  const combined = srcFiles().map(entry => entry.text).join('\n');
  assert.match(
    combined,
    /postject/i,
    'inspectable build definitions must invoke pinned Node-supported SEA injection tooling (postject)'
  );
  assert.match(
    combined,
    /macho-segment-name|NODE_SEA/,
    'pinned Mach-O injection must use the documented NODE_SEA segment option'
  );
  const { doc } = readPackagingLock();
  assertPackagingLockSchema(doc);
  assert.equal(POSTJECT_PIN.buildOnly, true);
});

test('B50 genuine official Node Mach-O injection preserves load-command/linkedit/code-signature offsets and SEA VM sizing', { timeout: 180_000 }, async () => {
  const helperSrc = readFileSync(pluginPath('tests/helpers/jobsss-native-format.mjs'), 'utf8');
  assert.doesNotMatch(helperSrc, /from\s+['"]\.\.\/\.\.\/src\/packaging\.js['"]/, 'independent validator must not import the production packaging parser');
  assert.doesNotMatch(helperSrc, /makeMachoFixture|makePeFixture/, 'independent validator must not reuse the synthetic-fixture generator');

  const api = await loadPackaging();
  for (const id of ['darwin-arm64', 'darwin-x64']) {
    const official = ensureOfficialExecutable(id);
    const ident = identifyExecutableIndependent(official.bytes);
    assert.equal(ident.format, 'macho', `${id} official Node must be Mach-O`);
    assert.equal(ident.arch, official.arch);
    const parsed = parseMachoIndependent(official.bytes);
    assert.ok(parsed.commands.some(cmd => cmd.name === 'LC_SYMTAB'), `${id} official Node must expose LC_SYMTAB for offset checks`);
    assert.ok(parsed.commands.some(cmd => String(cmd.name || '').includes('DYLD_INFO')), `${id} official Node must expose dyld-info commands`);
    assert.ok(parsed.commands.some(cmd => cmd.name === 'LC_CODE_SIGNATURE'), `${id} official Node must expose LC_CODE_SIGNATURE`);
    assert.ok(parsed.commands.some(cmd => cmd.name === '__LINKEDIT'), `${id} official Node must expose __LINKEDIT`);
    const blob = blobFor(`official-${id}`);
    const injected = injectOrThrow(api, { target: official.target, executable: official.bytes, blob }, id);
    assertMachoInjectionInvariants(official.bytes, injected, { blob, target: id });
  }

  const rich = makeIndependentMacho({ arch: 'arm64' });
  identifyExecutableIndependent(rich);
  const richBlob = blobFor('rich-macho');
  const richInjected = injectOrThrow(api, { target: 'darwin-arm64', executable: rich, blob: richBlob }, 'rich Mach-O');
  // Synthetic rich Mach-O proves signature-removal + NODE_SEA VM sizing against a
  // pre-existing LC_CODE_SIGNATURE/__LINKEDIT image. LIEF may rewrite invalid
  // synthetic dyld blobs; relocated-content offset audit is required on official Node.
  assertMachoInjectionInvariants(rich, richInjected, {
    blob: richBlob,
    target: 'darwin-arm64-rich',
    requireRelocatedContent: false
  });
});

test('B51 genuine official Node PE injection preserves SizeOfImage, section-header space/alignment, and resources', { timeout: 180_000 }, async () => {
  const api = await loadPackaging();

  const official = ensureOfficialExecutable('win-x64');
  const ident = identifyExecutableIndependent(official.bytes);
  assert.equal(ident.format, 'pe');
  assert.equal(ident.arch, 'x64');
  const before = parsePeIndependent(official.bytes);
  assert.ok(before.overlay.length > 0, 'official node.exe must carry an Authenticode certificate overlay before injection');
  assert.ok(before.security && before.security.size > 0, 'official node.exe must expose a Security certificate table');
  assert.equal(before.overlay.length, before.security.size, 'official node.exe overlay must be the Authenticode certificate table');
  assert.ok(before.resSize > 0, 'official node.exe must have a resource directory so resource integrity is observable');
  const officialBlob = blobFor('official-win-x64');
  const officialInjected = injectOrThrow(api, { target: 'win-x64', executable: official.bytes, blob: officialBlob }, 'win-x64');
  assertPeInjectionInvariants(official.bytes, officialInjected, { blob: officialBlob, target: 'win-x64' });

  const officialParsed = parsePeIndependent(officialInjected);
  assert.equal(officialParsed.fileAlignment, before.fileAlignment, 'injected official PE must preserve source FileAlignment');
  assert.equal(officialParsed.sectionAlignment, before.sectionAlignment, 'injected official PE must preserve source SectionAlignment');
  assert.equal(officialParsed.fileAlignment, 0x200);
  assert.equal(officialParsed.sectionAlignment, 0x1000);
  assert.equal(officialParsed.security.fileOffset, 0, 'injected official PE Security directory file offset must be 0');
  assert.equal(officialParsed.security.size, 0, 'injected official PE must not retain a Security certificate table');
  assert.equal(
    officialParsed.overlay.equals(before.overlay),
    false,
    'injected official PE must not restore the pre-injection Authenticode certificate overlay'
  );

  const tightPe = makeIndependentPe({
    fileAlignment: 0x200,
    sectionAlignment: 0x1000,
    overlay: Buffer.alloc(0),
    tightHeaders: true
  });
  const tightBefore = parsePeIndependent(tightPe);
  assert.ok(
    tightBefore.sizeOfHeaders - tightBefore.sectionTableEnd < 40,
    'tight-header PE fixture must leave fewer than 40 bytes of section-header space'
  );
  const tightBlob = blobFor('pe-tight');
  const tightInjected = injectOrThrow(api, { target: 'win-x64', executable: tightPe, blob: tightBlob }, 'tight PE');
  assertPeInjectionInvariants(tightPe, tightInjected, { blob: tightBlob, target: 'win-x64-section-headers' });
});

test('B52 runtime stays dependency-free; official Node/tool caches stay uncommitted; fixtures never attest platform verification', { timeout: 180_000 }, async () => {
  assertNoCommittedLargeArtifacts(REPO_ROOT);
  assert.equal(existsSync(pluginPath('package.json')), false, 'runtime must not gain an npm package.json dependency');
  const mcp = JSON.parse(readRequired('mcp.json'));
  assert.deepEqual(Object.keys(mcp), ['$schema', 'mcpServers']);
  const server = mcp.mcpServers.jobsss;
  assert.deepEqual(server, {
    type: 'stdio',
    command: './bin/jobsss',
    args: ['mcp', '--data', '${PLUGIN_DATA}']
  });

  const api = await loadPackaging();
  for (const id of ['linux-x64', 'linux-arm64']) {
    const official = ensureOfficialExecutable(id);
    const ident = identifyExecutableIndependent(official.bytes);
    assert.equal(ident.format, 'elf');
    assert.equal(ident.arch, official.arch);
    const blob = blobFor(`official-${id}`);
    const injected = injectOrThrow(api, { target: official.target, executable: official.bytes, blob }, id);
    assertElfInjectionInvariants(official.bytes, injected, { blob, target: id });
  }

  const review = readFileSync(pluginPath('PRODUCTIZATION_REVIEW.md'), 'utf8');
  const report = readFileSync(pluginPath('RELEASE_REPORT.md'), 'utf8');
  for (const [rel, text] of [['PRODUCTIZATION_REVIEW.md', review], ['RELEASE_REPORT.md', report]]) {
    assert.doesNotMatch(
      text,
      /darwin-(arm64|x64)[^\n]{0,80}\bverified\b(?![^\n]*unverified)/i,
      `${rel} must not present macOS fixture/cross-build success as platform verification`
    );
    assert.doesNotMatch(
      text,
      /win-x64[^\n]{0,80}\bverified\b(?![^\n]*unverified)/i,
      `${rel} must not present Windows fixture/cross-build success as platform verification`
    );
  }
  for (const input of OFFICIAL_NODE_INPUTS) {
    assertChecksum(ensureOfficialExecutable(input.id).bytes, input.executableSha256, input.id);
  }
});

test('B53 both reports are finalized with the actual frozen-command count and PASS before verdict', () => {
  const expected = countFrozenTests();
  assert.ok(expected >= 49, 'frozen suite must still include B1–B47');
  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md']) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    assert.equal(
      /reviewer verdict[^\n]{0,80}pending/i.test(text),
      false,
      `${rel} must not leave the reviewer verdict pending`
    );
    const tests = text.match(/# tests\s+(\d+)/);
    const pass = text.match(/# pass\s+(\d+)/);
    const fail = text.match(/# fail\s+(\d+)/);
    assert.ok(tests, `${rel} must record the actual frozen-command # tests count before PASS`);
    assert.ok(pass, `${rel} must record the actual frozen-command # pass count before PASS`);
    assert.ok(fail, `${rel} must record the actual frozen-command # fail count before PASS`);
    assert.equal(Number(tests[1]), expected, `${rel} # tests must be the live frozen-command count ${expected}, not a stale ${tests[1]}`);
    assert.equal(Number(pass[1]), expected, `${rel} # pass must equal the live frozen-command count ${expected}`);
    assert.equal(Number(fail[1]), 0, `${rel} # fail must be 0 before a PASS verdict`);
    assert.match(text, /\bPASS\b/, `${rel} must contain the actual PASS verdict`);
    assert.match(text, /independent native/i, `${rel} must record independent native-format validation`);
    assert.match(text, /checksum-pinned official Node|official Node/i, `${rel} must record genuine official Node inputs`);
    assert.match(text, /LC_SYMTAB|linkedit|code-signature/i, `${rel} must record Mach-O load-command/linkedit/code-signature evidence`);
    assert.match(text, /SizeOfImage/, `${rel} must record PE SizeOfImage evidence`);
    assert.match(text, /postject|packaging\.lock\.json/i, `${rel} must record pinned injection-tool identity`);
    for (const sha of INTERMEDIATE_SHAS) {
      assert.ok(text.includes(sha), `${rel} must keep intermediate commit identity ${sha}`);
    }
    assert.match(
      text,
      /final corrective SHA is supplied in the final response/i,
      `${rel} must state that the final corrective SHA is supplied in the final response`
    );
  }
});

function pluginTreeWithoutScratch() {
  return listRelFiles(REPO_ROOT).filter(rel => !rel.startsWith('.tmp/') && !rel.startsWith('tmp/'));
}

test('B54 empty-cache pinned postject acquisition and current-host release succeed without plugin-tree writes', { timeout: 180_000 }, async t => {
  const ctx = isolate(t, 'jobsss-empty-native-cache');
  const cache = path.join(ctx.parent, 'empty-native-cache');
  mkdirSync(cache, { recursive: true });
  assert.deepEqual(readdirSync(cache), [], 'B54 JOBSSS_NATIVE_CACHE must start empty');
  const outDir = path.join(ctx.parent, 'out');
  mkdirSync(outDir, { recursive: true });

  const pluginBefore = pluginTreeWithoutScratch();
  const env = { ...builderEnv(ctx.trap), JOBSSS_NATIVE_CACHE: cache };
  const result = await runRepoJobsss(
    ['release', '--out', outDir, '--target', 'current-host'],
    env,
    { timeoutMs: 180_000 }
  );
  const detail = `stdout=${result.stdout.slice(0, 500)} stderr=${result.stderr.slice(0, 800)}`;
  assert.equal(
    result.code,
    0,
    `empty JOBSSS_NATIVE_CACHE ./bin/jobsss release --target current-host must exit 0 (got ${result.code}): ${detail}`
  );

  const tarball = path.join(cache, `postject-${POSTJECT_PIN.version}.tgz`);
  assert.equal(
    existsSync(tarball),
    true,
    `empty-cache release must download pinned postject ${POSTJECT_PIN.version} into JOBSSS_NATIVE_CACHE`
  );
  assertChecksum(readFileSync(tarball), POSTJECT_PIN.sha256, 'pinned postject tarball');
  assert.equal(
    path.resolve(cache).startsWith(`${path.resolve(REPO_ROOT)}${path.sep}`),
    false,
    'JOBSSS_NATIVE_CACHE must stay outside the plugin tree'
  );

  const pluginAfter = pluginTreeWithoutScratch();
  assert.deepEqual(
    pluginAfter,
    pluginBefore,
    'empty-cache postject acquisition must not write tool caches or release artifacts into the plugin tree'
  );
  assertNoCommittedLargeArtifacts(REPO_ROOT);

  const pluginRoot = resolveReleasePluginRoot(outDir);
  assert.equal(existsSync(path.join(pluginRoot, 'bin', 'jobsss')), true, 'current-host release must write bin/jobsss');
});

function shaTree(root) {
  const files = listRelFiles(root).sort();
  return Object.fromEntries(files.map(rel => [rel, sha256(readFileSync(path.join(root, rel)))]));
}

test('B55 packaging performs no custom PE mutation after the pinned injector', () => {
  const packaging = readFileSync(pluginPath(PACKAGING_REL), 'utf8');
  assert.equal(
    /function\s+restorePeOverlay\s*\(/.test(packaging),
    false,
    'restorePeOverlay must be removed; appending overlay bytes after postject is custom PE mutation'
  );
  assert.equal(
    /Buffer\.concat\(\s*\[\s*Buffer\.from\(\s*injected\s*\)\s*,\s*info\.overlay\s*\]\s*\)/.test(packaging),
    false,
    'packaging must not Buffer.concat the pre-injection overlay onto postject output'
  );
  assert.equal(
    /writeU32\(\s*out\s*,\s*outInfo\.opt\s*\+\s*144/.test(packaging),
    false,
    'packaging must not rewrite the PE Security directory after postject'
  );
  assert.equal(
    /injectSeaPayload[\s\S]*restorePeOverlay\s*\(/.test(packaging),
    false,
    'injectSeaPayload must accept pinned postject output unchanged'
  );
  const combined = srcFiles().map(entry => entry.text).join('\n');
  assert.match(combined, /postject/i, 'native mutation must still go through pinned postject');
});

test('B56 official signed PE becomes unsigned; Authenticode is not restored', { timeout: 180_000 }, async () => {
  const api = await loadPackaging();
  const official = ensureOfficialExecutable('win-x64');
  const before = parsePeIndependent(official.bytes);
  assert.ok(before.security.size > 0, 'official node.exe must be Authenticode-signed before injection');
  assert.equal(before.overlay.length, before.security.size);
  const blob = blobFor('authenticode-strip');
  const injected = injectOrThrow(api, { target: 'win-x64', executable: official.bytes, blob }, 'win-x64-unsigned');
  const after = parsePeIndependent(injected);
  assert.equal(after.security.fileOffset, 0, 'Security directory VirtualAddress/file offset must be 0 after injection');
  assert.equal(after.security.size, 0, 'Security directory size must be 0 after injection');
  assert.equal(
    after.overlay.equals(before.overlay),
    false,
    'pre-injection Authenticode bytes must not be re-appended as a trailing overlay'
  );
  const abs = writeTempBinary(injected, 'injected-win-x64.exe');
  const { doc } = inspectNativeWithPinnedValidators('pe', abs);
  assert.equal(doc.pe.security.fileOffset, 0, 'pefile Security directory file offset must be 0');
  assert.equal(doc.pe.security.size, 0, 'pefile Security directory size must be 0');
  assert.equal(doc.pe.FileAlignment, 0x200);
  assert.equal(doc.pe.SectionAlignment, 0x1000);
  assert.ok(doc.pe.SizeOfImage >= 90009600, `pefile SizeOfImage ${doc.pe.SizeOfImage} must cover the injected image`);
  assert.ok(doc.pe.resources.some(entry => String(entry.name).includes('NODE_SEA_BLOB')), 'pefile must locate RT_RCDATA NODE_SEA_BLOB');
});

test('B57 unsupported non-certificate PE overlay fails before mutation and leaves input untouched', { timeout: 180_000 }, async t => {
  const official = ensureOfficialExecutable('win-x64');
  const extra = Buffer.concat([official.bytes, Buffer.from('NOT_A_CERTIFICATE_OVERLAY')]);
  const ctx = isolate(t, 'jobsss-pe-overlay-reject');
  const cache = path.join(ctx.parent, 'empty-native-cache');
  mkdirSync(cache, { recursive: true });
  const exePath = path.join(ctx.parent, 'node.exe');
  writeFileSync(exePath, extra);
  const beforeHash = sha256(extra);
  const script = [
    'import { readFileSync } from "node:fs";',
    'import { pathToFileURL } from "node:url";',
    `const api = await import(pathToFileURL(${JSON.stringify(pluginPath(PACKAGING_REL))}).href);`,
    `const exe = readFileSync(${JSON.stringify(exePath)});`,
    'const before = Buffer.from(exe);',
    'try {',
    '  api.injectSeaPayload({ target: "win-x64", executable: exe, blob: Buffer.from("JOBSSS_OVERLAY_REJECT_BLOB") });',
    '  console.error("UNEXPECTED_SUCCESS");',
    '  process.exit(7);',
    '} catch (err) {',
    '  const msg = String(err && err.message || err);',
    '  console.error(msg);',
    '  if (!exe.equals(before)) process.exit(8);',
    '  if (!/signing|overlay|certificate|unsupported/i.test(msg)) process.exit(9);',
    '  process.exit(0);',
    '}'
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, JOBSSS_NATIVE_CACHE: cache },
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  });
  const detail = `status=${child.status} stdout=${String(child.stdout || '').slice(0, 400)} stderr=${String(child.stderr || '').slice(0, 800)}`;
  assert.equal(child.status, 0, `unsupported overlay must fail clearly without mutating input: ${detail}`);
  assert.equal(sha256(readFileSync(exePath)), beforeHash, 'unsupported overlay rejection must leave the input executable bytes untouched');
  assert.equal(
    existsSync(path.join(cache, `postject-${POSTJECT_PIN.version}.tgz`)),
    false,
    'unsupported overlay must fail before acquiring or running pinned postject'
  );
});

test('B58 release --node-binary rejects same-format/arch bytes that miss the locked official checksum and accepts each official input', { timeout: 180_000 }, async t => {
  const ctx = isolate(t, 'jobsss-node-binary-checksum');
  const env = builderEnv(ctx.trap);
  const official = ensureOfficialExecutable('linux-x64');
  const mutated = Buffer.from(official.bytes);
  mutated[mutated.length - 1] ^= 0x01;
  assert.notEqual(sha256(mutated), official.executableSha256);
  const ident = identifyExecutableIndependent(mutated);
  assert.equal(ident.format, 'elf');
  assert.equal(ident.arch, 'x64');
  const mutPath = path.join(ctx.parent, 'mutated-linux-x64');
  writeFileSync(mutPath, mutated);
  const mutOut = path.join(ctx.parent, 'mut-out');
  mkdirSync(mutOut, { recursive: true });
  const rejected = await runRepoJobsss(
    ['release', '--out', mutOut, '--target', 'linux-x64', '--node-binary', mutPath],
    env,
    { timeoutMs: 60_000 }
  );
  const rejectText = `${rejected.stdout}\n${rejected.stderr}`;
  assert.notEqual(rejected.code, 0, `mutated same-format/arch --node-binary must fail before injection (got ${rejected.code}): ${rejectText.slice(0, 600)}`);
  assert.match(rejectText, CHECKSUM_FAIL_RE, `checksum rejection must name checksum/sha256/mismatch: ${rejectText.slice(0, 600)}`);
  assert.equal(
    existsSync(path.join(mutOut, 'linux-x64', 'bin', 'jobsss')),
    false,
    'checksum mismatch must not write a release launcher'
  );

  const goodOut = path.join(ctx.parent, 'good-out');
  mkdirSync(goodOut, { recursive: true });
  const accepted = await runRepoJobsss(
    ['release', '--out', goodOut, '--target', 'linux-x64', '--node-binary', official.executablePath],
    env,
    { timeoutMs: 120_000 }
  );
  assert.equal(
    accepted.code,
    0,
    `official locked linux-x64 --node-binary must be accepted (got ${accepted.code}): ${accepted.stderr.slice(0, 600)}`
  );
  assert.equal(existsSync(path.join(goodOut, 'linux-x64', 'bin', 'jobsss')), true);
});

test('B59 independent Mach-O/PE validation uses pinned pefile/macholib/altgraph and records exact JSON', { timeout: 180_000 }, async () => {
  const { doc } = readPackagingLock();
  assertLockPinsIndependentValidators(doc);
  assertValidatorChecksumRejectsDrift();
  for (const pin of VALIDATOR_PINS) {
    assert.equal(pin.buildOnly, true);
  }

  const api = await loadPackaging();
  const macho = ensureOfficialExecutable('darwin-arm64');
  const machoBlob = blobFor('validator-darwin-arm64');
  const machoInjected = injectOrThrow(api, { target: 'darwin-arm64', executable: macho.bytes, blob: machoBlob }, 'validator-macho');
  const machoPath = writeTempBinary(machoInjected, 'injected-darwin-arm64');
  const machoReport = inspectNativeWithPinnedValidators('macho', machoPath);
  assert.equal(machoReport.doc.validators.macholib, '1.16.3');
  assert.equal(machoReport.doc.macho.hasCodeSignature, false, 'macholib must report LC_CODE_SIGNATURE removed');
  assert.ok(machoReport.doc.macho.NODE_SEA, 'macholib must observe NODE_SEA');
  assert.ok(machoReport.doc.macho.NODE_SEA.vmsize >= machoReport.doc.macho.NODE_SEA.filesize);
  assert.ok(machoReport.doc.macho.LINKEDIT, 'macholib must observe __LINKEDIT');
  assert.match(machoReport.text, /"hasCodeSignature":false/);

  const pe = ensureOfficialExecutable('win-x64');
  const peBlob = blobFor('validator-win-x64');
  const peInjected = injectOrThrow(api, { target: 'win-x64', executable: pe.bytes, blob: peBlob }, 'validator-pe');
  const pePath = writeTempBinary(peInjected, 'injected-win-x64.exe');
  const peReport = inspectNativeWithPinnedValidators('pe', pePath);
  assert.equal(peReport.doc.validators.pefile, '2024.8.26');
  assert.equal(peReport.doc.pe.security.fileOffset, 0);
  assert.equal(peReport.doc.pe.security.size, 0);
  assert.match(peReport.text, /"size":0/);
  assert.ok(peReport.doc.pe.resources.some(entry => String(entry.name).includes('NODE_SEA_BLOB')));
});

test('B60 two fresh-process complete release builds for every official Node target are byte-identical', { timeout: 600_000 }, async t => {
  const ctx = isolate(t, 'jobsss-official-double-release');
  const env = builderEnv(ctx.trap);
  for (const input of OFFICIAL_NODE_INPUTS) {
    const official = ensureOfficialExecutable(input.id);
    const outA = path.join(ctx.parent, `${input.id}-a`);
    const outB = path.join(ctx.parent, `${input.id}-b`);
    mkdirSync(outA, { recursive: true });
    mkdirSync(outB, { recursive: true });
    const first = await runRepoJobsss(
      ['release', '--out', outA, '--target', input.target, '--node-binary', official.executablePath],
      env,
      { timeoutMs: 180_000 }
    );
    const second = await runRepoJobsss(
      ['release', '--out', outB, '--target', input.target, '--node-binary', official.executablePath],
      env,
      { timeoutMs: 180_000 }
    );
    const detail = `${input.id} a=${first.code} ${first.stderr.slice(0, 300)} b=${second.code} ${second.stderr.slice(0, 300)}`;
    assert.equal(first.code, 0, `first official ${input.id} release must exit 0: ${detail}`);
    assert.equal(second.code, 0, `second official ${input.id} release must exit 0: ${detail}`);
    const treeA = shaTree(outA);
    const treeB = shaTree(outB);
    assert.deepEqual(treeA, treeB, `complete ${input.id} release trees must be byte-identical across separate processes`);
    assert.ok(Object.keys(treeA).length > 5, `${input.id} release tree must contain the portable plugin layout`);
  }
});

const PUBLISHED_BASE_SHA = '803135995782e36cbf9427ac903a2e26d2952383';
const CANONICAL_CASES = Object.freeze([
  'darwin-x64',
  'darwin-arm64',
  'win-x64-before',
  'win-x64-after'
]);
const MACH_O_LINKEDIT_FIELDS = Object.freeze([
  'symtab',
  'dysymtab',
  'exports',
  'chainedFixups',
  'functionStarts',
  'dataInCode'
]);

function assertPinnedValidatorOrchestrationIndependent() {
  const helperSrc = readFileSync(pluginPath('tests/helpers/jobsss-native-validators.mjs'), 'utf8');
  assert.equal(
    helperSrc.includes('src/packaging.js') || helperSrc.includes('../src/'),
    false,
    'pinned validator orchestration must not import JobSSS production modules'
  );
  assert.doesNotMatch(
    helperSrc,
    /jobsss-native-format|makeIndependentMacho|makeIndependentPe|parseMachoIndependent|parsePeIndependent|makeMachoFixture|makePeFixture/,
    'pinned validator orchestration must not reuse the in-repo parser or synthetic-fixture generator'
  );
}

function assertCanonicalMachoValidatorDoc(doc, { target, arch, blob, before }) {
  assert.equal(doc.case, target, `canonical Mach-O JSON case must be ${target}`);
  assert.equal(doc.format, 'macho');
  assert.equal(doc.arch, arch);
  assert.equal(typeof doc.sha256, 'string');
  assert.match(String(doc.sha256), /^[a-f0-9]{64}$/);
  assert.equal(doc.validators && doc.validators.macholib, '1.16.3');
  const macho = doc.macho;
  assert.ok(macho && typeof macho === 'object', 'canonical JSON must include a macho object');
  assert.equal(macho.hasCodeSignature, false, `${target} must not retain LC_CODE_SIGNATURE`);
  assert.ok(macho.NODE_SEA, `${target} must record NODE_SEA segment`);
  assert.ok(macho.NODE_SEA_BLOB, `${target} must record NODE_SEA_BLOB section`);
  assert.equal(Number(macho.payloadLength), blob.length, `${target} payloadLength must equal injected blob length`);
  assert.equal(String(macho.payloadSha256), sha256(blob), `${target} payloadSha256 must equal injected blob SHA-256`);
  assert.equal(macho.fuse && macho.fuse.present, true, `${target} fuse token must be present`);
  assert.equal(macho.fuse && macho.fuse.enabled, true, `${target} fuse must be enabled (:1)`);
  assert.equal(macho.fileOffsetCommandsInBounds, true, `${target} every file-offset-bearing load command must be in bounds`);
  assert.equal(macho.segmentsNonOverlapping, true, `${target} segments must be non-overlapping`);
  assert.equal(macho.segmentsAligned, true, `${target} segments must be aligned`);
  assert.ok(macho.LINKEDIT, `${target} must record __LINKEDIT`);
  assert.equal(macho.LINKEDIT.relocated, true, `${target} __LINKEDIT must be recorded as relocated`);
  if (before && before.macho && before.macho.LINKEDIT) {
    assert.ok(
      Number(macho.LINKEDIT.fileoff) > Number(before.macho.LINKEDIT.fileoff),
      `${target} __LINKEDIT fileoff must increase after NODE_SEA insertion`
    );
  }
  assert.ok(macho.symtab, `${target} must record LC_SYMTAB offsets`);
  for (const key of ['symoff', 'nsyms', 'stroff', 'strsize']) {
    assert.equal(typeof macho.symtab[key], 'number', `${target} LC_SYMTAB.${key} must be numeric`);
  }
  if (macho.dysymtab) {
    for (const key of ['indirectsymoff', 'nindirectsyms']) {
      assert.equal(typeof macho.dysymtab[key], 'number', `${target} LC_DYSYMTAB.${key} must be numeric when present`);
    }
  }
  for (const field of MACH_O_LINKEDIT_FIELDS) {
    const rec = macho[field];
    if (!rec || rec.present === false) continue;
    if (rec.dataoff != null) assert.equal(typeof rec.dataoff, 'number', `${target} ${field}.dataoff must be numeric when present`);
    if (rec.datasize != null) assert.equal(typeof rec.datasize, 'number', `${target} ${field}.datasize must be numeric when present`);
  }
}

function resourceKey(entry) {
  return `${entry.type}/${entry.name}/${entry.language}`;
}

function assertCanonicalPeValidatorDoc(doc, { caseId, afterInjection, blob, before }) {
  assert.equal(doc.case, caseId, `canonical PE JSON case must be ${caseId}`);
  assert.equal(doc.format, 'pe');
  assert.equal(doc.arch, 'x64');
  assert.equal(doc.validators && doc.validators.pefile, '2024.8.26');
  const pe = doc.pe;
  assert.ok(pe && typeof pe === 'object', 'canonical JSON must include a pe object');
  assert.equal(pe.FileAlignment, 0x200);
  assert.equal(pe.SectionAlignment, 0x1000);
  assert.ok(Array.isArray(pe.resources), 'canonical PE JSON must include a complete resource inventory');
  assert.ok(pe.resources.length > 0, 'official node.exe must expose resources');
  for (const entry of pe.resources) {
    assert.ok(entry && 'type' in entry && 'name' in entry && 'language' in entry, 'each resource must record type, name, and language');
  }
  assert.equal(pe.sectionRangesInBounds, true, 'all section raw and virtual ranges must be in bounds');
  assert.equal(typeof pe.computedSizeOfImage, 'number', 'canonical PE JSON must include independently computed SizeOfImage');
  assert.equal(pe.computedSizeOfImage, pe.SizeOfImage, 'independently computed SizeOfImage must match the header value');
  if (!afterInjection) {
    assert.ok(pe.security && pe.security.size > 0, 'win-x64-before must record a non-empty Security directory');
    assert.ok(pe.overlaySize > 0, 'win-x64-before must record Authenticode overlay bytes');
    return;
  }
  assert.equal(pe.security.fileOffset, 0, 'win-x64-after Security file offset must be 0');
  assert.equal(pe.security.size, 0, 'win-x64-after Security size must be 0');
  assert.equal(pe.certificateRestored, false, 'win-x64-after must not restore certificate bytes');
  assert.equal(Number(pe.payloadLength), blob.length, 'win-x64-after payloadLength must equal injected blob length');
  assert.equal(String(pe.payloadSha256), sha256(blob), 'win-x64-after payloadSha256 must equal injected blob SHA-256');
  assert.equal(pe.fuse && pe.fuse.present, true, 'win-x64-after fuse token must be present');
  assert.equal(pe.fuse && pe.fuse.enabled, true, 'win-x64-after fuse must be enabled (:1)');
  const beforeKeys = new Set((before.pe.resources || []).map(resourceKey));
  const afterKeys = pe.resources.map(resourceKey);
  for (const key of beforeKeys) {
    assert.ok(afterKeys.includes(key), `original resource ${key} must be preserved`);
  }
  const added = afterKeys.filter(key => !beforeKeys.has(key));
  assert.equal(added.length, 1, 'exactly one resource must be added');
  assert.match(added[0], /NODE_SEA_BLOB/);
}

function extractCanonicalJsonBlock(text, caseId) {
  const marker = `"case":"${caseId}"`;
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const start = text.lastIndexOf('{', idx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

test('B61 pinned macholib independently validates official darwin-x64 and darwin-arm64 with complete canonical JSON', { timeout: 180_000 }, async () => {
  assertPinnedValidatorOrchestrationIndependent();
  const api = await loadPackaging();
  for (const id of ['darwin-x64', 'darwin-arm64']) {
    const official = ensureOfficialExecutable(id);
    const beforePath = writeTempBinary(official.bytes, `official-${id}`);
    const before = inspectNativeWithPinnedValidators('macho', beforePath);
    const blob = blobFor(`canonical-${id}`);
    const injected = injectOrThrow(api, { target: official.target, executable: official.bytes, blob }, id);
    const afterPath = writeTempBinary(injected, `injected-${id}`);
    const after = inspectNativeWithPinnedValidators('macho', afterPath);
    assertCanonicalMachoValidatorDoc(after.doc, {
      target: id,
      arch: official.arch,
      blob,
      before: before.doc
    });
    assert.match(after.text, /"payloadSha256":"[a-f0-9]{64}"/);
    assert.match(after.text, /"hasCodeSignature":false/);
  }
});

test('B62 pinned pefile independently validates official win-x64 before/after with resources, payload/fuse, and computed SizeOfImage', { timeout: 180_000 }, async () => {
  assertPinnedValidatorOrchestrationIndependent();
  const api = await loadPackaging();
  const official = ensureOfficialExecutable('win-x64');
  const beforePath = writeTempBinary(official.bytes, 'official-win-x64.exe');
  const before = inspectNativeWithPinnedValidators('pe', beforePath);
  assertCanonicalPeValidatorDoc(before.doc, { caseId: 'win-x64-before', afterInjection: false });
  const blob = blobFor('canonical-win-x64');
  const injected = injectOrThrow(api, { target: 'win-x64', executable: official.bytes, blob }, 'win-x64');
  const afterPath = writeTempBinary(injected, 'injected-win-x64.exe');
  const after = inspectNativeWithPinnedValidators('pe', afterPath);
  assertCanonicalPeValidatorDoc(after.doc, {
    caseId: 'win-x64-after',
    afterInjection: true,
    blob,
    before: before.doc
  });
  assert.match(after.text, /"payloadSha256":"[a-f0-9]{64}"/);
  assert.match(after.text, /"computedSizeOfImage":/);
});

function loadCanonicalCaseFromReports(rel, text, caseId) {
  const inline = extractCanonicalJsonBlock(text, caseId);
  if (inline) return inline;
  const artifactRel = 'evidence/native-validation.json';
  assert.ok(
    text.includes(artifactRel),
    `${rel} must contain complete canonical JSON for case ${caseId}, or cite ${artifactRel}`
  );
  const abs = pluginPath(artifactRel);
  assert.equal(existsSync(abs), true, `${rel} cites ${artifactRel} but the artifact is missing`);
  const bytes = readFileSync(abs);
  const digest = sha256(bytes);
  assert.ok(text.includes(digest), `${rel} must cite SHA-256 of ${artifactRel} when it does not embed case ${caseId}`);
  const doc = JSON.parse(bytes.toString('utf8'));
  const fromCases = doc.cases && !Array.isArray(doc.cases) ? doc.cases[caseId] : null;
  const fromList = Array.isArray(doc.cases) ? doc.cases.find(item => item && item.case === caseId) : null;
  const block = fromCases || fromList || (doc.case === caseId ? doc : null) || extractCanonicalJsonBlock(bytes.toString('utf8'), caseId);
  assert.ok(block, `${artifactRel} must contain complete canonical JSON for case ${caseId}`);
  return block;
}

test('B63 both reports record complete canonical validator JSON and pinned identities for all four cases', () => {
  const pins = {
    pefile: VALIDATOR_PINS.find(pin => pin.id === 'pefile'),
    macholib: VALIDATOR_PINS.find(pin => pin.id === 'macholib'),
    altgraph: VALIDATOR_PINS.find(pin => pin.id === 'altgraph')
  };
  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md']) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    for (const caseId of CANONICAL_CASES) {
      const block = loadCanonicalCaseFromReports(rel, text, caseId);
      assert.ok(block, `${rel} must contain complete canonical JSON for case ${caseId}, not a prose summary`);
      if (caseId.startsWith('darwin-')) {
        assert.equal(block.format, 'macho');
        assert.ok(block.macho && block.macho.payloadSha256, `${rel} ${caseId} JSON must include payloadSha256`);
        assert.equal(block.macho.hasCodeSignature, false);
      } else {
        assert.equal(block.format, 'pe');
        assert.equal(typeof block.pe.computedSizeOfImage, 'number', `${rel} ${caseId} JSON must include computedSizeOfImage`);
        assert.ok(Array.isArray(block.pe.resources) && block.pe.resources.length > 0, `${rel} ${caseId} JSON must include the resource inventory`);
      }
    }
    assert.match(text, new RegExp(pins.pefile.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, new RegExp(pins.macholib.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(text.includes(pins.pefile.sha256), `${rel} must record pefile wheel SHA-256`);
    assert.ok(text.includes(pins.macholib.sha256), `${rel} must record macholib wheel SHA-256`);
    assert.ok(text.includes(pins.altgraph.sha256), `${rel} must record altgraph wheel SHA-256`);
    assert.match(text, /unsupported non-certificate overlay|non-certificate overlay/i);
  }
});

test('B64 release metadata, published-base identity, and plugin/runtime version stay consistent', async () => {
  const matrix = JSON.parse(readRequired('compat/matrix.json'));
  const winNotes = String(matrix.targets && matrix.targets['win-x64'] && matrix.targets['win-x64'].notes || '');
  assert.doesNotMatch(
    winNotes,
    /Authenticode overlay preserved|overlay preserved as a trailing overlay/i,
    'compat/matrix.json must not claim the original Windows Authenticode overlay is preserved'
  );
  assert.match(
    winNotes,
    /Security directory|unsigned|certificate/i,
    'compat/matrix.json must describe certificate removal and cleared Security directory'
  );

  const plugin = JSON.parse(readRequired('plugin.json'));
  assert.match(String(plugin.version || ''), /^[0-9]+\.[0-9]+\.[0-9]+$/, 'plugin.json must declare a semver product version');
  const version = plugin.version;

  const versionSrc = readFileSync(pluginPath('src/version.js'), 'utf8');
  assert.match(versionSrc, /plugin\.json/, 'src/version.js must read plugin.json as the version authority');
  assert.match(versionSrc, /export const PRODUCT_VERSION/, 'src/version.js must export PRODUCT_VERSION');
  const versionMod = await import(pathToFileURL(pluginPath('src/version.js')).href);
  assert.equal(
    versionMod.PRODUCT_VERSION,
    version,
    `src/version.js PRODUCT_VERSION must equal plugin.json ${version}, not ${versionMod.PRODUCT_VERSION}`
  );
  assert.equal(
    path.resolve(versionMod.PLUGIN_MANIFEST_PATH),
    path.resolve(pluginPath('plugin.json')),
    'src/version.js must resolve PLUGIN_MANIFEST_PATH to checkout plugin.json in source mode'
  );

  const cli = readFileSync(pluginPath('src/cli.js'), 'utf8');
  const release = readFileSync(pluginPath('src/release.js'), 'utf8');
  assert.match(
    cli,
    /import\s*\{\s*PRODUCT_VERSION\s*\}\s*from\s*'\.\/version\.js'/,
    'src/cli.js must import PRODUCT_VERSION from src/version.js'
  );
  assert.match(
    release,
    /import\s*\{\s*PRODUCT_VERSION\s*\}\s*from\s*'\.\/version\.js'/,
    'src/release.js must import PRODUCT_VERSION from src/version.js'
  );
  assert.match(cli, /bundled runtime v\$\{PRODUCT_VERSION\}/, 'src/cli.js must print the manifest-backed runtime version');
  assert.match(release, /version:\s*PRODUCT_VERSION/, 'src/release.js must emit the manifest-backed release-manifest version');
  assert.doesNotMatch(
    cli,
    /bundled runtime v[0-9]+\.[0-9]+\.[0-9]+/,
    'src/cli.js must not duplicate a runtime version literal'
  );
  assert.doesNotMatch(
    release,
    /version:\s*'[0-9]+\.[0-9]+\.[0-9]+'/,
    'src/release.js must not duplicate a release-manifest version literal'
  );

  const launcher = pluginPath('bin/jobsss');
  const help = spawnSync(launcher, ['--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 15_000
  });
  const helpText = `${help.stdout || ''}\n${help.stderr || ''}`;
  assert.equal(help.status, 0, `./bin/jobsss --help must exit 0: ${helpText.slice(0, 400)}`);
  assert.match(
    help.stdout,
    new RegExp(`bundled runtime v${version}\\b`),
    `live CLI help must print manifest-backed version ${version}`
  );
  const cliVersion = spawnSync(launcher, ['--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 15_000
  });
  const versionText = `${cliVersion.stdout || ''}\n${cliVersion.stderr || ''}`;
  assert.match(
    versionText,
    new RegExp(`^${version}\\s*$`, 'm'),
    `live CLI --version must report ${version}: ${versionText.slice(0, 400)}`
  );

  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md']) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    assert.ok(text.includes(PUBLISHED_BASE_SHA), `${rel} must identify published base ${PUBLISHED_BASE_SHA}`);
    assert.doesNotMatch(
      text,
      /803135995782e36cbf9427ac903a2e26d2952383[^\n]{0,120}unpushed/i,
      `${rel} must not claim published base 8031359 is unpushed`
    );
    assert.doesNotMatch(
      text,
      /origin\/main[^\n]{0,80}behind/i,
      `${rel} must not claim origin/main is behind for published 8031359`
    );
    assert.ok(text.includes(plugin.version), `${rel} must record the single authoritative plugin/runtime version ${plugin.version}`);
  }
});
