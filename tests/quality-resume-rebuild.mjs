import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRITERION_IDS,
  checkCriterion,
  criterionDescription,
  loadEvidenceBundle,
} from './helpers/resume-rebuild-checks.mjs';

const bundle = loadEvidenceBundle();

for (const id of CRITERION_IDS) {
  test(`${id} ${criterionDescription(id)}`, () => {
    const verdict = checkCriterion(id, bundle);
    const detail = verdict.ok ? 'both artifacts satisfy the frozen criterion' : verdict.problems.slice(0, 3).join('; ');
    console.log(`${id}: ${verdict.ok ? 'PASS' : 'FAIL'} — ${detail} (${id}=${verdict.ok ? 'PASS' : 'FAIL'})`);
    assert.equal(verdict.ok, true, detail);
  });
}
