# JobSSS recruiter-ready resume rebuild — frozen acceptance benchmark (iteration 0)

Status: **frozen acceptance bar**. Owner: Codevisor (benchmark owner), route `opencode-go / deepseek-v4.1-flash / reasoning=max`, caller `gpt-5.6-sol`, session `20260917_222103_68101e`.

Executable authority:

```text
tests/quality-resume-rebuild.mjs
tests/quality-resume-rebuild-negatives.mjs
tests/helpers/resume-rebuild-checks.mjs
```

Candidate worktree: `/home/logani/projects/jobsss-worktrees/resume-parity/jobsss` (branch `feat/resume-parity`; frozen spec commit at authoring `3143a153a9f3a1a0666c3ceeef66caa30775fe52`).

Default evidence root for this bar (override only when evaluating an equivalent copied bundle):

```text
/home/logani/oprun-evidence/jobsss-fake-journey-2026-09-16/resume-rebuild
```

Environment override: `RESUME_REBUILD_EVIDENCE=/absolute/path`.

This benchmark is **iteration zero**. It must be materialized, hashed, and frozen **before any product edit** to `src/`, `bin/`, `skills/`, `plugin.json`, or the frozen legacy bars. Benchmark creation does not consume one of the five implementation iterations.

---

## 0. Ownership, precedence, and correction policy

| Artifact | Owner | Who may edit |
| --- | --- | --- |
| `RESUME_REBUILD.md` (this document) | benchmark owner (reviewer) | reviewer only |
| `tests/quality-resume-rebuild.mjs` | reviewer | reviewer only |
| `tests/quality-resume-rebuild-negatives.mjs` | reviewer | reviewer only |
| `tests/helpers/resume-rebuild-checks.mjs` | reviewer | reviewer only |
| `<evidence-root>/resume-rebuild/inputs/*` | reviewer | reviewer only |
| Product files (`src/`, `bin/`, `skills/`, `plugin.json`, `mcp.json`) | implementer | implementer |

Frozen elsewhere; untouched by this bar, unchanged by implementers:

- `JOURNEY_RESUME.md` and `tests/quality-journey-resume.mjs` (legacy journey bar — preserved unchanged)
- `BENCHMARK.md` and `tests/jobsss-*.test.mjs`, `tests/helpers/jobsss-*.mjs` (Gate 0 bar)
- `RESUME_PARITY.md` and `tests/quality-resume-parity.mjs` (legacy parity bar)

Correction policy:

1. Missing product behavior is a **fail**, not a benchmark defect.
2. Only the reviewer may change this file, its tests, or its fixtures.
3. A correction requires a dated entry in the Correction log with the exact criterion ID, the cited contradiction, and the hash change. Convenience and "make it green" are not reasons.
4. The implementer must never edit, weaken, delete, rename, skip, or reinterpret any criterion, negative control, fixture, or expected exit code. Any post-freeze change to a frozen file invalidates the run until the reviewer re-freezes with new hashes.

---

## 1. Frozen corpus and inputs

Two designs, two temporary synthetic candidate profiles, one synthetic target posting per profile. All inputs are wholly synthetic; no Logani identity, facts, wording, or master-resume content may appear anywhere (see RR-02). Profiles and postings are frozen as files under `<evidence-root>/resume-rebuild/inputs/` and must be used byte-for-byte.

- Design **A** ↔ label `A` ↔ profile A (`inputs/profile-a.md`) ↔ posting A (`inputs/posting-a.md`)
- Design **B** ↔ label `B` ↔ profile B (`inputs/profile-b.md`) ↔ posting B (`inputs/posting-b.md`)

Both lanes run offline through the standalone plugin: no JobOS, no ohshi, no network at runtime, no fixtures outside these inputs, no npm dependencies.

### 1.1 Fixture `inputs/profile-a.md` (write verbatim; single trailing newline)

```text
Amara Osei
Denver, CO | amara.osei.platform@example.com | linkedin.com/in/amara-osei-platform

EXPERIENCE
Pillarline Systems - Denver, CO / Remote
Staff Software Engineer, Platform | March 2023 - Present
- Rebuilt the deployment pipeline for 42 services; median deploy time fell from 26 minutes to 7 with automated canary gates.
- Cut p99 checkout latency from 850ms to 210ms by moving session state to a sharded Redis tier with read-through caching.
- Ran the migration from self-managed Kafka to managed streaming with no customer-visible incidents across a 14-week cutover.
- Reduced annual cloud spend by $310K by right-sizing node pools and moving batch jobs to spot capacity.
- Mentored four engineers through the senior promotion rubric; two were promoted within a year.
- Wrote the incident command handbook now used across three engineering groups.

Quaystone Digital - Boulder, CO
Senior Software Engineer | June 2020 - March 2023
- Built the company's first Kubernetes platform; it grew to 30 services with self-serve provisioning.
- Introduced Terraform modules for VPC, IAM, and RDS; new environment standup dropped from five days to under two hours.
- Built TTFB_p95 dashboards and SLO alerts; pager volume fell 45% over two quarters.
- Partnered with R&D to stand up ephemeral test environments for integration testing.
- Automated database failover drills; recovery time objective improved from 4 hours to 45 minutes.

Cinderwood Commerce - Fort Collins, CO
Software Engineer | September 2016 - June 2020
- Shipped the order-routing service that handled 2.1M orders per month through peak retail seasons.
- Co-owned the on-call rotation and wrote the runbooks used for triage.
- Migrated 120 nightly batch jobs from cron servers to a queue-based scheduler.

EDUCATION
Colorado State University
B.S. Computer Science | 2016

SKILLS
Languages: Go, Python, TypeScript
Infrastructure: Kubernetes, Terraform, Kafka, Redis, AWS
Practices: SLOs, incident command, cost optimization, canary deploys
```

