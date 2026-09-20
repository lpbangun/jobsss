// Host composition + deterministic projection regression suite (additive).
//
// Contract under test (frozen G4/G5 output contract and the bounded batch
// semantics of the frozen benchmark, offline half):
//   * one bounded request prepares up to five owned jobs for one profile and
//     records honest per-item statuses (prepared | partial | failed | blocked |
//     duplicate | skipped) with independent item failure isolation;
//   * people evidence is host-supplied, class-labelled (live | replay |
//     fixture), joined into the existing relationship surfaces, and a contact
//     miss is non-fatal with a structured reason code;
//   * the Markdown workspace projection (profile.md, tracker.md,
//     applications/<jobId>/application.md, resume.md, cover-letter.md,
//     contacts/<key>.md) is a deterministic function of the canonical store:
//     re-running the same request produces byte-identical files and adds no
//     duplicate logical job, contact, artifact, research record or draft;
//   * human-only state (artifact approval, contact suppression) survives
//     regeneration untouched;
//   * the explicit-tool route and the composed batch route converge on the same
//     durable logical state;
//   * the request surface exposes no send/submit/apply capability and a
//     fabricated live envelope is refused by the product.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT, pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  callRequest,
  initializeRequest,
  isolate,
  listRelFiles,
  listToolsRequest,
  mcp,
  parseToolValue,
  readStore,
  requireOk,
  resumeFixture
} from './helpers/jobsss-live-mcp.mjs';

const BATCH_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'batch');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fixture = name => JSON.parse(readFileSync(path.join(BATCH_DIR, name), 'utf8'));

// Wall-clock values are the only legitimate difference between two runs of the
// same request (every mutation stamps updatedAt). Logical equality strips them
// so a real drift — a duplicated job, contact, draft or a stale regeneration —
// still fails loudly.
const VOLATILE_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const logicalText = text => String(text).replace(VOLATILE_TIMESTAMP, '<timestamp>');

// The workspace projection under test (derived Markdown for the applicant
// packet). The aggregate projections/ files carry run counters and the
// append-only audit trail, so they are covered by the no-duplicate assertions
// instead of by text equality.
function workspaceProjectionFiles(dataDir) {
  return listRelFiles(dataDir).filter(rel => {
    const parts = rel.split(path.sep);
    return parts[0] === 'profiles' || parts[0] === 'applications';
  });
}

function projectionFiles(dataDir) {
  return listRelFiles(dataDir).filter(rel => rel !== 'store.json' && !rel.endsWith('store.json'));
}

function projectionHashes(dataDir) {
  return Object.fromEntries(projectionFiles(dataDir).sort().map(rel => [rel.split(path.sep).join('/'), sha256(readFileSync(path.join(dataDir, rel)))]));
}

function workspaceProjectionText(dataDir) {
  return Object.fromEntries(
    workspaceProjectionFiles(dataDir).sort().map(rel => [rel.split(path.sep).join('/'), logicalText(readFileSync(path.join(dataDir, rel), 'utf8'))])
  );
}

function companyOf(posting) {
  const match = String(posting).match(/^\s*Company:\s*(.+?)\s*$/m);
  assert.ok(match, `fixture posting must state a Company line: ${String(posting).slice(0, 60)}`);
  return match[1];
}

function collectionsCounts(store) {
  const names = ['jobs', 'applications', 'scores', 'artifacts', 'tasks', 'contacts', 'research', 'outreachPlans', 'outreachDrafts', 'contactDiscoveries', 'preparationBatches'];
  return Object.fromEntries(names.map(name => [name, Object.keys(store[name] || {}).length]));
}

