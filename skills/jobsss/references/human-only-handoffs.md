# Human-only handoffs

The following JobOS operations are human-only. They are **not MCP-attestable**, require a handoff to the trusted CLI/TUI, and must never be reported as done by JobSSS:

- `approve_artifact`
- `reject_artifact`
- `approve_contact`
- `answers_add`
- `create_application_packet`
- `attest_application_submitted`
- `confirm_application_receipt`
- `checkpoint_application_form`
- `verify_interview_story`
- `retire_interview_story`
- `add_interview_question_source`
- `record_interview_debrief`
- `correct_interview_debrief`
- `record_job_feedback`
- `correct_memory_observation`
- `undo_memory_observation`
- `accept_memory_proposal`
- `reject_memory_proposal`
- `revoke_memory_proposal`
- `undo_memory_transition`
- `network_contact_record`
- `mark_outreach_sent`

Treat approval, rejection, packet creation or freezing, submission and receipt attestation, and recording an outreach send only as typed handoffs. Do not expose or call these through MCP, and do not convert a draft, plan, checkpoint, or request into a claim of completion.

`submit_application_form`, `inspect_application_form`, and `assist_application_form` are blocked and unavailable in standalone JobSSS. Hand browser/application-form work to a trusted human; never claim these tools exist, ran, or produced submission success.
