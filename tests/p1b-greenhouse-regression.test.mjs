import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  isolate,
  mcp,
  callRequest,
  initializeRequest,
  requireOk,
  pickId,
  parseToolValue,
  projectionFiles,
  resumeFixture,
} from './helpers/jobsss-live-mcp.mjs';

// P1b Greenhouse regression (RED): synthetic fixtures only, Greenhouse-only.
// Covers normalization of a synthetic 15-question `?questions=true` detail,
// degraded import, the required-unanswered gate, and ask-list-driven answers
// coverage. All assertions target behavior that does not exist yet.

const BOARD = 'syntheticacme';
const GH_JOB_ID = '1234567';
const GH_URL = `https://boards.greenhouse.io/${BOARD}/jobs/${GH_JOB_ID}`;
const GH_DETAIL_URL = `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs/${GH_JOB_ID}?questions=true`;

const POSTING_MD = `# Senior Backend Engineer (Synthetic)
Synthetic Acme Inc. — Remote (EU)

Apply: https://boards.greenhouse.io/syntheticacme/jobs/1234567

We are hiring a Senior Backend Engineer for our synthetic postings team.

Responsibilities:
- Build and operate Node.js services.
- Review code and mentor engineers.

Requirements:
- 5+ years of backend experience.
- Strong written communication.
`;

// Synthetic Greenhouse `?questions=true` detail shape, kept inline.
// Raw vendor vernacular (Airbnb-class): attachment uploads arrive as
// question rows — there is NO top-level vendor `documents` key on live
// Greenhouse. documents[] is normalize OUTPUT derived from these rows.
const GREENHOUSE_DETAIL = {
  board: BOARD,
  id: 1234567,
  title: 'Senior Backend Engineer (Synthetic)',
  absolute_url: GH_URL,
  detail_url: GH_DETAIL_URL,
  location: { name: 'Remote (EU)' },
  content: '<p>Synthetic posting body for regression use only.</p>',
  questions: [
    { label: 'First Name', required: true, type: 'input_text', options: [] },
    { label: 'Last Name', required: true, type: 'input_text', options: [] },
    { label: 'Email', required: true, type: 'input_text', options: [] },
    { label: 'Phone', required: true, type: 'input_text', options: [] },
    { label: 'Location (City)', required: true, type: 'input_text', options: [] },
    { label: 'Resume/CV', required: true, type: 'input_file', options: [] },
    { label: 'Cover Letter', required: true, type: 'input_file', options: [] },
    { label: 'Portfolio / Work samples', required: false, type: 'input_file', options: [] },
    { label: 'Additional attachments', required: false, type: 'attachment', options: [] },
    { label: 'Are you legally authorized to work in the EU?', required: true, type: 'single_select', options: ['Yes', 'No'] },
    { label: 'Will you now or in the future require sponsorship?', required: true, type: 'single_select', options: ['Yes', 'No'] },
    { label: 'Years of backend experience', required: true, type: 'single_select', options: ['0-1', '1-3', '3-5', '5+'] },
    { label: 'I agree to the privacy policy', required: true, type: 'boolean', options: [] },
    { label: 'LinkedIn URL', required: false, type: 'input_text', options: [] },
    { label: 'How did you hear about us?', required: false, type: 'single_select', options: ['Referral', 'Job board', 'Other'] },
  ],
};

const REQUIRED_LABELS = GREENHOUSE_DETAIL.questions.filter(q => q.required).map(q => q.label);
// documents[] is normalize OUTPUT derived from the question rows above
// (Resume/CV → resume required, Cover Letter → cover_letter required,
// Portfolio → portfolio, Additional attachments → other).
const REQUIRED_DOCS = ['resume', 'cover_letter'];
const EXPECTED_DOC_KINDS = ['resume', 'cover_letter', 'portfolio', 'other'];

