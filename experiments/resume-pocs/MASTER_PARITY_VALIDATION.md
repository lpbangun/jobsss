# Master-resume parity validation — 2026-10-06

The shared compiler parses Markdown masters directly, preserves their factual
summary and separate job-specific positioning, and selects evidence within each
role before applying the configured bullet cap. The production browser renderer
supports master presentation and measures visible fill within readable presets.
The POC preserves headlines during source-summary repair and obeys evidence
selection constraints during fill repairs. CI runs the additive master-parity
regression suite with a required real local browser; frozen reviewer-owned tests
and BENCHMARK.md remain unchanged.

Validation on the final runtime:

- 63 resume/compiler/design/POC checks passed with no skips on Windows, including
  real MCP tailor, revise, render and batch routes, all eight target title cases,
  a supported full-page positive, and an insufficient-source negative.
- 49 frozen focused checks passed with no skips in a checkout named `jobsss`
  using the checksum-pinned official Node 22.22.3 linux-x64 executable.
- 20 package/mirror/install-surface checks passed with no skips on Linux.
- The shipped aggregate pack smoke passed on Windows using its declared Contact
  Brief dependency in an isolated test directory.
- Two fresh native-evidence processes using separate initially empty caches
  produced byte-identical JSON, matching `evidence/native-validation.json` at
  SHA-256 `a54f03d932bdb09d0d53333c7c1e672fc757a21c1a288824600f50ff448a04a9`.
- Canonical package, generated install surfaces, and Codex aggregate pack passed
  their source-parity checks against exact pinned sibling checkouts.
- A candidate-owned master was tested outside the checkout through the rebuilt
  cached MCP runtime. It retained 3/2/2 role bullets and two projects and rendered
  one searchable page at 94.62% visible fill with 10pt body type. Its actual PDF
  was visually inspected. No candidate text, identity or workspace paths are
  included in this repository.

Cross-built native targets remain unverified at runtime. Mechanical QA and visual
inspection do not establish human approval, proof verification, or submission.
