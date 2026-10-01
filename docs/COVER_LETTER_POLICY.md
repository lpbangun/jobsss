# Cover-letter requirements policy

Application preparation creates a cover letter automatically only when the posting or a complete application form requests one. The shared policy returns a requirement state, draft/skip decision, reason, and source evidence. Posting length and available proof points do not establish an employer request.

| Requirement state | Default | Explicit user request |
| --- | --- | --- |
| required | draft | draft |
| optional | skip | draft |
| not_required | skip | draft |
| not_requested | skip | draft |
| unknown | skip | draft |
| conflict | skip | draft |
| prohibited | skip | skip |

`draft_cover_letter.requestedByUser:true` and `prepare_applications_batch.coverLetter:true` represent an explicit user request for a letter. A generic application-preparation request does not justify setting either flag. False declines generation, including a required letter; the employer's requirement remains available for review. No override permits application-letter generation against an employer prohibition.

Complete, successfully fetched application detail distinguishes required and optional uploads from an absent upload field. Missing or degraded detail remains unknown. An explicit posting request can require a letter even without an upload field, for example an email application. Contradictory required/not-required evidence is recorded as conflict instead of silently guessing.

The policy applies to batch generation, individual generation, read-only briefs, tailoring material recommendations, persistent next-action tasks, and the application Markdown projection. Individual skipped calls return `ok:true`, `status:skipped`, `artifactId:null`, and the decision. Batch skipped letters have no artifact ID and do not make the batch fail. Decisions persist on job records; generated artifacts also carry the decision. Existing drafts, revisions, approvals, and exports remain intact. Obsolete open generic letter-generation tasks are cancelled with a recorded reason; completed tasks remain historical records.

## Verification

The additive policy suite exercises posting wording, HTML, required/optional/absent uploads, unavailable forms, contradictory evidence, explicit user overrides, employer prohibitions, ownership, persistence, existing artifact preservation, task reconciliation, projection truth, batch repetition, and the real MCP transport across processes. The existing cover-letter revision and conversation tests now explicitly request letters where they are testing letter authoring, and the conversation test expects a resume-only recommendation for unknown requirements.

Reviewer-owned `tests/jobsss-*.test.mjs` files remain unchanged. Their B21 and B29 checks predate this policy and expect letter generation for unknown requirements; these expectations conflict with the requested default. The unchanged installed-version baseline also fails B80, B81, B82, and B84: those fixtures expect proof coverage or approval that the current resume implementation does not provide. The first broad verification additionally hit a checkout-basename assertion and release tests using an unpinned Node executable; those are environment constraints, not letter-policy behavior.

Native-format evidence is regenerated from the final runtime and compared across fresh processes using separate empty external caches. Matching-host runtime status remains separate from structural evidence. Generated install packages mirror the canonical runtime and skill.

Final focused verification: 49/49 policy, document-authoring, conversation, MCP, and package-parity checks passed. Gate 0 and standalone current-host release verification passed 14/14 checks after using the checksum-pinned Node executable and a checkout named jobsss. The two final native-evidence regenerations were byte-identical at SHA-256 `ba5e69cd02c92c37e511e515224926b92e5d802a3df3581ebae315dcd629a5e1`.

PR integration verification: after merging main workspace setup, 54/54 focused and workspace checks and 14/14 Gate 0 and current-host release checks passed. The Codex source-drift regression passed, and both generated package mirrors and install surfaces passed their checks. Two final fresh native-evidence runs with separate empty external caches produced identical evidence at SHA-256 `f25d0997bd8e91af3cfea86557a6e37053d6fbec6cf317994bff4e96a65aeefc`.
