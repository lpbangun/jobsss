#!/usr/bin/env python3
# Independent build/evidence validator: imports only pinned pefile/macholib.
import hashlib, json, os, sys
kind, target = sys.argv[1], sys.argv[2]
SENTINEL = b'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
def digest(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
def align_up(v, a):
    return ((v + a - 1) // a) * a
def case_id(kind, name):
    if name.lower().endswith(".exe"):
        name = name[:-4]
    if kind == "pe":
        if name.startswith("injected-"):
            return "win-x64-after"
        if name.startswith("official-"):
            return "win-x64-before"
        return name
    return name.replace("injected-", "").replace("official-", "")
def in_bounds(off, size, file_size):
    return isinstance(off, int) and off >= 0 and size >= 0 and off + size <= file_size
def sibling_path(target):
    d = os.path.dirname(target)
    b = os.path.basename(target)
    if b.startswith("injected-"):
        return os.path.join(d, "official-" + b[len("injected-"):])
    if b.startswith("official-"):
        return os.path.join(d, "injected-" + b[len("official-"):])
    return None
data = open(target, "rb").read()
file_size = len(data)
report = {
    "case": case_id(kind, os.path.basename(target)),
    "kind": kind,
    "basename": os.path.basename(target),
    "sha256": digest(target),
    "validators": {
        "pefile": getattr(__import__("pefile", fromlist=["__version__"]), "__version__", "2024.8.26"),
        "macholib": getattr(__import__("macholib", fromlist=["__version__"]), "__version__", "1.16.3"),
    },
}
if kind == "pe":
    import pefile
    pe = pefile.PE(target)
    opt = pe.OPTIONAL_HEADER
    machine = int(pe.FILE_HEADER.Machine)
    report["format"] = "pe"
    report["arch"] = "x64" if machine == 0x8664 else ("arm64" if machine == 0xAA64 else str(machine))
    sdir = opt.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]]
    overlay = pe.get_overlay() or b""
    overlay_off = pe.get_overlay_data_start_offset()
    resources = []
    blob_res = None
    if hasattr(pe, "DIRECTORY_ENTRY_RESOURCE"):
        for dtype in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            type_name = str(dtype.name) if dtype.name is not None else str(pefile.RESOURCE_TYPE.get(dtype.id, dtype.id))
            if not dtype.directory:
                continue
            for dname in dtype.directory.entries:
                name = str(dname.name) if dname.name is not None else str(dname.id)
                if not dname.directory:
                    continue
                for lng in dname.directory.entries:
                    language = str(lng.id)
                    res_entry = {"type": type_name, "name": name, "language": language}
                    if hasattr(lng, "data") and lng.data is not None:
                        ds = lng.data.struct
                        rva2 = int(ds.OffsetToData)
                        size2 = int(ds.Size)
                        res_entry["size"] = size2
                        try:
                            rb = pe.get_data(rva2, size2)
                            res_entry["sha256"] = hashlib.sha256(rb).hexdigest()
                        except Exception:
                            res_entry["sha256"] = None
                        if type_name == "RT_RCDATA" and name == "NODE_SEA_BLOB":
                            blob_res = {"rva": rva2, "size": size2}
                    resources.append(res_entry)
    sa = int(opt.SectionAlignment)
    fa = int(opt.FileAlignment)
    sections = []
    section_inputs = []
    max_img_end = 0
    raw_in_bounds = True
    virt_in_bounds = True
    e_lfanew = int(pe.DOS_HEADER.e_lfanew)
    sect_table_end = e_lfanew + 24 + int(pe.FILE_HEADER.SizeOfOptionalHeader) + int(pe.FILE_HEADER.NumberOfSections) * 40
    headers_img = align_up(sect_table_end, sa)
    for s in pe.sections:
        va = int(s.VirtualAddress)
        vs = int(s.Misc_VirtualSize)
        rs = int(s.SizeOfRawData)
        ptr = int(s.PointerToRawData)
        sname = s.Name.decode("ascii", "replace").strip("\x00")
        mem = max(vs, rs)
        end = va + mem
        im_end = align_up(end, sa)
        sections.append({
            "name": sname,
            "virtualAddress": va,
            "virtualSize": vs,
            "pointerToRawData": ptr,
            "sizeOfRawData": rs,
        })
        section_inputs.append({
            "name": sname,
            "virtualAddress": va,
            "virtualSize": vs,
            "sizeOfRawData": rs,
            "memSize": mem,
            "sectionEnd": end,
            "alignedSectionEnd": im_end,
        })
        if ptr < 0 or rs < 0 or ptr + rs > file_size:
            raw_in_bounds = False
        if im_end > max_img_end:
            max_img_end = im_end
        if end > int(opt.SizeOfImage):
            virt_in_bounds = False
    computed_image = max(headers_img, max_img_end)
    report["pe"] = {
        "SizeOfImage": int(opt.SizeOfImage),
        "computedSizeOfImage": computed_image,
        "computedSizeOfImageInputs": {
            "fileSize": file_size,
            "headersEnd": sect_table_end,
            "headersAlignedToSectionAlignment": headers_img,
            "sections": section_inputs,
            "maxAlignedSectionEnd": max_img_end,
        },
        "FileAlignment": fa,
        "SectionAlignment": sa,
        "NumberOfSections": int(pe.FILE_HEADER.NumberOfSections),
        "security": {"fileOffset": int(sdir.VirtualAddress), "size": int(sdir.Size)},
        "overlayOffset": None if overlay_off is None else int(overlay_off),
        "overlaySize": len(overlay),
        "overlaySha256": hashlib.sha256(overlay).hexdigest() if overlay else None,
        "sectionRangesInBounds": raw_in_bounds and virt_in_bounds,
        "sections": sections,
        "resources": resources,
    }
    orig_cert = overlay if overlay else None
    if not orig_cert:
        sp = sibling_path(target)
        if sp and os.path.exists(sp):
            try:
                spe = pefile.PE(sp)
                so = spe.get_overlay() or b""
                if so:
                    orig_cert = so
            except Exception:
                orig_cert = None
    if orig_cert is not None:
        cert_restored = orig_cert in data
    else:
        cert_restored = bool(int(sdir.Size) > 0 and len(overlay) == int(sdir.Size))
    report["pe"]["originalCertificateSha256"] = hashlib.sha256(orig_cert).hexdigest() if orig_cert is not None else None
    report["pe"]["originalCertificateSize"] = len(orig_cert) if orig_cert is not None else None
    report["pe"]["certificateRestored"] = cert_restored
    report["pe"]["payloadLength"] = None
    report["pe"]["payloadSha256"] = None
    if blob_res is not None:
        payload_bytes = b""
        try:
            payload_bytes = pe.get_data(blob_res["rva"], blob_res["size"])
        except Exception:
            payload_bytes = b""
        report["pe"]["payloadLength"] = blob_res["size"]
        report["pe"]["payloadSha256"] = hashlib.sha256(payload_bytes).hexdigest()
    report["pe"]["fuse"] = {
        "present": SENTINEL in data,
        "enabled": (SENTINEL + b":1") in data,
    }
