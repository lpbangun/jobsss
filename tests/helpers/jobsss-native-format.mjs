import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB';
export const SEA_SEGMENT_NAME = 'NODE_SEA';
export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
export const PE_RT_RCDATA = 10;
export const PE_RT_VERSION = 16;

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MH_MAGIC_64 = 0xfeedfacf;
const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;
const PE_SIGNATURE = Buffer.from('PE\0\0');

const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;
const LC_DYSYMTAB = 0xb;
const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const LC_CODE_SIGNATURE = 0x1d;
const LC_SEGMENT_SPLIT_INFO = 0x1e;
const LC_FUNCTION_STARTS = 0x26;
const LC_DATA_IN_CODE = 0x29;
const LC_DYLIB_CODE_SIGN_DRS = 0x2b;
const LC_LINKER_OPTIMIZATION_HINT = 0x2e;
const LC_ENCRYPTION_INFO_64 = 0x2c;
const LC_DYLD_EXPORTS_TRIE = 0x80000033;
const LC_DYLD_CHAINED_FIXUPS = 0x80000034;
const LC_ATOM_INFO = 0x36;
const LC_NOTE = 0x31;

const LINKEDIT_DATA_CMDS = new Set([
  LC_CODE_SIGNATURE,
  LC_SEGMENT_SPLIT_INFO,
  LC_FUNCTION_STARTS,
  LC_DATA_IN_CODE,
  LC_DYLIB_CODE_SIGN_DRS,
  LC_LINKER_OPTIMIZATION_HINT,
  LC_DYLD_EXPORTS_TRIE,
  LC_DYLD_CHAINED_FIXUPS,
  LC_ATOM_INFO,
  LC_NOTE
]);

function alignUp(value, alignment) {
  if (!alignment) return value;
  return Math.ceil(value / alignment) * alignment;
}

function cstring(buf) {
  const idx = buf.indexOf(0);
  return buf.subarray(0, idx < 0 ? buf.length : idx).toString('ascii').trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sliceOrEmpty(buf, off, size) {
  if (!(size > 0) || off < 0 || off + size > buf.length) return Buffer.alloc(0);
  return Buffer.from(buf.subarray(off, off + size));
}

export function readSeaFuseIndependent(bytes) {
  const buf = Buffer.from(bytes);
  const idx = buf.indexOf(Buffer.from(SEA_FUSE, 'utf8'));
  if (idx < 0) return { present: false, enabled: null, index: -1 };
  return {
    present: true,
    enabled: buf[idx + SEA_FUSE.length] === 0x3a && buf[idx + SEA_FUSE.length + 1] === 0x31,
    index: idx
  };
}

export function identifyExecutableIndependent(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length >= 64 && buf.subarray(0, 4).equals(ELF_MAGIC)) {
    assert.equal(buf[4], 2, 'independent ELF parser requires ELF64');
    const machine = buf.readUInt16LE(18);
    const arch = machine === 183 ? 'arm64' : machine === 62 ? 'x64' : '';
    assert.ok(arch, `independent ELF parser: unrecognized e_machine ${machine}`);
    return { format: 'elf', arch, bits: 64 };
  }
  if (buf.length >= 32 && buf.readUInt32LE(0) === MH_MAGIC_64) {
    const cpu = buf.readUInt32LE(4);
    const arch = cpu === CPU_ARM64 ? 'arm64' : cpu === CPU_X86_64 ? 'x64' : '';
    assert.ok(arch, `independent Mach-O parser: unrecognized cputype ${cpu}`);
    return { format: 'macho', arch, bits: 64 };
  }
  if (buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a) {
    const eLfanew = buf.readUInt32LE(0x3c);
    assert.ok(eLfanew + 24 <= buf.length && buf.subarray(eLfanew, eLfanew + 4).equals(PE_SIGNATURE), 'independent PE parser: MZ without PE');
    const machine = buf.readUInt16LE(eLfanew + 4);
    const arch = machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : '';
    assert.ok(arch, `independent PE parser: unrecognized machine ${machine}`);
    assert.equal(buf.readUInt16LE(eLfanew + 24), 0x20b, 'independent PE parser requires PE32+');
    return { format: 'pe', arch, bits: 64 };
  }
  throw new Error('independent parser: unrecognized executable format');
}

