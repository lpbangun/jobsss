// JobSSS native-format packaging definitions.
//
// Single source of truth for the executable containers that a standalone
// release can target. Platform/build mechanics live in this module and are
// intentionally separated from MCP tools, domain behavior, scoring,
// authority, and client adapters: those modules never import or reimplement
// these definitions, and this module never imports them.
//
// Supported containers (Node SEA payload injection):
//   - ELF64 little-endian (Linux x64 / arm64):
//       a NODE_SEA_BLOB note inside a new PT_NOTE program header
//   - Mach-O 64 little-endian (macOS x64 / arm64):
//       a NODE_SEA LC_SEGMENT_64 load command containing a
//       NODE_SEA_BLOB section
//   - PE32+ x64 (Windows x64):
//       an RCDATA (RT_RCDATA) resource entry named NODE_SEA_BLOB
//
// Every definition:
//   - validates the target executable format and architecture strictly and
//     fails with a clear typed message for mismatched or unsupported input;
//   - flips the Node SEA sentinel fuse (:0 -> :1) so the injected output is
//     a single executable;
//   - embeds the SEA blob through the correct native container mechanism;
//   - is byte-deterministic for identical inputs;
//   - embeds no build, user, home, workspace, source-checkout, scratch, or
//     output path, so the same definition produces the same bytes from any
//     checkout location.
//
// A fixture-level exercise proves only that a definition is executable and
// deterministic; it never attests runtime support on a real platform. A
// target earns `verified` only after real execution on a matching host.

export const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB';
export const SEA_SEGMENT_NAME = 'NODE_SEA';
export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

export const TARGETS = Object.freeze([
  Object.freeze({ id: 'linux-x64', format: 'elf', arch: 'x64', platform: 'linux' }),
  Object.freeze({ id: 'linux-arm64', format: 'elf', arch: 'arm64', platform: 'linux' }),
  Object.freeze({ id: 'darwin-x64', format: 'macho', arch: 'x64', platform: 'darwin' }),
  Object.freeze({ id: 'darwin-arm64', format: 'macho', arch: 'arm64', platform: 'darwin' }),
  Object.freeze({ id: 'win-x64', format: 'pe', arch: 'x64', platform: 'win32' }),
]);

export function targetById(id) {
  return TARGETS.find(target => target.id === id) || null;
}

function fail(message) {
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Primitive little-endian helpers (all supported containers are LE).
// ---------------------------------------------------------------------------

function readU16(buf, offset) { return buf.readUInt16LE(offset); }
function readU32(buf, offset) { return buf.readUInt32LE(offset); }
function readU64(buf, offset) { return Number(buf.readBigUInt64LE(offset)); }
function writeU16(buf, offset, value) { buf.writeUInt16LE(value, offset); }
function writeU32(buf, offset, value) { buf.writeUInt32LE(value, offset); }
function writeU64(buf, offset, value) { buf.writeBigUInt64LE(BigInt(value), offset); }
function alignUp(value, alignment) { return Math.ceil(value / alignment) * alignment; }

function padName(text, size) {
  const out = Buffer.alloc(size);
  Buffer.from(String(text), 'ascii').copy(out, 0, 0, size);
  return out;
}

/** Flip the Node SEA sentinel fuse from :0 to :1 inside an executable. */
function flipSeaFuse(buf) {
  const needle = Buffer.from(SEA_FUSE, 'utf8');
  const index = buf.indexOf(needle);
  if (index < 0) fail('invalid executable: the SEA sentinel fuse is missing');
  const flagIndex = index + SEA_FUSE.length + 1;
  if (buf[flagIndex] !== 0x30 /* '0' */) {
    fail(`invalid executable: unexpected SEA fuse state at offset ${flagIndex}`);
  }
  buf[flagIndex] = 0x31; // '1'
  return index;
}

// ---------------------------------------------------------------------------
// Executable identification (strict format + architecture validation).
// ---------------------------------------------------------------------------

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;
const PE_SIGNATURE = Buffer.from('PE\0\0', 'latin1');

export function identifyExecutable(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length >= 64 && buf.subarray(0, 4).equals(ELF_MAGIC)) {
    if (buf[4] !== 2) fail('invalid ELF: 64-bit executables are required');
    if (buf[5] !== 1) fail('invalid ELF: little-endian executables are required');
    const machine = readU16(buf, 18);
    const arch = machine === 62 ? 'x64' : machine === 183 ? 'arm64' : '';
    if (!arch) fail(`invalid ELF: unrecognized machine type ${machine}`);
    return { format: 'elf', arch, bits: 64 };
  }
  if (buf.length >= 32) {
    const magic = readU32(buf, 0);
    if (magic === MH_MAGIC_64 || magic === MH_CIGAM_64) {
      const littleEndian = magic === MH_MAGIC_64;
      const cpu = littleEndian ? readU32(buf, 4) : buf.readUInt32BE(4);
      const arch = cpu === CPU_ARM64 ? 'arm64' : cpu === CPU_X86_64 ? 'x64' : '';
      if (!arch) fail(`invalid Mach-O: unrecognized cputype 0x${cpu.toString(16)}`);
      return { format: 'macho', arch, bits: 64 };
    }
  }
  if (buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a) {
    const eLfanew = readU32(buf, 0x3c);
    if (eLfanew + 24 > buf.length || !buf.subarray(eLfanew, eLfanew + 4).equals(PE_SIGNATURE)) {
      fail('invalid PE: MZ image is missing a PE signature');
    }
    const machine = readU16(buf, eLfanew + 4);
    const arch = machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : '';
    if (!arch) fail(`invalid PE: unrecognized machine type 0x${machine.toString(16)}`);
    if (readU16(buf, eLfanew + 24) !== 0x20b) {
      fail('invalid PE: PE32+ (64-bit optional header) is required');
    }
    return { format: 'pe', arch, bits: 64 };
  }
  fail('unrecognized executable format');
}