### 1.2 Fixture `inputs/posting-a.md`

```text
About Halcyon Grid
Halcyon Grid builds demand-forecasting software for electric utilities.

What you will do
- Own and evolve our Kubernetes platform for 60+ services across two regions.
- Define SLOs and lead incident response for the reliability program.
- Manage infrastructure as code with Terraform and keep environments reproducible.
- Drive cloud cost efficiency across engineering teams.
- Mentor senior engineers and partner with product groups.

What we are looking for
- A track record of operating high-scale container platforms.
- Reliability engineering depth: SLOs, on-call, incident command.
- Strong Terraform and cloud-native tooling skills.
- FedRAMP compliance audit experience is required for our utility customers.
- Python or Go proficiency.

Nice to have
- Managed Kafka experience.
- Observability dashboards and alerting.
- Public cloud cost programs.
```

### 1.3 Fixture `inputs/profile-b.md`

```text
Élodie Marchand
Montréal, QC | elodie.marchand.design@example.com | linkedin.com/in/elodie-marchand-design

SUMMARY
Product designer focused on design systems and accessibility for complex, data-heavy products.

EXPERIENCE
Loom & Line Studio - Montréal, QC / Hybrid
Product Design Lead | August 2021 - Present
- Led the Fieldnote design system from 12 scattered components to 48 governed components adopted by four product teams.
- Ran 30+ usability sessions on the claims workflow; task success climbed from 61% to 88% after the redesign, and support tickets about the claims view dropped by a third.
- Partnered with two engineering squads to ship an accessible data grid; closed 140 WCAG 2.1 AA audit findings across forms, tables, and dialogs.
- Established a monthly design critique that cut rework requests by roughly 30% across both squads.
- Mentored two junior designers through portfolio reviews and weekly critiques.
- Held quarterly accessibility office hours for design and engineering partners; support questions about keyboard navigation fell after the first two sessions.

Fernwood Media - Québec, QC
Product Designer | January 2018 - August 2021
- Redesigned the subscription flow; trial-to-paid conversion improved from 8% to 11% over two quarters.
- Built the first shared Figma library; adoption reached 90% of active designers within a quarter.
- Ran diary studies with 24 readers to reshape the mobile reading experience, including a compact reading mode for older devices.
- Standardized article templates with the editorial team; handoff time dropped from days to hours.

PROJECTS
Fieldnote Design System (2023)
- Published the Fieldnote roadmap and quarterly adoption metrics reviewed by all four teams.
- Documented accessibility patterns for forms, tables, and dialogs with annotated examples.

SKILLS
Methods: usability testing, diary studies, information architecture, journey mapping
Craft: design systems, interaction design, prototyping, accessibility (WCAG)
Tools: Figma, Storybook, Maze, Framer

EDUCATION
Concordia University
B.F.A. Design | 2017
```

### 1.4 Fixture `inputs/posting-b.md`

```text
About Aurelia Health
Aurelia Health builds care-coordination tools for clinics and community providers.

What you will do
- Own the design system and scale it across the product.
- Raise accessibility quality toward WCAG compliance in every release.
- Run research and usability testing with clinicians and patients.
- Partner closely with engineering on component delivery.
- Guide designers through critique and mentorship.

What we are looking for
- A portfolio of shipped design systems.
- Accessibility depth with hands-on WCAG 2.1 AA practice.
- Usability research experience.
- Native mobile development experience (Swift or Kotlin) is required for our patient app.
- Figma and component-library tooling.

Nice to have
- Storybook documentation.
- Design critique facilitation.
- Prototyping tools like Framer or After Effects.
```

### 1.5 Keyed requirement tables (frozen expectations)

Matching is done on normalized coverage text (see §6 normalization); each key group is a boundary-aware case-insensitive regex; an item "matches" when any of its groups matches `ledger.target.requirements[].text`.

Posting A:

| Id | Kind | Key groups (regex, any-of) | Required status |
| --- | --- | --- | --- |
| A-MH1 | must | `\bkubernetes\b` | direct or adjacent |
| A-MH2 | must | `\bslos?\b` / `\bincident` | direct or adjacent |
| A-MH3 | must | `\bterraform\b` | direct or adjacent |
| A-MH4 | must | `\bcost\b` | direct or adjacent |
| A-MH5 | must | `\bmentor` | direct or adjacent |
| A-S1 | unsupported | `\bfedramp\b` / `\bsoc[ -]?2\b` | **unsupported** (reason required) |
| A-P1 | preferred | `\bkafka\b` | any valid status; ≥2 of A-P1..P3 direct/adjacent |
| A-P2 | preferred | `\bobservability\b` / `\bdashboard` | any valid status |
| A-P3 | preferred | `\bcloud cost\b` / `\bcost program` | any valid status |

Posting B:

| Id | Kind | Key groups (regex, any-of) | Required status |
| --- | --- | --- | --- |
| B-MH1 | must | `\bdesign systems?\b` | direct or adjacent |
| B-MH2 | must | `\bwcag\b` / `\baccessibility\b` | direct or adjacent |
| B-MH3 | must | `\busability\b` / `\bresearch\b` | direct or adjacent |
| B-MH4 | must | `\bengineering\b` | direct or adjacent |
| B-MH5 | must | `\bmentor` / `\bmentorship\b` | direct or adjacent |
| B-S1 | unsupported | `\bswift\b` / `\bkotlin\b` | **unsupported** (reason required) |
| B-P1 | preferred | `\bstorybook\b` | any valid status; ≥2 of B-P1..P3 direct/adjacent |
| B-P2 | preferred | `\bcritique\b` | any valid status |
| B-P3 | preferred | `\bframer\b` / `\bprototyping\b` | any valid status |

