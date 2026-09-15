// Live row mapping: company, body, camelCase fields, source identity.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #2.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchSavedSearchSource } from '../src/discovery.js';
import { isolate } from './helpers/jobsss-live-mcp.mjs';
import {
  hasKeyDeep,
  makeTransport,
  publicLookup,
  REPO_ROOT,
  valuePresent
} from './helpers/sourcing-harness.mjs';

const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'ohshi-live-envelope');
const INTEL = 'https://ohshi.work/api/v1/intelligence';
const ROBOTS = {
  match: 'https://ohshi.work/robots.txt',
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'User-agent: *\nAllow: /\n'
};

function readLiveJson(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function jobsOf(result) {
  return Array.isArray(result) ? result : result?.jobs;
}

test('#2 live rows map nested company, summary body, camelCase fields, and source identity', async t => {
  const ctx = isolate(t, 'ohshi-live-mapping');
  const page1 = readLiveJson('v1.1-page-1.json');
  const page2 = JSON.parse(JSON.stringify(page1));
  page2.page = { next_cursor: null, total: page1.data.length };
  page2.data = page1.data;
  const transport = makeTransport([
    ROBOTS,
    { prefix: INTEL, status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(page2) }
  ]);

  const result = await fetchSavedSearchSource(
    { adapter: 'ohshi', config: {} },
    { dataDir: ctx.dataDir, fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  );
  const blob = JSON.stringify(result);
  assert.equal(blob.includes('[object Object]'), false, 'nested company must not stringify to [object Object]');

  const jobs = jobsOf(result);
  assert.equal(jobs.length, page1.data.length);

  const nestedSource = page1.data[0];
  const nested = jobs.find(job => job.title === nestedSource.title);
  assert.ok(nested, 'nested-company row must be present');
  assert.equal(nested.company, nestedSource.company.name);
  assert.equal(String(nested.description || '').trim().length > 0, true, 'summary must supply a non-empty description');
  assert.equal(nested.description, nestedSource.summary);
  assert.equal(nested.remoteStatus, nestedSource.remoteStatus);
  assert.equal(nested.roleFamily, nestedSource.roleFamily);
  assert.equal(nested.sector, nestedSource.company.sector);
  assert.equal(nested.postedDate, nestedSource.publishedAt);
  assert.equal(nested.sourceId, nestedSource.sourceId);
  assert.ok(nested.sourceRecordId === nestedSource.id || valuePresent(nested, nestedSource.id),
    'envelope id remains available as source-record provenance');
  assert.notEqual(nested.sourceId, nestedSource.id, 'sourceId is preferred when present and distinct from id');
  assert.equal(nested.canonicalUrl, nestedSource.canonicalUrl);
  assert.equal(nested.provider, nestedSource.provider);
  assert.equal(nested.status, nestedSource.status);
  assert.equal(nested.firstSeenAt, nestedSource.firstSeenAt);
  assert.equal(nested.lastSeenAt, nestedSource.lastSeenAt);
  assert.equal(nested.url, nestedSource.canonicalUrl);

  const stringSource = page1.data[1];
  const stringRow = jobs.find(job => job.title === stringSource.title);
  assert.ok(stringRow, 'legacy string company must remain supported');
  assert.equal(stringRow.company, stringSource.company);

  const compensationBlob = JSON.stringify(nested.compensation ?? nested.compensationJson ?? nested.compensationText ?? '');
  assert.equal(/\b(120000|150000|min|max)\b/.test(compensationBlob) && /see posting/i.test(String(nestedSource.compensation)), false);
  const parsedMin = nested.compensation?.min ?? nested.compensationJson?.min ?? null;
  const parsedMax = nested.compensation?.max ?? nested.compensationJson?.max ?? null;
  assert.equal(parsedMin == null && parsedMax == null, true, 'See posting must not invent compensation amounts');

  for (const key of ['canonicalUrl', 'provider', 'status', 'firstSeenAt', 'lastSeenAt']) {
    assert.equal(hasKeyDeep(result, key), true, `${key} must be serialized on the result`);
  }
});