// ---------------------------------------------------------------------------
// ELF64 injection: append a NODE_SEA_BLOB PT_NOTE and relocate the program
// header table exactly like the proven current-host injector.
// ---------------------------------------------------------------------------

function injectElf(execBytes, blobBytes) {
  const ELF = Buffer.from(execBytes);
  if (ELF.length <= 64 || !ELF.subarray(0, 4).equals(ELF_MAGIC)) {
    fail('invalid ELF: base executable is not an ELF binary');
  }
  if (ELF[4] !== 2) fail('invalid ELF: only 64-bit ELF executables are supported');
  if (ELF[5] !== 1) fail('invalid ELF: only little-endian ELF executables are supported');
  const e_phoff = readU64(ELF, 0x20);
  const e_phentsize = readU16(ELF, 0x36);
  const e_phnum = readU16(ELF, 0x38);
  if (e_phentsize < 56) fail(`invalid ELF: unexpected program header size ${e_phentsize}`);

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
  if (!phdrEntry) fail('invalid ELF: base executable has no PT_PHDR entry');
  if (!(maxLoadEnd > 0)) fail('invalid ELF: base executable has no loadable segments');

  const newVaddr = alignUp(maxLoadEnd, 0x1000);
  const namePadded = alignUp(SEA_RESOURCE_NAME.length + 1, 4); // name + NUL, 4-byte aligned
  const noteLen = 12 + namePadded + blobBytes.length;
  const noteOffset = alignUp(ELF.length, 0x1000);

  const newTableCount = e_phnum + 2;
  const newTableSize = newTableCount * e_phentsize;
  const tableOffset = alignUp(noteOffset + noteLen, 8);
  const mappedEnd = alignUp(tableOffset + newTableSize, 0x1000);

  const note = Buffer.alloc(noteLen);
  writeU32(note, 0, SEA_RESOURCE_NAME.length + 1);
  writeU32(note, 4, blobBytes.length);
  writeU32(note, 8, 0);
  note.write(SEA_RESOURCE_NAME, 12, 'utf8');
  blobBytes.copy(note, 12 + namePadded);

  const out = Buffer.alloc(mappedEnd);
  ELF.copy(out, 0, 0, ELF.length);

  // Relocated program header table: original entries + PT_LOAD + PT_NOTE.
  const table = Buffer.alloc(newTableSize);
  for (let i = 0; i < e_phnum; i += 1) {
    const src = phdrs[i].tableOffset;
    const dst = i * e_phentsize;
    ELF.copy(table, dst, src, src + e_phentsize);
  }
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
  writeU64(table, phdrEntry.tableOffset - e_phoff, 8, tableOffset);
  writeU64(table, phdrEntry.tableOffset - e_phoff, 16, newVaddr + (tableOffset - noteOffset));
  writeU64(table, phdrEntry.tableOffset - e_phoff, 24, newVaddr + (tableOffset - noteOffset));
  writeU64(table, phdrEntry.tableOffset - e_phoff, 32, newTableSize);
  writeU64(table, phdrEntry.tableOffset - e_phoff, 40, newTableSize);

  note.copy(out, noteOffset);
  table.copy(out, tableOffset);

  // e_phoff points at the relocated table; e_phnum grows.
  writeU64(out, 0x20, tableOffset);
  writeU16(out, 0x38, newTableCount);

  flipSeaFuse(out);
  return out;
}

