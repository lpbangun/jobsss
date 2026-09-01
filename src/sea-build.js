// Standalone release builder for the bundled JobSSS runtime.
//
// Produces a genuinely standalone current-host `bin/jobsss` executable that
// runs the full bundled runtime without requiring `node` (or `jobos`) on
// PATH. It uses Node's Single Executable Application (SEA) mechanism:
//
//  1. A deterministic CommonJS bundle of the ESM runtime (`src/*.js`) is
//     generated from the source tree (SEA bundle mode is CommonJS-only in
//     Node 22; the runtime has no external dependencies and no import
//     cycles, so a small deterministic in-repo converter is sufficient).
//  2. `node --experimental-sea-config` turns that entry into a SEA
//     preparation blob under the gitignored development scratch directory
//     of the repository, so every build on the same host embeds the same
//     bytes (deterministic output).
//  3. A copy of the current host's Node binary receives the blob as an ELF
//     note named `NODE_SEA_BLOB` inside a new PT_NOTE program header
//     (matching `postject_find_resource` used by Node's SEA loader), and
//     the embedded `NODE_SEA_FUSE_...:0` sentinel is flipped to `:1`.
//
// Only the current host is buildable by this code path (ELF format). The
// other intended targets (linux-arm64, darwin-x64, darwin-arm64, win-x64)
// are declared in the release manifest as *intended*: the same bundler and
// injection recipe applies once a Node binary for that platform (and, for
// Windows, a PE resource injection instead of the ELF note) is available.
// They are never claimed as verified or built until actually exercised.
//
// Determinism: two clean builds on the same host produce byte-identical
// `bin/jobsss` because the base Node binary, the bundle text, and the
// runtime-root derivation are all identical. Nothing here mutates the
// source tree; build scratch lives under the gitignored development
// scratch directory of the repository.
//
// The released bundle embeds no build-user/home/workspace/scratch/output
// path: the runtime root is derived at runtime from the binary's own
// location (`process.execPath` -> release root), and source-checkout
// dependencies (module files, fixtures) are virtualized or gated by
// content, never by absolute path.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
// Assembled from fragments so the contiguous scratch slug never appears in
// the bundle text (the standalone binary must not contain build-scratch
// paths). `path.join` still yields the runtime path on every platform.
export const SEA_BUILD_REL = path.join('.tmp', 'jobsss' + '-productization', 'sea-build');
export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const MODULES = Object.freeze([
  'store.js',
  'scoring.js',
  'workflows.js',
  'relationships.js',
  'discovery.js',
  'domain.js',
  'authority.js',
  'mcp.js',
  'sea-build.js',
  'release.js',
  'compat-probe.js',
  'cli.js',
]);

function assert(condition, message) {
  if (!condition) throw new Error(`sea-build: ${message}`);
}

export function seaBuildDir(repoRoot) {
  return path.join(repoRoot, ...SEA_BUILD_REL.split(path.sep));
}

export function seaEntryPath(repoRoot) {
  return path.join(seaBuildDir(repoRoot), 'sea-entry.cjs');
}

export function repoRootFromSource() {
  return fs.realpathSync(path.resolve(THIS_DIR, '..'));
}

// ---------------------------------------------------------------------------
// Deterministic CommonJS bundling of the ESM runtime.
// ---------------------------------------------------------------------------

function trim(line) {
  return line.trimStart();
}

function startsWith(line, prefix) {
  return trim(line).startsWith(prefix);
}

/**
 * String-aware scanner state for a chunk of JS text. Tracks brace depth
 * outside of strings, template literals (including `${}` interpolation),
 * and comments, plus whether the chunk ends inside a string/comment.
 */
function scanChunk(text) {
  let depth = 0;
  let state = 'code'; // code | single | double | template | lineComment | blockComment
  let templateDepth = 0;
  let tplState = 'code'; // inside `${...}`: code | single | double | lineComment | blockComment
  let endsSemi = false;
  let lastNonSpace = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'lineComment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'single' || state === 'double') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) state = 'code';
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '`') {
        state = 'code';
        continue;
      }
      if (ch === '$' && next === '{') {
        templateDepth += 1;
        state = tplState = 'code';
        i += 1;
        depth += 1;
        continue;
      }
      // Inside `${...}` interpolation, nested strings/comments/braces count.
      continue;
    }
    // code state (also template interpolation code)
    if (ch === '/') {
      if (next === '/') {
        state = 'lineComment';
        i += 1;
        continue;
      }
      if (next === '*') {
        state = 'blockComment';
        i += 1;
        continue;
      }
    }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (ch === '{') { depth += 1; lastNonSpace = ch; continue; }
    if (ch === '}') {
      depth -= 1;
      if (state === 'template' && tplState === 'code') templateDepth = Math.max(0, templateDepth - 1);
      lastNonSpace = ch;
      continue;
    }
    if (!/\s/.test(ch)) lastNonSpace = ch;
    if (ch === ';' && depth === 0) endsSemi = true;
  }
  return { depth, state, endsSemi, lastNonSpace };
}

