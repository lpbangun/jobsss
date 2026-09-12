import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  asList,
  callRequest,
  initializeRequest,
  isolate,
  mcp,
  parseToolValue,
  pickId,
  requireOk,
  resumeFixture,
} from './helpers/jobsss-live-mcp.mjs';

// rc5 discovery robustness regression (RED first): synthetic fixtures only,
// no network, greenhouse-only.
//
// 1. A `create_saved_search` fixture given relative to PLUGIN_DATA must
//    resolve against PLUGIN_DATA at run time. The bundled MCP server runs
//    with the plugin checkout as its process cwd, so cwd-relative
//    resolution fails with `fixture_not_found` pointing outside
//    PLUGIN_DATA.
// 2. Fixture paths that escape PLUGIN_DATA (absolute paths outside it, or
//    `..` traversal) must be rejected at CREATION time with a typed error
//    naming the expected location — not accepted and then failing at run
//    time.
// 3. `daily_discovery` must be per-search fault-isolated: one unresolvable
//    saved search appears in the per-search `errors` list while every good
//    search still returns its results.

const RESUME_TEXT = `# Synthetic Candidate
Analytics Engineer, 5 years.

## Supported achievements
- Built 18 dbt models in Snowflake, cutting the daily run from 52 to 31 minutes.
- Added 64 dbt tests; monthly dashboard defects fell from 11 to 4.

## Skills
SQL, dbt Core, Snowflake, Python, Git.
`;

const OUTSIDE_CODE = 'fixture_outside_data_dir';
const MISSING_CODE = 'fixture_not_found';

function seedProfile(dataDir, name = 'Robustness Profile') {
  domain.start(dataDir, {});
  const created = domain.createProfile(dataDir, { name, resumeText: RESUME_TEXT });
  const profileId = created.profileId || created.id || created.profile?.id;
  assert.ok(profileId, `create_profile must return an id: ${JSON.stringify(created).slice(0, 400)}`);
  return profileId;
}

