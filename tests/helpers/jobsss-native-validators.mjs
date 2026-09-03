import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pluginPath } from './jobsss-gate0.mjs';
import { nativeCacheDir, sha256 } from './jobsss-native-inputs.mjs';

export const PACKAGING_LOCK_REL = 'src/packaging.lock.json';

export const VALIDATOR_PINS = Object.freeze([
  Object.freeze({
    id: 'pefile',
    name: 'pefile',
    version: '2024.8.26',
    url: 'https://files.pythonhosted.org/packages/54/16/12b82f791c7f50ddec566873d5bdd245baa1491bac11d15ffb98aecc8f8b/pefile-2024.8.26-py3-none-any.whl',
    filename: 'pefile-2024.8.26-py3-none-any.whl',
    sha256: '76f8b485dcd3b1bb8166f1128d395fa3d87af26360c2358fb75b80019b957c6f',
    source: 'https://pypi.org/project/pefile/2024.8.26/',
    kind: 'pe',
    buildOnly: true
  }),
  Object.freeze({
    id: 'macholib',
    name: 'macholib',
    version: '1.16.3',
    url: 'https://files.pythonhosted.org/packages/d1/5d/c059c180c84f7962db0aeae7c3b9303ed1d73d76f2bfbc32bc231c8be314/macholib-1.16.3-py2.py3-none-any.whl',
    filename: 'macholib-1.16.3-py2.py3-none-any.whl',
    sha256: '0e315d7583d38b8c77e815b1ecbdbf504a8258d8b3e17b61165c6feb60d18f2c',
    source: 'https://pypi.org/project/macholib/1.16.3/',
    kind: 'macho',
    buildOnly: true
  }),
  Object.freeze({
    id: 'altgraph',
    name: 'altgraph',
    version: '0.17.4',
    url: 'https://files.pythonhosted.org/packages/4d/3f/3bc3f1d83f6e4a7fcb834d3720544ca597590425be5ba9db032b2bf322a2/altgraph-0.17.4-py2.py3-none-any.whl',
    filename: 'altgraph-0.17.4-py2.py3-none-any.whl',
    sha256: '642743b4750de17e655e6711601b077bc6598dbfa3ba5fa2b2a35ce12b508dff',
    source: 'https://pypi.org/project/altgraph/0.17.4/',
    kind: 'macho-dep',
    buildOnly: true
  })
]);

