// Independent reviewer-owned acceptance; do not edit during implementation rounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import * as d from '../src/domain.js';
import { listDecisionHandoffs, createDecisionHandoff } from '../src/authority.js';
import { startMcp } from '../src/mcp.js';
const root = path.resolve(import.meta.dirname, '..');
const A = 'Synthetic Reviewer\nBuilt Python data pipelines reducing processing time by 30%.';
const B = 'Synthetic Reviewer\nLed Kubernetes migration reducing infrastructure costs by 40%.';
function context(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-reviewer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = () => JSON.parse(bytes());
  const bytes = () => fs.readFileSync(path.join(dir, 'store.json'), 'utf8');
  const profileId = d.createProfile(dir, { name: 'Reviewer', resumeText: A }).profileId;
  const job = (company = 'Synthetic Labs', text = 'Build Python data pipelines.') => d.importJob(dir, { profileId, text: `Title: Engineer\nCompany: ${company}\nRequirements:\n- ${text}` }).jobId;
  const decide = (id, action) => {
    const item = listDecisionHandoffs(dir, { profileId }).items.find(x => x.id === id);
    assert.ok(item, 'trusted binding must exist before decision');
    const r = spawnSync(process.execPath, [path.join(root, 'bin/jobsss'), 'decide', '--data', dir, '--action', action, '--id', id, '--revision', String(item.revision), '--content-hash', item.contentHash, '--note', 'Synthetic reviewer decision'], { encoding: 'utf8', env: { PATH: path.dirname(process.execPath), HOME: dir, PLUGIN_DATA: dir } });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  return { dir, state, bytes, profileId, job, decide };
}
async function wire(dir, messages) {
  const input = new PassThrough(); const frames = [];
  const server = startMcp({ dataDir: dir, input, sendResponse: x => frames.push(x) });
  input.end(messages.map(x => JSON.stringify({ jsonrpc: '2.0', ...x })).join('\n') + '\n');
  await server.completed; return frames;
}
const call = (name, args, id = 1) => ({ id, method: 'tools/call', params: { name, arguments: args } });

test('R1 distinct names never overwrite a normalized identity collision', t => {
  const c = context(t);
  for (const [first, second] of [['李明', '王伟'], ['A B', 'A-B']]) {
    const p = d.createProfile(c.dir, { name: first, resumeText: A });
    const before = c.state().profiles[p.profileId];
    let q;
    try { q = d.createProfile(c.dir, { name: second, resumeText: B }); } catch (e) { assert.match(String(e.code || e.message), /collis|exist|duplicate|conflict/i); }
    if (q) assert.notEqual(q.profileId, p.profileId);
    assert.deepEqual(c.state().profiles[p.profileId], before);
  }
});
test('R2 identical resume import retains trusted proof verification and decision history', t => {
  const c = context(t); const id = c.state().profiles[c.profileId].proofPointIds[0];
  c.decide(id, 'proof.verify'); const before = c.state();
  d.createProfile(c.dir, { name: 'Reviewer', resumeText: A }); const after = c.state();
  assert.equal(after.proofPoints[id].verifiedAt, before.proofPoints[id].verifiedAt);
  assert.equal(after.proofPoints[id].status, before.proofPoints[id].status);
  assert.deepEqual(after.decisions[id], before.decisions[id]);
  for (const event of before.audit) assert.ok(after.audit.some(x => JSON.stringify(x) === JSON.stringify(event)));
});
test('R3 identical resume drafting retains trusted approval and history', async t => {
  const c = context(t); const jobId = c.job();
  const first = await d.tailorResume(c.dir, { profileId: c.profileId, jobId });
  c.decide(first.artifactId, 'artifact.approve'); const before = c.state();
  const again = await d.tailorResume(c.dir, { profileId: c.profileId, jobId }); const after = c.state();
  assert.equal(again.artifactId, first.artifactId);
  assert.equal(after.artifacts[first.artifactId].approvedAt, before.artifacts[first.artifactId].approvedAt);
  assert.equal(after.artifacts[first.artifactId].status, before.artifacts[first.artifactId].status);
  assert.deepEqual(after.decisions[first.artifactId], before.decisions[first.artifactId]);
});
test('R4 A to B to A restores current resume pointer while retaining both revisions', t => {
  const c = context(t); const original = c.state().profiles[c.profileId].currentResumeId;
  d.createProfile(c.dir, { name: 'Reviewer', resumeText: B }); const middle = c.state().profiles[c.profileId].currentResumeId;
  assert.notEqual(middle, original);
  d.createProfile(c.dir, { name: 'Reviewer', resumeText: A }); const state = c.state();
  assert.equal(state.profiles[c.profileId].currentResumeId, original);
  assert.ok(state.resumes[original]); assert.ok(state.resumes[middle]);
  assert.ok(state.profiles[c.profileId].resumeRevisionIds.includes(middle));
});
test('R5 historical-only proof stays stored but cannot match current drafting or scoring', async t => {
  const c = context(t);
  d.createProfile(c.dir, { name: 'Reviewer', resumeText: B });
  const oldIds = c.state().profiles[c.profileId].proofPointIds;
  d.createProfile(c.dir, { name: 'Reviewer', resumeText: A });
  const jobId = c.job('History Labs', 'Lead Kubernetes migration and reduce infrastructure costs.');
  const draft = await d.tailorResume(c.dir, { profileId: c.profileId, jobId });
  const score = await d.scoreJob(c.dir, { profileId: c.profileId, jobId });
  for (const id of oldIds) {
    assert.ok(c.state().proofPoints[id], 'history must not be deleted');
    assert.ok(!(draft.selectedProofPointIds || draft.proofPointIds).includes(id), 'inactive resume proof selected');
    assert.ok(!JSON.stringify(score).includes(id), 'inactive resume proof used in current score');
  }
});
test('R6 mixed review queue retains pending undrafted jobs', async t => {
  const c = context(t); const a = c.job(); const b = c.job('Second Labs');
  await d.scoreJob(c.dir, { profileId: c.profileId, jobId: b });
  await d.tailorResume(c.dir, { profileId: c.profileId, jobId: a });
  const queue = d.reviewQueue(c.dir, { profileId: c.profileId }).queue;
  assert.ok(queue.some(x => x.jobId === a)); assert.ok(queue.some(x => x.jobId === b));
});
test('R7 retired stories are history, not interview coverage', t => {
  const c = context(t);
  const story = d.draftInterviewStory(c.dir, { profileId: c.profileId, title: 'Leadership', situation: 'Team conflict', task: 'Lead team', action: 'Led collaboration resolving conflict', result: 'Improved team alignment' });
  const id = story.storyId || story.id || story.story.id;
  c.decide(id, 'story.retire');
  const prep = d.interviewPrep(c.dir, { profileId: c.profileId });
  assert.ok(c.state().interviewStories[id]);
  assert.ok(!JSON.stringify(prep).includes(id), 'retired story offered for preparation');
});
test('R8 archived artifacts remain stored but disappear from approval handoffs', async t => {
  const c = context(t); const jobId = c.job();
  const draft = await d.tailorResume(c.dir, { profileId: c.profileId, jobId });
  d.archiveJob(c.dir, { profileId: c.profileId, jobId });
  assert.ok(c.state().artifacts[draft.artifactId].retiredAt);
  assert.ok(!listDecisionHandoffs(c.dir, { profileId: c.profileId }).items.some(x => x.id === draft.artifactId));
});
test('R9 stale handoff rejects without changing canonical bytes', t => {
  const c = context(t); const before = c.bytes();
  assert.throws(() => createDecisionHandoff(c.dir, { profileId: c.profileId, expectedRevision: c.state().revision - 1, note: 'stale' }), /revision|conflict|stale/i);
  assert.equal(c.bytes(), before);
});
test('R10 handoff note survives canonical persistence and history readback', t => {
  const c = context(t); const note = 'Review only synthetic evidence; preserve this context.';
  const r = createDecisionHandoff(c.dir, { profileId: c.profileId, note, expectedRevision: c.state().revision });
  assert.equal(c.state().decisionHandoffs[r.handoffId].note, note);
  assert.ok(JSON.stringify(listDecisionHandoffs(c.dir, { profileId: c.profileId }).history).includes(note));
});
for (const field of ['version', 'schemaVersion']) test(`R11 future ${field} rejected without rewriting store`, t => {
  const c = context(t); const future = { ...c.state(), [field]: 999, futurePayload: { preserve: true } };
  fs.writeFileSync(path.join(c.dir, 'store.json'), JSON.stringify(future)); const before = c.bytes();
  assert.throws(() => d.start(c.dir), /schema|version|future|unsupported/i);
  assert.equal(c.bytes(), before);
});
test('R12 doctor reports corrupt JSON without altering it', t => {
  const c = context(t); fs.writeFileSync(path.join(c.dir, 'store.json'), '{broken');
  const result = d.doctor(c.dir); assert.equal(result.ok, false); assert.notEqual(result.status, 'ok');
  assert.equal(c.bytes(), '{broken');
});
for (const name of ['constructor', 'toString']) test(`R13 MCP rejects unadvertised inherited tool ${name}`, async t => {
  const c = context(t); const before = c.bytes(); const [r] = await wire(c.dir, [call(name, {})]);
  assert.ok(r.error || r.result?.isError, 'unadvertised tool succeeded'); assert.equal(c.bytes(), before);
});
for (const args of [{ name: ['Invalid'], preferences: 'bad' }, { name: 'Invalid', preferences: 'bad' }, { name: 42 }]) test(`R14 MCP schema rejects ${JSON.stringify(args)} before mutation`, async t => {
  const c = context(t); const before = c.bytes(); const [r] = await wire(c.dir, [call('create_profile', args)]);
  assert.ok(r.error || r.result?.isError, 'invalid schema accepted'); assert.equal(c.bytes(), before);
});
test('R15 MCP sends no responses to notifications including tool notifications', async t => {
  const c = context(t);
  const frames = await wire(c.dir, [{ method: 'notifications/cancelled', params: { requestId: 9, reason: 'done' } }, { method: 'notifications/unknown' }, { method: 'tools/list' }, { method: 'tools/call', params: { name: 'doctor', arguments: {} } }, { id: 5, method: 'ping' }]);
  assert.equal(frames.length, 1); assert.equal(frames[0].id, 5);
});
test('R16 MCP domain execution failure is a model-visible tool error', async t => {
  const c = context(t); const [r] = await wire(c.dir, [call('list_jobs', { profileId: 'missing-profile' })]);
  assert.equal(r.error, undefined); assert.equal(r.result?.isError, true);
  assert.match(JSON.stringify(r.result.content), /unknown_profile|profile/i);
});
test('R18 installation guidance explicitly distinguishes source Node prerequisite', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /source[\s\S]{0,700}Node\s*(?:v)?22/i, 'source installation must explicitly document Node 22+ prerequisite');
});
test('R19 compatibility guidance cannot claim every client loaded the skill from registration', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const guidance = fs.readFileSync(path.join(root, 'skills/jobsss/references/client-compatibility.md'), 'utf8');
  assert.doesNotMatch(readme, /Pi\/OMP, Codex, Hermes, and Claude load the same canonical\s+skill/i);
  assert.doesNotMatch(guidance, /every client loads this same\s+canonical skill/i);
});
test('R17 MCP ping succeeds with empty result', async t => {
  const c = context(t); const [r] = await wire(c.dir, [{ id: 1, method: 'ping' }]);
  assert.equal(r.error, undefined); assert.deepEqual(r.result, {});
});
