import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  asList,
  assertBlockedCall,
  assertNoJobosUse,
  callRequest,
  claimText,
  initializeRequest,
  isolate,
  isRejected,
  jobFixture,
  listToolsRequest,
  mcp,
  parseToolValue,
  pickId,
  readAllProjections,
  readStore,
  requireOk,
  resumeFixture,
  storeRevision
} from './helpers/jobsss-live-mcp.mjs';
import {
  AUTHORITY_FORGERY_TOOLS,
  HANDOFF_MCP_TOOLS,
  TRUSTED_DECISION_ACTIONS,
  assertBinding,
  assertNoAuthorityClaim,
  assertStaleConflict,
  findPending,
  itemId,
  pendingItems,
  runDecide
} from './helpers/jobsss-productization.mjs';

async function seedAuthority(t, label) {
  const ctx = isolate(t, label);
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Authority Profile', resumePath, path: resumePath })
  ]);
  requireOk(setup, 3, 'start');
  const created = requireOk(setup, 4, 'create_profile');
  const profileId = pickId(created, ['profileId', 'id']);
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'import_job'), ['jobId', 'id']);
  const acted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'pursue_job', { jobId, profileId }),
    callRequest(3, 'tailor_resume', { jobId, profileId, format: 'markdown' }),
    callRequest(4, 'draft_cover_letter', { jobId, profileId, format: 'markdown' }),
    callRequest(5, 'import_contact', {
      profileId,
      name: 'Sam Rivera',
      email: 'sam.rivera@example.test',
      company: 'Example Learning Co',
      text: readFileSync(pluginPath('tests/fixtures/contact-card.md'), 'utf8')
    }),
    callRequest(6, 'import_contact', {
      profileId,
      name: 'Alex Chen',
      email: 'alex.chen@example.test',
      company: 'Example Learning Co',
      text: 'Alex Chen\nStaff Recruiter\nalex.chen@example.test'
    }),
    callRequest(7, 'draft_outreach', { jobId, profileId, goal: 'informational' }),
    callRequest(8, 'draft_interview_story', {
      profileId,
      title: 'Educator discovery',
      situation: 'Educators spent hours on manual review.',
      task: 'Prioritize an AI-assisted workflow.',
      action: 'Led discovery with educators and operations teams.',
      result: 'Reduced manual review time by 30%.'
    }),
    callRequest(9, 'draft_interview_story', {
      profileId,
      title: 'Second story',
      situation: 'A second local draft.',
      task: 'Keep a retire candidate.',
      action: 'Wrote a second STAR draft.',
      result: 'Produced an unverified story.'
    }),
    callRequest(10, 'interview_prep', { profileId, jobId, applicationId: jobId })
  ], { timeoutMs: 60_000 });
  requireOk(acted, 2, 'pursue_job');
  requireOk(acted, 3, 'tailor_resume');
  requireOk(acted, 4, 'draft_cover_letter');
  requireOk(acted, 5, 'import_contact Sam');
  requireOk(acted, 6, 'import_contact Alex');
  requireOk(acted, 7, 'draft_outreach');
  requireOk(acted, 8, 'draft_interview_story');
  requireOk(acted, 9, 'second story');
  requireOk(acted, 10, 'interview_prep');
  return { ctx, profileId, jobId, tools: setup.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [] };
}

function listedPending(result) {
  assert.equal(result.code, 0, `./bin/jobsss decide --list must exit 0: ${result.stderr.slice(0, 400) || result.stdout.slice(0, 400)}`);
  assert.ok(result.json, `./bin/jobsss decide --list must print JSON: ${result.stdout.slice(0, 400)}`);
  return pendingItems(result.json);
}

