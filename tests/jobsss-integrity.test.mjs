import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  asList,
  assertNoJobosUse,
  callRequest,
  claimText,
  initializeRequest,
  isolate,
  isRejected,
  jobFixture,
  listRelFiles,
  listToolsRequest,
  mcp,
  parseToolValue,
  pickId,
  readStore,
  rejectionBlob,
  requireOk,
  resumeFixture,
  storeRevision,
  writeLock
} from './helpers/jobsss-live-mcp.mjs';

const UNRELATED_PROOF =
  'Operated a commercial fishing vessel in Alaska and processed 400 tons of salmon with a 12-person crew.';
const FABRICATED_TITLE = 'I grew revenue by $10M in one quarter.';
const FABRICATED_REFLECTION = 'This story proves I increased conversion 400%.';
const STORY_FIELDS = Object.freeze(['title', 'situation', 'task', 'action', 'result', 'reflection']);
const PROOF_FRAGMENT = '30%';
const PROOF_SUBSTRING_TITLE = 'Led discovery';

function storeJob(store, jobId) {
  return store.jobs?.[jobId] || Object.values(store.jobs || {}).find(job => job.id === jobId || job.jobId === jobId) || null;
}

function storeApplication(store, jobId, profileId) {
  const applications = Object.values(store.applications || {});
  return store.applications?.[jobId]
    || applications.find(item => item.jobId === jobId && item.profileId === profileId)
    || applications.find(item => item.id === jobId)
    || null;
}

function listedNames(session, id = 2) {
  return session.frames.find(frame => frame.id === id)?.result?.tools?.map(tool => tool.name) || [];
}

function storyRecord(value) {
  if (!value || typeof value !== 'object') return null;
  return value.story || value.interviewStory || value.item || value;
}

function normalizeProofText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fieldEvidenceMap(story) {
  if (!story || typeof story !== 'object') return {};
  return story.fieldEvidence && typeof story.fieldEvidence === 'object' ? story.fieldEvidence : {};
}

function evidenceItems(entry) {
  if (entry == null) return [];
  if (Array.isArray(entry)) return entry;
  if (Array.isArray(entry.evidence)) return entry.evidence;
  if (Array.isArray(entry.items)) return entry.items;
  return [entry];
}

function evidenceProofIds(entry) {
  const ids = [];
  for (const item of evidenceItems(entry)) {
    if (typeof item === 'string' && item.trim()) ids.push(item);
    else if (item && typeof item === 'object') {
      if (typeof item.proofPointId === 'string') ids.push(item.proofPointId);
      if (Array.isArray(item.matchedProofPointIds)) ids.push(...item.matchedProofPointIds);
      if (typeof item.proofSnapshot?.id === 'string') ids.push(item.proofSnapshot.id);
    }
  }
  return ids.map(String).filter(Boolean);
}

function evidenceQuotes(entry) {
  const quotes = [];
  for (const item of evidenceItems(entry)) {
    if (!item || typeof item !== 'object') continue;
    for (const key of ['quote', 'summary', 'proofSummary', 'verbatim', 'proofQuote', 'supportingQuote', 'exactQuote']) {
      if (typeof item[key] === 'string' && item[key].trim()) quotes.push(item[key]);
    }
    if (typeof item.proofSnapshot?.summary === 'string' && item.proofSnapshot.summary.trim()) {
      quotes.push(item.proofSnapshot.summary);
    }
  }
  return quotes;
}

function assertFieldCitesNone(entry, label) {
  assert.deepEqual(
    evidenceProofIds(entry),
    [],
    `${label} must cite no proofPointId: ${JSON.stringify(entry)}`
  );
  assert.equal(
    evidenceQuotes(entry).length,
    0,
    `${label} must cite no supporting quote: ${JSON.stringify(entry)}`
  );
  assert.notEqual(entry?.supportedByProofText, true, `${label} must not claim supportedByProofText`);
  assert.notEqual(String(entry?.status || ''), 'grounded', `${label} must not be status=grounded`);
}

function assertFieldExactEvidence(entry, proof, label) {
  assert.ok(entry, `${label} missing fieldEvidence`);
  assert.ok(
    evidenceProofIds(entry).includes(proof.id),
    `${label} must record proofPointId ${proof.id}: ${JSON.stringify(entry)}`
  );
  const expected = normalizeProofText(proof.summary);
  assert.ok(
    evidenceQuotes(entry).some(quote => normalizeProofText(quote) === expected),
    `${label} must record verbatim complete proof summary/quote: ${JSON.stringify(entry)}`
  );
}

function selectedProofIds(value) {
  const direct = value?.selectedProofPointIds || value?.selectedProofIds || value?.chosenProofPointIds
    || value?.document?.selectedProofPointIds || value?.artifact?.selectedProofPointIds
    || (Array.isArray(value?.evidence) ? value.evidence.map(item => item.proofPointId || item.id) : null);
  if (Array.isArray(direct) && direct.length) return direct.filter(Boolean);
  return [];
}