function stageBoard(dataDir, rel, source = pluginPath('tests/fixtures/ats-board.json')) {
  const abs = path.join(dataDir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  copyFileSync(source, abs);
  return abs;
}

// A tool failure is JSON-encoded inside the isError text; unwrap it so the
// typed `code` is assertable.
function toolFailure(frame) {
  const value = parseToolValue(frame);
  const text = value?.error?.message;
  if (typeof text === 'string') {
    try { return { ...value, payload: JSON.parse(text) }; } catch { /* not JSON */ }
  }
  return value;
}

function seedLegacySearch(dataDir, entry) {
  const abs = path.join(dataDir, 'store.json');
  const store = JSON.parse(readFileSync(abs, 'utf8'));
  store.searches = store.searches || {};
  store.searches[entry.id] = entry;
  writeFileSync(abs, JSON.stringify(store, null, 2));
}

test('rc5: a PLUGIN_DATA-relative fixture resolves against PLUGIN_DATA at run time', async t => {
  const ctx = isolate(t, 'rc5-disc-relative');
  const relativeFixture = path.join('staging', 'ats-board.json');
  stageBoard(ctx.dataDir, relativeFixture);
  const profileId = seedProfile(ctx.dataDir);

  const created = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'Relative staged board',
    adapter: 'greenhouse',
    config: { fixture: relativeFixture, boardToken: 'example-learning', company: 'Example Learning Co' },
  });
  const searchId = created.searchId || created.id;
  assert.ok(searchId, `create_saved_search must persist: ${JSON.stringify(created)}`);

  // Resolution happens at creation against PLUGIN_DATA, so the persisted
  // fixture can never depend on the server process cwd.
  const storedFixture = created.search?.config?.fixture || created.config?.fixture;
  assert.ok(
    path.isAbsolute(String(storedFixture || '')),
    `saved-search fixture must be resolved against PLUGIN_DATA at creation: ${JSON.stringify(storedFixture)}`,
  );
  assert.equal(
    path.resolve(String(storedFixture)).startsWith(`${ctx.dataDir}${path.sep}`),
    true,
    `resolved fixture must stay inside PLUGIN_DATA: ${storedFixture}`,
  );

  // The same fixture named absolutely is the same saved search, so a legacy
  // relative entry and an absolute re-creation never duplicate the run.
  const same = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'Relative staged board again',
    adapter: 'greenhouse',
    config: { fixture: path.join(ctx.dataDir, relativeFixture), boardToken: 'example-learning', company: 'Example Learning Co' },
  });
  assert.equal(same.created, false, `equivalent fixture must dedupe: ${JSON.stringify(same).slice(0, 300)}`);
  assert.equal(same.search.id, searchId, 'absolute and relative spellings must resolve to one saved search');

  const run = await domain.dailyDiscovery(ctx.dataDir, { profileId });
  assert.deepEqual(run.errors, [], `no search error expected: ${JSON.stringify(run.errors)}`);
  assert.equal(run.status, 'succeeded', `relative fixture run must succeed: ${JSON.stringify(run.status)}`);
  assert.ok(run.jobs.length >= 2, `relative fixture must yield its jobs: ${JSON.stringify(run).slice(0, 600)}`);

  // A legacy relative entry (persisted before validation existed) keeps
  // resolving against PLUGIN_DATA rather than the process cwd.
  const legacyId = 'search_legacy_relative';
  seedLegacySearch(ctx.dataDir, {
    id: legacyId,
    name: 'Legacy relative board',
    profileId,
    adapter: 'greenhouse',
    config: { fixture: relativeFixture, boardToken: 'example-learning', company: 'Example Learning Co' },
    identity: 'greenhouse:legacy-relative',
    minFit: 70,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });
  const legacyRun = await domain.dailyDiscovery(ctx.dataDir, { profileId });
  assert.deepEqual(legacyRun.errors, [], `legacy relative entry must still resolve: ${JSON.stringify(legacyRun.errors)}`);
  assert.equal(legacyRun.status, 'succeeded');
  assert.ok(legacyRun.jobs.length >= 2, `legacy relative entry must yield jobs: ${JSON.stringify(legacyRun.jobs).slice(0, 400)}`);
});

test('rc5: fixture paths outside PLUGIN_DATA are rejected at creation with a typed error', async t => {
  const ctx = isolate(t, 'rc5-disc-outside');
  const profileId = seedProfile(ctx.dataDir);
  const outsideAbs = path.join(ctx.parent, 'outside-board.json');
  writeFileSync(outsideAbs, JSON.stringify({ jobs: [] }));

  const rejected = [
    ['absolute path outside PLUGIN_DATA', outsideAbs],
    ['parent traversal', path.join('..', 'outside-board.json')],
    ['nested traversal', path.join('staging', '..', '..', 'outside-board.json')],
  ];
  for (const [label, fixture] of rejected) {
    assert.throws(
      () => domain.createSavedSearch(ctx.dataDir, {
        profileId,
        name: `Escaping ${label}`,
        adapter: 'greenhouse',
        config: { fixture, boardToken: 'example-learning', company: 'Example Learning Co' },
      }),
      error => {
        assert.equal(error.code, OUTSIDE_CODE, `${label} must raise a typed error: ${error.code} / ${error.message}`);
        assert.match(error.message, /PLUGIN_DATA/, `${label} rejection must name PLUGIN_DATA: ${error.message}`);
        assert.ok(
          error.message.includes(ctx.dataDir),
          `${label} rejection must name the expected location (${ctx.dataDir}): ${error.message}`,
        );
        return true;
      },
      label,
    );
  }

  const missingRel = path.join('staging', 'missing-board.json');
  assert.throws(
    () => domain.createSavedSearch(ctx.dataDir, {
      profileId,
      name: 'Missing staged board',
      adapter: 'greenhouse',
      config: { fixture: missingRel, boardToken: 'example-learning' },
    }),
    error => {
      assert.equal(error.code, MISSING_CODE, `missing fixture must be typed: ${error.code} / ${error.message}`);
      assert.ok(
        error.message.includes(path.join(ctx.dataDir, missingRel)),
        `missing-fixture error must name the expected location inside PLUGIN_DATA: ${error.message}`,
      );
      return true;
    },
    'missing relative fixture',
  );

  const searches = domain.listSavedSearches(ctx.dataDir, { profileId });
  assert.deepEqual(searches.searches, [], `rejected searches must not persist: ${JSON.stringify(searches.searches)}`);

  // Preservation: an absolute fixture inside PLUGIN_DATA keeps working.
  const insideAbs = stageBoard(ctx.dataDir, path.join('staging', 'ats-board.json'));
  const accepted = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'Absolute staged board',
    adapter: 'greenhouse',
    config: { fixture: insideAbs, boardToken: 'example-learning', company: 'Example Learning Co' },
  });
  assert.ok(accepted.searchId || accepted.id, `absolute in-PLUGIN_DATA fixture must still be accepted: ${JSON.stringify(accepted)}`);
});

