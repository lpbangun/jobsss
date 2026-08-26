import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  FIT_DIMENSION_WEIGHTS,
  REQUIRED_EXTENDED_TOOLS,
  REQUIRED_JOURNEY_TOOLS,
  asList,
  assertNoJobosUse,
  assertOwnershipRejection,
  callRequest,
  initializeRequest,
  isolate,
  jobFixture,
  listRelFiles,
  listToolsRequest,
  mcp,
  parseToolValue,
  pickId,
  readStore,
  requireOk,
  requireToolListed,
  resumeFixture
} from './helpers/jobsss-live-mcp.mjs';

async function listedToolNames(ctx) {
  const session = await mcp(ctx, [initializeRequest(1), listToolsRequest(2)]);
  const frame = session.frames.find(item => item.id === 2);
  const names = frame?.result?.tools?.map(tool => tool.name) || [];
  return names;
}

test('B18 profile ownership is enforced on every mutating and listing tool', async t => {
  const ctx = isolate(t, 'jobsss-b18-own');
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Owner Profile', resumePath, path: resumePath }),
    callRequest(4, 'create_profile', { name: 'Foreign Profile', resumePath, path: resumePath })
  ]);
  requireOk(setup, 2, 'start');
  const ownerId = pickId(requireOk(setup, 3, 'owner profile'), ['profileId', 'id']);
  const foreignId = pickId(requireOk(setup, 4, 'foreign profile'), ['profileId', 'id']);
  assert.ok(ownerId && foreignId && ownerId !== foreignId);

  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId: ownerId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'import_job owner'), ['jobId', 'id']);
  assert.ok(jobId);

  const names = await listedToolNames(ctx);
  for (const tool of REQUIRED_JOURNEY_TOOLS) requireToolListed(names, tool);
  for (const tool of ['score_job', 'pursue_job', 'applications_plan', 'tailor_resume', 'draft_cover_letter', 'save_job', 'list_tasks', 'map_reachable_network', 'interview_prep']) {
    requireToolListed(names, tool);
  }

  const crossed = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'score_job', { jobId, profileId: foreignId }),
    callRequest(3, 'pursue_job', { jobId, profileId: foreignId }),
    callRequest(4, 'applications_plan', { jobId, profileId: foreignId }),
    callRequest(5, 'tailor_resume', { jobId, profileId: foreignId }),
    callRequest(6, 'draft_cover_letter', { jobId, profileId: foreignId }),
    callRequest(7, 'save_job', { jobId, profileId: foreignId }),
    callRequest(8, 'list_tasks', { profileId: foreignId }),
    callRequest(9, 'map_reachable_network', { jobId, profileId: foreignId }),
    callRequest(10, 'interview_prep', { jobId, profileId: foreignId, applicationId: jobId }),
    callRequest(11, 'list_jobs', { profileId: foreignId }),
    callRequest(12, 'review_queue', { profileId: foreignId })
  ]);

  for (const id of [2, 3, 4, 5, 6, 7, 9, 10]) {
    const frame = crossed.frames.find(item => item.id === id);
    assertOwnershipRejection(frame, parseToolValue(frame), `id ${id}`);
  }

  const foreignJobs = asList(requireOk(crossed, 11, 'list_jobs foreign'));
  assert.equal(
    foreignJobs.some(job => pickId(job, ['jobId', 'id']) === jobId || JSON.stringify(job).includes(jobId)),
    false,
    `list_jobs must not expose another profile's job: ${JSON.stringify(foreignJobs)}`
  );
  const foreignReview = requireOk(crossed, 12, 'review_queue foreign');
  assert.equal(
    JSON.stringify(foreignReview).includes(jobId),
    false,
    `review_queue must not expose another profile's job: ${JSON.stringify(foreignReview)}`
  );
  const foreignTasks = parseToolValue(crossed.frames.find(item => item.id === 8));
  if (foreignTasks && !foreignTasks.error) {
    const tasks = asList(foreignTasks);
    assert.equal(
      tasks.some(task => JSON.stringify(task).includes(jobId)),
      false,
      `list_tasks must not leak owner job tasks: ${JSON.stringify(foreignTasks)}`
    );
  }
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B19 real discovery, dedup, and offline multidimensional scoring without API keys', async t => {
  const ctx = isolate(t, 'jobsss-b19-disc');
  const resumePath = resumeFixture();
  const staging = path.join(ctx.dataDir, 'staging');
  mkdirSync(staging, { recursive: true });
  const boardAbs = path.join(staging, 'ats-board.json');
  copyFileSync(pluginPath('tests/fixtures/ats-board.json'), boardAbs);
  const posting = readFileSync(pluginPath('tests/fixtures/job-posting.md'), 'utf8');

  const names = await listedToolNames(ctx);
  for (const tool of REQUIRED_EXTENDED_TOOLS) requireToolListed(names, tool);

  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Discovery Profile', resumePath, path: resumePath })
  ]);
  requireOk(setup, 2, 'start');
  const profileId = pickId(requireOk(setup, 3, 'create_profile'), ['profileId', 'id']);

  const textImport = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, text: posting, content: posting }),
    callRequest(3, 'import_job', { profileId, text: posting, content: posting })
  ]);
  const first = requireOk(textImport, 2, 'import_job text');
  const second = requireOk(textImport, 3, 'import_job text dedup');
  const jobId = pickId(first, ['jobId', 'id']);
  const secondId = pickId(second, ['jobId', 'id']);
  assert.ok(jobId);
  assert.equal(secondId, jobId, `re-importing the same job text must deduplicate: ${JSON.stringify({ first, second })}`);

  const search = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_saved_search', {
      profileId,
      name: 'Offline greenhouse board',
      adapter: 'greenhouse',
      config: { fixture: boardAbs, boardToken: 'example-learning', company: 'Example Learning Co' }
    }),
    callRequest(3, 'list_saved_searches', { profileId }),
    callRequest(4, 'daily_discovery', { profileId }),
    callRequest(5, 'search_jobs', { profileId, search: 'Offline greenhouse board' })
  ], { timeoutMs: 45_000 });
  const createdSearch = requireOk(search, 2, 'create_saved_search');
  assert.ok(pickId(createdSearch, ['searchId', 'id']) || createdSearch.name, `create_saved_search must persist: ${JSON.stringify(createdSearch)}`);
  const saved = asList(requireOk(search, 3, 'list_saved_searches'));
  assert.ok(saved.length >= 1, `saved searches must persist: ${JSON.stringify(saved)}`);
  const daily = requireOk(search, 4, 'daily_discovery');
  const discovered = asList(daily.jobs || daily.results || daily.items || daily);
  assert.ok(discovered.length >= 1, `daily_discovery must return jobs from the staged greenhouse fixture: ${JSON.stringify(daily)}`);
  requireOk(search, 5, 'search_jobs');

  const scored = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'score_job', { jobId, profileId })
  ]);
  const score = requireOk(scored, 2, 'score_job');
  const fit = score.fit && score.fit.dimensions ? score.fit : score;
  assert.equal(fit.contract, 'jobos.fit-score.v1');
  assert.equal(fit.mode, 'deterministic-degraded');
  assert.equal(fit.provider, null);
  const dimensions = fit.dimensions || {};
  for (const [key, weight] of Object.entries(FIT_DIMENSION_WEIGHTS)) {
    assert.ok(dimensions[key], `missing fit dimension ${key}`);
    assert.equal(dimensions[key].weight, weight, `dimension ${key} weight`);
    assert.ok(['scored', 'unknown', 'contradicted'].includes(dimensions[key].status), `dimension ${key} status`);
    assert.ok(String(dimensions[key].reason || '').trim(), `dimension ${key} requires a reason`);
  }
  assert.ok(
    fit.scoreStatus === 'scored' || fit.scoreStatus === 'review_required' || fit.scoreStatus === 'insufficient_evidence',
    `scoreStatus must be a JobOS fit status: ${fit.scoreStatus}`
  );
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B20 unsaved discoveries stay database-only and create no application folder', async t => {
  const ctx = isolate(t, 'jobsss-b20-folder');
  const resumePath = resumeFixture();
  const staging = path.join(ctx.dataDir, 'staging');
  mkdirSync(staging, { recursive: true });
  const boardAbs = path.join(staging, 'ats-board.json');
  copyFileSync(pluginPath('tests/fixtures/ats-board.json'), boardAbs);

  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Folder Profile', resumePath, path: resumePath })
  ]);
  const profileId = pickId(requireOk(setup, 3, 'create_profile'), ['profileId', 'id']);
  const discovered = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_saved_search', {
      profileId,
      name: 'Folder board',
      adapter: 'greenhouse',
      config: { fixture: boardAbs, boardToken: 'example-learning', company: 'Example Learning Co' }
    }),
    callRequest(3, 'daily_discovery', { profileId })
  ], { timeoutMs: 45_000 });
  requireOk(discovered, 2, 'create_saved_search');
  const daily = requireOk(discovered, 3, 'daily_discovery');
  const jobs = asList(daily.jobs || daily.results || daily.items || daily);
  assert.ok(jobs.length >= 1, `discovery must yield jobs: ${JSON.stringify(daily)}`);
  const discoveredId = pickId(jobs[0], ['jobId', 'id']);
  assert.ok(discoveredId, `discovered job needs an id: ${JSON.stringify(jobs[0])}`);

  const relFiles = listRelFiles(ctx.dataDir);
  const folderHits = relFiles.filter(rel =>
    rel === path.join('jobs', discoveredId, 'job.json')
    || rel.startsWith(`jobs/${discoveredId}/`)
    || rel.startsWith(`applications/${discoveredId}/`)
    || rel.startsWith(path.join('jobs', discoveredId) + path.sep)
    || rel.startsWith(path.join('applications', discoveredId) + path.sep)
  );
  assert.deepEqual(folderHits, [], `unsaved discovery must not create an application/job folder: ${folderHits.join(', ')}`);
  assert.equal(existsSync(path.join(ctx.dataDir, 'jobs', discoveredId)), false, 'PLUGIN_DATA/jobs/<id> must not exist for unsaved discovery');
  assert.equal(existsSync(path.join(ctx.dataDir, 'applications', discoveredId)), false);

  const store = readStore(ctx.dataDir);
  const storedJobs = Object.values(store.jobs || {});
  assert.ok(
    storedJobs.some(job => job.id === discoveredId || job.jobId === discoveredId),
    'discovered jobs may exist in the canonical store before save'
  );

  const saved = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_job', { jobId: discoveredId, profileId })
  ]);
  requireOk(saved, 2, 'save_job');
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});
