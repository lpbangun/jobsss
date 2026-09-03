# JobSSS Release Report

Published base commit: **803135995782e36cbf9427ac903a2e26d2952383**
(origin/main, pushed); this report covers the B61–B64 independent-validator
evidence corrections applied on top of it. Historical identities preserved:
intermediate **ba2123ef5f6f24bcf6ae994a125b67501b970785** (`Productize
standalone JobSSS plugin`), intermediate **8b2db255e7868397d336f8b015c489552b84bf0e**,
and superseded pre-audit SHA **0b962bee448133eff9db6c953894e4ba360db79e**.
The final corrective SHA is supplied in the final response.

## Release summary

JobSSS ships as a portable Agent Plugin whose source of truth is the
repository root (`plugin.json`, `mcp.json`, `skills/jobsss/`, `bin/jobsss`,
`src/`). `./bin/jobsss release --out <absdir> --target <id>` produces a
downloadable, deterministic, portable release tree per target:

- `current-host` — standalone `bin/jobsss` built from the host's own Node
  executable with a Node SEA payload, plus the canonical plugin core and
  justified metadata (`LICENSE`, `README.md`, `release-manifest.json`).
- `linux-x64`, `linux-arm64` — ELF64 little-endian definitions (PT_NOTE
  `NODE_SEA_BLOB` injection via pinned postject).
- `darwin-x64`, `darwin-arm64` — Mach-O 64 definitions (`NODE_SEA`
  `LC_SEGMENT_64` section injection via pinned postject
  `--macho-segment-name NODE_SEA`).
- `win-x64` — PE32+ definition (RCDATA `NODE_SEA_BLOB` resource injection
  via pinned postject). Signed official `node.exe` is staged unsigned
  (Security certificate-table directory zeroed in a private copy; pinned
  postject drops the certificate bytes) and must be re-signed on a
  matching Windows host.

All native-format definitions live in `src/packaging.js`, separated from MCP
tools, domain behavior, scoring, authority, and client adapters, and are
selected explicitly by target. Injection tooling is pinned in
`src/packaging.lock.json`: postject 1.0.0-alpha.6 at
`https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`
(SHA-256 `d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92`)
and official Node v22.22.3 inputs (build-only, temporary cache only).
`--node-binary` accepts only the checksum-pinned official executable for
that target. Empty `JOBSSS_NATIVE_CACHE` downloads the exact postject
tarball over HTTPS via a synchronous build-only child, verifies the pinned
SHA-256 before extraction, and writes the cache outside the plugin tree.

Two clean current-host builds were byte-identical for the complete `--out`
tree (11 files). Released `bin/jobsss` sha256
`7ee8a77c3648aed8afa3912b4517f1e669790c7c3e694020ff05d665ac8eefe9`.
No release file or printable binary string contains build-user, workspace,
source-checkout, scratch, or output paths. (The only `/home/` string inside
the artifact is the Node distribution's own embedded OpenSSL build path
`/home/iojs/build/ws/...`.)

Independent native-format validation against checksum-pinned official Node
v22.22.3 darwin-arm64 / darwin-x64 / win-x64 / linux-x64 / linux-arm64
executables, using pinned pefile 2024.8.26 / macholib 1.16.3 / altgraph
0.17.4: Mach-O LC_SYMTAB / linkedit offsets point at relocated content
after page-aligned NODE_SEA insertion; LC_CODE_SIGNATURE is removed
(documented postject / Node SEA re-signing semantics); PE SizeOfImage is
90009600 covering the last section; original resources and FileAlignment
0x200 / SectionAlignment 0x1000 hold; Security directory fileOffset/size
are 0; overlaySize 0; fuse and payload hash hold. An unsupported
non-certificate overlay (trailing bytes not exactly the Security
certificate table) fails before mutation or tool acquisition. Single
authoritative plugin/runtime version is **0.1.0** (plugin.json,
`src/cli.js` help, and release-manifest agree). darwin-x64 / darwin-arm64 /
win-x64 remain unverified as runtime platforms.

Pinned validator identities (verified wheels on isolated `PYTHONPATH`):

- pefile 2024.8.26
  `https://files.pythonhosted.org/packages/54/16/12b82f791c7f50ddec566873d5bdd245baa1491bac11d15ffb98aecc8f8b/pefile-2024.8.26-py3-none-any.whl`
  SHA-256 `76f8b485dcd3b1bb8166f1128d395fa3d87af26360c2358fb75b80019b957c6f`
- macholib 1.16.3
  `https://files.pythonhosted.org/packages/d1/5d/c059c180c84f7962db0aeae7c3b9303ed1d73d76f2bfbc32bc231c8be314/macholib-1.16.3-py2.py3-none-any.whl`
  SHA-256 `0e315d7583d38b8c77e815b1ecbdbf504a8258d8b3e17b61165c6feb60d18f2c`
- altgraph 0.17.4
  `https://files.pythonhosted.org/packages/4d/3f/3bc3f1d83f6e4a7fcb834d3720544ca597590425be5ba9db032b2bf322a2/altgraph-0.17.4-py2.py3-none-any.whl`
  SHA-256 `642743b4750de17e655e6711601b077bc6598dbfa3ba5fa2b2a35ce12b508dff`

The complete canonical validator JSON recorded by the pinned validators
(darwin-x64 after injection, darwin-arm64 after injection, win-x64 before
injection, win-x64 after injection) is:

```json
{"arch":"x64","basename":"injected-darwin-x64","case":"darwin-x64","format":"macho","kind":"macho","macho":{"LINKEDIT":{"beforeFileoff":88850432,"cmd":25,"delta":4096,"fileAligned":true,"fileEnd":114287144,"fileInBounds":true,"fileoff":88854528,"filesize":25432616,"name":"segment_command_64","nsects":0,"relocated":true,"sections":[],"segname":"__LINKEDIT","vmAligned":true,"vmaddr":4384014336,"vmsize":25436160},"NODE_SEA":{"cmd":25,"fileAligned":true,"fileEnd":88850487,"fileInBounds":true,"fileoff":88850432,"filesize":55,"name":"segment_command_64","nsects":1,"sections":[{"addr":4384010240,"align":0,"offset":88850432,"sectname":"__NODE_SEA_BLOB","segname":"NODE_SEA","size":55}],"segname":"NODE_SEA","vmAligned":true,"vmaddr":4384010240,"vmsize":4096},"NODE_SEA_BLOB":{"addr":4384010240,"align":0,"offset":88850432,"sectname":"__NODE_SEA_BLOB","segname":"NODE_SEA","size":55},"chainedFixups":{"present":false},"commands":[{"cmd":25,"fileAligned":true,"fileEnd":0,"fileInBounds":true,"fileoff":0,"filesize":0,"name":"segment_command_64","nsects":0,"sections":[],"segname":"__PAGEZERO","vmAligned":true,"vmaddr":0,"vmsize":4294967296},{"cmd":25,"fileAligned":true,"fileEnd":87158784,"fileInBounds":true,"fileoff":0,"filesize":87158784,"name":"segment_command_64","nsects":9,"sections":[{"addr":4294970816,"align":6,"offset":3520,"sectname":"__text","segname":"__TEXT","size":36301418},{"addr":4331272234,"align":1,"offset":36304938,"sectname":"__stubs","segname":"__TEXT","size":3696},{"addr":4331275930,"align":0,"offset":36308634,"sectname":"__stub_helper","segname":"__TEXT","size":5636},{"addr":4331281600,"align":6,"offset":36314304,"sectname":"__const","segname":"__TEXT","size":40096512},{"addr":4371378112,"align":4,"offset":76410816,"sectname":"__cstring","segname":"__TEXT","size":9977877},{"addr":4381356032,"align":12,"offset":86388736,"sectname":"__lpstub","segname":"__TEXT","size":432},{"addr":4381356464,"align":4,"offset":86389168,"sectname":"__ustring","segname":"__TEXT","size":559476},{"addr":4381915952,"align":4,"offset":86948656,"sectname":"__oslogstring","segname":"__TEXT","size":22},{"addr":4381915976,"align":2,"offset":86948680,"sectname":"__unwind_info","segname":"__TEXT","size":208792}],"segname":"__TEXT","vmAligned":true,"vmaddr":4294967296,"vmsize":87158784},{"cmd":25,"fileAligned":true,"fileEnd":88686592,"fileInBounds":true,"fileoff":87158784,"filesize":1527808,"name":"segment_command_64","nsects":4,"sections":[{"addr":4382126080,"align":3,"offset":87158784,"sectname":"__got","segname":"__DATA_CONST","size":13312},{"addr":4382139392,"align":3,"offset":87172096,"sectname":"__mod_init_func","segname":"__DATA_CONST","size":288},{"addr":4382142464,"align":12,"offset":87175168,"sectname":"__const","segname":"__DATA_CONST","size":1510056},{"addr":4383652520,"align":3,"offset":88685224,"sectname":"__cfstring","segname":"__DATA_CONST","size":128}],"segname":"__DATA_CONST","vmAligned":true,"vmaddr":4382126080,"vmsize":1527808},{"cmd":25,"fileAligned":true,"fileEnd":88850432,"fileInBounds":true,"fileoff":88686592,"filesize":163840,"name":"segment_command_64","nsects":7,"sections":[{"addr":4383653888,"align":3,"offset":88686592,"sectname":"__la_symbol_ptr","segname":"__DATA","size":4496},{"addr":4383662080,"align":12,"offset":88694784,"sectname":"__data","segname":"__DATA","size":152120},{"addr":4383814200,"align":3,"offset":88846904,"sectname":"__thread_vars","segname":"__DATA","size":696},{"addr":4383814896,"align":3,"offset":88847600,"sectname":"__thread_data","segname":"__DATA","size":4},{"addr":4383814904,"align":3,"offset":0,"sectname":"__thread_bss","segname":"__DATA","size":520},{"addr":4383815424,"align":6,"offset":0,"sectname":"__bss","segname":"__DATA","size":190728},{"addr":4384006160,"align":4,"offset":0,"sectname":"__common","segname":"__DATA","size":3574}],"segname":"__DATA","vmAligned":true,"vmaddr":4383653888,"vmsize":356352},{"cmd":25,"fileAligned":true,"fileEnd":88850487,"fileInBounds":true,"fileoff":88850432,"filesize":55,"name":"segment_command_64","nsects":1,"sections":[{"addr":4384010240,"align":0,"offset":88850432,"sectname":"__NODE_SEA_BLOB","segname":"NODE_SEA","size":55}],"segname":"NODE_SEA","vmAligned":true,"vmaddr":4384010240,"vmsize":4096},{"cmd":25,"fileAligned":true,"fileEnd":114287144,"fileInBounds":true,"fileoff":88854528,"filesize":25432616,"name":"segment_command_64","nsects":0,"sections":[],"segname":"__LINKEDIT","vmAligned":true,"vmaddr":4384014336,"vmsize":25436160},{"cmd":2147483682,"dyldInfo":{"bind_off":88894712,"bind_size":6368,"export_off":89133144,"export_size":1173520,"lazy_bind_off":89116472,"lazy_bind_size":16672,"rebase_off":88854528,"rebase_size":40184,"weak_bind_off":88901080,"weak_bind_size":215392},"name":"dyld_info_command"},{"cmd":2,"name":"symtab_command","symtab":{"nsyms":612404,"stroff":100284824,"strsize":14002320,"symoff":90474992}},{"cmd":11,"dysymtab":{"extrefsymoff":0,"extreloff":0,"iextdefsym":579956,"ilocalsym":0,"indirectsymoff":100273456,"iundefsym":611764,"locreloff":0,"modtaboff":0,"nextdefsym":31808,"nextrefsyms":0,"nextrel":0,"nindirectsyms":2842,"nlocalsym":579956,"nlocrel":0,"nmodtab":0,"ntoc":0,"nundefsym":640,"tocoff":0},"name":"dysymtab_command"},{"cmd":14,"name":"dylinker_command"},{"cmd":27,"name":"uuid_command"},{"cmd":50,"name":"build_version_command"},{"cmd":42,"name":"source_version_command"},{"cmd":2147483688,"entryoff":20157424,"name":"entry_point_command","stacksize":0},{"cmd":12,"name":"dylib_command"},{"cmd":12,"name":"dylib_command"},{"cmd":12,"name":"dylib_command"},{"cmd":12,"name":"dylib_command"},{"cmd":38,"dataoff":90306664,"datasize":168328,"name":"linkedit_data_command"},{"cmd":41,"dataoff":90474992,"datasize":0,"name":"linkedit_data_command"}],"dataInCode":{"dataoff":90474992,"datasize":0,"present":true},"dysymtab":{"extrefsymoff":0,"extreloff":0,"iextdefsym":579956,"ilocalsym":0,"indirectsymoff":100273456,"iundefsym":611764,"locreloff":0,"modtaboff":0,"nextdefsym":31808,"nextrefsyms":0,"nextrel":0,"nindirectsyms":2842,"nlocalsym":579956,"nlocrel":0,"nmodtab":0,"ntoc":0,"nundefsym":640,"tocoff":0},"exports":{"dataoff":89133144,"datasize":1173520,"present":true,"source":"LC_DYLD_INFO"},"fileOffsetChecks":[{"inBounds":true,"kind":"segment","name":"__PAGEZERO","offset":0,"size":0},{"inBounds":true,"kind":"segment","name":"__TEXT","offset":0,"size":87158784},{"inBounds":true,"kind":"section","name":"__TEXT/__text","offset":3520,"size":36301418},{"inBounds":true,"kind":"section","name":"__TEXT/__stubs","offset":36304938,"size":3696},{"inBounds":true,"kind":"section","name":"__TEXT/__stub_helper","offset":36308634,"size":5636},{"inBounds":true,"kind":"section","name":"__TEXT/__const","offset":36314304,"size":40096512},{"inBounds":true,"kind":"section","name":"__TEXT/__cstring","offset":76410816,"size":9977877},{"inBounds":true,"kind":"section","name":"__TEXT/__lpstub","offset":86388736,"size":432},{"inBounds":true,"kind":"section","name":"__TEXT/__ustring","offset":86389168,"size":559476},{"inBounds":true,"kind":"section","name":"__TEXT/__oslogstring","offset":86948656,"size":22},{"inBounds":true,"kind":"section","name":"__TEXT/__unwind_info","offset":86948680,"size":208792},{"inBounds":true,"kind":"segment","name":"__DATA_CONST","offset":87158784,"size":1527808},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__got","offset":87158784,"size":13312},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__mod_init_func","offset":87172096,"size":288},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__const","offset":87175168,"size":1510056},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__cfstring","offset":88685224,"size":128},{"inBounds":true,"kind":"segment","name":"__DATA","offset":88686592,"size":163840},{"inBounds":true,"kind":"section","name":"__DATA/__la_symbol_ptr","offset":88686592,"size":4496},{"inBounds":true,"kind":"section","name":"__DATA/__data","offset":88694784,"size":152120},{"inBounds":true,"kind":"section","name":"__DATA/__thread_vars","offset":88846904,"size":696},{"inBounds":true,"kind":"section","name":"__DATA/__thread_data","offset":88847600,"size":4},{"inBounds":true,"kind":"segment","name":"NODE_SEA","offset":88850432,"size":55},{"inBounds":true,"kind":"section","name":"NODE_SEA/__NODE_SEA_BLOB","offset":88850432,"size":55},{"inBounds":true,"kind":"segment","name":"__LINKEDIT","offset":88854528,"size":25432616},{"inBounds":true,"kind":"LC_SYMTAB","name":"symoff","offset":90474992,"size":9798464},{"inBounds":true,"kind":"LC_SYMTAB","name":"stroff","offset":100284824,"size":14002320},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"toc","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"modtab","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"extrefsym","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"indirectsym","offset":100273456,"size":11368},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"extrel","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"locrel","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"rebase_off","offset":88854528,"size":40184},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"bind_off","offset":88894712,"size":6368},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"weak_bind_off","offset":88901080,"size":215392},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"lazy_bind_off","offset":89116472,"size":16672},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"export_off","offset":89133144,"size":1173520},{"inBounds":true,"kind":"LC_MAIN","name":"entryoff","offset":20157424,"size":0},{"inBounds":true,"kind":"linkedit_data","name":"linkedit_data_command","offset":90306664,"size":168328},{"inBounds":true,"kind":"linkedit_data","name":"linkedit_data_command","offset":90474992,"size":0}],"fileOffsetCommandsInBounds":true,"functionStarts":{"dataoff":90306664,"datasize":168328,"present":true},"fuse":{"enabled":true,"present":true},"hasCodeSignature":false,"ncmds":20,"payloadLength":55,"payloadSha256":"42bdb3a3aa9c8957b79120bdc9f831d91165e10f245983ff4cdb703aa1e9b6f1","segmentOrder":["__PAGEZERO","__TEXT","__DATA_CONST","__DATA","NODE_SEA","__LINKEDIT"],"segmentsAligned":true,"segmentsNonOverlapping":true,"sizeofcmds":2728,"symtab":{"nsyms":612404,"stroff":100284824,"strsize":14002320,"symoff":90474992}},"sha256":"126fe3a7648c31efa9e82734c07f75b92d294022e2e4056f57d5aceefe69b8df","validators":{"macholib":"1.16.3","pefile":"2024.8.26"}}
```