Additional frozen constraints: ≥4 of 5 must items must be **direct** (the rest adjacent, none unsupported); ≥8 coverage entries total; every rendered achievement bullet's claims must appear in ≥70% of the coverage evidenceId sets (direct or adjacent) across the artifact.

### 1.6 Frozen forbidden-token sets (leakage and no-fabrication)

Applied to all candidate-facing surfaces (§6): every render's extracted text, all IR node text, `artifact.content` strings, and `qa.json` text fields. Not applied to `ledger.json`/`manifest.json` (target intelligence is metadata, permitted there — but only there).

| Design | Forbidden (regex, case-insensitive, boundary-aware) |
| --- | --- |
| A | `\bhalcyon\b`, `\bhalcyon grid\b`, `\bprincipal platform engineer\b`, `\bfedramp\b`, `\bsoc[ -]?2\b` |
| B | `\baurelia\b`, `\baurelia health\b`, `\bsenior product designer\b`, `\bswift\b`, `\bkotlin\b` |

Also forbidden on candidate-facing surfaces (metadata leakage): any line matching `^\s*(Focus|Target|Tailored for|Prepared for)\b` and the literal strings `insufficient evidence`, `human review`, `proof point`, `requirement id`, `coverage gap`.

---

## 2. Evidence bundle layout (under the evidence root)

```text
<root>/resume-rebuild/
  benchmark/
    RESUME_REBUILD.md            # byte-identical copy of the frozen benchmark doc
    hashes.repo.sha256           # sha256sum manifest of reviewer-owned repo files (run from repo root)
    hashes.evidence.sha256       # sha256sum manifest of benchmark copy + inputs (run from this dir)
    freeze.json                  # freeze record (§9)
    baseline.json                # iteration-0 baseline command results (§9)
    route-log.txt                # resolved route banners for every invoked agent
  inputs/
    profile-a.md  posting-a.md  profile-b.md  posting-b.md
  design-a/
    lane.jsonl                   # normalized MCP transcript, JR-style {seq,tool,arguments,result}
    lane/plugin-data/            # isolated PLUGIN_DATA lane state for design A
    renders/primary.pdf
    renders/primary-page1.png
    renders/alt.pdf
    renders/alt-page1.png
    renders/primary.log          # engine compile/render log (stdout+stderr, exit code recorded)
    renders/alt.log
    renders/latex-source.tex     # present when a LaTeX render exists
    renders/unavailable-probe.txt# RR-13 prerequisite-failure probe (command + captured output)
    ir.json
    ledger.json
    qa.json
    manifest.json
  design-b/                      # same layout as design-a
  review/
    criterion-report.md          # independent criterion-level reviewer output, SHA-bound
    criterion-report.raw.txt
    visual-attestation.json      # per-render-SHA attestation (§8)
    blind/                       # packet A.pdf, B.pdf, prompt.txt, packet.sha256, response.raw.txt
    logs/                        # command logs with exit codes for every §3 command
```

The two **artifacts** under this bar: `A` = `design-a/renders/primary.pdf`, `B` = `design-b/renders/primary.pdf`, each with its full bundle. Every criterion must pass for **both** artifacts. No averaging, no weighted totals, no partial credit, no best-of-pair.

Lane procedure (offline, standalone, `jobos` absent, blank provider keys): `doctor` → `start` → `create_profile` (exact profile text) → `import_job` (exact posting text, inline) → `score_job` → then, for the declared primary engine and the other first-class engine, two identical `tailor_resume` calls each (the first output is the frozen render, the second is the determinism probe). Exact call sequence and arguments are recorded in `lane.jsonl`; all calls must succeed. Each `tailor_resume` call must request `format: "pdf"`.

---

## 3. Executable commands and expected exit codes

Run all commands from the candidate repo root unless stated. `node --test` exits `0` only when every test passes; criteria print `RR-NN=PASS|FAIL` (single line each) and negatives print `RR-N#=DETECTED|MISSED`.

Preconditions (record outputs in `benchmark/baseline.json`; missing items block scoring — they are host defects, not product failures):

| Id | Command | Expected |
| --- | --- | --- |
| P1 | `node -v` | `v22` or newer |
| P2 | `command -v pdftotext pdfinfo pdftoppm pdffonts` | four absolute paths (install `poppler-utils` if any is missing) |
| P3 | `tectonic --version` | recorded (required for RR-13 on this host; install/record if missing) |
| P4 | `git -C . rev-parse HEAD` | 40-hex commit, recorded in `freeze.json` |

