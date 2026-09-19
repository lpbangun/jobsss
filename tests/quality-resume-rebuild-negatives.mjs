import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRITERION_IDS,
  applyNegativeMutation,
  barVerdict,
  buildConformanceBundle,
  checkCriterion,
} from './helpers/resume-rebuild-checks.mjs';

const conformance = buildConformanceBundle();

function assertDetected(id, variants, expectedByVariant) {
  for (const variant of variants) {
    const mutated = applyNegativeMutation(conformance, id, variant);
    if (id === "RR-N6") assert.equal(mutated.artifacts.A.renderEvidence.primary.extraction.text.includes("\ufb03"), true, "RR-N6 must exercise the exact U+FB03 ligature branch");
    const expected = expectedByVariant[variant] || expectedByVariant.a;
    for (const criterion of expected) {
      const verdict = checkCriterion(criterion, mutated);
      assert.equal(verdict.ok, false, `${id}${variant}: ${criterion} unexpectedly passed`);
    }
    assert.equal(barVerdict(mutated).ok, false, `${id}${variant}: aggregate bar unexpectedly passed`);
  }
  console.log(`${id}=DETECTED`);
}

test('RR-N0 VALID conformance bundle', () => {
  const verdict = barVerdict(conformance);
  assert.equal(verdict.ok, true, verdict.checks && JSON.stringify(Object.fromEntries(
    Object.entries(verdict.checks).filter(([, item]) => !item.ok).map(([id, item]) => [id, item.problems]),
  )));
  console.log('RR-N0=VALID');
});

test('RR-N1 detects invented metric and outcome', () => {
  assertDetected('RR-N1', ['a'], { a: ['RR-01', 'RR-06'] });
});

test('RR-N2 detects unsupported ownership verb and moved role', () => {
  assertDetected('RR-N2', ['a', 'b'], {
    a: ['RR-01', 'RR-06'],
    b: ['RR-03'],
  });
});

test('RR-N3 detects target leakage in summary and header', () => {
  assertDetected('RR-N3', ['a', 'b'], { a: ['RR-05'], b: ['RR-05'] });
});

test('RR-N4 detects empty skill group and unbacked bullet', () => {
  assertDetected('RR-N4', ['a', 'b'], {
    a: ['RR-09'],
    b: ['RR-01'],
  });
});

test('RR-N5 detects dropped required IR node', () => {
  assertDetected('RR-N5', ['a'], { a: ['RR-12'] });
});

test('RR-N6 detects hostile glyphs and malformed Unicode', () => {
  assertDetected('RR-N6', ['a'], { a: ['RR-10'] });
});

test('RR-N7 detects swapped extraction order', () => {
  assertDetected('RR-N7', ['a', 'b'], {
    a: ['RR-10'],
    b: ['RR-10', 'RR-03'],
  });
});

test('RR-N8 detects renderer padding and invisible text', () => {
  assertDetected('RR-N8', ['a', 'b'], {
    a: ['RR-12'],
    b: ['RR-11'],
  });
});
