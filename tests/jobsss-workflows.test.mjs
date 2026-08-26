import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectSkillCorpus, pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  BLOCKED_MCP_TOOLS,
  REQUIRED_EXTENDED_TOOLS,
  UNSUPPORTED_MCP_TOOLS,
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
  readStore,
  rejectionBlob,
  requireOk,
  requireToolListed,
  resumeFixture
} from './helpers/jobsss-live-mcp.mjs';

test('B21 materials are proof-grounded and persist across restart', async t => {
  const ctx = isolate(t, 'jobsss-b21-mat');
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Materials Profile', resumePath, path: resumePath })
  ]);
  const listedTools = setup.frames.find(frame => frame.id === 2)?.result?.tools || [];
  const names = listedTools.map(tool => tool.name);
  requireToolListed(names, 'tailor_resume');
  requireToolListed(names, 'draft_cover_letter');
  requireToolListed(names, 'save_answer');
  const saveAnswerTool = listedTools.find(tool => tool.name === 'save_answer');
  const saveRequired = saveAnswerTool?.inputSchema?.required || [];
  assert.ok(saveRequired.includes('profileId'), 'save_answer schema must require profileId');
  assert.ok(saveRequired.includes('question'), 'save_answer schema must require question');
  assert.ok(saveRequired.includes('proofPointIds'), 'save_answer schema must require owned proofPointIds');
  assert.equal(
    saveRequired.includes('answer'),
    false,
    'save_answer must allow omitting answer so the runtime can generate from selected proof summaries'
  );
  requireOk(setup, 3, 'start');
  const created = requireOk(setup, 4, 'create_profile');
  const profileId = pickId(created, ['profileId', 'id']);
  const proofIds = (created.proofPoints || []).map(proof => proof.id).filter(Boolean);
  const thirtyProof = (created.proofPoints || []).find(proof =>
    String(proof.summary || '').includes('30%') || (proof.metrics || []).some(metric => String(metric).includes('30'))
  );
  assert.ok(thirtyProof?.id && thirtyProof.summary, `fixture resume must extract the 30% proof: ${JSON.stringify(created.proofPoints).slice(0, 800)}`);
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
  const resumeBlob = JSON.stringify(resume);
  const coverBlob = JSON.stringify(cover);
  assert.match(resumeBlob, /proof/i, `tailor_resume must be proof-grounded: ${resumeBlob.slice(0, 500)}`);
  assert.match(coverBlob, /proof/i, `draft_cover_letter must be proof-grounded: ${coverBlob.slice(0, 500)}`);
  if (proofIds.length) {
    assert.ok(
      proofIds.some(id => resumeBlob.includes(id) || coverBlob.includes(id)),
      `materials must cite a real proof point id: ${JSON.stringify({ proofIds, resume, cover }).slice(0, 800)}`
    );
  }
  assert.doesNotMatch(claimText(resume), /\b(submitted|sent|applied|approved)\b/);
  assert.doesNotMatch(claimText(cover), /\b(submitted|sent|applied|approved)\b/);
  assert.doesNotMatch(resumeBlob + coverBlob, /400%|\$10M|invented metric/i);
  assert.doesNotMatch(
    resumeBlob + coverBlob,
    /verified experience|verified from the stored|verified proof/i,
    'materials must not label unverified stored proof candidates as already verified'
  );
  assert.match(
    resumeBlob + coverBlob,
    /human verification required/i,
    'materials must require human verification of stored proof candidates'
  );

  const fabricated = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_answer', {
      profileId,
      question: 'What is your biggest quantified win?',
      answer: 'I grew revenue by $10M and increased conversion 400%.',
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const fabFrame = fabricated.frames.find(frame => frame.id === 2);
  const fabValue = parseToolValue(fabFrame);
  assert.ok(isRejected(fabFrame, fabValue), `save_answer must reject fabricated metrics linked to an unrelated proof: ${JSON.stringify(fabFrame)}`);
  assert.match(
    rejectionBlob(fabFrame, fabValue),
    /answer_not_grounded/,
    `fabrication rejection must name answer_not_grounded: ${rejectionBlob(fabFrame, fabValue)}`
  );
  const storeAfterFab = readStore(ctx.dataDir);
  const persistedAnswers = Object.values(storeAfterFab.answers || {});
  assert.equal(
    persistedAnswers.some(item => /\$10M|400%/.test(JSON.stringify(item))),
    false,
    `fabricated $10M/400% answer must not persist: ${JSON.stringify(persistedAnswers).slice(0, 800)}`
  );

  const paraphrased = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_answer', {
      profileId,
      question: 'Paraphrase the 30 percent win.',
      answer: 'I roughly cut review work by about a third and also scaled revenue 400%.',
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const paraFrame = paraphrased.frames.find(frame => frame.id === 2);
  const paraValue = parseToolValue(paraFrame);
  assert.ok(isRejected(paraFrame, paraValue), `save_answer must reject paraphrased claims: ${JSON.stringify(paraFrame)}`);
  assert.match(rejectionBlob(paraFrame, paraValue), /answer_not_grounded/);

  const omitted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_answer', {
      profileId,
      question: 'Describe a time you reduced manual review.',
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const omitValue = requireOk(omitted, 2, 'save_answer omitted answer generates from selected proofs');
  assert.match(JSON.stringify(omitValue), new RegExp(thirtyProof.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(omitValue), /400%|\$10M/);

  const exact = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'save_answer', {
      profileId,
      question: 'Give an example of a measurable result.',
      answer: thirtyProof.summary,
      proofPointIds: [thirtyProof.id]
    })
  ]);
  const exactValue = requireOk(exact, 2, 'save_answer exact proof wording');
  assert.match(JSON.stringify(exactValue), new RegExp(thirtyProof.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const restarted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'review_queue', { profileId }),
    callRequest(3, 'list_answers', { profileId })
  ]);
  const queue = requireOk(restarted, 2, 'review_queue after materials');
  assert.match(JSON.stringify(queue), /resume|cover|artifact|draft/i);
  const answers = requireOk(restarted, 3, 'list_answers after restart');
  const answerBlob = JSON.stringify(answers);
  assert.match(answerBlob, /Describe a time you reduced manual review/);
  assert.match(answerBlob, /Give an example of a measurable result/);
  assert.match(answerBlob, new RegExp(thirtyProof.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(answerBlob, /400%|\$10M/);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B22 pipeline, tasks, networking, and interview prep persist across restart', async t => {
  const ctx = isolate(t, 'jobsss-b22-flow');
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const listed = await mcp(ctx, [initializeRequest(1), listToolsRequest(2)]);
  const names = listed.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [];
  for (const tool of REQUIRED_EXTENDED_TOOLS) requireToolListed(names, tool);

  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Workflow Profile', resumePath, path: resumePath })
  ]);
  const profileId = pickId(requireOk(setup, 3, 'create_profile'), ['profileId', 'id']);
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'import_job'), ['jobId', 'id']);

  const acted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'pursue_job', { jobId, profileId }),
    callRequest(3, 'list_tasks', { profileId }),
    callRequest(4, 'import_contact', {
      profileId,
      name: 'Sam Rivera',
      email: 'sam.rivera@example.test',
      company: 'Example Learning Co',
      text: readFileSync(pluginPath('tests/fixtures/contact-card.md'), 'utf8')
    }),
    callRequest(5, 'map_reachable_network', { jobId, profileId }),
    callRequest(6, 'plan_outreach', { jobId, profileId, goal: 'informational' }),
    callRequest(7, 'draft_outreach', { jobId, profileId, goal: 'informational' }),
    callRequest(8, 'draft_interview_story', {
      profileId,
      title: 'Educator discovery',
      situation: 'Educators spent hours on manual review.',
      task: 'Prioritize an AI-assisted workflow.',
      action: 'Led discovery with educators and operations teams.',
      result: 'Reduced manual review time by 30%.'
    }),
    callRequest(9, 'interview_prep', { profileId, jobId, applicationId: jobId }),
    callRequest(10, 'preview_sync', { profileId })
  ], { timeoutMs: 45_000 });

  requireOk(acted, 2, 'pursue_job');
  const tasks = asList(requireOk(acted, 3, 'list_tasks'));
  assert.ok(tasks.length >= 1, `pursue/lifecycle must persist at least one task: ${JSON.stringify(acted.frames.find(frame => frame.id === 3))}`);
  requireOk(acted, 4, 'import_contact inline');
  const network = requireOk(acted, 5, 'map_reachable_network');
  requireOk(acted, 6, 'plan_outreach');
  const draft = requireOk(acted, 7, 'draft_outreach');
  assert.doesNotMatch(claimText(draft), /\b(sent|submitted|applied)\b/);
  requireOk(acted, 8, 'draft_interview_story');
  requireOk(acted, 9, 'interview_prep');
  const preview = requireOk(acted, 10, 'preview_sync');
  assert.doesNotMatch(claimText(preview), /sk-[A-Za-z0-9]{8,}/);
  assert.ok(preview.preview || preview.items || preview.export || preview.ok, `preview_sync must return a preview payload: ${JSON.stringify(preview).slice(0, 400)}`);

  const restarted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_tasks', { profileId }),
    callRequest(3, 'list_interview_stories', { profileId }),
    callRequest(4, 'map_reachable_network', { jobId, profileId }),
    callRequest(5, 'applications_plan', { jobId, profileId })
  ]);
  assert.ok(asList(requireOk(restarted, 2, 'list_tasks after restart')).length >= 1, 'tasks must survive restart');
  const stories = asList(requireOk(restarted, 3, 'list_interview_stories after restart'));
  assert.ok(stories.length >= 1, `interview stories must survive restart: ${JSON.stringify(stories)}`);
  requireOk(restarted, 4, 'network after restart');
  const plan = requireOk(restarted, 5, 'applications_plan after restart');
  assert.doesNotMatch(claimText(plan), /\b(submitted|sent|applied)\b/);
  assert.ok(JSON.stringify(network).length > 2, 'network map must return a payload');
  const store = readStore(ctx.dataDir);
  assert.ok(store.profiles?.[profileId] || Object.values(store.profiles || {}).some(profile => profile.id === profileId));
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B23 truthful blocks for send, submit, apply, approval, and unsupported actions', async t => {
  const ctx = isolate(t, 'jobsss-b23-block');
  const resumePath = resumeFixture();
  const jobPath = jobFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Block Profile', resumePath, path: resumePath })
  ]);
  const names = setup.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [];
  const leaked = [...BLOCKED_MCP_TOOLS, ...UNSUPPORTED_MCP_TOOLS].filter(name => names.includes(name));
  assert.deepEqual(leaked, [], `blocked/unsupported tools must not appear on tools/list: ${leaked.join(', ')}`);
  const profileId = pickId(requireOk(setup, 4, 'create_profile'), ['profileId', 'id']);
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const jobId = pickId(requireOk(imported, 2, 'import_job'), ['jobId', 'id']);

  const blockedNames = [
    'mark_outreach_sent',
    'attest_application_submitted',
    'approve_artifact',
    'submit_application_form',
    'apply_job',
    'send_email',
    'send_outreach'
  ];
  const calls = [
    initializeRequest(1),
    ...blockedNames.map((name, index) => callRequest(index + 2, name, { jobId, profileId, artifactId: 'artifact_fake', packetId: 'packet_fake' })),
    callRequest(20, 'update_application_status', { jobId, profileId, applicationId: jobId, status: 'applied' }),
    callRequest(21, 'update_application_status', { jobId, profileId, applicationId: jobId, status: 'submitted' }),
    callRequest(22, 'pursue_job', { jobId, profileId })
  ];
  const session = await mcp(ctx, calls);
  blockedNames.forEach((name, index) => {
    const frame = session.frames.find(item => item.id === index + 2);
    assertBlockedCall(frame, parseToolValue(frame), name);
  });
  requireToolListed(names, 'update_application_status');
  for (const id of [20, 21]) {
    const frame = session.frames.find(item => item.id === id);
    const value = parseToolValue(frame);
    assert.ok(frame?.error || value?.error || value?.ok === false, `update_application_status must not attest ${id}: ${JSON.stringify(frame)}`);
    assert.doesNotMatch(claimText(value), /\b(submitted|applied|approved)\b/);
    assert.match(
      JSON.stringify(frame?.error || value || {}),
      /not available|forbidden|blocked|human-only|cannot attest|unsupported status|invalid status/i
    );
  }
  const pursue = requireOk(session, 22, 'pursue_job');
  assert.doesNotMatch(claimText(pursue), /\b(submitted|sent|applied|approved)\b/);
  assert.match(JSON.stringify(pursue), /human|local|no (?:submission|external)/i);
  const doctor = await mcp(ctx, [initializeRequest(1), callRequest(2, 'doctor', {})]);
  const diagnosis = requireOk(doctor, 2, 'doctor');
  assert.doesNotMatch(JSON.stringify(diagnosis), /install(?:ing)? JobOS|put(?:ting)? `?jobos`? on `?PATH`?/i);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B24 JobOS stays absent from runtime resolution and PATH during extended workflows', async t => {
  const ctx = isolate(t, 'jobsss-b24-nojobos');
  const session = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2),
    callRequest(3, 'doctor', {}),
    callRequest(4, 'start', {}),
    callRequest(5, 'daily_discovery', { profileId: 'missing-profile' }),
    callRequest(6, 'preview_sync', { profileId: 'missing-profile' })
  ]);
  const names = session.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [];
  for (const tool of REQUIRED_EXTENDED_TOOLS) requireToolListed(names, tool);
  const doctor = requireOk(session, 3, 'doctor');
  assert.match(JSON.stringify(doctor), /PLUGIN_DATA|pluginData|dataDir/);
  assert.doesNotMatch(JSON.stringify(doctor), /install(?:ing)? JobOS/);
  assert.equal(session.frames.find(frame => frame.id === 5)?.result || session.frames.find(frame => frame.id === 5)?.error ? true : false, true);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B25 skill routes extended workflows without claiming send, submit, or JobOS', () => {
  const corpus = collectSkillCorpus();
  for (const tool of REQUIRED_EXTENDED_TOOLS) {
    assert.match(corpus, new RegExp(tool), `skill/references must name extended MCP tool ${tool}`);
  }
  assert.ok(corpus.includes('PLUGIN_DATA'));
  assert.ok(corpus.includes('./bin/jobsss'));
  assert.match(
    corpus,
    /without JobOS|JobOS (?:is )?not (?:required|needed|used)|no JobOS/i
  );
  for (const topic of ['send', 'submit', 'approv']) {
    assert.match(
      corpus,
      new RegExp(`${topic}[\\s\\S]{0,180}(handoff|human-only|blocked|not MCP|trusted CLI|trusted TUI)`, 'i'),
      `skill must keep ${topic} as a truthful handoff/block`
    );
  }
  assert.match(corpus, /preview_sync|preview(?:-|\s)?(?:sync|export)/i);
  assert.doesNotMatch(corpus, /Recover by installing JobOS, putting `jobos` on `PATH`/i);
  assert.doesNotMatch(
    corpus,
    /\/jobsss network(?!\w)|\/jobsss interview(?!\w)|\/jobsss schedule(?!\w)/
  );
});
