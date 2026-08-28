// Bundled JobSSS relationships module — profile-owned network and interview
// helpers for the standalone journey.
//
// Attributed ports (read-only JobOS references, reimplemented standalone; JobOS
// is never imported at runtime):
//   - warm-path planning and contact selection from JobOS src/research/contacts.js
//     (createOutreachPlan, contact evidence tiers) and warmth tiers from
//     src/research/network.js (hot <= 30d, warm <= 90d, cool <= 180d).
//   - outreach drafts must never send: JobOS keeps sending human-only
//     (mark_outreach_sent is not agent-eligible); every record here is a
//     local draft with no external action.
//   - interview story/prep contracts from JobOS src/interview.js:
//     INTERVIEW_STORY_STATES ('draft_needs_verification', 'verified', 'retired'),
//     INTERVIEW_STORY_CONTENT_FIELDS (title, situation, task, action, result,
//     reflection), INTERVIEW_AUDIENCES, INTERVIEW_COVERAGE_STATUSES
//     ('covered', 'gap'), and the human-confirmed debrief boundary (debriefs are
//     confirmed by an explicit human action, never attested via MCP).
//
// All functions take (dataDir, args), enforce profile (and where relevant job)
// ownership, persist through the serialized commitStore transaction, and return
// plain JSON objects for the MCP layer. Nothing here sends, submits, schedules,
// or drives a browser.
import fs from 'node:fs';
import path from 'node:path';
import { id, now, loadStore, commitStore, ensureDataDir } from './store.js';

const STORY_FIELDS = Object.freeze(['title', 'situation', 'task', 'action', 'result', 'reflection']);
export const STORY_STATES = Object.freeze(['draft_needs_verification', 'verified', 'retired']);
export const COVERAGE_STATUSES = Object.freeze(['covered', 'gap']);
export const OUTREACH_GOALS = Object.freeze(['informational', 'referral', 'interview_prep']);
export const WARMTH_DAYS = Object.freeze({ hot: 30, warm: 90, cool: 180 });

function ownerError(message) {
  return Object.assign(new Error(message), { code: 'profile_mismatch' });
}

function requireProfile(store, profileId) {
  if (!profileId || typeof profileId !== 'string' || !profileId.trim()) {
    throw Object.assign(new Error('A profileId is required'), { code: 'missing_profile' });
  }
  const profile = store.profiles && store.profiles[profileId];
  if (!profile) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  return profile;
}

function requireOwnedJob(store, jobId, profileId) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    throw Object.assign(new Error('A jobId is required'), { code: 'missing_job' });
  }
  const job = store.jobs && store.jobs[jobId];
  if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: 'unknown_job' });
  if (job.profileId !== profileId) {
    throw ownerError(`Job ${jobId} belongs to profile ${job.profileId}, not ${profileId}`);
  }
  return job;
}

function ownedProofPointIds(store, profileId, values) {
  const ids = Array.isArray(values) ? values.map(String).filter(Boolean) : [];
  const out = [];
  for (const proofId of ids) {
    const proof = store.proofPoints && store.proofPoints[proofId];
    if (!proof) throw Object.assign(new Error(`Unknown proof point: ${proofId}`), { code: 'unknown_proof' });
    if (proof.profileId !== profileId) {
      throw ownerError(`Proof point ${proofId} belongs to profile ${proof.profileId}, not ${profileId}`);
    }
    out.push(proofId);
  }
  return out;
}

function requireOwnedApplication(store, applicationId, profileId, jobId) {
  const app = store.applications && store.applications[applicationId];
  if (!app) throw Object.assign(new Error(`Unknown application: ${applicationId}`), { code: 'unknown_application' });
  if (app.profileId !== profileId) {
    throw ownerError(`Application ${applicationId} belongs to profile ${app.profileId}, not ${profileId}`);
  }
  if (jobId && app.jobId && app.jobId !== jobId) {
    throw Object.assign(
      new Error(`Application ${applicationId} belongs to job ${app.jobId}, not ${jobId}`),
      { code: 'application_job_mismatch' }
    );
  }
  return app;
}

