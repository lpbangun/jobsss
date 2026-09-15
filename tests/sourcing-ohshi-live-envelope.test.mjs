// Live v1.1 envelope recognition, cursor extraction, malformed-envelope honesty.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #1.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchSavedSearchSource } from '../src/discovery.js';
import {
  makeTransport,
  publicLookup,
  REPO_ROOT,
  settle
} from './helpers/sourcing-harness.mjs';

const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'ohshi-live-envelope');
const INTEL = 'https://ohshi.work/api/v1/intelligence';
const ROBOTS = {
  match: 'https://ohshi.work/robots.txt',
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'User-agent: *\nAllow: /\n'
};

function readLive(name) {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

function jsonResponse(body, spec = {}) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...spec
  };
}

function call(transport, config = {}) {
  return settle(() => fetchSavedSearchSource(
    { adapter: 'ohshi', config },
    { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  ));
}

function jobsOf(result) {
  return Array.isArray(result) ? result : result?.jobs;
}

function contentRequests(transport) {
  return transport.requests.filter(request => request.url.startsWith(INTEL));
}

test('#1 valid live v1.1 envelope maps one job per data row and follows page.next_cursor', async () => {
  const page1 = readLive('v1.1-page-1.json');
  const page2 = readLive('v1.1-page-2.json');
  const parsed1 = JSON.parse(page1);
  const parsed2 = JSON.parse(page2);
  const transport = makeTransport([
    ROBOTS,
    { contains: 'live-cur-page-2', ...jsonResponse(page2) },
    { prefix: INTEL, ...jsonResponse(page1) }
  ]);

  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `live envelope must parse, got ${outcome.code}: ${outcome.message}`);
  const jobs = jobsOf(outcome.value);
  assert.ok(Array.isArray(jobs), 'result must expose jobs');
  assert.equal(jobs.length, parsed1.data.length + parsed2.data.length, 'exactly one mapped job per source row');
  assert.notEqual(outcome.value?.partial, true, 'exhausting the cursor must not claim truncation when all rows were read');

  const requests = contentRequests(transport);
  assert.ok(requests.length >= 2, `cursor walk must request a second page: ${JSON.stringify(transport.urls())}`);
  const firstUrl = new URL(requests[0].url);
  assert.equal(firstUrl.searchParams.get('cursor'), null, 'the first request has no cursor');
  const secondUrl = new URL(requests[1].url);
  assert.equal(secondUrl.searchParams.get('cursor'), parsed1.page.next_cursor, 'the second request carries page.next_cursor');
  assert.equal(parsed1.schema_version, '1.1');
});

test('#1 empty live data array may return zero jobs', async () => {
  const transport = makeTransport([
    ROBOTS,
    { prefix: INTEL, ...jsonResponse(readLive('v1.1-empty.json')) }
  ]);
  const outcome = await call(transport);
  assert.equal(outcome.ok, true, `empty live envelope must succeed, got ${outcome.code}: ${outcome.message}`);
  assert.equal(jobsOf(outcome.value)?.length, 0, 'empty data may yield zero jobs');
});

test('#1 malformed or unrecognized envelopes fail with a typed error, never empty success', async () => {
  const cases = [
    ['missing data', readLive('v1.1-malformed.json')],
    ['non-array data', JSON.stringify({ schema_version: '1.1', data: { jobs: [] } })],
    ['unsupported shape', JSON.stringify({ foo: 1 })],
    ['invalid json', '{not-json']
  ];
  for (const [name, body] of cases) {
    const transport = makeTransport([ROBOTS, { prefix: INTEL, ...jsonResponse(body) }]);
    const outcome = await call(transport);
    assert.equal(outcome.ok, false, `${name} must fail, not succeed: ${JSON.stringify(outcome.value)?.slice(0, 200)}`);
    assert.ok(String(outcome.code || '').length > 0, `${name} must produce a typed error code`);
    assert.notEqual(outcome.value?.partial, false, `${name} must not become successful { jobs: [], partial: false }`);
    const jobs = jobsOf(outcome.value);
    assert.equal(jobs == null || jobs.length === 0, true);
    if (outcome.ok === false) {
      assert.notDeepEqual(
        { jobs: jobsOf(outcome.value) || [], partial: outcome.value?.partial },
        { jobs: [], partial: false }
      );
    }
  }
});

test('#1 HTTP 4xx/5xx remains a typed upstream failure', async () => {
  for (const status of [400, 429, 503]) {
    const transport = makeTransport([
      ROBOTS,
      { prefix: INTEL, status, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'nope' }) }
    ]);
    const outcome = await call(transport);
    assert.equal(outcome.ok, false, `HTTP ${status} must fail`);
    assert.ok(String(outcome.code || '').length > 0, `HTTP ${status} must be typed: ${JSON.stringify(outcome.error)}`);
  }
});
