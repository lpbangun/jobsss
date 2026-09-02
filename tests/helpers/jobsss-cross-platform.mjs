import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginPath, REPO_ROOT } from './jobsss-gate0.mjs';
import { listRelFiles } from './jobsss-live-mcp.mjs';
import { entryStatus, matrixTargets } from './jobsss-productization.mjs';

export const PACKAGING_MODULE_REL = 'src/packaging.js';

export const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB';
export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
export const MACHO_SEGMENT_NAME = 'NODE_SEA';
export const PE_RCDATA_TYPE = 10;

export const REQUIRED_PACKAGING_TARGETS = Object.freeze([
  Object.freeze({ id: 'linux-x64', format: 'elf', arch: 'x64', platform: 'linux' }),
  Object.freeze({ id: 'linux-arm64', format: 'elf', arch: 'arm64', platform: 'linux' }),
  Object.freeze({ id: 'darwin-x64', format: 'macho', arch: 'x64', platform: 'darwin' }),
  Object.freeze({ id: 'darwin-arm64', format: 'macho', arch: 'arm64', platform: 'darwin' }),
  Object.freeze({ id: 'win-x64', format: 'pe', arch: 'x64', platform: 'win32' })
]);

export const PRODUCT_BEHAVIOR_RELS = Object.freeze([
  'src/domain.js',
  'src/mcp.js',
  'src/authority.js',
  'src/store.js',
  'src/scoring.js',
  'src/workflows.js',
  'src/discovery.js',
  'src/relationships.js',
  'src/compat-probe.js'
]);

export const INJECTION_IMPL_RE = /injectSea(?:Note|Payload|Elf|Macho|Pe)?|PT_NOTE|LC_SEGMENT_64|RT_RCDATA|IMAGE_RESOURCE_DIRECTORY|macho-segment-name/;

export const PACKAGING_BEHAVIOR_IMPORT_RE =
  /from\s+['"]\.\/(domain|mcp|authority|store|scoring|workflows|discovery|relationships|compat-probe)(?:\.js)?['"]/;

export const SEA_FIXTURE_BLOB = Buffer.from(`JOBSSS_SEA_FIXTURE_BLOB_v1\n${'X'.repeat(96)}`);

export const MISMATCH_RE =
  /\b(mismatch|mismatched|unsupported|invalid|unrecognized|wrong\s+(format|arch|architecture))\b/i;

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const LC_SEGMENT_64 = 0x19;
const PE_SIGNATURE = Buffer.from('PE\0\0');

export function packagingModulePath() {
  return pluginPath(PACKAGING_MODULE_REL);
}

export function readRepoFile(rel) {
  const abs = pluginPath(rel);
  assert.equal(existsSync(abs), true, `missing required product file ${rel}`);
  assert.equal(lstatSync(abs).isSymbolicLink(), false, `${rel} must not be a symlink`);
  return readFileSync(abs, 'utf8');
}

export async function loadPackagingModule() {
  const abs = packagingModulePath();
  assert.equal(existsSync(abs), true, `missing required product file ${PACKAGING_MODULE_REL}`);
  assert.equal(lstatSync(abs).isSymbolicLink(), false, `${PACKAGING_MODULE_REL} must not be a symlink`);
  return import(pathToFileURL(abs).href);
}

function normalizeFormat(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'elf' || raw === 'elf64' || raw === 'linux-elf') return 'elf';
  if (raw === 'macho' || raw === 'mach-o' || raw === 'macho64' || raw === 'mach-o 64') return 'macho';
  if (raw === 'pe' || raw === 'pe32+' || raw === 'pe32' || raw === 'portable-executable') return 'pe';
  return raw;
}

function normalizeArch(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'x64' || raw === 'amd64' || raw === 'x86_64' || raw === 'x86-64') return 'x64';
  if (raw === 'arm64' || raw === 'aarch64' || raw === 'arm_64') return 'arm64';
  return raw;
}

export function asIdentity(value, label) {
  assert.equal(value && typeof value === 'object' && !Array.isArray(value), true, `${label} must return { format, arch }`);
  const format = normalizeFormat(value.format || value.kind || value.container || value.executableFormat);
  const arch = normalizeArch(value.arch || value.architecture || value.cpu);
  const bits = Number(value.bits || value.width || 64);
  assert.equal(['elf', 'macho', 'pe'].includes(format), true, `${label} format must be elf, macho, or pe (got ${format || '<empty>'})`);
  assert.equal(['x64', 'arm64'].includes(arch), true, `${label} arch must be x64 or arm64 (got ${arch || '<empty>'})`);
  assert.equal(bits, 64, `${label} must identify a 64-bit executable`);
  return { format, arch, bits };
}