async function setupGreenhouseJob(t, label) {
  const ctx = isolate(t, label);
  // Profile intake uses the frozen resume fixture (same as discovery tests);
  // ad-hoc resume files outside PLUGIN_DATA are rejected with unsafe_intake_path.
  const resumePath = resumeFixture();
  // Posting is staged INSIDE PLUGIN_DATA and carries the Greenhouse URL in its
  // own text, so import never depends on extra MCP args the schema may strip.
  const postingPath = path.join(ctx.dataDir, 'posting.md');
  writeFileSync(postingPath, POSTING_MD);
  // Fixture-backed detail inside PLUGIN_DATA (same trust model as offline
  // board fixtures). Ignored by the current runtime; the future green reads it.
  writeFileSync(
    path.join(ctx.dataDir, 'greenhouse-detail-fixture.json'),
    JSON.stringify(GREENHOUSE_DETAIL, null, 2),
  );
  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'P1b Synthetic Profile', resumePath, path: resumePath }),
  ]);
  requireOk(setup, 2, 'doctor');
  requireOk(setup, 3, 'start');
  const created = requireOk(setup, 4, 'create_profile');
  const profileId = pickId(created, ['profileId', 'id']);
  assert.ok(profileId, `create_profile must return a profile id: ${JSON.stringify(created)}`);
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', {
      profileId,
      path: postingPath,
      filePath: postingPath,
      text: POSTING_MD,
      greenhouseUrl: GH_URL,
      greenhouseDetailUrl: GH_DETAIL_URL,
      greenhouseDetail: GREENHOUSE_DETAIL,
    }),
  ]);
  const firstImport = requireOk(imported, 2, 'import_job');
  const jobId = pickId(firstImport, ['jobId', 'id']);
  assert.ok(jobId, `import_job must return a job id: ${JSON.stringify(firstImport)}`);
  return { ctx, profileId, jobId };
}

function readJobFile(dataDir, jobId, name) {
  const abs = path.join(dataDir, 'jobs', jobId, name);
  assert.equal(existsSync(abs), true, `jobs/${jobId}/${name} must be materialized under PLUGIN_DATA`);
  return readFileSync(abs, 'utf8');
}

test('P1b-1 greenhouse detail normalizes 15 questions + documents and materializes job files', async t => {
  const { ctx, profileId, jobId } = await setupGreenhouseJob(t, 'p1b-greenhouse-detail');
  const pursued = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'pursue_job', { jobId, profileId }),
  ]);
  requireOk(pursued, 2, 'pursue_job');

  // posting.md preserves the posting verbatim.
  const posting = readJobFile(ctx.dataDir, jobId, 'posting.md');
  assert.equal(posting, POSTING_MD, 'jobs/<jobId>/posting.md must preserve the posting verbatim');

  // application.json carries normalized questions/documents + provenance.
  const raw = readJobFile(ctx.dataDir, jobId, 'application.json');
  const app = JSON.parse(raw);
  const questions = app.questions || app.application?.questions || [];
  assert.equal(questions.length, 15, `application.json must carry 15 normalized questions: ${raw.slice(0, 500)}`);
  for (const q of questions) {
    assert.ok(typeof q.label === 'string' && q.label, `question needs a label: ${JSON.stringify(q)}`);
    assert.equal(typeof q.required, 'boolean', `question needs a required flag: ${JSON.stringify(q)}`);
    assert.ok(typeof q.kind === 'string' && q.kind, `question needs a kind: ${JSON.stringify(q)}`);
    assert.ok(Array.isArray(q.options), `question needs an options array: ${JSON.stringify(q)}`);
  }
  const labels = questions.map(q => q.label);
  for (const want of REQUIRED_LABELS) assert.ok(labels.includes(want), `missing required question ${want}`);
  const select = questions.find(q => q.label === 'Years of backend experience');
  assert.deepEqual(select.options, ['0-1', '1-3', '3-5', '5+'], 'select options must be preserved');

  const documents = app.documents || app.application?.documents || [];
  const kinds = new Map(documents.map(d => [d.kind, d.required]));
  for (const want of EXPECTED_DOC_KINDS) {
    assert.ok(kinds.has(want), `documents must include kind ${want}: ${JSON.stringify(documents)}`);
  }
  assert.equal(kinds.get('resume'), true, 'resume must be required');
  assert.equal(kinds.get('cover_letter'), true, 'cover_letter must be required');

  const blob = JSON.stringify(app);
  assert.match(blob, /syntheticacme/, 'application.json must record Greenhouse provenance (board)');
  assert.match(blob, /questions=true/, 'application.json must record the detail URL provenance');
  assert.ok(app.id || app.application?.id, 'application.json must carry an id');
  assert.ok(app.revision ?? app.application?.revision ?? blob.includes('revision'), 'application.json must carry a revision');
  assert.ok(app.hash || app.sourceHash || blob.includes('hash'), 'application.json must carry a hash');

  // Raw detail response preserved verbatim.
  const rawDetail = app.rawDetail || app.detailRaw || app.greenhouseDetail || app.application?.rawDetail;
  assert.ok(rawDetail, `raw detail response must be preserved verbatim: ${raw.slice(0, 500)}`);
  assert.deepEqual(
    rawDetail.questions || rawDetail?.detail?.questions,
    GREENHOUSE_DETAIL.questions,
    'raw questions must be preserved verbatim',
  );

  // questions.md is a human-readable checklist with required flagged.
  const checklist = readJobFile(ctx.dataDir, jobId, 'questions.md');
  for (const want of REQUIRED_LABELS) {
    assert.ok(checklist.includes(want), `questions.md must list required question: ${want}`);
  }
  assert.match(checklist, /required/i, 'questions.md must flag required items');
  for (const want of REQUIRED_DOCS) {
    assert.ok(checklist.toLowerCase().includes(want.replace('_', ' ')) || checklist.toLowerCase().includes(want),
      `questions.md must list required document: ${want}`);
  }
});

