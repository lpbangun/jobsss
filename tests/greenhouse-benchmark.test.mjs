// Greenhouse field-promotion benchmark — Codevisor SHIP-THIS-GATE
// (session 20260912_000733_e4f020). Ten binary cases: MUST G1, G2, G3, G7, G8 +
// SUPPORTING G4, G5, G6, G9, G10. Synthetic fixtures only, no live network.
// Each case is one binary: every assertion inside it must hold. G1-G3/G5/G8/G9
// drive the same public import surface the regression test uses
// (domain.importJob + an inline synthetic greenhouseDetail), so a case that
// fails is a product finding, not an artifact of the harness.
//
// Reviewer-owned; not a frozen tests/jobsss-*.test.mjs file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as domain from '../src/domain.js';
import { hashText } from '../src/store.js';
import { normalizeGreenhouseDetail, parseJobText } from '../src/discovery.js';

const BOARD = 'benchboard';
const GH_JOB_ID = '4000123456';
const GH_URL = `https://boards.greenhouse.io/${BOARD}/jobs/${GH_JOB_ID}`;
const GH_DETAIL_URL = `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs/${GH_JOB_ID}?questions=true`;

// Generic listing (G1/G5/G7/G9 input shape): no Title/Company/Location/Work
// model labels and no Markdown heading, so parseJobText can only produce the
// machine placeholders (title "Imported role", company "Unknown company",
// location "", workModel "unknown").
const GENERIC_POSTING = `We are hiring for a synthetic benchmark role.

Apply: ${GH_URL}

Responsibilities:
- Support synthetic hosts in an assigned territory.
`;

// Page-title listing (G2, RC-1 trap): fetchPublicJob stores the public page
// <title> as the job title. Emitted as an inline Title label with no Company
// label so parseJobText yields title = the page string and company =
// "Unknown company" (no reading may invent a real company here).
const PAGE_TITLE_POSTING = `Title: Account Manager - Careers at Airbnb

Apply: ${GH_URL}
`;

// Authored listing (G3): every identity field explicitly labeled, so the detail
// payload must never replace a single one of them.
const AUTHORED_POSTING = `Title: Staff Platform Engineer
Company: Northwind Robotics
Location: Lisbon, Portugal
Work model: onsite

Apply: ${GH_URL}
`;

// Partial listing (G4): real authored title, generic company/location/workModel.
const PARTIAL_POSTING = `Title: Account Manager

Apply: ${GH_URL}
`;

// Non-Greenhouse listing (G10): no Greenhouse URL and no Greenhouse inputs, so
// no application detail may ever be attached to it.
const PLAIN_POSTING = `Title: Platform Analyst
Company: Cedar Harbor
Location: remote US
`;

// Synthetic ?questions=true detail in the live vendor shape. `id` is the vendor
// numeric id (G8), `Department` is deliberately present to prove metadata rows
// are matched by name and cannot be misread as a work model.
const DETAIL = {
  board: BOARD,
  id: Number(GH_JOB_ID),
  absolute_url: GH_URL,
  title: 'Account Manager',
  company_name: 'Airbnb',
  location: { name: 'London, United Kingdom' },
  metadata: [
    { id: 9245691, name: 'Is this job part of ACC?', value: false, value_type: 'yes_no' },
    { id: 88110022, name: 'Department', value: 'Remote Sales', value_type: 'single_select' },
    { id: 10216612, name: 'Workplace Type', value: 'Hybrid', value_type: 'single_select' },
  ],
  questions: [
    { label: 'First Name', required: true, fields: [{ type: 'input_text', values: [] }] },
    { label: 'Resume/CV', required: true, fields: [{ type: 'input_file', values: [] }, { type: 'textarea', values: [] }] },
    { label: 'Cover Letter', required: false, fields: [{ type: 'input_file', values: [] }] },
    { label: 'Years of experience', required: false, fields: [{ type: 'select', values: [{ label: '0-1' }, { label: '3-5' }] }] },
  ],
};