export function asInjectedBytes(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === 'object') {
    for (const key of ['bytes', 'buffer', 'executable', 'output', 'injected']) {
      const inner = value[key];
      if (Buffer.isBuffer(inner)) return inner;
      if (inner instanceof Uint8Array) return Buffer.from(inner);
    }
    if (value.ok === false) {
      throw new Error(String(value.error || value.message || value.code || `${label} failed`));
    }
  }
  assert.fail(`${label} must return injected executable bytes (Buffer or Uint8Array)`);
}

export function getPackagingApi(mod) {
  assert.equal(mod && typeof mod === 'object', true, `${PACKAGING_MODULE_REL} must export an inspectable packaging API`);
  const identify = mod.identifyExecutable || mod.validateExecutable || mod.identify;
  const inject = mod.injectSeaPayload || mod.inject;
  assert.equal(typeof identify === 'function', true, `${PACKAGING_MODULE_REL} must export identifyExecutable(bytes)`);
  assert.equal(typeof inject === 'function', true, `${PACKAGING_MODULE_REL} must export injectSeaPayload({ target, executable, blob })`);
  return {
    identifyExecutable: bytes => asIdentity(identify(Buffer.from(bytes)), 'identifyExecutable'),
    injectSeaPayload: args => {
      const result = inject({
        target: args.target,
        executable: Buffer.from(args.executable),
        blob: Buffer.from(args.blob)
      });
      return asInjectedBytes(result, `injectSeaPayload(${args.target})`);
    },
    raw: mod
  };
}

export function listedPackagingTargets(mod) {
  const listed = [];
  const source = mod.TARGETS || mod.targets || mod.FORMATS || mod.formats;
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (typeof entry === 'string') listed.push({ id: entry });
      else if (entry && typeof entry === 'object') listed.push(entry);
    }
  } else if (source && typeof source === 'object') {
    for (const [id, entry] of Object.entries(source)) {
      listed.push(entry && typeof entry === 'object' ? { id, ...entry } : { id });
    }
  }
  return listed;
}

export function assertPackagingTargetsDeclared(mod) {
  const listed = listedPackagingTargets(mod);
  const ids = listed.map(entry => String(entry.id || entry.target || entry.name || '').trim());
  for (const required of REQUIRED_PACKAGING_TARGETS) {
    assert.ok(
      ids.includes(required.id),
      `${PACKAGING_MODULE_REL} must declare inspectable target ${required.id} (format ${required.format}, arch ${required.arch})`
    );
    const entry = listed.find(item => String(item.id || item.target || item.name || '').trim() === required.id);
    const format = normalizeFormat(entry.format || entry.container || entry.kind);
    const arch = normalizeArch(entry.arch || entry.architecture);
    if (format) assert.equal(format, required.format, `${required.id} format must be ${required.format}`);
    if (arch) assert.equal(arch, required.arch, `${required.id} arch must be ${required.arch}`);
  }
}

export function makeSeaFuse(enabled) {
  return Buffer.from(`${SEA_FUSE}:${enabled ? '1' : '0'}\0`, 'utf8');
}

export function readSeaFuse(bytes) {
  const buf = Buffer.from(bytes);
  const idx = buf.indexOf(Buffer.from(SEA_FUSE, 'utf8'));
  if (idx < 0) return { present: false, enabled: null, index: -1 };
  const colon = buf[idx + SEA_FUSE.length];
  const flag = buf[idx + SEA_FUSE.length + 1];
  return {
    present: true,
    enabled: colon === 0x3a && flag === 0x31,
    index: idx,
    raw: String.fromCharCode(flag)
  };
}