export function parseMachoIndependent(bytes) {
  const buf = Buffer.from(bytes);
  const ident = identifyExecutableIndependent(buf);
  assert.equal(ident.format, 'macho');
  const ncmds = buf.readUInt32LE(16);
  const sizeofcmds = buf.readUInt32LE(20);
  const commands = [];
  const offsetFields = [];
  let off = 32;
  for (let i = 0; i < ncmds && off + 8 <= buf.length; i += 1) {
    const cmd = buf.readUInt32LE(off);
    const cmdsize = buf.readUInt32LE(off + 4);
    if (cmdsize < 8) break;
    const rec = { cmd, cmdsize, tableOff: off, name: null, fields: [] };
    if (cmd === LC_SEGMENT_64 && cmdsize >= 72) {
      rec.name = cstring(buf.subarray(off + 8, off + 24));
      rec.vmaddr = Number(buf.readBigUInt64LE(off + 24));
      rec.vmsize = Number(buf.readBigUInt64LE(off + 32));
      rec.fileoff = Number(buf.readBigUInt64LE(off + 40));
      rec.filesize = Number(buf.readBigUInt64LE(off + 48));
      rec.nsects = buf.readUInt32LE(off + 64);
      rec.sections = [];
      if (rec.filesize > 0) {
        rec.fields.push({ key: `${rec.name}.fileoff`, offset: rec.fileoff, size: rec.filesize });
      }
      for (let s = 0; s < rec.nsects; s += 1) {
        const sect = off + 72 + s * 80;
        if (sect + 80 > buf.length) break;
        const sectname = cstring(buf.subarray(sect, sect + 16));
        const size = Number(buf.readBigUInt64LE(sect + 40));
        const fileoff = buf.readUInt32LE(sect + 48);
        rec.sections.push({ name: sectname, size, fileoff });
        if (size > 0) rec.fields.push({ key: `${rec.name}.${sectname}.offset`, offset: fileoff, size });
      }
    } else if (cmd === LC_SYMTAB && cmdsize >= 24) {
      rec.name = 'LC_SYMTAB';
      rec.symoff = buf.readUInt32LE(off + 8);
      rec.nsyms = buf.readUInt32LE(off + 12);
      rec.stroff = buf.readUInt32LE(off + 16);
      rec.strsize = buf.readUInt32LE(off + 20);
      if (rec.nsyms) rec.fields.push({ key: 'LC_SYMTAB.symoff', offset: rec.symoff, size: rec.nsyms * 16 });
      if (rec.strsize) rec.fields.push({ key: 'LC_SYMTAB.stroff', offset: rec.stroff, size: rec.strsize });
    } else if (cmd === LC_DYSYMTAB && cmdsize >= 80) {
      rec.name = 'LC_DYSYMTAB';
      const names = [
        'ilocalsym', 'nlocalsym', 'iextdefsym', 'nextdefsym', 'iundefsym', 'nundefsym',
        'tocoff', 'ntoc', 'modtaboff', 'nmodtab', 'extrefsymoff', 'nextrefsyms',
        'indirectsymoff', 'nindirectsyms', 'extreloff', 'nextrel', 'locreloff', 'nlocrel'
      ];
      rec.dysym = {};
      for (let k = 0; k < names.length; k += 1) rec.dysym[names[k]] = buf.readUInt32LE(off + 8 + k * 4);
      const pairs = [
        ['tocoff', 'ntoc', 8],
        ['modtaboff', 'nmodtab', 56],
        ['extrefsymoff', 'nextrefsyms', 4],
        ['indirectsymoff', 'nindirectsyms', 4],
        ['extreloff', 'nextrel', 8],
        ['locreloff', 'nlocrel', 8]
      ];
      for (const [offKey, nKey, ent] of pairs) {
        if (rec.dysym[nKey] > 0 && rec.dysym[offKey] > 0) {
          rec.fields.push({ key: `LC_DYSYMTAB.${offKey}`, offset: rec.dysym[offKey], size: rec.dysym[nKey] * ent });
        }
      }
    } else if ((cmd === LC_DYLD_INFO || cmd === LC_DYLD_INFO_ONLY) && cmdsize >= 48) {
      rec.name = cmd === LC_DYLD_INFO_ONLY ? 'LC_DYLD_INFO_ONLY' : 'LC_DYLD_INFO';
      const keys = ['rebase_off', 'rebase_size', 'bind_off', 'bind_size', 'weak_bind_off', 'weak_bind_size', 'lazy_bind_off', 'lazy_bind_size', 'export_off', 'export_size'];
      rec.dyld = {};
      for (let k = 0; k < keys.length; k += 1) rec.dyld[keys[k]] = buf.readUInt32LE(off + 8 + k * 4);
      const pairs = [
        ['rebase_off', 'rebase_size'],
        ['bind_off', 'bind_size'],
        ['weak_bind_off', 'weak_bind_size'],
        ['lazy_bind_off', 'lazy_bind_size'],
        ['export_off', 'export_size']
      ];
      for (const [offKey, sizeKey] of pairs) {
        if (rec.dyld[sizeKey] > 0) rec.fields.push({ key: `${rec.name}.${offKey}`, offset: rec.dyld[offKey], size: rec.dyld[sizeKey] });
      }
    } else if (LINKEDIT_DATA_CMDS.has(cmd) && cmdsize >= 16) {
      rec.dataoff = buf.readUInt32LE(off + 8);
      rec.datasize = buf.readUInt32LE(off + 12);
      rec.name =
        cmd === LC_CODE_SIGNATURE ? 'LC_CODE_SIGNATURE'
        : cmd === LC_FUNCTION_STARTS ? 'LC_FUNCTION_STARTS'
        : cmd === LC_DATA_IN_CODE ? 'LC_DATA_IN_CODE'
        : cmd === LC_SEGMENT_SPLIT_INFO ? 'LC_SEGMENT_SPLIT_INFO'
        : cmd === LC_DYLD_EXPORTS_TRIE ? 'LC_DYLD_EXPORTS_TRIE'
        : cmd === LC_DYLD_CHAINED_FIXUPS ? 'LC_DYLD_CHAINED_FIXUPS'
        : `linkedit_data:${cmd.toString(16)}`;
      if (rec.datasize > 0) rec.fields.push({ key: `${rec.name}.dataoff`, offset: rec.dataoff, size: rec.datasize });
    } else if (cmd === LC_ENCRYPTION_INFO_64 && cmdsize >= 24) {
      rec.name = 'LC_ENCRYPTION_INFO_64';
      rec.cryptoff = buf.readUInt32LE(off + 8);
      rec.cryptsize = buf.readUInt32LE(off + 12);
      if (rec.cryptsize > 0) rec.fields.push({ key: 'LC_ENCRYPTION_INFO_64.cryptoff', offset: rec.cryptoff, size: rec.cryptsize });
    }
    for (const field of rec.fields) offsetFields.push({ command: rec.name, ...field });
    commands.push(rec);
    off += cmdsize;
  }
  return { ...ident, ncmds, sizeofcmds, commands, offsetFields, bytes: buf };
}

