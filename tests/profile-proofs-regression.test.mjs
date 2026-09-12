// Lane rc4-profile-proofs: profile auto-derivation and proof extraction.
//
// Frozen regression for two intake defects:
//   1. create_profile stored the candidate NAME as preferences.targetRoleFamilies
//      and name tokens as preferences.skills, ignoring the resume's own headings
//      and Skills section.
//   2. Proof extraction kept only lines that happened to contain an allowlisted
//      action verb, so most experience bullets were dropped, and quantified
//      bullets kept an empty metrics array.
//
// Preserved by these tests: profile schema, proof object shape (metrics content
// added, no key renamed), verification statuses, resume storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as domain from '../src/domain.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(process.env.JOBSSS_TEST_DATA || os.tmpdir(), 'profile-proofs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const NAME = 'Avery Chen';

// Six experience bullets. Two contain an allowlisted action verb today
// (Built / Reduced); the other four (Cut, Migrated, Wrote, Partnered) do not,
// which is exactly how bullets were lost. "Missing:" names technologies the
// candidate does not have, so they must never become profile skills.
const RESUME = `Avery Chen
avery.chen@example.com | Chicago, Illinois, United States

EXPERIENCE
2022-01 through 2024-06 | Platform Engineer | Northwind Data | Remote
- Cut API p95 latency from 22m to 6m by rewriting the caching layer in 2024.
- Migrated 40 services off the legacy scheduler with zero downtime over two quarters in 2024.
- Built an ingestion pipeline processing 2.5M events/day on Kubernetes.
- Reduced missed SLA breaches 60% after adding alerting coverage in 2024.
- Wrote runbooks and onboarding docs used by the platform team.
- Partnered with support engineers to triage incidents each week.

SKILLS
Production: SQL, Python, Kubernetes, Terraform, dbt Core, GitHub Actions.
Missing: no production Java, Kafka, Flink or Spark.

EDUCATION
BS in Information Systems | Prairie Lake University | completed May 2021
`;

const QUANTIFIED = ['22m to 6m', '40 services', '2.5M events/day', '60%'];
const UNQUANTIFIED = ['Wrote runbooks', 'Partnered with support'];

function create(t, args = {}) {
  const data = workspace(t);
  const created = domain.createProfile(data, { name: NAME, resumeText: RESUME, ...args });
  return { data, created, proofs: created.proofPoints || [], preferences: created.profile.preferences };
}

function proofWith(proofs, fragment) {
  return proofs.find(proof => String(proof.summary || '').includes(fragment));
}

test('create_profile never turns the candidate name into a role family or skill', t => {
  const { preferences } = create(t);
  assert.ok(Array.isArray(preferences.targetRoleFamilies), 'targetRoleFamilies must stay an array');
  assert.ok(Array.isArray(preferences.skills), 'skills must stay an array');
  assert.ok(preferences.targetRoleFamilies.length > 0, `role families must come from the resume: ${JSON.stringify(preferences)}`);
  assert.deepEqual(
    preferences.targetRoleFamilies.filter(item => /avery|chen/i.test(String(item))),
    [], `name must never be a role family: ${JSON.stringify(preferences.targetRoleFamilies)}`
  );
  assert.deepEqual(
    preferences.skills.filter(item => /avery|chen/i.test(String(item))),
    [], `name must never be a skill: ${JSON.stringify(preferences.skills)}`
  );
});

test('role families derive from the resume experience headings, not the name line', t => {
  const { preferences } = create(t);
  assert.ok(
    preferences.targetRoleFamilies.some(item => /platform engineer/i.test(String(item))),
    `experience heading title must become a role family: ${JSON.stringify(preferences.targetRoleFamilies)}`
  );
});

