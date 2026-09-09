import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from './helpers/jobsss-gate0.mjs';
import {
  isolate, mcp, initializeRequest, callRequest, parseToolValue, assertNoJobosUse,
} from './helpers/jobsss-live-mcp.mjs';

const FIX = rel => path.join(REPO_ROOT, 'tests/fixtures', rel);
const PIPE = readFileSync(FIX('captured-pipe-resume.md'), 'utf8');
const LABELED = readFileSync(FIX('captured-labeled-profile.md'), 'utf8');
const J01 = readFileSync(FIX('captured-j01.md'), 'utf8');
const J03 = readFileSync(FIX('captured-j03.md'), 'utf8');
const J06 = readFileSync(FIX('captured-j06.md'), 'utf8');
const GENERIC = `Jordan Blake
jordan.blake@example.com | Austin, Texas, United States | https://profiles.example.com/jordan
EXPERIENCE
2020-01 through 2022-06 | Analyst | North Wind Co | hybrid
Built 12 SQL reports that cut weekly close from 8 hours to 3 hours in 2021.
2022-07 through 2025-12 | Analytics Engineer | Cedar Harbor | remote US
Implemented incremental dbt models in Snowflake for billing events.
SKILLS
Production: SQL, dbt Core, Snowflake, Python.
EDUCATION
BS in Computing, River College, completed May 2019.
Not seeking staff or principal roles. Five years inclusive experience.
`;

const FIRST_PREFS = JSON.parse(readFileSync(
  FIX('captured-create-prefs-first.json'),
  'utf8'
));
const UPDATE_PREFS = JSON.parse(readFileSync(
  FIX('captured-update-prefs.json'),
  'utf8'
));

function pick(frames, id) {
  const value = parseToolValue(frames.find(frame => frame.id === id));
  assert.ok(value && !value.error, `MCP id ${id} failed: ${JSON.stringify(value?.error || value)?.slice(0, 400)}`);
  return value;
}
function jobIdOf(value) {
  return value.jobId || value.id || value.job?.id;
}
function resumeBody(value) {
  return value.artifact?.content || value.document?.content || '';
}
function letterBody(value) {
  return value.artifact?.content || value.document?.content || '';
}

function assertChronology(body, facts, label) {
  for (const fact of facts) {
    assert.match(body, fact, `${label} missing ${fact}`);
  }
  assert.doesNotMatch(body, /^- EXPERIENCE\s*$/m, `${label} turned EXPERIENCE into a bullet`);
  assert.doesNotMatch(body, /proof verification|pending human-only|not proof of sole causation|Collaborative delivery|not management of those colleagues/i, `${label} leaked internal commentary`);
  assert.ok(body.indexOf('2024-09') < body.indexOf('2021-09'), `${label} must be latest-first`);
}

function assertJobIdentity(body, label) {
  assert.match(body, /Analytics Engineer/, `${label} missing job title`);
  assert.match(body, /Lattice Orchard Software/, `${label} missing company from posting heading`);
  assert.doesNotMatch(body, /Imported role/, `${label} used fallback Imported role`);
  assert.doesNotMatch(body, /fictional US B2B subscription/, `${label} used descriptive Company: paragraph as employer`);
}