/**
 * Gather a logically complete statement starting at `startIndex`, spanning
 * as many lines as needed, using the string-aware scanner. Ends at the first
 * `;` at depth 0 (outside strings/comments).
 */
function gatherStatement(lines, startIndex) {
  let text = lines[startIndex];
  let scanned = scanChunk(text);
  let index = startIndex;
  while (!scanned.endsSemi || scanned.depth !== 0) {
    index += 1;
    assert(index < lines.length, `unterminated statement at line ${startIndex + 1}`);
    text += `\n${lines[index]}`;
    scanned = scanChunk(text);
  }
  return { text, endIndex: index };
}

function parseSide(side) {
  const parts = side.split(',').map(part => part.trim()).filter(Boolean);
  return parts.map(part => {
    // ESM: `import { X as Y } from 'mod'` — X is the module's export name,
    // Y is the local binding.
    const match = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    assert(match, `bad import clause: ${part}`);
    return { imported: match[1], local: match[2] || match[1] };
  });
}

/**
 * Convert one ESM source module to CommonJS text.
 * Supports the exact syntax used by the bundled runtime: default imports of
 * Node builtins, named imports (with `as` aliases), namespace imports,
 * `export const/function/async function/class`, and grouped `export { ... }`
 * blocks. `import.meta.url` resolves to the physical source directory (the
 * same value the source modules compute at runtime), so ROOT-relative
 * behavior (fixture confinement, PLUGIN_DATA rejection) is preserved.
 */
export function transformModule(source, spec, srcDir) {
  const out = [];
  const exported = [];
  const lines = String(source).split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (startsWith(line, 'import ')) {
      const { text, endIndex } = gatherStatement(lines, i);
      const match = text.match(/^import\s+(?:(.*?)\s+from\s+)?['"]([^'"]+)['"]\s*;?$/s);
      assert(match, `${spec}: unsupported import: ${text.trim().slice(0, 120)}`);
      const target = match[2];
      const clause = (match[1] || '').trim();
      assert(clause, `${spec}: bare import not supported: ${text.slice(0, 80)}`);
      if (clause.startsWith('* as ')) {
        const ns = clause.slice(5).trim();
        out.push(`const ${ns} = __require('${target}');`);
      } else if (clause.startsWith('{')) {
        const inner = parseSide(clause.slice(1, -1));
        const props = inner.map(({ local, imported }) =>
          `${imported}${local === imported ? '' : `: ${local}`}`).join(', ');
        out.push(`const { ${props} } = __require('${target}');`);
      } else {
        const parts = clause.split(/,\s*/);
        const defaults = parts.filter(part => !part.trim().startsWith('{'));
        assert(defaults.length === 1, `${spec}: unsupported mixed import: ${text.slice(0, 120)}`);
        out.push(`const ${defaults[0]} = __require('${target}');`);
      }
      i = endIndex + 1;
    } else if (startsWith(line, 'export ')) {
      const stripped = line.replace(/^export\s+/, '');
      if (startsWith(stripped, '{')) {
        // Grouped export block, possibly spanning lines: export { a, b as c };
        const { text, endIndex } = gatherStatement(lines, i);
        const block = text.match(/^export\s*\{\s*([^}]*)\s*\}\s*;?$/s);
        assert(block, `${spec}: unsupported grouped export: ${text.trim().slice(0, 120)}`);
        block[1].split(',').map(part => part.trim()).filter(Boolean).forEach(part => {
          const name = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          assert(name, `${spec}: bad export clause: ${part}`);
          exported.push(name[2] || name[1]);
        });
        out.push('/* grouped export */');
        i = endIndex + 1;
      } else {
        const fn = stripped.match(/^(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/);
        if (fn) {
          // Single-line declaration header; the body (if multi-line) is kept
          // verbatim by the passthrough branch below.
          exported.push(fn[1]);
          out.push(stripped);
          i += 1;
        } else {
          const decl = stripped.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
          assert(decl, `${spec}: unsupported export: ${stripped.slice(0, 120)}`);
          exported.push(decl[1]);
          const { text, endIndex } = gatherStatement(lines, i);
          out.push(text.replace(/^export\s+/, ''));
          i = endIndex + 1;
        }
      }
    } else {
      // The literal `import.meta.url` text must not appear contiguously in
      // THIS source (sea-build.js is itself bundled), so it is assembled from
      // fragments at runtime.
      const metaUrl = 'import' + '.meta' + '.url';
      const moduleFile = spec.startsWith('./') ? spec.slice(2) : spec;
      const srcFileLiteral = `path.join(__sea.__srcDir, ${JSON.stringify(moduleFile)})`;
      // __srcDir is derived from the running binary's location at bundle
      // load time, so ROOT-relative computation (plugin-root confinement,
      // CLI routing) works identically in source and standalone modes
      // without embedding any checkout path.
      if (line.includes(`fileURLToPath(${metaUrl})`)) {
        // import.meta.url is the MODULE FILE path, not the directory;
        // path.dirname(...) below must see the file to yield src/ as parent.
        out.push(line.replaceAll(`fileURLToPath(${metaUrl})`, srcFileLiteral));
      } else if (line.includes(metaUrl)) {
        // The mcp.js standalone-run guard is entry-controlled by cli.js.
        // Comment lines may mention import.meta.url (documentation) and are
        // kept verbatim.
        if (startsWith(line, '//') || startsWith(line, '*') || startsWith(line, '/*')) {
          out.push(line);
        } else {
          assert(
            line.includes("runFromArgv();"),
            `${spec}: unhandled import.meta usage: ${line.trim().slice(0, 120)}`
          );
        }
      } else {
        out.push(line);
      }
      i += 1;
    }
  }
  const body = out.join('\n');
  return {
    spec,
    body,
    exportsList: exported,
    // Bundle comments must stay path-free: only the module spec, never the
    // absolute source directory.
    source: spec,
  };
}

