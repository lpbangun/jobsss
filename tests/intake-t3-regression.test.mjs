import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseJobText } from '../src/discovery.js';
import * as domain from '../src/domain.js';
import { hashText } from '../src/store.js';

const FROZEN_T3 = `# Senior Backend Engineer
Acme Synthetic Systems — Lisbon, Portugal
Work model: Hybrid (3 days onsite / 2 remote)
Pay: EUR 90,000 - 110,000 base (no bonus claimed)

We are hiring a Senior Backend Engineer for the public-API platform.

Responsibilities:
- Design and operate HTTP services.
- Review code and mentor engineers.

Requirements:
- 5+ years of backend experience
- PostgreSQL
- Strong written communication`;

function workspace(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('frozen T3 extracts title, company, location, hybrid, and Pay range', () => {
  const parsed = parseJobText(FROZEN_T3);

  assert.equal(parsed.title, 'Senior Backend Engineer');
  assert.equal(parsed.company, 'Acme Synthetic Systems');
  assert.equal(parsed.location, 'Lisbon, Portugal');
  assert.equal(parsed.workModel, 'hybrid');
  assert.equal(parsed.compensation, 'EUR 90,000 - 110,000 base (no bonus claimed)');
  assert.equal(parsed.compensationJson.text, 'Pay: EUR 90,000 - 110,000 base (no bonus claimed)');
  assert.equal(parsed.compensationJson.min, 90000);
  assert.equal(parsed.compensationJson.max, 110000);
  assert.equal(parsed.compensationJson.currency, 'EUR');
});

test('remote-only and onsite-only work-model controls remain canonical', () => {
  const remote = parseJobText('# Backend Engineer\nWork model: Remote only\n');
  const onsite = parseJobText('# Backend Engineer\nWork model: Onsite (5 days)\n');

  assert.equal(remote.workModel, 'remote');
  assert.equal(onsite.workModel, 'onsite');
});

test('hyphenated titles and unrelated prose are not identity lines', () => {
  const title = parseJobText('# 24-7 Support Engineer\n3-6 years of experience - backend APIs\nWork model: remote\n');
  const prose = parseJobText('# Platform Engineer\nWe design APIs — and collaborate with teams.\nWork model: remote\n');

  assert.equal(title.title, '24-7 Support Engineer');
  assert.equal(title.company, 'Unknown company');
  assert.equal(title.location, '');
  assert.equal(prose.title, 'Platform Engineer');
  assert.equal(prose.company, 'Unknown company');
  assert.equal(prose.location, '');
});

test('company/location-shaped prose is not treated as an identity line', () => {
  const sentence = parseJobText('# Platform Engineer\nWe build reliable services — Lisbon, Portugal\nWork model: remote\n');
  const experience = parseJobText('# Backend Engineer\nCandidates with 3-5 years of experience — Lisbon, Portugal\nWork model: remote\n');

  assert.equal(sentence.company, 'Unknown company');
  assert.equal(sentence.location, '');
  assert.equal(experience.company, 'Unknown company');
  assert.equal(experience.location, '');
});

test('work-model descriptors are not company identities', () => {
  const descriptor = parseJobText('# Senior Backend Engineer\nRemote — US, Canada\nWork model: Remote\n');

  assert.equal(descriptor.company, 'Unknown company');
  assert.equal(descriptor.location, '');
});

test('existing labeled title, company, location, and salary imports still work', () => {
  const parsed = parseJobText('Title: Platform Analyst\nCompany: Cedar Harbor\nLocation: remote US\nSalary: USD 70,000 - 80,000\n');

  assert.equal(parsed.title, 'Platform Analyst');
  assert.equal(parsed.company, 'Cedar Harbor');
  assert.equal(parsed.location, 'remote US');
  assert.equal(parsed.workModel, 'unknown');
  assert.equal(parsed.compensation, 'USD 70,000 - 80,000');
  assert.equal(parsed.compensationJson.min, 70000);
  assert.equal(parsed.compensationJson.max, 80000);
  assert.equal(parsed.compensationJson.currency, 'USD');
});

test('Pay is a fallback after existing salary labels', () => {
  const parsed = parseJobText('# Backend Engineer\nPay: EUR 90,000 - 110,000\nSalary: USD 100,000 - 110,000\nBase salary: USD 120,000 - 130,000\n');

  assert.equal(parsed.compensation, 'USD 120,000 - 130,000');
  assert.equal(parsed.compensationJson.min, 120000);
  assert.equal(parsed.compensationJson.max, 130000);
  assert.equal(parsed.compensationJson.currency, 'USD');
});

test('Pay-related prose containing experience ranges is not numeric compensation', () => {
  const parsed = parseJobText('# Backend Engineer\nPay: competitive for candidates with 3-5 years of experience.\n');

  assert.equal(parsed.compensation, 'competitive for candidates with 3-5 years of experience.');
  assert.equal(parsed.compensationJson.min, null);
  assert.equal(parsed.compensationJson.max, null);
});

test('a non-numeric Pay fallback preserves whole-source numeric extraction', () => {
  const parsed = parseJobText('# Backend Engineer\nPay: competitive\nWe offer USD 140,000 - 160,000 per year.\n');

  assert.equal(parsed.compensation, 'competitive');
  assert.equal(parsed.compensationJson.min, 140000);
  assert.equal(parsed.compensationJson.max, 160000);
  assert.equal(parsed.compensationJson.currency, 'USD');
});

test('import_job retains requirements and existing trimmed source/hash/dedupe behavior', t => {
  const dataDir = workspace(t, 'intake-t3-source');
  const { profileId } = domain.createProfile(dataDir, { name: 'T3 intake profile' });
  const padded = `\n${FROZEN_T3}\n\n`;

  const first = domain.importJob(dataDir, { profileId, text: padded });
  assert.equal(first.job.description, FROZEN_T3);
  assert.equal(first.job.sourceHash, hashText(FROZEN_T3));
  assert.match(first.job.description, /Requirements:\n- 5\+ years of backend experience\n- PostgreSQL\n- Strong written communication/);
  assert.equal(first.job.company, 'Acme Synthetic Systems');
  assert.equal(first.job.location, 'Lisbon, Portugal');
  assert.equal(first.job.workModel, 'hybrid');

  const again = domain.importJob(dataDir, { profileId, text: padded });
  assert.equal(again.deduped, true);
  assert.equal(again.jobId, first.jobId);
  assert.equal(again.job.sourceHash, first.job.sourceHash);
});
