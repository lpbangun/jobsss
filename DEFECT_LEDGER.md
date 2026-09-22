# E2E defect ledger

Date: 2026-09-21

| ID | Severity | Status | Defect | Resolution / evidence |
| --- | --- | --- | --- | --- |
| D-01 | High | FIXED | Codex had no one-install aggregate for JobSSS + people-finder + contact-brief. | Added deterministic marketplace and self-contained aggregate pack with two MCP servers and three skills. |
| D-02 | High | FIXED | Codex launcher passed a literal non-expanded `${PLUGIN_DATA}`. | Pack MCP args now rely on forwarded environment state; paths with spaces verified. |
| D-03 | High | FIXED | Cachebuster did not change when canonical mirrored bytes changed. | Hash now covers adapter, pins, and all mirrored files. |
| D-04 | High | FIXED | Mock heading `# MOCK JOB — Company — Title` parsed provenance as the title. | Parser ignores the provenance segment; installed-pack double import produced one correct logical job. |
| D-05 | High | FIXED | Native PDF section rules crossed employer, education, and skills text. | Increased rule-to-baseline clearance; independent render review passes all final PDFs. |
| D-06 | Medium | FIXED | Semicolon-separated skill categories rendered one paragraph per item. | Categories remain compact wrapped lines; regression and visual review pass. |
| D-07 | High | FIXED | Native evidence runner could not invoke extensionless CLI on Windows. | Evidence boundary routes the script through `process.execPath` on win32. |
| D-08 | High | FIXED | SEA import scanner merged CRLF import lines on Windows. | Normalize CRLF before statement scanning; dedicated regression passes. |
| D-09 | High | FIXED | Fiber was unavailable to the original host route, then the accepted run temporarily returned HTTP 500 on status reads. | Confirmed Fiber in Exa Connect, persisted the existing API key outside the repository, dispatched exactly one authorized run, and retained its duplicate-prevention journal. The same run later completed with `schema_satisfied`, `$0.045` cost and provider-reported contact data; normalization, Fiber schema validation and `contact-brief.v1` import pass. Redacted live evidence is retained in `evidence/fiber-live-validation.json`. |
| D-10 | Medium | OPEN / HARNESS | Frozen tests spawn extensionless `bin/jobsss` directly on Windows. | Production Codex pack uses a Node launcher and works; frozen suite remains 18/49 on Windows. Tests are reviewer-owned. |
| D-11 | Medium | FIXED | Aggregate product bytes under `compat/codex/plugins` violated the metadata-only adapter invariant. | Moved the deterministic aggregate to root-level `codex-pack/job-search-stack` and made the repository root the thin marketplace root. |
| D-12 | Low | OPEN / PLATFORM | Executable-bit parity cannot be represented by this Windows checkout. | P8 fails; P9 runtime boot and P10 MCP handshake pass. |
| D-13 | Low | OPEN / COSMETIC | Real final resumes use generous lower-page whitespace and generic focus text. | Independent checker marked all artifacts PASS; retain as future design improvement. |
