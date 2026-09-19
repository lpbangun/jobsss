# Resume parity bar (Codevisor)

Author: Codevisor `gpt-5.6-sol` / `openai-codex` / medium, session `20260916_054101_b329b0`.
Executable authority: `tests/quality-resume-parity.mjs`. This file explains it.
Implementer must not edit this file or the executable test.

Gold artifacts (measured 2026-09-16):
- `~/oprun-evidence/resume-profiles-2026-09-16/master_resume.pdf` — 1 page, vertical fill 0.8848, 383 words
- `profile-a-editorial.pdf`, `profile-b-navy.pdf`, `profile-c-scan.pdf` — compositionally distinct 1-pagers of the same facts

Each QRP-C1…C8 scores 10.0 or 0.0. Done = all 10.0. Not an average.

Fail-closed: email domain ≠ school; Focus-only difference ≠ tailoring; `SELECTED ACHIEVEMENTS` orphan bucket = fail; `gse.harvard.edu` does not satisfy Harvard Graduate School of Education.

Keep-out: Chromium, LaTeX, npm, JobOS, HTML intermediate, invented facts, three independent copy pipelines.

Runner:

```
node --test tests/quality-resume-parity.mjs
```