export function parsePeIndependent(bytes) {
  const buf = Buffer.from(bytes);
  const ident = identifyExecutableIndependent(buf);
  assert.equal(ident.format, 'pe');
  const eLfanew = buf.readUInt32LE(0x3c);
  const numberOfSections = buf.readUInt16LE(eLfanew + 6);
  const sizeOfOptionalHeader = buf.readUInt16LE(eLfanew + 20);
  const opt = eLfanew + 24;
  const sectionAlignment = buf.readUInt32LE(opt + 32);
  const fileAlignment = buf.readUInt32LE(opt + 36);
  const sizeOfImage = buf.readUInt32LE(opt + 56);
  const sizeOfHeaders = buf.readUInt32LE(opt + 60);
  const numberOfRvaAndSizes = buf.readUInt32LE(opt + 108);
  const resRva = numberOfRvaAndSizes >= 3 ? buf.readUInt32LE(opt + 112 + 16) : 0;
  const resSize = numberOfRvaAndSizes >= 3 ? buf.readUInt32LE(opt + 112 + 20) : 0;
  const security = numberOfRvaAndSizes >= 5
    ? { fileOffset: buf.readUInt32LE(opt + 144), size: buf.readUInt32LE(opt + 148) }
    : { fileOffset: 0, size: 0 };
  const sectOff = opt + sizeOfOptionalHeader;
  const sections = [];
  let rawEnd = 0;
  let vaEnd = 0;
  for (let i = 0; i < numberOfSections; i += 1) {
    const off = sectOff + i * 40;
    if (off + 40 > buf.length) break;
    const name = cstring(buf.subarray(off, off + 8));
    const virtualSize = buf.readUInt32LE(off + 8);
    const virtualAddress = buf.readUInt32LE(off + 12);
    const sizeOfRawData = buf.readUInt32LE(off + 16);
    const pointerToRawData = buf.readUInt32LE(off + 20);
    const characteristics = buf.readUInt32LE(off + 36);
    sections.push({ name, virtualSize, virtualAddress, sizeOfRawData, pointerToRawData, characteristics, headerOff: off });
    rawEnd = Math.max(rawEnd, pointerToRawData + sizeOfRawData);
    vaEnd = Math.max(vaEnd, virtualAddress + alignUp(Math.max(virtualSize, sizeOfRawData), sectionAlignment || 1));
  }
  const overlayOffset = rawEnd;
  const overlay = overlayOffset < buf.length ? Buffer.from(buf.subarray(overlayOffset)) : Buffer.alloc(0);
  return {
    ...ident,
    eLfanew,
    numberOfSections,
    sizeOfOptionalHeader,
    sectionTableOff: sectOff,
    sectionTableEnd: sectOff + numberOfSections * 40,
    sectionAlignment,
    fileAlignment,
    sizeOfImage,
    sizeOfHeaders,
    resRva,
    resSize,
    security,
    sections,
    rawEnd,
    vaEnd,
    overlayOffset,
    overlay,
    bytes: buf
  };
}

function rvaToOff(pe, rva) {
  for (const sect of pe.sections) {
    const span = Math.max(sect.virtualSize, sect.sizeOfRawData);
    if (rva >= sect.virtualAddress && rva < sect.virtualAddress + span) {
      return sect.pointerToRawData + (rva - sect.virtualAddress);
    }
  }
  return null;
}

function readPeName(buf, dirOff, field) {
  if ((field & 0x80000000) === 0) return { id: field, name: null };
  const strOff = dirOff + (field & 0x7fffffff);
  if (strOff + 2 > buf.length) return { id: null, name: null };
  const len = buf.readUInt16LE(strOff);
  const chars = [];
  for (let i = 0; i < len && strOff + 2 + i * 2 + 1 < buf.length; i += 1) {
    chars.push(buf.readUInt16LE(strOff + 2 + i * 2));
  }
  return { id: null, name: String.fromCharCode(...chars) };
}

