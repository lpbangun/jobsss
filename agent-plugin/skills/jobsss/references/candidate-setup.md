# Candidate setup without a master resume

A polished master resume is optional. Candidate-supplied facts are required.
Use the existing profile tools; do not add another skill or MCP server.

1. If the candidate has a resume, import its original text unchanged using
   `create_profile`. Read `get_resume` to check identity, roles and extraction.
2. If the candidate has notes or no resume, gather name/contact, then each role
   or project: organization, title, dates, what they did, and any supplied outcomes.
   Ask about education and skills. Volunteer work and coursework are acceptable
   when labeled accurately. Never infer credentials, dates or numerical results.
3. Assemble a labeled source resume from those answers. Missing facts remain
   questions outside applicant copy. Candidate confirmation is distinct from the
   plugin's trusted human proof-verification decision.
4. Import through `create_profile`; inspect extracted proof candidates and the
   full source readback. Route verification through the existing human handoff.
5. Keep the comprehensive source separate from job-specific selected content.
   A master resume export is optional and need not be one page. Preserve prior
   source revisions when new facts arrive.

The experimental structured-notes intake is in `experiments/resume-pocs` in the
development repository. It is not a new shipped runtime tool. Production callers
continue to use the tools above.