test('Skills section populates preferences.skills and absent skills stay absent', t => {
  const { preferences } = create(t);
  const text = JSON.stringify(preferences.skills);
  for (const skill of ['SQL', 'Python', 'Kubernetes', 'Terraform', 'dbt Core']) {
    assert.match(text, new RegExp(skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `Skills section entry ${skill} missing: ${text}`);
  }
  for (const absent of ['Java', 'Kafka', 'Flink', 'Spark']) {
    assert.doesNotMatch(text, new RegExp(`\\b${absent}\\b`, 'i'), `missing-skill inventory must not become a skill: ${text}`);
  }
});

test('every experience bullet becomes a proof candidate', t => {
  const { proofs } = create(t);
  const summaries = proofs.map(proof => String(proof.summary || ''));
  for (const fragment of [...QUANTIFIED, ...UNQUANTIFIED]) {
    assert.ok(summaries.some(summary => summary.includes(fragment)), `bullet "${fragment}" was not extracted: ${JSON.stringify(summaries)}`);
  }
  assert.equal(summaries.filter(summary => /^- /.test(summary)).length, 0, 'bullet markers must be stripped from summaries');
  assert.ok(
    !summaries.some(summary => /Northwind Data|Platform Engineer \|/.test(summary)),
    `the dated role heading is not an achievement: ${JSON.stringify(summaries)}`
  );
});

test('quantified bullets carry their evident metrics', t => {
  const { proofs } = create(t);
  const expectations = new Map([
    ['22m to 6m', /22m/],
    ['40 services', /40/],
    ['2.5M events/day', /2\.5M/i],
    ['60%', /60%/]
  ]);
  for (const [fragment, pattern] of expectations) {
    const proof = proofWith(proofs, fragment);
    assert.ok(proof, `missing proof for ${fragment}`);
    const metrics = proof.metrics || [];
    assert.ok(metrics.length > 0, `metrics empty for quantified bullet "${fragment}": ${JSON.stringify(proof)}`);
    assert.match(metrics.join(' '), pattern, `metrics for "${fragment}" did not capture the number with its unit: ${JSON.stringify(metrics)}`);
  }
  const latency = proofWith(proofs, '22m to 6m');
  assert.match((latency.metrics || []).join(' '), /6m/, `both bounds of the latency claim must be kept: ${JSON.stringify(latency.metrics)}`);
  const services = proofWith(proofs, '40 services');
  assert.match((services.metrics || []).join(' '), /40/, `service count must be kept: ${JSON.stringify(services.metrics)}`);
});

test('unquantified bullets are still extracted with empty metrics', t => {
  const { proofs } = create(t);
  for (const fragment of UNQUANTIFIED) {
    const proof = proofWith(proofs, fragment);
    assert.ok(proof, `missing proof for ${fragment}`);
    assert.deepEqual(proof.metrics, [], `unquantified bullet must keep an empty metrics array: ${JSON.stringify(proof)}`);
  }
});

test('proof object shape, verification status and resume storage are preserved', t => {
  const { data, created, proofs } = create(t);
  assert.ok(proofs.length >= 6, `expected every bullet, got ${proofs.length}`);
  for (const proof of proofs) {
    for (const key of ['id', 'profileId', 'summary', 'skills', 'metrics', 'source', 'verification', 'status']) {
      assert.ok(Object.prototype.hasOwnProperty.call(proof, key), `proof key ${key} missing: ${JSON.stringify(proof)}`);
    }
    assert.equal(proof.profileId, created.profileId);
    assert.equal(proof.source, 'resume_import');
    assert.equal(proof.verification, 'human_required');
    assert.equal(proof.status, 'needs_verification');
    assert.ok(Array.isArray(proof.skills) && Array.isArray(proof.metrics));
  }
  const readback = domain.getResume(data, { profileId: created.profileId });
  assert.equal(readback.resumeText.trim(), RESUME.trim(), 'resume storage must round-trip unchanged');
  assert.equal(readback.identity.name, NAME);
  assert.equal(readback.verificationStatus, 'needs_verification');
  assert.equal(created.profile.resume.identity.name, NAME, 'resume schema must keep identity.verificationStatus shape');
  assert.equal(created.profile.resume.verificationStatus, 'needs_verification');
});

test('explicit preference arguments still win over resume derivation', t => {
  const { preferences } = create(t, { preferences: { targetRoleFamilies: ['Data Engineer'], skills: ['Rust'] } });
  assert.deepEqual(preferences.targetRoleFamilies, ['Data Engineer']);
  assert.deepEqual(preferences.skills, ['Rust']);
});