async function journey(t, label, resumeText, preferences, { updatePreferences } = {}) {
  const ctx = isolate(t, label);
  const created = [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', { name: 'Avery Chen', resumeText, preferences }),
    callRequest(4, 'import_job', { profileId: 'avery-chen', text: J03 }),
    callRequest(5, 'import_job', { profileId: 'avery-chen', text: J06 }),
    callRequest(6, 'import_job', { profileId: 'avery-chen', text: J01 }),
  ];
  const first = await mcp(ctx, created, { timeoutMs: 40_000 });
  const profile = pick(first.frames, 3);
  const j03 = jobIdOf(pick(first.frames, 4));
  const j06 = jobIdOf(pick(first.frames, 5));
  const j01 = jobIdOf(pick(first.frames, 6));
  assert.ok(j03 && j06 && j01, 'imported job ids');
  if (updatePreferences) {
    const upd = await mcp(ctx, [
      initializeRequest(1),
      callRequest(2, 'update_profile', { profileId: 'avery-chen', preferences: updatePreferences }),
    ], { timeoutMs: 20_000 });
    pick(upd.frames, 2);
  }
  const scored = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'score_job', { profileId: 'avery-chen', jobId: j06 }),
    callRequest(3, 'score_job', { profileId: 'avery-chen', jobId: j01 }),
    callRequest(4, 'score_job', { profileId: 'avery-chen', jobId: j03 }),
    callRequest(5, 'tailor_resume', { profileId: 'avery-chen', jobId: j03, format: 'pdf' }),
  ], { timeoutMs: 60_000 });
  const j06Score = pick(scored.frames, 2);
  const j01Score = pick(scored.frames, 3);
  const j03Score = pick(scored.frames, 4);
  const initial = pick(scored.frames, 5);
  const revisedCall = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'update_profile', {
      profileId: 'avery-chen',
      preferences: { communicationStyle: 'formal and concise', targetRoleFamilies: ['Analytics Engineer'] },
    }),
    callRequest(3, 'tailor_resume', { profileId: 'avery-chen', jobId: j03, format: 'pdf' }),
    callRequest(4, 'draft_cover_letter', { profileId: 'avery-chen', jobId: j03, format: 'pdf' }),
    callRequest(5, 'add_proof_point', {
      profileId: 'avery-chen',
      skills: ['working preferences'],
      summary: 'I seek full-time remote work from Illinois, 09:00–17:00 Central, minimum annual guaranteed base USD 130,000. Candidate-stated preferences, not human-attested.',
    }),
    callRequest(6, 'draft_cover_letter', { profileId: 'avery-chen', jobId: j03, format: 'pdf' }),
  ], { timeoutMs: 40_000 });
  const revised = pick(revisedCall.frames, 3);
  const letter = pick(revisedCall.frames, 4);
  const letterAfterPref = pick(revisedCall.frames, 6);
  const restart = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'get_resume', { profileId: 'avery-chen' }),
    callRequest(3, 'get_score', { profileId: 'avery-chen', jobId: j06 }),
  ], { timeoutMs: 20_000 });
  const readback = pick(restart.frames, 2);
  const scoreReadback = pick(restart.frames, 3);
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
  return {
    ctx, profile, j01, j03, j06, j06Score, j01Score, j03Score, initial, revised, letter, letterAfterPref, readback, scoreReadback,
  };
}

test('captured pipe/bare-heading MCP resume keeps chronology and excludes staff J06', { timeout: 180_000 }, async t => {
  const run = await journey(t, 'captured-pipe', PIPE, FIRST_PREFS, { updatePreferences: UPDATE_PREFS });
  const facts = [/Harbor Ledger/, /2024-09/, /2023-03/, /2021-09/, /Alder Cart/, /Prairie Lake/, /SKILLS/, /EDUCATION/, /Chicago, Illinois/];
  assertChronology(resumeBody(run.initial), facts, 'initial');
  assertChronology(resumeBody(run.revised), facts, 'revised');
  assertJobIdentity(resumeBody(run.initial), 'initial');
  assertJobIdentity(resumeBody(run.revised), 'revised');
  assertJobIdentity(letterBody(run.letter), 'letter');
  const initialPdf = run.initial.artifact?.export?.path || run.initial.document?.path;
  const revisedPdf = run.revised.artifact?.export?.path || run.revised.document?.path;
  const letterPdf = run.letter.artifact?.export?.path || run.letter.document?.path;
  assert.equal(existsSync(initialPdf), true);
  assert.equal(existsSync(revisedPdf), true);
  assert.equal(run.initial.artifact?.export?.pageCount || run.initial.document?.pageCount, 1);
  assert.equal(run.revised.artifact?.export?.pageCount || run.revised.document?.pageCount, 1);
  assert.ok((run.initial.artifact?.export?.bodyFontSize || run.initial.document?.bodyFontSize) >= 10);
  const poppler = process.env.PDFTOTEXT || 'pdftotext';
  const extracted = pdf => execFileSync(poppler, ['-layout', pdf, '-'], { encoding: 'utf8' });
  assert.match(extracted(initialPdf), /Harbor Ledger/);
  assert.match(extracted(revisedPdf), /Harbor Ledger/);
  assert.equal(run.j06Score.eligibility?.status || run.j06Score.score?.eligibility?.status, 'excluded');
  assert.ok((run.j06Score.eligibility || run.j06Score.score?.eligibility).hardFailures?.length >= 1);
  assert.notEqual(run.j01Score.eligibility?.status || run.j01Score.score?.eligibility?.status, 'excluded');
  assert.notEqual(run.j03Score.eligibility?.status || run.j03Score.score?.eligibility?.status, 'excluded');
  assert.doesNotMatch(letterBody(run.letter), /not proof of sole causation|Observed before\/after association/i);
  assert.doesNotMatch(letterBody(run.letter), /I seek full-time remote work|minimum annual guaranteed base/i);
  assert.doesNotMatch(letterBody(run.letterAfterPref), /I seek full-time remote work|minimum annual guaranteed base/i);
  assert.match(letterBody(run.letter), /Dear Hiring Team/);
  assert.equal(run.readback.resumeText.trim(), PIPE.trim());
  assert.equal(run.scoreReadback.eligibility?.status || run.scoreReadback.score?.eligibility?.status, 'excluded');
  const out = path.join(path.dirname(initialPdf), 'captured-test-outputs');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'captured-initial.pdf'), readFileSync(initialPdf));
  writeFileSync(path.join(out, 'captured-revised.pdf'), readFileSync(revisedPdf));
  writeFileSync(path.join(out, 'captured-letter.pdf'), readFileSync(letterPdf));
  writeFileSync(path.join(out, 'captured-initial.txt'), resumeBody(run.initial));
  writeFileSync(path.join(out, 'captured-revised.txt'), resumeBody(run.revised));
  writeFileSync(path.join(out, 'captured-letter.txt'), letterBody(run.letter));
});