```json
{"arch":"arm64","basename":"injected-darwin-arm64","case":"darwin-arm64","format":"macho","kind":"macho","macho":{"LINKEDIT":{"beforeFileoff":86605824,"cmd":25,"delta":16384,"fileAligned":true,"fileEnd":111788448,"fileInBounds":true,"fileoff":86622208,"filesize":25166240,"name":"segment_command_64","nsects":0,"relocated":true,"sections":[],"segname":"__LINKEDIT","vmAligned":true,"vmaddr":4381786112,"vmsize":25182208},"NODE_SEA":{"cmd":25,"fileAligned":true,"fileEnd":86605881,"fileInBounds":true,"fileoff":86605824,"filesize":57,"name":"segment_command_64","nsects":1,"sections":[{"addr":4381769728,"align":0,"offset":86605824,"sectname":"__NODE_SEA_BLOB","segname":"NODE_SEA","size":57}],"segname":"NODE_SEA","vmAligned":true,"vmaddr":4381769728,"vmsize":16384},"NODE_SEA_BLOB":{"addr":4381769728,"align":0,"offset":86605824,"sectname":"__NODE_SEA_BLOB","segname":"NODE_SEA","size":57},"chainedFixups":{"present":false},"commands":[{"cmd":25,"fileAligned":true,"fileEnd":0,"fileInBounds":true,"fileoff":0,"filesize":0,"name":"segment_command_64","nsects":0,"sections":[],"segname":"__PAGEZERO","vmAligned":true,"vmaddr":0,"vmsize":4294967296},{"cmd":25,"fileAligned":true,"fileEnd":85049344,"fileInBounds":true,"fileoff":0,"filesize":85049344,"name":"segment_command_64","nsects":9,"sections":[{"addr":4294983680,"align":14,"offset":16384,"sectname":"__text","segname":"__TEXT","size":33270788},{"addr":4328254468,"align":2,"offset":33287172,"sectname":"__stubs","segname":"__TEXT","size":7356},{"addr":4328261824,"align":2,"offset":33294528,"sectname":"__stub_helper","segname":"__TEXT","size":6732},{"addr":4328271872,"align":12,"offset":33304576,"sectname":"__const","segname":"__TEXT","size":41156096},{"addr":4369427968,"align":3,"offset":74460672,"sectname":"__cstring","segname":"__TEXT","size":9976253},{"addr":4379404222,"align":1,"offset":84436926,"sectname":"__ustring","segname":"__TEXT","size":559450},{"addr":4379963672,"align":0,"offset":84996376,"sectname":"__oslogstring","segname":"__TEXT","size":22},{"addr":4379963696,"align":2,"offset":84996400,"sectname":"__unwind_info","segname":"__TEXT","size":49032},{"addr":4380012728,"align":3,"offset":85045432,"sectname":"__eh_frame","segname":"__TEXT","size":2568}],"segname":"__TEXT","vmAligned":true,"vmaddr":4294967296,"vmsize":85049344},{"cmd":25,"fileAligned":true,"fileEnd":86409216,"fileInBounds":true,"fileoff":85049344,"filesize":1359872,"name":"segment_command_64","nsects":4,"sections":[{"addr":4380016640,"align":3,"offset":85049344,"sectname":"__got","segname":"__DATA_CONST","size":13120},{"addr":4380029760,"align":3,"offset":85062464,"sectname":"__mod_init_func","segname":"__DATA_CONST","size":288},{"addr":4380030048,"align":5,"offset":85062752,"sectname":"__const","segname":"__DATA_CONST","size":1340496},{"addr":4381370544,"align":3,"offset":86403248,"sectname":"__cfstring","segname":"__DATA_CONST","size":128}],"segname":"__DATA_CONST","vmAligned":true,"vmaddr":4380016640,"vmsize":1359872},{"cmd":25,"fileAligned":true,"fileEnd":86605824,"fileInBounds":true,"fileoff":86409216,"filesize":196608,"name":"segment_command_64","nsects":7,"sections":[{"addr":4381376512,"align":3,"offset":86409216,"sectname":"__la_symbol_ptr","segname":"__DATA","size":4472},{"addr":4381392896,"align":14,"offset":86425600,"sectname":"__data","segname":"__DATA","size":179408},{"addr":4381572304,"align":3,"offset":86605008,"sectname":"__thread_vars","segname":"__DATA","size":720},{"addr":4381573024,"align":3,"offset":86605728,"sectname":"__thread_data","segname":"__DATA","size":4},{"addr":4381573032,"align":3,"offset":0,"sectname":"__thread_bss","segname":"__DATA","size":528},{"addr":4381573568,"align":6,"offset":0,"sectname":"__bss","segname":"__DATA","size":183568},{"addr":4381757136,"align":4,"offset":0,"sectname":"__common","segname":"__DATA","size":3406}],"segname":"__DATA","vmAligned":true,"vmaddr":4381376512,"vmsize":393216},{"cmd":25,"fileAligned":true,"fileEnd":86605881,"fileInBounds":true,"fileoff":86605824,"filesize":57,"name":"segment_command_64","nsects":1,"sections":[{"addr":4381769728,"align":0,"offset":86605824,"sectname":"__NODE_SEA_BLOB","segname":"NODE_SEA","size":57}],"segname":"NODE_SEA","vmAligned":true,"vmaddr":4381769728,"vmsize":16384},{"cmd":25,"fileAligned":true,"fileEnd":111788448,"fileInBounds":true,"fileoff":86622208,"filesize":25166240,"name":"segment_command_64","nsects":0,"sections":[],"segname":"__LINKEDIT","vmAligned":true,"vmaddr":4381786112,"vmsize":25182208},{"cmd":2147483682,"dyldInfo":{"bind_off":86662080,"bind_size":6416,"export_off":86897912,"export_size":1159632,"lazy_bind_off":86881472,"lazy_bind_size":16440,"rebase_off":86622208,"rebase_size":39872,"weak_bind_off":86668496,"weak_bind_size":212976},"name":"dyld_info_command"},{"cmd":2,"name":"symtab_command","symtab":{"nsyms":607678,"stroff":97959600,"strsize":13828848,"symoff":88225504}},{"cmd":11,"dysymtab":{"extrefsymoff":0,"extreloff":0,"iextdefsym":575568,"ilocalsym":0,"indirectsymoff":97948352,"iundefsym":607040,"locreloff":0,"modtaboff":0,"nextdefsym":31472,"nextrefsyms":0,"nextrel":0,"nindirectsyms":2812,"nlocalsym":575568,"nlocrel":0,"nmodtab":0,"ntoc":0,"nundefsym":638,"tocoff":0},"name":"dysymtab_command"},{"cmd":14,"name":"dylinker_command"},{"cmd":27,"name":"uuid_command"},{"cmd":50,"name":"build_version_command"},{"cmd":42,"name":"source_version_command"},{"cmd":2147483688,"entryoff":18534500,"name":"entry_point_command","stacksize":0},{"cmd":12,"name":"dylib_command"},{"cmd":12,"name":"dylib_command"},{"cmd":12,"name":"dylib_command"},{"cmd":12,"name":"dylib_command"},{"cmd":38,"dataoff":88057544,"datasize":167960,"name":"linkedit_data_command"},{"cmd":41,"dataoff":88225504,"datasize":0,"name":"linkedit_data_command"}],"dataInCode":{"dataoff":88225504,"datasize":0,"present":true},"dysymtab":{"extrefsymoff":0,"extreloff":0,"iextdefsym":575568,"ilocalsym":0,"indirectsymoff":97948352,"iundefsym":607040,"locreloff":0,"modtaboff":0,"nextdefsym":31472,"nextrefsyms":0,"nextrel":0,"nindirectsyms":2812,"nlocalsym":575568,"nlocrel":0,"nmodtab":0,"ntoc":0,"nundefsym":638,"tocoff":0},"exports":{"dataoff":86897912,"datasize":1159632,"present":true,"source":"LC_DYLD_INFO"},"fileOffsetChecks":[{"inBounds":true,"kind":"segment","name":"__PAGEZERO","offset":0,"size":0},{"inBounds":true,"kind":"segment","name":"__TEXT","offset":0,"size":85049344},{"inBounds":true,"kind":"section","name":"__TEXT/__text","offset":16384,"size":33270788},{"inBounds":true,"kind":"section","name":"__TEXT/__stubs","offset":33287172,"size":7356},{"inBounds":true,"kind":"section","name":"__TEXT/__stub_helper","offset":33294528,"size":6732},{"inBounds":true,"kind":"section","name":"__TEXT/__const","offset":33304576,"size":41156096},{"inBounds":true,"kind":"section","name":"__TEXT/__cstring","offset":74460672,"size":9976253},{"inBounds":true,"kind":"section","name":"__TEXT/__ustring","offset":84436926,"size":559450},{"inBounds":true,"kind":"section","name":"__TEXT/__oslogstring","offset":84996376,"size":22},{"inBounds":true,"kind":"section","name":"__TEXT/__unwind_info","offset":84996400,"size":49032},{"inBounds":true,"kind":"section","name":"__TEXT/__eh_frame","offset":85045432,"size":2568},{"inBounds":true,"kind":"segment","name":"__DATA_CONST","offset":85049344,"size":1359872},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__got","offset":85049344,"size":13120},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__mod_init_func","offset":85062464,"size":288},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__const","offset":85062752,"size":1340496},{"inBounds":true,"kind":"section","name":"__DATA_CONST/__cfstring","offset":86403248,"size":128},{"inBounds":true,"kind":"segment","name":"__DATA","offset":86409216,"size":196608},{"inBounds":true,"kind":"section","name":"__DATA/__la_symbol_ptr","offset":86409216,"size":4472},{"inBounds":true,"kind":"section","name":"__DATA/__data","offset":86425600,"size":179408},{"inBounds":true,"kind":"section","name":"__DATA/__thread_vars","offset":86605008,"size":720},{"inBounds":true,"kind":"section","name":"__DATA/__thread_data","offset":86605728,"size":4},{"inBounds":true,"kind":"segment","name":"NODE_SEA","offset":86605824,"size":57},{"inBounds":true,"kind":"section","name":"NODE_SEA/__NODE_SEA_BLOB","offset":86605824,"size":57},{"inBounds":true,"kind":"segment","name":"__LINKEDIT","offset":86622208,"size":25166240},{"inBounds":true,"kind":"LC_SYMTAB","name":"symoff","offset":88225504,"size":9722848},{"inBounds":true,"kind":"LC_SYMTAB","name":"stroff","offset":97959600,"size":13828848},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"toc","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"modtab","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"extrefsym","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"indirectsym","offset":97948352,"size":11248},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"extrel","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYSYMTAB","name":"locrel","offset":0,"size":0},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"rebase_off","offset":86622208,"size":39872},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"bind_off","offset":86662080,"size":6416},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"weak_bind_off","offset":86668496,"size":212976},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"lazy_bind_off","offset":86881472,"size":16440},{"inBounds":true,"kind":"LC_DYLD_INFO","name":"export_off","offset":86897912,"size":1159632},{"inBounds":true,"kind":"LC_MAIN","name":"entryoff","offset":18534500,"size":0},{"inBounds":true,"kind":"linkedit_data","name":"linkedit_data_command","offset":88057544,"size":167960},{"inBounds":true,"kind":"linkedit_data","name":"linkedit_data_command","offset":88225504,"size":0}],"fileOffsetCommandsInBounds":true,"functionStarts":{"dataoff":88057544,"datasize":167960,"present":true},"fuse":{"enabled":true,"present":true},"hasCodeSignature":false,"ncmds":20,"payloadLength":57,"payloadSha256":"1a5150ac10994d2f90009363b1aded7c63f6043df78f7360d133644aa238f46b","segmentOrder":["__PAGEZERO","__TEXT","__DATA_CONST","__DATA","NODE_SEA","__LINKEDIT"],"segmentsAligned":true,"segmentsNonOverlapping":true,"sizeofcmds":2728,"symtab":{"nsyms":607678,"stroff":97959600,"strsize":13828848,"symoff":88225504}},"sha256":"532606820f708c6480d9bbad599435cf3b34b07999c1e768982c2481d06fb0d1","validators":{"macholib":"1.16.3","pefile":"2024.8.26"}}
```

