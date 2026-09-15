// Check #8 — ohshi bounds: endpoint discipline, cursor walk, cycle termination,
// page/byte caps, typed upstream errors, idempotent re-discovery.
// Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #8.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { fetchSavedSearchSource } from '../src/discovery.js';
import { isolate } from './helpers/jobsss-live-mcp.mjs';
import {
  makeTransport,
  publicLookup,
  readFixture,
  readRepoFile,
  settle,
  stageFixture
} from './helpers/sourcing-harness.mjs';

const fixture = readFixture('ohshi-bounds.json');
const RESUME_TEXT = readRepoFile('tests/fixtures/profile-resume.md');
const INTEL = `${fixture.host}${fixture.path}`;

function rulesWithRobots() {
  return [{ match: `${fixture.host}/robots.txt`, ...fixture.robots }];
}

function intelligenceResponse(payload, spec = {}) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ view: 'jobs', attribution: fixture.attribution, ...payload }),
    ...spec
  };
}

function contentRequests(transport) {
  return transport.requests.filter(request => request.url.startsWith(INTEL));
}

function call(transport, config = { company: 'Example' }) {
  return settle(() => fetchSavedSearchSource(
    { adapter: 'ohshi', config },
    { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  ));
}

function jobsOf(result) {
  return Array.isArray(result) ? result : result?.jobs;
}

function countStoreJobs(dataDir) {
  const store = JSON.parse(readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  const jobs = store.jobs || {};
  return Array.isArray(jobs) ? jobs.length : Object.keys(jobs).length;
}

test('check #8: the adapter reads the intelligence view with a bounded limit', async t => {
  const transport = makeTransport([...rulesWithRobots(), { prefix: INTEL, ...intelligenceResponse({ jobs: fixture.single.jobs, nextCursor: null }) }]);
  const outcome = await call(transport);

  assert.equal(outcome.ok, true, `the ohshi network path must work, got ${outcome.code}: ${outcome.message}`);
  assert.equal(jobsOf(outcome.value)?.length, fixture.single.jobs.length, 'every job on the page must map');

  const requests = contentRequests(transport);
  assert.equal(requests.length, 1, `one page with a null cursor is one request: ${JSON.stringify(transport.urls())}`);
  const url = new URL(requests[0].url);
  assert.equal(url.origin, fixture.host, `the adapter must call the published host, got ${url.origin}`);
  assert.equal(url.pathname, fixture.path, `the adapter must call ${fixture.path}, got ${url.pathname}`);
  assert.equal(url.pathname.endsWith('/api/v1/jobs'), false, 'the adapter must never read the bulk jobs dump');
  assert.equal(url.searchParams.get('view'), 'jobs', 'the intelligence view must be selected explicitly');
  assert.equal(url.searchParams.get('limit'), '25', 'the documented default limit is 25');
});

test('check #8: the cursor walk follows nextCursor', async t => {
  const rules = rulesWithRobots();
  for (const entry of fixture.chain) {
    if (entry.cursor) rules.push({ contains: entry.cursor, ...intelligenceResponse({ jobs: entry.jobs, nextCursor: entry.nextCursor }) });
  }
  rules.push({ prefix: INTEL, ...intelligenceResponse({ jobs: fixture.chain[0].jobs, nextCursor: fixture.chain[0].nextCursor }) });

  const transport = makeTransport(rules);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `the chain must be walked, got ${outcome.code}: ${outcome.message}`);

  const expectedJobs = fixture.chain.reduce((total, entry) => total + entry.jobs.length, 0);
  assert.equal(jobsOf(outcome.value)?.length, expectedJobs, 'the walk must collect every page of the chain');
  for (const entry of fixture.chain) {
    if (!entry.cursor) continue;
    assert.ok(transport.requests.some(request => request.url.includes(entry.cursor)),
      `the adapter must send the cursor value ${entry.cursor} back to the API: ${JSON.stringify(transport.urls())}`);
  }
  assert.equal(contentRequests(transport).length, fixture.chain.length,
    `one request per page of the chain: ${JSON.stringify(transport.urls())}`);
});

test('check #8: a cursor cycle terminates', { timeout: 30_000 }, async t => {
  const rules = rulesWithRobots();
  for (const entry of fixture.cycle.entries) {
    if (entry.cursor) rules.push({ contains: entry.cursor, ...intelligenceResponse({ jobs: entry.jobs, nextCursor: entry.nextCursor }) });
  }
  rules.push({ prefix: INTEL, ...intelligenceResponse({ jobs: fixture.cycle.entries[0].jobs, nextCursor: fixture.cycle.entries[0].nextCursor }) });

  const transport = makeTransport(rules);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `a cyclic cursor walk must terminate cleanly, got ${outcome.code}: ${outcome.message}`);

  for (const entry of fixture.cycle.entries) {
    if (!entry.cursor) continue;
    const times = transport.requests.filter(request => request.url.includes(entry.cursor)).length;
    assert.ok(times <= 2,
      `cursor ${entry.cursor} was requested ${times} times: a revisited cursor must end the walk, not loop`);
  }
  assert.equal(jobsOf(outcome.value)?.length > 0, true, 'a terminated cycle still returns the pages it read');
});