test('labeled PROFILE.md MCP control still keeps chronology and excludes J06', { timeout: 180_000 }, async t => {
  const run = await journey(t, 'captured-labeled', LABELED, { targetRoleFamilies: ['Analytics Engineer'] });
  assertChronology(resumeBody(run.initial), [/Harbor Ledger/, /2024-09/, /Prairie Lake/, /Chicago, Illinois/], 'labeled');
  assert.equal(run.j06Score.eligibility?.status || run.j06Score.score?.eligibility?.status, 'excluded');
  assert.doesNotMatch(letterBody(run.letter), /not proof of sole causation/i);
});

test('generic pipe-dated variant and excludeRoles intake keep roles and staff exclusion', { timeout: 120_000 }, async t => {
  const ctx = isolate(t, 'generic-pipe');
  const first = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'start', {}),
    callRequest(3, 'create_profile', {
      name: 'Jordan Blake',
      resumeText: GENERIC,
      preferences: {
        targetRoleFamilies: ['Analytics Engineer'],
        excludeRoles: ['staff', 'principal'],
        minBaseSalary: 120000,
        remoteOnly: true,
      },
    }),
    callRequest(4, 'import_job', { profileId: 'jordan-blake', text: J06.replaceAll('Avery', 'Jordan') }),
    callRequest(5, 'import_job', {
      profileId: 'jordan-blake',
      text: '## JX\nTitle: Analytics Engineer\nCompany: Cedar Harbor\nLocation: remote US including Texas\nLevel: mid-level IC, 3-5 years.\nBase salary: USD 130,000-150,000.\nRequired: SQL, dbt, Snowflake.\n',
    }),
  ], { timeoutMs: 40_000 });
  const created = pick(first.frames, 3);
  assert.ok(created.profile?.preferences?.dealbreakers?.some(item => /staff|principal/i.test(item)),
    `excludeRoles must become a retained dealbreaker, got ${JSON.stringify(created.profile?.preferences)}`);
  assert.equal(created.profile?.preferences?.salary?.min, 120000);
  assert.match(String(created.profile?.preferences?.workModel || ''), /remote/i);
  const j06 = jobIdOf(pick(first.frames, 4));
  const jx = jobIdOf(pick(first.frames, 5));
  const second = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'score_job', { profileId: 'jordan-blake', jobId: j06 }),
    callRequest(3, 'tailor_resume', { profileId: 'jordan-blake', jobId: jx, format: 'pdf' }),
    callRequest(4, 'score_job', { profileId: 'jordan-blake', jobId: jx }),
  ], { timeoutMs: 40_000 });
  const score = pick(second.frames, 2);
  const resume = resumeBody(pick(second.frames, 3));
  assert.match(resume, /Cedar Harbor/);
  assert.match(resume, /2022-07/);
  assert.match(resume, /River College/);
  assert.doesNotMatch(resume, /^- EXPERIENCE/m);
  assert.equal(score.eligibility?.status || score.score?.eligibility?.status, 'excluded');
  assert.notEqual((pick(second.frames, 4).eligibility || pick(second.frames, 4).score?.eligibility)?.status, 'excluded');
});