function field(value, fallback = '') {
  return String(value == null ? '' : value).trim() || fallback;
}

function normalizeCompany(value) {
  return field(value).toLowerCase().replace(/\s+/g, ' ');
}

function warmthFromLastContact(lastContactAt, asOf = new Date()) {
  if (!lastContactAt) return 'unknown';
  const last = new Date(lastContactAt);
  if (!Number.isFinite(last.getTime())) return 'unknown';
  const days = Math.max(0, Math.floor((asOf.getTime() - last.getTime()) / 86400000));
  if (days <= WARMTH_DAYS.hot) return 'hot';
  if (days <= WARMTH_DAYS.warm) return 'warm';
  if (days <= WARMTH_DAYS.cool) return 'cool';
  return 'cold';
}

function parseContactCard(text) {
  const parsed = {};
  if (!text || typeof text !== 'string') return parsed;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === 'name') parsed.name = value;
    else if (key === 'role') parsed.role = value;
    else if (key === 'company') parsed.company = value;
    else if (key === 'email') parsed.email = value;
  }
  return parsed;
}

function ensureCollection(store, name) {
  if (!store[name] || typeof store[name] !== 'object' || Array.isArray(store[name])) store[name] = {};
  return store[name];
}

function expectedRevisionOf(args) {
  return args.expectedRevision != null ? args.expectedRevision : null;
}

/**
 * Inline or PLUGIN_DATA-staged contact import. Arbitrary paths are rejected
 * (frozen B16); no mail or messaging is ever sent from here.
 */
export function importContact(dataDir, args = {}) {
  const { profileId } = args;
  const requested = args.path || args.filePath || null;
  let sourceText = String(args.text || args.content || '');
  if (requested) {
    const root = ensureDataDir(dataDir);
    let real;
    try { real = fs.realpathSync(path.resolve(String(requested))); }
    catch { throw Object.assign(new Error('Staged contact file does not exist.'), { code: 'contact_read_error' }); }
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
      throw Object.assign(new Error('Contact path is forbidden; stage it under PLUGIN_DATA or provide inline text.'), { code: 'arbitrary_path' });
    }
    if (!fs.statSync(real).isFile()) throw Object.assign(new Error('Staged contact path must be a regular file.'), { code: 'arbitrary_path' });
    sourceText = fs.readFileSync(real, 'utf8');
  }
  const parsed = parseContactCard(sourceText);
  const name = field(args.name, parsed.name);
  if (!name) throw Object.assign(new Error('import_contact requires name'), { code: 'missing_name' });
  const email = field(args.email, parsed.email).toLowerCase() || null;
  const company = field(args.company, parsed.company) || null;
  const role = field(args.role, parsed.role) || null;
  const source = requested ? 'staged_file' : sourceText ? 'inline_text' : 'mcp_inline';
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const contacts = ensureCollection(store, 'contacts');
    const existing = email
      ? Object.values(contacts).find(c => c.profileId === profileId && c.email && c.email.toLowerCase() === email)
      : null;
    if (existing) {
      existing.updatedAt = now();
      outcome = { contactId: existing.id, id: existing.id, contact: existing, created: false };
      return store;
    }
    const at = now();
    const contactId = id('contact', `${profileId}:${name}:${email || company || at}`);
    const contact = {
      id: contactId,
      profileId,
      name,
      role,
      company,
      email,
      source,
      humanApproved: false,
      doNotUse: false,
      lastContactAt: null,
      createdAt: at,
      updatedAt: at,
    };
    contacts[contactId] = contact;
    outcome = { contactId, id: contactId, contact, created: true };
    return store;
  });
  return {
    ...outcome,
    ok: true,
    message: 'Contact recorded as a local, profile-owned record. No message was composed or transmitted.',
  };
}

