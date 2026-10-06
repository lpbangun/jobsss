# JobSSS synthetic live resume journey

Status: frozen acceptance bar.

Candidate:

- Repository: `/home/logani/projects/jobsss-worktrees/resume-parity/jobsss`
- Branch: `feat/resume-parity`
- Frozen starting commit: `bd8e801e1e54e7611673aabd2a8f993d58764831`
- This is not the primary `main` checkout.

Executable authority:

```text
tests/quality-journey-resume.mjs
```

Run from the candidate repository:

```sh
node --test --test-concurrency=1 tests/quality-journey-resume.mjs
```

Run one criterion independently:

```sh
node --test --test-name-pattern='JR-J4 ' tests/quality-journey-resume.mjs
```

The evidence root defaults to:

```text
/home/logani/oprun-evidence/jobsss-fake-journey-2026-09-16
```

Override only when evaluating an equivalent copied evidence bundle:

```sh
JOURNEY_RESUME_EVIDENCE=/absolute/path \
  node --test --test-concurrency=1 tests/quality-journey-resume.mjs
```

## Interpretation of “six resumes”

The multiplication in the goal text is ambiguous. This bar freezes the explicit six-PDF interpretation:

- Three people.
- Two different live ohshi jobs per person.
- One PDF for each job.
- The two PDFs for each person use different styles.

Therefore there are six PDFs, not twelve. Each person’s pair is:

- Maya Alvarez: navy and editorial.
- DeShawn Brooks: navy and scan.
- Aisha Rahman: editorial and scan.

## Required journey

Each person runs in a separate `PLUGIN_DATA` directory and records this exact successful tool sequence:

```text
doctor
start
create_profile
create_saved_search
search_jobs
save_job
save_job
score_job
score_job
tailor_resume
tailor_resume
```

Requirements:

- `create_profile` supplies the person’s source resume through `resumeText`, byte-for-byte as frozen in the executable test.
- `create_saved_search` uses `adapter: "ohshi"` and no fixture.
- `search_jobs` must return at least one live result.
- The selected jobs must be two distinct jobs returned by that live search.
- Both selected jobs are explicitly saved and scored.
- Each selected job produces one PDF.
- The two PDF styles for a person differ and match the pair above.
- `import_job` is forbidden. Its presence anywhere in a transcript fails JR-J1.
- No send, submit, apply, browser automation, or claimed external application state is part of this journey.

The normalized transcript is JSON Lines. Each nonblank line has:

```json
{
  "seq": 1,
  "tool": "doctor",
  "arguments": {},
  "result": {}
}
```

`seq` must be strictly increasing. `arguments` and `result` must be the actual MCP tool arguments and parsed result, not a narrative reconstruction.

## Evidence layout

```text
<evidence-root>/
  manifest.json
  maya/
    journey.jsonl
    plugin-data/store.json
  deshawn/
    journey.jsonl
    plugin-data/store.json
  aisha/
    journey.jsonl
    plugin-data/store.json
  pdfs/
    <six PDF files>
    <six page-1 PNG files>
```

The PDFs and PNGs may use any safe filenames. Paths are declared by `manifest.json`.

Required manifest shape:

```json
{
  "schemaVersion": 1,
  "candidateCommit": "bd8e801e1e54e7611673aabd2a8f993d58764831",
  "implementer": "implementer identity",
  "journeyOperators": [
    "maya session identity",
    "deshawn session identity",
    "aisha session identity"
  ],
  "independentReviewer": {
    "name": "reviewer identity",
    "role": "independent-scorer"
  },
  "lanes": [
    {
      "key": "maya",
      "name": "Maya Alvarez",
      "pluginData": "maya/plugin-data",
      "transcript": "maya/journey.jsonl",
      "jobs": [
        {
          "jobId": "job_...",
          "artifactId": "artifact_...",
          "style": "navy",
          "pdf": "pdfs/example.pdf",
          "page1": "pdfs/example-page1.png"
        },
        {
          "jobId": "job_...",
          "artifactId": "artifact_...",
          "style": "editorial",
          "pdf": "pdfs/example-2.pdf",
          "page1": "pdfs/example-2-page1.png"
        }
      ]
    }
  ],
  "visualReview": {
    "artifact_...": {
      "sha256": "<PDF SHA-256>",
      "recruiterReadable": true,
      "oneColumn": true,
      "clearHierarchy": true,
      "sectionStructure": true,
      "noOverlap": true,
      "noMarkdownLinks": true
    }
  }
}
```

All three lanes are required. The independent reviewer must be different from the implementer and all three journey operators. Each visual review is bound to the exact PDF SHA-256.

Create page-one evidence with Poppler, not a browser:

```sh
pdftoppm -f 1 -singlefile -png input.pdf output-prefix
```

