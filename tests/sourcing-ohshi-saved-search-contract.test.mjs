// Saved-search identity and outbound query, including new_since.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #3.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { fetchSavedSearchSource } from '../src/discovery.js';
import { isolate } from './helpers/jobsss-live-mcp.mjs';
import { makeTransport, publicLookup, readRepoFile, settle } from './helpers/sourcing-harness.mjs';

const RESUME_TEXT = readRepoFile('tests/fixtures/profile-resume.md');
const INTEL = 'https://ohshi.work/api/v1/intelligence';
const ROBOTS = {
  match: 'https://ohshi.work/robots.txt',
  status: 200,
  headers: { 'content-type': 'text/plain' },
  body: 'User-agent: *\nAllow: /\n'
};

function seedProfile(dataDir, name) {
  domain.start(dataDir, {});
  const created = domain.createProfile(dataDir, { name, resumeText: RESUME_TEXT });
  const profileId = created.profileId || created.id || created.profile?.id;
  assert.ok(profileId, `create_profile must return an id: ${JSON.stringify(created).slice(0, 300)}`);
  return profileId;
}

function emptyLive() {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema_version: '1.1',
      data: [],
      page: { next_cursor: null, total: 0 }
    })
  };
}

test('#3 distinct ohshi filters produce distinct identities; identical sets dedupe; order is irrelevant', async t => {
  const ctx = isolate(t, 'ohshi-live-identity');
  const profileId = seedProfile(ctx.dataDir, 'Ohshi Identity Profile');
  const base = { profileId, adapter: 'ohshi' };

  const a = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'q-a', config: { q: 'platform' } });
  const b = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'role-b', config: { role_family: 'data' } });
  const c = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'loc-c', config: { location: 'Berlin' } });
  const d = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'remote-d', config: { remote_status: 'remote' } });
  const e = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'sector-e', config: { sector: 'software' } });
  const f = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'provider-f', config: { provider: 'ashby' } });
  const ids = [a, b, c, d, e, f].map(item => item.searchId || item.id);
  assert.equal(new Set(ids).size, 6, `filter values must produce distinct identities: ${ids.join(',')}`);
  for (const item of [a, b, c, d, e, f]) {
    assert.equal(item.deduped, false);
    assert.equal(item.created, true);
  }

  const again = domain.createSavedSearch(ctx.dataDir, { ...base, name: 'q-a-again', config: { q: 'platform' } });
  assert.equal(again.deduped, true, 'identical effective filters still deduplicate');
  assert.equal(again.searchId || again.id, a.searchId || a.id);

  const order1 = domain.createSavedSearch(ctx.dataDir, {
    ...base, name: 'order-1', config: { q: 'x', location: 'Berlin', role_family: 'data' }
  });
  const order2 = domain.createSavedSearch(ctx.dataDir, {
    ...base, name: 'order-2', config: { role_family: 'data', location: 'Berlin', q: 'x' }
  });
  assert.equal(order2.deduped, true, 'key insertion order must not change identity');
  assert.equal(order2.searchId || order2.id, order1.searchId || order1.id);
});

test('#3 new_since is accepted, persisted, identified, and sent; page contract is 100', async t => {
  const ctx = isolate(t, 'ohshi-live-query');
  const profileId = seedProfile(ctx.dataDir, 'Ohshi Query Profile');
  const sinceA = '2026-09-15T00:00:00Z';
  const sinceB = '2026-09-01T00:00:00Z';
  const created = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'new-since-a',
    adapter: 'ohshi',
    config: {
      q: 'platform',
      role_family: 'data',
      location: 'Berlin',
      remote_status: 'remote',
      sector: 'software',
      provider: 'ashby',
      new_since: sinceA
    }
  });
  assert.equal(created.ok, true);
  assert.equal(created.deduped, false);
  const listed = domain.listSavedSearches(ctx.dataDir, { profileId });
  const record = (listed.searches || listed.items || []).find(item => (item.id === created.searchId || item.id === created.id));
  assert.ok(record, 'search must persist');
  assert.equal(record.config.new_since, sinceA, 'new_since must persist byte-for-byte');

  const other = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'new-since-b',
    adapter: 'ohshi',
    config: { ...record.config, new_since: sinceB }
  });
  assert.equal(other.deduped, false, 'two searches differing only in new_since are distinct');
  assert.notEqual(other.searchId || other.id, created.searchId || created.id);

  const transport = makeTransport([ROBOTS, { prefix: INTEL, ...emptyLive() }]);
  const outcome = await settle(() => fetchSavedSearchSource(
    { adapter: 'ohshi', config: record.config },
    { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  ));
  assert.equal(outcome.ok, true, `query must run, got ${outcome.code}: ${outcome.message}`);
  const request = transport.requests.find(item => item.url.startsWith(INTEL));
  assert.ok(request, 'intelligence endpoint must be requested');
  const url = new URL(request.url);
  assert.equal(url.pathname, '/api/v1/intelligence');
  assert.equal(url.searchParams.get('view'), 'jobs');
  assert.equal(url.searchParams.get('status'), 'verified_open');
  assert.equal(url.searchParams.get('limit'), '100');
  const limit = Number(url.searchParams.get('limit'));
  assert.ok(limit <= 100 && limit === 100, 'normal page limit is 100, not 25, and at most 100');
  for (const [key, value] of Object.entries({
    q: 'platform',
    role_family: 'data',
    location: 'Berlin',
    remote_status: 'remote',
    sector: 'software',
    provider: 'ashby',
    new_since: sinceA
  })) {
    assert.equal(url.searchParams.get(key), value, `${key} must be sent under its published name`);
  }
  assert.equal(url.searchParams.get('new_since'), sinceA);
});
