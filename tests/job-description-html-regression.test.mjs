import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  fetchGreenhouseOffline,
  fetchPublicJob,
  LEGACY_POSTING_LIVENESS_CONTRACTS,
  normalizePostingLivenessContract,
  POSTING_LIVENESS_CONTRACT,
  postingLivenessHandoff,
} from '../src/discovery.js';
import { postingRequirements } from '../src/resume-compiler.js';

function response(body, { status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': contentType }),
    async text() { return body; },
  };
}

function encodeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

test('public JobPosting JSON-LD keeps nested headings and requirement list blocks', async () => {
  const markup = [
    '<section><h2>What you will do</h2><p>Build reliable services for a growing platform.</p></section>',
    '<div><h2>Requirements</h2><ul><li><span>5+ years</span> of backend &amp; API experience</li>',
    '<li>Hands-on PostgreSQL experience</li></ul></div>',
    '<h3>Preferred</h3><ol><li>Experience with event-driven systems</li></ol>',
  ].join('');
  // Some publishers entity-encode the HTML twice inside the JSON-LD string.
  const description = encodeHtml(encodeHtml(markup));
  const page = `<html><head><title>Platform Engineer</title><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Platform Engineer',
    hiringOrganization: { name: 'Northwind Systems' },
    description,
  })}</script></head><body><p>Apply today</p></body></html>`;
  const requests = [];
  const fetchImpl = async url => {
    requests.push(String(url));
    return String(url).endsWith('/robots.txt')
      ? response('', { status: 404, contentType: 'text/plain' })
      : response(page);
  };

  const job = await fetchPublicJob('https://jobs.example.test/platform-engineer', {
    fetchImpl,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  const parsed = postingRequirements(job.description);

  assert.deepEqual(requests, [
    'https://jobs.example.test/robots.txt',
    'https://jobs.example.test/platform-engineer',
  ], 'HTML conversion must retain the robots-before-content fetch boundary');
  assert.match(job.description, /What you will do\n\nBuild reliable services/);
  assert.deepEqual(parsed.requirements.map(item => [item.text, item.priority]), [
    ['5+ years of backend & API experience', 'required'],
    ['Hands-on PostgreSQL experience', 'required'],
    ['Experience with event-driven systems', 'preferred'],
  ]);
});

test('public descriptions discard unterminated script and style tails', async () => {
  for (const [tag, payload] of [
    ['script', '<h2>Fake requirements</h2><ul><li>Hidden script credential</li></ul>'],
    ['style', '<h2>Fake requirements</h2><ul><li>Hidden style credential</li></ul>'],
  ]) {
    const markup = `<h2>Requirements</h2><ul><li>3+ years of SQL experience</li></ul><${tag}>${payload}`;
    const page = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Data Engineer',
      hiringOrganization: { name: 'Northwind Systems' },
      description: encodeHtml(encodeHtml(markup)),
    })}</script>`;
    const fetchImpl = async url => String(url).endsWith('/robots.txt')
      ? response('', { status: 404, contentType: 'text/plain' })
      : response(page);

    const job = await fetchPublicJob(`https://jobs.example.test/${tag}-tail`, {
      fetchImpl,
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    assert.doesNotMatch(job.description, /Fake requirements|Hidden (?:script|style) credential/);
    assert.deepEqual(postingRequirements(job.description).requirements.map(item => item.text), [
      '3+ years of SQL experience',
    ]);
  }
});

test('Greenhouse adapter keeps headings and list items in HTML descriptions', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-html-description-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const fixturePath = path.join(dataDir, 'board.json');
  fs.writeFileSync(fixturePath, JSON.stringify({ jobs: [{
    id: 41,
    title: 'Data Engineer',
    content: '<article><h2>Responsibilities</h2><p>Own the analytics pipeline.</p><h2>Requirements</h2><ul><li><b>4+ years</b> building data systems</li><li>SQL &amp; Python</li></ul></article>',
  }] }));

  const result = fetchGreenhouseOffline({ fixture: fixturePath, boardToken: 'example' }, { dataDir });
  const job = result.jobs[0];
  const parsed = postingRequirements(job.description);

  assert.match(job.description, /Responsibilities\n\nOwn the analytics pipeline/);
  assert.deepEqual(parsed.requirements.map(item => item.text), [
    '4+ years building data systems',
    'SQL & Python',
  ]);
});

test('posting liveness emits the standalone contract and recognizes its legacy alias', () => {
  const handoff = postingLivenessHandoff({ jobId: 'job-1', status: 'active', reasonCodes: [] });

  assert.equal(POSTING_LIVENESS_CONTRACT, 'jobsss.posting-liveness.v1');
  assert.equal(handoff.contract, POSTING_LIVENESS_CONTRACT);
  assert.deepEqual(LEGACY_POSTING_LIVENESS_CONTRACTS, ['jobos.posting-liveness.v1']);
  assert.equal(normalizePostingLivenessContract('jobos.posting-liveness.v1'), POSTING_LIVENESS_CONTRACT);
  assert.equal(normalizePostingLivenessContract('other.contract.v1'), '');
});