const INSPECT_PY = [
  'import hashlib, json, os, sys',
  'kind, target = sys.argv[1], sys.argv[2]',
  'def digest(p):',
  '    h = hashlib.sha256()',
  '    with open(p, "rb") as fh:',
  '        for chunk in iter(lambda: fh.read(1024 * 1024), b""):',
  '            h.update(chunk)',
  '    return h.hexdigest()',
  'report = {',
  '    "kind": kind,',
  '    "basename": os.path.basename(target),',
  '    "sha256": digest(target),',
  '    "validators": {',
  '        "pefile": getattr(__import__("pefile", fromlist=["__version__"]), "__version__", "2024.8.26"),',
  '        "macholib": getattr(__import__("macholib", fromlist=["__version__"]), "__version__", "1.16.3"),',
  '    },',
  '}',
  'if kind == "pe":',
  '    import pefile',
  '    pe = pefile.PE(target)',
  '    opt = pe.OPTIONAL_HEADER',
  '    sdir = opt.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]]',
  '    overlay = pe.get_overlay() or b""',
  '    overlay_off = pe.get_overlay_data_start_offset()',
  '    resources = []',
  '    if hasattr(pe, "DIRECTORY_ENTRY_RESOURCE"):',
  '        for dtype in pe.DIRECTORY_ENTRY_RESOURCE.entries:',
  '            type_name = str(dtype.name) if dtype.name is not None else str(dtype.id)',
  '            for dname in (dtype.directory.entries if dtype.directory else []):',
  '                name = str(dname.name) if dname.name is not None else str(dname.id)',
  '                resources.append({"type": type_name, "name": name})',
  '    report["pe"] = {',
  '        "SizeOfImage": int(opt.SizeOfImage),',
  '        "FileAlignment": int(opt.FileAlignment),',
  '        "SectionAlignment": int(opt.SectionAlignment),',
  '        "NumberOfSections": int(pe.FILE_HEADER.NumberOfSections),',
  '        "security": {"fileOffset": int(sdir.VirtualAddress), "size": int(sdir.Size)},',
  '        "overlayOffset": None if overlay_off is None else int(overlay_off),',
  '        "overlaySize": len(overlay),',
  '        "overlaySha256": hashlib.sha256(overlay).hexdigest() if overlay else None,',
  '        "resources": resources,',
  '        "sections": [{',
  '            "name": s.Name.decode("ascii", "replace").strip("\\x00"),',
  '            "virtualAddress": int(s.VirtualAddress),',
  '            "virtualSize": int(s.Misc_VirtualSize),',
  '            "pointerToRawData": int(s.PointerToRawData),',
  '            "sizeOfRawData": int(s.SizeOfRawData),',
  '        } for s in pe.sections],',
  '    }',
  'elif kind == "macho":',
  '    from macholib.MachO import MachO',
  '    from macholib.mach_o import (',
  '        LC_CODE_SIGNATURE, LC_SEGMENT_64, LC_SYMTAB, LC_DYSYMTAB,',
  '        LC_DYLD_INFO, LC_DYLD_INFO_ONLY, LC_FUNCTION_STARTS,',
  '    )',
  '    macho = MachO(target)',
  '    header = macho.headers[0]',
  '    commands = []',
  '    has_signature = False',
  '    sea = None',
  '    linkedit = None',
  '    for load, cmd, _data in header.commands:',
  '        name = type(cmd).__name__',
  '        rec = {"name": name, "cmd": int(getattr(load, "cmd", 0))}',
  '        cmd_id = int(getattr(load, "cmd", 0))',
  '        if cmd_id in (int(LC_CODE_SIGNATURE),) or name == "linkedit_data_command" and int(getattr(load, "cmd", 0)) == int(LC_CODE_SIGNATURE):',
  '            has_signature = True',
  '            rec["dataoff"] = int(getattr(cmd, "dataoff", 0))',
  '            rec["datasize"] = int(getattr(cmd, "datasize", 0))',
  '        if cmd_id in (int(LC_SYMTAB),) or name == "symtab_command":',
  '            rec["symoff"] = int(getattr(cmd, "symoff", 0))',
  '            rec["stroff"] = int(getattr(cmd, "stroff", 0))',
  '        if name == "segment_command_64":',
  '            segname = cmd.segname.decode("ascii", "replace").strip("\\x00")',
  '            rec["segname"] = segname',
  '            rec["fileoff"] = int(cmd.fileoff)',
  '            rec["filesize"] = int(cmd.filesize)',
  '            rec["vmaddr"] = int(cmd.vmaddr)',
  '            rec["vmsize"] = int(cmd.vmsize)',
  '            if segname == "NODE_SEA":',
  '                sea = rec',
  '            if segname == "__LINKEDIT":',
  '                linkedit = rec',
  '        commands.append(rec)',
  '    report["macho"] = {',
  '        "ncmds": int(header.header.ncmds),',
  '        "sizeofcmds": int(header.header.sizeofcmds),',
  '        "hasCodeSignature": has_signature or any(c.get("cmd") == int(LC_CODE_SIGNATURE) for c in commands),',
  '        "NODE_SEA": sea,',
  '        "LINKEDIT": linkedit,',
  '        "commands": commands,',
  '    }',
  'else:',
  '    raise SystemExit("unsupported kind " + kind)',
  'json.dump(report, sys.stdout, sort_keys=True, separators=(",", ":"))',
  'sys.stdout.write("\\n")',
  ''
].join('\n');

function lockRecords(doc) {
  const records = [];
  if (!doc || typeof doc !== 'object') return records;
  if (doc.tool) records.push({ kind: 'tool', ...doc.tool });
  for (const listName of ['tools', 'validators', 'validator', 'testTools']) {
    const value = doc[listName];
    if (Array.isArray(value)) {
      for (const entry of value) records.push({ kind: listName, ...entry });
    } else if (value && typeof value === 'object' && !Array.isArray(value) && listName !== 'tool') {
      for (const [id, entry] of Object.entries(value)) {
        if (entry && typeof entry === 'object') records.push({ kind: listName, id, ...entry });
      }
    }
  }
  return records;
}

