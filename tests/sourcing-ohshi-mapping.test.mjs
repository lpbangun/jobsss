// Check #7 (MANDATORY) — ohshi mapping, provenance, CC BY 4.0 attribution and
// honest partial results. Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #7.
//
// The adapter is driven through the repo's own saved-search seam
// (create_saved_search -> daily_discovery) and through fetchSavedSearchSource
// directly, with a transport that refuses every request: the offline fixture
// path must not touch the network at all.

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { fetchSavedSearchSource } from '../src/discovery.js';
import { isolate } from './helpers/jobsss-live-mcp.mjs';
import {
  hasKeyDeep,
  makeTransport,
  publicLookup,
  readFixture,
  readRepoFile,
  REPO_ROOT,
  settle,
  stageFixture,
  valuePresent
} from './helpers/sourcing-harness.mjs';

const fixture = readFixture('ohshi-intelligence.json');
const RESUME_TEXT = readRepoFile('tests/fixtures/profile-resume.md');
const NORMALIZED_KEYS = ['title', 'company', 'location', 'url', 'source', 'sourceId', 'canonicalUrl', 'provider', 'status', 'firstSeenAt', 'lastSeenAt'];

function seedProfile(dataDir, name) {
  domain.start(dataDir, {});
  const created = domain.createProfile(dataDir, { name, resumeText: RESUME_TEXT });
  const profileId = created.profileId || created.id || created.profile?.id;
  assert.ok(profileId, `create_profile must return an id: ${JSON.stringify(created).slice(0, 300)}`);
  return profileId;
}

function refusingTransport() {
  // Every request throws: proves the offline path performs no egress.
  return makeTransport([{ re: '.*', throw: 'connrefused' }]);
}

