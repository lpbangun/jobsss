import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverLetterDecision } from '../src/cover-letter-policy.js';
import * as domain from '../src/domain.js';
import { prepareApplicationsBatch } from '../src/composition.js';
import { loadStore, commitStore } from '../src/store.js';
import { isolate, mcp, initializeRequest, listToolsRequest, callRequest, requireOk } from './helpers/jobsss-live-mcp.mjs';

const form = documents => ({ applicationDetail: { documents, questions: [] }, detailCoverage: { status: 'ok' } });
for (const [name, job, state, draft] of [
  ['explicit requirement', { description: 'A cover letter is required.' }, 'required', true],
  ['explicit request', { description: 'Please include a cover letter with your resume.' }, 'required', true],
  ['negative requirement', { description: 'A cover letter is not required.' }, 'not_required', false],
  ['negative before noun', { description: 'We do not require a cover letter.' }, 'not_required', false],
  ['not mandatory', { description: 'Cover letters are not mandatory.' }, 'not_required', false],
  ['no letters accepted', { description: 'No cover letters accepted.' }, 'prohibited', false],
  ['inline HTML', { description: 'Please include a cover <b>letter</b>.' }, 'required', true],
  ['optional', { description: 'Cover letters are optional.' }, 'optional', false],
  ['encouraged', { description: 'A cover letter is encouraged.' }, 'optional', false],
  ['prohibited', { description: 'Please do not submit a cover letter.' }, 'prohibited', false],
  ['not accepted', { description: 'Cover letters are not accepted.' }, 'prohibited', false],
  ['required form', form([{ kind: 'cover_letter', required: true }]), 'required', true],
  ['optional form', form([{ kind: 'cover_letter', required: false }]), 'optional', false],
  ['complete resume-only form', form([{ kind: 'resume', required: true }]), 'not_requested', false],
  ['degraded form', { ...form([]), applicationDetail: { documents: [], degraded: true } }, 'unknown', false],
  ['unconfirmed empty form', { applicationDetail: { documents: [] } }, 'unknown', false],
  ['long posting is not a requirement', { description: 'Build reliable software and support product delivery. '.repeat(12) }, 'unknown', false],
  ['posting request without upload field', { ...form([]), description: 'Please send a cover letter.' }, 'required', true],
  ['conflicting evidence', { ...form([{ kind: 'cover_letter', required: true }]), description: 'Cover letter not required.' }, 'conflict', false],
  ['prohibition overrides required upload', { ...form([{ kind: 'cover_letter', required: true }]), description: 'Do not include a cover letter.' }, 'prohibited', false],
  ['HTML posting', { postingText: '<p>Cover-letter optional</p>' }, 'optional', false],
]) {
  test(name, () => {
    const result = coverLetterDecision(job);
    assert.equal(result.state, state);
    assert.equal(result.draft, draft);
    if (state !== 'unknown') assert.ok(result.evidence.length);
    assert.equal(coverLetterDecision(job, false).draft, false);
    assert.equal(coverLetterDecision(job, true).draft, state !== 'prohibited');
  });
}

function setup(t, outputMode = 'full') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-cover-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  domain.start(dir, { outputMode });
  const { profileId } = domain.createProfile(dir, { name: 'Casey Rivera', resumeText: 'Name: Casey Rivera\nEmail: casey@example.com\n2022-01 through 2025-12: Analyst, Cedar Research.\nBuilt SQL reporting tables for weekly inventory analysis.\nSkills: SQL, Python.\nEducation: BS in Information Systems.' });
  return { dir, profileId };
}
const posting = requirement => `Title: Data Analyst\nCompany: Bay Software\nRequired: SQL reporting and Python analysis.\nBuild reporting tables for weekly inventory analysis and collaborate with stakeholders.\n${requirement}`;

test('individual skip persists the reason, adjusts tasks, and preserves existing artifacts across restart', t => {
  const { dir, profileId } = setup(t);
  const { jobId } = domain.importJob(dir, { profileId, text: posting('Cover letter is not required.') });
  const args = { profileId, jobId, format: 'text' };
  const original = domain.draftCoverLetter(dir, { ...args, requestedByUser: true });
  assert.ok(original.artifactId);
  const previous = structuredClone(loadStore(dir).artifacts);
  const store = loadStore(dir);
  store.tasks.legacy = { id: 'legacy', profileId, jobId, status: 'open', text: `Tailor resume and cover letter from stored proof candidates for ${jobId}; human verification is still required.` };
  commitStore(dir, {}, () => store);
  const skipped = domain.draftCoverLetter(dir, args);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.artifactId, null);
  assert.equal(skipped.reason, 'employer_not_required');
  domain.start(dir);
  const after = loadStore(dir);
  assert.deepEqual(after.artifacts, previous);
  assert.equal(after.jobs[jobId].coverLetterDecision.state, 'not_required');
  assert.equal(after.tasks.legacy.status, 'cancelled');
  assert.ok(!Object.values(after.tasks).some(task => task.jobId === jobId && task.status === 'open' && /Tailor.*cover letter/.test(task.text)));
  assert.equal(domain.inspectCoverLetterBrief(dir, args).coverLetterDecision.draft, false);
  assert.deepEqual(domain.inspectTailoringBrief(dir, args).materials, ['resume']);
});

