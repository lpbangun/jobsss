# Provider boundaries

## Codex Exa plugin route

In Codex, prefer a callable Exa web-search tool for one already identified person when no professional email is sourced. Detect the tool by its capability and description; current names may include `mcp__codex_apps__exa_web_search_exa` and the optional `mcp__codex_apps__exa_web_fetch_exa`, but aliases are valid. The host agent must call the tool directly; do not try to invoke an MCP tool through Python or a shell.

Use an email-only prompt that asks for at most one attributable professional address, source URLs and null when uncertain. Do not use the plugin for identity resolution, LinkedIn/X profile discovery or activity research. If a returned source needs inspection, fetch only that source for email attribution and retain the actual retrieval timestamp. Normalize the result into the [plugin handoff](exa-plugin-result.md) and run the offline `import-exa` command.

The plugin path needs no `EXA_API_KEY`. The MCP tool may have its own account, rate and cost behavior; report returned cost data when available and otherwise record cost as unknown. Do not claim the direct Agent API's `$0.045–$0.05` allowance, POST journal or duplicate-dispatch protection for a plugin call. Keep the handoff private and preserve the raw or redacted returned evidence. The importer marks an address `provider_reported`; only an inspected source may support `source_supported`, and mailbox status remains `not_checked` until AfterShip runs.

## Exa Agent + Fiber route

The host may use the Exa Agent route with `dataSources: [{"provider":"fiber"}]` for one already identity-resolved person. This is a host-owned provider bridge, not a network capability of contact-brief. The host must:

1. send an email-only query naming the exact person and employer and request at most one attributable professional work email;
2. make one run request and bounded status polls, without an automatic second lookup or guessed address;
3. normalize the structured result against [fiber-agent-result.schema.json](fiber-agent-result.schema.json), including the exact subject, Fiber status, run ID, retrieval time, actual `usage` and `cost` objects (including provider-specific cost breakdowns) when returned, the scalar total when available, attribution, and source URLs;
4. retain the raw/private run record and invoke `contact_brief.py import-fiber` for the single-person request.

Fiber may return `provider_reported` with an address and no source URL. Empty `source_urls` is valid for that route; it does not make the address `source_supported`. For `uncertain`, a candidate address can remain in the private provider record but must be removed from the public brief. `not_found`, `not_lookupable`, `identity_mismatch`, `provider_error`, `rate_limited` and `cancelled` all produce a null public address. Every imported Fiber result leaves `mailbox.status` as `not_checked`.

When a fixed list is approved for enrichment, a separate host runner must own stable person IDs/order, bounded concurrency, an aggregate spend cap, resumable journaling and retry/cancellation policy. Do not put those controls, provider credentials or batch scheduling into this package, and do not treat the batch output as outreach-ready contactability.

Machine-readable route metadata for every provider path in this file — fixed inputs, single-subject limits, approval requirements, spend/attempt visibility, miss statuses, redaction and the capabilities this package never has — is declared in [routes.json](../routes.json) and checked by the offline packaging tests. This document remains the readable rationale; `routes.json` is the metadata a host adapter reads.

## Direct Exa Agent API fallback

Implementation: `scripts/cb_providers.py:exa_run` and `exa_http`. Reviewed API material is retained under `evidence/exa-{overview,create,get}.md`; consult https://docs.exa.ai before authorizing real spend because provider prices/contracts can change.

Authorization shape (illustrative, not permission):

```json
{"approved":true,"name":"APPROVED PERSON","company":"APPROVED COMPANY","max_total_usd":0.05}
```

Host-managed environment: `EXA_API_KEY`; never embed or print it. `live_test.py exa` requires `--execute` and `--journal`. Exa is ONLY for finding one professional email for an already identified person, plus email-attribution sources. No social/profile discovery, activity research, dossiers or mailbox verification. The bundled helper currently enforces `effort: low` and its reserved allowance; those values are a legacy local dispatch gate, not a universal Fiber price or provider-enforced billing cap. No automatic retry, escalation or second lookup after a miss. Reuse the SAME journal for a person/request; a new journal can create another paid run, so this is not a global daily budget. If an address is already sourced, skip Exa and use the separately authorized AfterShip check. Report actual provider costs.

Transport: one `POST https://api.exa.ai/agent/runs`, then bounded `GET /agent/runs/{id}` polling (default 12, five-second intervals; 30-second HTTP timeout). The POST body attaches the required Exa Connect Fiber datasource (`dataSources: [{"provider":"fiber"}]`, the real Agent API field) next to the email-only query, the single input data row for the approved person, `effort: low` and the email/attribution/source-URL output schema. Request asks for one professional identity/email with sources, ambiguity and stale-employer notes. There is no automatic POST retry. A persistent exclusive journal records uncertain dispatch before POST. Resume with identical authorization and the SAME journal; the journaled request fingerprint includes `dataSources`, so a journal written for a different request (including one predating the Fiber datasource) is refused rather than resumed. Do not delete uncertain journals: reconcile with the provider/operator. Poll exhaustion does not cancel a provider run or prove no further charges. Review pending jobs manually. No cancellation helper is included.

Keep raw run output/grounding in private evidence. Inspect source claims before manually mapping them into compiler identity/email sections. The direct API result is not automatically converted into a brief; provider-reported attribution, independently inspected source support, and SMTP acceptance are different claims.

