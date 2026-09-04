// Deterministic native release-evidence orchestration.
// Native mutation remains exclusively in packaging.js/postject. Structural
// inspection is delegated to the checked-in independent Python validator,
// which imports only checksum-pinned pefile/macholib wheels.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PRODUCT_VERSION } from './version.js';

const PUBLISHED_BASE = 'a380827d3cfd58c7c4dca014a109ead0326db18c';
const CASE_TARGETS = Object.freeze(['darwin-x64', 'darwin-arm64', 'win-x64']);
const REPRODUCTION_COMMAND = 'JOBSSS_NATIVE_CACHE="$(mktemp -d)" ./bin/jobsss evidence --out "$(pwd)/evidence/native-validation.json"';
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`evidence: ${message}`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function verifyPinnedChecksum(bytes, expectedValue) {
  const expected = String(expectedValue || '').toLowerCase();
  const actual = sha256(bytes);
  if (!SHA256_RE.test(expected) || actual !== expected) {
    fail(`checksum/sha256 mismatch: got ${actual}, expected ${expected || '<invalid>'}`);
  }
  return actual;
}

function run(command, args, options = {}) {
  const child = spawnSync(command, args, {
    encoding: options.binary ? null : 'utf8',
    env: options.env || process.env,
    timeout: options.timeout || 300_000,
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
  });
  if (child.error) fail(`${command} failed to run: ${child.error.message}`);
  if (child.status !== 0) {
    const detail = String(child.stderr || child.stdout || '').trim().slice(0, 800);
    fail(`${command} exited ${child.status}: ${detail || 'no diagnostics'}`);
  }
  return child;
}