function walkPeResources(pe, dirOff, offset, chain, out) {
  const buf = pe.bytes;
  if (offset + 16 > buf.length) return;
  const named = buf.readUInt16LE(offset + 12);
  const ids = buf.readUInt16LE(offset + 14);
  const count = named + ids;
  for (let i = 0; i < count; i += 1) {
    const ent = offset + 16 + i * 8;
    if (ent + 8 > buf.length) return;
    const nameField = buf.readUInt32LE(ent);
    const dataField = buf.readUInt32LE(ent + 4);
    const ident = readPeName(buf, dirOff, nameField);
    if (dataField & 0x80000000) {
      walkPeResources(pe, dirOff, dirOff + (dataField & 0x7fffffff), [...chain, ident], out);
    } else {
      const dataOff = dirOff + dataField;
      if (dataOff + 16 > buf.length) continue;
      const dataRva = buf.readUInt32LE(dataOff);
      const size = buf.readUInt32LE(dataOff + 4);
      const fileOff = rvaToOff(pe, dataRva);
      out.push({
        chain: [...chain, ident],
        dataRva,
        size,
        fileOff,
        bytes: fileOff != null ? sliceOrEmpty(buf, fileOff, size) : Buffer.alloc(0)
      });
    }
  }
}

export function listPeResourcesIndependent(pe) {
  if (!pe.resRva || !pe.resSize) return [];
  const dirOff = rvaToOff(pe, pe.resRva);
  if (dirOff == null) return [];
  const out = [];
  walkPeResources(pe, dirOff, dirOff, [], out);
  return out;
}

export function parseElfIndependent(bytes) {
  const buf = Buffer.from(bytes);
  const ident = identifyExecutableIndependent(buf);
  assert.equal(ident.format, 'elf');
  const phOff = Number(buf.readBigUInt64LE(32));
  const phEnt = buf.readUInt16LE(54);
  const phNum = buf.readUInt16LE(56);
  const notes = [];
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
      if (descsz > 0 && descOff + descsz <= buf.length) {
        notes.push({ name, desc: Buffer.from(buf.subarray(descOff, descOff + descsz)) });
      }
      const next = descOff + alignUp(descsz, 4);
      if (next <= cursor) break;
      cursor = next;
    }
  }
  return { ...ident, notes, bytes: buf };
}

export function locateSeaBlobIndependent(bytes) {
  const ident = identifyExecutableIndependent(bytes);
  if (ident.format === 'macho') {
    const macho = parseMachoIndependent(bytes);
    const sea = macho.commands.find(cmd => cmd.cmd === LC_SEGMENT_64 && (cmd.name === SEA_SEGMENT_NAME || cmd.name === `__${SEA_SEGMENT_NAME}`));
    if (!sea) return { ident, blob: null, container: null };
    const sect = (sea.sections || []).find(entry => entry.name === SEA_RESOURCE_NAME || entry.name === `__${SEA_RESOURCE_NAME}`);
    const off = sect ? sect.fileoff : sea.fileoff;
    const size = sect ? sect.size : sea.filesize;
    return { ident, macho, sea, blob: sliceOrEmpty(macho.bytes, off, size), container: 'macho-segment' };
  }
  if (ident.format === 'pe') {
    const pe = parsePeIndependent(bytes);
    const resources = listPeResourcesIndependent(pe);
    const hit = resources.find(entry => {
      const type = entry.chain[0] || {};
      const name = entry.chain[1] || {};
      const isRcdata = type.id === PE_RT_RCDATA || String(type.name || '').toUpperCase() === 'RCDATA';
      const isSea = name.name === SEA_RESOURCE_NAME;
      return isRcdata && isSea;
    });
    return { ident, pe, resources, blob: hit ? hit.bytes : null, container: 'pe-rcdata' };
  }
  const elf = parseElfIndependent(bytes);
  const note = elf.notes.find(entry => entry.name === SEA_RESOURCE_NAME);
  return { ident, elf, blob: note ? note.desc : null, container: 'elf-note' };
}

function rangesOverlap(a0, a1, b0, b1) {
  return a1 > a0 && b1 > b0 && a0 < b1 && b0 < a1;
}

function machoBytesAt(buf, offset, size) {
  if (!(size > 0) || offset < 0 || offset + size > buf.length) return null;
  return buf.subarray(offset, offset + size);
}

function uniqueContentOffset(haystack, needle) {
  if (!needle || needle.length === 0) return null;
  const hit = haystack.indexOf(needle);
  if (hit < 0) return null;
  if (haystack.indexOf(needle, hit + 1) >= 0) return null;
  return hit;
}

