import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileResumeDocument } from '../src/resume-compiler.js';
import { buildResumeMaterial, exportPdf } from '../src/documents.js';
import { detectResumeRenderer, renderResumeBrowser, resumeHtml } from '../src/resume-browser.js';
import { doctor, start, createProfile, importJob, tailorResume, inspectResumeRequirements, inspectResumeQa } from '../src/domain.js';
import { listPendingDecisions, applyHumanDecision } from '../src/authority.js';
import { commitStore, loadStore } from '../src/store.js';

const profileText = `Avery Example
New York City | avery@example.com

SUMMARY
Builder and trainer with experience in recruiting support and customer onboarding.

EXPERIENCE
Example Company - New York City
People Operations Associate | January 2024 - June 2025
- Assisted candidate screening and participated in interviews.
- Designed and delivered client onboarding sessions.

PROJECTS
Learning Prototype | Coursework project | 2025
- Built a prototype training guide for new users.

EDUCATION
Example University - New York City
Master of Education | May 2025

SKILLS
People: candidate screening, onboarding, documentation.
`;
const postingText = `Example role
What you will do
- Own interview scheduling and calendar logistics.
- Deliver customer onboarding sessions.
Nice to have
- Experience with Ashby is a plus.
`;

test('known and unknown employers compile through the same source-linked document', () => {
  for (const company of ['Known Company', 'Unknown company']) {
    const result = buildResumeMaterial({ id: 'profile-1', resumeText: profileText }, [], [],
      { job: { id: 'job-1', company, title: 'Recruiting Coordinator', description: postingText } });
    assert.ok(result.canonical);
    assert.equal(result.canonical.ir.candidateName, 'Avery Example');
    assert.equal(result.canonical.ir.schemaVersion, 2);
    assert.match(result.content, /Avery Example/);
    assert.match(result.content, /Learning Prototype/);
    assert.doesNotMatch(result.content, /Ashby experience/i);
    const claims = new Map(result.canonical.ledger.claims.map(claim => [claim.claimId, claim]));
    for (const node of result.canonical.ir.nodes) for (const id of node.claimIds) {
      assert.ok(claims.has(id));
      if (node.roleRef) assert.equal(claims.get(id).ownerId, `employment-${node.roleRef.roleIndex}`);
      if (node.ownerId) assert.equal(claims.get(id).ownerId, node.ownerId);
    }
    const scheduling = result.canonical.ledger.target.requirements.find(item => /scheduling/.test(item.text));
    assert.notEqual(scheduling.status, 'direct');
    assert.ok(scheduling.sourceLine > 0);
    assert.equal(result.canonical.ledger.target.requirements.at(-1).priority, 'preferred');
    assert.equal(scheduling.priority, 'contextual');
  }
});

test('identity and contact are required; selected contact replaces the source address', () => {
  assert.throws(() => compileResumeDocument({ profileText: profileText.replace('Avery Example', 'SUMMARY') }),
    error => error.code === 'resume_identity_missing');
  assert.throws(() => compileResumeDocument({ profileText: profileText.replace('avery@example.com', '') }),
    error => error.code === 'resume_contact_missing');
  assert.throws(() => compileResumeDocument({ profileText, locationNote: 'willing to relocate maybe' }),
    error => error.code === 'resume_location_note_invalid');
  const result = compileResumeDocument({ profileText, contactEmail: 'avery+job@example.com', locationNote: 'Open to San Francisco' });
  assert.equal(result.ir.contactEmail, 'avery+job@example.com');
  assert.match(resumeHtml(result.ir), /avery\+job@example.com/);
  assert.match(resumeHtml(result.ir), /Open to San Francisco/);
});

test('canonical claims carry proof verification and retired evidence cannot render', () => {
  const summary = 'Assisted candidate screening and participated in interviews.';
  const proof = { id: 'proof-screening', summary, status: 'needs_verification' };
  const args = { profileText, proofPoints: [proof], activeProofPointIds: [proof.id] };
  const draft = compileResumeDocument(args);
  const claim = draft.ledger.claims.find(item => item.sourceQuote === summary);
  assert.equal(claim.proofPointId, proof.id);
  assert.equal(claim.verificationStatus, 'needs_verification');
  assert.equal(claim.confidence, 'unverified');
  const verified = compileResumeDocument({ ...args, proofPoints: [{ ...proof, status: 'verified' }] });
  assert.equal(verified.ledger.claims.find(item => item.sourceQuote === summary).verificationStatus, 'verified');
  const retired = compileResumeDocument({ ...args, activeProofPointIds: [] });
  assert.doesNotMatch(retired.content, /Assisted candidate screening/);
});

test('private sections cannot enter the applicant projection or supply a missing header contact', () => {
  const withPrivate = `${profileText}\nPRIVATE NOTES\nDo not disclose salary target or visa strategy.\nprivate@example.com\n`;
  const result = compileResumeDocument({ profileText: withPrivate });
  assert.doesNotMatch(result.content, /salary target|visa strategy|private@example.com/);
  const noHeaderEmail = withPrivate.replace('avery@example.com', '');
  assert.throws(() => compileResumeDocument({ profileText: noHeaderEmail }),
    error => error.code === 'resume_contact_missing');
});