export function listContacts(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = field(args.profileId);
  requireProfile(store, profileId);
  const contacts = Object.values(store.contacts || {}).filter(c => c.profileId === profileId);
  return { ok: true, profileId, contacts, items: contacts, count: contacts.length };
}

/**
 * Profile-owned people/company research record. May hang off a job (ownership
 * enforced) or stand alone at company/profile level.
 */
export function recordResearch(dataDir, args = {}) {
  const { profileId } = args;
  const subjectName = field(args.subjectName, args.personName);
  const subjectCompany = field(args.subjectCompany, args.company);
  if (!subjectName && !subjectCompany) {
    throw Object.assign(new Error('record_research requires subjectName or subjectCompany'), { code: 'missing_subject' });
  }
  const jobId = field(args.jobId) || null;
  const notes = field(args.notes);
  const findings = Array.isArray(args.findings) ? args.findings.map(String).filter(Boolean) : [];
  const source = field(args.source, 'mcp_research');
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const job = jobId ? requireOwnedJob(store, jobId, profileId) : null;
    const research = ensureCollection(store, 'research');
    const at = now();
    const researchId = id('research', `${profileId}:${jobId || ''}:${subjectName}:${subjectCompany}:${at}`);
    const record = {
      id: researchId,
      profileId,
      jobId,
      company: subjectCompany || (job ? job.company : null),
      subjectName: subjectName || null,
      subjectCompany: subjectCompany || null,
      findings,
      notes,
      source,
      createdAt: at,
      updatedAt: at,
    };
    research[researchId] = record;
    outcome = { researchId, id: researchId, research: record, created: true };
    return store;
  });
  return { ...outcome, ok: true };
}

export function listResearch(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = field(args.profileId);
  requireProfile(store, profileId);
  const research = Object.values(store.research || {}).filter(r => r.profileId === profileId);
  return { ok: true, profileId, research, items: research, count: research.length };
}

/**
 * Local reachability map for one owned job: profile-owned contacts and research
 * records that mention the job's company become reachable paths. This is a map
 * only — no outreach is sent.
 */
export function mapReachableNetwork(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const jobId = field(args.jobId);
  const store = loadStore(dataDir);
  requireProfile(store, profileId);
  const job = requireOwnedJob(store, jobId, profileId);
  const companyKey = normalizeCompany(job.company);
  const people = [];
  for (const contact of Object.values(store.contacts || {})) {
    if (contact.profileId !== profileId) continue;
    if (!companyKey || normalizeCompany(contact.company) === companyKey) {
      people.push({
        id: contact.id,
        name: contact.name,
        role: contact.role || null,
        company: contact.company || job.company,
        email: contact.email || null,
        pathType: 'direct_connection',
        warmth: warmthFromLastContact(contact.lastContactAt),
        humanApproved: Boolean(contact.humanApproved),
        createdAt: contact.createdAt,
      });
    }
  }
  const research = [];
  for (const record of Object.values(store.research || {})) {
    if (record.profileId !== profileId) continue;
    if (record.jobId === jobId || (companyKey && normalizeCompany(record.company) === companyKey)) {
      research.push({ id: record.id, subjectName: record.subjectName, subjectCompany: record.subjectCompany, findings: record.findings, notes: record.notes });
    }
  }
  const paths = [
    ...people.map(p => ({ type: 'direct_connection', personId: p.id, company: p.company, strength: 'direct', reason: `Contact at ${p.company || 'the hiring company'}` })),
    ...research.map(r => ({ type: 'research', personId: null, company: r.subjectCompany, strength: 'moderate', reason: `Research record ${r.subjectName || r.subjectCompany || 'for the company'}` })),
  ];
  return {
    ok: true,
    profileId,
    jobId,
    company: job.company,
    people,
    research,
    paths,
    reachable: paths.length > 0,
    message: 'Local reachability map. No outreach was composed or transmitted.',
  };
}

