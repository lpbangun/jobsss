import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileResumeDocument } from '../src/resume-compiler.js';
import { coverLetterCopy, exportPdf, renderPdf } from '../src/documents.js';
import { classifyCoverLetterBlocks } from '../src/cover-letter-layout.js';

function compile(profileText, extra = {}) {
  return compileResumeDocument({ profileText, ...extra });
}

test('selected-project variants normalize and plain project paragraphs become editable source-linked claims', () => {
  const profile = `Avery Example
avery@example.com | Denver, CO

EXPERIENCE
North Pine - Denver, CO
People Operations Associate | January 2024 - June 2025
- Delivered customer onboarding sessions for 30 new users.

## Selected Projects [PRJ_01]
Learning Prototype | Coursework project | 2025
Built a prototype training guide for new users.

EDUCATION
Example University
M.Ed. | 2025

SKILLS
People: onboarding, documentation`;
  const args = { profileText: profile, job: { title: 'Recruiting Coordinator' }, postingText: 'What you will do\n- Deliver customer onboarding sessions.' };
  const initial = compile(profile, args);
  const project = initial.ir.nodes.find(node => node.type === 'project');
  const item = initial.ir.nodes.find(node => node.type === 'project_item');
  assert.match(project.text, /^Learning Prototype \| Coursework project \| 2025$/);
  assert.equal(item.text, 'Built a prototype training guide for new users.');
  assert.equal(item.claimIds.length, 1);
  const claim = initial.ledger.claims.find(candidate => candidate.claimId === item.claimIds[0]);
  assert.equal(claim.sourceQuote, item.text);
  assert.ok(claim.sourceLine > 0);
  assert.ok(initial.profile.projects[0].items.length);

  const preferred = compile(profile, { ...args, preferClaimIds: [claim.claimId] });
  assert.ok(preferred.ir.nodes.some(node => node.type === 'project_item' && node.claimIds.includes(claim.claimId)));
});

test('travel and hybrid preference bullets are excluded while a travel accomplishment survives', () => {
  const profile = `Morgan Lee
morgan@example.com | Boston, MA

EXPERIENCE
Pine Harbor - Boston, MA
Operations Coordinator | January 2022 - Present
- Travel: willing to travel up to 20%.
- Hybrid: prefers a hybrid schedule.
- Coordinated travel logistics for a 40-person training cohort.

PROJECTS
Schedule Guide
Published an internal guide for cohort travel arrangements.

EDUCATION
Elm College
B.A. | 2021

SKILLS
Operations: scheduling, training`;
  const result = compile(profile, { postingText: 'Coordinator responsibilities include training logistics.' });
  const rendered = result.ir.nodes.map(node => node.text).join('\n');
  assert.match(rendered, /Coordinated travel logistics for a 40-person training cohort/);
  assert.doesNotMatch(rendered, /willing to travel up to 20%|prefers a hybrid schedule/i);
  assert.ok(result.ledger.claims.some(claim => /Coordinated travel logistics/.test(claim.sourceQuote)));
  assert.ok(!result.ledger.claims.some(claim => /willing to travel|prefers a hybrid/i.test(claim.sourceQuote)));
});

test('compiler keeps a substantive multi-role and multi-project source pool when it fits', () => {
  const profile = `Jordan Reyes
jordan@example.com | Austin, TX

SUMMARY
Operations analyst who builds dependable reporting workflows.

EXPERIENCE
Clearwater Labs - Austin, TX
Operations Analyst | January 2023 - Present
- Built a weekly reporting process used by six operations leads.
- Automated intake checks and reduced duplicate records by 28%.
- Documented handoffs between support and product teams.
- Presented monthly service trends to department leaders.
- Reconciled customer records across three internal systems.

Cedar Ridge - Austin, TX
Program Coordinator | January 2020 - December 2022
- Coordinated onboarding sessions for 45 new team members.
- Created facilitator guides and follow-up materials for each cohort.
- Tracked completion trends and summarized gaps for managers.

PROJECTS
Onboarding Toolkit | Internal project | 2024
Created a searchable onboarding toolkit with role-specific checklists.

Reporting Refresh | Internal project | 2023
Rebuilt weekly dashboards and documented their data definitions.

Service Handoff Map | Internal project | 2022
Mapped escalation paths and clarified ownership across support teams.

EDUCATION
State University
B.S. Information Systems | 2019

SKILLS
Operations: reporting, onboarding, process mapping
Systems: SQL, dashboards, data validation
Communication: facilitation, documentation, stakeholder updates`;
  const result = compile(profile, { job: { title: 'Operations Analyst', company: 'Clearwater Labs' }, postingText: 'Requirements\n- Reporting and onboarding experience.' });
  for (const text of [
    'Built a weekly reporting process used by six operations leads.',
    'Reconciled customer records across three internal systems.',
    'Created facilitator guides and follow-up materials for each cohort.',
  ]) assert.ok(result.ir.nodes.some(node => node.text === text), `missing ${text}`);
  assert.equal(result.ir.nodes.filter(node => node.type === 'project_item').length, 3);
  assert.match(result.content, /Onboarding Toolkit|Reporting Refresh|Service Handoff Map/);
  assert.doesNotMatch(result.content, /Harvard|Indofood|Musim Mas/);
});

