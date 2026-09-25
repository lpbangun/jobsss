# First-class resume workflow

Run locally through the existing `jobsss` MCP server. Keep the original resume and
posting text under `PLUGIN_DATA`; never replace a source fact to make a requirement
appear covered. No tool here submits an application or contacts an employer.

1. Import the source resume with `create_profile`; inspect `get_resume` and verify
   extracted proof candidates. The resume header must contain a real candidate
   name and an email. Keep private strategy, logistics, audit, and verification
   notes outside applicant copy.
2. Import the exact job posting and call `inspect_resume_requirements` to read
   source lines and required/preferred/contextual priority. Inspect the title,
   employer, date/URL when available, and exact wording. Treat missing posting
   details as unknown.
3. Choose the application contact address deliberately with `contactEmail`.
   If the candidate explicitly verified relocation openness for this application,
   pass a short `locationNote` such as `Open to San Francisco`; do not infer it
   from the posting location.
   Run `tailor_resume` in Markdown first and inspect `document.resumeDocument`:
   `ir.nodes` are the applicant document; `ledger.claims` give source quotes,
   owner IDs and source lines; `ledger.target.requirements` reports
   `direct`, `adjacent`, `unsupported`, or `unknown` coverage. A cited keyword
   alone cannot establish that a full requirement is met.
   To revise the evidence selection, call `revise_resume` with claim IDs from
   the ledger in `excludeClaimIds` or `preferClaimIds`. It creates a distinct
   draft when the applicant copy changes and rejects foreign or non-evidence IDs.
4. Select facts by role relevance and credibility. For people/recruiting roles,
   lead with actual recruiting support, people operations, coordination, and
   follow-through. For product/founder roles, lead with ownership, discovery,
   execution, and clearly labeled product maturity. For customer education and
   learning roles, lead with onboarding, training delivery, learning design,
   documentation, and product education. Keep project accomplishments under
   their project owner, and distinguish prototypes, coursework, and live work.
   Do not turn interview participation into scheduling ownership or learning
   material creation into hiring/management tenure. Name genuine gaps.
5. Run `doctor` and check `resumeRenderer.available`. Call
   `list_resume_designs` to see the current design catalog. Choose `style: "navy"`,
   `"editorial"`, or `"scan"` when calling `render_resume` (or `tailor_resume`
   with `format: "pdf"`). Keep the contact address, location note, claim
   selection, and source revision fixed when comparing styles. Each style
   creates its own draft PDF and visual review binding; differences in layout
   alone do not establish which design performs better with employers. Use
   `compare_resume_designs` with the same profile and job to render all three
   from one content revision. `list_resume_design_variants` reads them back;
   `select_resume_design` records a user's preferred artifact. Selection is a
   local preference, not evidence that the resume was sent, used, or successful. Local
   Chrome/Edge prints plugin-generated HTML to a one-page Letter PDF. Set
   `JOBSSS_RESUME_BROWSER` to an absolute Chrome/Edge executable path if detection
   fails. The browser must stay on the local generated file; it is not an
   application browser. Missing capability returns `resume_renderer_unavailable`.
6. Call `inspect_resume_qa` for each variant; the local browser checks actual layout bounds at
   Letter printable width, then the PDF page count and searchable text mapping.
   Trusted approval blocks missing PDF QA, invalid ownership, or unverified
   cited proof points. Review the rendered PDF visually, then record that
   separate human decision with `./bin/jobsss decide --action
   artifact.review_visual` using the current binding from `decide --list`.
   Content approval uses a fresh binding and `artifact.approve` afterward.
   Check
   identity/contact, dates, role/project ownership, unsupported claims, private
   notes, page count, selectable text, readable fonts, safe margins, clipping,
   and whether important evidence was omitted solely to fit a page. Keep the
   returned artifact in `draft_needs_human_review` until a human decision.

The canonical resume document is the source of generated Markdown and PDF.
Normalized and migrated legacy sources, and both known and unknown employers,
take this path through the user-facing tailoring tools. The original imported
resume remains under `PLUGIN_DATA`; an inferred migrated source-line match is
marked `legacy_projection` for human review. Missing identity, contact,
or attributable evidence fails with a typed migration error. Native PDF export
remains available for other document kinds.