function alignUp(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function paddedCString(text, align = 4) {
  const raw = Buffer.from(`${text}\0`, 'utf8');
  const out = Buffer.alloc(alignUp(raw.length, align));
  raw.copy(out);
  return out;
}

function machoName(text) {
  const buf = Buffer.alloc(16);
  Buffer.from(String(text), 'ascii').copy(buf, 0, 0, 16);
  return buf;
}

function trimMachoName(buf) {
  return buf.toString('ascii').replace(/\0+$/g, '').trim();
}

export function makeElfFixture({ arch = 'x64' } = {}) {
  const fuse = makeSeaFuse(false);
  const hdrSize = 64;
  const phSize = 56;
  const phNum = 2;
  const phOff = hdrSize;
  const payloadOff = alignUp(hdrSize + phSize * phNum, 16);
  const fileSize = alignUp(payloadOff + fuse.length + 32, 16);
  const buf = Buffer.alloc(fileSize);
  ELF_MAGIC.copy(buf, 0);
  buf[4] = 2;
  buf[5] = 1;
  buf[6] = 1;
  buf.writeUInt16LE(3, 16); // ET_DYN
  buf.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18);
  buf.writeUInt32LE(1, 20);
  buf.writeBigUInt64LE(0x400000n, 24);
  buf.writeBigUInt64LE(BigInt(phOff), 32);
  buf.writeUInt16LE(64, 52);
  buf.writeUInt16LE(phSize, 54);
  buf.writeUInt16LE(phNum, 56);
  buf.writeUInt16LE(64, 58);
  // PT_PHDR
  buf.writeUInt32LE(6, phOff);
  buf.writeUInt32LE(4, phOff + 4);
  buf.writeBigUInt64LE(BigInt(phOff), phOff + 8);
  buf.writeBigUInt64LE(0x400000n + BigInt(phOff), phOff + 16);
  buf.writeBigUInt64LE(0x400000n + BigInt(phOff), phOff + 24);
  buf.writeBigUInt64LE(BigInt(phSize * phNum), phOff + 32);
  buf.writeBigUInt64LE(BigInt(phSize * phNum), phOff + 40);
  buf.writeBigUInt64LE(8n, phOff + 48);
  // PT_LOAD
  const load = phOff + phSize;
  buf.writeUInt32LE(1, load);
  buf.writeUInt32LE(5, load + 4);
  buf.writeBigUInt64LE(0n, load + 8);
  buf.writeBigUInt64LE(0x400000n, load + 16);
  buf.writeBigUInt64LE(0x400000n, load + 24);
  buf.writeBigUInt64LE(BigInt(fileSize), load + 32);
  buf.writeBigUInt64LE(BigInt(fileSize), load + 40);
  buf.writeBigUInt64LE(0x1000n, load + 48);
  fuse.copy(buf, payloadOff);
  return buf;
}

export function makeMachoFixture({ arch = 'x64' } = {}) {
  const fuse = makeSeaFuse(false);
  const textBytes = Buffer.concat([Buffer.from([0x90, 0x90, 0xc3]), fuse]);
  const headerSize = 32;
  const segCmdSize = 72;
  const sectSize = 80;
  const ncmds = 1;
  const sizeofcmds = segCmdSize + sectSize;
  const textOff = alignUp(headerSize + sizeofcmds, 16);
  const fileSize = alignUp(textOff + textBytes.length, 16);
  const buf = Buffer.alloc(fileSize);
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeUInt32LE(arch === 'arm64' ? CPU_TYPE_ARM64 : CPU_TYPE_X86_64, 4);
  buf.writeUInt32LE(arch === 'arm64' ? 0 : 3, 8);
  buf.writeUInt32LE(2, 12); // MH_EXECUTE
  buf.writeUInt32LE(ncmds, 16);
  buf.writeUInt32LE(sizeofcmds, 20);
  buf.writeUInt32LE(0, 24);
  buf.writeUInt32LE(0, 28);
  let off = headerSize;
  buf.writeUInt32LE(LC_SEGMENT_64, off);
  buf.writeUInt32LE(sizeofcmds, off + 4);
  machoName('__TEXT').copy(buf, off + 8);
  buf.writeBigUInt64LE(0x1000n, off + 24);
  buf.writeBigUInt64LE(BigInt(alignUp(fileSize, 0x1000)), off + 32);
  buf.writeBigUInt64LE(0n, off + 40);
  buf.writeBigUInt64LE(BigInt(fileSize), off + 48);
  buf.writeUInt32LE(7, off + 56);
  buf.writeUInt32LE(5, off + 60);
  buf.writeUInt32LE(1, off + 64);
  buf.writeUInt32LE(0, off + 68);
  const sect = off + segCmdSize;
  machoName('__text').copy(buf, sect);
  machoName('__TEXT').copy(buf, sect + 16);
  buf.writeBigUInt64LE(0x1000n + BigInt(textOff), sect + 32);
  buf.writeBigUInt64LE(BigInt(textBytes.length), sect + 40);
  buf.writeUInt32LE(textOff, sect + 48);
  buf.writeUInt32LE(4, sect + 52);
  textBytes.copy(buf, textOff);
  return buf;
}