```json
{"arch":"x64","basename":"official-win-x64.exe","case":"win-x64-before","format":"pe","kind":"pe","pe":{"FileAlignment":512,"NumberOfSections":7,"SectionAlignment":4096,"SizeOfImage":89866240,"certificateRestored":true,"computedSizeOfImage":89866240,"computedSizeOfImageInputs":{"fileSize":86969160,"headersAlignedToSectionAlignment":4096,"headersEnd":856,"maxAlignedSectionEnd":89866240,"sections":[{"alignedSectionEnd":30715904,"memSize":30708736,"name":".text","sectionEnd":30712832,"sizeOfRawData":30708736,"virtualAddress":4096,"virtualSize":30708724},{"alignedSectionEnd":84975616,"memSize":54259712,"name":".rdata","sectionEnd":84975616,"sizeOfRawData":54259712,"virtualAddress":30715904,"virtualSize":54259490},{"alignedSectionEnd":88174592,"memSize":3198892,"name":".data","sectionEnd":88174508,"sizeOfRawData":297472,"virtualAddress":84975616,"virtualSize":3198892},{"alignedSectionEnd":89546752,"memSize":1371648,"name":".pdata","sectionEnd":89546240,"sizeOfRawData":1371648,"virtualAddress":88174592,"virtualSize":1371240},{"alignedSectionEnd":89550848,"memSize":512,"name":".fptable","sectionEnd":89547264,"sizeOfRawData":512,"virtualAddress":89546752,"virtualSize":256},{"alignedSectionEnd":89694208,"memSize":142336,"name":".rsrc","sectionEnd":89693184,"sizeOfRawData":142336,"virtualAddress":89550848,"virtualSize":141944},{"alignedSectionEnd":89866240,"memSize":172032,"name":".reloc","sectionEnd":89866240,"sizeOfRawData":172032,"virtualAddress":89694208,"virtualSize":171852}]},"fuse":{"enabled":false,"present":true},"originalCertificateSha256":"6baff12dc6d38b97807001bb1eb5ff191bf09badae9ee5e2890a135bc25453c5","originalCertificateSize":15688,"overlayOffset":86953472,"overlaySha256":"6baff12dc6d38b97807001bb1eb5ff191bf09badae9ee5e2890a135bc25453c5","overlaySize":15688,"payloadLength":null,"payloadSha256":null,"resources":[{"language":"1033","name":"1","sha256":"2c5bce8a36a6d11f5c3e0e223bc0a71756a6f4b7e736b2c1925729f8d421e491","size":1128,"type":"RT_ICON"},{"language":"1033","name":"2","sha256":"05b88f689e581edcedbccbac8c126db147f986d00a330485024066ad53d2e7cb","size":4264,"type":"RT_ICON"},{"language":"1033","name":"3","sha256":"585c19c61e9b06c3d88eeb84b02bbfecdd4ac23c6cbb0352eeae304cf5e06d6b","size":9640,"type":"RT_ICON"},{"language":"1033","name":"4","sha256":"8ed45cbdda6df51bca0e772da140fecda4781a06d21ee4e07beb5848b4623e62","size":16936,"type":"RT_ICON"},{"language":"1033","name":"5","sha256":"54125e40f6059406ed64106663d3eb974000f4cdead706f422304c88d0368a0c","size":67624,"type":"RT_ICON"},{"language":"1033","name":"6","sha256":"25b2a9350e4750997037ea2a431e89070c60b1f1238d27dd04fd84a4fb0f7bf8","size":40138,"type":"RT_ICON"},{"language":"1033","name":"1","sha256":"80934be0cf6dd9cc6deb45b711cc281e5832fd7292e6718606fa40a1154aa10d","size":90,"type":"RT_GROUP_ICON"},{"language":"1033","name":"1","sha256":"e610499169a627dfd77631ab0157d6e5484e9a9a3ab69bb8a40dafe2cf56c380","size":744,"type":"RT_VERSION"},{"language":"1033","name":"1","sha256":"3e9fb184c1a5da021cf6d4c78a440a2600aa656e27a99ee50aac85884fc862e9","size":822,"type":"RT_MANIFEST"}],"sectionRangesInBounds":true,"sections":[{"name":".text","pointerToRawData":1024,"sizeOfRawData":30708736,"virtualAddress":4096,"virtualSize":30708724},{"name":".rdata","pointerToRawData":30709760,"sizeOfRawData":54259712,"virtualAddress":30715904,"virtualSize":54259490},{"name":".data","pointerToRawData":84969472,"sizeOfRawData":297472,"virtualAddress":84975616,"virtualSize":3198892},{"name":".pdata","pointerToRawData":85266944,"sizeOfRawData":1371648,"virtualAddress":88174592,"virtualSize":1371240},{"name":".fptable","pointerToRawData":86638592,"sizeOfRawData":512,"virtualAddress":89546752,"virtualSize":256},{"name":".rsrc","pointerToRawData":86639104,"sizeOfRawData":142336,"virtualAddress":89550848,"virtualSize":141944},{"name":".reloc","pointerToRawData":86781440,"sizeOfRawData":172032,"virtualAddress":89694208,"virtualSize":171852}],"security":{"fileOffset":86953472,"size":15688}},"sha256":"780f44f2c53c108bae261ada21a525b4bfe733c020ac85e41bfe94479090ac9b","validators":{"macholib":"1.16.3","pefile":"2024.8.26"}}
```

