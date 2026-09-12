# P3 portable contracts

Generic, host-neutral input contracts for JobSSS: application packet,
outcome record, and bulk file-drop. Pure offline validation lives in
`src/p3-contracts.js` (Node 22 stdlib only, no MCP wiring, no store
writes). Schemas beside this file describe the same shapes for
cross-language readers.

## Currently callable vs P4 future

CURRENTLY CALLABLE today (unchanged by this proposal): the 47 MCP tools
in `src/mcp.js`, the trusted local CLI
(`./bin/jobsss decide --data <dir> ...`), inline/staged intake
(`import_job`, `import_job_url` with public-URL rules), native PDF
writing under PLUGIN_DATA (`tailor_resume`), draft matching
(`match_answers`), and the versioned store as canonical state.

P4 FUTURE consumption (not implemented here): a later milestone may
accept these portable artifacts at a boundary — e.g. read a packet
directory produced elsewhere, replay an outcome record through the
trusted CLI after re-verifying its binding, or ingest a bulk JSONL drop
staged under PLUGIN_DATA. Nothing in this directory wires to MCP tools
or to the store; `src/p3-contracts.js` cannot approve, send, or record
anything. Authority stays in `src/authority.js`.

## 1. Packet (`packet.schema.json`)

Portable snapshot of one application's composed materials.

- Identity: `jobId` string, `revision` positive integer. This revision
  is the packet/job revision for the portable format, not MCP authority.
- `contentHash`: lowercase SHA-256 hex of the canonical serialization:
  stable key-ordered JSON over
  `format, jobId, revision, components, asks, answers, checklist`.
  Excluded: the hash itself, the `readiness` flag, absolute paths,
  timestamps, secrets.
- `components`: portable posix-style relative paths only (no leading
  `/`, no drive prefix, no backslashes, no `..`). Each of `resumePdf`,
  `coverLetter`, `answers`, `checklist` is a path or `null` (missing).
  Today `tailor_resume` returns an absolute path under the data dir;
  packets store the portable relative form instead.
- Completeness: an incomplete packet is a VALID object with
  `readiness: 'incomplete'` and explicit `missing` coverage. `ready`
  with missing coverage is rejected as `fabricated_readiness`. The
  plugin never invents PDF bytes and never claims readiness, sending,
  or applying.
- `answers` must link to real ask ids in `asks`. A question with no
  answer stays missing (degraded coverage), never fabricated; an answer
  pointing at an unknown ask id is rejected (`unlinked_answer`).
- No send/apply attestation fields (`sent`, `submitted`, `applied` and
  timestamp variants are rejected as `remote_attestation`).

## 2. Outcome (`outcome.schema.json`)

Portable observation record, consumable only through the trusted CLI
`decide` path — never through MCP.

- `action` must be one of the existing trusted decision actions
  (`proof.verify`, `artifact.approve`, `artifact.reject`,
  `contact.approve`, `contact.suppress`, `story.verify`,
  `story.retire`, `debrief.record`, `debrief.correct`,
  `outreach.sent`, `outreach.outcome`, `application.observe_status`).
  Unknown actions are rejected; no MCP-approvable action is added.
- `id`, positive integer `revision`, `contentHash` (SHA-256 hex,
  lowercased before checking, mirroring `authority.js`).
- `actor` must be `trusted_local`. Anything else — including
  MCP-shaped payloads with `tool`/`expectedRevision` — is rejected.
- Optional `note`; optional `outcome`/`status` strings only. Values
  claiming remote action as plugin-performed are rejected.
- Validators here check shape and binding format only; they do not
  check staleness against live state and they grant no authority. The
  plugin never claims sent/submitted/applied.

## 3. Bulk input (`bulk-input.schema.json`)

JSONL file-drop: one record per line, blank lines skipped.

- Each record: optional `id`, posting `text` and/or `url`, and
  `provenance: 'host_provided'`. The host provides content; the plugin
  does not fetch in this validator.
- `url`, when present, must be public http/https per the same rules as
  `import_job_url`: rejects `file:`, other protocols, embedded
  credentials, and non-public hosts (loopback, private ranges,
  single-label names, `.local` / `.internal` and similar zones).
- Per-record errors use stable codes and do not abort the drop; only
  hard limits fail it outright:
  `MAX_BULK_RECORDS = 100`, `MAX_BULK_BYTES = 1048576` (1 MiB),
  `MAX_RECORD_TEXT_CHARS = 100000`.
- Dedup key: SHA-256 of the posting text (same idea as the `import_job`
  source hash). Repeats are reported in `duplicates` and kept once.
- Drops conceptually stage under PLUGIN_DATA. `stagedPath`, when
  present, must be a portable relative path; traversal, absolute paths,
  `file:` URLs, and secret-looking keys/values are rejected
  (`unsafe_path`, `absolute_path_leak`, `unsafe_url_protocol`,
  `secret_like_field`). Accepted records carry no absolute paths.

## Stable error codes

`invalid_format`, `missing_identity`, `invalid_revision`,
`missing_binding`, `invalid_content_hash`, `content_hash_not_canonical`,
`content_hash_mismatch`, `unknown_decision_action`, `untrusted_actor`,
`missing_components`, `missing_asks`, `missing_answers`,
`invalid_ask`, `invalid_answer`, `unlinked_answer`, `invalid_checklist`,
`invalid_readiness`, `fabricated_readiness`, `unsafe_path`,
`remote_attestation`, `invalid_outcome_field`, `invalid_provenance`,
`missing_content`, `record_invalid`, `record_over_limit`,
`unsafe_url_protocol`, `credentialed_url`, `non_public_host`,
`absolute_path_leak`, `secret_like_field`, `bulk_invalid`,
`bulk_over_limit`.

## Examples

`contracts/examples/` holds synthetic fixtures only (no real people,
no real postings, no credentials): a complete packet, an incomplete
packet, one outcome record, and one small JSONL drop. All validate with
`src/p3-contracts.js`.