test('prohibition skips even a user request and creates no cover-letter file', t => {
  const { dir, profileId } = setup(t, 'compact');
  const { jobId } = domain.importJob(dir, { profileId, text: posting('Do not submit a cover letter.') });
  const result = domain.draftCoverLetter(dir, { profileId, jobId, requestedByUser: true });
  assert.equal(result.reason, 'employer_prohibits_cover_letter');
  assert.equal(Object.values(loadStore(dir).artifacts).filter(a => a.kind === 'cover_letter_draft').length, 0);
});

test('batch uses the same policy, completes skipped letters, and is repeatable', t => {
  const { dir, profileId } = setup(t);
  const jobIds = ['Cover letter required.', 'Cover letter optional.', 'Do not submit a cover letter.'].map((requirement, index) => domain.importJob(dir, { profileId, text: posting(requirement).replace('Bay Software', `Bay Software ${index}`) }).jobId);
  const args = { profileId, jobIds, class: 'fixture', format: 'markdown' };
  const result = prepareApplicationsBatch(dir, args);
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every(item => ['prepared', 'partial'].includes(item.status)), JSON.stringify(result.items));
  assert.ok(result.items.find(item => item.jobId === jobIds[0]).artifacts.coverLetter.artifactId);
  for (const jobId of jobIds.slice(1)) {
    assert.equal(result.items.find(item => item.jobId === jobId).artifacts.coverLetter.artifactId, null);
    assert.equal(fs.existsSync(path.join(dir, 'applications', jobId, 'cover-letter.md')), false);
    assert.match(fs.readFileSync(path.join(dir, 'applications', jobId, 'application.md'), 'utf8'), /Skipped:.*not a missing draft/);
  }
  const artifactIds = Object.keys(loadStore(dir).artifacts).sort();
  prepareApplicationsBatch(dir, args);
  assert.deepEqual(Object.keys(loadStore(dir).artifacts).sort(), artifactIds);
});

test('skip validates ownership and user-request types', t => {
  const { dir, profileId } = setup(t);
  const { jobId } = domain.importJob(dir, { profileId, text: posting('Cover letter optional.') });
  assert.throws(() => domain.draftCoverLetter(dir, { jobId, profileId: 'someone-else' }));
  assert.throws(() => domain.draftCoverLetter(dir, { jobId, profileId, requestedByUser: 'true' }), { code: 'invalid_cover_letter_request' });
});

test('MCP exposes explicit user intent and enforces the policy across processes', async t => {
  const ctx = isolate(t, 'jobsss-cover-policy-mcp');
  const setup = await mcp(ctx, [initializeRequest(1), listToolsRequest(2), callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Transport Applicant', resumeText: 'Name: Transport Applicant\nEmail: transport@example.org\n2022-01 through 2025-12: Customer Educator, Cedar Research.\nBuilt SQL reporting tables for weekly inventory analysis.\nSkills: SQL, Python.' })]);
  const tool = setup.frames.find(frame => frame.id === 2).result.tools.find(tool => tool.name === 'draft_cover_letter');
  assert.equal(tool.inputSchema.properties.requestedByUser.type, 'boolean');
  const profileId = requireOk(setup, 4, 'create_profile').profileId;
  const imported = await mcp(ctx, [initializeRequest(1), callRequest(2, 'import_job', { profileId, text: '# Customer Educator\nCompany: Transport Co\nRequirements: Deliver customer onboarding workshops.\nCover letter optional.' })]);
  const jobId = requireOk(imported, 2, 'import_job').jobId;
  const result = await mcp(ctx, [initializeRequest(1), callRequest(2, 'draft_cover_letter', { profileId, jobId, format: 'text' }),
    callRequest(3, 'draft_cover_letter', { profileId, jobId, format: 'text', requestedByUser: true })]);
  assert.equal(requireOk(result, 2, 'draft_cover_letter').status, 'skipped');
  assert.ok(requireOk(result, 3, 'draft_cover_letter').artifactId);
});
