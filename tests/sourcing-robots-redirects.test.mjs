// Check #5 — every redirect target is decided before its content is fetched,
// including a same-origin path change. Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #5.

import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicJob } from '../src/discovery.js';
import { makeTransport, publicLookup, readFixture, settle } from './helpers/sourcing-harness.mjs';

const fixture = readFixture('robots-redirects.json');

function assertOrder(transport, [policyUrl, contentUrl], scenarioId) {
  const policyIndex = transport.indexOf(policyUrl);
  const contentIndex = transport.indexOf(contentUrl);
  assert.ok(policyIndex !== -1, `${scenarioId}: the policy for ${policyUrl} must be consulted`);
  if (contentIndex === -1) return;
  assert.ok(policyIndex < contentIndex,
    `${scenarioId}: the decision for ${policyUrl} must precede the content request for ${contentUrl}: ${JSON.stringify(transport.urls())}`);
}

test('check #5: redirects are decided per hop', async t => {
  for (const scenario of fixture.scenarios.filter(item => item.enforcement === 'mandatory')) {
    await t.test(`#5 ${scenario.id} — ${scenario.note}`, async () => {
      const transport = makeTransport(scenario.rules);
      const outcome = await settle(() => fetchPublicJob(scenario.request, {
        fetchImpl: transport.fetchImpl,
        lookupImpl: publicLookup()
      }));

      for (const url of scenario.expect.neverRequested) {
        assert.equal(transport.requested(url), false,
          `${scenario.id}: ${url} must never be requested: ${JSON.stringify(transport.urls())}`);
      }
      for (const pair of scenario.expect.robotsBeforeContent) {
        assertOrder(transport, pair, scenario.id);
      }

      if (scenario.expect.decision === 'allow') {
        assert.equal(outcome.ok, true, `${scenario.id}: expected success, got ${outcome.code}: ${outcome.message}`);
        assert.equal(outcome.value.url, scenario.expect.finalUrl,
          `${scenario.id}: the final URL must be reported, got ${outcome.value.url}`);
        assert.ok(String(outcome.value.text).includes(scenario.expect.bodyContains),
          `${scenario.id}: the body must come from the final hop`);
      } else if (scenario.expect.decision === 'deny') {
        assert.equal(outcome.ok, false, `${scenario.id}: expected a denial, the fetch succeeded`);
        if (scenario.expect.policyCode) {
          assert.equal(outcome.code, scenario.expect.policyCode,
            `${scenario.id}: expected ${scenario.expect.policyCode}, got ${outcome.code}: ${outcome.message}`);
        } else {
          assert.match(String(outcome.code), /^policy_/,
            `${scenario.id}: expected a typed policy denial, got ${outcome.code}: ${outcome.message}`);
        }
      } else {
        assert.equal(outcome.ok, false, `${scenario.id}: expected failure, the fetch succeeded`);
        assert.equal(outcome.code, scenario.expect.code,
          `${scenario.id}: existing failure semantics must be preserved, got ${outcome.code}: ${outcome.message}`);
      }
    });
  }

  await t.test('#5 a redirect hop whose policy is unreadable fails closed', async () => {
    const request = 'https://origin-a.test/jobs/1';
    const transport = makeTransport([
      { match: 'https://origin-a.test/robots.txt', status: 200, body: 'User-agent: *\nDisallow: /private/\n' },
      { match: 'https://origin-f.test/robots.txt', status: 403, body: 'Forbidden' },
      { match: request, status: 302, headers: { location: 'https://origin-f.test/jobs/9' } },
      { match: 'https://origin-f.test/jobs/9', status: 200, body: fixture.marker }
    ]);
    const outcome = await settle(() => fetchPublicJob(request, { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }));
    assert.equal(outcome.ok, false, 'an unreadable hop policy must fail closed');
    assert.equal(outcome.code, 'policy_unreadable', `expected policy_unreadable, got ${outcome.code}: ${outcome.message}`);
    assert.equal(transport.requested('https://origin-f.test/jobs/9'), false,
      `the hop target must never be fetched: ${JSON.stringify(transport.urls())}`);
  });
});