function applicationDirectories(dataDir) {
  const abs = path.join(dataDir, 'applications');
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

async function callTools(ctx, entries, options = {}) {
  const session = await mcp(ctx, [initializeRequest(1), ...entries.map((entry, index) => callRequest(index + 2, entry.name, entry.args || {}))], options);
  const values = {};
  entries.forEach((entry, index) => {
    values[entry.label || entry.name] = { value: parseToolValue(session.frames.find(frame => frame.id === index + 2)), id: index + 2, session };
  });
  return values;
}

async function prepareProfile(ctx, requests, options = {}) {
  const session = await mcp(ctx, [initializeRequest(1), ...requests], options);
  return { session, ok: (id, label) => requireOk(session, id, label) };
}

async function importJobs(ctx, profileId, postings, startId = 2) {
  const requests = postings.map((posting, index) => callRequest(startId + index, 'import_job', { profileId, text: posting.posting }));
  const session = await mcp(ctx, [initializeRequest(1), ...requests]);
  const byKey = {};
  postings.forEach((posting, index) => {
    const value = requireOk(session, startId + index, `import_job ${posting.key}`);
    byKey[posting.key] = value.jobId || value.id;
  });
  return byKey;
}

function decide(ctx, args) {
  const result = spawnSync(ctx.launcher, ['decide', '--data', ctx.dataDir, ...args], {
    cwd: REPO_ROOT, env: ctx.env, encoding: 'utf8'
  });
  const text = String(result.stdout || '').trim();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { code: result.status, json, text, stderr: String(result.stderr || '') };
}

function humanDecision(ctx, action, entityId) {
  const listed = decide(ctx, ['--list']);
  assert.equal(listed.code, 0, `decide --list must exit 0: ${listed.text} ${listed.stderr}`);
  const item = (listed.json?.items || listed.json?.pending || []).find(entry => (entry.entityId === entityId || entry.id === entityId || entry.contactId === entityId || entry.artifactId === entityId));
  assert.ok(item, `no pending ${action} decision for ${entityId}: ${listed.text.slice(0, 600)}`);
  assert.ok((item.allowedActions || []).includes(action), `pending item must allow ${action}: ${JSON.stringify(item.allowedActions)}`);
  const done = decide(ctx, ['--action', action, '--id', item.entityId || item.id, '--revision', String(item.revision), '--content-hash', item.contentHash]);
  assert.equal(done.code, 0, `${action} must succeed through the trusted CLI: ${done.text} ${done.stderr}`);
  assert.equal(done.json?.ok, true, `${action} must report ok: ${done.text}`);
  return done.json;
}

test('B80 five-job fixture batch prepares every item with per-item status and a deterministic projection', async t => {
  const ctx = isolate(t, 'jobsss-b80-five-job');
  const data = fixture('jobs-five.json');
  assert.equal(data.fictional, true);
  assert.equal(data.live, false);

  const setup = await prepareProfile(ctx, [
    listToolsRequest(2),
    callRequest(3, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const listed = setup.session.frames.find(frame => frame.id === 2)?.result?.tools || [];
  const names = listed.map(tool => tool.name);
  for (const tool of ['prepare_applications_batch', 'record_contact_discovery', 'list_preparation_batches', 'list_contact_discoveries']) {
    assert.ok(names.includes(tool), `tools/list must advertise ${tool}`);
  }
  for (const blocked of ['submit_application_form', 'inspect_application_form', 'assist_application_form']) {
    assert.equal(names.includes(blocked), false, `${blocked} must never be advertised`);
  }
  const batchTool = listed.find(tool => tool.name === 'prepare_applications_batch');
  const batchProps = Object.keys(batchTool?.inputSchema?.properties || {});
  for (const forbidden of ['send', 'submit', 'apply', 'email', 'smtp']) {
    assert.equal(batchProps.some(prop => prop.includes(forbidden)), false, `prepare_applications_batch must expose no ${forbidden} capability: ${batchProps.join(', ')}`);
  }
  const profileId = requireOk(setup.session, 3, 'create_profile').profileId;
  assert.ok(profileId, 'create_profile must return a profileId');

  const jobIds = await importJobs(ctx, profileId, data.jobs);
  for (const posting of data.jobs) assert.ok(jobIds[posting.key], `import_job must return an id for ${posting.key}`);

  const contacts = data.contacts.map(contact => ({ ...contact, jobId: jobIds[contact.jobKey] }));
  const batch = await callTools(ctx, [{
    label: 'batch',
    name: 'prepare_applications_batch',
    args: { profileId, jobIds: data.jobs.map(posting => jobIds[posting.key]), class: 'fixture', format: 'markdown', contacts }
  }], { timeoutMs: 120_000 });
  const result = requireOk(batch.batch.session, batch.batch.id, 'prepare_applications_batch');
  const expect = data.expect;
  assert.equal(result.summary.requested, expect.items, `five-job batch must assess five items: ${JSON.stringify(result.summary)}`);
  assert.equal(result.summary.prepared, expect.prepared, `five-job batch must prepare every item: ${JSON.stringify(result.items.map(item => [item.jobId, item.status, item.reason]))}`);
  assert.equal(result.summary.failed, expect.failed);
  assert.equal(result.summary.blocked, expect.blocked);
  assert.equal(result.status, expect.batchStatus);
  assert.equal(result.summary.externalActions, 0, 'a local batch performs no external action');
  for (const item of result.items) {
    assert.equal(item.status, 'prepared', `every fixture item must be prepared: ${JSON.stringify(item)}`);
    assert.ok(item.score && typeof item.score.overall === 'number', `item ${item.jobId} must carry a deterministic score`);
    assert.ok(item.artifacts.resume && item.artifacts.resume.artifactId, `item ${item.jobId} must carry a tailored resume artifact`);
    assert.ok(item.artifacts.coverLetter && item.artifacts.coverLetter.reason, `item ${item.jobId} must state the cover-letter decision`);
    assert.equal(item.outreach?.delivered === true, false, 'outreach must never be delivered');
  }
  assert.equal(result.summary.contactMisses, expect.contactMisses, `one supplied contact miss must be recorded honestly: ${JSON.stringify(result.items.map(item => item.contacts))}`);

  // Per-job / per-contact artifacts on disk.
  const dirs = applicationDirectories(ctx.dataDir);
  assert.equal(dirs.length, expect.applicationDirectories, `exactly one application directory per logical job: ${dirs.join(', ')}`);
  for (const jobId of Object.values(jobIds)) assert.ok(dirs.includes(jobId), `application directory for ${jobId} must exist`);
  const profileDir = path.join(ctx.dataDir, 'profiles', profileId);
  assert.equal(existsSync(path.join(profileDir, 'profile.md')), true, 'profile.md projection must exist');
  assert.equal(existsSync(path.join(profileDir, 'tracker.md')), true, 'tracker.md projection must exist');
  const tracker = readFileSync(path.join(profileDir, 'tracker.md'), 'utf8');
  assert.match(tracker, /Employer \| Role \| Status \| Next action \| Deadline \| Links \| Last update/, 'tracker must carry the documented columns');
  assert.match(tracker, new RegExp(companyOf(data.jobs[0].posting)), 'tracker must list tracked employers');
  assert.doesNotMatch(tracker, /\/home\/|\/tmp\//, 'projections must not contain absolute user paths');
  const firstJobId = jobIds[data.jobs[0].key];
  const application = readFileSync(path.join(ctx.dataDir, 'applications', firstJobId, 'application.md'), 'utf8');
  for (const section of ['## Job and source snapshot', '## Fit rationale', '## Materials', '### Application checklist / review-gap truth', '### People and contact evidence', '### Unsent outreach drafts', '### Outcome history']) {
    assert.ok(application.includes(section), `application.md must contain ${section}`);
  }
  assert.match(application, /No submission, sending, approval, or application was performed by JobSSS/, 'application.md must state the boundary');
  assert.doesNotMatch(application, /\b(applied|submitted)\b\s*:/, 'application.md must not claim an external action');
  const contactFiles = listRelFiles(ctx.dataDir).filter(rel => rel.includes(`contacts${path.sep}`));
  assert.equal(contactFiles.length, data.contacts.length, `one contact artifact per recorded contact/miss: ${contactFiles.join(', ')}`);
  const missFile = contactFiles.map(rel => readFileSync(path.join(ctx.dataDir, rel), 'utf8')).find(text => /miss reason code: no_public_channel/.test(text));
  assert.ok(missFile, 'the contact miss must carry a structured miss reason code');
  assert.match(missFile, /non-fatal bounded preparation/, 'a contact miss must be described as non-fatal');

  // Restart readback through a NEW MCP process.
  const restart = await callTools(ctx, [
    { label: 'batches', name: 'list_preparation_batches', args: { profileId } },
    { label: 'discoveries', name: 'list_contact_discoveries', args: { profileId } }
  ]);
  const batches = requireOk(restart.batches.session, restart.batches.id, 'list_preparation_batches');
  assert.equal(batches.count, 1, 'exactly one batch record must survive restart');
  assert.equal(batches.perItemStatuses.length, expect.items, 'per-item statuses must survive restart');
  assert.deepEqual([...new Set(batches.perItemStatuses.map(entry => entry.status))], ['prepared']);
  const discoveries = requireOk(restart.discoveries.session, restart.discoveries.id, 'list_contact_discoveries');
  assert.equal(discoveries.count, data.contacts.length, 'recorded contact evidence must survive restart');
  assert.equal(discoveries.misses, 1, 'the recorded miss must survive restart as a miss');
});

test('B81 re-running the same batch is idempotent and preserves human-only decisions', async t => {
  const ctx = isolate(t, 'jobsss-b81-idempotent');
  const data = fixture('jobs-five.json');
  const setup = await prepareProfile(ctx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const profileId = requireOk(setup.session, 2, 'create_profile').profileId;
  const jobIds = await importJobs(ctx, profileId, data.jobs);
  const contacts = data.contacts.map(contact => ({ ...contact, jobId: jobIds[contact.jobKey] }));
  const batchArgs = {
    profileId,
    jobIds: data.jobs.map(posting => jobIds[posting.key]),
    class: 'fixture',
    format: 'markdown',
    contacts
  };

  const firstRun = await callTools(ctx, [{ label: 'batch', name: 'prepare_applications_batch', args: batchArgs }], { timeoutMs: 120_000 });
  const first = requireOk(firstRun.batch.session, firstRun.batch.id, 'prepare_applications_batch');
  assert.equal(first.batch.runs, 1);
  const countsAfterFirst = collectionsCounts(readStore(ctx.dataDir));
  const textAfterFirst = workspaceProjectionText(ctx.dataDir);
  const documentHashesAfterFirst = Object.fromEntries(
    Object.entries(projectionHashes(ctx.dataDir)).filter(([rel]) => rel.endsWith('resume.md') || rel.endsWith('cover-letter.md'))
  );
  assert.ok(Object.keys(documentHashesAfterFirst).length > 0, 'the batch must project tailored document text');
  const dirsAfterFirst = applicationDirectories(ctx.dataDir);

  // Re-run the identical request: same batch record, no new logical state.
  const secondRun = await callTools(ctx, [{ label: 'batch', name: 'prepare_applications_batch', args: batchArgs }], { timeoutMs: 120_000 });
  const second = requireOk(secondRun.batch.session, secondRun.batch.id, 'prepare_applications_batch');
  assert.equal(second.batchId, first.batchId, 'an identical request must reuse the same batch record');
  assert.equal(second.batch.runs, 2, 'the batch record must count its runs instead of duplicating');
  assert.deepEqual(applicationDirectories(ctx.dataDir), dirsAfterFirst, 'no duplicate application directory may appear');
  const textAfterSecond = workspaceProjectionText(ctx.dataDir);
  assert.deepEqual(Object.keys(textAfterSecond).sort(), Object.keys(textAfterFirst).sort(), 'regeneration must not add or drop projection files');
  for (const [rel, text] of Object.entries(textAfterFirst)) {
    assert.equal(textAfterSecond[rel], text, `regeneration must be logically identical for ${rel}`);
  }
  // The document projections carry no volatile state at all, so those files
  // must be byte-identical after a full re-run.
  const documentHashesAfterSecond = Object.fromEntries(
    Object.entries(projectionHashes(ctx.dataDir)).filter(([rel]) => rel.endsWith('resume.md') || rel.endsWith('cover-letter.md'))
  );
  assert.deepEqual(documentHashesAfterSecond, documentHashesAfterFirst, 'the projected resume/cover documents must be byte-identical across runs');
  assert.deepEqual(collectionsCounts(readStore(ctx.dataDir)), countsAfterFirst, 'a re-run must add no duplicate logical record');

  // Trusted-human decisions: approve the resume artifact and suppress the
  // supplied contact, then regenerate.
  const storeAfterSecond = readStore(ctx.dataDir);
  const resumeArtifact = Object.values(storeAfterSecond.artifacts).find(artifact => artifact.kind === 'resume_draft' && artifact.jobId === jobIds[data.jobs[0].key]);
  assert.ok(resumeArtifact, 'a resume draft artifact must exist for the first job');
  humanDecision(ctx, 'artifact.approve', resumeArtifact.id);
  const approvedContact = Object.values(readStore(ctx.dataDir).contacts)[0];
  assert.ok(approvedContact?.id, 'the supplied contact brief must create a local contact record');
  humanDecision(ctx, 'contact.suppress', approvedContact.id);

  const countsBeforeThird = collectionsCounts(readStore(ctx.dataDir));
  const thirdRun = await callTools(ctx, [{ label: 'batch', name: 'prepare_applications_batch', args: batchArgs }], { timeoutMs: 120_000 });
  const third = requireOk(thirdRun.batch.session, thirdRun.batch.id, 'prepare_applications_batch');
  assert.equal(third.batch.runs, 3);
  assert.equal(third.summary.prepared, data.expect.prepared, 'the human decisions must not turn prepared items into failures');
  const storeAfterThird = readStore(ctx.dataDir);
  assert.deepEqual(
    { jobs: collectionsCounts(storeAfterThird).jobs, applications: collectionsCounts(storeAfterThird).applications, artifacts: collectionsCounts(storeAfterThird).artifacts, contacts: collectionsCounts(storeAfterThird).contacts, outreachDrafts: collectionsCounts(storeAfterThird).outreachDrafts },
    { jobs: countsBeforeThird.jobs, applications: countsBeforeThird.applications, artifacts: countsBeforeThird.artifacts, contacts: countsBeforeThird.contacts, outreachDrafts: countsBeforeThird.outreachDrafts },
    'regeneration must not create duplicate jobs, applications, artifacts, contacts or drafts'
  );
  const preservedArtifact = storeAfterThird.artifacts[resumeArtifact.id];
  assert.ok(preservedArtifact, 'the approved artifact must survive regeneration');
  assert.equal(preservedArtifact.status, 'approved', 'regeneration must not overwrite a human-approved artifact');
  assert.ok(preservedArtifact.approvedAt, 'the human approval timestamp must survive regeneration');
  const preservedContact = storeAfterThird.contacts[approvedContact.id];
  assert.equal(preservedContact.doNotUse, true, 'regeneration must not resurrect a human-suppressed contact');
  assert.equal(Object.values(storeAfterThird.contacts).length, countsBeforeThird.contacts, 'no replacement contact may be created');
  const suppressedItem = third.items.find(item => item.jobId === jobIds[data.contacts[0].jobKey]);
  assert.ok(suppressedItem.preservedProtectedFields.includes('doNotUse'), `the item must report the preserved human protection: ${JSON.stringify(suppressedItem.preservedProtectedFields)}`);
  assert.equal(suppressedItem.outreach?.delivered === true, false, 'no outreach may be delivered');
  const outreachCounts = { plans: collectionsCounts(storeAfterThird).outreachPlans, drafts: collectionsCounts(storeAfterThird).outreachDrafts };
  assert.equal(outreachCounts.drafts, countsBeforeThird.outreachDrafts, 'the existing unsent draft must be preserved, not duplicated');
  assert.equal(outreachCounts.plans, countsBeforeThird.outreachPlans, 'the existing outreach plan must be preserved, not duplicated');
});

test('B82 single, empty, partial/blocked and logical-duplicate fixtures keep honest batch semantics', async t => {
  const single = fixture('jobs-single.json');
  const empty = fixture('jobs-empty.json');
  const partial = fixture('jobs-partial.json');
  const duplicate = fixture('jobs-duplicate.json');

  // single item
  const singleCtx = isolate(t, 'jobsss-b82-single');
  const singleSetup = await prepareProfile(singleCtx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const singleProfile = requireOk(singleSetup.session, 2, 'create_profile').profileId;
  const singleJobs = await importJobs(singleCtx, singleProfile, single.jobs);
  const singleBatch = await callTools(singleCtx, [{
    label: 'batch', name: 'prepare_applications_batch',
    args: { profileId: singleProfile, jobIds: Object.values(singleJobs), class: 'fixture', format: 'pdf' }
  }], { timeoutMs: 120_000 });
  const singleResult = requireOk(singleBatch.batch.session, singleBatch.batch.id, 'prepare_applications_batch (single)');
  assert.equal(singleResult.summary.prepared, single.expect.prepared);
  assert.equal(singleResult.status, single.expect.batchStatus);
  assert.equal(applicationDirectories(singleCtx.dataDir).length, single.expect.applicationDirectories);
  const singleItem = singleResult.items[0];
  assert.ok(singleItem.artifacts.resume.pdfRelativePath, 'pdf format must expose the rendered PDF path');
  assert.ok(existsSync(path.join(singleCtx.dataDir, singleItem.artifacts.resume.pdfRelativePath)), 'the rendered PDF must exist under PLUGIN_DATA');
  const pdfHead = readFileSync(path.join(singleCtx.dataDir, singleItem.artifacts.resume.pdfRelativePath)).subarray(0, 5).toString('utf8');
  assert.equal(pdfHead, '%PDF-', 'the projected resume password must be a real PDF');
  const singleApplication = readFileSync(path.join(singleCtx.dataDir, 'applications', singleItem.jobId, 'application.md'), 'utf8');
  assert.match(singleApplication, /rendered PDF \(portable path relative to PLUGIN_DATA\)/, 'application.md must point at the rendered PDF portably');
  assert.equal(existsSync(path.join(singleCtx.dataDir, 'applications', singleItem.jobId, 'resume.md')), true, 'the tailored resume text must be projected');

  // empty selection: honest no_items, no fabrication
  const emptyCtx = isolate(t, 'jobsss-b82-empty');
  const emptySetup = await prepareProfile(emptyCtx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const emptyProfile = requireOk(emptySetup.session, 2, 'create_profile').profileId;
  const emptyBatch = await callTools(emptyCtx, [{
    label: 'batch', name: 'prepare_applications_batch',
    args: { profileId: emptyProfile, jobIds: empty.jobs, class: 'fixture' }
  }]);
  const emptyResult = requireOk(emptyBatch.batch.session, emptyBatch.batch.id, 'prepare_applications_batch (empty)');
  assert.equal(emptyResult.summary.requested, 0);
  assert.equal(emptyResult.status, empty.expect.batchStatus);
  assert.match(emptyResult.message, /nothing was fabricated/, `an empty batch must say so honestly: ${emptyResult.message}`);
  assert.equal(applicationDirectories(emptyCtx.dataDir).length, 0, 'an empty batch must create no application directory');
  const emptyStore = readStore(emptyCtx.dataDir);
  assert.equal(Object.keys(emptyStore.jobs || {}).length, 0, 'an empty batch must not fabricate a job');
  assert.equal(Object.keys(emptyStore.scores || {}).length, 0, 'an empty batch must not fabricate a score');

  // partial + blocked isolation in one bounded request
  const partialCtx = isolate(t, 'jobsss-b82-partial');
  const partialSetup = await prepareProfile(partialCtx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const partialProfile = requireOk(partialSetup.session, 2, 'create_profile').profileId;
  const partialJobs = await importJobs(partialCtx, partialProfile, partial.jobs);
  const partialContacts = partial.contacts.map(contact => ({ ...contact, jobId: partialJobs[contact.jobKey] }));
  const partialBatch = await callTools(partialCtx, [{
    label: 'batch', name: 'prepare_applications_batch',
    args: {
      profileId: partialProfile,
      jobIds: [...Object.values(partialJobs), ...partial.blockedJobIds],
      class: 'fixture',
      format: 'markdown',
      contacts: partialContacts
    }
  }], { timeoutMs: 120_000 });
  const partialResult = requireOk(partialBatch.batch.session, partialBatch.batch.id, 'prepare_applications_batch (partial)');
  const byStatus = status => partialResult.items.filter(item => item.status === status).length;
  assert.equal(partialResult.items.length, partial.expect.items, 'every requested item must be reported');
  assert.equal(byStatus('prepared'), partial.expect.prepared, `unaffected items must still be prepared: ${JSON.stringify(partialResult.items.map(item => [item.jobId, item.status, item.reason]))}`);
  assert.equal(byStatus('partial'), partial.expect.partial, 'a job with no scorable evidence must be an honest partial, not a fabricated pass');
  assert.equal(byStatus('blocked'), partial.expect.blocked, 'an unknown job id must be blocked, not silently dropped');
  assert.equal(partialResult.status, partial.expect.batchStatus, 'the batch must report partial success, never silent all-success');
  const partialItem = partialResult.items.find(item => item.status === 'partial');
  assert.equal(partialItem.reason, 'no_requirement_matched_by_profile_proof', 'the partial reason must be explicit');
  assert.equal(partialItem.evidence.matchedRequirements, 0, 'the honest partial reason must be the unmatched requirement evidence');
  const blockedItem = partialResult.items.find(item => item.status === 'blocked');
  assert.equal(blockedItem.reason, 'unknown_job', 'the blocked reason must be explicit');
  assert.equal(applicationDirectories(partialCtx.dataDir).length, partial.expect.applicationDirectories);
  const partialMisses = partialResult.items.flatMap(item => item.contacts || []).filter(entry => entry.status === 'miss');
  assert.equal(partialMisses.length, 1, 'the supplied miss must be recorded as a miss');
  assert.equal(partialMisses[0].missReason, 'not_enriched', 'the miss must keep its structured reason code');
  assert.equal(partialMisses[0].fatal, false, 'a contact miss must never be fatal');

  // logical duplicate: same employer/role/location in two postings
  const duplicateCtx = isolate(t, 'jobsss-b82-duplicate');
  const duplicateSetup = await prepareProfile(duplicateCtx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const duplicateProfile = requireOk(duplicateSetup.session, 2, 'create_profile').profileId;
  const duplicateJobs = await importJobs(duplicateCtx, duplicateProfile, duplicate.jobs);
  const duplicateBatch = await callTools(duplicateCtx, [{
    label: 'batch', name: 'prepare_applications_batch',
    args: { profileId: duplicateProfile, jobIds: Object.values(duplicateJobs), class: 'fixture', format: 'markdown' }
  }], { timeoutMs: 120_000 });
  const duplicateResult = requireOk(duplicateBatch.batch.session, duplicateBatch.batch.id, 'prepare_applications_batch (duplicate)');
  assert.equal(duplicateResult.summary.prepared, duplicate.expect.prepared);
  assert.equal(duplicateResult.summary.duplicates, duplicate.expect.duplicates);
  assert.equal(duplicateResult.status, duplicate.expect.batchStatus);
  assert.equal(applicationDirectories(duplicateCtx.dataDir).length, duplicate.expect.applicationDirectories, 'a logical duplicate must not create a second application directory');
  const duplicateItem = duplicateResult.items.find(item => item.status === 'duplicate');
  assert.match(duplicateItem.reason, /^duplicate_of:/, 'the duplicate must name the job it duplicates');
  const duplicateStore = readStore(duplicateCtx.dataDir);
  const duplicatedJob = duplicateStore.jobs[duplicateItem.jobId];
  assert.equal(duplicatedJob.duplicateOf, duplicateItem.reason.replace('duplicate_of:', ''), 'the duplicate posting must be marked with the job it duplicates');
  assert.equal(duplicatedJob.saved, false, 'a logical duplicate must not stay separately tracked');
  assert.equal(duplicatedJob.localDuplicate, true);
  assert.equal(existsSync(path.join(duplicateCtx.dataDir, 'applications', duplicateItem.jobId)), false, 'a logical duplicate must materialize no second packet directory');
  assert.equal(
    Object.values(duplicateStore.applications || {}).filter(app => app.jobId === duplicateItem.jobId).length,
    0,
    'a logical duplicate must own no application record'
  );
});

test('B83 replay and fake-live contact payloads are labelled, bounded, and refused when unattributed', async t => {
  const ctx = isolate(t, 'jobsss-b83-replay');
  const data = fixture('contacts-replay.json');
  assert.equal(data.class, 'replay');
  assert.equal(data.live, false);
  const setup = await prepareProfile(ctx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const profileId = requireOk(setup.session, 2, 'create_profile').profileId;
  const imported = await callTools(ctx, [{
    label: 'job', name: 'import_job', args: { profileId, text: fixture('jobs-single.json').jobs[0].posting }
  }]);
  const jobId = requireOk(imported.job.session, imported.job.id, 'import_job').jobId;
  // Pursuit is what materializes the application packet directory the
  // per-contact artifacts live in (the same step the batch performs).
  const pursued = await callTools(ctx, [{ label: 'pursue', name: 'pursue_job', args: { jobId, profileId } }]);
  requireOk(pursued.pursue.session, pursued.pursue.id, 'pursue_job');

  const recorded = [];
  const rejected = [];
  for (const [index, payload] of data.replayPayloads.entries()) {
    const call = await callTools(ctx, [{
      label: 'contact', name: 'record_contact_discovery',
      args: { ...payload, profileId, jobId, subjectName: payload.subjectName, subjectCompany: payload.subjectCompany }
    }]);
    const value = parseToolValue(call.contact.session.frames.find(frame => frame.id === 2));
    if (payload.expect === 'rejected') {
      assert.ok(value?.error, `unattributed/unsupported payload must be refused by the product: ${JSON.stringify(value)}`);
      const blob = JSON.stringify(value);
      assert.ok(blob.includes(payload.expectCode), `refusal must use the typed code ${payload.expectCode}: ${blob.slice(0, 400)}`);
      rejected.push(payload.expectCode);
    } else {
      assert.ok(value && !value.error, `replay payload must be recordable: ${JSON.stringify(value)}`);
      recorded.push(value.discovery);
    }
  }
  assert.equal(recorded.length, data.expect.recorded, 'replay evidence must be recordable as replay');
  assert.equal(rejected.length, data.expect.rejected, 'every negative control must be refused');
  for (const discovery of recorded) {
    assert.equal(discovery.class, 'replay', 'replay evidence must stay labelled replay');
    const latest = discovery.history[discovery.history.length - 1];
    assert.ok(latest.runId, 'replay evidence must name the original run it re-presents');
    assert.equal(latest.class, 'replay', 'the replay label must be recorded in the evidence history');
  }
  assert.equal(recorded.filter(discovery => discovery.class === 'live').length, data.expect.liveClaims, 'no live claim may be recorded without current-run metadata');
  const store = readStore(ctx.dataDir);
  const discoveries = Object.values(store.contactDiscoveries || {});
  assert.equal(discoveries.length, data.expect.recorded);
  assert.equal(discoveries.some(discovery => discovery.class === 'live'), false, 'no live-labelled discovery may be persisted');
  const brief = discoveries.find(discovery => discovery.status === 'contact_brief');
  assert.equal(brief.emailStatus, 'provider_reported', 'a provider-reported address is never a verified mailbox');
  assert.equal(store.contacts[brief.contactId].humanApproved, false, 'recording evidence must never approve a contact');
  const contactArtifact = listRelFiles(ctx.dataDir).find(rel => rel.includes(`contacts${path.sep}`) && rel.includes(brief.contactKey));
  assert.ok(contactArtifact, `a per-contact artifact must exist for ${brief.contactKey}`);
  const artifactText = readFileSync(path.join(ctx.dataDir, contactArtifact), 'utf8');
  assert.match(artifactText, /evidence class: replay/, 'the per-contact artifact must carry the replay label');
  assert.match(artifactText, /not a verified mailbox/, 'the per-contact artifact must deny mailbox verification');
});

test('B84 explicit tool route and composed batch route converge on the same durable state', async t => {
  const data = fixture('jobs-five.json');
  const postings = data.jobs.slice(0, 2);
  const contact = { ...data.contacts[0], jobKey: postings[0].key };
  const normalize = store => ({
    jobLifecycle: Object.values(store.jobs || {}).map(job => [job.id, job.saved === true, job.status]).sort(),
    applications: Object.values(store.applications || {}).map(app => [app.jobId, app.status, app.localOnly === true]).sort(),
    scores: Object.values(store.scores || {}).map(score => [score.jobId, score.overall, score.scoreStatus, score.eligibility?.status, (score.eligibility?.hardFailures || []).length]).sort(),
    artifacts: Object.values(store.artifacts || {}).map(artifact => [artifact.jobId, artifact.kind, artifact.status, artifact.contentHash]).sort(),
    artifactBodies: Object.values(store.artifacts || {}).map(artifact => [artifact.kind, sha256(String(artifact.content || ''))]).sort(),
    contacts: Object.values(store.contacts || {}).map(item => [item.name, item.company, item.email, item.humanApproved === true, item.doNotUse === true]).sort(),
    research: Object.values(store.research || {}).map(item => [item.jobId, item.subjectName, item.subjectCompany, (item.findings || []).join('|')]).sort(),
    plans: Object.values(store.outreachPlans || {}).map(item => [item.jobId, item.goal, item.status, item.reachable === true, item.delivered === true]).sort(),
    drafts: Object.values(store.outreachDrafts || {}).map(item => [item.jobId, item.goal, item.kind, item.subject, item.body, item.delivered === true, item.status]).sort(),
    tasks: Object.values(store.tasks || {}).map(task => [task.jobId, task.kind, task.text, task.status]).sort()
  });

  // Route A: one composed batch request.
  const batchCtx = isolate(t, 'jobsss-b84-batch-route');
  const batchSetup = await prepareProfile(batchCtx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const batchProfile = requireOk(batchSetup.session, 2, 'create_profile').profileId;
  const batchJobs = await importJobs(batchCtx, batchProfile, postings);
  const batchBatch = await callTools(batchCtx, [{
    label: 'batch', name: 'prepare_applications_batch',
    args: {
      profileId: batchProfile,
      jobIds: postings.map(posting => batchJobs[posting.key]),
      class: 'fixture',
      format: 'markdown',
      coverLetter: true,
      contacts: [{ ...contact, jobId: batchJobs[contact.jobKey] }]
    }
  }], { timeoutMs: 120_000 });
  const batchResult = requireOk(batchBatch.batch.session, batchBatch.batch.id, 'prepare_applications_batch');
  assert.equal(batchResult.summary.prepared, postings.length);
  const batchStore = readStore(batchCtx.dataDir);

  // Route B: the explicit tool sequence an explicit-skills caller would run.
  const toolCtx = isolate(t, 'jobsss-b84-tool-route');
  const toolSetup = await prepareProfile(toolCtx, [
    callRequest(2, 'create_profile', { name: 'Jordan Example', resumePath: resumeFixture(), path: resumeFixture() })
  ]);
  const toolProfile = requireOk(toolSetup.session, 2, 'create_profile').profileId;
  const toolJobs = await importJobs(toolCtx, toolProfile, postings);
  for (const [index, posting] of postings.entries()) {
    const jobId = toolJobs[posting.key];
    const step = await callTools(toolCtx, [
      { label: 'score', name: 'score_job', args: { jobId, profileId: toolProfile } },
      { label: 'pursue', name: 'pursue_job', args: { jobId, profileId: toolProfile } },
      { label: 'resume', name: 'tailor_resume', args: { jobId, profileId: toolProfile, format: 'markdown' } },
      { label: 'cover', name: 'draft_cover_letter', args: { jobId, profileId: toolProfile, format: 'markdown' } }
    ], { timeoutMs: 90_000 });
    for (const label of ['score', 'pursue', 'resume', 'cover']) {
      requireOk(step[label].session, step[label].id, `${label} on ${posting.key}`);
    }
    if (index === 0) {
      const imported = await callTools(toolCtx, [{
        label: 'contact', name: 'import_contact',
        args: {
          profileId: toolProfile,
          name: contact.subjectName,
          email: contact.email,
          company: contact.subjectCompany,
          role: contact.role || '',
          source: `contact_discovery:${contact.class}`,
          notes: 'Synthetic fixture contact.'
        }
      }]);
      const contactRecord = requireOk(imported.contact.session, imported.contact.id, 'import_contact');
      const research = await callTools(toolCtx, [{
        label: 'research', name: 'record_research',
        args: {
          profileId: toolProfile,
          jobId,
          subjectName: contact.subjectName,
          subjectCompany: contact.subjectCompany,
          source: 'contact_discovery:contact_brief',
          findings: contact.evidence.map(item => `${item.kind}:${item.ref}`)
        }
      }]);
      requireOk(research.research.session, research.research.id, 'record_research');
      const plan = await callTools(toolCtx, [{
        label: 'plan', name: 'plan_outreach', args: { jobId, profileId: toolProfile, contactId: contactRecord.contactId, goal: 'informational' }
      }]);
      requireOk(plan.plan.session, plan.plan.id, 'plan_outreach');
      const draft = await callTools(toolCtx, [{
        label: 'draft', name: 'draft_outreach', args: { jobId, profileId: toolProfile, contactId: contactRecord.contactId, goal: 'informational' }
      }]);
      requireOk(draft.draft.session, draft.draft.id, 'draft_outreach');
    }
  }
  const toolStore = readStore(toolCtx.dataDir);
  assert.deepEqual(
    normalize(batchStore),
    normalize(toolStore),
    'the composed batch route and the explicit tool route must produce the same durable logical state'
  );
});
