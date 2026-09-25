import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileResumeDocument } from '../src/resume-compiler.js';
import { detectResumeRenderer, listResumeDesigns, resumeHtml } from '../src/resume-browser.js';
import { start, createProfile, importJob, compareResumeDesigns,
  listResumeDesignVariants, selectResumeDesign, tailorResume } from '../src/domain.js';

const source = `Avery Example
New York City | avery@example.com

SUMMARY
Recruiting support and onboarding specialist.

EXPERIENCE
Example Company - New York City
People Operations Associate | January 2024 - June 2025
- Assisted candidate screening and participated in interviews.
- Designed and delivered client onboarding sessions.

EDUCATION
Example University - New York City
Master of Education | May 2025

SKILLS
People: candidate screening, onboarding, documentation.
`;

test('resume designs retain identical applicant DOM while changing presentation', () => {
  const ir = compileResumeDocument({ profileText: source }).ir;
  const catalog = listResumeDesigns();
  assert.deepEqual(catalog.map(item => item.id), ['navy', 'editorial', 'scan']);
  assert.ok(catalog.every(item => item.name && Number.isInteger(item.version)));
  const html = catalog.map(item => resumeHtml(ir, { style: item.id }));
  const applicant = html.map(value => value.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1]);
  assert.ok(applicant[0]);
  assert.deepEqual(applicant, [applicant[0], applicant[0], applicant[0]]);
  assert.notEqual(html[0], html[1]);
  assert.notEqual(html[1], html[2]);
  assert.match(html[1], /font-family:Georgia/);
  assert.match(html[2], /design-scan/);
  assert.throws(() => resumeHtml(ir, { style: 'unknown' }), error => error.code === 'resume_design_invalid');
});

test('one comparison groups three separate PDF artifacts for the same canonical content',
  { skip: !detectResumeRenderer().available }, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-design-test-'));
    try {
      start(dataDir);
      const profile = createProfile(dataDir, { name: 'Avery Example', resumeText: source });
      const profileId = profile.profileId || profile.id;
      const job = importJob(dataDir, { profileId,
        text: 'Company: Example Company\nTitle: Recruiting Coordinator\nRequired: candidate screening and onboarding.' });
      const jobId = job.jobId || job.id;
      const compared = compareResumeDesigns(dataDir, { profileId, jobId });
      assert.equal(compared.variants.length, 3);
      assert.deepEqual(compared.variants.map(item => item.designId), ['navy', 'editorial', 'scan']);
      assert.equal(new Set(compared.variants.map(item => item.contentHash)).size, 1);
      assert.equal(new Set(compared.variants.map(item => item.variantGroupId)).size, 1);
      assert.equal(new Set(compared.variants.map(item => item.export.sha256)).size, 3);
      assert.ok(compared.variants.every(item => item.export.pageCount === 1 && item.export.qa?.onePage));
      const chosen = compared.variants.find(item => item.designId === 'editorial');
      const selection = selectResumeDesign(dataDir, { profileId, artifactId: chosen.artifactId });
      assert.equal(selection.selection.designId, 'editorial');
      assert.match(selection.selection.meaning, /does not attest submission or use/);
      const readback = listResumeDesignVariants(dataDir, { profileId, variantGroupId: compared.variantGroupId });
      assert.equal(readback.selectedDesign.artifactId, chosen.artifactId);
      assert.equal(readback.variants.length, 3);
      assert.throws(() => tailorResume(dataDir, { profileId, jobId, style: 'unlisted' }),
        error => error.code === 'resume_design_invalid');
    } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
  });