// ---------------------------------------------------------------------------
// Mach-O 64 injection: append a NODE_SEA LC_SEGMENT_64 load command with a
// single NODE_SEA_BLOB section carrying the SEA payload.
// ---------------------------------------------------------------------------

const LC_SEGMENT_64 = 0x19;
const MACHO_SEG_CMD_SIZE = 72;
const MACHO_SECT_SIZE = 80;
const MACHO_HEADER_SIZE = 32;
const MACHO_CMD_TOTAL = MACHO_SEG_CMD_SIZE + MACHO_SECT_SIZE;

function injectMacho(execBytes, blobBytes) {
  const buf = Buffer.from(execBytes);
  flipSeaFuse(buf);
  const magic = readU32(buf, 0);
  if (magic !== MH_MAGIC_64) fail('invalid Mach-O: little-endian 64-bit Mach-O images are required');
  const ncmds = readU32(buf, 16);
  const sizeofcmds = readU32(buf, 20);
  if (ncmds < 1) fail('invalid Mach-O: no load commands');
  if (MACHO_HEADER_SIZE + sizeofcmds > buf.length) fail('invalid Mach-O: load commands exceed the file size');
  if (sizeofcmds % 8 !== 0) fail('invalid Mach-O: load commands are not 8-byte aligned');

  const blobOff = alignUp(buf.length + MACHO_CMD_TOTAL, 16);
  const out = Buffer.alloc(alignUp(blobOff + blobBytes.length, 16));

  // 1) Header with the grown command count/size.
  buf.copy(out, 0, 0, MACHO_HEADER_SIZE);
  writeU32(out, 16, ncmds + 1);
  writeU32(out, 20, sizeofcmds + MACHO_CMD_TOTAL);

  // 2) Original load commands stay in place...
  buf.copy(out, MACHO_HEADER_SIZE, MACHO_HEADER_SIZE, MACHO_HEADER_SIZE + sizeofcmds);

  // 3) ...and the file content behind them shifts by exactly one command.
  buf.copy(out, MACHO_HEADER_SIZE + sizeofcmds + MACHO_CMD_TOTAL, MACHO_HEADER_SIZE + sizeofcmds);

  // 4) Existing segment/section file offsets move with the shift.
  let cmdOff = MACHO_HEADER_SIZE;
  for (let i = 0; i < ncmds && cmdOff + 8 <= buf.length; i += 1) {
    const cmd = readU32(buf, cmdOff);
    const cmdsize = readU32(buf, cmdOff + 4);
    if (cmdsize < 8) break;
    if (cmd === LC_SEGMENT_64 && cmdsize >= 72) {
      const nsects = readU32(buf, cmdOff + 64);
      writeU64(out, cmdOff + 40, readU64(out, cmdOff + 40) + MACHO_CMD_TOTAL); // segment fileoff
      for (let s = 0; s < nsects; s += 1) {
        const sect = cmdOff + MACHO_SEG_CMD_SIZE + s * MACHO_SECT_SIZE;
        writeU32(out, sect + 48, readU32(out, sect + 48) + MACHO_CMD_TOTAL);  // section fileoff
      }
    }
    cmdOff += cmdsize;
  }

  // 5) New load command: LC_SEGMENT_64 "NODE_SEA" with one "NODE_SEA_BLOB"
  //    section whose offset/address point at the appended blob.
  const newCmdOff = MACHO_HEADER_SIZE + sizeofcmds;
  writeU32(out, newCmdOff, LC_SEGMENT_64);
  writeU32(out, newCmdOff + 4, MACHO_CMD_TOTAL);
  padName(SEA_SEGMENT_NAME, 16).copy(out, newCmdOff + 8);
  writeU64(out, newCmdOff + 24, 0);                       // vmaddr
  writeU64(out, newCmdOff + 32, 0);                       // vmsize
  writeU64(out, newCmdOff + 40, blobOff);                 // fileoff
  writeU64(out, newCmdOff + 48, blobBytes.length);        // filesize
  writeU32(out, newCmdOff + 56, 0);                       // maxprot
  writeU32(out, newCmdOff + 60, 0);                       // initprot
  writeU32(out, newCmdOff + 64, 1);                       // nsects
  writeU32(out, newCmdOff + 68, 0);                       // flags
  const sectOff = newCmdOff + MACHO_SEG_CMD_SIZE;
  padName(SEA_RESOURCE_NAME, 16).copy(out, sectOff);      // sectname
  padName(SEA_SEGMENT_NAME, 16).copy(out, sectOff + 16);  // segname
  writeU64(out, sectOff + 32, 0);                         // addr
  writeU64(out, sectOff + 40, blobBytes.length);          // size
  writeU32(out, sectOff + 48, blobOff);                   // offset (fileoff)
  writeU32(out, sectOff + 52, 4);                         // align
  // reloff / nreloc / flags / reserved1..3 remain zero (Buffer is zeroed).

  // 6) The SEA payload itself.
  blobBytes.copy(out, blobOff);
  return out;
}

