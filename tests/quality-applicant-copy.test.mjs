import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isolate, mcp, initializeRequest, callRequest, parseToolValue,
} from './helpers/jobsss-live-mcp.mjs';

function pick(frames, id) {
  const value = parseToolValue(frames.find(frame => frame.id === id));
  assert.ok(value && !value.error, `MCP id ${id} failed: ${JSON.stringify(value?.error || value)?.slice(0, 400)}`);
  return value;
}
function jobIdOf(value) { return value.jobId || value.id || value.job?.id; }
function resumeBody(value) { return value.artifact?.content || value.document?.content || ''; }
function letterBody(value) { return value.artifact?.content || value.document?.content || ''; }

const RESUME = `Riley Nash
riley@example.com | Denver, Colorado, United States
EXPERIENCE
2020-01 through 2021-12 | Analyst | Old Mill Co | hybrid
Built 10 SQL reports for weekly operations.
2022-01 through 2025-12 | Analytics Engineer | North Pine | remote US
Implemented dbt models in Snowflake.
SKILLS
Production: SQL, dbt, Snowflake.
EDUCATION
BS in Computing, Elm College, completed May 2019.
`;

async function importAndTailor(t, label, posting) {
  const ctx = isolate(t, label);
  const first = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Riley Nash', resumeText: RESUME, preferences: { targetRoleFamilies: ['Analytics Engineer'] } }),
    callRequest(4, 'import_job', { profileId: 'riley-nash', text: posting }),
  ], { timeoutMs: 20_000 });
  const job = pick(first.frames, 4);
  const jobId = jobIdOf(job);
  const second = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'tailor_resume', { profileId: 'riley-nash', jobId, format: 'markdown' }),
    callRequest(3, 'draft_cover_letter', { profileId: 'riley-nash', jobId, format: 'markdown' }),
    callRequest(4, 'list_jobs', { profileId: 'riley-nash' }),
  ], { timeoutMs: 20_000 });
  return {
    job: pick(first.frames, 4),
    listed: pick(second.frames, 4).jobs?.[0] || pick(second.frames, 4).items?.[0],
    resume: resumeBody(pick(second.frames, 2)),
    letter: letterBody(pick(second.frames, 3)),
  };
}

test('import_job heading em-dash yields title and company, not Company: prose', { timeout: 60_000 }, async t => {
  const run = await importAndTailor(t, 'heading-emdash', `## J03 — Analytics Engineer — Lattice Orchard Software
Company: fictional US B2B subscription workflow software business; its fictional Billing Insights team supports product and finance.
Location: remote US
Required: SQL.
`);
  assert.equal(run.listed?.title || run.job.title, 'Analytics Engineer');
  assert.equal(run.listed?.company || run.job.company, 'Lattice Orchard Software');
  assert.match(run.resume, /Analytics Engineer/);
  assert.match(run.resume, /Lattice Orchard Software/);
  assert.doesNotMatch(run.resume, /Imported role|fictional US B2B/);
  assert.match(run.letter, /Analytics Engineer/);
  assert.match(run.letter, /Lattice Orchard Software/);
  assert.doesNotMatch(run.letter, /Imported role|fictional US B2B/);
});

test('import_job Title:/Company: labels and Title at Company headings', { timeout: 60_000 }, async t => {
  const labeled = await importAndTailor(t, 'labeled-fields', `Title: Platform Analyst
Company: Cedar Harbor
Location: remote US
Required: SQL.
`);
  assert.equal(labeled.listed?.title || labeled.job.title, 'Platform Analyst');
  assert.equal(labeled.listed?.company || labeled.job.company, 'Cedar Harbor');
  assert.match(labeled.resume, /Platform Analyst/);
  assert.match(labeled.resume, /Cedar Harbor/);

  const at = await importAndTailor(t, 'at-heading', `# Staff Data Analyst at Willow Bench Co-op
Location: remote US
Required: SQL.
`);
  assert.equal(at.listed?.title || at.job.title, 'Staff Data Analyst');
  assert.equal(at.listed?.company || at.job.company, 'Willow Bench Co-op');
});

test('descriptive Company: without a named heading stays unknown, not a confident wrong employer', { timeout: 40_000 }, async t => {
  const run = await importAndTailor(t, 'unknown-company', `Title: Analytics Engineer
Company: fictional US B2B subscription workflow software business; its fictional Billing Insights team supports product and finance.
Location: remote US
Required: SQL.
`);
  assert.equal(run.listed?.title || run.job.title, 'Analytics Engineer');
  assert.equal(run.listed?.company || run.job.company, 'Unknown company');
  assert.doesNotMatch(run.resume, /fictional US B2B subscription/);
  assert.doesNotMatch(run.letter, /fictional US B2B subscription/);
});

test('ordinary resume copy is latest-first and drops collaborative-not-management notes', { timeout: 40_000 }, async t => {
  const ctx = isolate(t, 'chrono-notes');
  const resume = `${RESUME}Collaborative delivery, not management of those colleagues.\n`;
  const first = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Riley Nash', resumeText: resume, preferences: { targetRoleFamilies: ['Analytics Engineer'] } }),
    callRequest(4, 'import_job', { profileId: 'riley-nash', text: 'Title: Analytics Engineer\nCompany: North Pine\nRequired: SQL, dbt.\n' }),
  ], { timeoutMs: 20_000 });
  const jobId = jobIdOf(pick(first.frames, 4));
  const second = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'tailor_resume', { profileId: 'riley-nash', jobId, format: 'markdown' }),
  ], { timeoutMs: 20_000 });
  const body = resumeBody(pick(second.frames, 2));
  assert.ok(body.indexOf('2022-01') < body.indexOf('2020-01'), body);
  assert.match(body, /North Pine/);
  assert.doesNotMatch(body, /Collaborative delivery|not management of those colleagues/i);
});
