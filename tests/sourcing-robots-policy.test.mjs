// Check #2 — robots decision table, asserted offline through the exported
// choke-point users. Reviewer-owned: see docs/BENCHMARK-sourcing-v1.md §3 #2.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fetchPublicJob } from '../src/discovery.js';
import { isolate } from './helpers/jobsss-live-mcp.mjs';
import {
  dataDirFiles,
  makeTransport,
  publicLookup,
  readFixture,
  REPO_ROOT,
  settle,
  withPluginData
} from './helpers/sourcing-harness.mjs';

const fixture = readFixture('robots-decisions.json');
const mandatoryRows = fixture.rows.filter(row => row.enforcement === 'mandatory');

test('check #2: robots decision table', async t => {
  for (const row of mandatoryRows) {
    await t.test(`#2 ${row.id} — ${row.note}`, async () => {
      const origin = new URL(row.target).origin;
      const transport = makeTransport([
        { match: `${origin}/robots.txt`, ...row.robots },
        { match: row.target, status: fixture.contentStatus, body: fixture.contentBody }
      ]);

      const outcome = await settle(() => fetchPublicJob(row.target, {
        fetchImpl: transport.fetchImpl,
        lookupImpl: publicLookup()
      }));

      const policyRequests = transport.policyRequestsFor(origin);
      assert.equal(policyRequests.length, 1, `the published policy must be consulted exactly once: ${JSON.stringify(transport.urls())}`);
      assert.equal(transport.contentRequestsFor(origin).length, row.expect.contentRequests,
        `content request count must match the decision table (${row.expect.decision}): ${JSON.stringify(transport.urls())}`);

      if (row.expect.decision === 'allow') {
        assert.equal(outcome.ok, true, `expected allow, got ${outcome.code}: ${outcome.message}`);
        assert.equal(transport.requested(row.target), true, 'an allowed target must actually be fetched');
        assert.ok(
          transport.indexOf(`${origin}/robots.txt`) < transport.indexOf(row.target),
          `the policy decision must precede the content request: ${JSON.stringify(transport.urls())}`
        );
      } else {
        assert.equal(outcome.ok, false, `expected a denial, the call succeeded: ${JSON.stringify(outcome.value).slice(0, 300)}`);
        assert.equal(transport.requested(row.target), false,
          `a denied target must never be requested: ${JSON.stringify(transport.urls())}`);
        if (row.expect.policyCode) {
          assert.equal(outcome.code, row.expect.policyCode,
            `row ${row.id} must fail with ${row.expect.policyCode}, got ${outcome.code}: ${outcome.message}`);
        } else {
          assert.match(String(outcome.code), /^policy_/,
            `row ${row.id} must fail with a typed policy code, got ${outcome.code}: ${outcome.message}`);
          assert.notEqual(outcome.code, 'policy_absent', 'policy_absent is the allow-side code and cannot mean a denial');
        }
      }
    });
  }

  await t.test('#2 429 honours Retry-After with no persisted scheduler', async () => {
    const row = fixture.rows.find(item => item.id === 'blocked-429-retry-after');
    const origin = new URL(row.target).origin;
    const transport = makeTransport([
      { match: `${origin}/robots.txt`, ...row.robots },
      { match: row.target, status: fixture.contentStatus, body: fixture.contentBody }
    ]);
    const call = () => fetchPublicJob(row.target, { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() });

    const first = await settle(call);
    assert.equal(first.ok, false, 'a 429 is blocked, not fetched');
    const afterFirst = transport.count();

    await settle(call);
    assert.equal(transport.count() - afterFirst, row.expect.followUpRequests,
      `a request to a throttled origin inside the Retry-After window must not be repeated: ${JSON.stringify(transport.urls())}`);
    assert.equal(transport.requested(row.target), false, 'the throttled target must never be fetched');
  });
});