function workspace(t, label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Fresh profile in its own temp data dir (isolated dedupe/state). */
function newProfile(t, label, profileName = `${label} profile`) {
  const dataDir = workspace(t, label);
  const { profileId } = domain.createProfile(dataDir, { name: profileName });
  return { dataDir, profileId };
}

function importJob(dataDir, profileId, args) {
  return domain.importJob(dataDir, { profileId, ...args });
}

function genericImport(t, label, extra = {}) {
  const { dataDir, profileId } = newProfile(t, label);
  const run = importJob(dataDir, profileId, {
    text: GENERIC_POSTING,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: DETAIL,
    ...extra,
  });
  return { dataDir, profileId, ...run };
}

// ---------------------------------------------------------------------------
// MUST cases
// ---------------------------------------------------------------------------

test('G1 PROMOTE-FOUR-FROM-EMPTY-GENERIC', t => {
  const parsed = parseJobText(GENERIC_POSTING.trim());
  assert.equal(parsed.title, 'Imported role', 'harness: the generic posting must parse to the placeholder title');
  assert.equal(parsed.company, 'Unknown company', 'harness: the generic posting must parse to the placeholder company');
  assert.equal(parsed.location, '', 'harness: the generic posting must parse to an empty location');
  assert.equal(parsed.workModel, 'unknown', 'harness: the generic posting must parse to workModel "unknown"');

  const run = genericImport(t, 'bench-g1');
  const job = run.job;

  assert.equal(job.title, 'Account Manager', 'the detail requisition title must fill the generic listing title');
  assert.equal(job.company, 'Airbnb', 'detail company_name must fill "Unknown company"');
  assert.equal(job.location, 'London, United Kingdom', 'detail location.name must fill the empty location');
  assert.equal(job.workModel, 'hybrid', 'the "Workplace Type" metadata row must fill the "unknown" work model');

  const questions = job.applicationDetail.questions;
  assert.ok(questions.length >= 1, `the detail must carry >=1 question: ${JSON.stringify(questions)}`);
  const resume = job.applicationDetail.documents.find(doc => doc.kind === 'resume');
  assert.ok(resume, `the file-ish Resume/CV row must become a resume document: ${JSON.stringify(job.applicationDetail.documents)}`);
  assert.equal(resume.required, true, 'the Resume/CV upload must stay required');
});

test('G2 PROMOTE-PAGE-TITLE-GENERIC', t => {
  const parsed = parseJobText(PAGE_TITLE_POSTING.trim());
  assert.equal(parsed.title, 'Account Manager - Careers at Airbnb', 'harness: the listing title must be the public page title');
  assert.equal(parsed.company, 'Unknown company', 'harness: the page-title listing must not invent a real company');

  const { dataDir, profileId } = newProfile(t, 'bench-g2');
  const run = importJob(dataDir, profileId, {
    text: PAGE_TITLE_POSTING,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: DETAIL,
  });
  const job = run.job;

  assert.notEqual(job.title, 'Account Manager - Careers at Airbnb', 'a machine page title must never survive as the listing title');
  assert.equal(job.title, 'Account Manager', 'the requisition title must replace the careers-at page title');
  assert.equal(job.company, 'Airbnb', 'detail company_name must replace "Unknown company"');
  assert.equal(job.location, 'London, United Kingdom', 'detail location.name must fill the empty location');
  assert.equal(job.workModel, 'hybrid', 'the workplace metadata must fill the "unknown" work model');
});

test('G3 PRESERVE-SPECIFIC', t => {
  const parsed = parseJobText(AUTHORED_POSTING.trim());
  assert.equal(parsed.title, 'Staff Platform Engineer', 'harness: the authored title must parse');
  assert.equal(parsed.company, 'Northwind Robotics', 'harness: the authored company must parse');
  assert.equal(parsed.location, 'Lisbon, Portugal', 'harness: the authored location must parse');
  assert.equal(parsed.workModel, 'onsite', 'harness: the authored work model must parse');

  const { dataDir, profileId } = newProfile(t, 'bench-g3');
  const run = importJob(dataDir, profileId, {
    text: AUTHORED_POSTING,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: DETAIL,
  });
  const job = run.job;

  assert.equal(job.title, 'Staff Platform Engineer', 'an authored title must never be replaced by the detail title');
  assert.equal(job.company, 'Northwind Robotics', 'an authored company must never be replaced by detail company_name');
  assert.equal(job.location, 'Lisbon, Portugal', 'an authored location must never be replaced by detail location.name');
  assert.equal(job.workModel, 'onsite', 'an authored work model must never be replaced by the detail workplace metadata');
});

test('G7 DEGRADED-NO-PROMOTE', t => {
  const parsed = parseJobText(GENERIC_POSTING.trim());

  // (a) detail absent entirely, (b) an explicit fixture name that does not exist.
  const variants = [
    { label: 'bench-g7-missing', extra: {} },
    { label: 'bench-g7-absent-fixture', extra: { greenhouseDetailFixture: 'does-not-exist.json' } },
  ];

  for (const variant of variants) {
    const { dataDir, profileId } = newProfile(t, variant.label);
    const run = importJob(dataDir, profileId, {
      text: GENERIC_POSTING,
      greenhouseUrl: GH_URL,
      greenhouseDetailUrl: GH_DETAIL_URL,
      ...variant.extra,
    });
    const job = run.job;
    const where = variant.label;

    assert.equal(job.title, 'Imported role', `${where}: a degraded detail must not change the listing title`);
    assert.equal(job.company, 'Unknown company', `${where}: a degraded detail must not change the listing company`);
    assert.equal(job.location, '', `${where}: a degraded detail must not change the listing location`);
    assert.equal(job.workModel, 'unknown', `${where}: a degraded detail must not change the listing work model`);

    const app = job.applicationDetail;
    assert.equal(app.degraded, true, `${where}: the application detail must be marked degraded`);
    assert.equal(app.status, 'degraded', `${where}: the application detail status must be degraded`);
    assert.deepEqual(app.questions, [], `${where}: a degraded detail carries no questions`);
    assert.deepEqual(app.documents, [], `${where}: a degraded detail carries no documents`);
    assert.equal(app.rawDetail, null, `${where}: a degraded detail carries no raw payload`);
    assert.equal(job.detailCoverage.status, 'degraded', `${where}: detailCoverage must report degraded`);
    assert.equal(job.questionsStatus.status, 'degraded', `${where}: questionsStatus must report degraded`);

    // The listing snapshot is the pre-link identity, byte for byte.
    assert.deepEqual(app.listing, {
      title: parsed.title,
      company: parsed.company,
      location: parsed.location,
      compensation: parsed.compensation,
      workModel: parsed.workModel,
      url: GH_URL,
    }, `${where}: the degraded listing snapshot must equal the pre-link identity`);
    assert.equal(app.listing.title, 'Imported role', `${where}: no detail title may leak into the degraded snapshot`);
    assert.equal(app.listing.company, 'Unknown company', `${where}: no detail company may leak into the degraded snapshot`);
  }
});

test('G8 SOURCEID-URL-VENDOR-JOBID', t => {
  const run = genericImport(t, 'bench-g8');
  const job = run.job;

  assert.equal(job.url, GH_URL, 'the job URL must stay the canonical boards URL');
  assert.equal(String(job.applicationDetail.jobId), GH_JOB_ID, 'applicationDetail.jobId must be the vendor id digits');
  assert.match(String(job.applicationDetail.jobId), /^\d+$/, 'the vendor id must stay digits-only where it is the vendor id');
  assert.match(String(job.applicationDetail.sourceUrl), /^https?:\/\/.+/i, 'applicationDetail.sourceUrl must be a URL');
  assert.equal(job.applicationDetail.sourceUrl, GH_URL, 'the detail source URL must be the boards URL');
  assert.equal(job.applicationDetail.board, BOARD, 'the board token must be preserved in the detail record');

  assert.notEqual(String(job.sourceId ?? ''), GH_JOB_ID, 'sourceId must never be the digits-only vendor id');
  assert.ok(
    job.sourceId === undefined || job.sourceId === GH_URL,
    `sourceId must be unset or the canonical URL: ${JSON.stringify(job.sourceId)}`,
  );
  assert.match(String(job.applicationDetail.detailUrl), /^https?:\/\//, 'the detail URL must stay URL-shaped');
});

// ---------------------------------------------------------------------------
// SUPPORTING cases
// ---------------------------------------------------------------------------

test('G4 PARTIAL-FILL', t => {
  // The detail must offer a DIFFERENT title so the case proves a real authored
  // title survives; the other three keys are generic and must be filled.
  const partialDetail = { ...DETAIL, title: 'Senior Account Manager' };
  const run = (() => {
    const { dataDir, profileId } = newProfile(t, 'bench-g4');
    return importJob(dataDir, profileId, {
      text: PARTIAL_POSTING,
      greenhouseUrl: GH_URL,
      greenhouseDetailUrl: GH_DETAIL_URL,
      greenhouseDetail: partialDetail,
    });
  })();
  const job = run.job;

  assert.equal(parseJobText(PARTIAL_POSTING.trim()).title, 'Account Manager', 'harness: the listing title must be a real authored value');
  assert.equal(job.title, 'Account Manager', 'an authored title must stay even when the detail title differs');
  assert.notEqual(job.title, partialDetail.title, 'harness: the detail title must be a different string than the listing title');
  assert.equal(job.company, 'Airbnb', 'a generic company must be filled from the detail');
  assert.equal(job.location, 'London, United Kingdom', 'a generic location must be filled from the detail');
  assert.equal(job.workModel, 'hybrid', 'a generic work model must be filled from the detail');
});

test('G5 TRIM-PROMOTED-KEEP-RAW', t => {
  const paddedDetail = {
    ...DETAIL,
    title: '   Account Manager   ',
    company_name: '  Airbnb  ',
    location: { name: '   London, United Kingdom   ' },
    metadata: [{ id: 10216612, name: 'Workplace Type', value: '  Hybrid  ', value_type: 'single_select' }],
  };
  const { dataDir, profileId } = newProfile(t, 'bench-g5');
  const run = importJob(dataDir, profileId, {
    text: GENERIC_POSTING,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: paddedDetail,
  });
  const job = run.job;

  assert.equal(job.title, 'Account Manager', 'the promoted title must be trimmed');
  assert.equal(job.company, 'Airbnb', 'the promoted company must be trimmed');
  assert.equal(job.location, 'London, United Kingdom', 'the promoted location must be trimmed');
  assert.equal(job.workModel, 'hybrid', 'the promoted work model must be trimmed and mapped');

  assert.deepEqual(job.applicationDetail.rawDetail, paddedDetail, 'rawDetail must stay byte-identical to the input payload');
  assert.equal(job.applicationDetail.rawDetail.title, '   Account Manager   ', 'rawDetail must keep the padded title');
  assert.equal(job.applicationDetail.rawDetail.company_name, '  Airbnb  ', 'rawDetail must keep the padded company');
  assert.equal(job.applicationDetail.rawDetail.location.name, '   London, United Kingdom   ', 'rawDetail must keep the padded location');
  assert.equal(job.applicationDetail.rawDetail.metadata[0].value, '  Hybrid  ', 'rawDetail must keep the padded metadata value');

  assert.equal(job.postingText, GENERIC_POSTING, 'the verbatim posting text must be preserved');
  assert.ok(job.applicationDetail.questions.length >= 1, 'raw questions must still be stored');
});

test('G6 WORKMODEL-ENUM', t => {
  // Four otherwise-identical generic listings: only the workplace value moves,
  // and every one carries a location name that reads like a work model. A job
  // that falls back to the location text when a workplace field exists would
  // answer "remote" for the On-site / Flexible schedule rows.
  const cases = [
    ['Hybrid', 'hybrid'],
    ['Remote', 'remote'],
    ['On-site', 'onsite'],
    ['Flexible schedule', 'unknown'],
  ];
  const allowed = ['remote', 'hybrid', 'onsite', 'unknown'];

  for (const [value, want] of cases) {
    const { dataDir, profileId } = newProfile(t, `bench-g6-${value.replace(/\W+/g, '')}`);
    const run = importJob(dataDir, profileId, {
      text: GENERIC_POSTING,
      greenhouseUrl: GH_URL,
      greenhouseDetailUrl: GH_DETAIL_URL,
      greenhouseDetail: {
        ...DETAIL,
        location: { name: 'Remote, United States' },
        metadata: [{ id: 10216612, name: 'Workplace Type', value, value_type: 'single_select' }],
      },
    });
    const model = run.job.workModel;
    assert.equal(model, want, `workplace "${value}" must map to "${want}" (location name must not be used as work-model text)`);
    assert.ok(allowed.includes(model), `workModel must stay inside remote|hybrid|onsite|unknown, got ${JSON.stringify(model)}`);
  }
});

test('G9 PAYLOAD-HASH-PROVENANCE', t => {
  const run = genericImport(t, 'bench-g9');
  const job = run.job;
  const app = job.applicationDetail;
  const parsed = parseJobText(GENERIC_POSTING.trim());
  const expected = normalizeGreenhouseDetail(DETAIL);

  assert.deepEqual(app.questions, expected.questions, 'stored questions must equal normalizeGreenhouseDetail of the fixture');
  assert.deepEqual(app.documents, expected.documents, 'stored documents must equal normalizeGreenhouseDetail of the fixture');
  assert.deepEqual(app.rawDetail, DETAIL, 'rawDetail must stay deep-equal to the input payload');

  assert.equal(job.sourceHash, hashText(GENERIC_POSTING.trim()), 'sourceHash must stay the hash of the verbatim posting');
  assert.notEqual(job.title, 'Imported role', 'harness: the promotion must have happened for this case to mean anything');

  assert.equal(app.board, BOARD, 'the detail provenance must carry the board token');
  assert.equal(app.detailUrl, GH_DETAIL_URL, 'the detail provenance must carry the ?questions=true detail URL');
  assert.ok(String(app.detailUrl).includes('?questions=true'), 'the detail URL must record the ?questions=true provenance');

  assert.equal(job.compensation, parsed.compensation, 'compensation must stay exactly what parseJobText produced');
  assert.deepEqual(job.compensationJson, parsed.compensationJson, 'compensationJson must stay exactly what parseJobText produced');
  assert.equal(job.description, parsed.description, 'description must stay exactly what parseJobText produced');
  assert.equal(job.postingText, GENERIC_POSTING, 'the verbatim posting text must be preserved');
});

test('G10 NON-GH-UNCHANGED', t => {
  const { dataDir, profileId } = newProfile(t, 'bench-g10');
  const parsed = parseJobText(PLAIN_POSTING.trim());

  const plain = importJob(dataDir, profileId, { text: PLAIN_POSTING });
  assert.equal('applicationDetail' in plain.job, false, 'a non-Greenhouse import must not gain application detail');
  assert.equal(plain.job.title, parsed.title, 'the identity must be parseJobText only (title)');
  assert.equal(plain.job.company, parsed.company, 'the identity must be parseJobText only (company)');
  assert.equal(plain.job.location, parsed.location, 'the identity must be parseJobText only (location)');
  assert.equal(plain.job.workModel, parsed.workModel, 'the identity must be parseJobText only (workModel)');
  assert.equal(plain.job.compensation, parsed.compensation, 'compensation must be parseJobText only');
  assert.equal(plain.job.department, undefined, 'a plain import must not gain a department');

  // A parallel Greenhouse success in the same profile must not reach back into
  // the plain job (no compensation/department sourced from a detail payload).
  const gh = importJob(dataDir, profileId, {
    text: GENERIC_POSTING,
    greenhouseUrl: GH_URL,
    greenhouseDetailUrl: GH_DETAIL_URL,
    greenhouseDetail: DETAIL,
  });
  assert.equal(gh.job.title, 'Account Manager', 'harness: the parallel Greenhouse import must succeed');

  const listed = domain.listJobs(dataDir, { profileId }).jobs;
  const storedPlain = listed.find(job => job.id === plain.jobId);
  assert.ok(storedPlain, 'the plain job must still be listed');
  assert.equal('applicationDetail' in storedPlain, false, 'a Greenhouse detail must never attach to the plain job');
  assert.equal(storedPlain.title, parsed.title, 'the stored plain title must be unchanged');
  assert.equal(storedPlain.company, parsed.company, 'the stored plain company must be unchanged');
  assert.equal(storedPlain.location, parsed.location, 'the stored plain location must be unchanged');
  assert.equal(storedPlain.workModel, parsed.workModel, 'the stored plain work model must be unchanged');
  assert.equal(storedPlain.compensation, parsed.compensation, 'no detail compensation may be written to the plain job');
  assert.equal(storedPlain.department, undefined, 'no detail department may be written to the plain job');
});
