import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareIntake } from '../experiments/resume-pocs/intake.mjs';
import { checkLayout, RUBRIC } from '../experiments/resume-pocs/contracts.mjs';
import { buildApplication } from '../experiments/resume-pocs/run.mjs';
import { detectResumeRenderer } from '../src/resume-browser.js';

const fixture = name => fs.readFileSync(fileURLToPath(new URL(`../experiments/resume-pocs/fixtures/${name}`, import.meta.url)), 'utf8');
const browser = detectResumeRenderer().executable;

test('synthetic intake is deterministic for sparse, typical and dense profiles', () => {
  for (const name of ['sparse', 'typical', 'dense']) {
    const input = JSON.parse(fixture(`${name}.json`));
    assert.deepEqual(prepareIntake(input), prepareIntake(input));
    assert.equal(prepareIntake(input).readyForImport, true);
  }
});

test('visible fill cannot pass by increasing the container height', () => {
  const layout = { fill: .5, width: 724, height: 978, minX: 0, maxX: 724, maxY: 489, minBodyPt: 10, maxGap: 12, rawMarkdown: false };
  assert.deepEqual(checkLayout(layout).failures, ['underfilled']);
  assert.ok(checkLayout({ ...layout, fill: .93, maxGap: 90 }).failures.includes('excessive_gap'));
  assert.ok(checkLayout({ ...layout, fill: .93, minBodyPt: 8 }).failures.includes('unreadable_type'));
});

for (const route of ['tailor_resume', 'revise_resume', 'render_resume', 'prepare_applications_batch']) {
  test(`E2E cold-start notes -> actual MCP ${route} -> browser PDF -> independent fixture review`, { skip: !browser, timeout: 180000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-poc-'));
    try {
      const source = prepareIntake(JSON.parse(fixture('typical.json'))).source;
      const dataDir = path.join(root, 'data'); let reviews = 0;
      const result = await buildApplication({ source, posting: fixture('job.txt'), dataDir,
        directory: path.join(dataDir, route), route, browser,
        reviewer: async request => { reviews++; return {
          report: { schema: 'resume-review.v1', binding: request.binding, verdict: 'pass', findings: [], preferClaimIds: [], excludeClaimIds: [] },
          receipt: { adapter: 'deterministic-test', model: 'fixture', evidenceClass: 'fixture', runId: route },
        }; } });
      assert.ok(result.routes.includes(route));
      assert.equal(reviews, 1);
      assert.equal(result.mechanical.pageCount, 1);
      assert.equal(result.mechanical.searchable, true);
      assert.equal(result.mechanical.passed, false, 'Typical sparse source is diagnosed, not padded to pass.');
      assert.equal(result.status, 'qa_unresolved');
      assert.equal(result.humanApproved, false); assert.equal(result.submitted, false);
      assert.ok(result.layoutAttempts <= RUBRIC.maxLayoutAttempts);
      assert.match(fs.readFileSync(result.htmlPath || path.join(path.dirname(result.pdfPath), 'resume.html'), 'utf8'), /Alex Example/);
      assert.doesNotMatch(fs.readFileSync(path.join(dataDir, route, 'candidate-source.txt'), 'utf8'), /Greenhouse|technical recruiting/i);
    } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  });
}

test('E2E dense profile fitting and replay reproduce semantic IR/layout decisions', { skip: !browser, timeout: 240000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-replay-'));
  try {
    const source = prepareIntake(JSON.parse(fixture('dense.json'))).source;
    const posting = fixture('job.txt'); const runs = [];
    for (const id of ['one', 'two']) {
      const dataDir = path.join(root, id);
      runs.push(await buildApplication({ source, posting, dataDir, directory: path.join(dataDir, 'run'), browser }));
    }
    assert.equal(runs[0].sourceSha256, runs[1].sourceSha256);
    assert.equal(runs[0].postingSha256, runs[1].postingSha256);
    assert.equal(runs[0].irSha256, runs[1].irSha256);
    assert.deepEqual(runs[0].mechanical, runs[1].mechanical);
    assert.notEqual(runs[0].status, 'qa_passed_needs_human_review');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
