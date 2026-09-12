// rc3 scoring-pay regression: the compensation dimension must honor a
// parsed posting pay range that is stated in the candidate's currency even
// when the parser could not resolve the pay interval or the base/bonus
// split — an unresolved interval is not evidence of non-base pay.
//
// Frozen invariants covered here:
//   - a parsed range in the matching currency scores the dimension
//   - a currency mismatch or an unparsed range stays unknown
//   - missing posting pay never becomes eligibility-by-assumption
//   - bonus/equity ranges are never counted toward the base-pay floor
//   - no exchange rate is invented, the seven weights still sum to 100
//   - overall moves only through the compensation dimension
//   - deterministic output and get_score readback consistency
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIT_DIMENSION_WEIGHTS, localScore } from '../src/scoring.js';
import { parseCompensation } from '../src/compensation.js';
import * as domain from '../src/domain.js';

const resume = `# Source record
## Identity and preferences
Name: Riley Chen
Email: riley@example.com
Location: Austin, Texas, United States.
Work authorization: US *** No UK work authorization.
Target: approximately five years experience. Not seeking staff or principal roles.
Hard minimum: USD 130,000 annual guaranteed base salary, excluding bonus/equity.
Remote only; no required office attendance.
## Chronological employment
2020-01 through 2025-12: Product Manager, Cedar Learning.
## Supported achievements
Built product discovery, roadmap and metrics workflows for educator products.
## Skills and education
Production: product strategy, discovery, roadmap, metrics.
## Boundaries
Proof verification and artifact approval are pending human-only actions.`;

const preferences = {
  salary: { min: 130000, currency: 'USD' },
  workModel: 'Remote only',
  locations: ['Texas'],
};

const profile = { id: 'profile-riley-chen', name: 'Riley Chen', resumeText: resume, preferences };

// The frozen discovery fixture shape: a real $130k-$165k USD range with no
// annual/base label, so parseCompensation leaves interval and baseStatus
// unresolved while the numeric range and currency are present.
const PAY_LINE = 'Compensation range $130k-$165k.';

const BASE_LINES = [
  'Title: Product Manager, Learning Platform',
  'Company: Example Learning Co',
  'Location: Remote US',
  'Lead discovery, roadmap planning and launch execution for learning workflows.',
  'Partner with engineering and design on metrics and customer research.',
];

function job(lines, extra = {}) {
  return {
    id: 'job-scoring-pay',
    title: 'Product Manager, Learning Platform',
    company: 'Example Learning Co',
    location: 'Remote US',
    description: [...lines].join('\n'),
    ...extra,
  };
}

function score(lines, extra = {}) {
  return localScore({ profile, job: job(lines, extra) });
}

function knownCoverage(fit) {
  const known = Object.values(fit.dimensions).filter(dimension => dimension.status !== 'unknown');
  const weight = known.reduce((sum, dimension) => sum + dimension.weight, 0);
  return { weight, overall: weight ? Math.round(known.reduce((sum, dimension) => sum + dimension.weight * dimension.score, 0) / weight) : null };
}

test('compensation honors a parsed range in the candidate currency when the interval is unresolved', () => {
  const fit = score([...BASE_LINES, `${PAY_LINE} Remote work.`]);
  assert.equal(fit.dimensions.compensation.status, 'scored');
  assert.equal(fit.dimensions.compensation.score, 85);
  assert.equal(fit.dimensions.compensation.weight, 8);
  assert.ok(fit.dimensions.compensation.evidenceRefs.some(ref => ref.field === 'preferences.salary'));
  assert.ok(fit.dimensions.compensation.evidenceRefs.some(ref => ref.field === 'description'));
  assert.equal(fit.eligibility.status, 'eligible_for_review');
  assert.equal(fit.dimensions.compensation.reason.toLowerCase().includes('missing'), false);
});

test('the stored compensationJson shape with unknown interval/baseStatus still scores', () => {
  const parsed = parseCompensation(job([...BASE_LINES, `${PAY_LINE} Remote work.`]).description);
  assert.equal(parsed.min, 130000);
  assert.equal(parsed.max, 165000);
  assert.equal(parsed.currency, 'USD');
  const fit = score([...BASE_LINES, `${PAY_LINE} Remote work.`], {
    compensationJson: { text: parsed.text, min: parsed.min, max: parsed.max, currency: parsed.currency, interval: 'unknown', baseStatus: 'unknown' },
  });
  assert.equal(fit.dimensions.compensation.status, 'scored');
  assert.equal(fit.dimensions.compensation.score, 85);
});

