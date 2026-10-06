import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as domain from '../src/domain.js';
import { loadStore } from '../src/store.js';
import { normalizeTailoringContext } from '../src/tailoring-context.js';

test('conversation persists, is scoped by profile/job/role, and cannot silently become facts or preferences', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-conversation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  domain.start(dir);
  const profileId = domain.createProfile(dir, { name: 'Sample Applicant', resumeText: '# Sample Applicant\napplicant@example.org\n## Experience\nDelivered onboarding workshops for customer teams.' }).profileId;
  const jobId = domain.importJob(dir, { profileId, text: '# Learning Designer\nCompany: Sample Co\nRequirements: Design onboarding workshops for customer teams.' }).jobId;
  const revision = () => loadStore(dir).revision;
  const args = { profileId, jobId };
  const facts = domain.getResume(dir, { profileId });
  domain.recordTailoringContext(dir, { ...args, expectedRevision: revision(), context: { roleFamily: 'Learning', roleThesis: 'Learning should reduce friction.', companyInterests: ['The mission interests me.'], feedback: 'Use direct sentences.' } });
  assert.equal(Object.keys(loadStore(dir).profiles[profileId].roleNarratives || {}).length, 0);
  assert.throws(() => domain.rememberRoleNarrative(dir, { ...args, expectedRevision: revision() }), { code: 'confirmation_required' });
  const stale = revision();
  domain.rememberRoleNarrative(dir, { ...args, expectedRevision: revision(), confirmedByUser: true, voice: { tone: 'warm' } });
  assert.throws(() => domain.recordTailoringContext(dir, { ...args, expectedRevision: stale, context: { roleFamily: 'Learning' } }));
  const remembered = Object.values(loadStore(dir).profiles[profileId].roleNarratives)[0];
  assert.equal(remembered.companyInterests, undefined);
  assert.equal(remembered.feedback, undefined);
  assert.deepEqual(domain.getResume(dir, { profileId }), facts);
  const second = domain.importJob(dir, { profileId, text: '# Researcher\nCompany: Other Co\nRequirements: Research customer needs.' }).jobId;
  domain.recordTailoringContext(dir, { profileId, jobId: second, expectedRevision: revision(), context: { roleFamily: 'Research' } });
  assert.equal(domain.inspectTailoringBrief(dir, { profileId, jobId: second }).context.roleThesis, '');
  domain.recordTailoringContext(dir, { profileId, jobId: second, expectedRevision: revision(), context: { roleFamily: 'learning' } });
  const brief = domain.inspectTailoringBrief(dir, { profileId, jobId: second });
  assert.equal(brief.context.roleThesis, 'Learning should reduce friction.');
  assert.deepEqual(brief.context.companyInterests, []);
  assert.equal(brief.context.voice.tone, 'warm');
  assert.deepEqual(brief.materials, ['resume']);
  assert.equal(brief.coverLetterDecision.state, 'unknown');
  const beforeProofs = JSON.stringify(loadStore(dir).proofPoints);
  const resumeDraft = domain.tailorResume(dir, { ...args, format: 'markdown' });
  const letterDraft = domain.draftCoverLetter(dir, { requestedByUser: true, ...args, format: 'markdown' });
  for (const draft of [resumeDraft, letterDraft]) {
    assert.equal(draft.artifact.status, 'draft_needs_human_review');
    assert.doesNotMatch(draft.document.content, /Learning should reduce friction|The mission interests me/);
    assert.equal(draft.artifact.conversationContext.roleThesis, 'Learning should reduce friction.');
  }
  assert.equal(JSON.stringify(loadStore(dir).proofPoints), beforeProofs);
  const before = revision(); domain.inspectTailoringBrief(dir, args); assert.equal(revision(), before);
  const other = domain.createProfile(dir, { name: 'Other Applicant', resumeText: '# Other Applicant\nother@example.org\n## Experience\nResearched customer needs.' }).profileId;
  assert.throws(() => domain.inspectTailoringBrief(dir, { profileId: other, jobId }));
});

test('bounded conversation rejects unknown fact fields and excessive interests', () => {
  assert.throws(() => normalizeTailoringContext({ roleFamily: 'Any', achievements: 'Invented' }), { code: 'invalid_tailoring_context' });
  assert.throws(() => normalizeTailoringContext({ roleFamily: 'Any', companyInterests: ['a', 'b', 'c'] }), { code: 'invalid_tailoring_context' });
});

// Exercise the advertised transport as well as the domain methods.
import { isolate, mcp, initializeRequest, listToolsRequest, callRequest, requireOk, readStore } from './helpers/jobsss-live-mcp.mjs';
test('new conversational tools are callable over the real MCP transport', async t => {
  const ctx = isolate(t, 'jobsss-conversation-mcp');
  const setup = await mcp(ctx, [initializeRequest(1), listToolsRequest(2), callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Transport Applicant', resumeText: '# Transport Applicant\ntransport@example.org\n## Experience\nDelivered customer onboarding workshops.' })]);
  const names = setup.frames.find(frame => frame.id === 2).result.tools.map(tool => tool.name);
  for (const name of ['inspect_tailoring_brief', 'record_tailoring_context', 'remember_role_narrative']) assert.ok(names.includes(name));
  const profileId = requireOk(setup, 4, 'create_profile').profileId;
  const imported = await mcp(ctx, [initializeRequest(1), callRequest(2, 'import_job', { profileId, text: '# Customer Educator\nCompany: Transport Co\nRequirements: Deliver customer onboarding workshops.' })]);
  const jobId = requireOk(imported, 2, 'import_job').jobId;
  const saved = await mcp(ctx, [initializeRequest(1), callRequest(2, 'record_tailoring_context', { profileId, jobId, expectedRevision: readStore(ctx.dataDir).revision, context: { roleFamily: 'Education', roleThesis: 'Education should be practical.' } }), callRequest(3, 'inspect_tailoring_brief', { profileId, jobId })]);
  requireOk(saved, 2, 'record_tailoring_context');
  assert.equal(requireOk(saved, 3, 'inspect_tailoring_brief').context.roleThesis, 'Education should be practical.');
});
