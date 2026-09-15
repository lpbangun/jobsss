// Dual-shape: frozen { jobs, nextCursor, attribution } still works.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #6.

import assert from 'node:assert/strict';
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
  stageFixture,
  valuePresent
} from './helpers/sourcing-harness.mjs';

const frozen = readFixture('ohshi-intelligence.json');
const bounds = readFixture('ohshi-bounds.json');
const RESUME_TEXT = readRepoFile('tests/fixtures/profile-resume.md');
const INTEL = `${bounds.host}${bounds.path}`;

test('#6 frozen jobs/nextCursor/attribution shape still works offline and over injected transport', async t => {
  const ctx = isolate(t, 'ohshi-dual-shape');
  const relativeFixture = path.join('staging', 'ohshi-intelligence.json');
  stageFixture(ctx.dataDir, relativeFixture, 'ohshi-intelligence.json');
  domain.start(ctx.dataDir, {});
  const created = domain.createProfile(ctx.dataDir, { name: 'Dual Shape Profile', resumeText: RESUME_TEXT });
  const profileId = created.profileId || created.id;
  const search = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'frozen ohshi',
    adapter: 'ohshi',
    config: { fixture: relativeFixture }
  });
  assert.ok(search.searchId || search.id);

  const refusing = makeTransport([{ re: '.*', throw: 'connrefused' }]);
  const offline = await fetchSavedSearchSource(
    { adapter: 'ohshi', config: { fixture: relativeFixture } },
    { dataDir: ctx.dataDir, fetchImpl: refusing.fetchImpl, lookupImpl: publicLookup() }
  );
  assert.equal(refusing.count(), 0, 'frozen fixture remains network-free');
  const jobs = Array.isArray(offline) ? offline : offline?.jobs;
  assert.equal(jobs.length, frozen.jobs.length);
  assert.notEqual(offline?.partial, true, 'a complete single frozen page remains non-partial');
  assert.equal(valuePresent(offline, frozen.attribution.license), true);
  assert.equal(hasKeyDeep(offline, 'attribution'), true);

  for (const source of frozen.jobs) {
    const job = jobs.find(candidate => candidate.sourceId === source.id || candidate.title === source.title);
    assert.ok(job, `frozen job ${source.id} must survive`);
    assert.equal(job.title, source.title);
    assert.equal(job.company, source.company);
    assert.equal(job.canonicalUrl, source.canonicalUrl);
    assert.equal(job.provider, source.provider);
    assert.equal(job.status, source.status);
    assert.equal(job.description, source.description);
  }

  const chain = bounds.chain;
  const rules = [{ match: `${bounds.host}/robots.txt`, ...bounds.robots }];
  for (const entry of chain) {
    if (entry.cursor) {
      rules.push({
        contains: entry.cursor,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ view: 'jobs', attribution: bounds.attribution, jobs: entry.jobs, nextCursor: entry.nextCursor })
      });
    }
  }
  rules.push({
    prefix: INTEL,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ view: 'jobs', attribution: bounds.attribution, jobs: chain[0].jobs, nextCursor: chain[0].nextCursor })
  });
  const transport = makeTransport(rules);
  const networked = await fetchSavedSearchSource(
    { adapter: 'ohshi', config: { company: 'Example' } },
    { fetchImpl: transport.fetchImpl, lookupImpl: publicLookup() }
  );
  const netJobs = Array.isArray(networked) ? networked : networked?.jobs;
  const expected = chain.reduce((total, entry) => total + entry.jobs.length, 0);
  assert.equal(netJobs.length, expected, 'nextCursor continues to paginate the frozen shape');
  assert.ok(!Array.isArray(networked?.data), 'jobs is not reinterpreted as the live envelope data array');
  assert.equal(valuePresent(networked, chain[0].jobs[0].canonicalUrl), true);
});