test('a currency mismatch keeps compensation unknown and invents no exchange rate', () => {
  const fit = score([...BASE_LINES, 'Compensation range GBP 100k-120k. Remote work.']);
  assert.equal(fit.dimensions.compensation.status, 'unknown');
  assert.equal(fit.dimensions.compensation.score, null);
  assert.match(fit.dimensions.compensation.reason, /currency differs/);
  assert.equal(fit.eligibility.status, 'unknown');
  assert.equal(fit.eligibility.actionable, false);
});

test('compensation stays unknown when no pay range is parsed', () => {
  for (const line of ['Compensation: competitive.', 'Salary undisclosed.', 'Total compensation discussed at offer stage.']) {
    const fit = score([...BASE_LINES, `${line} Remote work.`]);
    assert.equal(fit.dimensions.compensation.status, 'unknown', line);
    assert.equal(fit.dimensions.compensation.score, null, line);
  }
});

test('missing posting pay never becomes eligibility-by-assumption', () => {
  const fit = score([...BASE_LINES, 'Remote work.']);
  assert.equal(fit.dimensions.compensation.status, 'unknown');
  assert.equal(fit.eligibility.status, 'unknown');
  assert.equal(fit.eligibility.actionable, false);
  assert.equal(fit.eligibility.hardFailures.some(failure => failure.dimension === 'compensation'), false);
});

test('bonus and equity ranges are never counted toward the base-pay floor', () => {
  for (const line of ['Bonus range USD 90k-110k.', 'Equity range USD 90k-110k.']) {
    const fit = score([...BASE_LINES, `${line} Remote work.`]);
    assert.equal(fit.dimensions.compensation.status, 'unknown', line);
    assert.equal(fit.constraints.some(item => item.dimension === 'compensation' && item.status === 'confirmed'), false, line);
  }
});

test('the seven dimension weights still sum to 100', () => {
  assert.equal(Object.values(FIT_DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
  assert.equal(FIT_DIMENSION_WEIGHTS.compensation, 8);
  const fit = score([...BASE_LINES, `${PAY_LINE} Remote work.`]);
  assert.equal(Object.values(fit.dimensions).reduce((sum, dimension) => sum + dimension.weight, 0), 100);
});

test('overall moves only through the compensation dimension', () => {
  const withPay = score([...BASE_LINES, `${PAY_LINE} Remote work.`]);
  const withoutPay = score([...BASE_LINES, 'Remote work.']);
  assert.equal(withoutPay.dimensions.compensation.status, 'unknown');
  assert.equal(withPay.dimensions.compensation.status, 'scored');
  for (const key of Object.keys(FIT_DIMENSION_WEIGHTS)) {
    if (key === 'compensation') continue;
    assert.deepEqual(withPay.dimensions[key], withoutPay.dimensions[key], `dimension ${key} must not move with the pay line`);
  }
  assert.deepEqual(knownCoverage(withPay), { weight: withPay.evidenceCoverage, overall: withPay.overall });
  assert.deepEqual(knownCoverage(withoutPay), { weight: withoutPay.evidenceCoverage, overall: withoutPay.overall });
  assert.equal(withPay.evidenceCoverage - withoutPay.evidenceCoverage, FIT_DIMENSION_WEIGHTS.compensation);
  assert.notEqual(withPay.overall, withoutPay.overall);
});

test('scoring stays deterministic across runs', () => {
  const strip = fit => {
    const { generatedAt, ...rest } = fit;
    return rest;
  };
  const first = score([...BASE_LINES, `${PAY_LINE} Remote work.`]);
  const second = score([...BASE_LINES, `${PAY_LINE} Remote work.`]);
  assert.equal(typeof first.generatedAt, 'string');
  assert.deepEqual(strip(second), strip(first));
  assert.deepEqual(second.dimensions.compensation, first.dimensions.compensation);
});

test('score_job storage and get_score readback agree on the compensation dimension', t => {
  const dataDir = fs.mkdtempSync(path.join(process.env.JOBSSS_TEST_DATA || os.tmpdir(), 'scoring-pay-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const created = domain.createProfile(dataDir, { name: 'Riley Chen', resumeText: resume, preferences });
  const imported = domain.importJob(dataDir, { profileId: created.profileId, text: job([...BASE_LINES, `${PAY_LINE} Remote work.`]).description });
  const scored = domain.scoreJob(dataDir, { profileId: created.profileId, jobId: imported.jobId });
  assert.equal(scored.dimensions.compensation.status, 'scored');
  assert.equal(scored.dimensions.compensation.score, 85);
  const readback = domain.getScore(dataDir, { profileId: created.profileId, jobId: imported.jobId });
  assert.equal(readback.hasScore, true);
  assert.deepEqual(readback.score.dimensions, scored.dimensions);
  assert.equal(readback.score.overall, scored.overall);
  assert.equal(readback.score.scoreStatus, scored.scoreStatus);
  assert.deepEqual(readback.score.eligibility, scored.eligibility);
});