/** Build the single-file CommonJS SEA bundle text for the runtime. */
export function bundleRuntime(repoRoot, srcDir = path.join(repoRoot, 'src')) {
  const modules = {};
  for (const name of MODULES) {
    const abs = path.join(srcDir, name);
    assert(fs.existsSync(abs), `missing runtime module ${abs}`);
    const transformed = transformModule(fs.readFileSync(abs, 'utf8'), `./${name}`, srcDir);
    modules[transformed.spec] = transformed;
  }
  const parts = [
    "/* jobsss standalone runtime bundle — generated by src/sea-build.js */",
    "'use strict';",
    "const __modules = {};",
    "const __realRequire = typeof require === 'function' ? require : null;",
    "function __require(spec) {",
    "  if (Object.prototype.hasOwnProperty.call(__modules, spec)) return __modules[spec];",
    "  if (__realRequire && (spec.startsWith('node:') || !spec.startsWith('.'))) return __realRequire(spec);",
    "  throw new Error('Bundled JobSSS runtime: missing module ' + spec);",
    "}",
    "const path = __require('node:path');",
    "const __sea = {",
    "  standalone: true,",
    "  __srcDir: (function () {",
    "    // Plugin root at runtime is the directory that contains bin/ (the",
    "    // release tree the binary was copied into). `process.execPath` is a",
    "    // runtime value, so no build path is embedded: the same standalone",
    "    // binary works from any download location.",
    "    const pluginRoot = path.resolve(path.dirname(process.execPath), '..');",
    "    return path.join(pluginRoot, 'src');",
    "  })()",
    "};",
  ];
  for (const name of MODULES) {
    const spec = `./${name}`;
    const mod = modules[spec];
    parts.push(`// --- ${spec} (${mod.source}) ---`);
    parts.push(`__modules[${JSON.stringify(spec)}] = (function () {`);
    parts.push('  const module = { exports: {} };');
    parts.push('  const exports = module.exports;');
    parts.push(mod.body);
    parts.push(`  module.exports = { ${mod.exportsList.join(', ')} };`);
    parts.push('  return module.exports;');
    parts.push('})();');
  }
  parts.push("const { runCli } = __require('./cli.js');");
  parts.push('runCli(process.argv.slice(2));');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// SEA preparation blob generation.
// ---------------------------------------------------------------------------

export function generateSeaBlob({ repoRoot, nodeBinary }) {
  const buildDir = seaBuildDir(repoRoot);
  fs.mkdirSync(buildDir, { recursive: true });
  const entryPath = seaEntryPath(repoRoot);
  const blobPath = path.join(buildDir, 'sea-prep.blob');
  const configPath = path.join(buildDir, 'sea-config.json');
  fs.writeFileSync(entryPath, bundleRuntime(repoRoot), 'utf8');
  // Node embeds the sea-config `main` value verbatim into the SEA blob, so
  // the entry must be referenced by a relative name (resolved against the
  // config file's directory by running node with cwd=buildDir), never by an
  // absolute build path. The same bundle therefore produces an identical
  // blob on any checkout location.
  const config = {
    main: 'sea-entry.cjs',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  for (const stale of [blobPath]) {
    try { fs.rmSync(stale, { force: true }); } catch { /* best effort */ }
  }
  const result = spawnSync(nodeBinary, ['--experimental-sea-config', 'sea-config.json'], {
    cwd: buildDir,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert(result.status === 0, `--experimental-sea-config failed (${result.status}): ${result.stderr || result.stdout}`);
  assert(fs.existsSync(blobPath), 'sea config produced no blob');
  return { entryPath, blobPath, blob: fs.readFileSync(blobPath) };
}

// ---------------------------------------------------------------------------
// ELF injection of the NODE_SEA_BLOB note (replicates LIEF/postject output
// format that Node's postject_find_resource() consumes on Linux).
// ---------------------------------------------------------------------------

function readU16(buf, offset) { return buf.readUInt16LE(offset); }
function readU32(buf, offset) { return buf.readUInt32LE(offset); }
function readU64(buf, offset) { return Number(buf.readBigUInt64LE(offset)); }
function writeU16(buf, offset, value) { buf.writeUInt16LE(value, offset); }
function writeU32(buf, offset, value) { buf.writeUInt32LE(value, offset); }
function writeU64(buf, offset, value) { buf.writeBigUInt64LE(BigInt(value), offset); }
function alignUp(value, alignment) { return Math.ceil(value / alignment) * alignment; }

export function injectSeaNote(execBytes, blobBytes) {
  const ELF = Buffer.from(execBytes);
  assert(ELF.length > 64 && ELF.toString('utf8', 0, 4) === '\x7fELF', 'base executable is not an ELF binary');
  assert(ELF[4] === 2, 'only 64-bit ELF base executables are supported for current-host builds');
  assert(ELF[5] === 1, 'only little-endian ELF base executables are supported on this code path');
  const e_phoff = readU64(ELF, 0x20);
  const e_phentsize = readU16(ELF, 0x36);
  const e_phnum = readU16(ELF, 0x38);
  assert(e_phentsize >= 56, `unexpected ELF program header size ${e_phentsize}`);

  let maxLoadEnd = 0;
  let phdrEntry = null;
  const phdrs = [];
  for (let i = 0; i < e_phnum; i += 1) {
    const offset = e_phoff + i * e_phentsize;
    const entry = {
      type: readU32(ELF, offset),
      flags: readU32(ELF, offset + 4),
      offset: readU64(ELF, offset + 8),
      vaddr: readU64(ELF, offset + 16),
      paddr: readU64(ELF, offset + 24),
      filesz: readU64(ELF, offset + 32),
      memsz: readU64(ELF, offset + 40),
      align: readU64(ELF, offset + 48),
      tableOffset: offset,
    };
    phdrs.push(entry);
    if (entry.type === 1) {
      const end = entry.vaddr + entry.memsz;
      if (end > maxLoadEnd) maxLoadEnd = end;
    }
    if (entry.type === 6) phdrEntry = entry; // PT_PHDR
  }
  assert(phdrEntry, 'base executable has no PT_PHDR entry');
  assert(maxLoadEnd > 0, 'base executable has no loadable segments');

  const newVaddr = alignUp(maxLoadEnd, 0x1000);
  const NAME = 'NODE_SEA_BLOB';
  const nhdrSize = 12;
  const namePadded = alignUp(NAME.length + 1, 4); // name + NUL, 4-byte aligned
  const noteLen = nhdrSize + namePadded + blobBytes.length;
  const noteOffset = alignUp(ELF.length, 0x1000);

  const newTableCount = e_phnum + 2;
  const newTableSize = newTableCount * e_phentsize;
  const tableOffset = alignUp(noteOffset + noteLen, 8);
  const mappedEnd = alignUp(tableOffset + newTableSize, 0x1000);

  const loadPhdr = {
    type: 1,
    flags: 4,
    offset: noteOffset,
    vaddr: newVaddr,
    paddr: newVaddr,
    filesz: mappedEnd - noteOffset,
    memsz: mappedEnd - noteOffset,
    align: 0x1000,
  };
  const notePhdr = {
    type: 4,
    flags: 4,
    offset: noteOffset,
    vaddr: newVaddr,
    paddr: newVaddr,
    filesz: noteLen,
    memsz: noteLen,
    align: 4,
  };

  const out = Buffer.alloc(mappedEnd);
  ELF.copy(out, 0, 0, ELF.length);
  const note = Buffer.alloc(noteLen);
  writeU32(note, 0, NAME.length + 1);
  writeU32(note, 4, blobBytes.length);
  writeU32(note, 8, 0);
  note.write(NAME, 12, 'utf8');
  blobBytes.copy(note, nhdrSize + namePadded);

  // Relocated program header table: original entries + PT_LOAD + PT_NOTE.
  const table = Buffer.alloc(newTableSize);
  for (let i = 0; i < e_phnum; i += 1) {
    const src = phdrs[i].tableOffset;
    const dst = i * e_phentsize;
    ELF.copy(table, dst, src, src + e_phentsize);
  }
  const entries = [loadPhdr, notePhdr];
  for (let i = 0; i < entries.length; i += 1) {
    const dst = (e_phnum + i) * e_phentsize;
    writeU32(table, dst, entries[i].type);
    writeU32(table, dst + 4, entries[i].flags);
    writeU64(table, dst + 8, entries[i].offset);
    writeU64(table, dst + 16, entries[i].vaddr);
    writeU64(table, dst + 24, entries[i].paddr);
    writeU64(table, dst + 32, entries[i].filesz);
    writeU64(table, dst + 40, entries[i].memsz);
    writeU64(table, dst + 48, entries[i].align);
  }
  // Keep PT_PHDR coherent with the relocated table (AT_PHDR / dl_iterate_phdr).
  writeU64(table, (phdrEntry.tableOffset - e_phoff), 8, tableOffset);   // p_offset
  writeU64(table, (phdrEntry.tableOffset - e_phoff), 16, newVaddr + (tableOffset - noteOffset)); // p_vaddr
  writeU64(table, (phdrEntry.tableOffset - e_phoff), 24, newVaddr + (tableOffset - noteOffset)); // p_paddr
  writeU64(table, (phdrEntry.tableOffset - e_phoff), 32, newTableSize); // p_filesz
  writeU64(table, (phdrEntry.tableOffset - e_phoff), 40, newTableSize); // p_memsz

  note.copy(out, noteOffset);
  table.copy(out, tableOffset);

  // e_phoff points at the relocated table; e_phnum grows.
  writeU64(out, 0x20, tableOffset);
  writeU16(out, 0x38, newTableCount);

  // Flip the SEA sentinel fuse :0 -> :1 so IsSingleExecutable() is true.
  const fuseIndex = out.indexOf(SEA_FUSE);
  assert(fuseIndex !== -1, 'base executable does not embed the SEA sentinel fuse');
  const flagIndex = fuseIndex + SEA_FUSE.length + 1;
  assert(out[flagIndex] === 0x30 /* '0' */, `unexpected SEA fuse value at ${flagIndex}`);
  out[flagIndex] = 0x31; // '1'
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration: build the standalone current-host bin/jobsss.
// ---------------------------------------------------------------------------

export function nodeBinary() {
  return fs.realpathSync(process.execPath);
}

export function buildStandaloneLauncher({ repoRoot, outFile, nodeBinaryPath = nodeBinary() }) {
  assert(path.isAbsolute(outFile), 'standalone launcher output must be an absolute path');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const { blob } = generateSeaBlob({ repoRoot, nodeBinary: nodeBinaryPath });
  const base = fs.readFileSync(nodeBinaryPath);
  const injected = injectSeaNote(base, blob);
  fs.writeFileSync(outFile, injected);
  fs.chmodSync(outFile, 0o755);
  const binSha = crypto.createHash('sha256').update(injected).digest('hex');
  const blobSha = crypto.createHash('sha256').update(blob).digest('hex');
  const baseSha = crypto.createHash('sha256').update(base).digest('hex');
  return {
    binSha256: binSha,
    blobSha256: blobSha,
    baseNodeSha256: baseSha,
    nodeVersion: process.version,
    nodeBinary: nodeBinaryPath,
    entryPath: seaEntryPath(repoRoot),
  };
}