| Id | Command | Expected exit |
| --- | --- | --- |
| C1 | `cd <repo> && sha256sum -c <root>/resume-rebuild/benchmark/hashes.repo.sha256` | `0` (freeze intact) |
| C2 | `cd <root>/resume-rebuild && sha256sum -c benchmark/hashes.evidence.sha256` | `0` (inputs + benchmark copy intact) |
| C3 | `node --test --test-concurrency=1 tests/quality-resume-rebuild.mjs` | `0`; stdout contains `RR-01=PASS` … `RR-14=PASS` |
| C4 | `node --test --test-concurrency=1 tests/quality-resume-rebuild-negatives.mjs` | `0`; stdout contains `RR-N0=VALID` and `RR-N1=DETECTED` … `RR-N8=DETECTED` |
| C5 | `node --test --test-concurrency=1 tests/quality-resume-rebuild.mjs tests/quality-resume-rebuild-negatives.mjs` | `0` (combined acceptance command) |
| C6 | `node --test --test-name-pattern='RR-06 ' tests/quality-resume-rebuild.mjs` | `0`; one criterion independently |
| C7 | `node --test --test-concurrency=1 tests/quality-journey-resume.mjs` | `0`; `JR-J1`…`JR-J10` all `9.0` (legacy bar, unchanged) |
| C8 | `node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs tests/jobsss-journey.test.mjs tests/jobsss-persistence.test.mjs tests/jobsss-discovery.test.mjs tests/jobsss-workflows.test.mjs tests/jobsss-integrity.test.mjs tests/jobsss-release.test.mjs tests/jobsss-adapters.test.mjs tests/jobsss-authority.test.mjs tests/jobsss-cross-platform.test.mjs` | `0` (AGENTS.md suite) |
| C9 | `node --test --test-concurrency=1 <the 13-file frozen command from BENCHMARK.md>` | `0`; `# fail 0` |
| C10 | `node --test --test-concurrency=1 tests/quality-resume-parity.mjs` | `0`; `QRP-C1`…`QRP-C7` all `10.0` |
| C11 | when runtime bytes changed: `JOBSSS_NATIVE_CACHE=<empty external dir> ./bin/jobsss evidence --out <abs>` in two fresh processes | each `0`; outputs byte-identical to each other and to committed `evidence/native-validation.json`; update cited hashes in `RELEASE_REPORT.md`/`PRODUCTIZATION_REVIEW.md` per AGENTS.md |
| C12 | `pdftoppm -f 1 -singlefile -png design-a/renders/primary.pdf design-a/renders/primary-page1` | `0`; PNG written; the checker re-runs this and validates the supplied page-1 files |

C7 and C10 must remain green: their executable files are frozen and must never be edited, skipped, or weakened. If an environment blocker prevents their execution (for example missing poppler), fix the environment — a missing tool is not a product failure and not a reason to alter the bar. C3–C5 are the new hiring-quality gate; C6 is the independent single-criterion run (same for any `RR-NN`).

Tool binaries are overridable via `PDFTOTEXT`, `PDFINFO`, `PDFTOPPM`, `PDFFONTS` environment variables, mirroring the legacy bar.

---

## 4. Mandatory criteria (all must pass for both artifacts)

Each criterion is evaluated for artifact `A` and artifact `B`; a criterion prints `RR-NN=PASS` only when it passes for both, otherwise `RR-NN=FAIL` with a diagnostic line `RR-NN-FAIL(<A|B>): <reason>`. Machine checks are implemented in `tests/helpers/resume-rebuild-checks.mjs` and consume the bundle exports (§6) plus Poppler extraction of the PDFs. Reviewer checks are recorded in `review/criterion-report.md` and `review/visual-attestation.json`. Every criterion is `AND` across artifacts with no aggregation.

**RR-01 — Evidence provenance and claim integrity (machine + reviewer).** Every IR content node (`summary`, `achievement`, `skill`, `project_item`, `education`) carries ≥1 `claimId` resolving to `ledger.claims`; role/heading/contact nodes carry exact source fields or an explicit structural reason. Every claim carries an exact `sourceQuote` that is a byte-exact substring of the frozen profile text, an owner equal to the candidate name, a `transformation` in the closed set `{verbatim, shortened, compressed, reordered, grammar_only, punctuation_normalization}` and a `status` in `{active, insufficient_evidence, rejected, needs_human_review}` with non-empty reasons for non-active statuses; no rejected or insufficient claim's content is rendered. Node token rule (R2): every non-whitelist token of an `achievement`/`skill`/`project_item`/`education` node appears in the union of its claims' `sourceQuote` tokens; role nodes' employer/title/date tokens appear in the profile. Metric-atom rule: every metric atom in candidate-facing text (regex `[$]?\d[\d.,]*(?:ms|s|x|%|K|M|\+)?`, case-insensitive) appears in the profile's metric-atom set, and every claim's own atoms appear in its quote. Global grounding rule (R1): all candidate-facing tokens are in the profile token set, the frozen function-word whitelist, the frozen allowed-heading vocabulary, or page chrome. Reviewer re-derives two random rendered bullets to their source spans and confirms no invented employer, title, metric, technology, ownership verb, or outcome.

**RR-02 — Candidate ownership and role compatibility (machine + reviewer).** Exactly one candidate identity per design bundle; artifact A contains only profile-A facts and artifact B only profile-B facts (cross-contamination scan both ways on names, employers, schools). Every rendered employer, title, school, and date matches a source record's owner. No title or specialty claim in the header/summary/positions exceeds the source (no promotion, no unsupported seniority or domain positioning). The frozen identity blocklist must not appear anywhere in the bundle, transcripts, renders, or stores: `Logani`, `loganibangun`, `gse.harvard.edu`, `Underscoring`, `Indofood`, `Musim Mas` (case-insensitive). Reviewer attests role compatibility explicitly (positioning supported by demonstrated work).

**RR-03 — Chronology and employer/title credibility (machine).** All three (A) / two (B) source roles are retained; role nodes are in source order; within a role the rendered employer precedes title precedes the date range (normalized index ordering on extracted text), and each role owns ≥1 achievement node whose claim's `roleIndex` matches. Date ranges are rendered as normalized source strings. Education renders the source school. No invented role boundaries, gaps, or overlaps; every rendered date token resolves to the profile. Reviewer spot-checks credibility (no title inflation, no misplaced achievements).

**RR-04 — Neutral summary and no candidate-facing metadata (machine + reviewer).** Exactly one `summary` node exists with 2–4 sentences and 25–90 words, ≥2 resolving claimIds, ≥0.80 content-token grounding against the profile, no forbidden leak tokens, and no first-person marketing fluff. No candidate-facing surface renders `Focus:`, `Target:`, `Tailored for`, `Prepared for`, requirement inventories, proof IDs, review notes, or coverage language. `Focus:` may exist only in metadata files (ledger/manifest) and is then invisible in every render. Reviewer attests the summary is neutral, factual, and recruiter-relevant.