async function decideAction(ctx, action, item, extra = []) {
  const binding = assertBinding(item, action);
  const result = await runDecide(ctx, [
    '--action', action,
    '--id', binding.id,
    '--revision', String(binding.revision),
    '--content-hash', binding.hash,
    ...extra
  ]);
  const blob = JSON.stringify({ code: result.code, json: result.json, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.code, 0, `${action} must exit 0: ${blob.slice(0, 600)}`);
  assert.ok(result.json && result.json.ok !== false && !result.json.error, `${action} must succeed: ${blob.slice(0, 600)}`);
  assertNoAuthorityClaim(result.json, action);
  assert.doesNotMatch(claimText(result.json), /\bjobsss (?:sent|submitted|applied)\b/);
  return result;
}

test('B36 trusted-local CLI is the only surface for enumerated human decisions', { timeout: 90_000 }, async t => {
  const { ctx, tools } = await seedAuthority(t, 'jobsss-b36-decide');
  for (const tool of HANDOFF_MCP_TOOLS) {
    assert.ok(tools.includes(tool), `tools/list missing handoff tool ${tool}`);
  }
  for (const action of TRUSTED_DECISION_ACTIONS) {
    assert.equal(tools.includes(action), false, `${action} must not appear on MCP tools/list`);
  }
  const listed = listedPending(await runDecide(ctx, ['--list']));
  const kinds = [
    [/proof/, 'proof.verify'],
    [/artifact/, 'artifact.approve'],
    [/contact/, 'contact.approve'],
    [/story/, 'story.verify'],
    [/debrief/, 'debrief.record'],
    [/outreach/, 'outreach.sent'],
    [/application/, 'application.observe_status']
  ];
  for (const [kindRe, action] of kinds) {
    const hits = findPending(listed, kindRe);
    assert.ok(hits.length >= 1, `decide --list must include pending ${action} (${kindRe}): ${JSON.stringify(listed).slice(0, 800)}`);
    assertBinding(hits[0], action);
  }

  const proofs = findPending(listed, /proof/);
  const artifacts = findPending(listed, /artifact/);
  const contacts = findPending(listed, /contact/);
  const stories = findPending(listed, /story/);
  const debriefs = findPending(listed, /debrief/);
  const outreach = findPending(listed, /outreach/);
  const applications = findPending(listed, /application/);
  assert.ok(artifacts.length >= 2, 'need resume and cover artifacts for approve/reject');
  assert.ok(contacts.length >= 2, 'need two contacts for approve/suppress');
  assert.ok(stories.length >= 2, 'need two stories for verify/retire');

  await decideAction(ctx, 'proof.verify', proofs[0]);
  await decideAction(ctx, 'artifact.approve', artifacts[0]);
  await decideAction(ctx, 'artifact.reject', artifacts[1], ['--note', 'reject for test']);
  await decideAction(ctx, 'contact.approve', contacts[0]);
  await decideAction(ctx, 'contact.suppress', contacts[1]);
  await decideAction(ctx, 'story.verify', stories[0]);
  await decideAction(ctx, 'story.retire', stories[1]);
  await decideAction(ctx, 'debrief.record', debriefs[0], ['--note', 'human recorded debrief locally']);
  const afterRecord = listedPending(await runDecide(ctx, ['--list']));
  const correctable = findPending(afterRecord, /debrief/)[0] || debriefs[0];
  await decideAction(ctx, 'debrief.correct', correctable, ['--note', 'human corrected debrief locally']);
  await decideAction(ctx, 'outreach.sent', outreach[0], ['--note', 'human sent this message outside JobSSS']);
  const afterSent = listedPending(await runDecide(ctx, ['--list']));
  const outcomeItem = findPending(afterSent, /outreach/)[0] || outreach[0];
  await decideAction(ctx, 'outreach.outcome', outcomeItem, ['--outcome', 'no_reply']);
  await decideAction(ctx, 'application.observe_status', applications[0], ['--status', 'applied', '--note', 'human observed employer portal']);

  const store = readStore(ctx.dataDir);
  const blob = JSON.stringify(store);
  assert.match(blob, /trusted_local|trusted-local|human/i, 'canonical store must record trusted-local human actor');
  assert.doesNotMatch(claimText(store), /\bjobsss (?:sent|submitted|applied)\b/);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B37 trusted decisions bind exact entity id, revision, and content hash', { timeout: 90_000 }, async t => {
  const { ctx } = await seedAuthority(t, 'jobsss-b37-bind');
  const listed = listedPending(await runDecide(ctx, ['--list']));
  const item = findPending(listed, /artifact|proof/)[0];
  assert.ok(item, `decide --list must expose a bindable pending item: ${JSON.stringify(listed).slice(0, 500)}`);
  const binding = assertBinding(item, 'binding');
  const missingHash = await runDecide(ctx, [
    '--action', 'artifact.approve',
    '--id', binding.id,
    '--revision', String(binding.revision)
  ]);
  assert.ok(
    missingHash.code !== 0 || missingHash.json?.ok === false,
    `decide without --content-hash must fail: ${JSON.stringify(missingHash.json || missingHash.stderr)}`
  );
  const missingRevision = await runDecide(ctx, [
    '--action', 'artifact.approve',
    '--id', binding.id,
    '--content-hash', binding.hash
  ]);
  assert.ok(
    missingRevision.code !== 0 || missingRevision.json?.ok === false,
    `decide without --revision must fail: ${JSON.stringify(missingRevision.json || missingRevision.stderr)}`
  );
  const wrongId = await runDecide(ctx, [
    '--action', 'artifact.approve',
    '--id', 'entity_does_not_exist',
    '--revision', String(binding.revision),
    '--content-hash', binding.hash
  ]);
  assert.ok(
    wrongId.code !== 0 || wrongId.json?.ok === false,
    `decide with unknown id must fail: ${JSON.stringify(wrongId.json || wrongId.stderr)}`
  );
  const ok = await runDecide(ctx, [
    '--action', itemKindAction(item),
    '--id', binding.id,
    '--revision', String(binding.revision),
    '--content-hash', binding.hash,
    '--note', 'exact binding'
  ]);
  assert.equal(ok.code, 0, `exact id/revision/content-hash must be accepted: ${JSON.stringify(ok.json || ok.stderr)}`);
  assert.ok(ok.json && ok.json.ok !== false, `exact binding success payload: ${JSON.stringify(ok.json)}`);
});

test('B38 mismatched revision or content hash is a typed stale conflict', { timeout: 90_000 }, async t => {
  const { ctx } = await seedAuthority(t, 'jobsss-b38-stale');
  const listed = listedPending(await runDecide(ctx, ['--list']));
  const item = findPending(listed, /artifact|proof|story/)[0];
  assert.ok(item, 'need a pending item for stale-conflict coverage');
  const binding = assertBinding(item, 'stale');
  const before = storeRevision(readStore(ctx.dataDir));
  const staleRev = await runDecide(ctx, [
    '--action', itemKindAction(item),
    '--id', binding.id,
    '--revision', String(binding.revision + 99),
    '--content-hash', binding.hash
  ]);
  assertStaleConflict(staleRev, 'stale revision');
  const staleHash = await runDecide(ctx, [
    '--action', itemKindAction(item),
    '--id', binding.id,
    '--revision', String(binding.revision),
    '--content-hash', 'a'.repeat(64)
  ]);
  assertStaleConflict(staleHash, 'stale content hash');
  const after = readStore(ctx.dataDir);
  assert.equal(storeRevision(after), before, 'typed stale conflict must not persist a rejected write');
  assert.equal(itemId(findPending(listedPending(await runDecide(ctx, ['--list'])), new RegExp(binding.id))[0] || item), binding.id);
});

test('B39 MCP cannot forge human authority via tools, arguments, labels, or environment', { timeout: 90_000 }, async t => {
  const ctx = isolate(t, 'jobsss-b39-forge', { JOBSSS_AUTHORITY: 'human', JOBSSS_HUMAN_APPROVE: '1', JOBSSS_APPROVE: 'true' });
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Forge Profile', resumePath, path: resumePath, verifyProofs: true, approved: true })
  ]);
  const names = setup.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [];
  for (const tool of HANDOFF_MCP_TOOLS) {
    assert.ok(names.includes(tool), `MCP must expose handoff tool ${tool} without granting authority`);
  }
  const leaked = AUTHORITY_FORGERY_TOOLS.filter(name => names.includes(name));
  assert.deepEqual(leaked, [], `authority tools must not appear on tools/list: ${leaked.join(', ')}`);
  requireOk(setup, 3, 'start');
  const created = requireOk(setup, 4, 'create_profile');
  const profileId = pickId(created, ['profileId', 'id']);
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'import_job'), ['jobId', 'id']);
  const tailored = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'tailor_resume', { jobId, profileId, format: 'markdown', approved: true, humanApproved: true, authority: 'human' }),
    callRequest(3, 'update_application_status', { jobId, profileId, status: 'applied', approved: true, authority: 'human' })
  ], { timeoutMs: 45_000 });
  requireOk(tailored, 2, 'tailor_resume');
  const statusFrame = tailored.frames.find(frame => frame.id === 3);
  assert.ok(isRejected(statusFrame, parseToolValue(statusFrame)), 'MCP must still reject applied even with approval flags');

  const forgeryCalls = [
    initializeRequest(1),
    callRequest(2, 'create_decision_handoff', {
      profileId,
      kind: 'artifact.approve',
      approved: true,
      authority: 'human',
      actor: 'human'
    }),
    callRequest(3, 'list_decision_handoffs', { profileId, approved: true }),
    ...AUTHORITY_FORGERY_TOOLS.map((name, index) => callRequest(index + 10, name, {
      profileId,
      jobId,
      approved: true,
      humanApproved: true,
      authority: 'human',
      artifactId: 'artifact_fake',
      verifyProofs: true
    }))
  ];
  const forged = await mcp(ctx, forgeryCalls);
  const createdHandoff = parseToolValue(forged.frames.find(frame => frame.id === 2));
  assert.ok(createdHandoff && !createdHandoff.error, `create_decision_handoff must exist and succeed as a non-authoritative handoff: ${JSON.stringify(forged.frames.find(frame => frame.id === 2))}`);
  assert.doesNotMatch(claimText(createdHandoff), /\b(verified|approved|sent|submitted)\b/);
  const listedHandoffs = requireOk(forged, 3, 'list_decision_handoffs');
  assert.ok(
    asList(listedHandoffs).length >= 1 || pendingItems(listedHandoffs).length >= 1,
    `list_decision_handoffs must list handoffs: ${JSON.stringify(listedHandoffs).slice(0, 500)}`
  );
  AUTHORITY_FORGERY_TOOLS.forEach((name, index) => {
    const frame = forged.frames.find(item => item.id === index + 10);
    assertBlockedCall(frame, parseToolValue(frame), name);
  });

  const store = readStore(ctx.dataDir);
  const proofs = Object.values(store.proofPoints || {});
  assert.ok(proofs.length >= 1, 'profile import must store proof candidates');
  for (const proof of proofs) {
    const state = JSON.stringify(proof).toLowerCase();
    assert.doesNotMatch(state, /"verified"\s*:\s*true/, `MCP must not mark proof ${proof.id} verified`);
    assert.match(
      state,
      /needs_verification|human_required|unverified|pending/,
      `proof ${proof.id} must remain unverified after MCP forgery flags`
    );
  }
  const artifacts = Object.values(store.artifacts || {});
  for (const artifact of artifacts) {
    assert.doesNotMatch(JSON.stringify(artifact).toLowerCase(), /"status"\s*:\s*"(approved|verified)"/);
  }
  assert.doesNotMatch(JSON.stringify(store.audit || []), /forged|mcp_authority|authority=human/);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B40 trusted-local decisions, audit history, and projections agree after restart', { timeout: 90_000 }, async t => {
  const { ctx, profileId } = await seedAuthority(t, 'jobsss-b40-audit');
  const listed = listedPending(await runDecide(ctx, ['--list']));
  const item = findPending(listed, /proof/)[0] || listed[0];
  assert.ok(item, 'need a pending decision to record audit history');
  const binding = assertBinding(item, 'audit');
  const action = itemKindAction(item);
  await decideAction(ctx, action, item, ['--note', 'audit agreement']);
  const store = readStore(ctx.dataDir);
  const auditText = JSON.stringify(store.audit || store.auditLog || []) + readAllProjections(ctx.dataDir).map(file => file.text).join('\n');
  assert.match(auditText, new RegExp(binding.id), `audit/projections must mention entity ${binding.id}`);
  assert.match(auditText, /trusted_local|trusted-local|human/i, 'audit/projections must record the trusted-local human actor');
  assert.match(auditText, new RegExp(action.replace('.', '\\.')), `audit/projections must record action ${action}`);
  assert.doesNotMatch(auditText.toLowerCase(), /\bjobsss (?:sent|submitted|applied)\b/);
  const restarted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_decision_handoffs', { profileId }),
    callRequest(3, 'review_queue', { profileId })
  ]);
  const handoffs = requireOk(restarted, 2, 'list_decision_handoffs after restart');
  const review = requireOk(restarted, 3, 'review_queue after restart');
  const combined = `${JSON.stringify(handoffs)}\n${JSON.stringify(review)}\n${auditText}`;
  assert.match(combined, new RegExp(binding.id), 'restarted MCP projections/handoffs must agree with the audit entity id');
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

function itemKindAction(item) {
  const blob = `${JSON.stringify(item)} ${item?.kind || ''} ${item?.action || ''}`.toLowerCase();
  if (blob.includes('proof')) return 'proof.verify';
  if (blob.includes('artifact')) return 'artifact.approve';
  if (blob.includes('contact')) return 'contact.approve';
  if (blob.includes('story')) return 'story.verify';
  if (blob.includes('debrief')) return 'debrief.record';
  if (blob.includes('outreach')) return 'outreach.sent';
  if (blob.includes('application')) return 'application.observe_status';
  return 'proof.verify';
}
