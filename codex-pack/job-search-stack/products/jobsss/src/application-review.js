import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadStore, commitStore, hashText, now, writeFileAtomic } from './store.js';
import { renderResumeBrowser } from './resume-browser.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => hashText(JSON.stringify(value));
// Frozen resume-quality.v2 values; the regression below verifies these against the existing rubric.
export const applicationResumeRubric = { minFill: 0.88, maxFill: 0.96, minBodyPt: 9.5, maxGapPx: 36 };
export const applicationQualityThreshold = 9;
function requiredQualityCriteria(review) {
  const requirements = [
    ...['intake', 'evidence'].flatMap(scope => ['accuracy', 'sufficiency', 'provenance'].map(key => `${scope}.${key}`)),
    ...['factualSupport', 'employerRelevance', 'voiceFidelity', 'completeness', 'visualQuality'].map(key => `resume.${key}`),
  ];
  for (const field of review.fields.filter(f => f.type !== 'file' && String(review.answers[f.id]?.value || '').trim())) for (const criterion of ['factualSupport', 'employerRelevance', 'voiceFidelity', 'completeness']) requirements.push(`answer:${field.id}.${criterion}`);
  return requirements;
}
function owned(store, { profileId, jobId }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId || '')) fail('invalid_job_id', 'Use the stored application identifier.');
  if (!store.profiles[profileId] || store.profiles[profileId].archivedAt) fail('unknown_profile', 'Select an active profile.');
  if (!store.jobs[jobId] || store.jobs[jobId].profileId !== profileId) fail('ownership_mismatch', 'Job does not belong to this profile.');
  if (store.applications[jobId] && store.applications[jobId].profileId !== profileId) fail('ownership_mismatch', 'Application profile mismatch.');
  return store.jobs[jobId];
}
function mutate(dataDir, args, operation) {
  if (!Number.isInteger(args.expectedRevision)) fail('missing_revision', 'expectedRevision is required.');
  let value;
  const result = commitStore(dataDir, { expectedRevision: args.expectedRevision }, store => {
    const job = owned(store, args);
    const app = store.applications[args.jobId] ||= { id: args.jobId, jobId: args.jobId, profileId: args.profileId, status: 'new', localOnly: true };
    value = operation(store, job, app);
    store.audit.push({ event: 'application_review', jobId: args.jobId, profileId: args.profileId, createdAt: now(), version: app.review?.version });
    return store;
  });
  return { ...clone(value), revision: result.revision };
}
function current(app) { if (!app.review) fail('review_missing', 'Prepare the application review first.'); return app.review; }
function invalidate(review) {
  review.version += 1; review.updatedAt = now(); review.approval = null; review.staged = null; review.resumeArtifact = null;
  review.qualityReview = null;
}
function fieldsOf(fields) {
  if (!Array.isArray(fields) || fields.length > 100) fail('invalid_fields', 'Provide observed application fields, at most 100.');
  const ids = new Set();
  return fields.map(field => {
    if (!field?.id || !field.label || ids.has(field.id)) fail('invalid_fields', 'Each field needs a unique id and a label.');
    ids.add(field.id);
    if (!['text', 'textarea', 'select', 'checkbox', 'file'].includes(field.type || 'text')) fail('unsupported_field', 'Unsupported field type.');
    for (const key of ['maxLength', 'maxFileBytes']) if (field[key] != null && (!Number.isInteger(field[key]) || field[key] < 0)) fail('invalid_field_limit', 'Observed limits must be nonnegative integers.');
    return { id: String(field.id), label: String(field.label), type: field.type || 'text', required: Boolean(field.required), userExpected: field.userExpected === true, expectationSource: String(field.expectationSource || ''), options: field.options || [], locator: field.locator || null, sensitive: Boolean(field.sensitive), source: String(field.source || ''), constraintsObserved: field.constraintsObserved === true, maxLength: field.maxLength ?? null, accept: String(field.accept || ''), maxFileBytes: field.maxFileBytes ?? null };
  });
}
export function prepareApplicationReview(dataDir, args) {
  return mutate(dataDir, args, (store, job, app) => {
    const fields = fieldsOf(args.fields);
    const applicability = { resume: { applicable: true, reason: 'Resume is in the requested application-preparation scope.' }, coverLetter: { applicable: args.fieldsComplete !== true ? null : fields.some(f => f.type === 'file' && f.required && /letter/i.test(f.id + ' ' + f.label)), reason: args.fieldsComplete !== true ? 'Unknown until the complete form is inspected.' : 'Required letter fields are applicable; an absent or optional letter is not automatically generated.' }, contacts: { applicable: false, reason: 'No contact-discovery work in this application-staging scope.' }, outreach: { applicable: false, reason: 'No outreach variations in this application-staging scope.' }, frozenAt: now() };
    const source = { url: String(args.sourceUrl || job.url || ''), posting: String(job.postingText || job.description || ''), formUrl: String(args.formUrl || args.sourceUrl || job.url || ''), ownerThreadId: args.ownerThreadId || null, capturedAt: now(), fieldsComplete: args.fieldsComplete === true };
    if (!/^https?:\/\//.test(source.formUrl) || !/^https?:\/\//.test(source.url)) fail('invalid_destination', 'An observed application URL and posting URL are required.');
    if (app.review) {
      const review = app.review;
      if (digest({ ...source, capturedAt: null }) !== digest({ ...review.source, capturedAt: null }) || digest(fields) !== digest(review.fields)) {
        invalidate(review); review.source = source; review.fields = fields; review.applicability = applicability;
      }
      return review;
    }
    const artifact = args.artifactId ? store.artifacts[args.artifactId] : null;
    if (artifact && (artifact.profileId !== args.profileId || artifact.jobId !== args.jobId)) fail('ownership_mismatch', 'Resume artifact ownership mismatch.');
    const initialResume = artifact?.resumeDocument ? clone(artifact.resumeDocument) : null;
    if (initialResume) validateDocument(initialResume);
    app.review = { schema: 'jobsss.application-review.v1', version: 1, profileId: args.profileId, jobId: args.jobId, source, fields, applicability, answers: {}, facts: {}, resume: initialResume, resumeBaseline: initialResume ? clone(initialResume) : null, editedNodes: [], generations: [], approval: null, staged: null, resumeArtifact: null, updatedAt: now() };
    return app.review;
  });
}
export function getApplicationReview(dataDir, args) {
  const store = loadStore(dataDir); owned(store, args);
  const review = clone(current(store.applications[args.jobId] || {}));
  const audit = auditReview(review, store); const quality = qualityIssues(review);
  return { ...review, revision: store.revision, audit: { ready: audit.ready && !quality.length, issues: [...audit.issues, ...quality] }, qualityReviewBrief: { contentHash: digest({ answers: review.answers, resume: review.resume }), postingHash: digest(review.source.posting), resumeSha256: review.resumeArtifact?.sha256 || null, criteria: requiredQualityCriteria(review), thresholdEach: applicationQualityThreshold, scoreMeaning: '10: no identified improvement; 9: ready for human use with minor optional polish; 8 or below: material revision required. Unknown or missing evidence cannot pass. Technical failures override scores.', explicitlyNotApplicable: ['coverLetter', 'contacts', 'outreach'], rubric: applicationResumeRubric }, generationBrief: { posting: review.source.posting, fields: review.fields, missingQuestions: review.fields.filter(f => (f.required || f.userExpected) && f.type !== 'file' && !review.answers[f.id]?.value).map(f => ({ id: f.id, question: f.label })), confirmedFacts: Object.values(review.facts).filter(f => f.confirmed), resume: review.resume, userEdits: Object.entries(review.answers).filter(([, a]) => a.edited) } };
}
export function saveApplicationGeneration(dataDir, args) {
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app);
    if ((!review.source.fieldsComplete || Object.values(review.applicability || {}).some(scope => scope?.applicable === null)) && args.draftOnly !== true) fail('applicability_unresolved', 'Inspect the actual complete form and freeze applicability before drafting, or explicitly save an unapproved partial draft.');
    if (!args.provenance?.provider || !args.provenance?.runId) fail('missing_provenance', 'Provide host generation provider and runId; no model is invoked by this runtime.');
    const proposed = args.answers || {};
    for (const id of Object.keys(proposed)) if (!review.fields.some(f => f.id === id && f.type !== 'file')) fail('unknown_field', id);
    const before = digest({ answers: review.answers, resume: review.resume });
    for (const [id, answer] of Object.entries(proposed)) if (!review.answers[id]?.edited) review.answers[id] = { value: String(answer.value ?? ''), proofIds: answer.proofIds || [], kind: answer.kind || 'factual', edited: false, confirmed: false };
    if (args.resume) {
      validateDocument(args.resume);
      const proposedResume = clone(args.resume);
      if (review.resume) for (const id of review.editedNodes) {
        const edited = review.resume.nodes.find(n => n.id === id);
        const index = proposedResume.nodes.findIndex(n => n.id === id);
        if (edited && index >= 0) proposedResume.nodes[index] = edited;
        else if (edited) proposedResume.nodes.push(edited);
      }
      if (review.editedHeadline && review.resume) { proposedResume.headline = review.resume.headline; proposedResume.headlineKind = review.resume.headlineKind; }
      review.resume = proposedResume;
      if (!review.resumeBaseline) review.resumeBaseline = clone(proposedResume);
    }
    if (before !== digest({ answers: review.answers, resume: review.resume })) invalidate(review);
    review.generations.push({ provenance: clone(args.provenance), draftOnly: args.draftOnly === true, at: now(), proposalHash: digest({ answers: proposed, resume: args.resume || null }) });
    review.generationRequest = null;
    return review;
  });
}
export function requestApplicationGeneration(dataDir, args) {
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app);
    review.generationRequest = { status: 'pending_host', requestedAt: now(), version: review.version };
    return review;
  });
}
function validateDocument(document) {
  if (!document?.candidateName || !document.contactEmail || !Array.isArray(document.nodes) || document.nodes.length > 300) fail('invalid_resume', 'Provide the canonical resume document with candidateName, contactEmail and nodes.');
  const ids = new Set();
  for (const node of document.nodes) {
    node.id ||= node.nodeId;
    if (!node.id || ids.has(node.id) || typeof node.text !== 'string') fail('invalid_resume', 'Resume nodes need unique ids and text.');
    ids.add(node.id);
  }
  // Compiler skill rows mirror their preceding group's items. In the editable
  // document the group owns these values, avoiding stale duplicate rows after edits.
  let group = null;
  document.nodes = document.nodes.filter(node => {
    if (node.type === 'skill' && group) { group.claimIds = [...new Set([...(group.claimIds || []), ...(node.claimIds || [])])]; return false; }
    group = node.type === 'skills_group' && Array.isArray(node.items) ? node : null;
    return true;
  });
}
// This edits drafts only. Confirmation and approval are never exposed through MCP.
export function editApplicationReview(dataDir, args, { human = false } = {}) {
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app); const patch = args.patch || {};
    if (patch.resumeHeader) {
      if (!review.resume || typeof patch.resumeHeader.headline !== 'string') fail('invalid_resume_header', 'Provide an authored headline for the existing resume.');
      review.resume.headline = patch.resumeHeader.headline; review.resume.headlineKind = 'authored_positioning'; review.editedHeadline = true; delete review.facts['resume:headline'];
    }
    for (const [id, value] of Object.entries(patch.answers || {})) {
      const field = review.fields.find(f => f.id === id && f.type !== 'file');
      if (!field) fail('unknown_field', id);
      review.answers[id] = { ...review.answers[id], value: String(value), edited: true, confirmed: false };
    }
    for (const [id, text] of Object.entries(patch.resumeNodes || {})) {
      const node = review.resume?.nodes.find(n => n.id === id);
      if (!node) fail('unknown_resume_node', id);
      node.text = String(text); if (!review.editedNodes.includes(id)) review.editedNodes.push(id);
      if (node.type === 'name') review.resume.candidateName = node.text;
      if (node.type === 'contact') { const match = node.text.match(/[^\s|]+@[^\s|]+\.[^\s|]+/); if (!match) fail('invalid_resume', 'Contact needs an email.'); review.resume.contactEmail = match[0]; }
      delete review.facts['resume:' + id];
    }
    for (const [id, items] of Object.entries(patch.resumeItems || {})) {
      const node = review.resume?.nodes.find(n => n.id === id);
      if (!node || !Array.isArray(node.items) || !Array.isArray(items) || items.some(item => typeof item !== 'string')) fail('invalid_resume_items', 'Select an existing resume group and provide text items.');
      node.items = items;
      if (!review.editedNodes.includes(id)) review.editedNodes.push(id);
      delete review.facts['resume:' + id];
    }
    for (const [id, text] of Object.entries(patch.facts || {})) review.facts[id] = { id, text: String(text), confirmed: false };
    if (patch.confirmAnswers || patch.confirmNodes || patch.confirmFacts || patch.confirmHeadline) {
      if (!human) fail('human_confirmation_required', 'Confirm facts and answers on the local review page.');
      for (const id of patch.confirmAnswers || []) { if (!review.answers[id]) fail('unknown_field', id); review.answers[id].confirmed = true; }
      for (const id of patch.confirmNodes || []) { const node = review.resume?.nodes.find(n => n.id === id); if (!node) fail('unknown_resume_node', id); review.facts['resume:' + id] = { id: 'resume:' + id, text: [node.text, ...(node.items || [])].filter(Boolean).join('\n'), nodeHash: digest({ text: node.text, items: node.items || [] }), confirmed: true }; }
      for (const id of patch.confirmFacts || []) { if (!review.facts[id]) fail('unknown_fact', id); review.facts[id].confirmed = true; }
      if (patch.confirmHeadline && review.resume?.headline) review.facts['resume:headline'] = { id: 'resume:headline', text: review.resume.headline, confirmed: true };
    }
    invalidate(review);
    return review;
  });
}
function supported(answer, store, profileId) {
  if (answer.confirmed) return true;
  const text = String(answer.value || '').trim();
  return text.length > 0 && (answer.proofIds || []).some(id => {
    const proof = store.proofPoints[id];
    return proof?.profileId === profileId && (proof.verified === true || proof.verificationStatus === 'verified') && String(proof.summary || proof.text || '').includes(text);
  });
}
export function auditReview(review, store) {
  const issues = [];
  if (!review.source.fieldsComplete) issues.push({ code: 'form_inventory_incomplete', message: 'Inspect the complete current application form before review.' });
  for (const field of review.fields) {
    if (!field.constraintsObserved || !field.source) issues.push({ code: 'field_constraints_unobserved', fieldId: field.id, message: 'Inspect required status, character limits and file constraints; record source evidence, including an observed absence of limits.' });
    if (field.type === 'file') { if (field.id !== 'resume' && (field.required || field.userExpected)) issues.push({ code: 'unsupported_attachment', fieldId: field.id }); continue; }
    const answer = review.answers[field.id]; const value = String(answer?.value || '').trim();
    if ((field.required || field.userExpected) && (!value || (field.type === 'checkbox' && value !== 'true'))) issues.push({ code: field.required ? 'required_answer_missing' : 'expected_answer_missing', fieldId: field.id, message: field.label });
    if (field.userExpected && !field.expectationSource) issues.push({ code: 'expectation_source_missing', fieldId: field.id, message: 'Record the user instruction or agreed application scope that makes this field expected.' });
    if (value && field.type === 'select' && !field.options.includes(value)) issues.push({ code: 'invalid_option', fieldId: field.id });
    if (field.maxLength != null && value.length > field.maxLength) issues.push({ code: 'answer_limit_exceeded', fieldId: field.id, message: `Maximum ${field.maxLength} characters.` });
    if (value && !supported(answer, store, review.profileId)) issues.push({ code: field.sensitive ? 'user_decision_required' : 'unsupported_answer', fieldId: field.id });
  }
  if (!review.resume) issues.push({ code: 'resume_missing' });
  else for (const node of review.resume.nodes.filter(n => n.renderPolicy === 'required' && !['section_heading'].includes(n.type))) {
    const baseline = review.resumeBaseline?.nodes.find(n => n.id === node.id);
    const fact = review.facts['resume:' + node.id];
    if (!node.text.trim() && !node.items?.some(item => item.trim())) issues.push({ code: 'empty_resume_node', nodeId: node.id });
    else if (!(fact?.confirmed && fact.nodeHash === digest({ text: node.text, items: node.items || [] })) && !(baseline?.text === node.text && !node.items?.length && baseline?.proofIds?.length && supported({ value: node.text, proofIds: baseline.proofIds }, store, review.profileId))) issues.push({ code: 'resume_claim_confirmation_required', nodeId: node.id });
  }
  if (review.resume?.headline && !(review.facts['resume:headline']?.confirmed && review.facts['resume:headline'].text === review.resume.headline)) issues.push({ code: 'resume_headline_confirmation_required' });
  return { ready: !issues.length, issues };
}
function qualityIssues(review) {
  const issues = [];
  const qa = review.resumeArtifact?.qa;
  const upload = review.fields.find(f => f.id === 'resume' && f.type === 'file');
  if (upload?.maxFileBytes != null && review.resumeArtifact?.size > upload.maxFileBytes) issues.push({ code: 'resume_file_limit_exceeded' });
  if (upload?.accept && !upload.accept.split(',').some(type => ['.pdf', 'application/pdf', '*/*', 'application/*'].includes(type.trim().toLowerCase()))) issues.push({ code: 'resume_file_type_unsupported' });
  if (!qa || qa.onePage !== true || qa.searchableTextMapping !== true || !Number.isFinite(qa.visibleFill) || qa.visibleFill < applicationResumeRubric.minFill || qa.visibleFill > applicationResumeRubric.maxFill || !(qa.minBodyPt >= applicationResumeRubric.minBodyPt) || !(qa.maxGapPx <= applicationResumeRubric.maxGapPx)) issues.push({ code: 'resume_presentation_unresolved', message: 'Existing quality bar: one searchable Letter page, 88–96% fill, body type at least 9.5pt and no unexplained gaps above 36px.' });
  if (review.resume?.nodes.some(n => /\[[^\]]+\]\([^)]+\)/.test(n.text))) issues.push({ code: 'literal_markdown_links', message: 'Applicant resume copy must not contain literal Markdown links.' });
  if (!review.qualityReview || review.qualityReview.contentHash !== digest({ answers: review.answers, resume: review.resume }) || requiredQualityCriteria(review).some(key => !Number.isFinite(review.qualityReview.criteria[key]) || review.qualityReview.criteria[key] < applicationQualityThreshold)) issues.push({ code: 'independent_content_review_required', message: 'Every intake, evidence, resume and individual-answer criterion must independently score at least 9. Unknown evidence, averages and technical failures cannot pass. Fit gaps remain separate.' });
  return issues;
}
export function recordApplicationQualityReview(dataDir, args) {
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app);
    if (!args.provenance?.provider || !args.provenance?.runId || args.independent !== true || !args.notes || !args.criteria || requiredQualityCriteria(review).some(key => args.criteria[key] !== null && (!Number.isFinite(args.criteria[key]) || args.criteria[key] < 0 || args.criteria[key] > 10))) fail('invalid_quality_review', 'Provide actual independent reviewer provenance, each 0–10 criterion score (or null for unknown), and evidence-backed notes.');
    for (const scope of ['coverLetter', 'contacts', 'outreach']) if (!args.notApplicable?.[scope]?.trim()) fail('missing_applicability', 'Explicitly explain why ' + scope + ' is outside this application-review scope.');
    if (review.fields.some(f => f.type === 'file' && f.id !== 'resume' && f.required)) fail('unsupported_attachment', 'A required letter or other attachment cannot be marked not applicable.');
    if (args.contentHash !== digest({ answers: review.answers, resume: review.resume }) || args.postingHash !== digest(review.source.posting) || args.resumeSha256 !== review.resumeArtifact?.sha256) fail('stale_quality_review', 'Quality review must bind this content, posting and rendered PDF.');
    if (args.visualInspection?.resumeSha256 !== review.resumeArtifact?.sha256 || args.visualInspection?.inspected !== true) fail('visual_inspection_required', 'The independent reviewer must inspect the actual rendered PDF.');
    const canonical = { profile: String(store.profiles[review.profileId].resumeText || '') };
    for (const fact of Object.values(review.facts).filter(f => f.confirmed)) canonical['fact:' + fact.id] = fact.text;
    for (const [id, answer] of Object.entries(review.answers)) if (answer.confirmed) canonical['answer:' + id] = answer.value;
    const requiredSupports = [...review.resume.nodes.filter(n => n.renderPolicy === 'required' && n.type !== 'section_heading').map(n => 'resume:' + n.id), ...review.fields.filter(f => f.type !== 'file' && review.answers[f.id]?.value).map(f => 'answer:' + f.id)];
    if (review.resume.headline) requiredSupports.push('resume:headline');
    if (!Array.isArray(args.canonicalQuotes) || requiredSupports.some(id => !args.canonicalQuotes.some(c => c.supports === id && c.semanticSupport?.trim() && c.quote?.trim() && canonical[c.source]?.includes(c.quote)))) fail('canonical_evidence_required', 'Provide exact canonical quotations and semantic-support explanations for each applicant answer and rendered resume item.');
    review.qualityReview = { criteria: clone(args.criteria), thresholdEach: applicationQualityThreshold, notApplicable: clone(args.notApplicable), notes: String(args.notes), canonicalQuotes: clone(args.canonicalQuotes), provenance: clone(args.provenance), independent: true, visualInspection: clone(args.visualInspection), contentHash: args.contentHash, postingHash: args.postingHash, resumeSha256: args.resumeSha256, at: now(), reportedBy: 'host_reviewer' };
    review.approval = null; review.staged = null;
    return review;
  });
}
export function recordApplicationResumePreview(dataDir, args) {
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app);
    if (args.resumeSha256 !== review.resumeArtifact?.sha256 || review.resumeArtifact.version !== review.version) fail('stale_preview', 'Preview must come from this exact regenerated PDF.');
    if (!args.provenance?.renderer || !args.provenance?.runId) fail('missing_preview_provenance', 'Record the actual host PDF-to-image renderer and run.');
    const root = fs.realpathSync(dataDir); const source = fs.realpathSync(path.resolve(root, String(args.imagePath || '')));
    if (!source.startsWith(root + path.sep) || !fs.statSync(source).isFile()) fail('unsafe_preview_path', 'Stage the rendered page PNG under the configured data directory.');
    const bytes = fs.readFileSync(source);
    if (bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('invalid_preview', 'Provide a rendered PNG page under 20 MiB.');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const relativePath = path.join('review-artifacts', `${review.jobId}-${sha256}.png`);
    if (fs.realpathSync(path.join(root,'review-artifacts')) !== path.join(root,'review-artifacts')) fail('unsafe_artifact_directory', 'Preview must remain under the data directory.');
    writeFileAtomic(path.join(root,relativePath),bytes);
    review.resumeArtifact.preview = { relativePath, sha256, fromPdfSha256: args.resumeSha256, provenance: clone(args.provenance), reportedBy: 'host_pdf_renderer' };
    return review;
  });
}
export function renderApplicationReview(dataDir, args, { renderer = renderResumeBrowser } = {}) {
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app); const audit = auditReview(review, store);
    if (!audit.ready && args.draftOnly !== true) fail('review_validation_failed', JSON.stringify(audit.issues));
    if (args.draftOnly === true) { if (!review.resume) fail('resume_missing', 'Prepare resume content before rendering a draft.'); validateDocument(review.resume); }
    const rendered = renderer(review.resume);
    if (!rendered.bytes?.length) fail('resume_render_failed', 'Renderer produced no PDF.');
    const sha256 = crypto.createHash('sha256').update(rendered.bytes).digest('hex');
    const relativePath = path.join('review-artifacts', `${review.jobId}-${sha256}.pdf`);
    fs.mkdirSync(path.join(dataDir, 'review-artifacts'), { recursive: true });
    if (fs.realpathSync(path.join(dataDir, 'review-artifacts')) !== path.join(fs.realpathSync(dataDir), 'review-artifacts')) fail('unsafe_artifact_directory', 'Review artifacts must remain under the selected data directory.');
    writeFileAtomic(path.join(dataDir, relativePath), rendered.bytes);
    review.resumeArtifact = { relativePath, sha256, size: rendered.bytes.length, contentHash: digest(review.resume), version: review.version, qa: rendered.qa || null };
    review.qualityReview = null;
    review.approval = null; review.staged = null;
    return review;
  });
}
export function reviewApplication(dataDir, args, { human = false } = {}) {
  if (!human || args.pdfReviewed !== true) fail('human_review_required', 'Inspect the regenerated PDF and confirm the exact revision on the local review page.');
  return mutate(dataDir, args, (store, job, app) => {
    const review = current(app);
    if (!auditReview(review, store).ready) fail('review_validation_failed', 'Resolve application validation issues first.');
    if (qualityIssues(review).length) fail('quality_review_required', JSON.stringify(qualityIssues(review)));
    if (review.resumeArtifact?.version !== review.version || review.resumeArtifact?.contentHash !== digest(review.resume)) fail('resume_render_required', 'Render and inspect the latest resume before approval.');
    const bytes = fs.readFileSync(path.join(dataDir, review.resumeArtifact.relativePath));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== review.resumeArtifact.sha256) fail('artifact_changed', 'Regenerated PDF bytes changed.');
    review.approval = { version: review.version, at: now(), hash: digest({ source: review.source, fields: review.fields, answers: review.answers, resume: review.resume }), actor: 'local_user', pdfReviewed: true };
    return review;
  });
}
export function getApplicationStagingManifest(dataDir, args) {
  const store = loadStore(dataDir); owned(store, args);
  const review = current(store.applications[args.jobId] || {});
  const hash = digest({ source: review.source, fields: review.fields, answers: review.answers, resume: review.resume });
  if (!auditReview(review, store).ready || qualityIssues(review).length || review.approval?.version !== review.version || review.approval?.hash !== hash || review.resumeArtifact?.contentHash !== digest(review.resume)) fail('review_required', 'Review the latest answers, quality results and regenerated resume before staging.');
  const artifactPath = path.join(dataDir, review.resumeArtifact.relativePath);
  if (!fs.existsSync(artifactPath) || crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex') !== review.resumeArtifact.sha256) fail('artifact_changed', 'Reviewed resume bytes changed or are unavailable.');
  return { schema: 'jobsss.staging-manifest.v1', profileId: args.profileId, jobId: args.jobId, revision: store.revision, version: review.version, hash, browser: 'iab', targetUrl: review.source.formUrl, ownerThreadId: review.source.ownerThreadId || null, fields: review.fields.filter(f => f.type !== 'file').map(f => ({ ...f, value: review.answers[f.id]?.value || '' })), resume: { ...review.resumeArtifact, path: artifactPath }, stopBeforeSubmit: true };
}
export function recordApplicationStaging(dataDir, args) {
  const manifest = getApplicationStagingManifest(dataDir, args);
  if (args.visible !== true || (manifest.ownerThreadId && args.ownerThreadId !== manifest.ownerThreadId)) fail('browser_handoff_unverified', 'Verify the populated IAB tab is visible in the intended user chat; a queued attachment or hidden worker tab is not a completed handoff.');
  if (args.version !== manifest.version || args.hash !== manifest.hash || args.browser !== 'iab' || args.targetUrl !== manifest.targetUrl || !args.tabId || args.submitted !== false) fail('staging_mismatch', 'Observation must match the reviewed revision, IAB tab and destination; submission is excluded.');
  for (const field of manifest.fields) if (String(args.values?.[field.id] ?? '') !== field.value) fail('staging_mismatch', 'Observed field mismatch: ' + field.id);
  if (args.resumeSha256 !== manifest.resume.sha256) fail('staging_mismatch', 'Observed upload hash mismatch.');
  return mutate(dataDir, args, (store, job, app) => {
    app.review.staged = { version: manifest.version, hash: manifest.hash, tabId: args.tabId, targetUrl: args.targetUrl, ownerThreadId: args.ownerThreadId || null, visible: true, observedAt: now(), reportedBy: 'host_browser', submitted: false, resumeSha256: args.resumeSha256 };
    return app.review;
  });
}
// The host supplies a supported IAB adapter. No browser connection or submit operation is created here.
export async function stageReviewedApplication(dataDir, args, adapter) {
  if (!adapter || ['currentTab', 'inspect', 'fill', 'upload', 'read'].some(name => typeof adapter[name] !== 'function')) fail('host_browser_required', 'Actual staging requires currentTab, inspect, fill, upload and read capabilities from the supported Codex IAB host.');
  const manifest = getApplicationStagingManifest(dataDir, args);
  const tab = await adapter.currentTab();
  if (tab.browser !== 'iab' || tab.url !== manifest.targetUrl || !tab.id) fail('wrong_browser_tab', 'Select the exact application in the current in-app browser tab.');
  const assertVisibleOwner = current => { if (current.visible !== true || (manifest.ownerThreadId && current.ownerThreadId !== manifest.ownerThreadId)) fail('browser_handoff_unverified', 'Select the visible current application in the intended user chat, not a hidden or different worker context.'); };
  assertVisibleOwner(tab);
  const requirements = await adapter.inspect(tab.id);
  const review = getApplicationReview(dataDir, args);
  // User intent is review metadata, not a DOM requirement. Keep it in the
  // approved content hash, while comparing the site's actual field contract.
  const siteFields = list => fieldsOf(list).map(({ userExpected, expectationSource, ...field }) => field);
  if (digest(siteFields(requirements.fields)) !== digest(siteFields(review.fields))) fail('form_changed', 'Application questions changed; inspect and review again.');
  mutate(dataDir, { ...args, expectedRevision: manifest.revision }, (store, job, app) => {
    app.review.staged = null;
    return app.review;
  });
  const assertTab = async () => { const current = await adapter.currentTab(); if (current.id !== tab.id || current.browser !== 'iab' || current.url !== manifest.targetUrl) fail('wrong_browser_tab', 'The current application tab changed during staging.'); assertVisibleOwner(current); };
  for (const field of manifest.fields) {
    await assertTab();
    if (getApplicationStagingManifest(dataDir, args).hash !== manifest.hash) fail('review_changed', 'Review changed during staging.');
    await adapter.fill(tab.id, field, field.value);
  }
  await assertTab();
  if (getApplicationStagingManifest(dataDir, args).hash !== manifest.hash) fail('review_changed', 'Review changed before upload.');
  await adapter.upload(tab.id, 'resume', manifest.resume.path, { replace: true });
  const observation = await adapter.read(tab.id);
  await assertTab();
  const latest = getApplicationStagingManifest(dataDir, args);
  if (latest.hash !== manifest.hash || latest.version !== manifest.version) fail('review_changed', 'Review changed during staging.');
  return recordApplicationStaging(dataDir, { ...args, expectedRevision: latest.revision, version: manifest.version, hash: manifest.hash, browser: tab.browser, ownerThreadId: tab.ownerThreadId || null, visible: tab.visible, targetUrl: observation.url, tabId: tab.id, values: observation.values, resumeSha256: observation.resumeSha256, submitted: observation.submitted });
}
