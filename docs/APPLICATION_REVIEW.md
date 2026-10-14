# Editable application review and IAB staging

Application preparation persists one profile-owned review record: posting, observed field inventory, confirmed facts, generated answers, user edits and canonical resume nodes. Run `./bin/jobsss review --data <dir> --profile <id> --job <id>` to inspect the token-protected local page. The host agent generates proposals; the page records generation requests and preserves user edits. User confirmation and exact-revision approval occur through the trusted local page.

Resume edits regenerate the actual PDF. Editing invalidates the PDF binding, independent quality review, staging approval and receipt. Required and user-expected optional answers block readiness when blank. Unknown constraints and unsupported factual claims remain unresolved. Quality scores must meet each applicable criterion; rendering or stage success cannot replace independent content and pixel inspection.

`startMcp({hostBrowserAdapter})` accepts supported host-owned `currentTab`, `inspect`, `fill`, `upload` and `read` capabilities. `stage_application` verifies current IAB identity, visibility, optional owner binding, official destination, inventory, exact reviewed values and replacement upload before recording read-back. It never calls submission. Standalone stdio has no browser adapter and returns `host_browser_required`; host tools are needed to perform actual staging. A prepared manifest is not a staged application.

## Verification and limits

Synthetic tests cover repeated edits, reopen, regeneration, missing answers, unsupported claims, stale revisions, replacement uploads, read-back mismatch, wrong/hidden tabs, API access controls, and stop-before-submit. Synthetic renderer fixtures verify binding and invalidation; they do not certify production PDF appearance.

Manual local IAB checks demonstrated field entry, displayed resume filename, narrative read-back and arrival at the final questions page without submission. A complete MCP-managed live staging receipt was not verified. Remote uploaded PDF bytes/hash were not exposed by the site. No applicant data, private evidence or browser-session artifacts belong in this repository.

Cross-host owner-pane attachment remains unresolved: a local worker tab cannot be declared visible in a different durable chat from a queued attachment or same URL. Browser visibility metadata conflicted with an owner screenshot; the screenshot alone does not establish current selection. Native host-adapter wiring is not automatically supplied by this runtime. A WSL renderer attempt previously timed out; Windows PDF rendering succeeded separately. Do not infer final ATS acceptance from staging, or silently substitute another renderer.

Applicant signatures, privacy acknowledgments and consent/waiver decisions require informed user action. Final submission is always separate. This feature is not a package publication or global plugin rollout.