test('check #7: ohshi adapter maps the fixture through the saved-search seam', async t => {
  const ctx = isolate(t, 'sourcing-ohshi-mapping');
  const relativeFixture = path.join('staging', 'ohshi-intelligence.json');
  stageFixture(ctx.dataDir, relativeFixture, 'ohshi-intelligence.json');
  const profileId = seedProfile(ctx.dataDir, 'Ohshi Mapping Profile');

  const created = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'ohshi sourcing',
    adapter: 'ohshi',
    config: { fixture: relativeFixture }
  });
  assert.ok(created.searchId || created.id, `create_saved_search must accept the ohshi adapter: ${JSON.stringify(created).slice(0, 300)}`);
  assert.equal(created.deduped, false, 'the first ohshi search must be created, not deduped');

  const run = await domain.dailyDiscovery(ctx.dataDir, { profileId });
  assert.deepEqual(run.errors, [],
    `the ohshi adapter must run offline through daily_discovery: ${JSON.stringify(run.errors).slice(0, 600)}`);
  assert.equal(run.status, 'succeeded', `daily_discovery must succeed: ${JSON.stringify({ status: run.status, counts: run.counts })}`);
  assert.equal(run.counts.fetched, fixture.jobs.length,
    `every fixture job must be fetched: ${JSON.stringify(run.counts)}`);

  await t.test('#7 offline resolution performs zero network requests', async () => {
    const transport = refusingTransport();
    const outcome = await settle(() => fetchSavedSearchSource(
      { adapter: 'ohshi', config: { fixture: relativeFixture } },
      { dataDir: ctx.dataDir, fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
    ));
    assert.equal(outcome.ok, true, `the offline fixture path must resolve without egress, got ${outcome.code}: ${outcome.message}`);
    assert.equal(transport.count(), 0, `no request may be made for a staged fixture: ${JSON.stringify(transport.urls())}`);
    assert.deepEqual(transport.requests, [], 'the offline path must not touch the network at all');
  });

  const transport = refusingTransport();
  const result = await fetchSavedSearchSource(
    { adapter: 'ohshi', config: { fixture: relativeFixture } },
    { dataDir: ctx.dataDir, fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  );

  await t.test('#7 one normalized job per source row, with the canonical mapping', async t2 => {
    const jobs = Array.isArray(result) ? result : result?.jobs;
    assert.ok(Array.isArray(jobs), `the ohshi adapter must return a jobs array: ${JSON.stringify(result).slice(0, 300)}`);
    assert.equal(jobs.length, fixture.jobs.length, 'no job may be dropped or invented by the mapping');

    for (const source of fixture.jobs) {
      const job = jobs.find(candidate => String(candidate?.sourceId || '') === source.id || valuePresent(candidate, source.id));
      assert.ok(job, `fixture job ${source.id} must be present in the mapped result: ${JSON.stringify(jobs).slice(0, 600)}`);
      for (const key of NORMALIZED_KEYS) {
        assert.equal(Object.prototype.hasOwnProperty.call(job, key), true,
          `normalized job must expose ${key}: ${JSON.stringify(job).slice(0, 400)}`);
      }
      assert.equal(job.source, 'ohshi', `source must name the adapter: ${JSON.stringify(job).slice(0, 300)}`);
      assert.equal(job.sourceId, source.id, 'sourceId must preserve the upstream id');
      assert.equal(job.canonicalUrl, source.canonicalUrl, 'canonicalUrl must be preserved byte-for-byte');
      assert.equal(job.url, source.canonicalUrl, 'the canonical URL is the job URL');
      assert.equal(job.provider, source.provider, 'the upstream provider must be preserved');
      assert.equal(job.status, source.status, 'the upstream status must be preserved (closed roles stay closed)');
      assert.equal(job.firstSeenAt, source.firstSeenAt, 'firstSeenAt must be preserved');
      assert.equal(job.lastSeenAt, source.lastSeenAt, 'lastSeenAt must be preserved');
      assert.equal(job.title, source.title, 'title must be preserved');
      assert.equal(job.company, source.company, 'company must be preserved');
      assert.equal(job.location, source.location, 'location must be preserved');
    }
  });

  await t.test('#7 provenance survives in the serialized result', async t2 => {
    for (const source of fixture.jobs) {
      for (const value of [source.canonicalUrl, source.provider, source.status, source.firstSeenAt, source.lastSeenAt, source.id]) {
        assert.equal(valuePresent(result, value), true,
          `provenance value ${value} must survive serialization: ${JSON.stringify(result).slice(0, 400)}`);
      }
    }
    for (const key of ['canonicalUrl', 'provider', 'status', 'firstSeenAt', 'lastSeenAt']) {
      assert.equal(hasKeyDeep(result, key), true, `the canonical key ${key} must be present in the mapped result`);
    }
  });

  await t.test('#7 CC BY 4.0 attribution travels to the agent', async t2 => {
    assert.equal(valuePresent(result, 'CC BY 4.0'), true,
      `the result must carry the CC BY 4.0 attribution: ${JSON.stringify(result).slice(0, 400)}`);
    assert.equal(valuePresent(result, fixture.attribution.sourceUrl), true,
      'the attribution must name the source, not just the licence');
    assert.equal(hasKeyDeep(result, 'attribution'), true, 'attribution must be an explicit field, not an incidental string');
    assert.ok(!fixture.attribution.licenseUrl || valuePresent(result, fixture.attribution.licenseUrl),
      'the licence URL must travel with the attribution');
  });

  await t.test('#7 a complete single page does not claim truncation', async t2 => {
    const jobs = Array.isArray(result) ? result : result?.jobs;
    assert.notEqual(result?.partial, true,
      `a complete page must not report truncation: ${JSON.stringify({ partial: result?.partial, jobs: jobs?.length })}`);
  });

  await t.test('#7 the skill routes an agent to the ohshi source', async t2 => {
    const referencesDir = path.join(REPO_ROOT, 'skills', 'jobsss', 'references');
    const referenceFiles = existsSync(referencesDir)
      ? readdirSync(referencesDir).filter(name => name.endsWith('.md'))
      : [];
    const corpus = [
      readRepoFile('skills/jobsss/SKILL.md'),
      ...referenceFiles.map(name => readRepoFile(path.join('skills', 'jobsss', 'references', name)))
    ].join('\n');
    assert.match(corpus, /ohshi/i, 'the bundled skill must route discovery through the ohshi source');
    assert.match(corpus, /CC BY/i, 'the bundled skill must carry the attribution requirement');
  });
});

test('check #7: the mapping fixture is coherent and stays frozen', async t => {
  await t.test('#7 fixture rows carry the provenance the plan requires', () => {
    assert.ok(fixture.jobs.length >= 2, 'the mapping fixture must cover more than one row');
    for (const job of fixture.jobs) {
      for (const key of ['id', 'title', 'company', 'provider', 'status', 'canonicalUrl', 'firstSeenAt', 'lastSeenAt']) {
        assert.ok(job[key], `fixture job must carry ${key}: ${JSON.stringify(job).slice(0, 200)}`);
      }
    }
    const statuses = new Set(fixture.jobs.map(job => job.status));
    assert.ok(statuses.size >= 2, 'the fixture must include more than one upstream status so status loss is detectable');
    assert.match(fixture.attribution.license, /CC BY 4\.0/, 'the fixture must declare the CC BY 4.0 licence');
  });
});