**RR-05 — Target-company/title leakage prevention (machine).** The frozen forbidden-token sets (§1.6) appear on no candidate-facing surface of either artifact. The `ledger` records target intelligence (company, title, requirements) outside candidate copy — target metadata must be present in metadata and absent from copy. Reviewer runs an independent leakage scan and records it.

**RR-06 — Achievement specificity and source-backed results (machine + reviewer).** Every rendered bullet is 8–45 words, begins with a verb token present in the profile, and (if any backing claim quote contains `partnered|supported|contributed|helped|co-owned`) retains at least one of `with|partnered|supported|contributed|helped|alongside`. Artifact renders ≥8 bullets; ≥75% of bullets carry a result signal (metric atom or a frozen outcome lemma present in the profile: `fell|dropped|reduced|improved|climbed|cut|grew|increased|closed|adopted|reached|eliminated`); ≥4 bullets carry metric atoms. All metric atoms obey RR-01. Reviewer re-checks action/context/result structure and qualifier preservation (no causation inflation).

**RR-07 — Requirement coverage without keyword-only fabrication (machine).** `ledger.target.requirements` covers every keyed item in §1.5 with a valid status, evidenceIds for every direct/adjacent entry, and non-empty reasons for unsupported entries; must items are ≥4 direct and none unsupported; ≥2 preferred items direct/adjacent; ≥8 entries total; ≥70% of rendered bullets' claims appear in direct/adjacent evidenceId sets. No unsupported-requirement vocabulary is rendered (RR-05 token sets), and nothing beyond profile-grounded content may be added (RR-01 R1/R2). Reviewer inspects the coverage matrix for genuine conceptual matches rather than lexical echo.

**RR-08 — Content depth and recruiter scanability (machine).** Useful-word count (rendered words excluding name, contact block, section headings, and page chrome) is 250–400 for each artifact. ≥8 substantive bullets (each ≥8 words and claim-backed). 1–2 pages; a one-page artifact has vertical text fill ≥0.72; a two-page artifact's final page carries ≥25% of the document's words with fill ≥0.35 and the first page fill is ≥0.70.

**RR-09 — Grouped skills and information architecture (machine + reviewer).** Rendered skills are ≥2 named groups with ≥2 items each and ≥6 items total; every skill token resolves to the profile (skills or claims); no duplicates. Section order: header/contact, summary, experience (source order), optional projects/certifications, education, skills. No empty section: every rendered section heading has ≥1 item and no dangling headings. The heading `SELECTED ACHIEVEMENTS` is forbidden. Reviewer attests IA usefulness (sections, grouping, no orphan buckets).

**RR-10 — ATS-safe text: reading order, Unicode, links, contact (machine).** Extracted text is searchable (≥200 words), single-column (≤4 left-edge word clusters per page, ≥95% mass in clusters), and follows IR order (node start tokens form a subsequence of the extraction order, matching y-order top-to-bottom). No hostile glyphs (`\u00a0`, zero-widths `\u200b-\u200f`, bidi controls `\u202a-\u202e`, `\u2060`, ligatures `\ufb00-\ufb06`, `\ufffd`, NUL); text equals its NFC form; curly quotes are paired (no paragraph with an unmatched `“` or `”`, no token opening with `”` or closing with `“`). Contact block parses: name, valid email, source city, and source profile URL when present; no Markdown link syntax `[..](..)`, no `mailto:`; name precedes the contact line. Reviewer confirms reading order and contact readability on the page-1 evidence.

**RR-11 — Visual quality: hierarchy, density, whitespace, clipping, overlap, page breaks (machine + reviewer).** For every render: zero overlapping word boxes (>0.75pt on both axes); no clipped or out-of-bounds words (all boxes inside a 20pt page inset); no word with bbox height <4pt (invisible/padding text); no intra-page blank band >44pt between consecutive text rows; no section heading as the last row of a non-final page (no orphan headings); page-break quality per RR-08 floors. Padding/invisible text beyond the IR fails RR-12 token closure as well. Reviewer attests on regenerated Poppler evidence, bound to each PDF SHA-256: clear hierarchy, intentional whitespace, readable density, no visual defects. For the two primaries, the reviewer additionally attests they are genuinely distinct designs — not merely color, font, or spacing variants of one design (structural differences in section architecture, heading system, entry composition, or density strategy).

**RR-12 — Canonical IR parity and rendering determinism (machine).** Both designs ship two first-class engine renders (`primary` + `alt`) produced from the same `irSha256`. For every render: every `renderPolicy:"required"` IR node's normalized token sequence appears in the extracted text, all IR node sequences appear in IR order, and extracted tokens are a subset of IR tokens plus allowed chrome (heading vocabulary, page numbers, contact separators) — no renderer-side invention, re-ranking, fallback, or dropped node. Determinism: the two in-lane renders of each engine (frozen artifact and probe) and a fresh reviewer re-render of the recorded `generationArgs` are byte-identical. Calibration (verified on this host, tectonic 0.15.0): LaTeX renders are byte-reproducible only with a pinned `SOURCE_DATE_EPOCH` (default `/CreationDate` differs per run); the manifest must record the pinned value and the determinism pair must be byte-identical.

**RR-13 — Lightweight LaTeX backend compilation and native text (machine + reviewer).** Each design includes a successful compile of the LaTeX backend over the canonical IR (not re-parsed Markdown): `renders/latex-source.tex`, `renders/*.log` with exit code 0 and no fatal errors, engine identity recorded and matching the host engine (e.g., `tectonic 0.15.0`), and searchable native text per RR-10/RR-12. `pdffonts` output must equal the manifest's `fontClosure`, with every non-standard font embedded. Removing the engine/font prerequisite must produce a typed failure with no partial artifact, or a documented explicit fallback recorded in the manifest and probe file (`renders/unavailable-probe.txt`); silent engine substitution is a fail. Reviewer reproduces the probe.