Tests inject a fake transport and fixture key; they verify local request/journal logic only. A separate read-only credential probe returned HTTP 200 from `GET /agent/runs?limit=1`; see `evidence/exa-access-check.json`. This proves authenticated Agent API access, NOT successful contact enrichment, sufficient paid credits, mailbox verification or a completed research run. No research POST or cost has been verified.

### Single-person enrichment guidance

Use the Agent API for one known person; a host-owned Fiber runner may orchestrate an approved fixed list, but contact-brief still imports one normalized result at a time. Resolve employer and confirmed profile first, then request at most one professional email using an explicit email field. Preserve structured output, grounding, nulls, ambiguity and returned usage/cost fields; do not equate schema completion with factual identity or deliverability. Identity and social research belong to native LinkedIn/X and non-Exa host tools; Exa receives only the already established name/company for email finding. Current official documentation is https://exa.ai/docs/reference/agent-api/overview and the create-a-run API schema (fresh snapshots in `evidence/exa-current-*.md`). Review actual returned costs rather than assuming a local reserved allowance proves billing enforcement. Keep independent AfterShip mailbox checks separate from Exa's person/address attribution. Load any authorized credential into the process environment using the host's private mechanism; the helper does not automatically load dotenv files.

## Native LinkedIn and X

Execution belongs to the agent using existing host browser tools, not these scripts. Discover the correct existing session through host metadata; do not recreate, overwrite or steal unrelated sessions. Reported LinkedIn login and previously reported X identity are not current session checks. Stop on login/challenge/access denial. Never expose cookies or bypass access controls.

For EACH platform: execute person search, inspect a matched profile, search accessible authored activity, inspect activity. Use LinkedIn's native search and profile activity surface; on X use person/handle search and `from:confirmed_handle`. Record exact queries, actual URLs and timestamps, outcome, plus redacted saved artifacts. Native-domain URLs in supplied JSON are only structural checks, not proof these actions occurred. The Codex Exa route is email enrichment only and never native-search acceptance.

Coverage enums distinguish `complete`, `partial`, `blocked`, `not_attempted`, `no_results`, `inactive`. Publication dates may be null. Relevant signals must be authored by the resolved professional, not comments about them or arbitrary search snippets.

## AfterShip (optional executable adapter)

`adapters/aftership/main.go` imports the real MIT `github.com/AfterShip/email-verifier v1.4.1`, pinned by go.mod/go.sum (tag commit `aa8f77c0586ed2ecf9c20cb221de09282ce75355`). No verifier engine is copied. Upstream license is retained in `adapters/aftership/AFTERSHIP-LICENSE`. Reviewed local main source is newer than this pinned release; production uses the downloaded release, not a local replace directive. Stock upstream API server does not enable SMTP.

Build instructions are in README. `scripts/cb_providers.py:aftership_run` launches the trusted local binary with JSON over stdin, preserving raw result, actual completion time, method and conservative mailbox status. The adapter calls `NewVerifier().Verify(address)`. DNS is possible even with SMTP disabled. No Gravatar, disposable-list auto-update or API vendor checks are enabled.

Authorization file: `{"approved":true,"address":"EXACT APPROVED ADDRESS","smtp_approved":false}`. This example is not permission. Both DNS and SMTP require exact address approval and CLI `--execute`; SMTP additionally requires `smtp_approved: true` and `--smtp`. SMTP explicitly enables catch-all checking, including a random recipient at the approved domain. Approval must cover that behavior. No message DATA is sent. Do not guess addresses or treat authorization as identity attribution.

Default total adapter deadline is 20 seconds, configurable with `--timeout` in (0,60]. Connect and operation timeouts are also bounded. The library lacks context cancellation: the standalone process exits on its deadline; Python enforces a further process timeout one second later. Timeout/blocked/error, missing binary and malformed result => unknown, CLI exit 2. Exit 0 only means an error-free check, not accepted delivery. Raw library error text is reduced to a code to avoid accidental sensitive output. Raw results may contain the address: store them privately.

MX is not mailbox proof. Catch-all/full inbox => risky; incomplete/timeout => unknown; explicit SMTP recipient-acceptance flags => smtp_accepted, never delivered or identity verified. Rejections not conclusively classified by upstream remain unknown. Manually copy only the returned `mailbox` into the request email section; preserve independently inspected address attribution/evidence. The CLI does not mutate a brief or discover an email.

Local verification exercised the actual library with invalid syntax (no DNS) and a DNS-blocking mock. Python tests mock SMTP acceptance, missing binary, process timeout and malformed envelopes. External SMTP and successful DNS exchanges are NOT tested here; do not represent these tests as a live mailbox check.

## Evidence audit

`live_test.py verify` checks supplied records and existence/containment of nonempty evidence paths, subject consistency of a supplied direct-API Exa journal, grounding presence, and draft presence. It does not inspect screenshots, attest log authenticity or execute a browser/verifier. A Codex Exa plugin handoff is validated at import time but does not by itself attest live tool execution. `evidence_complete` concerns only recorded completeness; `passed` remains false and `live_execution` is `not_verified` by design. Full live acceptance needs a separately reviewed real action transcript on both platforms plus a retained, reviewed plugin handoff or authorized direct API execution. No such transcript exists in this checkout.
