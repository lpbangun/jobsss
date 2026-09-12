import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as domain from '../src/domain.js';
import { dedupeKeyForJob, hashText } from '../src/store.js';
import {
  isolate,
  mcp,
  callRequest,
  initializeRequest,
  requireOk,
  pickId,
  readStore,
  resumeFixture,
} from './helpers/jobsss-live-mcp.mjs';

// Greenhouse field promotion regression (RED first): synthetic fixtures only,
// no live network. The prior audit (RC-1) proved that linkGreenhouseDetail
// stores questions/documents/raw detail but never promotes the authoritative
// listing values carried by the Greenhouse per-job payload, so a job imported
// from a generic listing keeps title "Imported role", company "Unknown
// company", an empty location and workModel "unknown" while the payload holds
// the requisition title, company_name, location.name and the Workplace Type
// metadata. These assertions target the promotion behavior that does not exist
// yet; every other stored field must stay exactly as it is.

const BOARD = 'syntheticacme';
const GH_JOB_ID = '8184174';
const GH_URL = `https://boards.greenhouse.io/${BOARD}/jobs/${GH_JOB_ID}`;
const GH_DETAIL_URL = `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs/${GH_JOB_ID}?questions=true`;

// Synthetic generic listing: no Title/Company/Location labels and no Markdown
// heading, so parseJobText yields the machine placeholders only.
const GENERIC_POSTING = `We are hiring for a synthetic postings role.

Apply: ${GH_URL}

Responsibilities:
- Support synthetic hosts in an assigned territory.
`;

// Authored listing: every identity field is explicitly labeled, so nothing may
// be replaced by the detail payload.
const AUTHORED_POSTING = `Title: Senior Account Manager
Company: Authored Hosting Ltd
Location: Lisbon, Portugal
Work model: remote

Apply: ${GH_URL}
`;

// Synthetic Greenhouse ?questions=true detail in the live vendor shape: the
// nested fields/values question rows of the p1b fixtures, a trailing-space
// requisition title, company_name, location.name and a Workplace Type
// metadata row. `Department` is deliberately present to prove metadata rows
// are matched by name and cannot be misread as a work model.
const DETAIL = {
  board: BOARD,
  id: Number(GH_JOB_ID),
  absolute_url: GH_URL,
  title: 'Account Manager ',
  company_name: 'Synthetic Hosting Co',
  location: { name: 'London, United Kingdom' },
  metadata: [
    { id: 9245691, name: 'Is this job part of ACC?', value: false, value_type: 'yes_no' },
    { id: 88110022, name: 'Department', value: 'Remote Sales', value_type: 'single_select' },
    { id: 10216612, name: 'Workplace Type', value: 'Hybrid', value_type: 'single_select' },
  ],
  questions: [
    { label: 'First Name', required: true, fields: [{ type: 'input_text', values: [] }] },
    { label: 'Resume/CV', required: true, fields: [{ type: 'input_file', values: [] }, { type: 'textarea', values: [] }] },
    { label: 'Cover Letter', required: true, fields: [{ type: 'input_file', values: [] }, { type: 'textarea', values: [] }] },
    { label: 'Years of experience', required: false, fields: [{ type: 'select', values: [{ label: '0-1' }, { label: '3-5' }] }] },
  ],
};

