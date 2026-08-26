import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  LEGACY_ARTIFACT_ID,
  LEGACY_JOB_ID,
  LEGACY_PROFILE_ID,
  LEGACY_PROOF_IDS,
  LOCK_FILE_NAME,
  assertNoJobosUse,
  callRequest,
  initializeRequest,
  isolate,
  isRejected,
  mcp,
  parseToolValue,
  pickId,
  projectionFiles,
  readAllProjections,
  readStore,
  rejectionBlob,
  requireOk,
  storeRevision,
  writeLock
} from './helpers/jobsss-live-mcp.mjs';
import { pluginPath } from './helpers/jobsss-gate0.mjs';

const ENV_SECRET = 'sk-live-jobsss-test-secret-value';

test('B14 lossless current store.json migration into versioned persistence', async t => {
  const ctx = isolate(t, 'jobsss-b14-migrate');
  copyFileSync(pluginPath('tests/fixtures/legacy-store-v1.json'), path.join(ctx.dataDir, 'store.json'));
  const before = JSON.parse(readFileSync(path.join(ctx.dataDir, 'store.json'), 'utf8'));
  assert.equal(before.version, 1);
  assert.equal(before.profiles[LEGACY_PROFILE_ID].name, 'Legacy Probe Profile');

  const session = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {}),
    callRequest(4, 'list_jobs', { profileId: LEGACY_PROFILE_ID }),
    callRequest(5, 'review_queue', { profileId: LEGACY_PROFILE_ID })
  ]);
  requireOk(session, 2, 'doctor');
  requireOk(session, 3, 'start');
  const listed = requireOk(session, 4, 'list_jobs after migrate');
  const jobs = Array.isArray(listed.jobs) ? listed.jobs : (listed.items || []);
  assert.ok(
    jobs.some(job => pickId(job, ['jobId', 'id']) === LEGACY_JOB_ID),
    `migrated job ${LEGACY_JOB_ID} missing: ${JSON.stringify(listed)}`
  );
  const review = requireOk(session, 5, 'review_queue after migrate');
  assert.match(JSON.stringify(review), new RegExp(LEGACY_JOB_ID));

  const after = readStore(ctx.dataDir);
  assert.ok(Number(after.version || after.schemaVersion) >= 2, `migrated store must bump schema version above v1: ${after.version || after.schemaVersion}`);
  const revision = storeRevision(after);
  assert.ok(Number.isInteger(revision) && revision >= 1, `migrated store must expose integer revision: ${JSON.stringify({ revision: after.revision, meta: after.meta })}`);
  assert.equal(after.profiles?.[LEGACY_PROFILE_ID]?.name, 'Legacy Probe Profile');
  assert.equal(after.profiles?.[LEGACY_PROFILE_ID]?.createdAt, before.profiles[LEGACY_PROFILE_ID].createdAt);
  assert.equal(after.jobs?.[LEGACY_JOB_ID]?.title, 'Product Manager, Learning Platform');
  assert.equal(after.jobs?.[LEGACY_JOB_ID]?.company, 'Example Learning Co');
  for (const proofId of LEGACY_PROOF_IDS) {
    assert.equal(after.proofPoints?.[proofId]?.profileId, LEGACY_PROFILE_ID, `proof ${proofId} lost during migration`);
    assert.ok(after.proofPoints[proofId].summary, `proof ${proofId} summary lost`);
  }
  assert.equal(after.applications?.[LEGACY_JOB_ID]?.status, 'pursued');
  assert.equal(after.artifacts?.[LEGACY_ARTIFACT_ID]?.kind, 'application_readiness');
  assert.equal(after.scores?.[LEGACY_JOB_ID]?.jobId, LEGACY_JOB_ID);
  const auditText = JSON.stringify(after.audit || after.auditLog || {}) + readAllProjections(ctx.dataDir).map(file => file.text).join('\n');
  assert.match(auditText, /audit|migrat|start/i, 'versioned persistence must keep an audit or migration trail');
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B15 serialized writes and stale-update rejection', async t => {
  const ctx = isolate(t, 'jobsss-b15-lock');
  const started = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {})
  ]);
  requireOk(started, 2, 'start');
  writeLock(ctx.dataDir, process.pid);
  assert.equal(existsSync(path.join(ctx.dataDir, LOCK_FILE_NAME)), true);

  const locked = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_profile', { name: 'Should Not Land While Locked' })
  ], { timeoutMs: 12_000 });
  const lockedFrame = locked.frames.find(frame => frame.id === 2);
  const lockedValue = parseToolValue(lockedFrame);
  assert.ok(
    isRejected(lockedFrame, lockedValue),
    `create_profile must not write while ${LOCK_FILE_NAME} is held by a live pid: ${JSON.stringify(lockedFrame)}`
  );
  assert.match(
    rejectionBlob(lockedFrame, lockedValue),
    /lock|busy|timeout|concurrency|conflict|stale/i,
    `lock rejection must be explicit: ${rejectionBlob(lockedFrame, lockedValue)}`
  );
  const lockedStore = readStore(ctx.dataDir);
  assert.equal(
    Object.values(lockedStore.profiles || {}).some(profile => profile.name === 'Should Not Land While Locked'),
    false,
    'locked writer must not persist a new profile'
  );

  const ctxStale = isolate(t, 'jobsss-b15-stale');
  const first = await mcp(ctxStale, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Revision Owner' })
  ]);
  requireOk(first, 2, 'start');
  const created = requireOk(first, 3, 'create_profile');
  const storeAfter = readStore(ctxStale.dataDir);
  const currentRevision = storeRevision(storeAfter);
  assert.ok(Number.isInteger(currentRevision) && currentRevision >= 1, `mutating writes must persist integer revision: ${JSON.stringify(storeAfter)}`);
  const stale = await mcp(ctxStale, [
    initializeRequest(1),
    callRequest(2, 'create_profile', {
      name: 'Stale Writer',
      expectedRevision: currentRevision + 99
    })
  ]);
  const staleFrame = stale.frames.find(frame => frame.id === 2);
  const staleValue = parseToolValue(staleFrame);
  assert.ok(isRejected(staleFrame, staleValue), `stale expectedRevision must be rejected: ${JSON.stringify(staleFrame)}`);
  assert.match(
    rejectionBlob(staleFrame, staleValue),
    /stale|revision|concurrency|conflict|snapshot/i,
    `stale-update rejection must name revision/concurrency: ${rejectionBlob(staleFrame, staleValue)}`
  );
  const afterStale = readStore(ctxStale.dataDir);
  assert.equal(
    Object.values(afterStale.profiles || {}).some(profile => profile.name === 'Stale Writer'),
    false,
    'stale writer must not silently overwrite or append'
  );
  assert.ok(
    Object.values(afterStale.profiles || {}).some(profile => profile.name === 'Revision Owner' || pickId(created, ['profileId', 'id'])),
    'successful first write must survive the stale attempt'
  );
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
  assertNoJobosUse(ctxStale.trap, ctxStale.pluginBefore, ctxStale.jobAppBefore);
});