elif kind == "macho":
    from macholib.MachO import MachO
    from macholib.mach_o import (
        LC_CODE_SIGNATURE, LC_SEGMENT_64, LC_SYMTAB, LC_DYSYMTAB,
        LC_DYLD_INFO, LC_DYLD_INFO_ONLY, LC_FUNCTION_STARTS,
        LC_DATA_IN_CODE, LC_DYLD_EXPORTS_TRIE, LC_DYLD_CHAINED_FIXUPS,
        LC_DYLIB_CODE_SIGN_DRS,
        nlist_64, dylib_module_64, dylib_table_of_contents,
        dylib_reference, relocation_info,
    )
    from macholib.ptypes import sizeof
    macho = MachO(target)
    header = macho.headers[0]
    cputype = int(header.header.cputype)
    report["format"] = "macho"
    report["arch"] = "x64" if cputype == 0x01000007 else ("arm64" if cputype == 0x0100000C else str(cputype))
    commands = []
    has_signature = False
    sea = None
    sea_section = None
    linkedit = None
    symtab = None
    dysymtab = None
    exports = None
    chained = None
    func_starts = None
    data_in_code = None
    segments = []
    for load, cmd, raw_cmd in header.commands:
        cmd_id = int(getattr(load, "cmd", 0))
        name = type(cmd).__name__
        rec = {"name": name, "cmd": cmd_id}
        if name == "segment_command_64":
            segname = cmd.segname.decode("ascii", "replace").strip("\x00")
            rec["segname"] = segname
            rec["vmaddr"] = int(cmd.vmaddr)
            rec["vmsize"] = int(cmd.vmsize)
            rec["fileoff"] = int(cmd.fileoff)
            rec["filesize"] = int(cmd.filesize)
            rec["nsects"] = int(cmd.nsects)
            sects = []
            if isinstance(raw_cmd, list):
                for s in raw_cmd:
                    sects.append({
                        "sectname": s.sectname.decode("ascii", "replace").strip("\x00"),
                        "segname": s.segname.decode("ascii", "replace").strip("\x00"),
                        "addr": int(s.addr),
                        "size": int(s.size),
                        "offset": int(s.offset),
                        "align": int(s.align),
                    })
            rec["sections"] = sects
            segments.append(rec)
            if segname == "NODE_SEA":
                sea = rec
            if segname == "__LINKEDIT":
                linkedit = rec
            for srec in sects:
                if segname == "NODE_SEA":
                    sea_section = srec
        elif cmd_id == int(LC_SYMTAB) or name == "symtab_command":
            symtab = {"symoff": int(cmd.symoff), "nsyms": int(cmd.nsyms), "stroff": int(cmd.stroff), "strsize": int(cmd.strsize)}
            rec["symtab"] = symtab
        elif cmd_id == int(LC_DYSYMTAB) or name == "dysymtab_command":
            dysymtab = {
                "ilocalsym": int(cmd.ilocalsym), "nlocalsym": int(cmd.nlocalsym),
                "iextdefsym": int(cmd.iextdefsym), "nextdefsym": int(cmd.nextdefsym),
                "iundefsym": int(cmd.iundefsym), "nundefsym": int(cmd.nundefsym),
                "tocoff": int(cmd.tocoff), "ntoc": int(cmd.ntoc),
                "modtaboff": int(cmd.modtaboff), "nmodtab": int(cmd.nmodtab),
                "extrefsymoff": int(cmd.extrefsymoff), "nextrefsyms": int(cmd.nextrefsyms),
                "indirectsymoff": int(cmd.indirectsymoff), "nindirectsyms": int(cmd.nindirectsyms),
                "extreloff": int(cmd.extreloff), "nextrel": int(cmd.nextrel),
                "locreloff": int(cmd.locreloff), "nlocrel": int(cmd.nlocrel),
            }
            rec["dysymtab"] = dysymtab
        elif cmd_id in (int(LC_DYLD_INFO), int(LC_DYLD_INFO_ONLY)) or name == "dyld_info_command":
            d = {
                "rebase_off": int(cmd.rebase_off), "rebase_size": int(cmd.rebase_size),
                "bind_off": int(cmd.bind_off), "bind_size": int(cmd.bind_size),
                "weak_bind_off": int(cmd.weak_bind_off), "weak_bind_size": int(cmd.weak_bind_size),
                "lazy_bind_off": int(cmd.lazy_bind_off), "lazy_bind_size": int(cmd.lazy_bind_size),
                "export_off": int(cmd.export_off), "export_size": int(cmd.export_size),
            }
            rec["dyldInfo"] = d
            if exports is None and d["export_size"] > 0:
                exports = {"present": True, "dataoff": d["export_off"], "datasize": d["export_size"], "source": "LC_DYLD_INFO"}
        elif name == "entry_point_command":
            rec["entryoff"] = int(cmd.entryoff)
            rec["stacksize"] = int(cmd.stacksize)
        elif name in ("linkedit_data_command", "dyld_trie_command"):
            dataoff = int(getattr(cmd, "dataoff", 0))
            datasize = int(getattr(cmd, "datasize", 0))
            rec["dataoff"] = dataoff
            rec["datasize"] = datasize
            if cmd_id == int(LC_DYLD_EXPORTS_TRIE):
                exports = {"present": True, "dataoff": dataoff, "datasize": datasize, "source": "LC_DYLD_EXPORTS_TRIE"}
            elif cmd_id == int(LC_DYLD_CHAINED_FIXUPS):
                chained = {"present": True, "dataoff": dataoff, "datasize": datasize}
            elif cmd_id == int(LC_FUNCTION_STARTS):
                func_starts = {"present": True, "dataoff": dataoff, "datasize": datasize}
            elif cmd_id == int(LC_DATA_IN_CODE):
                data_in_code = {"present": True, "dataoff": dataoff, "datasize": datasize}
        if cmd_id == int(LC_CODE_SIGNATURE):
            has_signature = True
        commands.append(rec)
    checks = []
    def add_check(ckind, cname, coff, csize):
        checks.append({"kind": ckind, "name": cname, "offset": int(coff), "size": int(csize), "inBounds": in_bounds(coff, csize, file_size)})
    for seg in segments:
        add_check("segment", seg["segname"], seg["fileoff"], seg["filesize"])
        for srec in seg["sections"]:
            if int(srec["offset"]) > 0:
                add_check("section", seg["segname"] + "/" + srec["sectname"], srec["offset"], srec["size"])
    if symtab is not None:
        add_check("LC_SYMTAB", "symoff", symtab["symoff"], symtab["nsyms"] * sizeof(nlist_64))
        add_check("LC_SYMTAB", "stroff", symtab["stroff"], symtab["strsize"])
    if dysymtab is not None:
        add_check("LC_DYSYMTAB", "toc", dysymtab["tocoff"], dysymtab["ntoc"] * sizeof(dylib_table_of_contents))
        add_check("LC_DYSYMTAB", "modtab", dysymtab["modtaboff"], dysymtab["nmodtab"] * sizeof(dylib_module_64))
        add_check("LC_DYSYMTAB", "extrefsym", dysymtab["extrefsymoff"], dysymtab["nextrefsyms"] * sizeof(dylib_reference))
        add_check("LC_DYSYMTAB", "indirectsym", dysymtab["indirectsymoff"], dysymtab["nindirectsyms"] * 4)
        add_check("LC_DYSYMTAB", "extrel", dysymtab["extreloff"], dysymtab["nextrel"] * sizeof(relocation_info))
        add_check("LC_DYSYMTAB", "locrel", dysymtab["locreloff"], dysymtab["nlocrel"] * sizeof(relocation_info))
    for rec in commands:
        if "dyldInfo" in rec:
            d = rec["dyldInfo"]
            for k in ("rebase_off", "bind_off", "weak_bind_off", "lazy_bind_off", "export_off"):
                add_check("LC_DYLD_INFO", k, d[k], d[k[:-4] + "_size"])
        if "dataoff" in rec:
            add_check("linkedit_data", rec["name"], rec["dataoff"], rec["datasize"])
        if rec.get("entryoff") is not None:
            add_check("LC_MAIN", "entryoff", rec["entryoff"], 0)
    offset_ok = all(ck["inBounds"] for ck in checks)
    for seg in segments:
        seg["fileEnd"] = seg["fileoff"] + seg["filesize"]
        seg["fileInBounds"] = in_bounds(seg["fileoff"], seg["filesize"], file_size)
        seg["fileAligned"] = seg["filesize"] == 0 or seg["fileoff"] % 0x1000 == 0
        seg["vmAligned"] = seg["vmsize"] == 0 or seg["vmaddr"] % 0x1000 == 0
    ranges = [(seg["fileoff"], seg["fileoff"] + seg["filesize"]) for seg in segments if seg["filesize"] > 0]
    ranges.sort()
    non_overlap = True
    for i in range(len(ranges) - 1):
        if ranges[i][1] > ranges[i + 1][0]:
            non_overlap = False
    aligned = all(seg["fileAligned"] and seg["vmAligned"] for seg in segments)
    payload = None
    if sea_section is not None and in_bounds(int(sea_section["offset"]), int(sea_section["size"]), file_size):
        payload = data[int(sea_section["offset"]):int(sea_section["offset"]) + int(sea_section["size"])]
    le_before = None
    sp = sibling_path(target)
    if sp and os.path.exists(sp):
        try:
            sm = MachO(sp)
            sh = sm.headers[0]
            for load2, cmd2, raw2 in sh.commands:
                if type(cmd2).__name__ == "segment_command_64":
                    segn2 = cmd2.segname.decode("ascii", "replace").strip("\x00")
                    if segn2 == "__LINKEDIT":
                        le_before = int(cmd2.fileoff)
                        break
        except Exception:
            le_before = None
    st_after = int(linkedit["fileoff"]) if linkedit is not None else None
    relocated_flag = True
    delta = None
    if le_before is not None and st_after is not None:
        relocated_flag = st_after > le_before
        delta = st_after - le_before
    report["macho"] = {
        "ncmds": int(header.header.ncmds),
        "sizeofcmds": int(header.header.sizeofcmds),
        "hasCodeSignature": has_signature,
        "fileOffsetCommandsInBounds": offset_ok,
        "fileOffsetChecks": checks,
        "segmentsNonOverlapping": non_overlap,
        "segmentsAligned": aligned,
        "segmentOrder": [seg["segname"] for seg in segments],
        "NODE_SEA": sea,
        "NODE_SEA_BLOB": sea_section,
        "LINKEDIT": (dict(linkedit, relocated=relocated_flag, delta=delta, beforeFileoff=le_before) if linkedit is not None else None),
        "symtab": symtab,
        "dysymtab": dysymtab,
        "exports": exports or {"present": False},
        "chainedFixups": chained or {"present": False},
        "functionStarts": func_starts or {"present": False},
        "dataInCode": data_in_code or {"present": False},
        "payloadLength": (len(payload) if payload is not None else None),
        "payloadSha256": (hashlib.sha256(payload).hexdigest() if payload is not None else None),
        "fuse": {
            "present": SENTINEL in data,
            "enabled": (SENTINEL + b":1") in data,
        },
        "commands": commands,
    }
else:
    raise SystemExit("unsupported kind " + kind)
json.dump(report, sys.stdout, sort_keys=True, separators=(",", ":"))
sys.stdout.write("\n")