test('rc5: one unresolvable saved search does not abort daily_discovery', async t => {
  const ctx = isolate(t, 'rc5-disc-isolation');
  const relativeFixture = path.join('staging', 'ats-board.json');
  stageBoard(ctx.dataDir, relativeFixture);
  const profileId = seedProfile(ctx.dataDir);
  const good = domain.createSavedSearch(ctx.dataDir, {
    profileId,
    name: 'Good board',
    adapter: 'greenhouse',
    config: { fixture: relativeFixture, boardToken: 'example-learning', company: 'Example Learning Co' },
  });
  const goodId = good.searchId || good.id;

  const outsideAbs = path.join(ctx.parent, 'outside-board.json');
  writeFileSync(outsideAbs, JSON.stringify({ jobs: [] }));
  seedLegacySearch(ctx.dataDir, {
    id: 'search_legacy_outside',
    name: 'Legacy outside board',
    profileId,
    adapter: 'greenhouse',
    config: { fixture: outsideAbs, boardToken: 'example-learning', company: 'Example Learning Co' },
    identity: 'greenhouse:legacy-outside',
    minFit: 70,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });
  seedLegacySearch(ctx.dataDir, {
    id: 'search_legacy_missing',
    name: 'Legacy missing board',
    profileId,
    adapter: 'greenhouse',
    config: { fixture: path.join('staging', 'gone.json'), boardToken: 'example-learning' },
    identity: 'greenhouse:legacy-missing',
    minFit: 70,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });

  const run = await domain.dailyDiscovery(ctx.dataDir, { profileId });

  // Result shape is preserved (keys extended, never renamed).
  for (const key of ['version', 'profileId', 'runs', 'jobs', 'results', 'items', 'counts', 'errors', 'status']) {
    assert.ok(Object.prototype.hasOwnProperty.call(run, key), `daily_discovery result must keep key ${key}`);
  }
  assert.equal(run.runs.length, 3, `every saved search must produce a run: ${run.runs.length}`);
  assert.equal(run.status, 'partial', `one bad search is partial, not a failed run: ${JSON.stringify(run.status)}`);
  assert.ok(run.jobs.length >= 2, `good searches must still return results: ${JSON.stringify(run.jobs).slice(0, 400)}`);

  const errorsBySearch = new Map(run.errors.map(error => [error.searchId, error]));
  assert.equal(errorsBySearch.size, 2, `both bad searches must be reported: ${JSON.stringify(run.errors)}`);
  const outside = errorsBySearch.get('search_legacy_outside');
  const missing = errorsBySearch.get('search_legacy_missing');
  assert.ok(outside, `escaping fixture must appear in per-search errors: ${JSON.stringify(run.errors)}`);
  assert.equal(outside.code, OUTSIDE_CODE, `per-search error keeps its typed code: ${JSON.stringify(outside)}`);
  assert.equal(outside.searchName, 'Legacy outside board', `per-search error names its search: ${JSON.stringify(outside)}`);
  assert.equal(outside.stage, 'fetch');
  assert.ok(missing, `missing fixture must appear in per-search errors: ${JSON.stringify(run.errors)}`);
  assert.equal(missing.code, MISSING_CODE, `per-search error keeps its typed code: ${JSON.stringify(missing)}`);

  const goodRun = run.runs.find(item => item.searchId === goodId);
  assert.ok(goodRun, 'the good search must have its own run');
  assert.equal(goodRun.status, 'succeeded', `good search must succeed: ${JSON.stringify(goodRun).slice(0, 300)}`);
  assert.deepEqual(goodRun.errors, []);
  assert.equal(goodRun.jobs.length, run.jobs.length, 'aggregate jobs must come from the good search');
  for (const bad of run.runs.filter(item => item.searchId !== goodId)) {
    assert.equal(bad.status, 'failed', `bad search run must be a per-search failure: ${JSON.stringify(bad.status)}`);
    assert.equal(bad.jobs.length, 0);
    assert.ok(bad.errors.length >= 1, 'bad search must carry its own error list');
  }
  assert.equal(run.counts.failed, 2, `failed count must include both bad searches: ${run.counts.failed}`);
});