test('missing local resume browser fails with a typed capability error', () => {
  const previous = process.env.JOBSSS_RESUME_BROWSER;
  process.env.JOBSSS_RESUME_BROWSER = '/definitely/missing/chrome';
  try {
    assert.equal(detectResumeRenderer().available, false);
    const result = compileResumeDocument({ profileText });
    assert.throws(() => renderResumeBrowser(result.ir), error => error.code === 'resume_renderer_unavailable');
  } finally {
    if (previous === undefined) delete process.env.JOBSSS_RESUME_BROWSER;
    else process.env.JOBSSS_RESUME_BROWSER = previous;
  }
});

test('generic PDF export cannot silently render resume copy natively', () => {
  assert.throws(() => exportPdf('/tmp', 'Avery Example', { kind: 'resume' }),
    error => error.code === 'resume_document_required');
  assert.throws(() => exportPdf('/tmp', 'Avery Example'),
    error => error.code === 'document_kind_required');
});

test('doctor reports missing renderer and MCP domain never substitutes native PDF', () => {
  const previous = process.env.JOBSSS_RESUME_BROWSER;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-first-class-test-'));
  process.env.JOBSSS_RESUME_BROWSER = '/definitely/missing/chrome';
  try {
    assert.equal(doctor(dataDir).resumeRenderer.available, false);
    start(dataDir);
    const profile = createProfile(dataDir, { name: 'Avery Example', resumeText: profileText });
    const profileId = profile.profileId || profile.id;
    const job = importJob(dataDir, { profileId, text: `Company: Known Company\nTitle: Recruiting Coordinator\n${postingText}` });
    assert.throws(() => tailorResume(dataDir, { profileId, jobId: job.jobId || job.id, format: 'pdf' }),
      error => error.code === 'resume_renderer_unavailable');
  } finally {
    if (previous === undefined) delete process.env.JOBSSS_RESUME_BROWSER;
    else process.env.JOBSSS_RESUME_BROWSER = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('trusted approval blocks a canonical resume without rendered PDF QA', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-approval-'));
  try {
    start(dataDir);
    const profile = createProfile(dataDir, { name: 'Avery Example', resumeText: profileText });
    const profileId = profile.profileId || profile.id;
    const job = importJob(dataDir, { profileId, text: `Company: Example Company\nTitle: Recruiting Coordinator\n${postingText}` });
    const jobId = job.jobId || job.id;
    const draft = tailorResume(dataDir, { profileId, jobId, format: 'markdown' });
    const requirements = inspectResumeRequirements(dataDir, { profileId, jobId });
    assert.ok(requirements.items.some(item => item.sourceLine > 0 && item.priority));
    const qa = inspectResumeQa(dataDir, { profileId, artifactId: draft.artifactId });
    assert.equal(qa.canonical, true);
    assert.equal(qa.qa, null);
    const pending = listPendingDecisions(dataDir, { profileId }).items.find(item => item.id === draft.artifactId);
    assert.ok(pending);
    assert.throws(() => applyHumanDecision(dataDir, {
      action: 'artifact.approve', id: draft.artifactId, revision: pending.revision, contentHash: pending.contentHash,
    }), error => error.code === 'resume_qa_incomplete');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('visual PDF review and content approval remain separate trusted decisions', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-review-'));
  try {
    start(dataDir);
    const profile = createProfile(dataDir, { name: 'Avery Example', resumeText: profileText });
    const profileId = profile.profileId || profile.id;
    const job = importJob(dataDir, { profileId, text: `Company: Example Company\nTitle: Recruiting Coordinator\n${postingText}` });
    const draft = tailorResume(dataDir, { profileId, jobId: job.jobId || job.id, format: 'markdown' });
    commitStore(dataDir, {}, store => {
      store.artifacts[draft.artifactId].export = {
        engine: 'local-chrome-edge', pageSize: 'Letter', path: '/test/review.pdf',
        qa: { onePage: true, searchableTextMapping: true, layoutBoundsPx: { width: 700 },
          contentReview: 'required', visualReview: 'required' },
      };
      return store;
    });
    let pending = listPendingDecisions(dataDir, { profileId }).items.find(item => item.id === draft.artifactId);
    assert.equal(pending.kind, 'artifact.review_visual');
    assert.throws(() => applyHumanDecision(dataDir, {
      action: 'artifact.approve', id: draft.artifactId, revision: pending.revision, contentHash: pending.contentHash,
    }), error => error.code === 'resume_visual_review_required');
    applyHumanDecision(dataDir, {
      action: 'artifact.review_visual', id: draft.artifactId, revision: pending.revision, contentHash: pending.contentHash,
    });
    const artifact = loadStore(dataDir).artifacts[draft.artifactId];
    assert.equal(artifact.export.qa.visualReview, 'passed_by_trusted_local');
    assert.equal(artifact.export.qa.contentReview, 'required');
    assert.equal(artifact.approvedAt, undefined);
    pending = listPendingDecisions(dataDir, { profileId }).items.find(item => item.id === draft.artifactId);
    assert.equal(pending.kind, 'artifact.approve');
    assert.equal(pending.revision, 2);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('legacy labelled profile migrates into the same canonical tailoring route', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-migration-'));
  const oldBrowser = process.env.JOBSSS_RESUME_BROWSER;
  try {
    start(dataDir);
    const legacy = `Name: Avery Example\nEmail: avery@example.com\n\n## Employment\n2021-09 through 2024-06: Operations Analyst, Example Company.\n\n## Achievements\nA01 [EMP-E1]: Documented weekly operating handoffs and reduced preparation time from 6 hours to 2 hours.\n\n## Skills\nProduction: documentation, operations, coordination\n\n## Education\nEducation: BS in Information Systems, Example University, 2021.\n\n## Boundaries\nPrivate salary floor is not applicant copy.`;
    const profile = createProfile(dataDir, { name: 'Avery Example', resumeText: legacy });
    const profileId = profile.profileId || profile.id;
    const job = importJob(dataDir, { profileId, text: 'Company: Other Company\nTitle: Operations Coordinator\nRequired: documentation and coordination.' });
    const jobId = job.jobId || job.id;
    const draft = tailorResume(dataDir, { profileId, jobId, format: 'text' });
    assert.equal(draft.document.resumeDocument.ir.sourceFormat, 'migrated_legacy');
    assert.equal(draft.document.resumeDocument.ir.candidateName, 'Avery Example');
    assert.match(draft.document.content, /Example Company/);
    assert.match(draft.document.content, /Production: .*documentation/);
    assert.doesNotMatch(draft.document.content, /Private salary floor/);
    const migratedClaim = draft.document.resumeDocument.ledger.claims.find(item => /Documented weekly/.test(item.sourceQuote));
    assert.ok(migratedClaim.sourceLine > 0);
    assert.match(legacy.split('\n')[migratedClaim.sourceLine - 1], /Documented weekly/);
    process.env.JOBSSS_RESUME_BROWSER = '/definitely/missing/chrome';
    assert.throws(() => tailorResume(dataDir, { profileId, jobId, format: 'pdf' }),
      error => error.code === 'resume_renderer_unavailable');
  } finally {
    if (oldBrowser === undefined) delete process.env.JOBSSS_RESUME_BROWSER;
    else process.env.JOBSSS_RESUME_BROWSER = oldBrowser;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('legacy migration keeps original-line pointers and flags inferred matches', () => {
  const source = fs.readFileSync(new URL('./fixtures/captured-labeled-profile.md', import.meta.url), 'utf8');
  const result = buildResumeMaterial({ id: 'legacy-profile', name: 'Avery Chen', resumeText: source }, [], [],
    { job: { title: 'Analytics Engineer', company: 'Example' } });
  assert.equal(result.canonical.ir.sourceFormat, 'migrated_legacy');
  assert.ok(result.canonical.ledger.claims.every(claim => claim.sourceLine > 0));
  assert.ok(result.canonical.ledger.claims.some(claim => claim.sourceMatch === 'inferred_legacy_projection'
    && claim.transformation === 'legacy_projection'));
  for (const claim of result.canonical.ledger.claims) {
    assert.ok(source.split('\n')[claim.sourceLine - 1].trim());
  }
});

test('legacy private contact lines cannot enter the applicant header', () => {
  const source = `Name: Avery Example\nEmail: public@example.com\n\n## Employment\n2021-09 through 2024-06: Analyst, Example Company.\n\n## Achievements\nDocumented weekly operations.\n\n## Boundaries\nLocation: Secret City\nprivate@example.com`;
  const result = buildResumeMaterial({ id: 'private-legacy', name: 'Avery Example', resumeText: source }, [], [],
    { job: { title: 'Operations Analyst', company: 'Other' } });
  assert.match(result.content, /public@example.com/);
  assert.doesNotMatch(result.content, /Secret City|private@example.com/);
});

test('source-backed selection edits create a distinct reviewable resume revision', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-revision-'));
  try {
    start(dataDir);
    const profile = createProfile(dataDir, { name: 'Avery Example', resumeText: profileText });
    const profileId = profile.profileId || profile.id;
    const job = importJob(dataDir, { profileId, text: `Company: Example Company\nTitle: Recruiting Coordinator\n${postingText}` });
    const jobId = job.jobId || job.id;
    const original = tailorResume(dataDir, { profileId, jobId, format: 'markdown' });
    const claim = original.document.resumeDocument.ledger.claims.find(item => /Assisted candidate screening/.test(item.sourceQuote));
    assert.ok(claim);
    const revised = tailorResume(dataDir, { profileId, jobId, format: 'markdown', excludeClaimIds: [claim.claimId] });
    assert.notEqual(revised.artifactId, original.artifactId);
    assert.doesNotMatch(revised.document.content, /Assisted candidate screening/);
    assert.equal(revised.document.resumeDocument.ledger.claims.find(item => item.claimId === claim.claimId).status, 'suppressed');
    assert.throws(() => tailorResume(dataDir, { profileId, jobId, excludeClaimIds: ['CL-foreign'] }),
      error => error.code === 'resume_claim_invalid');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