**RR-14 — Independent review: every criterion passes individually; blind scores (process).** All of, preserved as evidence:
(a) an independent criterion-level reviewer, distinct from implementer and lane operators, evaluates RR-01…RR-13 against the exact frozen candidate SHA and both artifacts and returns per-artifact, per-criterion PASS/FAIL with cited evidence in `review/criterion-report.md` — a numeric average is never acceptance;
(b) SHA-bound visual attestation for every render in `review/visual-attestation.json`;
(c) a fresh, context-free Codevisor instance receives **only** two PDFs labeled `A` and `B` (packet `review/blind/A.pdf`, `B.pdf`; nothing else — no repo, history, research, benchmark text, scores, or intended winner) and the frozen prompt from §8; its raw response is preserved in `review/blind/response.raw.txt`; acceptance requires a ranking and a score ≥9.0/10 for **each** resume — one strong resume, a 9.0 average, or a preferred ranking is not enough;
(d) verdict aggregation: PASS iff every criterion passes for both artifacts, the negatives suite reports all `DETECTED`, all regression commands (C7–C10, and C11 when applicable) exit `0`, and both blind scores are ≥9.0. Any single failure rejects the iteration; fixes start the next iteration (max five), measured against root causes — not against reviewer wording. After five rejected iterations, stop honestly as `not-converged` with residual gaps and preserved evidence.

---

## 5. Negative controls (must be detected; the suite exits `0` only when every planted defect flips the bar to FAIL)

`tests/quality-resume-rebuild-negatives.mjs` first builds a deterministic conformance bundle from the frozen inputs (§6 contract) that passes RR-01…RR-13 (`RR-N0=VALID`). Each control clones the conformance bundle, applies exactly one mutation, and asserts (i) the named criterion(s) return FAIL and (ii) the bar verdict (`barVerdict(bundle)`) returns FAIL. A missed defect prints `RR-N#=MISSED` and fails the suite — an unfalsifiable evaluator is itself a benchmark failure. Negatives run against the checker code used on real artifacts; PDF-class controls operate on the extraction-record layer because the checkers consume extraction records for both conformance and real Poppler-extracted evidence.

| Id | Planted defect (exact mutation) | Must flip to FAIL |
| --- | --- | --- |
| RR-N1 | Add `, boosting renewal revenue 37%` to one rendered achievement (IR text, extraction, not in any claim quote or the profile) | RR-01 (metric atoms + R2), RR-06 |
| RR-N2 | (a) Rewrite `Partnered with two engineering squads to ship` → `Led two engineering squads and shipped` when the claim quote lacks `led`; (b) move an achievement's tokens under the wrong employer's role | (a) RR-01 (R2), RR-06; (b) RR-03 |
| RR-N3 | Insert target company `Halcyon Grid` into the summary; insert `Senior Product Designer, Design Systems` into a second clone's header | RR-05 both |
| RR-N4 | (a) Empty the `SKILLS` group items while keeping the heading; (b) add a bullet with no backing claimIds | (a) RR-09; (b) RR-01 |
| RR-N5 | Remove a `renderPolicy:"required"` node's tokens from the extraction while leaving it in the IR | RR-12 |
| RR-N6 | Inject `\u200b`, `\ufb03`, `\u00a0`, `\ufffd`, and a paragraph with a lone `”` into the extraction | RR-10 |
| RR-N7 | Swap two block token runs in the extraction (summary after experience; bullets reordered across roles) | RR-10 (reading order); RR-03 for the cross-role variant |
| RR-N8 | (a) Append repeated filler tokens beyond the IR union; (b) add a 2pt-height word to a letter-shaped geometry record | (a) RR-12 (token closure); (b) RR-11 (invisible text) |

Escape hatch ban: no negative may be satisfied by making the checker accept the mutation, by weakening the criterion, or by special-casing fixture strings. The conformance bundle and every mutation are deterministic (no clock, no randomness, no network).

---

## 6. Frozen export contract (product → bundle)

The internal schema is the implementer's design. The following **exports** are the acceptance interface; extra fields are allowed, missing fields fail RR-01/RR-12 where used.

`ir.json`: `{schemaVersion:1, designId, candidateName, nodes:[{nodeId, type, order, text, claimIds:[], structuralReason|null, renderPolicy:"required"|"optional", roleRef:{employer,title,dates}|null}]}`. `type` ∈ `{header, name, contact, section_heading, summary, role, achievement, education, skills_group, skill, project, project_item, page_chrome}`; `order` strictly ascending; content nodes non-empty `text`; unique `nodeId`.

`ledger.json`: `{schemaVersion:1, profileId, claims:[{claimId, sourceQuote, roleIndex|null, ownerName, action, context, outcome, metric, unit, scope, timeframe, confidence, transformation, status, reasons:[]}], rejected:[{reason, sourceQuote|null}], target:{company, title, requirements:[{requirementId, text, priority:"must"|"preferred", status:"direct"|"adjacent"|"unsupported", evidenceIds:[], reason:""}]}}`. `sourceQuote` must be a byte-exact substring of the frozen profile text (trimmed).

`qa.json`: `{schemaVersion:1, designId, artifactSha256, checks:{<id>:{ok:true, details:any}}}` with frozen ids `provenance_recall, token_recall, order, duplicates, links, contact_order, unicode_scan, leakage_scan, chronology_scan, searchable_text, letter_geometry, overlap_scan, clipping_scan, orphan_headings, page_breaks, density, whitespace_bands, ir_parity, determinism` — all `ok:true`. The frozen bar independently re-verifies outcomes; `qa.json` proves the product's deterministic QA covers every area of the spec.