test('cover letter uses grounded contact/date/recipient blocks and Word-like native PDF metrics', () => {
  const profile = {
    name: 'Avery Example',
    resumeText: `Avery Example\nDenver, CO | avery@example.com\n\nEXPERIENCE\nNorth Pine - Denver, CO\nAnalytics Engineer | January 2022 - Present\n- Implemented dbt models for weekly finance reporting.\n- Automated data checks across three reporting pipelines.`,
    preferences: { coverLetterVoice: { tone: 'direct', samples: [{ text: 'Style-only sample must not appear.' }] } },
  };
  const content = coverLetterCopy(profile, { title: 'Analytics Engineer', company: 'North Pine', description: 'The role builds dbt models and reporting workflows.' }, [
    { summary: 'Implemented dbt models for weekly finance reporting.' },
    { summary: 'Automated data checks across three reporting pipelines.' },
  ], { date: 'September 30, 2026', contactEmail: 'avery+jobs@example.com', recipient: 'Jordan Kim', recipientTitle: 'Hiring Manager' });
  const blocks = classifyCoverLetterBlocks(content);
  assert.deepEqual(blocks.map(block => block.type), ['contact', 'date', 'recipient', 'salutation', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'closing', 'signature']);
  assert.match(content, /avery\+jobs@example\.com/);
  assert.match(content, /Jordan Kim\nHiring Manager\nNorth Pine/);
  assert.match(content, /In my technical work, I implemented dbt models/);
  assert.doesNotMatch(content, /Style-only sample|warehouse-cost improvements|Dear Hiring Team/);

  const pdf = renderPdf(content, { kind: 'cover_letter' });
  assert.equal(pdf.pageSize, 'Letter');
  assert.equal(pdf.bodyFontSize, 11);
  assert.equal(pdf.marginsPt, 72);
  assert.match(pdf.bytes.toString('latin1'), /\/BaseFont \/Times-Roman/);
  assert.match(pdf.bytes.toString('latin1'), /\/BaseFont \/Times-Bold/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-letter-export-'));
  try {
    const exported = exportPdf(directory, content, { kind: 'cover_letter' });
    assert.equal(exported.engine, 'native');
    assert.equal(exported.fontFamily, 'Times New Roman');
    assert.equal(exported.marginsPt, 72);
    assert.ok(fs.readFileSync(exported.path).includes(Buffer.from('/BaseFont /Times-Roman')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  const undated = coverLetterCopy(profile, { title: 'Analyst', company: 'Unknown company' }, []);
  assert.doesNotMatch(undated, /September 30|Unknown company/);
});

test('oversized cover-letter paragraphs paginate without dropping text below the one-inch margin', () => {
  const marker = 'Final page marker 9348.';
  const paragraph = `This is a long, source-preserving cover-letter paragraph with ordinary readable Times typography and meaningful spacing. ${'The candidate describes grounded project work and relevant delivery evidence. '.repeat(240)}${marker}`;
  const pdf = renderPdf(paragraph, { kind: 'cover_letter' });
  const source = pdf.bytes.toString('latin1');
  const yValues = [...source.matchAll(/1 0 0 1 \d+\.\d{2} (-?\d+\.\d{2}) Tm/g)].map(match => Number(match[1]));
  assert.ok(pdf.pageCount >= 2);
  assert.ok(yValues.length > 50);
  assert.ok(yValues.every(y => y >= 72), `found a baseline below the one-inch bottom margin: ${Math.min(...yValues)}`);
  const extracted = [...source.matchAll(/<([0-9a-f]+)> Tj/g)].map(match => Buffer.from(match[1], 'hex').toString('latin1')).join('\n');
  assert.ok(extracted.replace(/\s+/g, ' ').includes(marker));
});