function workspace(t, label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function importWithDetail(t, label, { text = GENERIC_POSTING, detail = DETAIL, extra = {} } = {}) {
  const dataDir = workspace(t, label);
  const { profileId } = domain.createProfile(dataDir, { name: `${label} profile` });
  const imported = domain.importJob(dataDir, {
    profileId,
    text,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: detail,
    ...extra,
  });
  return { dataDir, profileId, ...imported };
}

function workplaceDetail(value) {
  return {
    ...DETAIL,
    metadata: [
      { id: 9245691, name: 'Is this job part of ACC?', value: false, value_type: 'yes_no' },
      { id: 10216612, name: 'Workplace Type', value, value_type: 'single_select' },
    ],
  };
}

test('a generic listing takes title/company/location/workModel from the authoritative detail', t => {
  const run = importWithDetail(t, 'gh-promote-generic');
  const job = run.job;

  assert.equal(job.title, 'Account Manager', 'requisition title must replace the generic listing title (presentation whitespace trimmed)');
  assert.equal(job.company, 'Synthetic Hosting Co', 'company_name must replace "Unknown company"');
  assert.equal(job.location, 'London, United Kingdom', 'location.name must fill the empty listing location');
  assert.equal(job.workModel, 'hybrid', 'Workplace Type metadata must fill the "unknown" work model');
});

test('workplace-type metadata maps to canonical work models and nothing else', t => {
  const cases = [
    ['Remote', 'remote'],
    ['Hybrid', 'hybrid'],
    ['On-site', 'onsite'],
    ['In office', 'onsite'],
  ];
  for (const [value, want] of cases) {
    const run = importWithDetail(t, `gh-promote-model-${want}-${value.replace(/\W+/g, '')}`, {
      detail: workplaceDetail(value),
    });
    assert.equal(run.job.workModel, want, `Workplace Type "${value}" must map to ${want}`);
  }

  // A metadata row that is not workplace-shaped must not be read as a work
  // model: only the Department row is offered here.
  const noWorkplace = importWithDetail(t, 'gh-promote-model-none', {
    detail: { ...DETAIL, metadata: [{ id: 88110022, name: 'Department', value: 'Remote Sales', value_type: 'single_select' }] },
  });
  assert.equal(noWorkplace.job.workModel, 'unknown', 'a Department metadata row must not become a work model');
});

test('authored listing fields are never overwritten by the detail payload', t => {
  const run = importWithDetail(t, 'gh-promote-authored', { text: AUTHORED_POSTING });
  const job = run.job;
  const authored = AUTHORED_POSTING.trim();

  assert.equal(job.title, 'Senior Account Manager');
  assert.equal(job.company, 'Authored Hosting Ltd');
  assert.equal(job.location, 'Lisbon, Portugal');
  assert.equal(job.workModel, 'remote');

  // Existing hash/dedupe behavior is preserved verbatim.
  assert.equal(job.sourceHash, hashText(authored));
  assert.equal(job.dedupeKey, dedupeKeyForJob({ title: 'Senior Account Manager', company: 'Authored Hosting Ltd', location: 'Lisbon, Portugal' }));

  // Re-importing the same text still dedupes onto the same job, unchanged.
  const again = domain.importJob(run.dataDir, {
    profileId: run.profileId,
    text: AUTHORED_POSTING,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: DETAIL,
  });
  assert.equal(again.deduped, true, 'the same posting text must still deduplicate');
  assert.equal(again.jobId, job.id);
  assert.equal(again.job.title, 'Senior Account Manager');
  assert.equal(again.job.company, 'Authored Hosting Ltd');
  assert.equal(again.job.location, 'Lisbon, Portugal');
  assert.equal(again.job.workModel, 'remote');
});

test('promotion leaves raw detail, questions, documents and posting text untouched', t => {
  const run = importWithDetail(t, 'gh-promote-preserved');
  const app = run.job.applicationDetail;

  assert.equal(run.job.postingText, GENERIC_POSTING, 'the verbatim posting must be preserved');
  assert.deepEqual(app.rawDetail, DETAIL, 'raw detail must stay verbatim');
  assert.equal(app.hash, hashText(JSON.stringify(DETAIL)), 'the detail hash must stay as-is');
  assert.equal(app.source, 'inline');
  assert.equal(app.board, BOARD);
  assert.equal(app.detailUrl, GH_DETAIL_URL);
  assert.equal(run.job.detailCoverage.status, 'ok');
  assert.equal(run.job.questionsStatus.status, 'ok');
  assert.equal(run.job.questionsStatus.count, DETAIL.questions.length);

  assert.deepEqual(app.questions.map(q => q.label), ['First Name', 'Resume/CV', 'Cover Letter', 'Years of experience']);
  assert.equal(app.questions[0].required, true);
  const select = app.questions.find(q => q.label === 'Years of experience');
  assert.equal(select.kind, 'select');
  assert.deepEqual(select.options, ['0-1', '3-5']);
  const kinds = new Map(app.documents.map(d => [d.kind, d.required]));
  assert.equal(kinds.get('resume'), true);
  assert.equal(kinds.get('cover_letter'), true);
});

test('the vendor id stays in applicationDetail and sourceId is never the vendor id', t => {
  const run = importWithDetail(t, 'gh-promote-identity');
  const job = run.job;

  assert.equal(job.applicationDetail.jobId, GH_JOB_ID, 'the vendor numeric id belongs in applicationDetail.jobId');
  assert.equal(job.applicationDetail.board, BOARD);
  assert.equal(job.applicationDetail.sourceUrl, GH_URL);
  assert.equal(job.url, GH_URL, 'the canonical URL record is unchanged');
  assert.notEqual(job.sourceId, GH_JOB_ID, 'sourceId must never be overwritten with the vendor numeric id');
  assert.ok(job.sourceId === undefined || job.sourceId === GH_URL, `sourceId must stay URL-shaped: ${JSON.stringify(job.sourceId)}`);
});

test('machine page-title listing titles are replaced by the requisition title', t => {
  // The public listing title of a Greenhouse posting is the page <title>:
  // "Job Application for <role> at <company>" (already recognized as a page
  // wrapper by fetchPublicJob) or "<role> - Careers at <company>" as observed
  // in the audit for the live posting. Both are machine copy, never the
  // requisition title, so the authoritative detail title wins.
  const wrapper = importWithDetail(t, 'gh-promote-page-title', {
    text: `# Job Application for Account Manager at Synthetic Hosting\n\nApply: ${GH_URL}\n`,
  });
  assert.equal(wrapper.job.title, 'Account Manager');
  assert.equal(wrapper.job.company, 'Synthetic Hosting', 'a company taken from the listing heading is not generic and must stay');

  const careersPageTitle = importWithDetail(t, 'gh-promote-careers-title', {
    text: `Title: Account Manager - Careers at Synthetic Hosting\n\nApply: ${GH_URL}\n`,
  });
  assert.equal(careersPageTitle.job.title, 'Account Manager');
  assert.equal(careersPageTitle.job.company, 'Synthetic Hosting Co', '"Unknown company" is generic and takes the detail company_name');
  assert.equal(careersPageTitle.job.location, 'London, United Kingdom');
  assert.equal(careersPageTitle.job.workModel, 'hybrid');
});

test('a degraded Greenhouse detail leaves the listing fields and ask list untouched', t => {
  const dataDir = workspace(t, 'gh-promote-degraded');
  const { profileId } = domain.createProfile(dataDir, { name: 'degraded profile' });
  const run = domain.importJob(dataDir, { profileId, text: GENERIC_POSTING, greenhouseUrl: GH_URL });
  const job = run.job;

  assert.equal(job.title, 'Imported role');
  assert.equal(job.company, 'Unknown company');
  assert.equal(job.location, '');
  assert.equal(job.workModel, 'unknown');
  assert.equal(job.detailCoverage.status, 'degraded');
  assert.equal(job.questionsStatus.status, 'degraded');
  assert.equal(job.applicationDetail.degraded, true);
  assert.deepEqual(job.applicationDetail.questions, []);
  assert.deepEqual(job.applicationDetail.documents, []);
  assert.equal(job.applicationDetail.rawDetail, null);
  assert.equal(job.applicationDetail.listing.title, 'Imported role');
  assert.equal(job.applicationDetail.listing.company, 'Unknown company');
});

test('a plain non-Greenhouse import keeps its exact prior shape', t => {
  const dataDir = workspace(t, 'gh-promote-plain');
  const { profileId } = domain.createProfile(dataDir, { name: 'plain profile' });
  const run = domain.importJob(dataDir, { profileId, text: 'Title: Platform Analyst\nCompany: Cedar Harbor\nLocation: remote US\n' });

  assert.equal(run.job.title, 'Platform Analyst');
  assert.equal(run.job.company, 'Cedar Harbor');
  assert.equal(run.job.location, 'remote US');
  assert.equal(run.job.workModel, 'unknown');
  assert.equal('applicationDetail' in run.job, false, 'non-Greenhouse imports must not gain application detail');
});

test('promoted fields survive the bundled MCP import and the store readback', async t => {
  const ctx = isolate(t, 'gh-promote-mcp');
  const resumePath = resumeFixture();
  const setup = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Promotion Profile', resumePath, path: resumePath }),
  ]);
  requireOk(setup, 2, 'doctor');
  requireOk(setup, 3, 'start');
  const profileId = pickId(requireOk(setup, 4, 'create_profile'), ['profileId', 'id']);
  assert.ok(profileId, 'create_profile must return a profile id');

  const imported = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', {
      profileId,
      text: GENERIC_POSTING,
      greenhouseUrl: GH_URL,
      greenhouseDetailUrl: GH_DETAIL_URL,
      greenhouseDetail: DETAIL,
    }),
  ]);
  const value = requireOk(imported, 2, 'import_job');
  const jobId = pickId(value, ['jobId', 'id']);
  assert.ok(jobId, `import_job must return a job id: ${JSON.stringify(value).slice(0, 400)}`);

  const listed = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'list_jobs', { profileId }),
  ]);
  const jobs = requireOk(listed, 2, 'list_jobs').jobs || [];
  const listedJob = jobs.find(job => job.id === jobId);
  assert.ok(listedJob, 'list_jobs must include the imported job');
  assert.equal(listedJob.title, 'Account Manager');
  assert.equal(listedJob.company, 'Synthetic Hosting Co');
  assert.equal(listedJob.location, 'London, United Kingdom');
  assert.equal(listedJob.workModel, 'hybrid');

  const stored = readStore(ctx.dataDir).jobs[jobId];
  assert.equal(stored.title, 'Account Manager');
  assert.equal(stored.company, 'Synthetic Hosting Co');
  assert.equal(stored.location, 'London, United Kingdom');
  assert.equal(stored.workModel, 'hybrid');
  assert.equal(stored.applicationDetail.jobId, GH_JOB_ID);
  assert.deepEqual(stored.applicationDetail.rawDetail, DETAIL);
});