function preferredContact(store, profileId, job) {
  const candidates = Object.values(store.contacts || {})
    .filter(c => c.profileId === profileId && !c.doNotUse)
    .filter(c => !job.company || normalizeCompany(c.company) === normalizeCompany(job.company))
    .sort((a, b) => Number(b.humanApproved) - Number(a.humanApproved));
  return candidates[0] || null;
}

function outreachSteps(goal, contact, job) {
  const steps = [
    'Verify the profile facts and proof points cited in the draft.',
    contact ? `Review outreach to ${contact.name}${contact.role ? ` (${contact.role})` : ''}.` : 'Select a contact at the company for review.',
  ];
  if (goal === 'referral') steps.push('Ask whether a referral or warm introduction is appropriate.');
  else if (goal === 'interview_prep') steps.push('Ask an interview-preparation question about the role and team.');
  else steps.push('Request an informational conversation about the role and team.');
  steps.push('Human approval and a trusted CLI/TUI action are required before any external send.');
  return steps;
}

/**
 * Draft-only outreach planning. Never sends. Plans are persisted so follow-ups
 * can be drafted against the same warm path.
 */
export function planOutreach(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const jobId = field(args.jobId);
  const goal = OUTREACH_GOALS.includes(String(args.goal || '').toLowerCase())
    ? String(args.goal).toLowerCase()
    : 'informational';
  const contactId = field(args.contactId) || null;
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const job = requireOwnedJob(store, jobId, profileId);
    ensureCollection(store, 'contacts');
    const plans = ensureCollection(store, 'outreachPlans');
    let contact = null;
    if (contactId) {
      contact = store.contacts[contactId] || null;
      if (!contact) throw Object.assign(new Error(`Unknown contact: ${contactId}`), { code: 'unknown_contact' });
      if (contact.profileId !== profileId) throw ownerError(`Contact ${contactId} belongs to profile ${contact.profileId}, not ${profileId}`);
    } else {
      contact = preferredContact(store, profileId, job);
    }
    const at = now();
    const planId = id('plan', `${profileId}:${jobId}:${goal}:${contactId || ''}:${at}`);
    const plan = {
      id: planId,
      jobId,
      profileId,
      contactId: contact ? contact.id : null,
      goal,
      channel: contact ? 'direct_connection' : 'unknown',
      recommended: Boolean(contact),
      steps: outreachSteps(goal, contact, job),
      reason: contact
        ? `Selected ${contact.name} at ${contact.company || job.company} as the local warm path for review.`
        : 'No profile-owned contact at the hiring company is available yet.',
      status: 'draft_plan',
      delivered: false,
      createdAt: at,
      updatedAt: at,
    };
    plans[planId] = plan;
    outcome = { planId, id: planId, plan, created: true };
    return store;
  });
  return {
    ...outcome,
    ok: true,
    message: 'Local outreach plan only. Nothing was composed or transmitted; a human action is required for any external step.',
  };
}

function outreachDraftBody(goal, contact, job, kind) {
  const lines = [];
  lines.push(`Subject: ${kind === 'follow_up' ? 'Following up — ' : ''}${contact ? `Hi ${contact.name.split(' ')[0]}` : 'Hello'} — ${job.title} at ${job.company || 'your company'}`);
  lines.push('');
  lines.push(contact ? `Hello ${contact.name},` : 'Hello,');
  if (goal === 'referral') {
    lines.push(`I am preparing an application for the ${job.title} role at ${job.company || 'your company'} and would value your perspective on whether a referral or warm introduction is appropriate.`);
  } else if (goal === 'interview_prep') {
    lines.push(`I have an upcoming conversation about the ${job.title} role at ${job.company || 'your company'} and would value your insight on the team and priorities.`);
  } else {
    lines.push(`I am exploring the ${job.title} role at ${job.company || 'your company'} and would welcome an informational conversation about the team and the problems they are solving.`);
  }
  lines.push('This is a local draft for review. I will send nothing until you explicitly approve it.');
  if (kind === 'follow_up') lines.push('This is a follow-up to an earlier draft; it remains unsent pending your approval.');
  return lines.join('\n');
}