export function makePeFixture({ arch = 'x64' } = {}) {
  const fuse = makeSeaFuse(false);
  const eLfanew = 0x40;
  const optSize = 0xf0;
  const numberOfRvaAndSizes = 16;
  const coffOff = eLfanew + 4;
  const optOff = coffOff + 20;
  const sectOff = optOff + optSize;
  const sizeOfHeaders = 0x200;
  const rawOff = 0x200;
  const rawSize = 0x200;
  const buf = Buffer.alloc(sizeOfHeaders + rawSize);
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(eLfanew, 0x3c);
  PE_SIGNATURE.copy(buf, eLfanew);
  buf.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, coffOff);
  buf.writeUInt16LE(1, coffOff + 2);
  buf.writeUInt16LE(optSize, coffOff + 16);
  buf.writeUInt16LE(0x0022, coffOff + 18);
  buf.writeUInt16LE(0x20b, optOff);
  buf.writeUInt32LE(rawSize, optOff + 16);
  buf.writeUInt32LE(0x1000, optOff + 24);
  buf.writeBigUInt64LE(0x1000n, optOff + 24); // ImageBase overwritten next
  buf.writeBigUInt64LE(0x140000000n, optOff + 24);
  buf.writeUInt32LE(0x1000, optOff + 32);
  buf.writeUInt32LE(0x200, optOff + 36);
  buf.writeUInt16LE(6, optOff + 40);
  buf.writeUInt16LE(0, optOff + 42);
  buf.writeUInt16LE(0, optOff + 48);
  buf.writeUInt16LE(3, optOff + 68);
  buf.writeUInt32LE(0x2000, optOff + 56);
  buf.writeUInt32LE(sizeOfHeaders, optOff + 60);
  buf.writeUInt16LE(0x10b, optOff + 68); // subsystem IMAGE_SUBSYSTEM_WINDOWS_CUI? keep 3
  buf.writeUInt16LE(3, optOff + 68);
  buf.writeUInt32LE(numberOfRvaAndSizes, optOff + 108);
  buf.write('TEXT\0\0\0\0', sectOff, 'ascii');
  buf.write('.text\0\0\0', sectOff, 'ascii');
  buf.writeUInt32LE(rawSize, sectOff + 8);
  buf.writeUInt32LE(0x1000, sectOff + 12);
  buf.writeUInt32LE(rawSize, sectOff + 16);
  buf.writeUInt32LE(rawOff, sectOff + 20);
  buf.writeUInt32LE(0x60000020, sectOff + 36);
  fuse.copy(buf, rawOff);
  return buf;
}

export function makeFixture(format, arch) {
  if (format === 'elf') return makeElfFixture({ arch });
  if (format === 'macho') return makeMachoFixture({ arch });
  if (format === 'pe') return makePeFixture({ arch });
  throw new Error(`unknown fixture format ${format}`);
}

export function identifyExecutable(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length >= 64 && buf.subarray(0, 4).equals(ELF_MAGIC)) {
    assert.equal(buf[4], 2, 'synthetic/native ELF fixtures must be 64-bit');
    const machine = buf.readUInt16LE(18);
    const arch = machine === 183 ? 'arm64' : machine === 62 ? 'x64' : '';
    assert.ok(arch, `unrecognized ELF e_machine ${machine}`);
    return { format: 'elf', arch, bits: 64 };
  }
  if (buf.length >= 32) {
    const magic = buf.readUInt32LE(0);
    if (magic === MH_MAGIC_64 || magic === MH_CIGAM_64) {
      const le = magic === MH_MAGIC_64;
      const cpu = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
      const arch = cpu === CPU_TYPE_ARM64 ? 'arm64' : cpu === CPU_TYPE_X86_64 ? 'x64' : '';
      assert.ok(arch, `unrecognized Mach-O cputype ${cpu}`);
      return { format: 'macho', arch, bits: 64 };
    }
  }
  if (buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a) {
    const eLfanew = buf.readUInt32LE(0x3c);
    assert.ok(eLfanew + 24 <= buf.length && buf.subarray(eLfanew, eLfanew + 4).equals(PE_SIGNATURE), 'MZ image is not a PE');
    const machine = buf.readUInt16LE(eLfanew + 4);
    const arch = machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : '';
    assert.ok(arch, `unrecognized PE machine ${machine}`);
    const optMagic = buf.readUInt16LE(eLfanew + 24);
    assert.equal(optMagic, 0x20b, 'Windows SEA contract requires PE32+');
    return { format: 'pe', arch, bits: 64 };
  }
  throw new Error(`unrecognized executable format`);
}