```json
{"arch":"x64","basename":"injected-win-x64.exe","case":"win-x64-after","format":"pe","kind":"pe","pe":{"FileAlignment":512,"NumberOfSections":7,"SectionAlignment":4096,"SizeOfImage":90009600,"certificateRestored":false,"computedSizeOfImage":90009600,"computedSizeOfImageInputs":{"fileSize":87095808,"headersAlignedToSectionAlignment":4096,"headersEnd":856,"maxAlignedSectionEnd":90009600,"sections":[{"alignedSectionEnd":30715904,"memSize":30708736,"name":".text","sectionEnd":30712832,"sizeOfRawData":30708736,"virtualAddress":4096,"virtualSize":30708724},{"alignedSectionEnd":84975616,"memSize":54259712,"name":".rdata","sectionEnd":84975616,"sizeOfRawData":54259712,"virtualAddress":30715904,"virtualSize":54259490},{"alignedSectionEnd":88174592,"memSize":3198892,"name":".data","sectionEnd":88174508,"sizeOfRawData":297472,"virtualAddress":84975616,"virtualSize":3198892},{"alignedSectionEnd":89546752,"memSize":1371648,"name":".pdata","sectionEnd":89546240,"sizeOfRawData":1371648,"virtualAddress":88174592,"virtualSize":1371240},{"alignedSectionEnd":89694208,"memSize":146040,"name":".fptable","sectionEnd":89692792,"sizeOfRawData":142848,"virtualAddress":89546752,"virtualSize":146040},{"alignedSectionEnd":89866240,"memSize":172032,"name":".reloc","sectionEnd":89866240,"sizeOfRawData":172032,"virtualAddress":89694208,"virtualSize":171852},{"alignedSectionEnd":90009600,"memSize":142336,"name":".rsrc","sectionEnd":90008576,"sizeOfRawData":142336,"virtualAddress":89866240,"virtualSize":142336}]},"fuse":{"enabled":true,"present":true},"originalCertificateSha256":"6baff12dc6d38b97807001bb1eb5ff191bf09badae9ee5e2890a135bc25453c5","originalCertificateSize":15688,"overlayOffset":null,"overlaySha256":null,"overlaySize":0,"payloadLength":52,"payloadSha256":"8c0cf2ac3ef36b45dd60bbf6a132e716fbad085dee0c11bf90b1f1ad8ac083f2","resources":[{"language":"1033","name":"1","sha256":"2c5bce8a36a6d11f5c3e0e223bc0a71756a6f4b7e736b2c1925729f8d421e491","size":1128,"type":"RT_ICON"},{"language":"1033","name":"2","sha256":"05b88f689e581edcedbccbac8c126db147f986d00a330485024066ad53d2e7cb","size":4264,"type":"RT_ICON"},{"language":"1033","name":"3","sha256":"585c19c61e9b06c3d88eeb84b02bbfecdd4ac23c6cbb0352eeae304cf5e06d6b","size":9640,"type":"RT_ICON"},{"language":"1033","name":"4","sha256":"8ed45cbdda6df51bca0e772da140fecda4781a06d21ee4e07beb5848b4623e62","size":16936,"type":"RT_ICON"},{"language":"1033","name":"5","sha256":"54125e40f6059406ed64106663d3eb974000f4cdead706f422304c88d0368a0c","size":67624,"type":"RT_ICON"},{"language":"1033","name":"6","sha256":"25b2a9350e4750997037ea2a431e89070c60b1f1238d27dd04fd84a4fb0f7bf8","size":40138,"type":"RT_ICON"},{"language":"0","name":"NODE_SEA_BLOB","sha256":"8c0cf2ac3ef36b45dd60bbf6a132e716fbad085dee0c11bf90b1f1ad8ac083f2","size":52,"type":"RT_RCDATA"},{"language":"1033","name":"1","sha256":"80934be0cf6dd9cc6deb45b711cc281e5832fd7292e6718606fa40a1154aa10d","size":90,"type":"RT_GROUP_ICON"},{"language":"1033","name":"1","sha256":"e610499169a627dfd77631ab0157d6e5484e9a9a3ab69bb8a40dafe2cf56c380","size":744,"type":"RT_VERSION"},{"language":"1033","name":"1","sha256":"3e9fb184c1a5da021cf6d4c78a440a2600aa656e27a99ee50aac85884fc862e9","size":822,"type":"RT_MANIFEST"}],"sectionRangesInBounds":true,"sections":[{"name":".text","pointerToRawData":1024,"sizeOfRawData":30708736,"virtualAddress":4096,"virtualSize":30708724},{"name":".rdata","pointerToRawData":30709760,"sizeOfRawData":54259712,"virtualAddress":30715904,"virtualSize":54259490},{"name":".data","pointerToRawData":84969472,"sizeOfRawData":297472,"virtualAddress":84975616,"virtualSize":3198892},{"name":".pdata","pointerToRawData":85266944,"sizeOfRawData":1371648,"virtualAddress":88174592,"virtualSize":1371240},{"name":".fptable","pointerToRawData":86638592,"sizeOfRawData":142848,"virtualAddress":89546752,"virtualSize":146040},{"name":".reloc","pointerToRawData":86781440,"sizeOfRawData":172032,"virtualAddress":89694208,"virtualSize":171852},{"name":".rsrc","pointerToRawData":86953472,"sizeOfRawData":142336,"virtualAddress":89866240,"virtualSize":142336}],"security":{"fileOffset":0,"size":0}},"sha256":"9bb6ba9ca4febcac0584d2c4fd2d7454c00c4d69afca6bfdb7504c6d3a93b401","validators":{"macholib":"1.16.3","pefile":"2024.8.26"}}
```