export function assertMachoInjectionInvariants(originalBytes, injectedBytes, { blob, target, requireRelocatedContent = true } = {}) {
  const original = parseMachoIndependent(originalBytes);
  const injected = parseMachoIndependent(injectedBytes);
  assert.equal(injected.arch, original.arch, `${target} Mach-O architecture must be preserved`);
  const fuse = readSeaFuseIndependent(injectedBytes);
  assert.equal(fuse.present, true, `${target} injected Mach-O must contain ${SEA_FUSE}`);
  assert.equal(fuse.enabled, true, `${target} injected Mach-O must flip ${SEA_FUSE}:0 to :1`);

  const problems = [];
  const origHasSig = original.commands.some(cmd => cmd.name === 'LC_CODE_SIGNATURE');
  const injHasSig = injected.commands.some(cmd => cmd.name === 'LC_CODE_SIGNATURE');
  if (origHasSig && injHasSig) {
    problems.push(
      'LC_CODE_SIGNATURE must be removed by pinned postject (src/postject.cpp Binary::remove_signature; Node SEA documents codesign --remove-signature before inject and codesign --sign after). Preserving a pre-injection signature is not the documented contract.'
    );
  }

  if (requireRelocatedContent) {
    const link = injected.commands.find(cmd => cmd.cmd === LC_SEGMENT_64 && cmd.name === '__LINKEDIT');
    const auditKey = /SYMTAB|DYSYMTAB|DYLD_INFO|FUNCTION_STARTS|DATA_IN_CODE|LINKEDIT/;
    for (const field of original.offsetFields.filter(entry => auditKey.test(entry.key))) {
      if (!(field.size > 0)) continue;
      const match = injected.offsetFields.find(entry => entry.key === field.key);
      if (!match) {
        problems.push(`injected Mach-O dropped ${field.key}; remaining load-command offsets must still address relocated content`);
        continue;
      }
      const headLen = Math.min(field.size, 256);
      const origHead = machoBytesAt(originalBytes, field.offset, headLen);
      if (!origHead) continue;
      const atNew = machoBytesAt(injectedBytes, match.offset, headLen);
      if (atNew && atNew.equals(origHead)) continue;
      const relocatedAt = uniqueContentOffset(injectedBytes, origHead);
      if (relocatedAt != null) {
        if (match.offset !== relocatedAt) {
          problems.push(
            `${field.key} offset ${match.offset} does not point at actual relocated content at ${relocatedAt} (original ${field.offset}); page-aligned LIEF/postject relocation is not a sizeofcmds-delta shift`
          );
        }
        continue;
      }
      if (match.offset === field.offset) {
        problems.push(`${field.key} offset ${field.offset} was left stale after content relocation`);
      }
      if (link) {
        const linkEnd = link.fileoff + Math.max(link.filesize, 0);
        if (!(match.offset >= link.fileoff && match.offset <= linkEnd)) {
          problems.push(`${field.key} injected offset ${match.offset} is outside relocated __LINKEDIT [${link.fileoff}, ${linkEnd})`);
        }
      }
    }
  }

  const sea = injected.commands.find(cmd => cmd.cmd === LC_SEGMENT_64 && cmd.name === SEA_SEGMENT_NAME);
  if (!sea) problems.push(`must contain Mach-O segment ${SEA_SEGMENT_NAME}`);
  else {
    if (!(sea.filesize > 0)) problems.push(`${SEA_SEGMENT_NAME} filesize must be nonzero`);
    if (!(sea.vmsize > 0)) problems.push(`${SEA_SEGMENT_NAME} vmsize must be nonzero (zero-VM SEA segment is invalid)`);
    if (sea.vmsize < sea.filesize) {
      problems.push(`${SEA_SEGMENT_NAME} vmsize ${sea.vmsize} must cover filesize ${sea.filesize}`);
    }
    for (const other of injected.commands.filter(cmd => cmd.cmd === LC_SEGMENT_64 && cmd !== sea)) {
      if (rangesOverlap(sea.vmaddr, sea.vmaddr + sea.vmsize, other.vmaddr, other.vmaddr + other.vmsize)) {
        problems.push(`${SEA_SEGMENT_NAME} VM range overlaps ${other.name} (vmaddr ${sea.vmaddr} vmsize ${sea.vmsize})`);
      }
    }
  }
  assert.deepEqual(problems, [], `${target} Mach-O container invariants failed:\n${problems.join('\n')}`);

  const located = locateSeaBlobIndependent(injectedBytes);
  assert.ok(located.blob && located.blob.length >= blob.length, `${target} independent parser must locate ${SEA_RESOURCE_NAME}`);
  assert.equal(
    located.blob.subarray(0, blob.length).equals(Buffer.from(blob)),
    true,
    `${target} independently located ${SEA_RESOURCE_NAME} must hash-match the injected blob`
  );
  assert.equal(sha256(located.blob.subarray(0, blob.length)), sha256(blob));
}

