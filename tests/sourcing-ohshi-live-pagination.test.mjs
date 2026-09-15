// Bounded pagination, page.next_cursor, honest partial results.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #5.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchSavedSearchSource } from '../src/discovery.js';
import { makeTransport, publicLookup, REPO_ROOT, settle } from './helpers/sourcing-harness.mjs';

const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'ohshi-live-envelope');
const INTEL = 'https://ohshi.work/api/v1/intelligence';
const ROBOTS = {
  match: 'https://ohshi.work/robots.txt',
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'User-agent: *\nAllow: /\n'
};
const FILTERS = {
  q: 'platform',
  role_family: 'data',
  new_since: '2026-09-15T00:00:00Z'
};

function readLive(name) {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

function jsonResponse(body) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function liveEnvelope({ rows, cursor, total }) {
  return {
    schema_version: '1.1',
    data: rows,
    page: { next_cursor: cursor, total }
  };
}

function row(id, title) {
  return {
    id,
    sourceId: `src:${id}`,
    title,
    company: { name: 'Paged Co', sector: 'software' },
    location: 'Berlin',
    remoteStatus: 'remote',
    roleFamily: 'data',
    summary: `Body for ${title}`,
    canonicalUrl: `https://jobs.ashbyhq.com/paged/${id}`,
    provider: 'ashby',
    status: 'verified_open',
    firstSeenAt: '2026-09-01T00:00:00Z',
    lastSeenAt: '2026-09-15T00:00:00Z',
    publishedAt: '2026-09-01T00:00:00Z'
  };
}

function call(transport, config = FILTERS) {
  return settle(() => fetchSavedSearchSource(
    { adapter: 'ohshi', config },
    { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  ));
}

function jobsOf(result) {
  return Array.isArray(result) ? result : result?.jobs || [];
}

function contentRequests(transport) {
  return transport.requests.filter(request => request.url.startsWith(INTEL));
}

test('#5 two recorded pages: first request has no cursor; second sends page.next_cursor; filters persist', async () => {
  const page1 = JSON.parse(readLive('v1.1-page-1.json'));
  const page2 = JSON.parse(readLive('v1.1-page-2.json'));
  page2.page = { next_cursor: null, total: 3 };
  const transport = makeTransport([
    ROBOTS,
    { contains: page1.page.next_cursor, ...jsonResponse(page2) },
    { prefix: INTEL, ...jsonResponse(page1) }
  ]);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `walk must succeed, got ${outcome.code}: ${outcome.message}`);
  const jobs = jobsOf(outcome.value);
  const ids = jobs.map(job => job.sourceId || job.sourceRecordId || job.title);
  assert.equal(new Set(ids).size, jobs.length, 'each distinct returned row is mapped once');
  assert.equal(jobs.length, page1.data.length + page2.data.length);
  assert.notEqual(outcome.value?.partial, true, 'exhausting the cursor with all reported rows yields partial: false');

  const requests = contentRequests(transport);
  assert.equal(requests.length, 2, `one request per page: ${JSON.stringify(transport.urls())}`);
  const first = new URL(requests[0].url);
  const second = new URL(requests[1].url);
  assert.equal(first.searchParams.get('cursor'), null);
  assert.equal(second.searchParams.get('cursor'), page1.page.next_cursor);
  for (const [key, value] of Object.entries(FILTERS)) {
    assert.equal(first.searchParams.get(key), value, `page 1 must keep ${key}`);
    assert.equal(second.searchParams.get(key), value, `later pages must keep ${key}`);
  }
});

test('#5 stopping at the page cap while another cursor exists yields partial: true', { timeout: 60_000 }, async () => {
  const rules = [ROBOTS];
  for (let index = 2; index <= 12; index += 1) {
    rules.push({
      contains: `cap-${String(index).padStart(2, '0')}`,
      ...jsonResponse(liveEnvelope({
        rows: [row(`cap-${index}`, `Cap Role ${index}`)],
        cursor: index < 12 ? `cap-${String(index + 1).padStart(2, '0')}` : null,
        total: 12
      }))
    });
  }
  rules.push({
    prefix: INTEL,
    ...jsonResponse(liveEnvelope({
      rows: [row('cap-1', 'Cap Role 1')],
      cursor: 'cap-02',
      total: 12
    }))
  });
  const transport = makeTransport(rules);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `bounded walk must terminate, got ${outcome.code}: ${outcome.message}`);
  const pages = contentRequests(transport).length;
  assert.ok(pages <= 10, `must not fetch more than 10 pages, fetched ${pages}`);
  assert.equal(outcome.value?.partial, true, 'page cap with remaining cursor is partial');
});

test('#5 a repeated cursor terminates and yields partial: true', { timeout: 30_000 }, async () => {
  const transport = makeTransport([
    ROBOTS,
    { contains: 'cyc-22', ...jsonResponse(liveEnvelope({ rows: [row('c3', 'C3')], cursor: 'cyc-11', total: 9 })) },
    { contains: 'cyc-11', ...jsonResponse(liveEnvelope({ rows: [row('c2', 'C2')], cursor: 'cyc-22', total: 9 })) },
    { prefix: INTEL, ...jsonResponse(liveEnvelope({ rows: [row('c1', 'C1')], cursor: 'cyc-11', total: 9 })) }
  ]);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `cycle must terminate, got ${outcome.code}: ${outcome.message}`);
  assert.equal(outcome.value?.partial, true, 'repeated cursor yields partial: true');
  assert.ok(jobsOf(outcome.value).length >= 1);
  const times = transport.requests.filter(request => request.url.includes('cyc-11')).length;
  assert.ok(times <= 2, `revisited cursor must not loop, requested cyc-11 ${times} times`);
});

test('#5 page.total greater than rows read yields partial: true', async () => {
  const transport = makeTransport([
    ROBOTS,
    { prefix: INTEL, ...jsonResponse(liveEnvelope({ rows: [row('t1', 'Total Role')], cursor: null, total: 50 })) }
  ]);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `must succeed, got ${outcome.code}: ${outcome.message}`);
  assert.equal(jobsOf(outcome.value).length, 1);
  assert.equal(outcome.value?.partial, true, 'unread matching rows reported by page.total are partial');
});