test('check #8: a page cap that truncates is reported truthfully', { timeout: 60_000 }, async t => {
  const overflow = fixture.overflow;
  const cursorFor = index => `${overflow.cursorPrefix}${String(index).padStart(2, '0')}`;
  const pageFor = index => ({
    id: `oh-of-${index}`,
    title: `${overflow.jobTitle} ${index}`,
    company: 'Example Overflow Co',
    provider: overflow.provider,
    status: 'verified_open',
    canonicalUrl: `https://jobs.lever.co/example-overflow/${index}`,
    firstSeenAt: '2026-09-01T00:00:00Z',
    lastSeenAt: '2026-09-01T00:00:00Z'
  });

  const rules = rulesWithRobots();
  for (let index = 2; index <= overflow.pageCount; index += 1) {
    rules.push({
      contains: cursorFor(index),
      ...intelligenceResponse({
        nextCursor: index < overflow.pageCount ? cursorFor(index + 1) : null,
        jobs: [pageFor(index)]
      })
    });
  }
  rules.push({ prefix: INTEL, ...intelligenceResponse({ jobs: [pageFor(1)], nextCursor: cursorFor(2) }) });

  const transport = makeTransport(rules);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `the walk must bound itself rather than fail, got ${outcome.code}: ${outcome.message}`);

  const pagesFetched = contentRequests(transport).length;
  assert.ok(pagesFetched >= 1, 'at least the first page must be read');
  assert.ok(pagesFetched <= overflow.pageCount,
    `the walk must stop at its cap, fetched ${pagesFetched} of ${overflow.pageCount} pages`);
  assert.ok(jobsOf(outcome.value)?.length >= 1, 'a bounded walk still returns what it read');

  if (pagesFetched < overflow.pageCount) {
    assert.equal(outcome.value?.partial, true,
      `a walk that fetched ${pagesFetched} of ${overflow.pageCount} pages must report truncation: ${JSON.stringify({ partial: outcome.value?.partial })}`);
  } else {
    assert.notEqual(outcome.value?.partial, true,
      'a walk that fetched every page must not claim truncation');
  }
});

test('check #8: an oversized page fails typed instead of being accepted', { timeout: 60_000 }, async t => {
  const pad = 'x'.repeat(fixture.oversize.padBytes);
  const huge = JSON.stringify({
    view: 'jobs',
    attribution: fixture.attribution,
    nextCursor: null,
    pad,
    jobs: fixture.single.jobs
  });
  const transport = makeTransport([...rulesWithRobots(), { prefix: INTEL, status: 200, headers: { 'content-type': 'application/json' }, body: huge }]);

  const outcome = await call(transport);
  assert.equal(outcome.ok, false,
    `a page of ${fixture.oversize.padBytes} bytes must be refused by a byte cap, not imported (got ${jobsOf(outcome.value)?.length ?? 'no'} jobs)`);
  assert.ok(String(outcome.code || '').length > 0, `the refusal must be typed, got ${JSON.stringify(outcome.error)}`);
});