/**
 * Draft-only outreach (initial or follow-up). The returned record is a draft:
 * it is never transmitted, and `delivered` is false.
 */
export function draftOutreach(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const jobId = field(args.jobId);
  const kind = String(args.kind || (args.followUp ? 'follow_up' : 'initial')).toLowerCase() === 'follow_up' ? 'follow_up' : 'initial';
  const goal = OUTREACH_GOALS.includes(String(args.goal || '').toLowerCase())
    ? String(args.goal).toLowerCase()
    : 'informational';
  const contactId = field(args.contactId) || null;
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const job = requireOwnedJob(store, jobId, profileId);
    ensureCollection(store, 'contacts');
    const drafts = ensureCollection(store, 'outreachDrafts');
    let contact = null;
    if (contactId) {
      contact = store.contacts[contactId] || null;
      if (!contact) throw Object.assign(new Error(`Unknown contact: ${contactId}`), { code: 'unknown_contact' });
      if (contact.profileId !== profileId) throw ownerError(`Contact ${contactId} belongs to profile ${contact.profileId}, not ${profileId}`);
    } else {
      contact = preferredContact(store, profileId, job);
    }
    const at = now();
    const draftId = id('draft', `${profileId}:${jobId}:${goal}:${kind}:${at}`);
    const body = field(args.body, outreachDraftBody(goal, contact, job, kind));
    const draft = {
      id: draftId,
      jobId,
      profileId,
      contactId: contact ? contact.id : null,
      kind,
      goal,
      subject: field(args.subject, body.split('\n')[0].replace(/^Subject:\s*/, '')),
      body,
      status: 'draft_not_delivered',
      delivered: false,
      deliveredAt: null,
      createdAt: at,
      updatedAt: at,
    };
    drafts[draftId] = draft;
    outcome = { draftId, id: draftId, draft, created: true };
    return store;
  });
  return {
    ...outcome,
    ok: true,
    message: 'Local draft only. It has not been transmitted; a human approval action is required before any external step.',
  };
}

export function listOutreach(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = field(args.profileId);
  requireProfile(store, profileId);
  const plans = Object.values(store.outreachPlans || {}).filter(p => p.profileId === profileId);
  const drafts = Object.values(store.outreachDrafts || {}).filter(d => d.profileId === profileId);
  const followUps = drafts.filter(d => d.kind === 'follow_up');
  return { ok: true, profileId, plans, drafts, followUps, items: [...plans, ...drafts], count: plans.length + drafts.length };
}

const STORY_TAGS = Object.freeze({
  role_fit: ['engineer', 'developer', 'product', 'design', 'analyst', 'manager', 'researcher', 'recruiter'],
  leadership: ['led', 'lead', 'managed', 'mentor', 'director', 'head', 'owned', 'team'],
  collaboration: ['collaborat', 'partner', 'cross', 'stakeholder', 'coordinated', 'team'],
  problem_solving: ['problem', 'solv', 'debug', 'optimiz', 'analysis', 'troubleshoot', 'implemented'],
  communication: ['communicat', 'present', 'document', 'explain', 'facilitated', 'taught'],
  domain_expertise: ['domain', 'industry', 'expert', 'architecture', 'platform', 'built', 'created'],
});

function storyTextForTags(story) {
  return STORY_FIELDS.map(fieldKey => String(story[fieldKey] || '')).join(' ').toLowerCase();
}