Interpretation: 40 canonical `fileOffsetChecks` entries per Mach-O case
cover every file-offset-bearing structure — each segment file range and
every file-backed section, `LC_SYMTAB` symbol/string tables
(`nsyms × 16` `nlist_64`), all `LC_DYSYMTAB` offset/count pairs (table of
contents, 64-bit module table, external references, indirect symbols,
local/external relocations), every `LC_DYLD_INFO` region (rebase, bind,
weak/lazy bind, export trie), generic `linkedit_data`/`dyld_trie` commands,
and `LC_MAIN` `entryoff` — each with explicit offset/size/inBounds, all in
bounds. Segments are 0x1000-aligned, non-overlapping, ordered
`__PAGEZERO → __TEXT → __DATA_CONST → __DATA → NODE_SEA → __LINKEDIT`, with
per-segment `fileEnd`/`fileInBounds`/`fileAligned`/`vmAligned` records;
`LINKEDIT.relocated`/`delta` are computed against the sibling
official-before file (darwin-x64 delta 4096, darwin-arm64 delta 16384), not
hardcoded; `LC_SYMTAB`/`LC_DYSYMTAB` and exports/function-starts/data-in-code
linkedit data are recorded and in bounds; `hasCodeSignature` is false;
fuse is enabled; and `payloadLength`/`payloadSha256` equal the exact
injected blob. PE: `computedSizeOfImageInputs` records the header-table
end/linked size and each section's `memSize`/`sectionEnd`/
`alignedSectionEnd`, and `computedSizeOfImage` equals the header
`SizeOfImage` before (89866240) and after (90009600); the complete resource
inventory includes per-resource data `size` and `sha256`; all original
resources survive with exactly one `RT_RCDATA NODE_SEA_BLOB` added;
`certificateRestored` is decided by searching the image for the exact
original certificate bytes (SHA-256
`6baff12dc6d38b97807001bb1eb5ff191bf09badae9ee5e2890a135bc25453c5`, 15688
bytes) — present before, absent after; the Security directory is 0/0; and
all section raw/virtual ranges are in bounds.