test('P1b-2 degraded import: detail fetch failure still imports and records degradation', async t => {
  const ctx = isolate(t, 'p1b-greenhouse-degraded');
  const resumePath = resumeFixture();
  // Posting staged INSIDE PLUGIN_DATA with the Greenhouse URL in its own text.
  const postingPath = path.join(ctx.dataDir, 'posting.md');
  writeFileSync(postingPath, POSTING_MD);
  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'P1b Fixtureless Profile', resumePath, path: resumePath }),
  ]);
  requireOk(setup, 2, 'doctor');
  requireOk(setup, 3, 'start');
  const profileId = pickId(requireOk(setup, 4, 'create_profile'), ['profileId', 'id']);
  assert.ok(profileId, 'create_profile must return a profile id');

  // No detail fixture is staged: the detail fetch must fail, but the import
  // itself must still succeed with degradation explicitly recorded.
  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', {
      profileId,
      path: postingPath,
      filePath: postingPath,
      text: POSTING_MD,
      greenhouseUrl: GH_URL,
      greenhouseDetailUrl: GH_DETAIL_URL,
      greenhouseDetailFixture: 'missing-fixture.json',
    }),
  ]);
  const value = requireOk(imported, 2, 'import_job with failed detail fetch');
  const jobId = pickId(value, ['jobId', 'id']);
  assert.ok(jobId, `degraded import must still return a job id: ${JSON.stringify(value)}`);
  const job = value.job || value;
  const marker = job.detailCoverage || job.questionsStatus || job.detailFetch || job.applicationDetail || value.detailCoverage || value.questionsStatus;
  assert.ok(marker && (marker.status === 'degraded' || marker === 'degraded' || marker.ok === false || marker.failed === true),
    `import must record an explicit detail-degradation marker, not a blob regex: ${JSON.stringify(value).slice(0, 500)}`);

  // Degraded pursue must still materialize jobs/<id>/application.json with
  // today's listing fields plus an explicit degradation marker.
  const pursued = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'pursue_job', { jobId, profileId }),
  ]);
  requireOk(pursued, 2, 'pursue_job on degraded job');
  const appRaw = readJobFile(ctx.dataDir, jobId, 'application.json');
  const app = JSON.parse(appRaw);
  const listing = app.listing || app;
  for (const field of ['title', 'company', 'location', 'compensation', 'workModel', 'url']) {
    assert.ok(listing[field] !== undefined,
      `degraded application.json must carry listing field ${field}: ${appRaw.slice(0, 500)}`);
  }
  assert.ok(listing.title && listing.company,
    `degraded application.json must preserve title/company: ${appRaw.slice(0, 500)}`);
  const blob = JSON.stringify(app);
  assert.match(blob, /degraded/, 'degraded application.json must carry an explicit degradation marker');
});

