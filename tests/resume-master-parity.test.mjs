import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileResumeDocument, canonicalResumeSource } from '../src/resume-compiler.js';
import { resumeHtml, detectResumeRenderer, renderResumeBrowser } from '../src/resume-browser.js';
import { repairSelection, useSourceSummary } from '../experiments/resume-pocs/render.mjs';
import { openMcp } from '../experiments/resume-pocs/mcp-client.mjs';

// Fictional master topology: three recent bullets, two per earlier role,
// two independent projects, optional education note, grouped skills.
const summary = 'Learning and customer operations professional with experience coordinating training, onboarding, and recruiting support. Built practical guides and research tools to help teams organize evidence, communicate clearly, and support users through implementation.';
const recent = [
  'Managed customer onboarding conversations and documented implementation needs, connecting customer questions with clear guides and practical next steps for the learning product.',
  'Created onboarding materials and feedback processes for new users, coordinating stakeholder input and translating recurring support questions into improvements to training resources.',
  'Conducted customer research and product walkthroughs, maintained relationship records, and supported users as they adopted the platform and shared their learning goals.',
];
const earlier = [
  'Assessed learning needs with business stakeholders and organized training programs, coordinating materials, session logistics, and participant communication across multiple teams.',
  'Supported recruiting activities through candidate screening and skills assessments, maintaining accurate records and communicating findings with colleagues involved in hiring decisions.',
];
const source = `# Alex Example
Sample City | alex@example.invalid | linkedin.com/in/alex-example

**People Operations | Learning & Development** ${summary}

## EXPERIENCE
### Example Studio - Sample City
**Founder & CEO | January 2024 - Present**
${recent.map(t => '- ' + t).join('\n')}

### Example Foods - Sample City
**Learning Associate | January 2022 - December 2023**
${earlier.map(t => '- ' + t).join('\n')}

### Example Manufacturing - Sample City
**Training Assistant | January 2021 - December 2021**
- Coordinated training sessions for 200 participants across five teams, prepared learning materials, tracked attendance, and gathered feedback to help colleagues plan future programs.
- Supported 12 train-the-trainer sessions, organized facilitator resources, and prepared clear documentation so internal trainers could run consistent programs and support learners with follow-up questions.

## PROJECTS
### Research Atlas | Sole Builder | 2025
Built a public research tool that organized education company information and hiring evidence. Developed searchable workflows, documented sources, and wrote clear guides so users could compare opportunities and prepare structured research for conversations.

### Career Kit | Sole Builder | 2026
Built a local career operations tool to organize candidate evidence, job research, and application materials. Designed source-linked document workflows, readable review artifacts, and durable records so users could understand how each claim connected to their source information.

## EDUCATION
**Example Graduate University**
Master of Education, Learning Design | May 2026
Cross-registration in product design coursework

**Example University**
Bachelor of Arts | May 2024

## SKILLS
**People & Learning:** Candidate screening, needs analysis, onboarding, training coordination, stakeholder communication, learning design
**Technology:** Product research, documentation, spreadsheet analysis, workflow design, user feedback, AI tools
`;
const posting = 'Company: Fictional Education Company\nTitle: Account Associate\nLocation: Sample City\nRequirements\n- Customer onboarding and stakeholder communication.\n- Learning product research and documentation.';
const compile = (text = source, rest = {}) => compileResumeDocument({ profileText: text, postingText: posting, job: { title: 'Account Associate', company: 'Fictional Education Company' }, ...rest });
const counts = c => [0, 1, 2].map(i => c.ir.nodes.filter(n => n.type === 'achievement' && n.roleRef.roleIndex === i).length);
const inspect = c => {
  assert.equal(c.ir.headline, 'Account Associate');
  assert.equal(c.ir.headlineKind, 'target_positioning');
  assert.equal(c.summary.text, summary);
  assert.deepEqual(counts(c), [3, 2, 2]);
  assert.equal(c.ir.nodes.filter(n => n.type === 'project').length, 2);
  assert.equal(c.ir.nodes.filter(n => n.type === 'education').length, 2);
  assert.doesNotMatch(c.content, /Target:|\*\*|^#{1,6}\s/m);
  assert.ok(c.content.includes('Cross-registration'));
};

test('master Markdown is compiled directly with separate target positioning and balanced source sections', () => {
  assert.equal(canonicalResumeSource(source), true);
  const c = compile(); inspect(c);
  const html = resumeHtml(c.ir);
  assert.match(html, /class="headline">Account Associate/);
  assert.match(html, /font-size:22pt/);
  assert.match(html, /Research Atlas/); assert.match(html, /Career Kit/);
});

test('source-summary benchmark repair preserves target headline and canonical copy', () => {
  const c = useSourceSummary(compile()); inspect(c);
  assert.ok(c.content.includes('\nAccount Associate\n'));
  assert.match(resumeHtml(c.ir), /class="headline">Account Associate/);
});

test('fill repair cannot restore an excessive concentration in one employer', () => {
  const expanded = source.replace(recent.map(t => '- ' + t).join('\n'), [...recent,
    'Conducted learning product research and customer onboarding documentation for additional audiences.',
    'Coordinated learning product research and customer onboarding documentation across teams.',
    'Prepared learning product research and customer onboarding documentation for future conversations.'
  ].map(t => '- ' + t).join('\n'));
  const c = compile(expanded); assert.deepEqual(counts(c), [3, 2, 2]);
  assert.equal(repairSelection(c, posting, 'restore'), null);
});

test('claim exclusion remains respected while headline is preserved', () => {
  const c = compile(); const id = c.ir.nodes.find(n => n.type === 'achievement').claimIds[0];
  const revised = compile(source, { excludeClaimIds: [id] });
  assert.equal(revised.ir.headline, c.ir.headline);
  assert.ok(!revised.ir.nodes.some(n => n.claimIds.includes(id)));
  assert.throws(() => compile(source, { presentation: { maxBulletsPerRole: 0 } }), { code: 'resume_presentation_invalid' });
});

for (const route of ['tailor_resume', 'revise_resume', 'render_resume', 'prepare_applications_batch']) {
  test(`actual MCP ${route} preserves master presentation and job-specific title`, { skip: route === 'render_resume' && !detectResumeRenderer().available, timeout: 180000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-master-regression-')); const mcp = openMcp(dir);
    try {
      await mcp.initialize(); await mcp.call('start', { outputMode: 'compact' });
      const p = await mcp.call('create_profile', { name: 'Alex Example', resumeText: source, preferences: { resumePresentation: { mode: 'master', maxBulletsPerRole: 3, fillPage: true } } });
      const profileId = p.profileId || p.id;
      const j = await mcp.call('import_job', { profileId, text: posting }); const jobId = j.jobId || j.job?.id || j.id;
      if (route === 'prepare_applications_batch') await mcp.call(route, { profileId, jobIds: [jobId], format: 'markdown', coverLetter: false });
      const r = await mcp.call(route === 'prepare_applications_batch' ? 'tailor_resume' : route, { profileId, jobId, format: 'markdown' });
      const c = r.document?.resumeDocument || r.artifact?.resumeDocument; inspect(c);
      assert.equal(c.ir.presentation.mode, 'master');
      if (route === 'render_resume') {
        assert.equal(r.document.qa.headline, 'Account Associate');
        assert.equal(r.document.qa.onePage, true);
        assert.equal(r.document.qa.fullPageBalanced, true);
        assert.equal(r.document.qa.searchableTextMapping, true);
        assert.ok(r.document.qa.minBodyPt >= 9.5);
        assert.ok(r.document.qa.visibleFill > 0);
      }
    } finally { mcp.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
}

test('supported master meets requested full-page balance with measured readable QA', { skip: !detectResumeRenderer().available, timeout: 180000 }, () => {
  const c = compile(source, { presentation: { mode: 'master', fillPage: true } });
  const result = renderResumeBrowser(c.ir);
  assert.equal(result.qa.fullPageBalanced, true);
  assert.ok(result.qa.visibleFill >= .88 && result.qa.visibleFill <= .96);
  assert.ok(result.qa.minBodyPt >= 9.5);
  assert.ok(result.qa.layoutAttempts.length <= 7);
});

test('sparse source cannot pass a requested full page through spacing alone', { skip: !detectResumeRenderer().available, timeout: 180000 }, () => {
  const sparse = `Alex Example
Sample City | alex@example.invalid
SUMMARY
Training coordinator with experience preparing learning materials.
EXPERIENCE
Example Studio - Sample City
Training Assistant | January 2024 - Present
- Prepared training materials and maintained attendance records.
EDUCATION
Example University
BA | May 2024
SKILLS
Tools: Spreadsheets, documentation
`;
  assert.throws(() => renderResumeBrowser(compile(sparse, { presentation: { mode: 'master', fillPage: true } }).ir), { code: 'resume_page_fill_unresolved' });
});

test('all eight target titles survive source-summary repair without company-label boilerplate', () => {
  for (const title of ['Account Associate', 'Sales Development Representative', 'Customer Success Associate', 'Academic Advisor, Consultative Sales', 'Account Executive', 'Partner Inside Sales Representative', 'Recruiting Specialist', 'Business Development Representative']) {
    const c = useSourceSummary(compile(source, { job: { title, company: 'Fictional Education Company' } }));
    assert.equal(c.ir.headline, title);
    assert.ok(c.content.includes('\n' + title + '\n'));
    assert.deepEqual(counts(c), [3, 2, 2]);
    assert.equal(c.ir.nodes.filter(n => n.type === 'project').length, 2);
    assert.doesNotMatch(c.content, /Target:|Fictional Education Company/);
  }
});
