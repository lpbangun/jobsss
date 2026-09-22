# JobSSS portable-plugin E2E report

Date: 2026-09-21  
Branch/worktree: `codex/e2e-hotfix`  
Final Codex pack: `job-search-stack@jobsss-local` `1.0.0+codex.e41de50245c1`

## Outcome

The Agent Plugin, Hermes surface, and aggregate Codex pack build deterministically and validate. Four isolated profile journeys (real/synthetic × explicit/natural activation) exercised profile import, proof-state truthfulness, job intake/discovery, scoring, pursuit, tailored PDF export, persistence/restart readback, and contact preparation. No send, submission, approval, or applied status was claimed.

The named provider gate now passes. Live Exa search/fetch produced the earlier attributable no-result lookup, while a separate authorized Exa Connect/Fiber run completed as `agent_run_61ec3fec45434a9c8eb855183b3b9d05` with `schema_satisfied`, one provider-reported professional address, two grounding records, and `$0.045` actual cost. The exact run was normalized against `fiber-agent-result.schema.json`, imported into `contact-brief.v1`, and validated without exposing the address in repository evidence. The result remains `provider_reported`, not `source_supported`; mailbox status remains `not_checked`, and no outreach was sent. The persistent Windows-user `EXA_API_KEY` now supports future code calls without repeated dashboard login.

## Gate matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Agent Plugin mirror | PASS | `build-agent-plugin --check`; 33 canonical files |
| Hermes surface | PASS | generated from exact pins; drift check clean |
| Codex aggregate pack | PASS | 62 files; official validator passed; installed/enabled as `1.0.0+codex.e41de50245c1` |
| Explicit skill activation | PASS | fresh Luna Max sessions loaded `job-search-stack:jobsss` from the installed cache |
| Natural-language activation | PASS | fresh Luna Max sessions selected JobSSS without the skill name |
| Profile isolation | PASS | separate `PLUGIN_DATA` roots; cross-profile `get_resume` returned `unknown_profile` |
| Job parser and dedupe | PASS | mock parsed as Fixture Learning Co / People & Learning Operations Associate; repeat returned one ID with `deduped: true` |
| Persistence/restart | PASS | profiles, resumes, scores, artifacts, contacts, and review state survived fresh turns |
| Tailored resume PDFs | PASS | independent Luna Max checker rendered all 6 unique final PDFs (8 workflow artifacts); all searchable, one page, no clipping/overlap/strikethrough |
| Live Exa job route | PASS | current LinkedIn Learning Designer source found and fetched; live evidence kept distinct from fixtures |
| Live Exa contact route | PASS / no result | attributable Kathryn C. Schoeberlein research; no public email found; no address guessed |
| Contact-brief compiler | PASS | `contact-brief.v1` JSON and Markdown compiled and validated in disposable venv |
| Fiber positive route | PASS | live Fiber run completed at `$0.045`; schema-valid envelope and `contact-brief.v1` import passed; redacted evidence is `evidence/fiber-live-validation.json` |
| Fixture integrity | PASS | all 16 original and staged source hashes still match `fixture-manifest.json` |
| Native release evidence | PASS | two separate empty-cache processes emitted byte-identical 62,474-byte JSON, SHA-256 `e10f723d6d61a46d8a53255fbd0adb4bf0be8f2c7c054a26d3e2382b387f090f` |

## Final resume-design evidence

The independent checker rendered and inspected every page. Duplicate hashes below are intentional byte identity for the same profile/mock pairing.

| Run / target | SHA-256 | Pages | Verdict |
| --- | --- | ---: | --- |
| real explicit / Factory | `7e93ba694d6de318ecfd9d61cbf047049300615df2e99efed6daf5f881fb0932` | 1 | PASS |
| real explicit / mock | `08b8360664a8873bc8f1b4633f91b3d9028998614e28216dea74cf8f87be7826` | 1 | PASS |
| real natural / Replit | `7a1dea9dbeb5ccb90e560be5a64a73d3be95f09e83045fc6bb1aad54c291fa61` | 1 | PASS |
| real natural / mock | `08b8360664a8873bc8f1b4633f91b3d9028998614e28216dea74cf8f87be7826` | 1 | PASS |
| synthetic explicit / Civitech | `9fe0226277fe91257e11caf996d4a3900669388d69df2b919b7c181e817e0510` | 1 | PASS |
| synthetic explicit / mock | `9e85b6ded12351b8d2822c0d9a696d32e02eac83da829ef9b0791a8943c04f35` | 1 | PASS |
| synthetic natural / Oklo | `d4fd42c256c9a7fe9f8d8a8dcdbe1c8f0c1310f117d27b4cb44a56995d4355a2` | 1 | PASS |
| synthetic natural / mock | `9e85b6ded12351b8d2822c0d9a696d32e02eac83da829ef9b0791a8943c04f35` | 1 | PASS |

Non-blocking review note: real resumes retain generous lower-page whitespace and a generic focus header. Target-relevant bullets are visibly reordered, and the checker classified this as cosmetic rather than a material defect.

## Test accounting

- Build/drift checks: PASS.
- Codex plugin validator: PASS.
- New layout regressions: 2/2 PASS.
- New CRLF SEA regression: PASS.
- Agent-plugin parity: 9/10 PASS; executable-bit assertion is not representable on this Windows NTFS checkout. Runtime boot and MCP handshake pass.
- Final frozen 49-test bar: 18 PASS / 31 FAIL. Every remaining failure is the Windows harness attempting to spawn extensionless `bin/jobsss` directly; the metadata-only adapter failure was fixed by moving aggregate product bytes out of `compat/` into root-level `codex-pack/`.
- Contact-brief checkout: 46 PASS / 1 Windows path-separator assertion failure / 1 optional Go adapter skipped.
- Native evidence frozen file: artifact content and report-hash gates pass; three launcher-driven assertions still use the extensionless Windows harness.

## Provider separation

- Fixture/replay records remain labeled fixture or replay.
- Exa evidence is live and dated to this run.
- A provider-reported no-result remains `no_result`; it is not promoted to a contact email.
- Fiber connection, dispatch, completion, cost, grounding, normalization, and import evidence are live. The address is redacted from repository evidence and is not upgraded beyond provider attribution or mailbox status `not_checked`.

## Safety and preservation

No external message, application, approval, or status attestation was performed. Original Job Search files were read-only inputs. All 16 manifest hashes matched before cleanup.
The temporary validator/smoke installation, disposable profiles, local marketplace registration, installed plugin cache, and 26 generated test-cache directories were removed after verification; the cache directories were sent to the Recycle Bin.
