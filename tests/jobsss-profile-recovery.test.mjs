import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { localScore } from '../src/scoring.js';
import { loadStore } from '../src/store.js';
import { startMcp } from '../src/mcp.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-profile-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const resume = name => '# ' + name + '\nEmail: avery@example.com\nEXPERIENCE\nBuilt product data pipelines reducing processing time by 30%.';

function request(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function wire(dataDir, messages) {
  const input = new PassThrough();
  const frames = [];
  const server = startMcp({ dataDir, input, sendResponse: value => frames.push(value) });
  input.end(messages.map(value => JSON.stringify(value)).join('\n') + '\n');
  await server.completed;
  return frames;
}

function payload(frame) {
  const text = frame?.result?.content?.find(item => item.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

test('resume identity corrections update current readback and audit without making a new revision', t => {
  const data = workspace(t);
  const created = domain.createProfile(data, { name: 'Avery profile', resumeText: resume('Experience') });
  const first = domain.getResume(data, { profileId: created.profileId });
  assert.equal(first.identity.name, 'Experience');
  const corrected = domain.updateProfile(data, {
    profileId: created.profileId,
    resumeIdentity: { name: 'Avery Chen', email: 'avery.chen@example.com' },
  });
  const current = domain.getResume(data, { profileId: created.profileId });
  assert.equal(current.identity.name, 'Avery Chen');
  assert.equal(current.identity.email, 'avery.chen@example.com');
  assert.equal(current.resume.document.identity.name, 'Avery Chen');
  assert.equal(corrected.profile.currentResumeId, created.profile.currentResumeId);
  assert.equal(domain.listResumes(data, { profileId: created.profileId }).count, 1);
  assert.ok(loadStore(data).audit.some(item => item.event === 'resume_identity_corrected'));
});

test('resume reimport after profile rename matches a unique email, while explicit profileId also targets the record', t => {
  const data = workspace(t);
  const created = domain.createProfile(data, { name: 'Avery Chen', resumeText: resume('Wrong Heading') });
  const job = domain.importJob(data, { profileId: created.profileId, text: 'Title: Data Engineer\nCompany: Example Co\nBuild reporting pipelines.' });
  domain.updateProfile(data, { profileId: created.profileId, name: 'Avery C. Chen' });
  const reimported = domain.createProfile(data, { name: 'Avery Chen', resumeText: resume('Different Wrong Heading') });
  assert.equal(reimported.profileId, created.profileId);
  assert.equal(reimported.created, false);
  assert.equal(reimported.matchedBy, 'nameAlias');
  assert.equal(reimported.profile.name, 'Avery C. Chen');
  assert.equal(loadStore(data).jobs[job.jobId].profileId, created.profileId);
  const explicit = domain.createProfile(data, { profileId: created.profileId, resumeText: resume('Another Heading') });
  assert.equal(explicit.profileId, created.profileId);
  assert.equal(explicit.matchedBy, 'profileId');
  assert.equal(Object.keys(loadStore(data).profiles).length, 1);
});

test('same-email new profile names surface a collision without overwriting either profile', t => {
  const data = workspace(t);
  const first = domain.createProfile(data, { name: 'Avery Chen', resumeText: resume('Avery Chen') });
  const second = domain.createProfile(data, { name: 'Avery Resume Copy', resumeText: resume('Avery Chen') });
  assert.notEqual(first.profileId, second.profileId);
  assert.deepEqual(second.identityCollisionProfileIds, [first.profileId]);
  assert.equal(Object.keys(loadStore(data).profiles).length, 2);
});

test('proof extraction excludes claim restrictions and collapses near duplicate themes but retains distinct metrics', t => {
  const data = workspace(t);
  const text = [
    'Avery Chen',
    'EXPERIENCE',
    '- Built a quarterly customer support dashboard used by sales teams.',
    '- Created a quarterly customer support dashboard for sales teams.',
    '- Do not claim AWS expertise or describe it as production experience.',
    '- Not seeking staff or principal positions.',
    '- Saved $1.2M in cloud compute costs by rightsizing 140 database clusters over 6 months.',
    '- Saved $900k in cloud compute costs by rightsizing 140 database clusters over 6 months.',
  ].join('\n');
  const created = domain.createProfile(data, { name: 'Avery Chen', resumeText: text });
  const summaries = created.proofPoints.map(point => point.summary);
  assert.equal(summaries.filter(value => /customer support dashboard/i.test(value)).length, 1);
  assert.equal(summaries.some(value => /do not claim|not seeking/i.test(value)), false);
  assert.equal(summaries.filter(value => /cloud compute costs/i.test(value)).length, 2);
});

test('excludeRoles stays literal and still supplies seniority evidence to scoring', () => {
  const dealbreakers = ['Need remote work'];
  const profile = {
    id: 'candidate',
    name: 'Avery Chen',
    resumeText: 'Avery Chen',
    preferences: { targetRoleFamilies: ['Platform Engineer'], excludeRoles: ['staff', 'principal'], dealbreakers },
  };
  const job = { id: 'role', title: 'Staff Platform Engineer', company: 'Example Co', description: 'Level: staff individual contributor.' };
  const fit = localScore({ profile, job });
  const conflict = fit.constraints.find(item => item.id.includes('seniority'));
  assert.equal(conflict?.preferenceRef?.field, 'preferences.excludeRoles');
  assert.deepEqual(profile.preferences.dealbreakers, ['Need remote work']);
  assert.deepEqual(dealbreakers, ['Need remote work']);
});

test('profile archive is explicit, audited, reversible, revision guarded, and blocks scoring', t => {
  const data = workspace(t);
  const created = domain.createProfile(data, { name: 'Avery Chen', resumeText: resume('Avery Chen') });
  const job = domain.importJob(data, { profileId: created.profileId, text: 'Title: Data Engineer\nCompany: Example Co\nBuild pipelines.' });
  assert.throws(() => domain.archiveProfile(data, { profileId: created.profileId }), { code: 'expected_revision_required' });
  const revision = loadStore(data).revision;
  const archived = domain.archiveProfile(data, { profileId: created.profileId, expectedRevision: revision, reason: 'Imported the wrong resume.' });
  assert.equal(archived.archived, true);
  assert.throws(() => domain.listProfiles(data, { profileId: created.profileId }), { code: 'archived_profile' });
  assert.equal(domain.listProfiles(data, { profileId: created.profileId, includeArchived: true }).archived, true);
  assert.throws(() => domain.scoreJob(data, { profileId: created.profileId, jobId: job.jobId }), { code: 'archived_profile' });
  assert.ok(loadStore(data).audit.some(item => item.event === 'profile_archived' && item.profileId === created.profileId));
  const bytesAfterArchive = fs.readFileSync(path.join(data, 'store.json'), 'utf8');
  assert.throws(() => domain.restoreProfile(data, { profileId: created.profileId, expectedRevision: revision }), { code: 'stale_revision' });
  assert.equal(fs.readFileSync(path.join(data, 'store.json'), 'utf8'), bytesAfterArchive);
  const currentRevision = loadStore(data).revision;
  const restored = domain.restoreProfile(data, { profileId: created.profileId, expectedRevision: currentRevision });
  assert.equal(restored.archived, false);
  assert.equal(domain.listProfiles(data, { profileId: created.profileId }).archived, false);
  assert.ok(loadStore(data).audit.some(item => item.event === 'profile_restored' && item.profileId === created.profileId));
  assert.equal(loadStore(data).jobs[job.jobId].profileId, created.profileId);
});

test('MCP exposes explicit profile targeting, identity correction, and revision-guarded archive tools', async t => {
  const data = workspace(t);
  const [frame] = await wire(data, [request('tools/list')]);
  const tools = frame.result.tools;
  const byName = name => tools.find(item => item.name === name);
  assert.ok(byName('archive_profile'));
  assert.ok(byName('restore_profile'));
  assert.ok(byName('create_profile').inputSchema.properties.profileId);
  assert.ok(byName('create_profile').inputSchema.properties.resumeIdentity);
  assert.ok(byName('update_profile').inputSchema.properties.resumeIdentity);
  assert.deepEqual(byName('archive_profile').inputSchema.required, ['profileId', 'expectedRevision']);
  assert.deepEqual(byName('restore_profile').inputSchema.required, ['profileId', 'expectedRevision']);
});