function extractElfBlob(buf) {
  const phOff = Number(buf.readBigUInt64LE(32));
  const phEnt = buf.readUInt16LE(54);
  const phNum = buf.readUInt16LE(56);
  for (let i = 0; i < phNum; i += 1) {
    const off = phOff + i * phEnt;
    if (off + 56 > buf.length) continue;
    if (buf.readUInt32LE(off) !== 4) continue;
    const fileOff = Number(buf.readBigUInt64LE(off + 8));
    const fileSz = Number(buf.readBigUInt64LE(off + 32));
    let cursor = fileOff;
    const end = Math.min(buf.length, fileOff + fileSz);
    while (cursor + 12 <= end) {
      const namesz = buf.readUInt32LE(cursor);
      const descsz = buf.readUInt32LE(cursor + 4);
      const name = buf.subarray(cursor + 12, cursor + 12 + Math.max(0, namesz - 1)).toString('utf8');
      const descOff = cursor + 12 + alignUp(namesz, 4);
      if (name === SEA_RESOURCE_NAME && descsz > 0 && descOff + descsz <= buf.length) {
        return Buffer.from(buf.subarray(descOff, descOff + descsz));
      }
      const next = descOff + alignUp(descsz, 4);
      if (next <= cursor) break;
      cursor = next;
    }
  }
  return null;
}

function extractMachoBlob(buf) {
  const magic = buf.readUInt32LE(0);
  const le = magic === MH_MAGIC_64;
  const readU32 = (off) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
  const readU64 = (off) => Number(le ? buf.readBigUInt64LE(off) : buf.readBigUInt64BE(off));
  const ncmds = readU32(16);
  const sizeofcmds = readU32(20);
  let off = 32;
  const cmdEnd = Math.min(buf.length, 32 + sizeofcmds);
  for (let i = 0; i < ncmds && off + 8 <= cmdEnd; i += 1) {
    const cmd = readU32(off);
    const cmdsize = readU32(off + 4);
    if (cmdsize < 8) break;
    if (cmd === LC_SEGMENT_64 && cmdsize >= 72) {
      const segname = trimMachoName(buf.subarray(off + 8, off + 24));
      const nsects = readU32(off + 64);
      if (segname === MACHO_SEGMENT_NAME || segname === `__${MACHO_SEGMENT_NAME}`) {
        for (let s = 0; s < nsects; s += 1) {
          const sect = off + 72 + s * 80;
          if (sect + 80 > buf.length) break;
          const sectname = trimMachoName(buf.subarray(sect, sect + 16));
          if (sectname === SEA_RESOURCE_NAME || sectname === `__${SEA_RESOURCE_NAME}`) {
            const size = Number(le ? buf.readBigUInt64LE(sect + 40) : buf.readBigUInt64BE(sect + 40));
            const fileoff = readU32(sect + 48);
            if (fileoff + size <= buf.length) return Buffer.from(buf.subarray(fileoff, fileoff + size));
          }
        }
        const fileoff = readU64(off + 40);
        const filesize = readU64(off + 48);
        if (nsects === 0 && fileoff + filesize <= buf.length && filesize > 0) {
          return Buffer.from(buf.subarray(fileoff, fileoff + filesize));
        }
      }
    }
    off += cmdsize;
  }
  return null;
}

function peRvaToOffset(buf, rva) {
  const eLfanew = buf.readUInt32LE(0x3c);
  const numberOfSections = buf.readUInt16LE(eLfanew + 6);
  const sizeOfOptionalHeader = buf.readUInt16LE(eLfanew + 20);
  const sectOff = eLfanew + 24 + sizeOfOptionalHeader;
  for (let i = 0; i < numberOfSections; i += 1) {
    const off = sectOff + i * 40;
    if (off + 40 > buf.length) break;
    const virtSize = buf.readUInt32LE(off + 8) || buf.readUInt32LE(off + 16);
    const virtAddr = buf.readUInt32LE(off + 12);
    const rawSize = buf.readUInt32LE(off + 16);
    const rawPtr = buf.readUInt32LE(off + 20);
    if (rva >= virtAddr && rva < virtAddr + Math.max(virtSize, rawSize)) {
      return rawPtr + (rva - virtAddr);
    }
  }
  return rva;
}