test('check #2: policy cache is reused in-process and re-read from a fresh process', async t => {
  const ctx = isolate(t, 'sourcing-policy-cache');
  const cache = fixture.cacheProperties;
  const origin = new URL(cache.origin).origin;
  const [first, second] = cache.targets;
  const before = dataDirFiles(ctx.dataDir);
  const transport = makeTransport([
    { match: `${origin}/robots.txt`, ...cache.allowRobots },
    { match: first, status: fixture.contentStatus, body: fixture.contentBody },
    { match: second, status: fixture.contentStatus, body: fixture.contentBody }
  ]);
  const options = { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() };

  await withPluginData(ctx.dataDir, async () => {
    await fetchPublicJob(first, options);
    await fetchPublicJob(second, options);
  });

  assert.equal(transport.policyRequestsFor(origin).length, 1,
    `one policy fetch must serve both calls: ${JSON.stringify(transport.urls())}`);
  assert.equal(transport.contentRequestsFor(origin).length, 2,
    `both targets must be fetched once: ${JSON.stringify(transport.urls())}`);

  const created = dataDirFiles(ctx.dataDir).filter(rel => !before.includes(rel));
  assert.ok(created.length >= 1,
    'the decided policy must persist as a regular file under PLUGIN_DATA (no in-memory-only cache)');

  const policyRequest = transport.policyRequestsFor(origin)[0];
  const contentRequest = transport.contentRequestsFor(origin)[0];
  const policyAgent = String(policyRequest?.headers?.['user-agent'] || '');
  assert.ok(policyAgent.trim().length > 0, 'the policy request must identify the client it fetches for');
  assert.equal(policyAgent, String(contentRequest?.headers?.['user-agent'] || ''),
    'the policy and content requests must use the same user-agent (cache is keyed per origin+UA)');

  // A second process: the persisted policy must be readable and honoured, so an
  // unreachable policy host does not turn a valid cached allow into a denial.
  const script = `
import { fetchPublicJob } from ${JSON.stringify(new URL(`file://${path.join(REPO_ROOT, 'src', 'discovery.js')}`).href)};
const target = ${JSON.stringify(second)};
const requests = [];
const fetchImpl = async (url) => {
  const href = String(url);
  requests.push(href);
  if (/\\/robots\\.txt(\\?|#|$)/.test(href)) throw Object.assign(new Error('policy host unreachable'), { code: 'ENOTFOUND' });
  return { status: 200, ok: true, url: href, headers: new Headers({ 'content-type': 'text/html' }), async text() { return ${JSON.stringify(fixture.contentBody)}; } };
};
const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];
let ok = false;
let code = '';
try { await fetchPublicJob(target, { fetchImpl, lookupImpl }); ok = true; }
catch (error) { code = String(error?.code || error?.name || ''); }
process.stdout.write(JSON.stringify({ ok, code, requests }));
`;
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, PLUGIN_DATA: ctx.dataDir },
    encoding: 'utf8',
    timeout: 60_000
  });
  const secondProcess = JSON.parse(raw);
  assert.equal(
    secondProcess.requests.filter(url => /\/robots\.txt(\?|#|$)/.test(url)).length,
    0,
    `a fresh process must read the persisted policy instead of refetching: ${JSON.stringify(secondProcess)}`
  );
  assert.equal(secondProcess.ok, true,
    `the persisted policy must be honoured in a fresh process, got ${secondProcess.code}: ${raw}`);
});

test('check #2: a call without PLUGIN_DATA still evaluates policy in-process', async t => {
  const row = mandatoryRows.find(item => item.id === 'allow-valid-policy');
  const origin = new URL(row.target).origin;
  const transport = makeTransport([
    { match: `${origin}/robots.txt`, ...row.robots },
    { match: row.target, status: fixture.contentStatus, body: fixture.contentBody }
  ]);

  const outcome = await withPluginData(null, () => settle(() => fetchPublicJob(row.target, {
    fetchImpl: transport.fetchImpl,
    lookupImpl: publicLookup()
  })));

  assert.equal(outcome.ok, true, `no PLUGIN_DATA must not break policy evaluation: ${outcome.code} ${outcome.message}`);
  assert.equal(transport.policyRequestsFor(origin).length, 1, 'the policy is still consulted');
});

test('check #2: fixtures stay coherent', async t => {
  await t.test('#2 every mandatory row carries an expectation', () => {
    assert.ok(fixture.rows.length > 0, 'the decision table cannot be empty');
    for (const row of fixture.rows) {
      assert.ok(row.id && row.target && row.expect, `row must be complete: ${JSON.stringify(row).slice(0, 200)}`);
      assert.ok(['allow', 'deny'].includes(row.expect.decision), `row ${row.id} must decide allow or deny`);
      assert.ok(['mandatory', 'advisory'].includes(row.enforcement), `row ${row.id} must declare enforcement`);
    }
    const tlsRow = fixture.rows.find(row => row.robots?.throw === 'tls');
    assert.ok(tlsRow, 'the decision table must keep a TLS-failure row');
  });
});