## Generic restricted-PATH MCP evidence

The current-host release artifact was exercised as a real subprocess with a
restricted `PATH` containing only `node` and `jobos` traps plus `/usr/bin`
and `/bin`:

- `initialize` succeeded (`protocolVersion 2024-11-05`),
- `tools/list` exposed the full journey tool set (`doctor`, `start`,
  `create_profile`, `import_job`, `list_jobs`, ...),
- `doctor` and `start` succeeded,
- `create_profile` (from the frozen fixture) and `import_job` followed by a
  restarted process against the same temporary `${PLUGIN_DATA}` still listed
  the imported job,
- the `node` trap and the `jobos` trap never executed, `JOBOS_HOME` stayed
  empty, and no state was written into the release plugin tree.

This is the frozen B31/B32 contract: the released `bin/jobsss` runs and
persists correctly with Node and JobOS absent from PATH.

## Client compatibility matrix

Recorded in `compat/matrix.json` and probed with isolated temporary
configuration only (temporary `HOME`, XDG roots, and per-client home
overrides; real client profiles are never read or written):

| Client | Status | Loading | Evidence |
| --- | --- | --- | --- |
| Pi | unverified | native skills, no native stdio MCP host | binary present; core documents no declarative stdio MCP host, so runtime proof would require a custom extension bridge |
| OMP | unverified | unknown | binary present; this build exposes no mcp/plugin subcommand and no documented Agent Plugins loader was established |
| Codex | unverified | native | isolated temporary `CODEX_HOME` registration is accepted, but a live tool exchange needs provider authentication (probe keys blank by design) |
| Hermes | verified | native | real isolated launch: `hermes mcp test jobsss` connected to the bundled runtime in a temporary `HERMES_HOME` and discovered its tools |
| Claude | verified | native | real isolated launch: `claude mcp add`/`mcp list` registered and health-checked the JobSSS stdio server as Connected under a temporary `CLAUDE_CONFIG_DIR` |

