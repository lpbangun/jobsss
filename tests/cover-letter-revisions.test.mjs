import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as domain from '../src/domain.js';
import { loadStore } from '../src/store.js';
import { listPendingDecisions, applyHumanDecision } from '../src/authority.js';

function setup(t, outputMode = 'full') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-letter-revisions-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  domain.start(dataDir, { outputMode });
  const { profileId } = domain.createProfile(dataDir, { name: 'Casey Rivera', resumeText: 'Name: Casey Rivera\nEmail: casey@example.com\n2022-01 through 2025-12: Analyst, Cedar Research.\nBuilt SQL reporting tables for weekly inventory analysis.\nSkills: SQL, Python.\nEducation: BS in Information Systems.' });
  const { jobId } = domain.importJob(dataDir, { profileId, text: 'Title: Data Analyst\nCompany: Bay Software\nRequired: SQL reporting and Python analysis.' });
  const draft = domain.draftCoverLetter(dataDir, { requestedByUser: true, profileId, jobId, format: 'text' });
  const proofPointIds = Object.values(loadStore(dataDir).proofPoints).filter(proof => proof.profileId === profileId).map(proof => proof.id);
  const args = { profileId, jobId, artifactId: draft.artifactId, expectedContentHash: draft.contentHash,
    content: 'Dear Hiring Team,\n\nI built SQL reporting tables for weekly inventory analysis. I would like to discuss your reporting work.\n\nCasey Rivera\n', proofPointIds, format: 'text' };
  return { dataDir, draft, args };
}

test('an editorial revision preserves original approval and requires its own review across restart and regeneration', t => {
  const { dataDir, draft, args } = setup(t);
  const binding = listPendingDecisions(dataDir, { profileId: args.profileId }).items.find(item => item.artifactId === draft.artifactId);
  assert.ok(binding);
  applyHumanDecision(dataDir, { action: 'artifact.approve', id: binding.id, revision: binding.revision, contentHash: binding.contentHash });
  const original = structuredClone(loadStore(dataDir).artifacts[draft.artifactId]);
  const revised = domain.reviseCoverLetter(dataDir, args);
  assert.notEqual(revised.artifactId, draft.artifactId);
  assert.equal(revised.artifact.status, 'draft_needs_human_review');
  assert.equal(revised.artifact.revisionOf, draft.artifactId);
  assert.equal(revised.artifact.provenance.kind, 'editorial_revision');
  assert.equal(revised.artifact.approvedAt, undefined);
  assert.deepEqual(loadStore(dataDir).artifacts[draft.artifactId], original);
  domain.start(dataDir);
  domain.draftCoverLetter(dataDir, { requestedByUser: true, profileId: args.profileId, jobId: args.jobId, format: 'text' });
  assert.equal(loadStore(dataDir).artifacts[revised.artifactId].content, args.content);
  const repeated = domain.reviseCoverLetter(dataDir, args);
  assert.equal(repeated.artifactId, revised.artifactId);
  assert.equal(loadStore(dataDir).audit.filter(item => item.event === 'cover_letter_revised').length, 1);
});

test('revisions reject stale bases, empty text, missing evidence and cross-profile artifacts without persisting', t => {
  const { dataDir, args } = setup(t);
  const before = fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8');
  assert.throws(() => domain.reviseCoverLetter(dataDir, { ...args, expectedContentHash: 'stale' }), { code: 'stale_artifact' });
  assert.throws(() => domain.reviseCoverLetter(dataDir, { ...args, content: ' ' }), { code: 'invalid_cover_letter_content' });
  assert.throws(() => domain.reviseCoverLetter(dataDir, { ...args, proofPointIds: [] }), { code: 'missing_proof_ids' });
  assert.throws(() => domain.reviseCoverLetter(dataDir, { ...args, proofPointIds: ['missing'] }), { code: 'unknown_proof_point' });
  assert.throws(() => domain.reviseCoverLetter(dataDir, { ...args, jobId: 'wrong-job' }));
  assert.equal(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'), before);
});

test('compact revisions export editable DOCX under the same store without creating application mirrors', t => {
  const { dataDir, args } = setup(t, 'compact');
  const result = domain.reviseCoverLetter(dataDir, { ...args, format: 'docx' });
  assert.ok(fs.readFileSync(result.document.path).includes(Buffer.from('weekly inventory analysis')));
  assert.equal(path.dirname(result.document.path), dataDir);
  assert.equal(fs.existsSync(path.join(dataDir, 'applications')), false);
  assert.equal(domain.reviewQueue(dataDir, { profileId: args.profileId }).artifacts.some(item => item.id === result.artifactId), true);
  fs.appendFileSync(result.document.path, 'tampered');
  assert.throws(() => domain.reviseCoverLetter(dataDir, { ...args, format: 'docx' }), { code: 'document_export_changed' });
});

test('DOCX revision reuse accepts a symlinked PLUGIN_DATA alias', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-letter-alias-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const realDataDir = path.join(parent, 'real-data');
  const dataDirAlias = path.join(parent, 'data-alias');
  fs.mkdirSync(realDataDir);
  try {
    fs.symlinkSync(realDataDir, dataDirAlias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`host cannot create a PLUGIN_DATA directory link: ${error.message}`);
    return;
  }

  domain.start(dataDirAlias, { outputMode: 'compact' });
  const { profileId } = domain.createProfile(dataDirAlias, {
    name: 'Casey Rivera',
    resumeText: 'Name: Casey Rivera\nEmail: casey@example.com\n2022-01 through 2025-12: Analyst, Cedar Research.\nBuilt SQL reporting tables for weekly inventory analysis.\nSkills: SQL, Python.\nEducation: BS in Information Systems.',
  });
  const { jobId } = domain.importJob(dataDirAlias, { profileId, text: 'Title: Data Analyst\nCompany: Bay Software\nRequired: SQL reporting and Python analysis.' });
  const draft = domain.draftCoverLetter(dataDirAlias, { requestedByUser: true, profileId, jobId, format: 'text' });
  const proofPointIds = Object.values(loadStore(dataDirAlias).proofPoints)
    .filter(proof => proof.profileId === profileId).map(proof => proof.id);
  const args = {
    profileId, jobId, artifactId: draft.artifactId, expectedContentHash: draft.contentHash,
    content: 'Dear Hiring Team,\n\nI built SQL reporting tables for weekly inventory analysis.\n\nCasey Rivera',
    proofPointIds, format: 'docx',
  };

  const first = domain.reviseCoverLetter(dataDirAlias, args);
  const repeated = domain.reviseCoverLetter(dataDirAlias, args);

  assert.equal(path.dirname(first.document.path), fs.realpathSync(dataDirAlias));
  assert.equal(repeated.artifactId, first.artifactId);
  assert.equal(repeated.document.path, first.document.path);
});