test('P1b-3 required-unanswered gate blocks decide-ready until asks are answered', async t => {
  const { ctx, profileId, jobId } = await setupGreenhouseJob(t, 'p1b-greenhouse-gate');
  const acted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'pursue_job', { jobId, profileId }),
    callRequest(3, 'review_queue', { profileId, jobId }),
  ]);
  requireOk(acted, 2, 'pursue_job');
  const queue = requireOk(acted, 3, 'review_queue');
  const items = queue.queue || queue.items || queue.artifacts || [];
  const entry = items.find(item => (item.jobId || item.id) === jobId) || items[0];
  assert.ok(entry, `review_queue must include the pursued job: ${JSON.stringify(queue).slice(0, 500)}`);
  const unanswered = entry.unansweredRequired || entry.unanswered_required || queue.unansweredRequired || [];
  assert.ok(unanswered.length >= REQUIRED_LABELS.length + REQUIRED_DOCS.length,
    `unansweredRequired must cover required questions AND documents: ${JSON.stringify(entry).slice(0, 800)}`);
  const needJoined = JSON.stringify(unanswered);
  for (const want of REQUIRED_LABELS) assert.ok(needJoined.includes(want), `unansweredRequired must include: ${want}`);
  for (const want of REQUIRED_DOCS) assert.ok(needJoined.includes(want), `unansweredRequired must include document: ${want}`);
  assert.doesNotMatch(JSON.stringify(entry), /decide-ready|decide_ready|ready_to_decide|decision_ready/,
    'readiness must not be decide-ready while required asks remain unanswered');
});

test('P1b-4 ask list drives match_answers and packet coverage; no prefabricated artifacts', async t => {
  const { ctx, profileId, jobId } = await setupGreenhouseJob(t, 'p1b-greenhouse-answers');
  const acted = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'pursue_job', { jobId, profileId }),
  ]);
  requireOk(acted, 2, 'pursue_job');

  // Nothing may be fabricated before the answers/packet tools run.
  const before = projectionFiles(ctx.dataDir).map(f => f.toLowerCase());
  for (const fake of ['resume.pdf', 'cover-letter.md', 'cover_letter.md', 'answers.md']) {
    assert.ok(!before.some(f => f.endsWith(fake)), `must not prefabricate ${fake} before answers/packet tools run`);
  }

  const matched = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'match_answers', { profileId, jobId }),
  ]);
  const value = requireOk(matched, 2, 'match_answers with jobId');
  const blob = JSON.stringify(value);
  assert.ok(REQUIRED_LABELS.some(label => blob.includes(label)),
    `match_answers must be driven by the real ask list: ${blob.slice(0, 600)}`);
  const gaps = value.gaps || value.coverageGaps || value.coverage?.gaps || value.requirementGaps || [];
  const gapsJoined = JSON.stringify(gaps);
  assert.ok(REQUIRED_LABELS.some(label => gapsJoined.includes(label)) || /gap|unanswered|missing/i.test(blob),
    `match_answers coverage gaps must cite the real ask list: ${blob.slice(0, 600)}`);

  const planned = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'applications_plan', { jobId, profileId }),
  ]);
  const plan = requireOk(planned, 2, 'applications_plan');
  const planBlob = JSON.stringify(plan);
  assert.ok(REQUIRED_DOCS.some(doc => planBlob.toLowerCase().includes(doc)),
    `packet coverage must include required documents: ${planBlob.slice(0, 600)}`);
  assert.ok(REQUIRED_LABELS.some(label => planBlob.includes(label)),
    `packet coverage must cite the real ask list: ${planBlob.slice(0, 600)}`);
  const frame = matched.frames.find(item => item.id === 2);
  assert.ok(!parseToolValue(frame)?.error, 'match_answers with jobId must be accepted, not an ownership/unknown-job error');
});
