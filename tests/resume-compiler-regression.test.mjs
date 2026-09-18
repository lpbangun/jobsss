import assert from 'node:assert/strict';
import test from 'node:test';
import { compileResumeDocument } from '../src/resume-compiler.js';

const POSTING = [
  'About Halcyon Grid',
  'What we are looking for',
  '- Strong platform engineering experience',
].join('\n');

const PLATFORM_PROFILE = [
  'Amara Osei',
  'Denver, CO | amara.osei.platform@example.com',
  '',
  'EXPERIENCE',
  'Pillarline Systems - Denver, CO',
  'Staff Software Engineer, Platform | March 2023 - Present',
  '- Rebuilt the deployment pipeline for 42 services; median deploy time fell from 26 minutes to 7 with automated canary gates.',
  '- Cut p99 checkout latency from 850ms to 210ms by moving session state to a sharded Redis tier with read-through caching.',
  '',
  'Cinderwood Commerce - Fort Collins, CO',
  'Software Engineer | September 2016 - June 2020',
  '- Co-owned the on-call rotation and wrote the runbooks used for triage.',
  '',
  'EDUCATION',
  'Colorado State University',
  'B.S. Computer Science | 2016',
  '',
  'SKILLS',
  'Languages: Go, Python',
  'Practices: SLOs, incident command',
].join('\n');

const DESIGN_PROFILE = [
  'Élodie Marchand',
  'Montréal, QC | elodie.marchand.design@example.com',
  '',
  'SUMMARY',
  'Product designer focused on design systems and accessibility for complex, data-heavy products.',
  '',
  'EXPERIENCE',
  'Loom & Line Studio - Montréal, QC / Hybrid',
  'Product Design Lead | August 2021 - Present',
  '- Led the Fieldnote design system from 12 scattered components to 48 governed components adopted by four product teams.',
  '- Partnered with two engineering squads to ship an accessible data grid; closed 140 WCAG 2.1 AA audit findings across forms, tables, and dialogs.',
  '',
  'PROJECTS',
  'Fieldnote Design System (2023)',
  '- Published the Fieldnote roadmap and quarterly adoption metrics reviewed by all four teams.',
  '- Documented accessibility patterns for forms, tables, and dialogs with annotated examples.',
  '',
  'SKILLS',
  'Craft: design systems, accessibility, Figma',
  '',
  'EDUCATION',
  'Concordia University',
  'B.F.A. Design | 2017',
].join('\n');

function compile(profileText) {
  return compileResumeDocument({
    profileText,
    postingText: POSTING,
    job: { company: 'Unknown company' },
  });
}

test('summary is neutral, punctuated, and does not duplicate achievement sentences', () => {
  const result = compile(PLATFORM_PROFILE);
  const summary = result.ir.nodes.find(node => node.type === 'summary').text;
  assert.match(summary, /Staff Software Engineer, Platform/);
  assert.match(summary, /Go, Python/);
  assert.doesNotMatch(summary, /Rebuilt the deployment pipeline|Cut p99 checkout latency/);
  assert.doesNotMatch(summary, /canary gates;\s*Cut/i);
  assert.match(summary, /\.$/);
  assert.equal(result.ir.nodes.filter(node => node.type === 'achievement' && /Rebuilt the deployment pipeline/.test(node.text)).length, 1);
});

test('achievement ownership wording preserves the source qualifier exactly', () => {
  const result = compile(PLATFORM_PROFILE);
  const achievement = result.ir.nodes.find(node => node.type === 'achievement' && /on-call rotation/.test(node.text));
  assert.equal(achievement?.text, 'Co-owned the on-call rotation and wrote the runbooks used for triage.');
  assert.doesNotMatch(result.content, /Co-owned with the on-call rotation/);
});

test('redundant low-signal projects are omitted from the canonical document', () => {
  const result = compile(DESIGN_PROFILE);
  assert.equal(result.ir.nodes.some(node => node.type === 'section_heading' && node.text === 'PROJECTS'), false);
  assert.equal(result.ir.nodes.some(node => node.type === 'project' && /Fieldnote/.test(node.text)), false);
  assert.equal(result.ir.nodes.some(node => node.type === 'project_item'), false);
  assert.match(result.content, /Led the Fieldnote design system/);
  assert.doesNotMatch(result.content, /Published the Fieldnote roadmap|Documented accessibility patterns/);
});