The executable test requires `pdftotext`, `pdfinfo`, and `pdftoppm` on `PATH`. No npm dependency, Chrome, Chromium, JobOS, or vendored renderer is accepted. JobSSS may use its native renderer or an already-installed `tectonic`.

## Scores

Every criterion prints exactly one score:

```text
JR-J1=9.0
```

or:

```text
JR-J1=0.0
```

There is no averaging. The command exits zero only when JR-J1 through JR-J10 all print `9.0`.

### JR-J1 — Live product flow

All three transcripts have the exact required successful sequence. The saved search is live `ohshi`, has no fixture, and `search_jobs` returns at least one result. Each selected job came from that result, has ohshi provenance and active liveness in the same lane’s store, and is saved, scored, and tailored as PDF. `import_job` is an automatic failure.

### JR-J2 — Synthetic identity integrity

Both PDFs for each person contain their legal name, city, email, and both source employers.

Any case-insensitive occurrence of these source identities anywhere in the six PDFs, transcripts, stores, or manifest fails the complete criterion:

```text
Logani
loganibangun
gse.harvard.edu
Underscoring
Indofood
Musim Mas
```

### JR-J3 — Chronology and ownership

Each source employer precedes its title and dates, with an owned source achievement before the next employer or EDUCATION. EDUCATION contains the frozen school name. `SELECTED ACHIEVEMENTS` is forbidden. Any named source project would have to retain its name; these three frozen sources contain no project section.

### JR-J4 — Real tailoring

For each person, each PDF contains at least four source achievement bullets. The two selected-bullet sets have Jaccard similarity at most 0.80 and are not equal. Removing contact and Focus lines cannot make the pair equal.

Numeric tokens in resume achievement content must already occur in that person’s frozen source resume. Job-posting metrics may not be copied into applicant achievements.

### JR-J5 — Styles

Each person uses the frozen two-style pair. The two PDF SHA-256 values differ and their Poppler bounding-box geometry signatures differ. Across all six PDFs, navy, editorial, and scan all appear.

### JR-J6 — ATS and PDF mechanics

Each artifact is a searchable Letter PDF produced by `native` or `tectonic`, with recorded body font size at least 10pt. A one-page PDF passes directly. A two-page PDF must not have a nearly empty final page. U+FB00–U+FB06 ligatures, NBSP, zero-width characters, replacement characters, and NUL are forbidden. Chrome, Chromium, and JobOS renderer evidence is forbidden.

### JR-J7 — Truthful density

A one-page PDF has vertical text fill of at least 0.80. A two-page PDF has a final page with at least 25% of the document’s words and at least 0.35 vertical fill.

Extracted word count must be between 72% and 120% of the frozen source word count. PDF text and the SHA-bound stored artifact content must agree within 10%. Non-layout content after removing the Focus line must remain source-grounded; padding or invisible text fails.

### JR-J8 — Visual and UX

The frozen test regenerates page one with `pdftoppm`, validates the supplied PNG, checks bounding-box words for overlap, and rejects rendered Markdown-link syntax. The independent reviewer must attest, against the exact PDF SHA, that the page is recruiter-readable, one-column, hierarchical, section-structured, and free from visible overlap.

The human attestation is intentionally not supplied by the implementer.

### JR-J9 — Isolation

The three resolved `PLUGIN_DATA` paths differ. Each contains exactly one expected profile. Profile IDs are different across lanes. No job, artifact, or search crosses profile ownership. Each person’s two selected jobs differ by company or title.

### JR-J10 — Frozen regression suite

The exact AGENTS.md suite exits zero:

```sh
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
  tests/jobsss-cross-platform.test.mjs
```

## Freeze and convergence

Iteration 0 freezes this file and `tests/quality-journey-resume.mjs`.

The implementer must not edit:

```text
JOURNEY_RESUME.md
tests/quality-journey-resume.mjs
BENCHMARK.md
tests/jobsss-*.test.mjs
tests/quality-resume-parity.mjs
RESUME_PARITY.md
```

After freeze:

- Maximum five implementation rounds.
- A round is consumed only by a product hotfix attempt.
- Use the smallest hotfix that fixes an observed MCP failure or frozen criterion.
- Completion requires the same six SHA-bound PDFs to pass every criterion.
- If any criterion remains at `0.0` after round five, report `not-converged` with the failing criterion IDs.
- Do not average scores or substitute an implementer self-score.

## Keep-out

Do not build or introduce:

- Three person-specific copy pipelines.
- A template zoo.
- Drive master resume as gold for these synthetic people.
- Fixture-backed `import_job` or fixture-backed ohshi search.
- Chrome, Chromium, npm dependencies, JobOS, or a vendored Tectonic.
- Automatic send, submit, apply, or external status claims.
- Invented employers, schools, dates, achievements, or metrics.
