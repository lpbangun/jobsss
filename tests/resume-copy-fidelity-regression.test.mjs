// Regression: applicant-copy fidelity. A resume that the shipped skill tells a
// caller to pass unchanged must never lose the candidate's own verified-able
// content, and no context line may be published as an achievement bullet.
//
// Root cause guarded here: the labelled-record copy path required a separate
// `## Achievements` section (with a fixed seven-verb vocabulary) plus
// `Production:|Skills:|Languages:` and `Education:` label prefixes, so the
// common shape -- achievement bullets under `## Employment`, plain `## Skills`
// and `## Education` -- silently produced a resume with no achievement, no
// skills and no education while reporting success and no warnings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as domain from '../src/domain.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(process.env.JOBSSS_TEST_DATA || os.tmpdir(), 'resume-copy-fidelity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const POSTING = `Title: Senior Backend Engineer (Platform)
Company: Helios Freight
Location: Remote (EU)
Requirements:
- 5+ years backend engineering in production
- Strong Node.js and PostgreSQL
- Event-driven design (Kafka or similar)
`;

function copyFor(t, resume, name = 'Avery Chen') {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name, resumeText: resume });
  const { jobId } = domain.importJob(data, { profileId, text: POSTING });
  return domain.tailorResume(data, { profileId, jobId, format: 'text' }).document.content;
}

const bulletsOf = content => content.split('\n').filter(line => line.startsWith('- '));

const ROLE = '2021-09 through 2024-06: Senior Backend Engineer, Northwind Logistics.';
const CLAIM = 'Reduced p99 checkout latency from 820ms to 240ms by replacing synchronous carrier calls with a queue-backed adapter.';
const SKILLS = 'Node.js, PostgreSQL, Kafka, TypeScript';
const EDU = '2015-09 through 2019-06: BSc Computer Science, TU Berlin.';

test('labelled record: achievement bullets under Employment reach the copy with skills and education', t => {
  const copy = copyFor(t, `Name: Avery Chen
Email: avery.chen@example.com
Location: Berlin, Germany

## Employment
${ROLE}
- ${CLAIM}

## Skills
${SKILLS}

## Education
${EDU}
`);
  assert.match(copy, /p99 checkout latency/, 'the candidate achievement must survive into applicant copy');
  assert.match(copy, /PostgreSQL/, 'skills must survive into applicant copy');
  assert.match(copy, /TU Berlin/, 'education must survive into applicant copy');
  assert.match(copy, /Northwind/, 'the dated role must stay');
});

test('labelled record: a claim verb outside any fixed vocabulary still reaches the copy', t => {
  // "Cut" was absent from the fixed verb list, which made the whole profile
  // fail closed with no_proofs for an ordinary resume.
  const copy = copyFor(t, `Name: Avery Chen
Email: avery.chen@example.com

## Employment
${ROLE}
- Cut p99 checkout latency from 820ms to 240ms with a queue-backed carrier adapter.

## Skills
${SKILLS}
`);
  assert.match(copy, /Cut p99 checkout latency/, 'an ordinary claim verb must not be dropped');
});

test('labelled record: plain Skills and Education sections are not treated as unlabelled noise', t => {
  const copy = copyFor(t, `Name: Avery Chen
Email: avery.chen@example.com

## Employment
${ROLE}

## Achievements
${CLAIM}

## Skills
Production: ${SKILLS}

## Education
Education: ${EDU}
`);
  // The documented dialect must keep working exactly as before.
  assert.match(copy, /p99 checkout latency/);
  assert.match(copy, /Production: Node\.js/, 'a labelled skills line keeps its label form');
  assert.match(copy, /TU Berlin/);
});

test('ordinary markdown: a bare location line never becomes an achievement bullet', t => {
  const copy = copyFor(t, `# Avery Chen

avery.chen@example.com
Berlin, Germany

## Experience
${ROLE}
- ${CLAIM}

## Skills
${SKILLS}

## Education
${EDU}
`, 'Avery Chen');
  assert.ok(!bulletsOf(copy).some(line => /Berlin, Germany/.test(line)),
    `no bullet may be a place name; got ${JSON.stringify(bulletsOf(copy))}`);
  assert.match(copy, /p99 checkout latency/);
  assert.match(copy, /Berlin, Germany/, 'the location is still rendered as a contact line');
});

test('labelled record: boundary and chronology-guard sentences stay out of applicant copy', t => {
  const copy = copyFor(t, `Name: Avery Chen
Email: avery.chen@example.com
Work authorization: US authorized to work in the United States without sponsorship.

## Chronological employment [E1, E2]
2021-09 through 2024-06: Senior Backend Engineer, Northwind Logistics.
These continuous dates cover five years inclusive. No direct reports, hiring authority, or staff-level ownership.
2024-07 through 2026-08: Staff Engineer, Northwind Logistics.

## Supported achievements [A01]
A01 [E1]: ${CLAIM}

## Skills and education
Production: ${SKILLS}
Education: ${EDU}
`);
  assert.match(copy, /p99 checkout latency/, 'the tagged achievement must reach the copy');
  assert.ok(!/No direct reports/.test(copy), 'a boundary sentence must never become an achievement bullet');
  assert.ok(!/These continuous dates/.test(copy), 'a chronology-guard sentence must never become a bullet');
  assert.ok(!/authorized to work/i.test(copy), 'work authorization stays a source fact, not copy');
});
