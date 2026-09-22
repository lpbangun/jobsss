# Codex Exa plugin handoff

The Codex Exa tools are host MCP tools. The host agent calls them; the Python compiler cannot call them through a shell or import an MCP session. This handoff keeps the boundary explicit and makes the result reproducible enough to review.

## Routing

After native LinkedIn/X work has matched the person and no email is already sourced:

1. Inspect the available tool catalog by capability and description for an Exa web-search tool. Current names may include `mcp__codex_apps__exa_web_search_exa` and `mcp__codex_apps__exa_web_fetch_exa`; aliases are valid.
2. Ask for at most one professional email for the exact name/company, only when attributable. Tell the tool to return null when uncertain, cite source URLs, and avoid identity, profile, social-activity, phone or unrelated enrichment.
3. If a returned page must be inspected for attribution, fetch that page with the Exa fetch tool or another permitted host tool. Preserve the actual URL, quote and retrieval time.
4. Write the normalized envelope below to a private file, then run `contact_brief.py import-exa`. Keep the envelope with the brief as the provider record.

The plugin route does not require `EXA_API_KEY`. It does not provide the direct Agent API's fixed effort, allowance, POST journal or duplicate-dispatch guarantees. Record tool-returned cost data when present; otherwise say cost is unknown. Do not retry a miss automatically.

## Normalized envelope

Validate the envelope against `references/exa-plugin-result.schema.json`:

```json
{
  "route": "codex_exa_plugin",
  "tool": "the-actual-tool-or-alias",
  "retrieved_at": "2026-09-09T12:00:00Z",
  "status": "completed",
  "subject": {
    "name": "APPROVED PERSON",
    "company": "APPROVED COMPANY"
  },
  "email": {
    "address": "person@example.org",
    "sources": [
      {
        "url": "https://example.org/team/person",
        "fetched_at": "2026-09-09T12:00:00Z",
        "published_at": null,
        "quote": "The inspected page lists person@example.org.",
        "kind": "exa"
      }
    ]
  }
}
```

Use `"status": "no_result"` or `"status": "unavailable"` with `"email": null` when the tool returns no attributable address or cannot be called. A non-null address requires at least one inspected source record. The envelope represents provider output, so the importer maps it to `provider_reported`; it never upgrades the claim to `source_supported` and never runs a mailbox check.

## Import

```sh
python3 scripts/contact_brief.py import-exa request.json \
  --result private/exa-plugin-result.json \
  --out private/request-with-email.json
python3 scripts/contact_brief.py build private/request-with-email.json --out out/contact
python3 scripts/contact_brief.py validate out/contact.json
```

The request and envelope names/company must match exactly. The importer accepts zero or one address and refuses invalid or multiple-address data, missing source records, overwriting an existing address, and status/email contradictions. Its output leaves the mailbox `not_checked`; use the separately authorized AfterShip flow if verification is required.

## Fiber Agent handoff

The Exa Agent route using `dataSources: [{"provider":"fiber"}]` has a separate normalized envelope and importer. Use [fiber-agent-result.schema.json](fiber-agent-result.schema.json) and preserve the returned `usage` and `cost` objects (including provider-specific breakdowns) alongside any scalar total:

```sh
python3 scripts/contact_brief.py import-fiber request.json \
  --result private/fiber-agent-result.json \
  --out private/request-with-email.json
```

Unlike the Codex Exa plugin schema, a Fiber `provider_reported` result may have an empty `source_urls` array because the provider can return an attribution without a directly exposed URL. That result remains `provider_reported`, never `source_supported`, and the mailbox remains `not_checked`. An `uncertain` candidate address stays private in the raw provider record and is not emitted in the public brief. Non-success statuses must expose a null public address. The host-owned batch runner, if any, is responsible for one-result-per-person correlation, bounded concurrency/spend, resumable journaling and preserving raw runs; this package only imports and validates one normalized result at a time.
