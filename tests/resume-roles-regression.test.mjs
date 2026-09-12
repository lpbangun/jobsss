// Regression: an open-ended "Present" date range is a role header, not an
// anonymous achievement bullet. A recognised header must open its own role and
// own the bullets that follow it, while closed numeric ranges keep their
// existing header behaviour and ordinary achievement lines stay bullets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resumeCopy } from '../src/documents.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NORTHWIND_HEADER = '2021 - Present | Senior Platform Engineer | Northwind Robotics';
const NORTHWIND_LEAD = 'Led platform reliability work that cut incident recovery time from 90 to 25 minutes across 12 production services.';
const NORTHWIND_ROADMAP = 'Expanded the 2021 - Present platform roadmap by four services without adding headcount.';
const ALDER_HEADER = '2019-03 through 2021-02 | Platform Engineer | Alder Cart Labs';
const ALDER_BUILT = 'Built the nightly inventory reconciliation job that replaced a manual spreadsheet process.';
const ALDER_ERRORS = 'Cut reporting errors from 3.2% to 0.4% across 120,000 audited rows.';

const openRangeResume = [
  '# Avery Chen',
  '',
  'avery.chen@example.com',
  '',
  '## Experience',
  '',
  NORTHWIND_HEADER,
  `- ${NORTHWIND_LEAD}`,
  `- ${NORTHWIND_ROADMAP}`,
  '',
  ALDER_HEADER,
  `- ${ALDER_BUILT}`,
  `- ${ALDER_ERRORS}`,
  '',
  '## Skills',
  '',
  'Reliability engineering, release automation',
].join('\n');

// Render output is a flat line list: role headers are the non-bullet lines that
// follow the EXPERIENCE heading, and a bullet belongs to the last header above
// it. This reads the rendered document the way an applicant would.
function blocksOf(text) {
  const blocks = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ')) {
      if (blocks.length) blocks.at(-1).bullets.push(line.slice(2));
      continue;
    }
    blocks.push({ header: line, bullets: [] });
  }
  return blocks;
}

function blockFor(text, header) {
  return blocksOf(text).find(block => block.header === header);
}

test('open-ended Present range is recognised as a role header', () => {
  const out = resumeCopy({ name: 'Avery Chen', resumeText: openRangeResume }, []);
  assert.ok(
    blockFor(out, NORTHWIND_HEADER),
    `"${NORTHWIND_HEADER}" must open a role, not become an achievement bullet:\n${out}`
  );
  assert.ok(
    !out.split('\n').some(line => line.trim().startsWith(`- ${NORTHWIND_HEADER}`)),
    `a recognised role header must never render as a bullet:\n${out}`
  );
});

test('Present-range role owns its bullets instead of leaking them to another employer', () => {
  const out = resumeCopy({ name: 'Avery Chen', resumeText: openRangeResume }, []);
  const northwind = blockFor(out, NORTHWIND_HEADER);
  const alder = blockFor(out, ALDER_HEADER);
  assert.ok(northwind && alder, `both dated roles must render as headers:\n${out}`);
  assert.deepEqual(
    northwind.bullets.slice().sort(),
    [NORTHWIND_LEAD, NORTHWIND_ROADMAP].sort(),
    `Northwind achievements must stay under Northwind:\n${out}`
  );
  for (const bullet of alder.bullets) {
    assert.doesNotMatch(bullet, /platform reliability work|platform roadmap/,
      `Alder must not inherit Northwind achievements:\n${out}`);
  }
});

test('closed numeric ranges keep the existing header behaviour', () => {
  const out = resumeCopy({ name: 'Avery Chen', resumeText: openRangeResume }, []);
  const alder = blockFor(out, ALDER_HEADER);
  assert.ok(alder, `closed dated range must still open a role:\n${out}`);
  assert.match(alder.bullets.join('\n'), /nightly inventory reconciliation/);
  assert.ok(
    !out.split('\n').some(line => line.trim().startsWith(`- ${ALDER_HEADER}`)),
    `a closed dated range must never render as a bullet:\n${out}`
  );
});

test('achievement lines that merely mention a range stay bullets', () => {
  const resume = [
    '# Casey Field',
    'casey.field@example.com',
    '## Experience',
    '2018-01 through 2020-12 | Data Analyst | Harbor Ledger Studio',
    'From 2021 to present, the analytics stack grew from three to nine services.',
    '- Rebuilt the weekly reporting pipeline in SQL.',
  ].join('\n');
  const out = resumeCopy({ name: 'Casey Field', resumeText: resume }, []);
  const harbor = blockFor(out, '2018-01 through 2020-12 | Data Analyst | Harbor Ledger Studio');
  assert.ok(harbor, `closed dated role must still open a role:\n${out}`);
  assert.ok(
    harbor.bullets.some(bullet => /analytics stack grew from three to nine services/.test(bullet)),
    `a sentence mentioning a range is an achievement, not a header:\n${out}`
  );
  assert.ok(
    !out.split('\n').some(line => /^From 2021 to present/.test(line.trim())),
    `a prose sentence must never be promoted to a role header:\n${out}`
  );
});

test('Present range end is case-insensitive and works with other separators', () => {
  const resume = [
    '# Dana Fields',
    'dana.fields@example.com',
    '## Experience',
    '2018-05 through 2020-04 | Data Analyst | Harbor Ledger Studio',
    '- Built the weekly reconciliation report used by finance partners.',
    'jan 2021 - present | Senior Data Analyst | Northwind Robotics',
    '- Rebuilt the subscription metric layer for finance reporting.',
    '2024–PRESENT: Staff Data Analyst, Northwind Robotics',
    '- Led the metric-definition review across two teams.',
  ].join('\n');
  const out = resumeCopy({ name: 'Dana Fields', resumeText: resume }, []);
  const headers = blocksOf(out).filter(block => block.header !== 'Dana Fields')
    .map(block => block.header);
  assert.ok(headers.includes('jan 2021 - present | Senior Data Analyst | Northwind Robotics'),
    `lowercase "present" and a month-year start must be a header:\n${out}`);
  assert.ok(headers.includes('2024–PRESENT: Staff Data Analyst, Northwind Robotics'),
    `uppercase PRESENT with an en dash and colon must be a header:\n${out}`);
  assert.equal(blockFor(out, 'jan 2021 - present | Senior Data Analyst | Northwind Robotics').bullets.length, 1);
  assert.equal(blockFor(out, '2024–PRESENT: Staff Data Analyst, Northwind Robotics').bullets.length, 1);
});

test('ordinary resume path stays intact on the shared fixture', () => {
  const fixture = readFileSync(path.join(REPO, 'tests/fixtures/profile-resume.md'), 'utf8');
  const out = resumeCopy({ name: 'Jordan Example', resumeText: fixture }, [
    { id: 'p1', summary: 'Led discovery with educators and operations teams to prioritize an AI-assisted learning workflow that reduced manual review time by 30%.' },
  ]);
  assert.match(out, /Jordan Example/);
  assert.match(out, /jordan\.example@example\.test/);
  assert.match(out, /EXPERIENCE/);
  assert.match(out, /Led discovery with educators/);
  assert.match(out, /Product discovery, user research, analytics, roadmap planning/);
  assert.doesNotMatch(out, /\(fictional|Do not claim|internal/i);
});