export function assertLockPinsIndependentValidators(doc) {
  const records = lockRecords(doc);
  for (const pin of VALIDATOR_PINS) {
    const found = records.find(entry => {
      const id = `${entry.id || ''} ${entry.name || ''}`.toLowerCase();
      return id.includes(pin.id);
    });
    assert.ok(
      found,
      `${PACKAGING_LOCK_REL} must pin independently maintained validator ${pin.id} ${pin.version} (exact URL/SHA-256, build/test-only)`
    );
    assert.equal(String(found.version || ''), pin.version, `${pin.id} version must be ${pin.version}`);
    assert.equal(String(found.url || ''), pin.url, `${pin.id} must pin wheel URL ${pin.url}`);
    assert.equal(
      String(found.sha256 || found.sha256sum || '').toLowerCase(),
      pin.sha256,
      `${pin.id} must pin SHA-256 ${pin.sha256}`
    );
    assert.notEqual(found.buildOnly, false, `${pin.id} must be build/test-only`);
  }
}

function downloadTo(url, dest) {
  const partial = `${dest}.partial`;
  rmSync(partial, { force: true });
  const result = spawnSync(
    'curl',
    ['-fsSL', '--retry', '3', '--retry-delay', '1', url, '-o', partial],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `download ${url} failed: ${result.stderr || result.stdout || ''}`.slice(0, 800));
  writeFileSync(dest, readFileSync(partial));
  rmSync(partial, { force: true });
}

export function ensureValidatorWheel(id, { cacheDir = path.join(nativeCacheDir(), 'validators') } = {}) {
  const pin = VALIDATOR_PINS.find(entry => entry.id === id);
  assert.ok(pin, `unknown validator ${id}`);
  mkdirSync(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, pin.filename);
  if (!existsSync(dest) || sha256(readFileSync(dest)) !== pin.sha256) {
    downloadTo(pin.url, dest);
  }
  const actual = sha256(readFileSync(dest));
  assert.equal(actual, pin.sha256, `${pin.id} wheel SHA-256 mismatch: got ${actual} expected ${pin.sha256}`);
  const extracted = path.join(cacheDir, pin.id);
  if (!existsSync(path.join(extracted, pin.id === 'pefile' ? 'pefile.py' : pin.id))) {
    mkdirSync(extracted, { recursive: true });
    const unzip = spawnSync('unzip', ['-o', dest, '-d', extracted], { encoding: 'utf8' });
    if (unzip.error) throw unzip.error;
    assert.equal(unzip.status, 0, `unzip ${pin.filename} failed: ${unzip.stderr}`);
  }
  return { pin, wheelPath: dest, extractedDir: extracted };
}

export function validatorPythonPath(cacheDir = path.join(nativeCacheDir(), 'validators')) {
  const dirs = VALIDATOR_PINS.map(pin => ensureValidatorWheel(pin.id, { cacheDir }).extractedDir);
  return dirs.join(path.delimiter);
}

export function inspectNativeWithPinnedValidators(kind, absPath, { cacheDir } = {}) {
  const python = process.env.JOBSSS_PYTHON || 'python3';
  const env = {
    ...process.env,
    PYTHONPATH: validatorPythonPath(cacheDir),
    PYTHONDONTWRITEBYTECODE: '1'
  };
  const child = spawnSync(python, ['-c', INSPECT_PY, kind, absPath], {
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000
  });
  if (child.error) throw child.error;
  assert.equal(
    child.status,
    0,
    `pinned ${kind} validator failed (exit ${child.status}): ${child.stderr || child.stdout || ''}`.slice(0, 800)
  );
  const text = String(child.stdout || '').trim();
  assert.ok(text.startsWith('{'), `pinned validator must emit JSON, got ${text.slice(0, 120)}`);
  return { text, doc: JSON.parse(text) };
}

export function assertValidatorChecksumRejectsDrift() {
  const pin = VALIDATOR_PINS[0];
  const { wheelPath } = ensureValidatorWheel(pin.id);
  const good = readFileSync(wheelPath);
  const bad = Buffer.from(good);
  bad[bad.length - 1] ^= 0xff;
  const actual = createHash('sha256').update(bad).digest('hex');
  assert.notEqual(actual, pin.sha256, 'corrupt validator wheel must not match the pinned digest');
}

export function writeTempBinary(bytes, name = 'artifact.bin') {
  const dir = path.join(tmpdir(), 'jobsss-native-validator-out');
  mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  writeFileSync(abs, bytes);
  return abs;
}

export function packagingLockDoc() {
  const abs = pluginPath(PACKAGING_LOCK_REL);
  assert.equal(existsSync(abs), true, `missing required product file ${PACKAGING_LOCK_REL}`);
  return JSON.parse(readFileSync(abs, 'utf8'));
}