function readPeResourceName(buf, dirOff, nameField) {
  if ((nameField & 0x80000000) === 0) return { id: nameField, name: null };
  const strOff = dirOff + (nameField & 0x7fffffff);
  if (strOff + 2 > buf.length) return { id: null, name: null };
  const len = buf.readUInt16LE(strOff);
  const chars = [];
  for (let i = 0; i < len && strOff + 2 + i * 2 + 1 < buf.length; i += 1) {
    chars.push(buf.readUInt16LE(strOff + 2 + i * 2));
  }
  return { id: null, name: String.fromCharCode(...chars) };
}

function walkPeResources(buf, dirOff, offset, level, visit) {
  if (offset + 16 > buf.length) return;
  const named = buf.readUInt16LE(offset + 12);
  const ids = buf.readUInt16LE(offset + 14);
  const count = named + ids;
  for (let i = 0; i < count; i += 1) {
    const ent = offset + 16 + i * 8;
    if (ent + 8 > buf.length) return;
    const nameField = buf.readUInt32LE(ent);
    const dataField = buf.readUInt32LE(ent + 4);
    const ident = readPeResourceName(buf, dirOff, nameField);
    if (dataField & 0x80000000) {
      walkPeResources(buf, dirOff, dirOff + (dataField & 0x7fffffff), level + 1, (chain, dataOff) => {
        visit([ident, ...chain], dataOff);
      });
    } else {
      visit([ident], dirOff + dataField);
    }
  }
}

function extractPeBlob(buf) {
  const eLfanew = buf.readUInt32LE(0x3c);
  const optOff = eLfanew + 24;
  const magic = buf.readUInt16LE(optOff);
  if (magic !== 0x20b) return null;
  const numberOfRvaAndSizes = buf.readUInt32LE(optOff + 108);
  if (numberOfRvaAndSizes < 3) return null;
  const resRva = buf.readUInt32LE(optOff + 112 + 16);
  const resSize = buf.readUInt32LE(optOff + 112 + 20);
  if (!resRva || !resSize) return null;
  const dirOff = peRvaToOffset(buf, resRva);
  let found = null;
  walkPeResources(buf, dirOff, dirOff, 0, (chain, dataOff) => {
    if (found || dataOff + 16 > buf.length) return;
    const typeIdent = chain[0] || {};
    const nameIdent = chain[1] || {};
    const isRcdata = typeIdent.id === PE_RCDATA_TYPE || String(typeIdent.name || '').toUpperCase() === 'RCDATA';
    const isSea = String(nameIdent.name || '') === SEA_RESOURCE_NAME || nameIdent.id === undefined && String(typeIdent.name || '') === SEA_RESOURCE_NAME;
    if (!isRcdata && !isSea) return;
    if (chain.length >= 2 && nameIdent.name && nameIdent.name !== SEA_RESOURCE_NAME) return;
    const dataRva = buf.readUInt32LE(dataOff);
    const size = buf.readUInt32LE(dataOff + 4);
    const fileOff = peRvaToOffset(buf, dataRva);
    if (fileOff + size <= buf.length) found = Buffer.from(buf.subarray(fileOff, fileOff + size));
  });
  return found;
}

export function extractSeaBlob(bytes) {
  const buf = Buffer.from(bytes);
  const ident = identifyExecutable(buf);
  if (ident.format === 'elf') return extractElfBlob(buf);
  if (ident.format === 'macho') return extractMachoBlob(buf);
  if (ident.format === 'pe') return extractPeBlob(buf);
  return null;
}