function extractedRequirements(value) {
  const raw = value?.requirements || value?.extractedRequirements || value?.inventory?.requirements
    || value?.requirementInventory?.requirements || value?.document?.requirements || [];
  return Array.isArray(raw) ? raw : [];
}

function coverageGaps(value) {
  const raw = value?.gaps || value?.coverageGaps || value?.coverage?.gaps || value?.requirementGaps
    || value?.document?.gaps || value?.artifact?.gaps || [];
  return Array.isArray(raw) ? raw : [];
}

function draftContent(value) {
  return [
    value?.document?.content,
    value?.artifact?.content,
    value?.content,
    value?.draft,
    value?.text
  ].filter(item => typeof item === 'string').join('\n');
}

function planNextActions(value) {
  const buckets = [
    value?.plan?.nextActions,
    value?.nextActions,
    value?.plan?.actions,
    value?.actions,
    value?.plan?.next_actions
  ];
  const actions = [];
  for (const raw of buckets) {
    if (Array.isArray(raw)) actions.push(...raw);
    else if (typeof raw === 'string' && raw.trim()) actions.push(raw);
  }
  return actions;
}

function nextActionBlob(actions) {
  return actions.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return String(item);
    return [item.task, item.text, item.action, item.kind, item.message].filter(Boolean).join(' ');
  }).join('\n');
}

const ACTIVE_PREPARATION_NEXT = /human review|verify proof-grounded materials|tailor resume|cover letter|prepare materials|next human step|proof point cited/i;

function assertTerminalPlanHasNoActivePrep(plan, label) {
  const actions = planNextActions(plan);
  const blob = nextActionBlob(actions);
  assert.doesNotMatch(
    blob,
    ACTIVE_PREPARATION_NEXT,
    `${label} must expose no active preparation next actions: ${blob.slice(0, 800) || JSON.stringify(plan).slice(0, 800)}`
  );
}

async function startProfile(ctx, name, extraCalls = []) {
  const resumePath = resumeFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name, resumePath, path: resumePath }),
    ...extraCalls
  ]);
  requireOk(setup, 3, 'start');
  const created = requireOk(setup, 4, `create_profile ${name}`);
  const profileId = pickId(created, ['profileId', 'id']);
  assert.ok(profileId, `create_profile must return a profile id: ${JSON.stringify(created).slice(0, 400)}`);
  return { setup, profileId, created, names: listedNames(setup) };
}

async function discoverTwoJobs(ctx, profileId) {
  const staging = path.join(ctx.dataDir, 'staging');
  mkdirSync(staging, { recursive: true });
  const boardAbs = path.join(staging, 'ats-board.json');
  copyFileSync(pluginPath('tests/fixtures/ats-board.json'), boardAbs);
  const discovered = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_saved_search', {
      profileId,
      name: 'Integrity board',
      adapter: 'greenhouse',
      config: { fixture: boardAbs, boardToken: 'example-learning', company: 'Example Learning Co' }
    }),
    callRequest(3, 'daily_discovery', { profileId })
  ], { timeoutMs: 45_000 });
  requireOk(discovered, 2, 'create_saved_search');
  const daily = requireOk(discovered, 3, 'daily_discovery');
  const jobs = asList(daily.jobs || daily.results || daily.items || daily);
  assert.ok(jobs.length >= 2, `discovery fixture must yield two jobs: ${JSON.stringify(daily).slice(0, 800)}`);
  const ids = jobs.map(job => pickId(job, ['jobId', 'id'])).filter(Boolean);
  assert.equal(ids.length >= 2, true, `discovered jobs need ids: ${JSON.stringify(jobs).slice(0, 800)}`);
  return { jobA: ids[0], jobB: ids[1], jobs };
}

function replaceWithSymlink(abs, target) {
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  mkdirSync(path.dirname(abs), { recursive: true });
  symlinkSync(target, abs);
  assert.equal(lstatSync(abs).isSymbolicLink(), true, `${abs} must be a symlink for this probe`);
}