Adapted clients load the same canonical skill and bundled runtime through
thin generated pointers; inspection confirms adapters contain no business
logic (frozen B33–B35/B41).

## Human-authority behavior

Human-only decisions are completed only through the trusted local CLI
`./bin/jobsss decide --data ${PLUGIN_DATA}` with the exact entity id,
integer revision, and lowercase SHA-256 content hash. The frozen B36–B40
checks pass through real subprocesses:

- `proof.verify`, `artifact.approve|reject`, `contact.approve|suppress`,
  `story.verify|retire`, `debrief.record|correct`, `outreach.sent|outcome`,
  and `application.observe_status` all complete on the trusted local
  surface with a `trusted_local` / human actor;
- a missing `--content-hash` or `--revision`, an unknown `--id`, a stale
  revision, or a mismatched content hash fails with a typed stale conflict
  and persists nothing;
- MCP callers can only list/create non-authoritative decision handoffs
  (`list_decision_handoffs`, `create_decision_handoff`); authority forgery
  via tool names, arguments (`approved`, `humanApproved`, `authority=human`,
  `verifyProofs`), labels, or environment variables
  (`JOBSSS_AUTHORITY`, `JOBSSS_HUMAN_APPROVE`, `JOBSSS_APPROVE`) is
  rejected, and `update_application_status` still refuses
  `applied`/`submitted`;
- audit history and `PLUGIN_DATA` projections record the entity id, the
  action, and the trusted-local human actor, and agree after an MCP restart.

JobSSS never claims that it sent, submitted, applied, approved, or
interviewed; local preparation and human observation are labeled as such.

## Commands/results

Frozen validation command (from the repository root):

```bash
node --test --test-concurrency=1 \
  tests/jobsss-gate0.test.mjs \
  tests/jobsss-mcp-compat.test.mjs \
  tests/jobsss-journey.test.mjs \
  tests/jobsss-persistence.test.mjs \
  tests/jobsss-discovery.test.mjs \
  tests/jobsss-workflows.test.mjs \
  tests/jobsss-integrity.test.mjs \
  tests/jobsss-release.test.mjs \
  tests/jobsss-adapters.test.mjs \
  tests/jobsss-authority.test.mjs \
  tests/jobsss-cross-platform.test.mjs \
  tests/jobsss-native-remediation.test.mjs
```

Final reviewed result after both reports record the live frozen-command
count:

- `# tests 66` · `# pass 66` · `# fail 0` · exit `0`
- B1–B64 all pass, including independent native-format validation,
  checksum-pinned official Node inputs, Mach-O LC_SYMTAB / linkedit /
  code-signature-removal evidence and canonical validator JSON, PE
  SizeOfImage evidence (header equals independently computed value) with
  Security directory 0/0 and resource preservation, pinned
  postject / `packaging.lock.json` / pefile / macholib / altgraph identity,
  empty-cache acquisition, official checksum enforcement, and two
  fresh-process complete official-target release trees.

Current-host release evidence (this host, linux/x64, Node 22.22.3):

```bash
./bin/jobsss release --out <a> --target current-host
./bin/jobsss release --out <b> --target current-host
# both exit 0; complete --out trees byte-identical (11 files)
# bin/jobsss sha256 7ee8a77c3648aed8afa3912b4517f1e669790c7c3e694020ff05d665ac8eefe9
```

## Reviewer verdict

**Fresh reviewer verdict: PASS (B61–B64 independent-validator evidence
gate, single authoritative final review).**

The reviewer added additive B61–B64 coverage on top of published base
`8031359`, confirmed the pre-correction failures (missing canonical
validator JSON and payload/fuse/linkedit/resource/`SizeOfImage` evidence),
inspected the test-only validator orchestration and report evidence
(no production import; pinned pefile/macholib/altgraph; both Mach-O
architectures; PE before/after), and finalized both reports with
`# tests 66` `# pass 66` `# fail 0`. Product code was not edited by this
reviewer. The final corrective SHA is supplied in the final response.

## Deferred/unverified capabilities

- macOS (`darwin-x64`, `darwin-arm64`) and Windows (`win-x64`) release
  definitions are implemented and executable in `src/packaging.js`, but
  they are **unverified** (labeled `unverified` in every release manifest):
  official-Node container validation and fixture injection are not matching-
  host execution. Runtime support is claimable only after real execution on
  a matching macOS/Windows host, including post-inject `codesign --sign` and
  Windows Authenticode re-signing of the unsigned image.
- `linux-arm64` is likewise **unverified** until a real arm64 Linux host
  exercises it.
- Pi, OMP, and Codex client integrations are **unverified** per
  `compat/matrix.json`; Hermes and Claude are verified via isolated real
  launches.
- External sending, application submission, packet freezing, interview
  scheduling/attestation, browser automation, and provider delivery remain
  deferred/blocked and are never claimed.