export function assertPeInjectionInvariants(originalBytes, injectedBytes, { blob, target }) {
  const original = parsePeIndependent(originalBytes);
  const injected = parsePeIndependent(injectedBytes);
  assert.equal(injected.arch, original.arch, `${target} PE architecture must be preserved`);
  const fuse = readSeaFuseIndependent(injectedBytes);
  assert.equal(fuse.present, true, `${target} injected PE must contain ${SEA_FUSE}`);
  assert.equal(fuse.enabled, true, `${target} injected PE must flip ${SEA_FUSE}:0 to :1`);

  const problems = [];
  const requiredImage = injected.vaEnd;
  if (injected.sizeOfImage < requiredImage) {
    problems.push(`SizeOfImage ${injected.sizeOfImage} is stale; it must cover the last section end ${requiredImage}`);
  }
  if (injected.sizeOfImage % (injected.sectionAlignment || 1) !== 0) {
    problems.push(`SizeOfImage must be a multiple of SectionAlignment ${injected.sectionAlignment}`);
  }
  if (injected.vaEnd > original.sizeOfImage && injected.sizeOfImage <= original.sizeOfImage) {
    problems.push(`SizeOfImage stayed ${original.sizeOfImage} after growing sections to ${injected.vaEnd}`);
  }

  const firstRaw = Math.min(...injected.sections.filter(s => s.pointerToRawData > 0).map(s => s.pointerToRawData));
  if (injected.sectionTableEnd > injected.sizeOfHeaders) {
    problems.push(`section table ends at ${injected.sectionTableEnd}, past SizeOfHeaders ${injected.sizeOfHeaders}; header space must be checked rather than assumed`);
  }
  if (injected.sectionTableEnd > firstRaw) {
    problems.push(`section-header write collides with section raw data (table end ${injected.sectionTableEnd}, first raw ${firstRaw}); header space must be checked rather than assumed`);
  }

  for (const sect of injected.sections) {
    if (sect.pointerToRawData && sect.pointerToRawData % injected.fileAlignment !== 0) {
      problems.push(`section ${sect.name} PointerToRawData ${sect.pointerToRawData} is not aligned to FileAlignment ${injected.fileAlignment}`);
    }
    if (sect.virtualAddress && sect.virtualAddress % injected.sectionAlignment !== 0) {
      problems.push(`section ${sect.name} VirtualAddress ${sect.virtualAddress} is not aligned to SectionAlignment ${injected.sectionAlignment}`);
    }
  }
  if (injected.fileAlignment !== original.fileAlignment) {
    problems.push(`must preserve original FileAlignment ${original.fileAlignment} rather than hardcoding 0x200`);
  }
  if (injected.sectionAlignment !== original.sectionAlignment) {
    problems.push(`must preserve original SectionAlignment ${original.sectionAlignment} rather than hardcoding 0x1000`);
  }

  const origRes = listPeResourcesIndependent(original);
  const injRes = listPeResourcesIndependent(injected);
  for (const entry of origRes) {
    const type = entry.chain[0] || {};
    const name = entry.chain[1] || {};
    const still = injRes.find(candidate => JSON.stringify(candidate.chain) === JSON.stringify(entry.chain));
    if (!still || !still.bytes.equals(entry.bytes)) {
      problems.push(`resource integrity: type=${type.id || type.name} name=${name.id || name.name} size=${entry.size} must survive injection`);
    }
  }
  const sea = injRes.find(entry => {
    const type = entry.chain[0] || {};
    const name = entry.chain[1] || {};
    return (type.id === PE_RT_RCDATA || String(type.name || '').toUpperCase() === 'RCDATA') && name.name === SEA_RESOURCE_NAME;
  });
  if (!sea) problems.push(`independent PE parser must locate RT_RCDATA ${SEA_RESOURCE_NAME}`);
  else if (!sea.bytes.subarray(0, blob.length).equals(Buffer.from(blob))) {
    problems.push(`independently located PE ${SEA_RESOURCE_NAME} must hash-match the injected blob`);
  }
  assert.deepEqual(problems, [], `${target} PE container invariants failed:\n${problems.join('\n')}`);
}

export function assertElfInjectionInvariants(originalBytes, injectedBytes, { blob, target }) {
  const original = parseElfIndependent(originalBytes);
  const injected = parseElfIndependent(injectedBytes);
  assert.equal(injected.arch, original.arch, `${target} ELF architecture must be preserved`);
  const fuse = readSeaFuseIndependent(injectedBytes);
  assert.equal(fuse.enabled, true, `${target} injected ELF must flip ${SEA_FUSE}:0 to :1`);
  const located = locateSeaBlobIndependent(injectedBytes);
  assert.ok(located.blob, `${target} independent ELF parser must locate PT_NOTE ${SEA_RESOURCE_NAME}`);
  assert.equal(located.blob.subarray(0, blob.length).equals(Buffer.from(blob)), true);
}

function padName(text, size) {
  const out = Buffer.alloc(size);
  Buffer.from(String(text), 'ascii').copy(out, 0, 0, size);
  return out;
}

function makeFuse(enabled) {
  return Buffer.from(`${SEA_FUSE}:${enabled ? '1' : '0'}\0`, 'utf8');
}