test('rc5: bundled MCP server resolves a PLUGIN_DATA-relative fixture', async t => {
  const ctx = isolate(t, 'rc5-disc-mcp-relative');
  stageBoard(ctx.dataDir, path.join('staging', 'ats-board.json'));
  const resumePath = resumeFixture();
  const outsideAbs = path.join(ctx.parent, 'outside-board.json');
  writeFileSync(outsideAbs, JSON.stringify({ jobs: [] }));

  const session = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Robustness MCP Profile', resumePath, path: resumePath }),
  ], { timeoutMs: 45_000 });

  requireOk(session, 2, 'start');
  const profileId = pickId(requireOk(session, 3, 'create_profile'), ['profileId', 'id']);
  assert.ok(profileId, 'create_profile must return a profile id');

  // Re-run the search + discovery calls with the real profile id.
  const runSession = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_saved_search', {
      profileId,
      name: 'Relative MCP board',
      adapter: 'greenhouse',
      config: { fixture: path.join('staging', 'ats-board.json'), boardToken: 'example-learning', company: 'Example Learning Co' },
    }),
    callRequest(3, 'daily_discovery', { profileId }),
    callRequest(4, 'create_saved_search', {
      profileId,
      name: 'Escaping MCP board',
      adapter: 'greenhouse',
      config: { fixture: outsideAbs },
    }),
  ], { timeoutMs: 45_000 });

  const created = requireOk(runSession, 2, 'create_saved_search relative');
  assert.ok(pickId(created, ['searchId', 'id']) || created.name, `relative create must persist: ${JSON.stringify(created)}`);
  const daily = requireOk(runSession, 3, 'daily_discovery relative');
  const jobs = asList(daily.jobs || daily.results || daily.items || daily);
  assert.deepEqual(daily.errors, [], `bundled server must not fail a PLUGIN_DATA-relative fixture: ${JSON.stringify(daily.errors)}`);
  assert.ok(jobs.length >= 2, `bundled server must resolve a PLUGIN_DATA-relative fixture: ${JSON.stringify(daily).slice(0, 600)}`);

  const escaping = toolFailure(runSession.frames.find(frame => frame.id === 4));
  assert.ok(escaping?.error, `escaping fixture must be rejected at creation: ${JSON.stringify(escaping)}`);
  assert.equal(
    escaping.payload?.error?.code,
    OUTSIDE_CODE,
    `MCP rejection must be typed: ${JSON.stringify(escaping)}`,
  );
  assert.match(String(escaping.payload?.error?.message || ''), /PLUGIN_DATA/);
});
