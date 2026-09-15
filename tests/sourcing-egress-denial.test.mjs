// Check #3 (MANDATORY) — a policy denial must produce ZERO content requests
// from every entry point that can reach the network.
//
// Assertion shape matters: the transport log must contain policy requests and
// nothing else, so a new un-instrumented call path cannot hide behind a subset
// check. Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #3.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchApplicationDetail,
  fetchGreenhousePublic,
  fetchPublicJob,
  fetchSavedSearchSource
} from '../src/discovery.js';
import {
  makeTransport,
  onlyPolicyRequests,
  publicLookup,
  settle
} from './helpers/sourcing-harness.mjs';

const DENY_ALL = 'User-agent: *\nDisallow: /\n';
const ALLOW_HTML = '<html><head><title>Job Application for Analytics Engineer at Example</title></head><body>Content that must not be fetched.</body></html>';
const GREENHOUSE_BOARD = JSON.stringify({ jobs: [{ id: 501, title: 'Wrongly Fetched', absolute_url: 'https://boards.greenhouse.io/example-learning/jobs/501' }] });

function denyTransport(rules) {
  return makeTransport([
    { match: 'https://boards.example.test/robots.txt', status: 200, headers: { 'content-type': 'text/plain' }, body: DENY_ALL },
    { match: 'https://boards-api.greenhouse.io/robots.txt', status: 200, headers: { 'content-type': 'text/plain' }, body: DENY_ALL },
    { match: 'https://ohshi.work/robots.txt', status: 200, headers: { 'content-type': 'text/plain' }, body: DENY_ALL },
    ...rules
  ]);
}

function assertDenied(transport, label) {
  assert.equal(onlyPolicyRequests(transport), true,
    `${label}: the only outbound requests may be policy fetches — a denial must send zero content requests: ${JSON.stringify(transport.urls())}`);
  assert.ok(transport.policyRequests().length >= 1, `${label}: the policy must actually be consulted before refusing`);
}