`manifest.json`: `{schemaVersion:1, designId, label:"A"|"B", candidateCommit, profileSha256, postingSha256, lane:{transcript, pluginData}, renders:[{renderId:"primary"|"alt", file, page1, engine:"native"|"external-latex", engineIdentity, designStyleId, sha256Pdf, pages, irSha256, artifactSha256, bodyFontPt, marginsPt:{top,right,bottom,left}, fontClosure:[], reproducible:{sourceDateEpoch, pairSha256:[a,b], byteIdentical:true}, generationArgs:{...exact MCP arguments...}}]}`. Recorded hashes must match the files byte-for-byte; recorded engine/fonts/margins must match reality (feeds the truthfulness checks).

Normalization (frozen): NFKD → lowercase → curly quotes to straight → dashes `–—` to `-` → collapse whitespace. Tokens: `[a-z0-9][a-z0-9+%._-]*`; single-character tokens are ignored by grounding rules. Frozen whitelist: closed English function-word set + month names + `{present, remote, hybrid, onsite}`; allowed heading vocabulary: `{SUMMARY, PROFILE, EXPERIENCE, EDUCATION, SKILLS, PROJECTS, CERTIFICATIONS}` (case-insensitive); page chrome: digits and `page`.

---

## 7. Required additive tests and fixture definitions

| File | Owner | Responsibility |
| --- | --- | --- |
| `tests/quality-resume-rebuild.mjs` | reviewer | RR-01…RR-14 registration, bundle loading for both designs, one score line per criterion, exit `0` iff all pass for both artifacts |
| `tests/quality-resume-rebuild-negatives.mjs` | reviewer | conformance bundle (`RR-N0=VALID`) + RR-N1…RR-N8 mutation/detection tests + aggregate-verdict flip assertions |
| `tests/helpers/resume-rebuild-checks.mjs` | reviewer | Poppler wrappers, extraction records, all machine checkers, frozen constants (whitelist, lemmas, hostile-glyph regex, metric-atom regex, keyed tables §1.5, forbidden sets §1.6), conformance-bundle builder, mutators |
| `<root>/resume-rebuild/inputs/*` | reviewer | the four fixtures, byte-frozen in §1 |

Harness invariants: no npm dependencies; no network; no Chrome/Chromium; no JobOS; reads only the evidence bundle, the frozen inputs, and Poppler binaries; never writes into the repo or into `PLUGIN_DATA` lanes; every printed score line is exactly `RR-NN=PASS|FAIL` / `RR-N#=DETECTED|MISSED`; failures name the artifact and the offending value.

Iteration-zero gate: the benchmark is frozen only when C1 and C2 verify, the negatives suite passes standalone (`RR-N0` + all `DETECTED`), and the baseline record is written. Only then may product edits begin.

---

## 8. Cold-reader and independent-review evidence instructions

**Independent criterion reviewer (for RR-14a/b).** Give this reviewer: this benchmark, the evidence bundle, and read access to the repo at the frozen candidate SHA. Do **not** give implementer narration, prior scores, or intended outcomes. The reviewer must: re-run C3–C5 and C7–C10 (recording commands and exit codes), open every render's extracted text and page-1 raster, check each criterion for A and B individually, and write criterion-level PASS/FAIL with the exact failing evidence cited. Numeric averaging is not acceptance. Identity must differ from the implementer and all lane operators; record the reviewer's identity and resolved route in `benchmark/route-log.txt`.

**Visual attestation (RR-14b).** For every render, regenerate page 1 with Poppler, hash the PDF, and attest `{recruiterReadable, oneColumn, clearHierarchy, intentionalWhitespace, noOverlap, noClipping, noOrphanHeadings, pageBreakQuality}`. For the two primaries, add the design-distinctness attestation (≥3 structural differences, named). Attestations are bound to the exact PDF SHA-256; a changed byte invalidates the attestation.

**Blind Codevisor packet (RR-14c).** Copy only `design-a/renders/primary.pdf` → `review/blind/A.pdf` and `design-b/renders/primary.pdf` → `review/blind/B.pdf`; record `sha256sum` of both in `review/blind/packet.sha256`. Invoke a fresh Codevisor context with the explicit route (provider `opencode-go`, model `deepseek-v4.1-flash`, reasoning `max`), record its resolved banner, and send exactly this prompt (nothing else):

```text
You are given two finished resumes labeled A and B. No other context is provided.
Score each resume independently for recruiter-readiness on a 0-10 scale (one decimal
allowed), where 10 is an excellent, immediately usable document for a senior hiring
context and 0 is unusable. Then rank the two (or state a tie). Answer exactly:

SCORE A: x.x
SCORE B: y.y
RANK: <A, B, or tie>
BRIEF REASONS: <at most 6 lines per resume>
```

Preserve the raw response verbatim in `review/blind/response.raw.txt` with the route banner, timestamp, and packet hash. Do not coach, hint, or reveal criteria, targets, or scores. Acceptance: both scores ≥9.0. If the reader asks questions or the packet is contaminated, discard the packet, rebuild it, and restart the read.

**Preservation.** All raw outputs (commands, exit codes, logs, manifests, hashes, reviewer reports, blind response) stay under the evidence root. Nothing under `review/` may be edited after it is written; corrections are appended as dated addenda. No push, merge, release, deploy, upload, or external publication at any point.

---

## 9. Hash and freeze procedure (execute once, before product edits)