export function assertNativeSeaInjection(injected, { format, arch, blob, target }) {
  const ident = identifyExecutable(injected);
  assert.equal(ident.format, format, `${target} injected output must remain ${format}`);
  assert.equal(ident.arch, arch, `${target} injected output must remain ${arch}`);
  const fuse = readSeaFuse(injected);
  assert.equal(fuse.present, true, `${target} injected output must contain ${SEA_FUSE}`);
  assert.equal(fuse.enabled, true, `${target} injected output must flip ${SEA_FUSE}:0 to :1`);
  const embedded = extractSeaBlob(injected);
  assert.ok(embedded, `${target} must inject ${SEA_RESOURCE_NAME} using the native ${format} SEA container`);
  assert.equal(
    Buffer.from(embedded.subarray(0, blob.length)).equals(blob),
    true,
    `${target} native ${format} container must carry the SEA blob bytes`
  );
}

export function assertMismatchThrown(fn, label) {
  let error;
  try {
    const result = fn();
    if (result && result.ok === false) {
      error = new Error(String(result.error || result.message || result.code || 'failed'));
    }
  } catch (err) {
    error = err;
  }
  assert.ok(error, `${label} must fail clearly for mismatched or unsupported input`);
  assert.match(
    String(error.message || error),
    MISMATCH_RE,
    `${label} failure must name mismatch/unsupported/invalid format or architecture: ${error.message || error}`
  );
}

export function resolveTargetPluginRoot(outDir, target) {
  const candidates = [
    path.join(outDir, target),
    path.join(outDir, 'jobsss', target),
    path.join(outDir, 'current-host'),
    outDir
  ];
  for (const dir of candidates) {
    const binUnix = path.join(dir, 'bin', 'jobsss');
    const binWin = path.join(dir, 'bin', 'jobsss.exe');
    if (
      existsSync(path.join(dir, 'plugin.json'))
      && existsSync(path.join(dir, 'mcp.json'))
      && existsSync(path.join(dir, 'skills', 'jobsss', 'SKILL.md'))
      && (existsSync(binUnix) || existsSync(binWin))
    ) {
      return dir;
    }
  }
  return null;
}

export function launcherPath(pluginRoot) {
  const unix = path.join(pluginRoot, 'bin', 'jobsss');
  const win = path.join(pluginRoot, 'bin', 'jobsss.exe');
  if (existsSync(unix)) return unix;
  if (existsSync(win)) return win;
  return unix;
}

export function assertCanonicalTargetLayout(pluginRoot, { windows = false } = {}) {
  for (const rel of ['plugin.json', 'mcp.json', 'skills/jobsss/SKILL.md']) {
    const abs = path.join(pluginRoot, rel);
    assert.equal(existsSync(abs), true, `target layout missing ${rel}`);
    assert.equal(lstatSync(abs).isSymbolicLink(), false, `target ${rel} must not be a symlink`);
  }
  const refs = path.join(pluginRoot, 'skills', 'jobsss', 'references');
  assert.equal(existsSync(refs), true, 'target layout missing skills/jobsss/references/');
  assert.equal(lstatSync(refs).isDirectory(), true);
  const launcher = launcherPath(pluginRoot);
  assert.equal(existsSync(launcher), true, `target layout missing ${windows ? 'bin/jobsss.exe' : 'bin/jobsss'}`);
  assert.equal(lstatSync(launcher).isSymbolicLink(), false, 'released launcher must not be a symlink');
  assert.equal(lstatSync(launcher).isFile(), true, 'released launcher must be a regular file');
}

export function targetEntry(manifestDoc, id) {
  return matrixTargets(manifestDoc).find(entry => String(entry.id || entry.target || entry.name || '').trim() === id) || null;
}

export function assertUnverifiedTarget(manifestDoc, id, reason) {
  const entry = targetEntry(manifestDoc, id);
  assert.ok(entry, `release-manifest.json must list target ${id}`);
  const status = entryStatus(entry);
  assert.notEqual(status, 'verified', `${id} must not be labeled verified ${reason}; got ${status}`);
  assert.equal(
    status,
    'unverified',
    `${id} must be labeled unverified ${reason} (fixture or unavailable-host validation is not platform verification); got ${status}`
  );
}

export const PRODUCTIZATION_REVIEW_REL = 'PRODUCTIZATION_REVIEW.md';
export const RELEASE_REPORT_REL = 'RELEASE_REPORT.md';
export const INTERMEDIATE_COMMIT_SHA = 'ba2123ef5f6f24bcf6ae994a125b67501b970785';