// Story state machine: drafts always begin needing human verification; there is
// no MCP attestation surface for verification (JobOS verify_interview_story is
// human-only).
function makeInterviewStory(profileId, args) {
  const title = field(args.title);
  const situation = field(args.situation);
  const task = field(args.task);
  const action = field(args.action);
  const result = field(args.result);
  if (!situation || !task || !action || !result) {
    throw Object.assign(
      new Error('draft_interview_story requires situation, task, action, and result (STAR)'),
      { code: 'interview_story_star_required' }
    );
  }
  const reflection = field(args.reflection) || null;
  const competencyTags = Array.isArray(args.competencyTags)
    ? args.competencyTags.map(String).filter(Boolean).slice(0, 8)
    : [];
  const audienceTags = Array.isArray(args.audienceTags)
    ? args.audienceTags.map(String).filter(Boolean).slice(0, 6)
    : [];
  const at = now();
  const storyId = id('story', `${profileId}:${title}:${situation}:${result}:${at}`);
  return {
    id: storyId,
    profileId,
    state: 'draft_needs_verification',
    title: title || `Story ${storyId}`,
    situation,
    task,
    action,
    result,
    reflection,
    competencyTags,
    audienceTags,
    proofPointIds: [],
    fieldProvenance: Object.fromEntries(STORY_FIELDS.map(f => [f, { origin: 'agent', actor: 'agent', source: 'mcp_draft' }])),
    revision: 1,
    changeKind: 'create',
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Draft an interview STAR story grounded in the supplied text and any
 * profile-owned proof point ids. State is always draft_needs_verification;
 * verification and debriefs require explicit human confirmation.
 */
export function draftInterviewStory(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const proofPointIds = ownedProofPointIds(store, profileId, args.proofPointIds);
    const stories = ensureCollection(store, 'interviewStories');
    const story = makeInterviewStory(profileId, args);
    story.proofPointIds = proofPointIds;
    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();
    const proofEntries = proofPointIds
      .map(proofId => ({
        proofId,
        quote: String(store.proofPoints[proofId]?.summary || '').trim(),
        text: normalize(store.proofPoints[proofId]?.summary),
      }))
      .filter(entry => entry.text);
    // Grounding evaluates every content field (title, situation, task, action,
    // result, reflection). A field is grounded only when its normalized text is
    // exactly equal to a complete owned proof summary after normalization.
    // Any fabricated, paraphrased, or fragmentary field stays unverified and
    // cites no unrelated proof id or evidence quote.
    story.fieldEvidence = Object.fromEntries(STORY_FIELDS.map(fieldName => {
      const normalizedField = normalize(story[fieldName]);
      const matching = normalizedField ? proofEntries.filter(entry => entry.text === normalizedField) : [];
      return [fieldName, {
        status: matching.length ? 'grounded' : 'unverified',
        matchedProofPointIds: matching.map(entry => entry.proofId),
        evidence: matching.map(entry => ({ proofPointId: entry.proofId, quote: entry.quote })),
        supportedByProofText: matching.length > 0,
      }];
    }));
    story.fieldProvenance = Object.fromEntries(STORY_FIELDS.map(fieldName => {
      const matched = story.fieldEvidence[fieldName].matchedProofPointIds;
      return [fieldName, {
        origin: 'agent', actor: 'agent', source: 'mcp_draft',
        sourceRef: matched.length ? matched.join(',') : null,
      }];
    }));
    story.grounded = proofEntries.length > 0 && STORY_FIELDS.every(fieldName => story.fieldEvidence[fieldName].supportedByProofText);
    story.groundingStatus = story.grounded
      ? 'exact_proof_text_needs_human_verification'
      : proofPointIds.length
        ? 'proof_linked_unverified'
        : 'user_supplied_unverified';
    stories[story.id] = story;
    outcome = { storyId: story.id, id: story.id, story, created: true };
    return store;
  });
  return {
    ...outcome,
    ok: true,
    message: 'Draft story recorded locally as draft_needs_verification. Human verification is required before use in an interview.',
  };
}

export function listInterviewStories(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = field(args.profileId);
  requireProfile(store, profileId);
  const stories = Object.values(store.interviewStories || {}).filter(s => s.profileId === profileId);
  return { ok: true, profileId, stories, items: stories, count: stories.length };
}

function coverageForStories(stories) {
  return Object.keys(STORY_TAGS).map(factor => {
    const keywords = STORY_TAGS[factor];
    const matches = stories.filter(story => {
      const text = storyTextForTags(story);
      return keywords.some(keyword => text.includes(keyword));
    });
    return { factor, status: matches.length ? 'covered' : 'gap', storyIds: matches.map(s => s.id) };
  });
}