```sh
ROOT=/home/logani/oprun-evidence/jobsss-fake-journey-2026-09-16/resume-rebuild
REPO=/home/logani/projects/jobsss-worktrees/resume-parity/jobsss
mkdir -p "$ROOT"/{benchmark,inputs,design-a/renders,design-a/lane/plugin-data,design-b/renders,design-b/lane/plugin-data,review/blind,review/logs}

# 1. Write the four fixtures (§1) and the reviewer-owned files (§7) into place.
#    Copy this document byte-identically:
cp "$REPO/RESUME_REBUILD.md" "$ROOT/benchmark/RESUME_REBUILD.md"

# 2. Hash everything.
( cd "$REPO" && sha256sum \
    RESUME_REBUILD.md \
    tests/quality-resume-rebuild.mjs \
    tests/quality-resume-rebuild-negatives.mjs \
    tests/helpers/resume-rebuild-checks.mjs \
    > "$ROOT/benchmark/hashes.repo.sha256" )
( cd "$ROOT" && sha256sum \
    benchmark/RESUME_REBUILD.md \
    inputs/profile-a.md inputs/posting-a.md inputs/profile-b.md inputs/posting-b.md \
    > "$ROOT/benchmark/hashes.evidence.sha256" )

# 3. Verify the freeze is intact.
( cd "$REPO" && sha256sum -c "$ROOT/benchmark/hashes.repo.sha256" )   # expect exit 0
( cd "$ROOT" && sha256sum -c benchmark/hashes.evidence.sha256 )       # expect exit 0

# 4. Write benchmark/freeze.json with: schemaVersion, frozenAt (ISO-8601 UTC), repo path,
#    branch, candidateCommit (`git rev-parse HEAD`), the file->sha256 map for all files in
#    both manifests, the frozen spec commit 3143a153a9f3a1a0666c3ceeef66caa30775fe52,
#    every prerequisite result from §3 (P1–P4), and frozenBeforeProductEdits: true.

# 5. Record the iteration-0 baseline (write benchmark/baseline.json):
#    run P1–P4 and C7–C10 plus one C3/C4 dry attempt; record command, exit code, counts.
#    A missing-tool environment blocker is recorded as such; a legacy suite failure is
#    recorded truthfully and must be fixed without editing frozen files.

# 6. Append every agent's resolved route banner to benchmark/route-log.txt as it is invoked
#    (provider, model, reasoning, caller; mark unverified if a field cannot be resolved).
```

Invalidation rules: any change to a hashed file invalidates the run until the reviewer re-freezes with a dated correction-log entry and a fully re-verified `sha256sum -c`. The final report must include the benchmark hashes, candidate SHA, both artifact paths, criterion-level verdicts, blind scores, commands with exit codes, and the convergence status (`converged` only on all-pass plus both scores ≥9.0; otherwise `not-converged` with residual gaps — never called success).

---

## 10. Keep-out (do not build, and do not do)

- Do not edit `JOURNEY_RESUME.md`, `tests/quality-journey-resume.mjs`, `BENCHMARK.md`, `tests/jobsss-*.test.mjs`, `tests/helpers/jobsss-*.mjs`, `RESUME_PARITY.md`, `tests/quality-resume-parity.mjs`, or this benchmark's files from the implementer side.
- No person-specific copy pipelines, no template zoo, no hard-coded fixture strings or per-profile special cases in product code; the compiler must be generic.
- No invented employers, schools, dates, achievements, metrics, technologies, titles, or outcomes; insufficient evidence must be reported honestly, never padded.
- No target-company/title/requirements in candidate copy; no `Focus:` line in any render; no proof IDs or review notes in candidate copy.
- No artificial `\vfill`, fixed whitespace bands, invisible/padding text, micro-type, or metadata that lies about fonts/margins/engine.
- No JobOS resolution or spawn; standalone plugin only; all state under `PLUGIN_DATA`; synthetic inputs only; no Logani identity data anywhere.
- No npm dependencies, no Chrome/Chromium, no vendored Tectonic, no browser renderer evidence, no network at runtime.
- No push, merge, release, deploy, or external publication; no submission/send/apply behavior of any kind.
- Do not weaken, rename, skip, or reinterpret any criterion, negative control, fixture, or expected exit code — including "temporary" local edits.

## Correction log

- 2026-09-18 — Reviewer correction for RR-11, RR-N6, C12, and RR-13 after Codevisor audit `/home/logani/oprun-evidence/jobsss-fake-journey-2026-09-16/codevisor-freeze-audit.raw.md`. Cited contradiction: Poppler rows carry `nodeId:null` so orphan headings were inert; RR-N6 planted ASCII `ffi` instead of U+FB03; C12 recorded generated and supplied page-one hashes without comparing them or surfacing PDFTOPPM failure; RR-13 parsed font names without the `emb` column. Old -> new SHA-256: `tests/helpers/resume-rebuild-checks.mjs` `57ce6b8cd6a0f37dd76ce8ce0476dc1fc59e0f462aa57dd6a38fc3b4e3bc923a` -> `ed581f61da3033c4ab806e0002829e75c696c1eea7c19b995e83ff7c07c3c3f0`; `tests/quality-resume-rebuild-negatives.mjs` `b6c3271d801cc3e4d75be163c2c29469e4c4185e8a315e99027e098c049d82cf` -> `a62d4c85f092c9d4f0bf51cb5dff5c64f09ae6c4fb32f6690e8ff43fdb77e044`; `tests/quality-resume-rebuild-reviewer-corrections.mjs` absent -> `00eb81f40dee9b737ea830d8e7a97001483ab147bf2b38369831e581d8a55dae`. The repository and evidence benchmark copies are re-frozen together; product-only diff remains `80f145b05b1af9d76bb360e545b80ff14bef740292f1d251447c9aa02f9145a1`.