test('check #3: denial produces zero content requests from every entry point', async t => {
  await t.test('#3 fetchPublicJob (public job URL intake)', async () => {
    const target = 'https://boards.example.test/jobs/1';
    const transport = denyTransport([{ match: target, status: 200, body: ALLOW_HTML }]);
    const outcome = await settle(() => fetchPublicJob(target, { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }));
    assertDenied(transport, 'fetchPublicJob');
    assert.equal(outcome.ok, false, `a denied target must not be imported: ${JSON.stringify(outcome.value).slice(0, 200)}`);
    assert.match(String(outcome.code), /^policy_/, `expected a typed policy denial, got ${outcome.code}: ${outcome.message}`);
    assert.equal(transport.requested(target), false, 'the denied URL must never appear in the request log');
  });

  await t.test('#3 fetchGreenhousePublic (public board API)', async () => {
    const target = 'https://boards-api.greenhouse.io/v1/boards/example-learning/jobs?content=true';
    const transport = denyTransport([{ match: target, status: 200, headers: { 'content-type': 'application/json' }, body: GREENHOUSE_BOARD }]);
    const outcome = await settle(() => fetchGreenhousePublic({ boardToken: 'example-learning' }, { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }));
    assertDenied(transport, 'fetchGreenhousePublic');
    assert.equal(outcome.ok, false, 'a denied board must not be normalized');
    assert.match(String(outcome.code), /^policy_/, `expected a typed policy denial, got ${outcome.code}: ${outcome.message}`);
  });

  await t.test('#3 fetchApplicationDetail (degrades, never throws)', async () => {
    const target = 'https://boards-api.greenhouse.io/v1/boards/example-learning/jobs/501?questions=true';
    const transport = denyTransport([{ match: target, status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 501 }) }]);
    const detail = await fetchApplicationDetail(
      { url: 'https://boards.greenhouse.io/example-learning/jobs/501', source: 'greenhouse', sourceId: '501' },
      { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
    );
    assertDenied(transport, 'fetchApplicationDetail');
    assert.notEqual(detail?.ok, true, `denied detail must degrade, got: ${JSON.stringify(detail).slice(0, 300)}`);
    assert.match(String(detail?.reason || ''), /^policy_/,
      `the degraded reason must carry the policy denial, got ${detail?.reason}: ${JSON.stringify(detail).slice(0, 300)}`);
  });

  await t.test('#3 fetchSavedSearchSource (greenhouse adapter)', async () => {
    const target = 'https://boards-api.greenhouse.io/v1/boards/example-learning/jobs?content=true';
    const transport = denyTransport([{ match: target, status: 200, headers: { 'content-type': 'application/json' }, body: GREENHOUSE_BOARD }]);
    const outcome = await settle(() => fetchSavedSearchSource(
      { adapter: 'greenhouse', config: { boardToken: 'example-learning' } },
      { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
    ));
    assertDenied(transport, 'fetchSavedSearchSource(greenhouse)');
    assert.equal(outcome.ok, false, 'a denied saved search must not return jobs');
    assert.match(String(outcome.code), /^policy_/, `expected a typed policy denial, got ${outcome.code}: ${outcome.message}`);
  });

  await t.test('#3 fetchSavedSearchSource (ohshi adapter)', async () => {
    const target = 'https://ohshi.work/api/v1/intelligence?view=jobs&limit=25';
    const transport = denyTransport([{ prefix: 'https://ohshi.work/api/v1/intelligence', status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobs: [], nextCursor: null }) }]);
    const outcome = await settle(() => fetchSavedSearchSource(
      { adapter: 'ohshi', config: { company: 'Example' } },
      { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
    ));
    assertDenied(transport, 'fetchSavedSearchSource(ohshi)');
    assert.equal(outcome.ok, false, 'a denied ohshi search must not return jobs');
    assert.notEqual(outcome.code, 'unsupported_adapter',
      'the ohshi adapter must exist for this check to mean anything — a missing adapter must not pass the denial sweep');
    assert.match(String(outcome.code), /^policy_/, `expected a typed policy denial, got ${outcome.code}: ${outcome.message}`);
    assert.equal(transport.requested(target), false, 'no ohshi content endpoint may be requested under a denial');
  });
});

test('check #3: a denial is not masked by an earlier failure or a cached allow', async t => {
  await t.test('#3 robots unreachable denies even though a content response is available', async () => {
    const target = 'https://boards.example.test/jobs/2';
    const transport = makeTransport([
      { match: 'https://boards.example.test/robots.txt', throw: 'dns' },
      { match: target, status: 200, body: ALLOW_HTML }
    ]);
    const outcome = await settle(() => fetchPublicJob(target, { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }));
    assert.equal(outcome.ok, false, 'an unverifiable policy must fail closed');
    assert.equal(transport.requested(target), false, `the target must not be fetched: ${JSON.stringify(transport.urls())}`);
    assert.equal(outcome.code, 'policy_unreachable', `expected policy_unreachable, got ${outcome.code}: ${outcome.message}`);
  });

  await t.test('#3 a denied second path is not rescued by an allowed first path', async () => {
    const allowed = 'https://boards.example.test/jobs/3';
    const denied = 'https://boards.example.test/private/3';
    const transport = makeTransport([
      { match: 'https://boards.example.test/robots.txt', status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /jobs/\nDisallow: /private/\n' },
      { match: allowed, status: 200, body: ALLOW_HTML },
      { match: denied, status: 200, body: ALLOW_HTML }
    ]);
    const options = { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() };
    const first = await settle(() => fetchPublicJob(allowed, options));
    assert.equal(first.ok, true, `the allowed path must still work: ${first.code} ${first.message}`);
    const second = await settle(() => fetchPublicJob(denied, options));
    assert.equal(second.ok, false, 'the denied path must fail even though the policy was already cached');
    assert.equal(transport.requested(denied), false, `the denied path must never be fetched: ${JSON.stringify(transport.urls())}`);
  });
});