test('B16 MCP rejects arbitrary filesystem paths and accepts staged or inline intake', async t => {
  const ctx = isolate(t, 'jobsss-b16-paths');
  const secretAbs = path.join(ctx.parent, 'outside-secret.txt');
  writeFileSync(secretAbs, 'SECRET_PATH_PAYLOAD=should-never-be-ingested\nsk-outside-secret-should-not-be-read\n');
  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Path Owner' })
  ]);
  requireOk(setup, 2, 'start');
  const profileId = pickId(requireOk(setup, 3, 'create_profile'), ['profileId', 'id']);

  const passwd = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_profile', { name: 'Passwd Leak', resumePath: '/etc/passwd', path: '/etc/passwd' })
  ]);
  const passwdFrame = passwd.frames.find(frame => frame.id === 2);
  const passwdValue = parseToolValue(passwdFrame);
  const passwdLeaked = JSON.stringify(passwdFrame || {}).includes('root:x:0:0');
  assert.equal(passwdLeaked, false, 'create_profile must not return /etc/passwd contents');
  assert.ok(isRejected(passwdFrame, passwdValue), 'create_profile must reject resumePath=/etc/passwd');
  assert.match(
    rejectionBlob(passwdFrame, passwdValue),
    /unsafe|forbidden|path|not_allowed|staging|sandbox|arbitrary/i,
    `path rejection must be explicit: ${rejectionBlob(passwdFrame, passwdValue)}`
  );

  const outside = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: secretAbs, filePath: secretAbs })
  ]);
  const outsideFrame = outside.frames.find(frame => frame.id === 2);
  const outsideValue = parseToolValue(outsideFrame);
  assert.ok(isRejected(outsideFrame, outsideValue), `import_job must not read an arbitrary tempfile: ${JSON.stringify(outsideFrame)}`);

  const urlFile = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job_url', { profileId, url: `file://${secretAbs}` })
  ]);
  const urlFrame = urlFile.frames.find(frame => frame.id === 2);
  const urlValue = parseToolValue(urlFrame);
  assert.ok(
    urlFrame,
    'import_job_url must exist so file URLs can be rejected rather than silently omitted'
  );
  assert.ok(isRejected(urlFrame, urlValue), `import_job_url must reject file URLs: ${JSON.stringify(urlFrame)}`);

  const inline = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', {
      profileId,
      text: readFileSync(pluginPath('tests/fixtures/job-posting.md'), 'utf8'),
      content: readFileSync(pluginPath('tests/fixtures/job-posting.md'), 'utf8')
    })
  ]);
  const imported = requireOk(inline, 2, 'import_job inline text');
  const jobId = pickId(imported, ['jobId', 'id']);
  assert.ok(jobId, `inline import_job must return a job id: ${JSON.stringify(imported)}`);

  const contactOutside = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_contact', { profileId, path: secretAbs, filePath: secretAbs })
  ]);
  const contactFrame = contactOutside.frames.find(frame => frame.id === 2);
  const contactValue = parseToolValue(contactFrame);
  assert.ok(contactFrame, 'import_contact must exist');
  assert.ok(isRejected(contactFrame, contactValue), `import_contact must not read arbitrary paths: ${JSON.stringify(contactFrame)}`);

  const durable = JSON.stringify(readStore(ctx.dataDir));
  assert.doesNotMatch(durable, /SECRET_PATH_PAYLOAD|sk-outside-secret-should-not-be-read|root:x:0:0:root/);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B17 post-commit projections are human-readable and secret-safe', async t => {
  const ctx = isolate(t, 'jobsss-b17-proj', { OPENAI_API_KEY: ENV_SECRET });
  const resumePath = pluginPath('tests/fixtures/profile-resume.md');
  const session = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Projection Profile', resumePath, path: resumePath })
  ]);
  requireOk(session, 2, 'start');
  requireOk(session, 3, 'create_profile');
  const files = projectionFiles(ctx.dataDir);
  assert.ok(files.length > 0, 'start/create_profile must write post-commit projections under PLUGIN_DATA');
  const projections = readAllProjections(ctx.dataDir);
  const blob = projections.map(file => `${file.rel}\n${file.text}`).join('\n');
  assert.doesNotMatch(blob, new RegExp(ENV_SECRET));
  assert.doesNotMatch(blob, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(blob, /"resumeText"\s*:/);
  assert.doesNotMatch(blob, /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/);
  assert.ok(
    projections.some(file => /\.(md|yaml|yml)$/i.test(file.rel) || (file.rel.startsWith('projections/') && file.text.trim())),
    'projections must include human-readable derived files, not only a raw resume dump'
  );
  const store = readStore(ctx.dataDir);
  assert.ok(store.profiles, 'canonical store.json may retain resume text; projections must not');
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});