export function makeIndependentMacho({ arch = 'arm64' } = {}) {
  const fuse = makeFuse(false);
  const textPayload = Buffer.concat([Buffer.from([0x90, 0x90, 0xc3]), fuse, Buffer.from('TEXTDATA')]);
  const rebase = Buffer.from('REBASEBLOB_INDEPENDENT');
  const bind = Buffer.from('BINDBLOB_INDEPENDENT');
  const exports = Buffer.from('EXPORTBLOB_INDEPENDENT');
  const nsyms = 2;
  const symtab = Buffer.alloc(nsyms * 16);
  const strtab = Buffer.from('\0_main\0_sea\0', 'ascii');
  const fstarts = Buffer.from('FUNCSTARTS_INDEPENDENT');
  const codesig = Buffer.from('CODESIG_INDEPENDENT_BLOB');
  const linkedit = Buffer.concat([rebase, bind, exports, fstarts, symtab, strtab, codesig]);

  const headerSize = 32;
  const pagezero = 72;
  const textCmd = 72 + 80;
  const linkCmd = 72;
  const dyldCmd = 48;
  const symCmd = 24;
  const dysymCmd = 80;
  const fstartCmd = 16;
  const sigCmd = 16;
  const ncmds = 8;
  const sizeofcmds = pagezero + textCmd + linkCmd + dyldCmd + symCmd + dysymCmd + fstartCmd + sigCmd;
  const textOff = alignUp(headerSize + sizeofcmds, 16);
  const linkOff = alignUp(textOff + textPayload.length, 16);
  const fileSize = alignUp(linkOff + linkedit.length, 16);
  const buf = Buffer.alloc(fileSize);
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeUInt32LE(arch === 'arm64' ? CPU_ARM64 : CPU_X86_64, 4);
  buf.writeUInt32LE(arch === 'arm64' ? 0 : 3, 8);
  buf.writeUInt32LE(2, 12);
  buf.writeUInt32LE(ncmds, 16);
  buf.writeUInt32LE(sizeofcmds, 20);

  let off = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, off);
  buf.writeUInt32LE(pagezero, off + 4);
  padName('__PAGEZERO', 16).copy(buf, off + 8);
  buf.writeBigUInt64LE(0n, off + 24);
  buf.writeBigUInt64LE(0x100000000n, off + 32);
  off += pagezero;

  buf.writeUInt32LE(LC_SEGMENT_64, off);
  buf.writeUInt32LE(textCmd, off + 4);
  padName('__TEXT', 16).copy(buf, off + 8);
  buf.writeBigUInt64LE(0x100000000n, off + 24);
  buf.writeBigUInt64LE(0x1000n, off + 32);
  buf.writeBigUInt64LE(0n, off + 40);
  buf.writeBigUInt64LE(BigInt(textOff + textPayload.length), off + 48);
  buf.writeUInt32LE(7, off + 56);
  buf.writeUInt32LE(5, off + 60);
  buf.writeUInt32LE(1, off + 64);
  const sect = off + 72;
  padName('__text', 16).copy(buf, sect);
  padName('__TEXT', 16).copy(buf, sect + 16);
  buf.writeBigUInt64LE(0x100000000n + BigInt(textOff), sect + 32);
  buf.writeBigUInt64LE(BigInt(textPayload.length), sect + 40);
  buf.writeUInt32LE(textOff, sect + 48);
  buf.writeUInt32LE(4, sect + 52);
  off += textCmd;

  buf.writeUInt32LE(LC_SEGMENT_64, off);
  buf.writeUInt32LE(linkCmd, off + 4);
  padName('__LINKEDIT', 16).copy(buf, off + 8);
  buf.writeBigUInt64LE(0x100001000n, off + 24);
  buf.writeBigUInt64LE(0x1000n, off + 32);
  buf.writeBigUInt64LE(BigInt(linkOff), off + 40);
  buf.writeBigUInt64LE(BigInt(linkedit.length), off + 48);
  off += linkCmd;

  let cursor = linkOff;
  const rebaseOff = cursor; cursor += rebase.length;
  const bindOff = cursor; cursor += bind.length;
  const exportOff = cursor; cursor += exports.length;
  const fstartOff = cursor; cursor += fstarts.length;
  const symOff = cursor; cursor += symtab.length;
  const strOff = cursor; cursor += strtab.length;
  const sigOff = cursor;

  buf.writeUInt32LE(LC_DYLD_INFO_ONLY, off);
  buf.writeUInt32LE(dyldCmd, off + 4);
  buf.writeUInt32LE(rebaseOff, off + 8);
  buf.writeUInt32LE(rebase.length, off + 12);
  buf.writeUInt32LE(bindOff, off + 16);
  buf.writeUInt32LE(bind.length, off + 20);
  buf.writeUInt32LE(0, off + 24);
  buf.writeUInt32LE(0, off + 28);
  buf.writeUInt32LE(0, off + 32);
  buf.writeUInt32LE(0, off + 36);
  buf.writeUInt32LE(exportOff, off + 40);
  buf.writeUInt32LE(exports.length, off + 44);
  off += dyldCmd;

  buf.writeUInt32LE(LC_SYMTAB, off);
  buf.writeUInt32LE(symCmd, off + 4);
  buf.writeUInt32LE(symOff, off + 8);
  buf.writeUInt32LE(nsyms, off + 12);
  buf.writeUInt32LE(strOff, off + 16);
  buf.writeUInt32LE(strtab.length, off + 20);
  off += symCmd;

  buf.writeUInt32LE(LC_DYSYMTAB, off);
  buf.writeUInt32LE(dysymCmd, off + 4);
  off += dysymCmd;

  buf.writeUInt32LE(LC_FUNCTION_STARTS, off);
  buf.writeUInt32LE(fstartCmd, off + 4);
  buf.writeUInt32LE(fstartOff, off + 8);
  buf.writeUInt32LE(fstarts.length, off + 12);
  off += fstartCmd;

  buf.writeUInt32LE(LC_CODE_SIGNATURE, off);
  buf.writeUInt32LE(sigCmd, off + 4);
  buf.writeUInt32LE(sigOff, off + 8);
  buf.writeUInt32LE(codesig.length, off + 12);

  textPayload.copy(buf, textOff);
  linkedit.copy(buf, linkOff);
  return buf;
}