test('B26 save/skip/archive/pursue update job.saved/job.status plus application/tasks across restart', async t => {
  const ctx = isolate(t, 'jobsss-b26-life');
  const { profileId, names } = await startProfile(ctx, 'Lifecycle Profile');
  for (const tool of ['save_job', 'skip_job', 'archive_job', 'pursue_job', 'list_jobs', 'list_tasks']) {
    assert.ok(names.includes(tool), `tools/list missing ${tool}`);
  }
  const { jobA, jobB } = await discoverTwoJobs(ctx, profileId);

  const before = readStore(ctx.dataDir);
  const discoveredA = storeJob(before, jobA);
  const discoveredB = storeJob(before, jobB);
  assert.equal(discoveredA?.saved, false, 'unsaved discovery must start with job.saved=false');
  assert.equal(discoveredB?.saved, false, 'unsaved discovery must start with job.saved=false');
  assert.match(String(discoveredA?.status || ''), /^(new|imported)$/i);

  const acted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_job', { jobId: jobA, profileId }),
    callRequest(3, 'skip_job', { jobId: jobB, profileId })
  ]);
  requireOk(acted, 2, 'save_job');
  requireOk(acted, 3, 'skip_job');

  const afterSaveSkip = readStore(ctx.dataDir);
  const savedJob = storeJob(afterSaveSkip, jobA);
  const skippedJob = storeJob(afterSaveSkip, jobB);
  const savedApp = storeApplication(afterSaveSkip, jobA, profileId);
  const skippedApp = storeApplication(afterSaveSkip, jobB, profileId);
  assert.equal(savedJob?.saved, true, `save_job must set job.saved=true: ${JSON.stringify(savedJob)}`);
  assert.equal(savedJob?.status, 'saved', `save_job must set job.status=saved: ${JSON.stringify(savedJob)}`);
  assert.ok(savedApp, `save_job must persist an application: ${JSON.stringify(afterSaveSkip.applications)}`);
  assert.match(String(savedApp.status), /saved/i, `save_job application.status: ${JSON.stringify(savedApp)}`);
  assert.equal(skippedJob?.saved, false, `skip_job must not leave the job saved: ${JSON.stringify(skippedJob)}`);
  assert.match(
    String(skippedJob?.status || ''),
    /archived|skipped/i,
    `skip_job must set job.status archived/skipped: ${JSON.stringify(skippedJob)}`
  );
  assert.ok(skippedApp, `skip_job must persist an application: ${JSON.stringify(afterSaveSkip.applications)}`);
  assert.match(String(skippedApp.status), /skipped|archived/i, `skip_job application.status: ${JSON.stringify(skippedApp)}`);

  const restarted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_jobs', { profileId }),
    callRequest(3, 'list_tasks', { profileId }),
    callRequest(4, 'applications_plan', { jobId: jobB, profileId })
  ]);
  const listed = asList(requireOk(restarted, 2, 'list_jobs after save/skip'));
  const listedA = listed.find(job => pickId(job, ['jobId', 'id']) === jobA);
  const listedB = listed.find(job => pickId(job, ['jobId', 'id']) === jobB);
  assert.equal(listedA?.saved, true, `list_jobs after restart must keep job.saved: ${JSON.stringify(listedA)}`);
  assert.equal(listedA?.status, 'saved', `list_jobs after restart must keep job.status=saved: ${JSON.stringify(listedA)}`);
  assert.match(String(listedB?.status || ''), /archived|skipped/i, `skip must survive restart: ${JSON.stringify(listedB)}`);
  const saveTasks = asList(requireOk(restarted, 3, 'list_tasks after save')).filter(task => JSON.stringify(task).includes(jobA));
  assert.ok(saveTasks.length >= 1, `save_job must persist at least one task for the saved job: ${JSON.stringify(saveTasks)}`);
  const skippedPlan = requireOk(restarted, 4, 'applications_plan after skip');
  assert.match(String(skippedPlan.application?.status || skippedPlan.plan?.status || ''), /skipped|archived/i, `skipped applications_plan status: ${JSON.stringify(skippedPlan).slice(0, 400)}`);
  assertTerminalPlanHasNoActivePrep(skippedPlan, 'skipped applications_plan');

  const later = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'archive_job', { jobId: jobB, profileId }),
    callRequest(3, 'pursue_job', { jobId: jobA, profileId })
  ]);
  requireOk(later, 2, 'archive_job');
  requireOk(later, 3, 'pursue_job');
  const afterArchivePursue = readStore(ctx.dataDir);
  const archivedJob = storeJob(afterArchivePursue, jobB);
  const pursuedJob = storeJob(afterArchivePursue, jobA);
  const archivedApp = storeApplication(afterArchivePursue, jobB, profileId);
  const pursuedApp = storeApplication(afterArchivePursue, jobA, profileId);
  assert.equal(archivedJob?.saved, false, `archive_job must not mark the job saved: ${JSON.stringify(archivedJob)}`);
  assert.match(String(archivedJob?.status || ''), /archived/i, `archive_job must set job.status=archived: ${JSON.stringify(archivedJob)}`);
  assert.match(String(archivedApp?.status || ''), /archived/i, `archive_job application.status: ${JSON.stringify(archivedApp)}`);
  assert.equal(pursuedJob?.saved, true, `pursue_job must keep job.saved=true: ${JSON.stringify(pursuedJob)}`);
  assert.match(String(pursuedJob?.status || ''), /saved|pursued/i, `pursue_job job.status: ${JSON.stringify(pursuedJob)}`);
  assert.match(String(pursuedApp?.status || ''), /pursued/i, `pursue_job application.status: ${JSON.stringify(pursuedApp)}`);

  const finalRestart = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_jobs', { profileId }),
    callRequest(3, 'list_tasks', { profileId }),
    callRequest(4, 'applications_plan', { jobId: jobA, profileId }),
    callRequest(5, 'applications_plan', { jobId: jobB, profileId })
  ]);
  const relisted = asList(requireOk(finalRestart, 2, 'list_jobs after archive/pursue'));
  const relistedA = relisted.find(job => pickId(job, ['jobId', 'id']) === jobA);
  const relistedB = relisted.find(job => pickId(job, ['jobId', 'id']) === jobB);
  assert.equal(relistedA?.saved, true, `pursued job.saved must survive restart: ${JSON.stringify(relistedA)}`);
  assert.match(String(relistedB?.status || ''), /archived/i, `archived job.status must survive restart: ${JSON.stringify(relistedB)}`);
  const pursueTasks = asList(requireOk(finalRestart, 3, 'list_tasks after pursue')).filter(task => JSON.stringify(task).includes(jobA));
  assert.ok(pursueTasks.length >= 1, `pursue_job tasks must survive restart: ${JSON.stringify(pursueTasks)}`);
  const plan = requireOk(finalRestart, 4, 'applications_plan after pursue');
  assert.match(JSON.stringify(plan), /pursued/i);
  assert.doesNotMatch(claimText(plan), /\b(submitted|sent|applied|approved)\b/);
  const archivedPlan = requireOk(finalRestart, 5, 'applications_plan after archive');
  assert.match(String(archivedPlan.application?.status || archivedPlan.plan?.status || ''), /archived/i, `archived applications_plan status: ${JSON.stringify(archivedPlan).slice(0, 400)}`);
  assertTerminalPlanHasNoActivePrep(archivedPlan, 'archived applications_plan');
  assert.doesNotMatch(claimText(archivedPlan), /\b(submitted|sent|applied|approved)\b/);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B27 projection writes are serialized, atomic, redacted, and reject nested symlink escapes', async t => {
  const ctx = isolate(t, 'jobsss-b27-proj', { OPENAI_API_KEY: 'sk-live-jobsss-integrity-secret' });
  const { profileId } = await startProfile(ctx, 'Projection Escape Profile');
  const { jobA } = await discoverTwoJobs(ctx, profileId);
  const before = readStore(ctx.dataDir);
  const beforeRevision = storeRevision(before);
  const outsideJobs = path.join(ctx.parent, 'escaped-jobs');
  const outsideApps = path.join(ctx.parent, 'escaped-applications');
  const outsideProj = path.join(ctx.parent, 'escaped-projections');
  mkdirSync(outsideJobs, { recursive: true });
  mkdirSync(outsideApps, { recursive: true });
  mkdirSync(outsideProj, { recursive: true });

  const nestedJobDir = path.join(ctx.dataDir, 'jobs', jobA);
  mkdirSync(path.join(ctx.dataDir, 'jobs'), { recursive: true });
  symlinkSync(outsideJobs, nestedJobDir);
  const saveNested = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_job', { jobId: jobA, profileId })
  ]);
  const saveFrame = saveNested.frames.find(frame => frame.id === 2);
  const saveValue = parseToolValue(saveFrame);
  assert.ok(
    isRejected(saveFrame, saveValue),
    `save_job must reject nested jobs/<id> symlink escape: ${JSON.stringify(saveFrame)} outside=${listRelFiles(outsideJobs).join(',')}`
  );
  assert.match(
    rejectionBlob(saveFrame, saveValue),
    /symlink|escape|unsafe|forbidden|path|not_allowed|sandbox/i,
    `symlink rejection must be explicit: ${rejectionBlob(saveFrame, saveValue)}`
  );
  assert.deepEqual(listRelFiles(outsideJobs), [], `jobs/<id> symlink must not write outside PLUGIN_DATA: ${listRelFiles(outsideJobs).join(', ')}`);
  const afterNested = readStore(ctx.dataDir);
  assert.equal(storeRevision(afterNested), beforeRevision, 'rejected symlink write must not bump canonical revision');
  assert.equal(storeJob(afterNested, jobA)?.saved, false, 'rejected jobs/<id> escape must not persist job.saved');
  assert.equal(storeApplication(afterNested, jobA, profileId)?.status == null, true, 'rejected jobs/<id> escape must not persist an application');

  rmSync(path.join(ctx.dataDir, 'jobs'), { recursive: true, force: true });
  replaceWithSymlink(path.join(ctx.dataDir, 'applications'), outsideApps);
  const saveApps = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_job', { jobId: jobA, profileId })
  ]);
  const appsFrame = saveApps.frames.find(frame => frame.id === 2);
  const appsValue = parseToolValue(appsFrame);
  assert.ok(isRejected(appsFrame, appsValue), `save_job must reject applications/ symlink escape: ${JSON.stringify(appsFrame)}`);
  assert.deepEqual(listRelFiles(outsideApps), [], `applications/ symlink must not write outside PLUGIN_DATA: ${listRelFiles(outsideApps).join(', ')}`);
  assert.equal(storeJob(readStore(ctx.dataDir), jobA)?.saved, false, 'rejected applications/ escape must not persist job.saved');

  replaceWithSymlink(path.join(ctx.dataDir, 'projections'), outsideProj);
  const mutateProj = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_profile', { name: 'Must Not Leak Through Projections Symlink' })
  ]);
  const projFrame = mutateProj.frames.find(frame => frame.id === 2);
  const projValue = parseToolValue(projFrame);
  assert.ok(isRejected(projFrame, projValue), `mutating write must reject projections/ symlink escape: ${JSON.stringify(projFrame)}`);
  assert.deepEqual(listRelFiles(outsideProj), [], `projections/ symlink must not write outside PLUGIN_DATA: ${listRelFiles(outsideProj).join(', ')}`);
  assert.equal(
    Object.values(readStore(ctx.dataDir).profiles || {}).some(profile => profile.name === 'Must Not Leak Through Projections Symlink'),
    false,
    'rejected projections/ escape must not persist the profile'
  );

  rmSync(path.join(ctx.dataDir, 'projections'), { recursive: true, force: true });
  rmSync(path.join(ctx.dataDir, 'applications'), { recursive: true, force: true });
  rmSync(path.join(ctx.dataDir, 'jobs'), { recursive: true, force: true });
  const locked = await mcp(ctx, [initializeRequest(1), callRequest(2, 'start', {})]);
  requireOk(locked, 2, 'start to restore projections after symlink probes');
  const projBeforeLock = listRelFiles(path.join(ctx.dataDir, 'projections'));
  writeLock(ctx.dataDir, process.pid);
  const blocked = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_job', { jobId: jobA, profileId })
  ], { timeoutMs: 12_000 });
  const blockedFrame = blocked.frames.find(frame => frame.id === 2);
  const blockedValue = parseToolValue(blockedFrame);
  assert.ok(isRejected(blockedFrame, blockedValue), `save_job must not write while jobsss.lock is held: ${JSON.stringify(blockedFrame)}`);
  assert.deepEqual(listRelFiles(path.join(ctx.dataDir, 'projections')), projBeforeLock, 'locked writer must not change aggregate projections');
  assert.equal(existsSync(path.join(ctx.dataDir, 'jobs', jobA, 'job.json')), false, 'locked writer must not emit jobs/<id>/job.json');
  assert.equal(existsSync(path.join(ctx.dataDir, 'applications', jobA, 'application.json')), false, 'locked writer must not emit applications/<id>/application.json');

  rmSync(path.join(ctx.dataDir, 'jobsss.lock'), { force: true });
  const saved = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_job', { jobId: jobA, profileId })
  ]);
  requireOk(saved, 2, 'save_job after lock released');
  const jobProj = path.join(ctx.dataDir, 'jobs', jobA, 'job.json');
  const appProj = path.join(ctx.dataDir, 'applications', jobA, 'application.json');
  assert.equal(existsSync(jobProj), true, 'save_job must write PLUGIN_DATA/jobs/<id>/job.json under the data dir');
  assert.equal(existsSync(appProj), true, 'save_job must write PLUGIN_DATA/applications/<id>/application.json under the data dir');
  assert.equal(lstatSync(path.join(ctx.dataDir, 'jobs')).isSymbolicLink(), false);
  assert.equal(lstatSync(path.join(ctx.dataDir, 'applications')).isSymbolicLink(), false);
  const jobText = readFileSync(jobProj, 'utf8');
  const appText = readFileSync(appProj, 'utf8');
  const aggText = listRelFiles(path.join(ctx.dataDir, 'projections')).map(rel => {
    try { return readFileSync(path.join(ctx.dataDir, 'projections', rel), 'utf8'); } catch { return ''; }
  }).join('\n');
  const leaked = `${jobText}\n${appText}\n${aggText}`;
  assert.doesNotMatch(leaked, /sk-live-jobsss-integrity-secret/);
  assert.doesNotMatch(leaked, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(leaked, /"resumeText"\s*:/);
  const tmpLeftovers = listRelFiles(ctx.dataDir).filter(rel => /\.tmp\./.test(rel) || rel.endsWith('.tmp'));
  assert.deepEqual(tmpLeftovers, [], `atomic projection writes must not leave tmp leftovers: ${tmpLeftovers.join(', ')}`);

  const INGESTED_SK = 'sk-ingestedcanonicalsecretvalue99';
  const envSecret = 'sk-live-jobsss-integrity-secret';
  const ingestedText = [
    '# Staff Product Manager',
    'Company: Example Learning Co',
    'Location: Remote',
    '',
    'Lead discovery, roadmap, and stakeholder product management.',
    `Internal token ${INGESTED_SK}`,
    `Provider ${envSecret}`
  ].join('\n');
  const ingested = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, text: ingestedText, content: ingestedText })
  ]);
  const ingestedJob = requireOk(ingested, 2, 'import_job must ingest ordinary job content plus a synthetic secret');
  const ingestedJobId = pickId(ingestedJob, ['jobId', 'id']);
  assert.ok(ingestedJobId, `import_job must return a job id: ${JSON.stringify(ingestedJob).slice(0, 400)}`);
  const storeAbs = path.join(ctx.dataDir, 'store.json');
  assert.equal(existsSync(storeAbs), true, 'canonical store.json must exist after ingest');
  const storeText = readFileSync(storeAbs, 'utf8');
  const storeObj = JSON.parse(storeText);
  assert.doesNotMatch(storeText, /sk-ingestedcanonicalsecretvalue99/);
  assert.doesNotMatch(storeText, /sk-live-jobsss-integrity-secret/);
  assert.doesNotMatch(storeText, /sk-[A-Za-z0-9]{8,}/);
  assert.match(storeText, /Staff Product Manager/);
  assert.match(storeText, /Example Learning Co/);
  assert.match(storeText, /discovery/);
  const ingestedRecord = storeJob(storeObj, ingestedJobId);
  assert.ok(ingestedRecord, 'ingested job must remain in canonical store.json');
  assert.match(
    `${ingestedRecord.title || ''}\n${ingestedRecord.company || ''}\n${ingestedRecord.description || ''}`,
    /Staff Product Manager|Example Learning Co|discovery/i,
    'ordinary job content must remain usable in store.json'
  );
  const profiles = Object.values(storeObj.profiles || {});
  assert.ok(
    profiles.some(profile => /Jordan Example|30%|Product Manager/i.test(JSON.stringify(profile))),
    'ordinary resume/profile content must remain usable in store.json'
  );
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B28 interview-story grounding covers title and reflection and never marks partial text grounded', async t => {
  const ctx = isolate(t, 'jobsss-b28-story');
  const { profileId, created } = await startProfile(ctx, 'Story Grounding Profile');
  const thirtyProof = (created.proofPoints || []).find(proof =>
    String(proof.summary || '').includes('30%') || (proof.metrics || []).some(metric => String(metric).includes('30'))
  );
  assert.ok(thirtyProof?.id && thirtyProof.summary, `fixture resume must extract the 30% proof: ${JSON.stringify(created.proofPoints).slice(0, 800)}`);

  const fabricated = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'draft_interview_story', {
      profileId,
      title: FABRICATED_TITLE,
      situation: thirtyProof.summary,
      task: thirtyProof.summary,
      action: thirtyProof.summary,
      result: thirtyProof.summary,
      reflection: FABRICATED_REFLECTION,
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const fabFrame = fabricated.frames.find(frame => frame.id === 2);
  const fabValue = parseToolValue(fabFrame);
  if (!isRejected(fabFrame, fabValue)) {
    const story = storyRecord(fabValue);
    assert.notEqual(
      story?.grounded,
      true,
      `fabricated title/reflection must not be marked grounded: ${JSON.stringify(fabValue).slice(0, 800)}`
    );
    assert.doesNotMatch(
      String(story?.groundingStatus || ''),
      /exact_proof|fully_grounded|^grounded$/i,
      `groundingStatus must not claim exact/full grounding for fabricated title/reflection: ${story?.groundingStatus}`
    );
    assert.match(
      JSON.stringify(story || fabValue),
      /title|reflection/i,
      'grounding result must account for title and reflection'
    );
    const fabEvidence = fieldEvidenceMap(story);
    assertFieldCitesNone(fabEvidence.title, 'fabricated title');
    assertFieldCitesNone(fabEvidence.reflection, 'fabricated reflection');
  } else {
    assert.match(
      rejectionBlob(fabFrame, fabValue),
      /ground|title|reflection|fabricat|not_grounded/i,
      `rejection of fabricated title/reflection must name grounding: ${rejectionBlob(fabFrame, fabValue)}`
    );
  }

  const storeAfterFab = readStore(ctx.dataDir);
  const persisted = Object.values(storeAfterFab.interviewStories || {});
  for (const story of persisted) {
    const blob = JSON.stringify(story);
    if (/\$10M|400%/.test(blob)) {
      assert.notEqual(story.grounded, true, `persisted fabricated title/reflection must not be grounded: ${blob.slice(0, 800)}`);
      const evidence = fieldEvidenceMap(story);
      assertFieldCitesNone(evidence.title, 'persisted fabricated title');
      assertFieldCitesNone(evidence.reflection, 'persisted fabricated reflection');
    }
  }

  const partial = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'draft_interview_story', {
      profileId,
      title: thirtyProof.summary,
      situation: thirtyProof.summary,
      task: thirtyProof.summary,
      action: 'I also invented an unpublished 400% conversion lift that is not in the resume.',
      result: thirtyProof.summary,
      reflection: thirtyProof.summary,
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const partialFrame = partial.frames.find(frame => frame.id === 2);
  const partialValue = parseToolValue(partialFrame);
  if (!isRejected(partialFrame, partialValue)) {
    const story = storyRecord(partialValue);
    assert.notEqual(
      story?.grounded,
      true,
      `partial STAR fabrication must not be marked grounded: ${JSON.stringify(partialValue).slice(0, 800)}`
    );
    assertFieldCitesNone(fieldEvidenceMap(story).action, 'partial fabricated action');
  }

  const fragment = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'draft_interview_story', {
      profileId,
      title: PROOF_FRAGMENT,
      situation: PROOF_FRAGMENT,
      task: PROOF_FRAGMENT,
      action: PROOF_FRAGMENT,
      result: PROOF_FRAGMENT,
      reflection: PROOF_FRAGMENT,
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const fragmentFrame = fragment.frames.find(frame => frame.id === 2);
  const fragmentValue = parseToolValue(fragmentFrame);
  if (!isRejected(fragmentFrame, fragmentValue)) {
    const story = storyRecord(fragmentValue);
    assert.notEqual(
      story?.grounded,
      true,
      `short substring/fragment of a proof must not be marked grounded: ${JSON.stringify(fragmentValue).slice(0, 800)}`
    );
    assert.doesNotMatch(
      String(story?.groundingStatus || ''),
      /exact_proof|fully_grounded|^grounded$/i,
      `groundingStatus must not claim exact/full grounding for substring fields: ${story?.groundingStatus}`
    );
    const evidence = fieldEvidenceMap(story);
    for (const fieldName of STORY_FIELDS) {
      assertFieldCitesNone(evidence[fieldName], `substring field ${fieldName}`);
    }
  } else {
    assert.match(
      rejectionBlob(fragmentFrame, fragmentValue),
      /ground|substring|fragment|exact|not_grounded|proof/i,
      `rejection of substring-only fields must name grounding: ${rejectionBlob(fragmentFrame, fragmentValue)}`
    );
  }

  const substringTitle = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'draft_interview_story', {
      profileId,
      title: PROOF_SUBSTRING_TITLE,
      situation: thirtyProof.summary,
      task: thirtyProof.summary,
      action: thirtyProof.summary,
      result: thirtyProof.summary,
      reflection: thirtyProof.summary,
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const subTitleFrame = substringTitle.frames.find(frame => frame.id === 2);
  const subTitleValue = parseToolValue(subTitleFrame);
  if (!isRejected(subTitleFrame, subTitleValue)) {
    const story = storyRecord(subTitleValue);
    assert.notEqual(
      story?.grounded,
      true,
      `title that is only a proof fragment must not ground the story: ${JSON.stringify(subTitleValue).slice(0, 800)}`
    );
    assertFieldCitesNone(fieldEvidenceMap(story).title, 'substring title');
  }

  const truthful = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'draft_interview_story', {
      profileId,
      title: thirtyProof.summary,
      situation: thirtyProof.summary,
      task: thirtyProof.summary,
      action: thirtyProof.summary,
      result: thirtyProof.summary,
      reflection: thirtyProof.summary,
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const truthfulValue = requireOk(truthful, 2, 'draft_interview_story exact proof wording on every content field');
  const truthfulStory = storyRecord(truthfulValue);
  assert.equal(
    truthfulStory?.grounded,
    true,
    `exact title/situation/task/action/result/reflection from owned proof may be grounded pending human verification: ${JSON.stringify(truthfulValue).slice(0, 800)}`
  );
  const truthfulEvidence = fieldEvidenceMap(truthfulStory);
  for (const fieldName of STORY_FIELDS) {
    assertFieldExactEvidence(
      truthfulEvidence[fieldName],
      thirtyProof,
      `truthful ${fieldName}`
    );
  }

  const restarted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_interview_stories', { profileId })
  ]);
  const stories = asList(requireOk(restarted, 2, 'list_interview_stories after restart'));
  const exact = stories.find(story =>
    story.title === thirtyProof.summary
    && story.situation === thirtyProof.summary
    && story.action === thirtyProof.summary
    && story.reflection === thirtyProof.summary
  );
  assert.ok(exact, `exact-proof story must survive restart: ${JSON.stringify(stories).slice(0, 800)}`);
  assert.equal(exact.grounded, true);
  const exactEvidence = fieldEvidenceMap(exact);
  for (const fieldName of STORY_FIELDS) {
    assertFieldExactEvidence(exactEvidence[fieldName], thirtyProof, `restart truthful ${fieldName}`);
  }
  const fabricatedPersisted = stories.filter(story => /\$10M|400%/.test(JSON.stringify(story)));
  for (const story of fabricatedPersisted) {
    assert.notEqual(story.grounded, true, `restart must not report fabricated story fields as grounded: ${JSON.stringify(story).slice(0, 500)}`);
    const evidence = fieldEvidenceMap(story);
    const titleFabricated = /\$10M|400%/.test(String(story.title || ''));
    const reflectionFabricated = /\$10M|400%/.test(String(story.reflection || ''));
    const actionFabricated = /\$10M|400%/.test(String(story.action || ''));
    if (titleFabricated) {
      assertFieldCitesNone(evidence.title, 'restart fabricated title');
    }
    if (reflectionFabricated) {
      assertFieldCitesNone(evidence.reflection, 'restart fabricated reflection');
    }
    if (actionFabricated) {
      assertFieldCitesNone(evidence.action, 'restart fabricated action');
    }
    for (const fieldName of STORY_FIELDS) {
      if (/\$10M|400%/.test(String(story[fieldName] || ''))) continue;
      if (story[fieldName] === thirtyProof.summary) {
        assertFieldExactEvidence(
          evidence[fieldName],
          thirtyProof,
          `restart exact ${fieldName} on mixed fabrication`
        );
      }
    }
  }
  const fragmentPersisted = stories.filter(story =>
    story.title === PROOF_FRAGMENT
    || story.title === PROOF_SUBSTRING_TITLE
    || STORY_FIELDS.every(fieldName => story[fieldName] === PROOF_FRAGMENT)
  );
  for (const story of fragmentPersisted) {
    assert.notEqual(
      story.grounded,
      true,
      `restart must not report substring-only story fields as grounded: ${JSON.stringify(story).slice(0, 500)}`
    );
    const evidence = fieldEvidenceMap(story);
    if (story.title === PROOF_FRAGMENT || STORY_FIELDS.every(fieldName => story[fieldName] === PROOF_FRAGMENT)) {
      for (const fieldName of STORY_FIELDS) {
        assertFieldCitesNone(evidence[fieldName], `restart substring field ${fieldName}`);
      }
    } else {
      assertFieldCitesNone(evidence.title, 'restart substring title');
    }
  }
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B29 tailoring extracts requirements, selects relevant owned proof, and reports coverage gaps', async t => {
  const ctx = isolate(t, 'jobsss-b29-tailor');
  const { profileId, created } = await startProfile(ctx, 'Tailoring Profile');
  const ownedIds = (created.proofPoints || []).map(proof => proof.id).filter(Boolean);
  assert.ok(ownedIds.length >= 1, 'fixture resume must extract owned proofs');
  const added = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'add_proof_point', {
      profileId,
      summary: UNRELATED_PROOF,
      skills: ['fishing', 'alaska'],
      metrics: ['400 tons']
    })
  ]);
  const unrelated = requireOk(added, 2, 'add_proof_point unrelated');
  const unrelatedId = pickId(unrelated, ['proofId', 'id']) || unrelated.proofPoint?.id;
  assert.ok(unrelatedId, `add_proof_point must return an id: ${JSON.stringify(unrelated)}`);

  const jobPath = jobFixture();
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'import_job'), ['jobId', 'id']);

  const made = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'tailor_resume', { jobId, profileId, format: 'markdown' }),
    callRequest(3, 'draft_cover_letter', { jobId, profileId, format: 'markdown' })
  ], { timeoutMs: 45_000 });
  const resume = requireOk(made, 2, 'tailor_resume');
  const cover = requireOk(made, 3, 'draft_cover_letter');
  for (const [label, value] of [['tailor_resume', resume], ['draft_cover_letter', cover]]) {
    const requirements = extractedRequirements(value);
    assert.ok(
      requirements.length >= 1,
      `${label} must extract job requirements rather than skip inventory: ${JSON.stringify(value).slice(0, 800)}`
    );
    const reqBlob = JSON.stringify(requirements).toLowerCase();
    assert.match(
      reqBlob,
      /discovery|roadmap|stakeholder|product management|educator|activation/i,
      `${label} requirements must come from the posting: ${reqBlob.slice(0, 400)}`
    );
    const selected = selectedProofIds(value);
    const content = draftContent(value);
    const blob = `${JSON.stringify(value)}\n${content}`;
    assert.doesNotMatch(
      content,
      /fishing vessel|400 tons of salmon/i,
      `${label} must not copy the unrelated fishing proof into the draft body`
    );
    if (selected.length) {
      assert.equal(
        selected.includes(unrelatedId),
        false,
        `${label} selected proofs must not include the unrelated fishing proof: ${JSON.stringify(selected)}`
      );
      assert.ok(
        selected.some(id => ownedIds.includes(id)),
        `${label} must select at least one resume-owned relevant proof`
      );
    } else {
      assert.ok(
        ownedIds.some(id => blob.includes(id)),
        `${label} must still cite a relevant owned proof id: ${blob.slice(0, 500)}`
      );
    }
    const gaps = coverageGaps(value);
    assert.ok(
      gaps.length >= 1,
      `${label} must report coverage gaps: ${JSON.stringify(value).slice(0, 800)}`
    );
    assert.doesNotMatch(blob, /400%|\$10M|invented metric/i);
    assert.doesNotMatch(claimText(value), /\b(submitted|sent|applied|approved)\b/);
  }
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});
