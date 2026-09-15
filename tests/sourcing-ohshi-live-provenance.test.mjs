// Schema/page/provenance and CC BY attribution on the live envelope.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #7.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchSavedSearchSource } from '../src/discovery.js';
import { hasKeyDeep, makeTransport, publicLookup, REPO_ROOT, valuePresent } from './helpers/sourcing-harness.mjs';

const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'ohshi-live-envelope');
const INTEL = 'https://ohshi.work/api/v1/intelligence';
const ROBOTS = {
  match: 'https://ohshi.work/robots.txt',
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'User-agent: *\nAllow: /\n'
};

test('#7 schema, page facts, attribution, and serialized provenance survive', async () => {
  const page1 = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'v1.1-page-1.json'), 'utf8'));
  const page2 = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'v1.1-page-2.json'), 'utf8'));
  const transport = makeTransport([
    ROBOTS,
    { contains: page1.page.next_cursor, status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(page2) },
    { prefix: INTEL, status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(page1) }
  ]);
  const result = await fetchSavedSearchSource(
    { adapter: 'ohshi', config: {} },
    { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  );
  const schema = result.schemaVersion ?? result.schema_version;
  assert.equal(schema, '1.1');
  const page = result.page || {};
  const readCount = Array.isArray(result.jobs) ? result.jobs.length : 0;
  assert.ok(page.total != null || page.readCount != null || readCount > 0, 'page facts must remain inspectable');
  assert.ok(
    page.total === page1.page.total || page.total === page2.page.total || Number(page.total) >= readCount,
    `page.total should explain the matching set: ${JSON.stringify(page)}`
  );
  assert.equal(valuePresent(result, 'CC BY 4.0'), true);
  assert.equal(valuePresent(result, 'https://ohshi.work/'), true);
  assert.equal(
    valuePresent(result, page1.attribution.license),
    true,
    'more precise envelope attribution must win over the fallback'
  );

  const source = page1.data[0];
  for (const value of [source.canonicalUrl, source.provider, source.status, source.sourceId, source.id, source.firstSeenAt, source.lastSeenAt]) {
    assert.equal(valuePresent(result, value), true, `provenance ${value} must be serialized`);
  }
  for (const key of ['canonicalUrl', 'provider', 'status', 'firstSeenAt', 'lastSeenAt']) {
    assert.equal(hasKeyDeep(result, key), true, `${key} must not exist only in parser locals`);
  }
  const blob = JSON.stringify(result).toLowerCase();
  assert.doesNotMatch(blob, /independently verified|jobsss verified the (upstream|listing)/);
});