export function makeIndependentPe({
  arch = 'x64',
  fileAlignment = 0x200,
  sectionAlignment = 0x1000,
  overlay = Buffer.from('PE_OVERLAY_INDEPENDENT_JOBSSS'),
  tightHeaders = false,
  includeVersionResource = true
} = {}) {
  const fuse = makeFuse(false);
  const eLfanew = 0x40;
  const optSize = 0xf0;
  const coffOff = eLfanew + 4;
  const optOff = coffOff + 20;
  const sectOff = optOff + optSize;
  // Pinned postject (LIEF inject_into_pe) returns kError when !has_resources().
  // Independently sourced PE fixtures used for injection therefore carry a
  // resource directory; identifyExecutable still accepts resource-less PEs.
  const sectionCount = tightHeaders ? 4 : includeVersionResource ? 2 : 1;
  const tableEnd = sectOff + sectionCount * 40;
  const sizeOfHeaders = tightHeaders ? 0x200 : alignUp(tableEnd + 80, fileAlignment);
  const rawOff = sizeOfHeaders;
  const textRaw = alignUp(Math.max(0x80, fuse.length + 16), fileAlignment);
  const bufSize = rawOff + textRaw * sectionCount + overlay.length + (includeVersionResource ? 0x200 : 0);
  const buf = Buffer.alloc(alignUp(bufSize, fileAlignment) + overlay.length);
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(eLfanew, 0x3c);
  PE_SIGNATURE.copy(buf, eLfanew);
  buf.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, coffOff);
  buf.writeUInt16LE(sectionCount, coffOff + 2);
  buf.writeUInt16LE(optSize, coffOff + 16);
  buf.writeUInt16LE(0x0022, coffOff + 18);
  buf.writeUInt16LE(0x20b, optOff);
  buf.writeUInt32LE(textRaw, optOff + 16);
  buf.writeBigUInt64LE(0x140000000n, optOff + 24);
  buf.writeUInt32LE(sectionAlignment, optOff + 32);
  buf.writeUInt32LE(fileAlignment, optOff + 36);
  buf.writeUInt16LE(6, optOff + 40);
  buf.writeUInt16LE(0, optOff + 48);
  buf.writeUInt16LE(3, optOff + 68);
  const imageSize = alignUp(sectionAlignment + sectionAlignment * sectionCount, sectionAlignment);
  buf.writeUInt32LE(imageSize, optOff + 56);
  buf.writeUInt32LE(sizeOfHeaders, optOff + 60);
  buf.writeUInt32LE(16, optOff + 108);

  for (let i = 0; i < sectionCount; i += 1) {
    const off = sectOff + i * 40;
    const name = i === 0 ? '.text' : i === 1 ? '.rdata' : i === 2 ? '.data' : '.pdata';
    padName(name, 8).copy(buf, off);
    buf.writeUInt32LE(textRaw, off + 8);
    buf.writeUInt32LE(sectionAlignment * (i + 1), off + 12);
    buf.writeUInt32LE(textRaw, off + 16);
    buf.writeUInt32LE(rawOff + i * textRaw, off + 20);
    buf.writeUInt32LE(0x60000020, off + 36);
  }
  fuse.copy(buf, rawOff + 0x80);
  if (includeVersionResource && sectionCount >= 2) {
    const resSect = 1;
    const resRva = sectionAlignment * (resSect + 1);
    const resRaw = rawOff + resSect * textRaw;
    buf.writeUInt32LE(resRva, optOff + 112 + 16);
    buf.writeUInt32LE(0x40, optOff + 112 + 20);
    buf.writeUInt16LE(0, resRaw + 12);
    buf.writeUInt16LE(1, resRaw + 14);
    buf.writeUInt32LE(PE_RT_VERSION, resRaw + 16);
    buf.writeUInt32LE(0, resRaw + 20);
  }
  const usedRawEnd = rawOff + textRaw * sectionCount;
  overlay.copy(buf, usedRawEnd);
  return Buffer.from(buf.subarray(0, usedRawEnd + overlay.length));
}

export const INDEPENDENT_BLOB = Buffer.from('JOBSSS_INDEPENDENT_NATIVE_BLOB_v1');