function interviewQuestions(job) {
  const text = `${job ? `${job.title}\n${job.company}\n` : ''}${job ? job.description || '' : ''}`.toLowerCase();
  const tokens = [...new Set((text || '').split(/[^a-z0-9]+/).filter(t => t.length > 3))].slice(0, 3);
  const questions = [
    { id: 'q_role', question: 'Walk me through your most relevant experience for this role.', source: 'derived' },
    { id: 'q_proof', question: 'Give an example of a measurable result you delivered in a similar situation.', source: 'derived' },
    { id: 'q_motivation', question: 'Why are you interested in this team and this work?', source: 'derived' },
  ];
  for (const [index, token] of tokens.entries()) {
    questions.push({ id: `q_${index}_${token}`, question: `How does your background relate to “${token}”?`, source: 'job_posting' });
  }
  return questions;
}

/**
 * Interview preparation: deterministic question set, coverage gaps across
 * story factors, and an explicit human-confirmed debrief handoff. This function
 * never records, verifies, or attests an interview outcome.
 */
export function interviewPrep(dataDir, args = {}) {
  const profileId = field(args.profileId);
  const jobId = field(args.jobId) || null;
  const applicationId = field(args.applicationId) || null;
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const job = jobId ? requireOwnedJob(store, jobId, profileId) : null;
    if (applicationId) requireOwnedApplication(store, applicationId, profileId, job ? job.id : null);
    const stories = ensureCollection(store, 'interviewStories');
    const preps = ensureCollection(store, 'interviewPrep');
    const storyList = Object.values(stories).filter(s => s.profileId === profileId);
    const coverage = coverageForStories(storyList);
    const gaps = coverage.filter(item => item.status === 'gap').map(item => item.factor);
    const at = now();
    const prepId = id('prep', `${profileId}:${job ? job.id : 'profile'}:${at}`);
    const prep = {
      id: prepId,
      profileId,
      jobId: job ? job.id : null,
      applicationId: applicationId || null,
      questions: interviewQuestions(job),
      coverage,
      gaps,
      storyIds: storyList.map(s => s.id),
      actions: [
        'Review the draft stories and verify each factual field against profile proof points.',
        gaps.length ? `Prepare evidence or new stories for: ${gaps.join(', ')}.` : 'All coverage factors have at least one draft story.',
        'Rehearse with a human partner; interview outcomes are not recorded by the plugin.',
      ],
      debriefHandoff: {
        kind: 'human_only',
        requires: 'human_confirmation',
        message: 'After the interview, a human must confirm the debrief using a trusted CLI/TUI handoff. The plugin does not record, verify, or attest interview outcomes via MCP.',
      },
      createdAt: at,
      updatedAt: at,
    };
    preps[prepId] = prep;
    outcome = { prepId, id: prepId, prep, created: true };
    return store;
  });
  return { ...outcome, ok: true };
}

export function getInterviewPrep(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = field(args.profileId);
  requireProfile(store, profileId);
  const jobId = field(args.jobId) || null;
  if (jobId) requireOwnedJob(store, jobId, profileId);
  const preps = Object.values(store.interviewPrep || {})
    .filter(p => p.profileId === profileId && (!jobId || p.jobId === jobId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { ok: true, profileId, prep: preps[preps.length - 1] || null, items: preps, count: preps.length };
}

/**
 * Explicit debrief handoff answer: returns the human-confirmation guidance
 * without writing or attesting anything. This is the only debrief surface the
 * standalone journey exposes.
 */
export function interviewDebriefHandoff(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = field(args.profileId);
  requireProfile(store, profileId);
  return {
    ok: true,
    profileId,
    kind: 'human_only_handoff',
    requires: 'human_confirmation',
    message: 'Interview debrief must be confirmed by the human operator through a trusted CLI/TUI handoff. No debrief record was created and no outcome was attested.',
  };
}