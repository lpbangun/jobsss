# contact-brief.v1 import fixtures (fictional, offline)

Synthetic `contact-brief.v1` payloads for
`tests/contact-brief-import-regression.test.mjs`. Every employer, person,
address and URL below is fictional and uses reserved `.test` domains. No
provider was called, no address was verified, no mailbox was checked, and no
message is composed or sent: these files are recorded-evidence shapes only.

`contact-brief-v1.json` and `contact-brief-v1-no-address.json` are the direct
output of the Contact Brief package's own offline producer
(`scripts/contact_brief.py build <request> --now <fixed timestamp>`) and each
passes that package's `validate` command ("Valid contact-brief.v1"), so the
importer is exercised against a genuine producer payload rather than a
hand-written approximation. The build requests are recorded next to the run
evidence (`oprun-evidence/jobsss-e2e/scratch/g5-contact-import/`).

| Fixture | Shape | Purpose |
| --- | --- | --- |
| `contact-brief-v1.json` | Producer output: `schema_version`, `subject` (`name`/`company`), `identity`, `email` with `attribution: provider_reported`, `lookup` (`exa_agent_fiber`, run id, retrieved at), `mailbox` (`not_checked`), `coverage`, `signals`, `candidate_facts`, `draft`, `acceptance` | A staged import must read the subject identity and the provider-reported address natively, without the caller restating them as inline fields, and must not promote the address to a verified mailbox. |
| `contact-brief-v1-with-role.json` | The same producer output plus a producer-supplied `subject.role` | `role` is not part of the frozen contract body (`subject` is `additionalProperties: false`), so this file is deliberately a superset: when a producing run records an inspected role, it is read from `subject.role`; when it is absent, no role is invented. |
| `contact-brief-v1-no-address.json` | Producer output for the same subject with deliberately irregular casing/whitespace (`"  NADIA   OKONKWO "` / `"lumen LEARNING works"`) and `email.address: null` | Re-import reconciliation: an address-less brief for a name+company that already has one machine-created address-bearing record must land on that record instead of creating a second address-less logical contact. The irregular spacing is the normalized-identity evidence. |
| `legacy-staged-contact-no-address.json` | Contact-record body (not a brief): the address-less machine record the importer as shipped before `880aac5` wrote for a staged people-evidence brief — `source: 'staged_file'`, `email: null`, no `emailStatus`, no `provenanceHistory` | Legacy duplicate state for the address re-import regression. The test owns the per-import fields the old importer generated (`id` from the pre-fix address-less seed `${profileId}:${name}:${company}`, `profileId`, `sourceText`, timestamps) and seeds the record straight into an isolated `PLUGIN_DATA/store.json`, because current code can no longer produce this state. |