export const PRODUCTIZATION_REVIEW_RULES = Object.freeze([
  Object.freeze({ id: 'b1-b41', label: 'B1–B41', re: /B1\s*[–-]\s*B41/ }),
  Object.freeze({ id: 'cross-platform', label: 'cross-platform build definitions', re: /cross-platform build definitions/i }),
  Object.freeze({ id: 'restricted-path', label: 'current-host restricted-PATH release evidence', re: /current-host[\s\S]{0,120}restricted[-\s]PATH/i }),
  Object.freeze({ id: 'adapters', label: 'adapter behavior', re: /adapter behavior/i }),
  Object.freeze({ id: 'authority', label: 'human authority', re: /human authority|trusted-local human/i }),
  Object.freeze({ id: 'commands', label: 'exact commands/results', re: /exact commands?\/results|commands\/results/i }),
  Object.freeze({ id: 'risks', label: 'residual risks', re: /residual risks/i }),
  Object.freeze({ id: 'verdict', label: 'fresh verdict', re: /fresh verdict|\bverdict\b[\s\S]{0,80}\b(PASS|FAIL)\b/i })
]);

export const RELEASE_REPORT_RULES = Object.freeze([
  Object.freeze({ id: 'summary', label: 'release summary', re: /release summary/i }),
  Object.freeze({ id: 'restricted-path-mcp', label: 'generic restricted-PATH MCP evidence', re: /restricted[-\s]PATH MCP/i }),
  Object.freeze({ id: 'compat', label: 'client compatibility matrix', re: /client compatibility matrix/i }),
  Object.freeze({ id: 'authority', label: 'human-authority behavior', re: /human-authority behavior|human authority/i }),
  Object.freeze({ id: 'commands', label: 'commands/results', re: /commands\/results|commands and results/i }),
  Object.freeze({ id: 'verdict', label: 'reviewer verdict', re: /reviewer verdict/i }),
  Object.freeze({
    id: 'intermediate-sha',
    label: `reviewed baseline/intermediate commit ${INTERMEDIATE_COMMIT_SHA}`,
    re: new RegExp(INTERMEDIATE_COMMIT_SHA, 'i')
  }),
  Object.freeze({ id: 'deferred', label: 'deferred/unverified capabilities', re: /deferred\/unverified|deferred capabilities|unverified capabilities/i }),
  Object.freeze({
    id: 'final-sha-note',
    label: 'final corrective SHA is supplied in the final response',
    re: /final corrective SHA is supplied in the final response/i
  })
]);

export function missingDocumentRules(rel, rules) {
  const abs = pluginPath(rel);
  if (!existsSync(abs)) {
    return [`missing required file ${rel}`, ...rules.map(rule => `missing section/identity rule: ${rule.label}`)];
  }
  assert.equal(lstatSync(abs).isSymbolicLink(), false, `${rel} must not be a symlink`);
  const text = readFileSync(abs, 'utf8');
  const missing = [];
  for (const rule of rules) {
    if (!rule.re.test(text)) missing.push(`missing section/identity rule: ${rule.label}`);
  }
  return missing;
}

export function assertDocumentRules(rel, rules) {
  const missing = missingDocumentRules(rel, rules);
  assert.deepEqual(missing, [], `${rel} must exist and contain every revised-goal section/identity rule: ${missing.join('; ')}`);
}

export function assertNoInjectionInProductBehavior() {
  for (const rel of PRODUCT_BEHAVIOR_RELS) {
    const abs = pluginPath(rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    assert.doesNotMatch(
      text,
      INJECTION_IMPL_RE,
      `${rel} must not contain platform injection/build logic; keep ELF/Mach-O/PE definitions separate from product behavior`
    );
  }
}

export function assertPackagingSeparatedFromProduct(src) {
  assert.doesNotMatch(
    src,
    PACKAGING_BEHAVIOR_IMPORT_RE,
    `${PACKAGING_MODULE_REL} must not import MCP/domain/authority/store/scoring/workflow/adapter product behavior`
  );
  assert.doesNotMatch(src, /\broleFit\s*:\s*28\b/, `${PACKAGING_MODULE_REL} must not embed fit-score product weights`);
  assert.doesNotMatch(src, /\bHUMAN_ONLY_DOMAIN_TOOLS\b/, `${PACKAGING_MODULE_REL} must not replica human-only policy`);
  assert.doesNotMatch(src, /\bcreate_profile\b/, `${PACKAGING_MODULE_REL} must not implement product MCP tools`);
}

export function hostMatchesTarget(target) {
  return process.platform === target.platform && process.arch === target.arch;
}

export { listRelFiles, REPO_ROOT, pluginPath };
