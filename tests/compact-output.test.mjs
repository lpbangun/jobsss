import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as domain from '../src/domain.js';
import { prepareApplicationsBatch } from '../src/composition.js';
import { renderCoverLetterDocx } from '../src/docx.js';
import { applyHumanDecision, listPendingDecisions } from '../src/authority.js';

const resume = `Name: Casey Rivera\nEmail: casey@example.com\n2022-01 through 2025-12: Analyst, Cedar Research.\nBuilt SQL reporting tables for weekly inventory analysis.\nSkills: SQL, Python, reporting.\nEducation: BS in Information Systems.`;
const posting = `Title: Data Analyst\nCompany: Bay Software\nLocation: Remote US\nRequired: SQL reporting and Python analysis.\nPreferred: documentation.`;

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-compact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('compact mode keeps durable state while omitting automatic mirrors', t => {
  const dir = workspace(t);
  const started = domain.start(dir, { outputMode: 'compact' });
  assert.equal(started.outputMode, 'compact');
  assert.deepEqual(fs.readdirSync(dir), ['store.json']);
  const { profileId } = domain.createProfile(dir, { name: 'Casey', resumeText: resume });
  const { jobId } = domain.importJob(dir, { profileId, text: posting });
  domain.updateProfile(dir, { profileId, preferences: { communicationStyle: 'concise' } });
  const draft = domain.tailorResume(dir, { profileId, jobId, format: 'text' });
  assert.ok(draft.document.content);
  assert.deepEqual(fs.readdirSync(dir), ['store.json']);
  assert.equal(domain.listJobs(dir, { profileId }).jobs.length, 1);
  assert.equal(domain.getResume(dir, { profileId }).ok, true);
  assert.ok(domain.reviewQueue(dir, { profileId }).artifacts.some(item => item.id === draft.artifactId));
  assert.equal(domain.start(dir).outputMode, 'compact');
  assert.throws(() => domain.start(dir, { outputMode: 'full' }), { code: 'output_mode_migration_required' });
});

test('cover-letter DOCX retains editable applicant copy and exact export bytes', t => {
  const dir = workspace(t);
  domain.start(dir, { outputMode: 'compact' });
  const { profileId } = domain.createProfile(dir, { name: 'Casey', resumeText: resume });
  const { jobId } = domain.importJob(dir, { profileId, text: posting });
  const first = domain.draftCoverLetter(dir, { profileId, jobId });
  assert.equal(first.document.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(first.document.path, /\.docx$/);
  const bytes = fs.readFileSync(first.document.path);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.ok(bytes.includes(Buffer.from('word/document.xml')));
  assert.ok(bytes.includes(Buffer.from('Dear Hiring Team')));
  const again = domain.draftCoverLetter(dir, { profileId, jobId, format: 'docx' });
  assert.equal(again.artifactId, first.artifactId);
  assert.equal(again.document.path, first.document.path);
  assert.deepEqual(fs.readdirSync(dir).sort(), [path.basename(first.document.path), 'store.json'].sort());
  assert.throws(() => domain.tailorResume(dir, { profileId, jobId, format: 'docx' }), { code: 'unsupported_document_format' });
  const binding = listPendingDecisions(dir, { profileId }).items.find(item => item.artifactId === first.artifactId);
  fs.writeFileSync(first.document.path, Buffer.concat([bytes, Buffer.from('changed')]));
  assert.throws(() => applyHumanDecision(dir, { action: 'artifact.approve', id: binding.id,
    revision: binding.revision, contentHash: binding.contentHash }), { code: 'document_export_changed' });
  fs.writeFileSync(first.document.path, bytes);
  assert.equal(applyHumanDecision(dir, { action: 'artifact.approve', id: binding.id,
    revision: binding.revision, contentHash: binding.contentHash }).ok, true);
});

test('compact batch returns no links to omitted projection files', t => {
  const dir = workspace(t);
  domain.start(dir, { outputMode: 'compact' });
  const { profileId } = domain.createProfile(dir, { name: 'Casey', resumeText: resume });
  const { jobId } = domain.importJob(dir, { profileId, text: posting });
  const batch = prepareApplicationsBatch(dir, { profileId, jobIds: [jobId], format: 'text', coverLetter: true });
  assert.deepEqual(batch.projections, []);
  assert.equal(fs.existsSync(path.join(dir, 'applications')), false);
  assert.match(batch.items[0].artifacts.coverLetter.path, /\.docx$/);
  assert.equal(domain.listJobs(dir, { profileId }).jobs.length, 1);
});

test('DOCX XML preserves Unicode and escapes applicant text', () => {
  const bytes = renderCoverLetterDocx('A&B <C> — résumé');
  let offset = 0;
  let document = null;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    if (name === 'word/document.xml') document = bytes.subarray(dataStart, dataStart + size).toString('utf8');
    offset = dataStart + size;
  }
  assert.ok(document);
  assert.match(document, /A&amp;B &lt;C&gt; — résumé/);
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
});

test('CLI --compact selects the reduced layout at initialization', t => {
  const dir = workspace(t);
  const launcher = fileURLToPath(new URL('../bin/jobsss', import.meta.url));
  const run = spawnSync(process.execPath, [launcher, 'start', '--data', dir, '--compact'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).outputMode, 'compact');
  assert.deepEqual(fs.readdirSync(dir), ['store.json']);
});
