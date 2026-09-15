// Check #4 — RFC 9309 matcher semantics, decided offline through the exported
// choke-point user. Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #4.

import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicJob } from '../src/discovery.js';
import { makeTransport, publicLookup, readFixture, settle } from './helpers/sourcing-harness.mjs';

const fixture = readFixture('robots-matcher.json');
const CONTENT = '<html><head><title>Job Application for Analytics Engineer at Example</title></head><body>ok</body></html>';

function policyFor(row) {
  return {
    match: `${fixture.target}/robots.txt`,
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: row.robots
  };
}

async function decide(row) {
  const target = `${fixture.target}${row.path}`;
  const transport = makeTransport([
    policyFor(row),
    { match: target, status: 200, body: CONTENT }
  ]);
  const outcome = await settle(() => fetchPublicJob(target, {
    fetchImpl: transport.fetchImpl,
    lookupImpl: publicLookup()
  }));
  return { target, transport, outcome, observed: outcome.ok ? 'allow' : `deny:${outcome.code}` };
}

test('check #4: matcher semantics', async t => {
  for (const row of fixture.rows.filter(item => item.enforcement === 'mandatory')) {
    await t.test(`#4 ${row.id} — ${row.note}`, async () => {
      const { target, transport, outcome } = await decide(row);

      if (row.expect === 'allow') {
        assert.equal(outcome.ok, true, `expected allow for ${row.path}, got ${outcome.code}: ${outcome.message}`);
        assert.equal(transport.requested(target), true, 'an allowed path must be fetched');
      } else {
        assert.equal(outcome.ok, false, `expected deny for ${row.path}, the fetch succeeded`);
        assert.match(String(outcome.code), /^policy_/, `expected a typed policy denial, got ${outcome.code}: ${outcome.message}`);
        assert.equal(transport.requested(target), false,
          `a denied path must never be fetched: ${JSON.stringify(transport.urls())}`);
      }
    });
  }

  for (const row of fixture.rows.filter(item => item.enforcement === 'advisory')) {
    await t.test(`#4 advisory ${row.id}`, async t2 => {
      const { observed } = await decide(row);
      t2.diagnostic(`advisory row ${row.id}: expected ${row.expect}, observed ${observed} (recorded, not scored)`);
    });
  }
});

test('check #4: the matcher fixture keeps its required rows', async t => {
  await t.test('#4 required semantics are present and labelled', () => {
    const mandatory = new Set(fixture.rows.filter(row => row.enforcement === 'mandatory').map(row => row.id));
    for (const id of [
      'longest-match-allow-wins',
      'longest-match-disallow-wins',
      'allow-on-ties-disallow-first',
      'allow-on-ties-allow-first',
      'wildcard-anchor-pdf-denied',
      'wildcard-mid-path-denied',
      'anchor-dollar-exact-denied',
      'percent-encoding-matched-verbatim',
      'empty-disallow-allows-all',
      'other-bot-group-does-not-apply',
      'star-group-disallow-all'
    ]) {
      assert.equal(mandatory.has(id), true, `matcher row ${id} must stay mandatory`);
    }
    const advisory = fixture.rows.filter(row => row.enforcement === 'advisory');
    assert.ok(advisory.length >= 1, 'advisory rows must stay visible rather than be deleted');
    for (const row of fixture.rows) {
      assert.ok(['allow', 'deny'].includes(row.expect), `row ${row.id} must expect allow or deny`);
      assert.ok(typeof row.robots === 'string' && row.robots.length > 0, `row ${row.id} must carry a policy body`);
    }
  });
});
