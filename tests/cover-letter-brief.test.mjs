import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { loadStore } from '../src/store.js';
import { startMcp } from '../src/mcp.js';

function setup(t, { posting, proof }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-cover-letter-brief-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  domain.start(dataDir);
  const profile = domain.createProfile(dataDir, {
    name: 'Morgan Lee',
    resumeText: 'Name: Morgan Lee\nEmail: morgan@example.com\n2022-01 through 2025-12: Operations analyst.\nBuilt reporting and improved team processes.',
  });
  const proofPoint = domain.addProofPoint(dataDir, { profileId: profile.profileId, summary: proof,
    skills: ['implementation', 'project delivery', 'workflow improvement'] });
  const job = domain.importJob(dataDir, { profileId: profile.profileId, text: posting });
  return { dataDir, profileId: profile.profileId, jobId: job.jobId, proofPointId: proofPoint.proofId };
}

test('cover-letter voice is bounded, explicitly validated, persisted, and cleared only by null', t => {
  const { dataDir, profileId } = setup(t, {
    posting: 'Title: Analyst\nCompany: Northwind\nRequirements\n- Analyze business operations and reporting needs.',
    proof: 'Analyzed business operations and built reporting for weekly planning.',
  });
  const voice = { tone: 'warm and direct', style: 'short paragraphs with specific verbs', samples: [
    { label: 'Email', text: 'I enjoy solving messy operational problems. I usually start by asking what success looks like.' },
  ] };
  domain.updateProfile(dataDir, { profileId, preferences: { coverLetterVoice: voice } });
  domain.start(dataDir);
  assert.deepEqual(loadStore(dataDir).profiles[profileId].preferences.coverLetterVoice, voice);

  const before = fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8');
  for (const invalid of [
    {},
    { tone: 42 },
    { style: 'x'.repeat(121) },
    { samples: [{ text: '' }] },
    { samples: [{ text: 'ok', unsupported: true }] },
    { samples: [{ text: 'one' }, { text: 'two' }, { text: 'three' }, { text: 'four' }] },
    { samples: [{ text: 'x'.repeat(2001) }] },
    { samples: [{ text: 'x'.repeat(2000) }, { text: 'y'.repeat(2000) }, { text: 'z'.repeat(1001) }] },
  ]) assert.throws(() => domain.updateProfile(dataDir, { profileId, preferences: { coverLetterVoice: invalid } }), { code: 'invalid_cover_letter_voice' });
  assert.equal(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'), before);

  domain.updateProfile(dataDir, { profileId, preferences: { coverLetterVoice: null } });
  assert.equal(Object.hasOwn(loadStore(dataDir).profiles[profileId].preferences, 'coverLetterVoice'), false);
});

test('brief is read-only, returns only active owned proof, bounded voice, requirements and recorded employer research', t => {
  const { dataDir, profileId, jobId, proofPointId } = setup(t, {
    posting: 'Title: Implementation Project Manager\nCompany: Northwind Works\nLocation: Remote\nRequirements\n- Coordinate implementation projects and cross-functional delivery.\nPreferred\n- Experience launching internal tools.',
    proof: 'Coordinated implementation projects and cross-functional delivery for an internal tools launch.',
  });
  domain.updateProfile(dataDir, { profileId, preferences: {
    coverLetterVoice: { tone: 'warm', samples: [{ label: 'Intro', text: 'I like to understand the practical problem first.' }] },
    values: ['public service'], missionKeywords: ['accessibility'],
  } });
  domain.recordResearch(dataDir, { profileId, jobId, subjectCompany: 'Northwind Works',
    source: 'company site', findings: ['The team is expanding implementation support.'], notes: 'Local research to verify before use.' });
  domain.addProofPoint(dataDir, { profileId, summary: 'Travel: Willing to travel up to 20%.' });
  domain.addProofPoint(dataDir, { profileId, summary: 'Hybrid: Prefer two days in office.' });
  const before = fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8');
  const brief = domain.inspectCoverLetterBrief(dataDir, { profileId, jobId });
  assert.equal(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'), before);
  assert.equal(brief.readOnly, true);
  assert.deepEqual(brief.requirements.map(item => item.text), [
    'Coordinate implementation projects and cross-functional delivery.',
    'Experience launching internal tools.',
  ]);
  assert.ok(brief.activeProofPoints.some(item => item.proofPointId === proofPointId));
  assert.equal(brief.activeProofPoints.some(item => /^(?:Travel|Hybrid):/i.test(item.summary)), false);
  assert.deepEqual(brief.coverLetterVoice, { tone: 'warm', samples: [{ label: 'Intro', text: 'I like to understand the practical problem first.' }] });
  assert.deepEqual(brief.userAngle.values, ['public service']);
  assert.deepEqual(brief.employerResearch[0].findings, ['The team is expanding implementation support.']);
  assert.equal(brief.suggestedNarrative.strategy, 'project_led');
  assert.ok(brief.suggestedNarrative.proofPointIds.includes(proofPointId));
  assert.ok(brief.suggestedNarrative.supportedJobSignals.some(item => item.sourceLine > 0));
});

test('narrative strategy follows explicit job text and evidence overlap', t => {
  const caseOne = setup(t, {
    posting: 'Title: Customer Operations Analyst\nCompany: Beacon\nRequirements\n- Solve customer workflow problems and improve support response times.',
    proof: 'Solved customer workflow problems and improved support response times across the service team.',
  });
  assert.equal(domain.inspectCoverLetterBrief(caseOne.dataDir, caseOne).suggestedNarrative.strategy, 'problem_led');

  const caseTwo = setup(t, {
    posting: 'Title: Systems Analyst\nCompany: Harbor\nRequirements\n- Transferable experience from adjacent backgrounds is welcome.\n- Analyze systems requirements and document data workflows.',
    proof: 'Analyzed systems requirements and documented data workflows for internal teams.',
  });
  assert.equal(domain.inspectCoverLetterBrief(caseTwo.dataDir, caseTwo).suggestedNarrative.strategy, 'career_bridge');

  const caseThree = setup(t, {
    posting: 'Title: Data Analyst\nCompany: Cedar\nRequirements\n- Create SQL reporting for operational planning.',
    proof: 'Built SQL reporting for operational planning and weekly inventory decisions.',
  });
  assert.equal(domain.inspectCoverLetterBrief(caseThree.dataDir, caseThree).suggestedNarrative.strategy, 'evidence_first');
});

test('brief rejects cross-profile access and is advertised through MCP as read-only', async t => {
  const { dataDir, profileId, jobId } = setup(t, {
    posting: 'Title: Analyst\nCompany: Cedar\nRequirements\n- Analyze reporting needs and improve data workflows.',
    proof: 'Analyzed reporting needs and improved data workflows for customer operations.',
  });
  const other = domain.createProfile(dataDir, { name: 'Taylor Park', resumeText: 'Name: Taylor Park\nEmail: taylor@example.com' });
  const before = fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8');
  assert.throws(() => domain.inspectCoverLetterBrief(dataDir, { profileId: other.profileId, jobId }), { code: 'profile_mismatch' });
  assert.equal(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'), before);

  const requests = new PassThrough();
  const responses = [];
  const server = startMcp({ dataDir, input: requests, sendResponse: value => responses.push(value) });
  requests.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
  await server.completed;
  const listed = responses[0].result.tools.find(item => item.name === 'inspect_cover_letter_brief');
  assert.ok(listed);
  assert.match(listed.description, /read-only/i);
  assert.deepEqual(listed.inputSchema.required, ['jobId', 'profileId']);
});