test('check #8: upstream failures are typed, never a silent empty success', async t => {
  for (const [name, spec] of Object.entries(fixture.upstream)) {
    const transport = makeTransport([...rulesWithRobots(), { prefix: INTEL, ...spec }]);
    const outcome = await call(transport);
    assert.equal(outcome.ok, false,
      `upstream ${name} must fail, not return an empty result: ${JSON.stringify(outcome.value).slice(0, 200)}`);
    assert.ok(String(outcome.code || '').length > 0, `upstream ${name} must produce a typed error: ${JSON.stringify(outcome.error)}`);
    assert.ok(transport.requests.length >= 1, `upstream ${name}: the request must have been attempted`);
  }
});

test('check #8: re-discovery dedupes instead of duplicating', async t => {
  const ctx = isolate(t, 'sourcing-ohshi-idempotency');
  const relativeFixture = path.join('staging', 'ohshi-intelligence.json');
  stageFixture(ctx.dataDir, relativeFixture, 'ohshi-intelligence.json');
  domain.start(ctx.dataDir, {});
  const created = domain.createProfile(ctx.dataDir, { name: 'Ohshi Idempotency Profile', resumeText: RESUME_TEXT });
  const profileId = created.profileId || created.id;
  assert.ok(profileId, 'create_profile must return an id');

  const first = domain.createSavedSearch(ctx.dataDir, { profileId, name: 'ohshi idempotent', adapter: 'ohshi', config: { fixture: relativeFixture } });
  const again = domain.createSavedSearch(ctx.dataDir, { profileId, name: 'ohshi idempotent', adapter: 'ohshi', config: { fixture: relativeFixture } });
  assert.ok(first.searchId || first.id, `the ohshi saved search must be creatable: ${JSON.stringify(first).slice(0, 300)}`);
  assert.equal(again.created, false, `the same ohshi search must dedupe, got ${JSON.stringify(again).slice(0, 300)}`);
  assert.equal(again.searchId || again.id, first.searchId || first.id, 'an equivalent search must resolve to one record');

  const runOne = await domain.dailyDiscovery(ctx.dataDir, { profileId });
  const jobsAfterFirst = countStoreJobs(ctx.dataDir);
  const runTwo = await domain.dailyDiscovery(ctx.dataDir, { profileId });
  const jobsAfterSecond = countStoreJobs(ctx.dataDir);

  assert.deepEqual(runOne.errors, [], `run 1 must not error: ${JSON.stringify(runOne.errors).slice(0, 400)}`);
  assert.deepEqual(runTwo.errors, [], `run 2 must not error: ${JSON.stringify(runTwo.errors).slice(0, 400)}`);
  assert.equal(runOne.status, 'succeeded', `run 1 status: ${JSON.stringify(runOne.counts)}`);
  assert.equal(runTwo.status, 'succeeded', `run 2 status: ${JSON.stringify(runTwo.counts)}`);
  assert.equal(runOne.counts.imported, runOne.counts.fetched, 'the first run imports every fetched job');
  assert.ok(runOne.counts.fetched > 0, 'the first run must actually fetch the fixture jobs');
  assert.equal(runTwo.counts.imported, 0, 'a repeat run must not import duplicates');
  assert.equal(runTwo.counts.deduped, runTwo.counts.fetched, 'a repeat run reports the same jobs as deduped');
  assert.equal(jobsAfterSecond, jobsAfterFirst, 'durable job count must not grow on re-discovery');
});