// ---------------------------------------------------------------------------
// PE32+ injection: append an .rsrc section holding a canonical RCDATA
// resource directory whose "NODE_SEA_BLOB" data entry carries the payload.
// ---------------------------------------------------------------------------

const PE_RT_RCDATA = 10;
const PE_SECTION_SIZE = 40;

function peSectionTableBase(buf, eLfanew) {
  const sizeOfOptionalHeader = readU16(buf, eLfanew + 20);
  return eLfanew + 24 + sizeOfOptionalHeader;
}

function injectPe(execBytes, blobBytes) {
  const buf = Buffer.from(execBytes);
  flipSeaFuse(buf);
  const eLfanew = readU32(buf, 0x3c);
  const optOff = eLfanew + 24;
  if (readU16(buf, optOff) !== 0x20b) fail('invalid PE: PE32+ (64-bit optional header) is required');
  const numberOfSections = readU16(buf, eLfanew + 6);
  if (numberOfSections < 1) fail('invalid PE: no section headers');
  const sectBase = peSectionTableBase(buf, eLfanew);

  let rawEnd = 0;
  let maxVaEnd = 0;
  for (let i = 0; i < numberOfSections; i += 1) {
    const off = sectBase + i * PE_SECTION_SIZE;
    const virtSize = readU32(buf, off + 8);
    const virtAddr = readU32(buf, off + 12);
    const rawSize = readU32(buf, off + 16);
    const rawPtr = readU32(buf, off + 20);
    rawEnd = Math.max(rawEnd, rawPtr + rawSize);
    maxVaEnd = Math.max(maxVaEnd, alignUp(virtAddr + Math.max(virtSize, rawSize), 0x1000));
  }
  const rawPtr = alignUp(rawEnd, 0x200);
  const newVa = maxVaEnd > 0 ? maxVaEnd : alignUp(rawPtr, 0x1000);

  // Canonical resource directory layout (fixed, deterministic offsets):
  //   rel 0x00 L0 directory (RT_RCDATA)     16 + 8
  //   rel 0x18 L1 directory (named)         16 + 8
  //   rel 0x30 name string "NODE_SEA_BLOB"  2 + 26
  //   rel 0x4c L2 directory (language 0)    16 + 8
  //   rel 0x64 data entry                   16
  //   rel 0x74 SEA blob
  const nameBytes = Buffer.alloc(2 + SEA_RESOURCE_NAME.length * 2);
  nameBytes.writeUInt16LE(SEA_RESOURCE_NAME.length, 0);
  for (let i = 0; i < SEA_RESOURCE_NAME.length; i += 1) {
    nameBytes.writeUInt16LE(SEA_RESOURCE_NAME.charCodeAt(i), 2 + i * 2);
  }
  const l1Rel = 16 + 8;
  const nameRel = l1Rel + 16 + 8;
  const l2Rel = nameRel + nameBytes.length;
  const dataRel = l2Rel + 16 + 8;
  const blobRel = dataRel + 16;
  const rsrcSize = alignUp(blobRel + blobBytes.length, 0x200);

  const rsrc = Buffer.alloc(rsrcSize);
  // L0: one ID entry -> RT_RCDATA.
  writeU16(rsrc, 12, 0); // NumberOfNamedEntries
  writeU16(rsrc, 14, 1); // NumberOfIdEntries
  writeU32(rsrc, 16, PE_RT_RCDATA);
  writeU32(rsrc, 20, 0x80000000 + l1Rel);
  // L1: one named entry -> "NODE_SEA_BLOB".
  writeU16(rsrc, l1Rel + 12, 1);
  writeU16(rsrc, l1Rel + 14, 0);
  writeU32(rsrc, l1Rel + 16, 0x80000000 + nameRel);
  writeU32(rsrc, l1Rel + 20, 0x80000000 + l2Rel);
  nameBytes.copy(rsrc, nameRel);
  // L2: one ID entry -> language 0.
  writeU16(rsrc, l2Rel + 12, 0);
  writeU16(rsrc, l2Rel + 14, 1);
  writeU32(rsrc, l2Rel + 16, 0);
  writeU32(rsrc, l2Rel + 20, dataRel);
  // Data entry -> blob.
  writeU32(rsrc, dataRel, newVa + blobRel);
  writeU32(rsrc, dataRel + 4, blobBytes.length);
  writeU32(rsrc, dataRel + 8, 0);  // codepage
  writeU32(rsrc, dataRel + 12, 0); // reserved
  blobBytes.copy(rsrc, blobRel);

  const newSectOff = sectBase + numberOfSections * PE_SECTION_SIZE;
  const out = Buffer.alloc(rawPtr + rsrcSize);
  buf.copy(out, 0, 0, buf.length);

  // Grow the section count and point the resource data directory at .rsrc.
  writeU16(out, eLfanew + 6, numberOfSections + 1);
  const dataDirEntries = readU32(out, optOff + 108);
  if (dataDirEntries < 3) fail('invalid PE: optional header lacks a resource data directory');
  writeU32(out, optOff + 112 + 2 * 8, newVa);
  writeU32(out, optOff + 112 + 2 * 8 + 4, rsrcSize);

  // New .rsrc section header (raw data appended at the end of the file).
  padName('.rsrc', 8).copy(out, newSectOff);
  writeU32(out, newSectOff + 8, rsrcSize);   // VirtualSize
  writeU32(out, newSectOff + 12, newVa);     // VirtualAddress
  writeU32(out, newSectOff + 16, rsrcSize);  // SizeOfRawData
  writeU32(out, newSectOff + 20, rawPtr);    // PointerToRawData
  // PointerToRelocations (24), PointerToLineNumbers (28),
  // NumberOfRelocations (32), NumberOfLineNumbers (34) remain zero.
  writeU32(out, newSectOff + 36, 0x40000040); // MEM_READ | INITIALIZED_DATA

  rsrc.copy(out, rawPtr);
  return out;
}

// ---------------------------------------------------------------------------
// Public injection entry: target-driven selection with strict validation.
// ---------------------------------------------------------------------------

export function injectSeaPayload({ target, executable, blob }) {
  const targetId = String(target || '').trim();
  const definition = targetById(targetId);
  if (!definition) fail(`unsupported target ${targetId}`);
  if (!Buffer.isBuffer(blob) || blob.length === 0) {
    fail('invalid SEA blob: blob bytes are required');
  }
  const ident = identifyExecutable(executable);
  if (ident.format !== definition.format) {
    fail(
      `mismatched container: ${ident.format}/${ident.arch} executable provided for target ${targetId} which requires ${definition.format}/${definition.arch}`
    );
  }
  if (ident.arch !== definition.arch) {
    fail(
      `wrong architecture: ${ident.format}/${ident.arch} executable provided for target ${targetId} which requires ${definition.format}/${definition.arch}`
    );
  }
  const base = Buffer.from(executable);
  if (definition.format === 'elf') return injectElf(base, blob);
  if (definition.format === 'macho') return injectMacho(base, blob);
  if (definition.format === 'pe') return injectPe(base, blob);
  fail(`unsupported container format ${definition.format}`);
}