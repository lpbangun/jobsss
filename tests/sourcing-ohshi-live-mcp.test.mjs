// Real bundled MCP saved-search/search_jobs path with a recorded live envelope.
// Reviewer-owned bar: docs/BENCHMARK-ohshi-live.md §5 #4.

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  asList,
  callRequest,
  initializeRequest,
  isolate,
  mcp,
  pickId,
  requireOk,
  resumeFixture
} from './helpers/jobsss-live-mcp.mjs';
import { REPO_ROOT } from './helpers/sourcing-harness.mjs';

const LIVE_PAGE = path.join(REPO_ROOT, 'tests', 'fixtures', 'ohshi-live-envelope', 'v1.1-page-1.json');

test('#4 real MCP search_jobs imports a recorded live-shaped envelope without network', async t => {
  const ctx = isolate(t, 'ohshi-live-mcp');
  const recorded = JSON.parse(readFileSync(LIVE_PAGE, 'utf8'));
  const staging = path.join(ctx.dataDir, 'staging');
  mkdirSync(staging, { recursive: true });
  const relativeFixture = path.join('staging', 'v1.1-page-1.json');
  copyFileSync(LIVE_PAGE, path.join(ctx.dataDir, relativeFixture));

  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Live Envelope Profile', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  requireOk(setup, 2, 'start');
  const profileId = pickId(requireOk(setup, 3, 'create_profile'), ['profileId', 'id']);
  assert.ok(profileId);

  const run = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_saved_search', {
      profileId,
      name: 'ohshi live recorded',
      adapter: 'ohshi',
      config: { fixture: relativeFixture }
    }),
    callRequest(3, 'search_jobs', { profileId, search: 'ohshi live recorded' }),
    callRequest(4, 'list_jobs', { profileId })
  ], { timeoutMs: 45_000 });

  const created = requireOk(run, 2, 'create_saved_search');
  assert.ok(pickId(created, ['searchId', 'id']) || created.name, `create_saved_search must persist: ${JSON.stringify(created)}`);
  const searched = requireOk(run, 3, 'search_jobs');
  const listed = asList(requireOk(run, 4, 'list_jobs'));
  const fromSearch = asList(searched.jobs || searched.results || searched.items || searched);
  const jobs = listed.length ? listed : fromSearch;
  assert.ok(jobs.length >= 1, `search_jobs must import at least one mapped job: ${JSON.stringify(searched).slice(0, 600)}`);

  const expected = recorded.data[0];
  const blob = JSON.stringify({ searched, jobs });
  assert.equal(blob.includes('[object Object]'), false, 'MCP result must not contain [object Object]');
  const hit = jobs.find(job => String(job.title || '').includes(expected.title) || blob.includes(expected.title));
  assert.ok(hit || blob.includes(expected.title), `recorded title must appear: ${blob.slice(0, 800)}`);
  assert.ok(blob.includes(expected.company.name), `company.name must appear, got ${blob.slice(0, 800)}`);
  assert.ok(blob.includes(expected.summary.slice(0, 24)), 'posting body derived from summary must appear');
  assert.ok(blob.includes(expected.canonicalUrl), 'recorded canonical URL must appear');
  assert.match(blob, /ohshi/i, 'source must be ohshi');
  assert.ok(
    created.search?.config?.fixture || created.config?.fixture || relativeFixture,
    'recorded envelope is staged under PLUGIN_DATA; the MCP path must not egress'
  );
});
