// Independent closure acceptance, frozen before implementation. Do not edit in correction rounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import * as d from '../src/domain.js';
import { listDecisionHandoffs } from '../src/authority.js';
import { startMcp } from '../src/mcp.js';
const root = path.resolve(import.meta.dirname, '..');
const A = 'Closure Reviewer\nBuilt Python data pipelines reducing processing time by 30%.';
const B = 'Closure Reviewer\nLed Kubernetes migration reducing infrastructure costs by 40%.';
function context(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-closure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = () => fs.readFileSync(path.join(dir, 'store.json'), 'utf8');
  const state = () => JSON.parse(bytes());
  const profileId = d.createProfile(dir, { name: 'Closure Reviewer', resumeText: A }).profileId;
  const decide = (id, action) => {
    const item = listDecisionHandoffs(dir, { profileId }).items.find(x => x.id === id);
    assert.ok(item, 'setup: real pending trusted binding exists');
    const r = spawnSync(process.execPath, [path.join(root, 'bin/jobsss'), 'decide', '--data', dir, '--action', action, '--id', id, '--revision', String(item.revision), '--content-hash', item.contentHash, '--note', 'Synthetic closure review'], { encoding: 'utf8', env: { PATH: path.dirname(process.execPath), HOME: dir, PLUGIN_DATA: dir } });
    assert.equal(r.status, 0, `setup: trusted CLI: ${r.stderr || r.stdout}`);
  };
  return { dir, profileId, bytes, state, decide };
}
async function wire(dir, messages) {
  const input = new PassThrough(); const frames = [];
  const server = startMcp({ dataDir: dir, input, sendResponse: x => frames.push(x) });
  input.end(messages.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n');
  await server.completed; return frames;
}
const req = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const call = (name, args) => req('tools/call', { name, arguments: args });
const payload = r => JSON.parse(r.result.content[0].text);
function historyRetained(before, after) {
  for (const event of before.audit) assert.ok(after.audit.some(x => JSON.stringify(x) === JSON.stringify(event)), 'audit event retained');
  for (const [id, decision] of Object.entries(before.decisions || {})) assert.deepEqual(after.decisions[id], decision, 'prior decision ledger retained');
}
const manual = profileId => ({ profileId, summary: 'Designed Java compiler reducing latency by 20%.', skills: ['Java'], metrics: ['20%'] });
test('C1 unchanged manual proof retry retains full verified record and decision revision', t => {
  const c = context(t); const args = manual(c.profileId);
  const first = d.addProofPoint(c.dir, args); c.decide(first.proofId, 'proof.verify'); const before = c.state();
  assert.equal(before.proofPoints[first.proofId].status, 'verified', 'setup: verified');
  const retry = d.addProofPoint(c.dir, args); const after = c.state();
  assert.equal(retry.proofId, first.proofId);
  assert.deepEqual(after.proofPoints[first.proofId], before.proofPoints[first.proofId]);
  historyRetained(before, after);
  assert.ok(!listDecisionHandoffs(c.dir, { profileId: c.profileId }).items.some(x => x.id === first.proofId));
});
for (const change of [{ skills: ['Java', 'Performance'] }, { metrics: ['20%', '100 requests'] }, { summary: 'Designed Java compiler reducing latency by 25%.' }]) test(`C2 meaningful manual content change retains old verified snapshot: ${JSON.stringify(change)}`, t => {
  const c = context(t); const args = manual(c.profileId); const first = d.addProofPoint(c.dir, args);
  c.decide(first.proofId, 'proof.verify'); const before = c.state();
  const changed = d.addProofPoint(c.dir, { ...args, ...change }); const after = c.state();
  assert.notEqual(changed.proofId, first.proofId, 'changed content uses distinct immutable proof identity');
  assert.deepEqual(after.proofPoints[first.proofId], before.proofPoints[first.proofId]);
  assert.equal(after.proofPoints[changed.proofId].status, 'needs_verification');
  assert.equal(after.proofPoints[changed.proofId].verifiedAt, undefined);
  historyRetained(before, after);
});
test('C3 unique exact renamed identity reimports in place and preserves ownership', t => {
  const c = context(t); const jobId = d.importJob(c.dir, { profileId: c.profileId, text: 'Title: Engineer\nCompany: Closure Labs\nBuild Python pipelines.' }).jobId;
  d.updateProfile(c.dir, { profileId: c.profileId, name: 'Renamed Closure Reviewer' }); const before = c.state();
  const imported = d.createProfile(c.dir, { name: 'Renamed Closure Reviewer', resumeText: B }); const after = c.state();
  assert.equal(imported.profileId, c.profileId); assert.equal(Object.keys(after.profiles).length, 1);
  assert.deepEqual(after.jobs[jobId], before.jobs[jobId]); historyRetained(before, after);
  for (const id of Object.keys(before.resumes)) assert.ok(after.resumes[id]);
});
test('C4 conflicting rename rejects atomically OR legacy ambiguous exact-name reimport rejects atomically', t => {
  const c = context(t); const second = d.createProfile(c.dir, { name: 'Second Closure Reviewer', resumeText: B }).profileId;
  const before = c.bytes();
  try { d.updateProfile(c.dir, { profileId: second, name: 'Closure Reviewer' }); }
  catch (e) { assert.match(String(e.code || e.message), /ambigu|conflict|duplicate|exist/i); assert.equal(c.bytes(), before); return; }
  const ambiguous = c.bytes();
  assert.throws(() => d.createProfile(c.dir, { name: 'Closure Reviewer', resumeText: B }), /ambigu|conflict|duplicate/i);
  assert.equal(c.bytes(), ambiguous);
});
test('C5 legacy ambiguous profile names cannot silently select the slug owner', t => {
  const c = context(t); const second = d.createProfile(c.dir, { name: 'Second Closure Reviewer', resumeText: B }).profileId;
  // Synthetic legacy state already permitted by baseline update_profile; not a real user store.
  const legacy = c.state(); legacy.profiles[second].name = 'Closure Reviewer';
  fs.writeFileSync(path.join(c.dir, 'store.json'), JSON.stringify(legacy)); const before = c.bytes();
  assert.throws(() => d.createProfile(c.dir, { name: 'Closure Reviewer', resumeText: B }), /ambigu|conflict|duplicate/i);
  assert.equal(c.bytes(), before);
});
test('C6 explicit null arguments reject before start mutation; omission remains valid', async t => {
  const c = context(t); const before = c.bytes(); const [bad] = await wire(c.dir, [call('start', null)]);
  assert.equal(bad.error?.code, -32602); assert.equal(c.bytes(), before);
  const [good] = await wire(c.dir, [req('tools/call', { name: 'start' })]); assert.equal(payload(good).initialized, true);
});
test('C6b omitted arguments remain valid independently of null rejection', async t => {
  const c = context(t); const [r] = await wire(c.dir, [req('tools/call', { name: 'start' })]);
  assert.equal(r.error, undefined); assert.equal(payload(r).initialized, true);
});
test('C9b valid notification-only sequence stays silent and preserves canonical bytes', async t => {
  const c = context(t); const before = c.bytes();
  const frames = await wire(c.dir, [{ jsonrpc: '2.0', method: 'tools/call', params: { name: 'start', arguments: {} } }, { jsonrpc: '2.0', method: 'tools/list' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'unknown' }]);
  assert.deepEqual(frames, []); assert.equal(c.bytes(), before);
});
const malformed = [null, 42, {}, [], { jsonrpc: '1.0', id: 1, method: 'ping' }, { id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: 1, method: 7 }, req('ping', undefined, {}), req('ping', undefined, true), req('ping', null), req('ping', 'bad')];
for (const envelope of malformed) test(`C7 malformed RPC envelope ${JSON.stringify(envelope)}`, async t => {
  const c = context(t); const before = c.bytes(); const frames = await wire(c.dir, [envelope]);
  assert.equal(frames.length, 1, 'invalid request is not a notification');
  assert.equal(frames[0].error?.code, -32600); assert.equal(c.bytes(), before);
});
test('C8 invalid JSON receives parse error', async t => {
  const c = context(t); const before = c.bytes(); const [r] = await wire(c.dir, ['{broken']);
  assert.equal(r.error?.code, -32700); assert.equal(c.bytes(), before);
});
test('C9 valid notifications never reply or mutate; ID-bearing notification names reply', async t => {
  const c = context(t); const before = c.bytes();
  const frames = await wire(c.dir, [{ jsonrpc: '2.0', method: 'tools/call', params: { name: 'start', arguments: {} } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'unknown' }, req('notifications/test', undefined, 9), req('notifications/initialized', undefined, 10), req('ping', undefined, null)]);
  assert.deepEqual(frames.map(x => x.id), [9, 10, null]);
  assert.equal(frames[0].error?.code, -32601); assert.equal(frames[1].error?.code, -32601); assert.deepEqual(frames[2].result, {});
  assert.equal(c.bytes(), before);
});
for (const params of [{ name: 42 }, { name: 'doctor', arguments: [] }, { name: 'doctor', arguments: false }, { name: 'create_profile', arguments: { name: 42 } }, {}, []]) test(`C10 method params reject with -32602: ${JSON.stringify(params)}`, async t => {
  const c = context(t); const before = c.bytes(); const [r] = await wire(c.dir, [req('tools/call', params)]);
  assert.equal(r.error?.code, -32602); assert.equal(c.bytes(), before);
});
test('C11 handoff schema advertises integer expectedRevision', async t => {
  const c = context(t); const [r] = await wire(c.dir, [req('tools/list')]);
  assert.deepEqual(r.result.tools.find(x => x.name === 'create_decision_handoff').inputSchema.properties.expectedRevision, { type: 'integer' });
});
for (const revision of [null, '1', '', true, 1.5]) test(`C12 handoff rejects wrong revision type ${JSON.stringify(revision)} before writes`, async t => {
  const c = context(t); const before = c.bytes(); const [r] = await wire(c.dir, [call('create_decision_handoff', { profileId: c.profileId, expectedRevision: revision })]);
  assert.equal(r.error?.code, -32602); assert.equal(c.bytes(), before);
});
test('C13 stale integer handoff is business failure with byte preservation; current revision succeeds', async t => {
  const c = context(t); const before = c.bytes(); const rev = c.state().revision;
  const [stale] = await wire(c.dir, [call('create_decision_handoff', { profileId: c.profileId, expectedRevision: rev - 1 })]);
  assert.equal(stale.error, undefined); assert.equal(stale.result.isError, true); assert.match(JSON.stringify(payload(stale)), /revision|stale|conflict/i); assert.equal(c.bytes(), before);
  const [good] = await wire(c.dir, [call('create_decision_handoff', { profileId: c.profileId, expectedRevision: rev, note: 'Synthetic current review' })]);
  assert.equal(payload(good).created, true);
});
async function lifecycle(t) {
  const c = context(t); const proofId = c.state().profiles[c.profileId].proofPointIds[0]; assert.ok(proofId, 'setup: extracted proof');
  const summary = c.state().proofPoints[proofId].summary;
  const story = d.draftInterviewStory(c.dir, { profileId: c.profileId, title: summary, situation: summary, task: summary, action: summary, result: summary, proofPointIds: [proofId] });
  const jobId = d.importJob(c.dir, { profileId: c.profileId, text: 'Title: Python Engineer\nCompany: Closure Labs\nRequirements:\n- Build Python data pipelines.' }).jobId;
  const draft = await d.tailorResume(c.dir, { profileId: c.profileId, jobId });
  const prep = d.interviewPrep(c.dir, { profileId: c.profileId, jobId });
  assert.ok(prep.prep.storyIds.includes(story.storyId), 'setup: prep references story');
  assert.ok(c.state().artifacts[draft.artifactId].proofPointIds.includes(proofId), 'setup: draft references proof');
  return { ...c, proofId, storyId: story.storyId, artifactId: draft.artifactId, prepId: prep.prepId, jobId };
}
function freshness(item, status, reference) {
  assert.ok(item, 'readback record remains visible');
  assert.equal(item.freshness?.status, status, 'explicit computed freshness.status');
  assert.ok(Array.isArray(item.freshness.reasons), 'explicit freshness reasons');
  if (status === 'current') assert.deepEqual(item.freshness.reasons, []);
  else { assert.ok(item.freshness.reasons.length); assert.ok(JSON.stringify(item.freshness.reasons).includes(reference), 'reason identifies stale evidence'); }
}
for (const surface of ['prep', 'queue', 'handoff', 'story-handoff']) for (const transition of ['historical', 'retired']) test(`C14 ${surface} exposes current/stale after proof ${transition}, preserving snapshots`, async t => {
  const c = await lifecycle(t);
  const read = () => surface === 'prep' ? d.getInterviewPrep(c.dir, { profileId: c.profileId, jobId: c.jobId }).items.find(x => x.id === c.prepId) : surface === 'queue' ? d.reviewQueue(c.dir, { profileId: c.profileId }).queue.find(x => x.id === c.artifactId || x.artifactId === c.artifactId) : listDecisionHandoffs(c.dir, { profileId: c.profileId }).items.find(x => x.id === (surface === 'story-handoff' ? c.storyId : c.artifactId));
  const current = read(); const before = c.state();
  if (transition === 'historical') d.createProfile(c.dir, { name: 'Closure Reviewer', resumeText: B });
  else {
    // Existing persisted retirement semantics; no public proof-retire command exists.
    // Seed only this disposable synthetic legacy fixture, never claim human authority.
    const retired = c.state(); retired.proofPoints[c.proofId].status = 'retired';
    retired.proofPoints[c.proofId].retiredAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(path.join(c.dir, 'store.json'), JSON.stringify(retired));
  }
  const bytes = c.bytes(); const stale = read();
  assert.equal(c.bytes(), bytes, 'readback never rewrites history');
  assert.deepEqual(c.state().artifacts[c.artifactId], before.artifacts[c.artifactId]);
  assert.deepEqual(c.state().interviewPrep[c.prepId], before.interviewPrep[c.prepId]);
  freshness(stale, 'stale', c.proofId); freshness(current, 'current');
});
test('C15 cached prep marks retired story stale without changing historical preparation', async t => {
  const c = await lifecycle(t); const before = c.state().interviewPrep[c.prepId]; c.decide(c.storyId, 'story.retire'); const bytes = c.bytes();
  const prep = d.getInterviewPrep(c.dir, { profileId: c.profileId, jobId: c.jobId }).items.find(x => x.id === c.prepId);
  freshness(prep, 'stale', c.storyId); assert.deepEqual(c.state().interviewPrep[c.prepId], before); assert.equal(c.bytes(), bytes);
});