function downloadPinned(pin, destination) {
  if (fs.existsSync(destination)) {
    verifyPinnedChecksum(fs.readFileSync(destination), pin.sha256 || pin.archiveSha256);
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const pending = `${destination}.pending`;
  fs.rmSync(pending, { force: true });
  run('curl', ['-fsSL', '--retry', '3', '--retry-delay', '1', pin.url, '-o', pending]);
  const bytes = fs.readFileSync(pending);
  verifyPinnedChecksum(bytes, pin.sha256 || pin.archiveSha256);
  fs.renameSync(pending, destination);
}

function validateLock(lock) {
  if (!lock || lock.$schema !== 'jobsss-packaging-lock/v1') fail('unexpected packaging lock schema');
  if (!/^\d+\.\d+\.\d+$/.test(String(lock.nodeVersion || ''))) fail('lock must pin an exact Node version');
  const tool = lock.tool;
  if (!tool || tool.id !== 'postject' || !tool.version || !/^https:\/\//.test(tool.url || '') || !SHA256_RE.test(tool.sha256 || '')) {
    fail('lock must pin postject URL, version, and SHA-256');
  }
  const inputs = Array.isArray(lock.officialNode) ? lock.officialNode : [];
  for (const id of CASE_TARGETS) {
    const pin = inputs.find(entry => entry.id === id && entry.target === id);
    if (!pin) fail(`lock must pin official input ${id}`);
    const expectedFormat = id.startsWith('darwin-') ? 'macho' : 'pe';
    const expectedArch = id.endsWith('arm64') ? 'arm64' : 'x64';
    const expectedPlatform = id.startsWith('darwin-') ? 'darwin' : 'win32';
    const expectedPrefix = `https://nodejs.org/dist/v${lock.nodeVersion}/node-v${lock.nodeVersion}-`;
    if (pin.version !== lock.nodeVersion || pin.format !== expectedFormat || pin.arch !== expectedArch || pin.platform !== expectedPlatform) {
      fail(`lock URL/version/architecture mismatch for ${id}`);
    }
    if (!String(pin.url || '').startsWith(expectedPrefix) || !SHA256_RE.test(pin.archiveSha256 || '') || !SHA256_RE.test(pin.executableSha256 || '')) {
      fail(`lock URL/checksum mismatch for ${id}`);
    }
  }
  const validators = Array.isArray(lock.validators) ? lock.validators : [];
  for (const id of ['pefile', 'macholib', 'altgraph']) {
    const pin = validators.find(entry => entry.id === id);
    if (!pin || !pin.version || !/^https:\/\/files\.pythonhosted\.org\//.test(pin.url || '') || !SHA256_RE.test(pin.sha256 || '')) {
      fail(`lock must pin validator ${id} URL, version, and SHA-256`);
    }
  }
}

function extractOfficial(pin, archivePath, executablePath) {
  if (fs.existsSync(executablePath)) {
    verifyPinnedChecksum(fs.readFileSync(executablePath), pin.executableSha256);
    return;
  }
  const extractRoot = path.dirname(executablePath);
  fs.mkdirSync(extractRoot, { recursive: true });
  const pending = `${executablePath}.pending`;
  fs.rmSync(pending, { force: true });
  if (archivePath.endsWith('.zip')) {
    const child = run('unzip', ['-p', archivePath, pin.member], { binary: true });
    fs.writeFileSync(pending, child.stdout);
  } else {
    const scratch = path.join(extractRoot, 'archive');
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(scratch, { recursive: true });
    run('tar', [archivePath.endsWith('.tar.gz') ? '-xzf' : '-xJf', archivePath, '-C', scratch, pin.member]);
    fs.copyFileSync(path.join(scratch, pin.member), pending);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  verifyPinnedChecksum(fs.readFileSync(pending), pin.executableSha256);
  fs.renameSync(pending, executablePath);
}

function acquireOfficial(pin, cacheDir) {
  const archivePath = path.join(cacheDir, 'official-node', pin.archiveName);
  const executablePath = path.join(cacheDir, 'official-node', 'extracted', pin.id, pin.executableName);
  downloadPinned(pin, archivePath);
  extractOfficial(pin, archivePath, executablePath);
  const bytes = fs.readFileSync(executablePath);
  verifyPinnedChecksum(bytes, pin.executableSha256);
  return { bytes, executablePath };
}

function acquireValidators(validators, cacheDir) {
  const roots = [];
  for (const pin of validators) {
    const wheel = path.join(cacheDir, 'validators', pin.filename);
    downloadPinned(pin, wheel);
    const root = path.join(cacheDir, 'validators', pin.id);
    const marker = path.join(root, pin.id === 'pefile' ? 'pefile.py' : pin.id);
    if (!fs.existsSync(marker)) {
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
      run('unzip', ['-q', wheel, '-d', root]);
    }
    roots.push(root);
  }
  return roots.join(path.delimiter);
}

function inspect(kind, targetPath, pythonPath, validatorScript) {
  const child = run(process.env.JOBSSS_PYTHON || 'python3', ['-B', validatorScript, kind, targetPath], {
    env: { ...process.env, PYTHONPATH: pythonPath, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(child.stdout);
  } catch (cause) {
    fail(`independent ${kind} validator emitted invalid JSON: ${cause.message}`);
  }
}

function releaseBlackBox(root, target, executablePath, outRoot) {
  const launcher = path.join(root, 'bin', 'jobsss');
  const child = spawnSync(launcher, ['release', '--out', outRoot, '--target', target, '--node-binary', executablePath], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error) fail(`release ${target} failed to run: ${child.error.message}`);
  if (child.status !== 0) {
    const detail = String(child.stderr || child.stdout || '').trim().slice(0, 800);
    fail(`release ${target} exited ${child.status}: ${detail || 'no diagnostics'}`);
  }
  const executableName = target === 'win-x64' ? 'jobsss.exe' : 'jobsss';
  const outputPath = path.join(outRoot, target, 'bin', executableName);
  const manifestPath = path.join(outRoot, 'release-manifest.json');
  if (!fs.existsSync(outputPath) || !fs.existsSync(manifestPath)) fail(`release ${target} omitted output or manifest`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== PRODUCT_VERSION || manifest.builtTarget !== target) fail(`release ${target} manifest identity mismatch`);
  return { outputPath, bytes: fs.readFileSync(outputPath), manifest };
}

function assertMachoEvidence(doc, pin, outputBytes) {
  const macho = doc && doc.macho;
  if (!doc || doc.format !== 'macho' || doc.arch !== pin.arch || doc.sha256 !== sha256(outputBytes)) fail(`${pin.id} output identity validation failed`);
  if (!macho || macho.hasCodeSignature !== false || !macho.NODE_SEA || !macho.NODE_SEA_BLOB) fail(`${pin.id} SEA/signature validation failed`);
  if (!macho.fuse?.present || !macho.fuse?.enabled || !Number.isInteger(macho.payloadLength) || macho.payloadLength <= 0 || !SHA256_RE.test(macho.payloadSha256 || '')) fail(`${pin.id} payload/fuse validation failed`);
  if (!macho.fileOffsetCommandsInBounds || !macho.segmentsNonOverlapping || !macho.segmentsAligned) fail(`${pin.id} segment/range validation failed`);
  if (!Array.isArray(macho.fileOffsetChecks) || macho.fileOffsetChecks.some(item => item.inBounds !== true)) fail(`${pin.id} load-command range validation failed`);
  if (!macho.LINKEDIT || macho.LINKEDIT.relocated !== true || !macho.symtab) fail(`${pin.id} linkedit/symtab validation failed`);
  for (const key of ['exports', 'chainedFixups', 'functionStarts', 'dataInCode']) {
    if (!(key in macho)) fail(`${pin.id} missing ${key} evidence`);
  }
}

function assertPeBeforeEvidence(doc, pin, inputBytes) {
  const pe = doc && doc.pe;
  if (!doc || doc.format !== 'pe' || doc.arch !== pin.arch || doc.sha256 !== sha256(inputBytes)) fail('win-x64 before identity validation failed');
  if (!pe || pe.FileAlignment !== 0x200 || pe.SectionAlignment !== 0x1000) fail('win-x64 before alignment validation failed');
  if (!pe.sectionRangesInBounds || pe.computedSizeOfImage !== pe.SizeOfImage) fail('win-x64 before section/SizeOfImage validation failed');
  if (!pe.security || pe.security.size <= 0 || pe.overlaySize !== pe.security.size || pe.overlayOffset !== pe.security.fileOffset) fail('win-x64 Authenticode overlay validation failed');
  if (!Array.isArray(pe.resources) || pe.resources.length === 0) fail('win-x64 before resource inventory is empty');
}

function assertPeAfterEvidence(doc, pin, outputBytes) {
  const pe = doc && doc.pe;
  if (!doc || doc.format !== 'pe' || doc.arch !== pin.arch || doc.sha256 !== sha256(outputBytes)) fail('win-x64 after identity validation failed');
  if (!pe || pe.FileAlignment !== 0x200 || pe.SectionAlignment !== 0x1000) fail('win-x64 after alignment validation failed');
  if (!pe.security || pe.security.fileOffset !== 0 || pe.security.size !== 0 || pe.overlaySize !== 0 || pe.certificateRestored !== false) fail('win-x64 after security/overlay validation failed');
  if (!pe.fuse?.present || !pe.fuse?.enabled || !Number.isInteger(pe.payloadLength) || pe.payloadLength <= 0 || !SHA256_RE.test(pe.payloadSha256 || '')) fail('win-x64 after payload/fuse validation failed');
  if (!pe.sectionRangesInBounds || pe.computedSizeOfImage !== pe.SizeOfImage) fail('win-x64 after section/SizeOfImage validation failed');
  const sections = pe.computedSizeOfImageInputs?.sections;
  if (!Array.isArray(sections) || sections.some(section => section.alignedSectionEnd > pe.SizeOfImage)) fail('win-x64 SizeOfImage does not cover every aligned section end');
}

function tuple(resource) {
  return [String(resource.type), String(resource.name), String(resource.language), Number(resource.size), String(resource.sha256)];
}

function tupleKey(value) {
  return JSON.stringify(value);
}

function proveResourcePreservation(before, after) {
  const originals = before.pe.resources.map(tuple);
  const final = after.pe.resources.map(tuple);
  for (const value of [...originals, ...final]) {
    if (!value[0] || !value[1] || !value[2] || !Number.isInteger(value[3]) || value[3] <= 0 || !SHA256_RE.test(value[4])) {
      fail(`incomplete PE resource tuple ${tupleKey(value)}`);
    }
  }
  if (new Set(originals.map(tupleKey)).size !== originals.length) fail('original PE resource tuple is duplicated');
  if (new Set(final.map(tupleKey)).size !== final.length) fail('after-injection PE resource tuple is duplicated');
  const originalSet = new Set(originals.map(tupleKey));
  const missing = originals.filter(value => !final.some(candidate => tupleKey(candidate) === tupleKey(value)));
  const added = final.filter(value => !originalSet.has(tupleKey(value)));
  if (missing.length) fail(`original PE resources changed or disappeared: ${missing.map(tupleKey).join(', ')}`);
  if (added.length !== 1 || added[0][1] !== 'NODE_SEA_BLOB' || !/RCDATA|10/.test(added[0][0])) {
    fail(`expected exactly one NODE_SEA_BLOB RT_RCDATA addition, got ${added.map(tupleKey).join(', ')}`);
  }
  return {
    comparison: 'exact-type-name-language-size-sha256',
    originalCount: originals.length,
    finalCount: final.length,
    missing: [],
    changed: [],
    unexpectedDuplicates: [],
    added: [{ type: added[0][0], name: added[0][1], language: added[0][2], size: added[0][3], sha256: added[0][4] }],
    passed: true,
  };
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, deepSort(value[key])]));
}

export function evidenceCommand(argv, { repoRoot } = {}) {
  let outFile = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') { outFile = argv[++i]; }
    else if (arg.startsWith('--out=')) outFile = arg.slice(6);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: JOBSSS_NATIVE_CACHE=<absolute-external-dir> jobsss evidence --out <file>');
      return;
    } else fail(`unknown option ${arg}`);
  }
  if (!outFile) fail('--out <file> is required');
  const cacheDir = process.env.JOBSSS_NATIVE_CACHE;
  if (!cacheDir || !path.isAbsolute(cacheDir)) fail('JOBSSS_NATIVE_CACHE must be a caller-selected absolute external directory');
  const root = path.resolve(repoRoot);
  const cache = path.resolve(cacheDir);
  if (cache === root || cache.startsWith(`${root}${path.sep}`)) fail('JOBSSS_NATIVE_CACHE must be outside the repository');

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(root, 'src', 'packaging.lock.json'), 'utf8'));
  } catch (cause) {
    fail(`packaging lock unreadable: ${cause.message}`);
  }
  validateLock(lock);
  fs.mkdirSync(cache, { recursive: true });
  // Reject a planted/corrupt injector cache before downloads or validation.
  const postjectArchive = path.join(cache, `postject-${lock.tool.version}.tgz`);
  if (fs.existsSync(postjectArchive)) verifyPinnedChecksum(fs.readFileSync(postjectArchive), lock.tool.sha256);
  const validators = lock.validators.map(entry => ({ ...entry }));
  const pythonPath = acquireValidators(validators, cache);
  const inputs = Object.fromEntries(CASE_TARGETS.map(id => {
    const pin = lock.officialNode.find(entry => entry.id === id);
    return [id, { pin, ...acquireOfficial(pin, cache) }];
  }));

  const work = path.join(cache, 'evidence-work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const validatorScript = path.join(root, 'scripts', 'native-validator.py');
  if (!fs.existsSync(validatorScript)) fail('checked-in scripts/native-validator.py is missing');
  const cases = {};
  for (const id of ['darwin-x64', 'darwin-arm64']) {
    const beforePath = path.join(work, `official-${id}`);
    const afterPath = path.join(work, `injected-${id}`);
    fs.writeFileSync(beforePath, inputs[id].bytes);
    inspect('macho', beforePath, pythonPath, validatorScript);
    const released = releaseBlackBox(root, id, inputs[id].executablePath, path.join(work, `release-${id}`));
    fs.copyFileSync(released.outputPath, afterPath);
    cases[id] = inspect('macho', afterPath, pythonPath, validatorScript);
    assertMachoEvidence(cases[id], inputs[id].pin, released.bytes);
    cases[id].executableOutputSha256 = sha256(released.bytes);
  }

  const winBeforePath = path.join(work, 'official-win-x64.exe');
  const winAfterPath = path.join(work, 'injected-win-x64.exe');
  fs.writeFileSync(winBeforePath, inputs['win-x64'].bytes);
  const winBefore = inspect('pe', winBeforePath, pythonPath, validatorScript);
  assertPeBeforeEvidence(winBefore, inputs['win-x64'].pin, inputs['win-x64'].bytes);
  const winReleased = releaseBlackBox(root, 'win-x64', inputs['win-x64'].executablePath, path.join(work, 'release-win-x64'));
  fs.copyFileSync(winReleased.outputPath, winAfterPath);
  const winAfter = inspect('pe', winAfterPath, pythonPath, validatorScript);
  assertPeAfterEvidence(winAfter, inputs['win-x64'].pin, winReleased.bytes);
  winBefore.executableInputSha256 = sha256(inputs['win-x64'].bytes);
  winAfter.executableOutputSha256 = sha256(winReleased.bytes);
  winAfter.pe.resourcePreservation = proveResourcePreservation(winBefore, winAfter);
  cases['win-x64-before'] = winBefore;
  cases['win-x64-after'] = winAfter;

  if (!fs.existsSync(postjectArchive)) fail('release black box did not acquire pinned postject');
  verifyPinnedChecksum(fs.readFileSync(postjectArchive), lock.tool.sha256);
  const payloads = [cases['darwin-x64'].macho, cases['darwin-arm64'].macho, cases['win-x64-after'].pe]
    .map(native => ({ length: native.payloadLength, sha256: native.payloadSha256 }));
  if (payloads.some(value => value.length !== payloads[0].length || value.sha256 !== payloads[0].sha256)) {
    fail('target releases did not embed one identical deterministic SEA payload');
  }

  const unsupportedPath = path.join(work, 'unsupported-win-x64.exe');
  fs.writeFileSync(unsupportedPath, Buffer.concat([inputs['win-x64'].bytes, Buffer.from('unsupported-overlay')]));
  const rejectedOut = path.join(work, 'rejected-release');
  const rejected = spawnSync(path.join(root, 'bin', 'jobsss'), ['release', '--out', rejectedOut, '--target', 'win-x64', '--node-binary', unsupportedPath], {
    cwd: root, encoding: 'utf8', env: process.env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  const rejectedDiagnostic = String(rejected.stderr || rejected.stdout || '');
  if (rejected.status === 0 || fs.existsSync(path.join(rejectedOut, 'win-x64', 'bin', 'jobsss.exe')) || !/checksum|sha256|mismatch/i.test(rejectedDiagnostic)) {
    fail('unsupported non-certificate overlay was not rejected by the release boundary before mutation');
  }
  const overlayMessage = 'release rejected checksum/sha256 mismatch before output creation';

  const artifact = {
    $schema: 'jobsss-native-validation-evidence/v1',
    productVersion: PRODUCT_VERSION,
    publishedBase: PUBLISHED_BASE,
    officialNodeVersion: lock.nodeVersion,
    reproductionCommand: REPRODUCTION_COMMAND,
    injector: { ...lock.tool },
    validators,
    officialInputs: CASE_TARGETS.map(id => ({ ...inputs[id].pin })),
    payload: payloads[0],
    runtimeVerification: { 'darwin-x64': 'unverified', 'darwin-arm64': 'unverified', 'win-x64': 'unverified' },
    unsupportedOverlayRejection: {
      description: 'unsupported non-certificate overlay rejected by the checksum-pinned release boundary before mutation',
      beforeMutation: true,
      passed: true,
      message: overlayMessage,
    },
    cases,
  };
  const text = `${JSON.stringify(deepSort(artifact), null, 2)}\n`;
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), text, 'utf8');
  console.log(`evidence: wrote ${outFile}`);
}
