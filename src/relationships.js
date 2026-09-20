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
import { id, now, loadStore, commitStore, ensureDataDir, activeProofIdsForStore, evidenceFreshnessForStore, tokenize } from './store.js';
import { supportedAchievement } from './documents.js';

const STORY_FIELDS = Object.freeze(['title', 'situation', 'task', 'action', 'result', 'reflection']);
export const STORY_STATES = Object.freeze(['draft_needs_verification', 'verified', 'retired']);
export const COVERAGE_STATUSES = Object.freeze(['covered', 'gap']);
export const OUTREACH_GOALS = Object.freeze(['informational', 'referral', 'interview_prep']);

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
    else if (key === 'email' || key === 'known professional channel' || key === 'known email') parsed.email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
    else if (key === 'relationship') parsed.relationship = value;
  }
  return parsed;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_BRIEF_SCHEMA = 'contact-brief.v1';
// Bounded provenance trail: an idempotent re-import adds nothing (its entry key
// already exists), so the cap only bounds genuinely distinct history.
const PROVENANCE_HISTORY_LIMIT = 20;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** First non-empty trimmed candidate; explicit arguments beat parsed source. */
function pickField(...values) {
  for (const value of values) {
    const text = field(value);
    if (text) return text;
  }
  return '';
}

/**
 * Parse the documented `contact-brief.v1` JSON contract (Contact Brief plugin
 * `references/contact-brief.schema.json`): the `subject` identity, an optionally
 * inspected role, and `email.address` together with the attribution and mailbox
 * status that qualify it.
 *
 * A staged/inline payload is recognised as a brief only when it is JSON
 * carrying the `contact-brief.v1` schema marker, or when its shape is
 * unambiguous (`subject` identity plus the `email.attribution` + `email.mailbox`
 * block that only this contract defines). Everything else — a plain contact
 * card, free text, or unrelated JSON — returns null so the generic card parser
 * still handles it. A provider-reported address is extracted verbatim and never
 * promoted to a verified mailbox.
 */
export function parseContactBrief(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw.startsWith('{')) return null;
  let doc;
  try { doc = JSON.parse(raw); } catch { return null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const subject = asObject(doc.subject);
  const emailBlock = asObject(doc.email);
  const schemaVersion = field(doc.schema_version);
  const recognised = schemaVersion === CONTACT_BRIEF_SCHEMA
    || (Boolean(field(subject.name) && field(subject.company))
      && Object.prototype.hasOwnProperty.call(emailBlock, 'attribution')
      && Object.prototype.hasOwnProperty.call(emailBlock, 'mailbox'));
  if (!recognised) return null;
  const address = field(emailBlock.address).toLowerCase();
  const hasAddress = EMAIL_RE.test(address);
  const lookup = asObject(emailBlock.lookup);
  const mailbox = asObject(emailBlock.mailbox);
  const emailEvidence = Array.isArray(emailBlock.evidence) ? emailBlock.evidence : [];
  const identityEvidence = Array.isArray(asObject(doc.identity).evidence) ? asObject(doc.identity).evidence : [];
  const evidenceUrls = [...emailEvidence, ...identityEvidence]
    .map(item => field(asObject(item).url))
    .filter(Boolean)
    .slice(0, 8);
  return {
    schemaVersion: schemaVersion || CONTACT_BRIEF_SCHEMA,
    generatedAt: field(doc.generated_at) || null,
    name: field(subject.name),
    company: field(subject.company),
    // `role` is not part of the frozen contract body; it is read when the
    // producing run records it, and stays null otherwise (never invented).
    role: pickField(subject.role, doc.role, doc.title) || null,
    email: hasAddress ? address : null,
    // An attribution only qualifies the address it belongs to: an address-less
    // brief carries no attributed address at all.
    emailAttribution: hasAddress ? (pickField(emailBlock.attribution, 'unknown') || null) : null,
    mailboxStatus: pickField(mailbox.status, 'not_checked'),
    lookupProvider: field(lookup.provider) || null,
    lookupStatus: field(lookup.status) || null,
    providerRunId: field(lookup.provider_run_id) || null,
    retrievedAt: field(lookup.retrieved_at) || null,
    evidenceUrls,
  };
}

/** Attributed, non-verified provenance carried from a contact-brief payload. */
function contactBriefProvenance(brief) {
  return {
    schema: brief.schemaVersion,
    generatedAt: brief.generatedAt,
    emailAttribution: brief.emailAttribution,
    mailboxStatus: brief.mailboxStatus,
    lookupProvider: brief.lookupProvider,
    lookupStatus: brief.lookupStatus,
    providerRunId: brief.providerRunId,
    retrievedAt: brief.retrievedAt,
    evidenceUrls: brief.evidenceUrls,
  };
}

/**
 * A record is "clearly machine-created" only while no human has acted on it:
 * no approval/suppression flag, no human-only decision in the canonical ledger,
 * and no human note. Reconciliation is limited to these records.
 */
function humanProtectedContact(store, contact) {
  if (!contact) return true;
  if (contact.humanApproved === true || contact.doNotUse === true) return true;
  if (contact.approvedAt || contact.suppressedAt || contact.approvedBy || contact.suppressedBy) return true;
  if (field(contact.humanNote) || field(contact.decisionNote)) return true;
  return Boolean(store.decisions && store.decisions[contact.id]);
}

// The key identifies the import *event* (route + attributed address), not the
// label of the code path that handled it: replaying the same payload over the
// same route is one event, so its entry is recorded once and a restart cannot
// grow the trail. A genuinely different route (staged vs inline) or a different
// attributed address is a different event and is recorded.
function contactProvenanceKey(entry) {
  return ['import', entry.source || '', entry.address || '', entry.attribution || '',
    entry.provider || '', entry.providerRunId || '', entry.schemaVersion || ''].join('|');
}

/**
 * Append one explicit provenance/history entry. Idempotent: a repeated identical
 * import is recognised by its stable key and appends nothing, so a restart never
 * grows the trail with duplicates. Returns whether a new entry was recorded.
 */
function recordContactProvenance(contact, entry) {
  const key = contactProvenanceKey(entry);
  const history = Array.isArray(contact.provenanceHistory) ? contact.provenanceHistory : [];
  if (history.some(item => item && item.key === key)) {
    contact.provenanceHistory = history;
    return false;
  }
  contact.provenanceHistory = [...history, { ...entry, key }].slice(-PROVENANCE_HISTORY_LIMIT);
  return true;
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
 *
 * Two documented source shapes are accepted and never confused with each other:
 *   - a generic contact card or free text (the unchanged `parseContactCard`
 *     path), or
 *   - the `contact-brief.v1` JSON that a host contact-brief run produces, whose
 *     `subject` identity and attribution-labelled provider-reported address are
 *     read natively so the caller does not have to restate them inline.
 *
 * Every record created here is `humanApproved: false`, never suppressed, and
 * keeps the provider attribution plus the `not_checked` mailbox status: a
 * provider-reported address is never presented as a verified mailbox.
 *
 * Duplicate logical contacts are prevented on both directions of a re-import:
 * an import carrying the provider-reported address fills the one clearly
 * machine-created, same-name+company record that lacks an address, and an
 * address-less import reconciles onto the one machine-created record for the
 * same normalized name+company that already holds it. Human-approved,
 * suppressed, do-not-use, human-note and conflicting-address records are never
 * touched or collapsed.
 */
export function importContact(dataDir, args = {}) {
  const { profileId } = args;
  const requested = args.path || args.filePath || null;
  const inlineBrief = args.brief && typeof args.brief === 'object' && !Array.isArray(args.brief) ? args.brief : null;
  let sourceText = String(args.text || args.content || '');
  if (inlineBrief) sourceText = JSON.stringify(inlineBrief);
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
  const brief = parseContactBrief(sourceText);
  const parsed = brief ? {} : parseContactCard(sourceText);
  const name = pickField(args.name, brief && brief.name, parsed.name);
  if (!name) throw Object.assign(new Error('import_contact requires name'), { code: 'missing_name' });
  const suppliedEmail = pickField(args.email, brief && brief.email, parsed.email).toLowerCase();
  const email = EMAIL_RE.test(suppliedEmail) ? suppliedEmail : null;
  const company = pickField(args.company, brief && brief.company, parsed.company) || null;
  const role = pickField(args.role, brief && brief.role, parsed.role) || null;
  const relationship = pickField(args.relationship, parsed.relationship);
  const source = requested ? 'staged_file' : sourceText ? 'inline_text' : 'mcp_inline';
  // Only a brief's own attribution label is carried as attribution; an inline
  // address with no stated attribution stays unattributed rather than being
  // upgraded to "provider-reported".
  const attribution = email && brief ? (brief.emailAttribution || 'unknown') : null;
  const emailStatus = email ? (brief ? 'provider_reported' : 'not_checked') : 'not_checked';
  const expectedRevision = expectedRevisionOf(args);
  let outcome = null;

  commitStore(dataDir, { expectedRevision }, store => {
    requireProfile(store, profileId);
    const contacts = ensureCollection(store, 'contacts');
    const at = now();
    const wantedName = normalizeCompany(name);
    const wantedCompany = normalizeCompany(company);
    const records = Object.values(contacts).filter(Boolean);
    const sameIdentity = contact => contact.profileId === profileId
      && normalizeCompany(contact.name) === wantedName
      && normalizeCompany(contact.company) === wantedCompany;
    const machineCreated = contact => !humanProtectedContact(store, contact);
    const provenance = extra => ({
      at, source, address: email, attribution,
      provider: brief ? brief.lookupProvider : null,
      providerRunId: brief ? brief.providerRunId : null,
      retrievedAt: brief ? brief.retrievedAt : null,
      mailboxStatus: brief ? brief.mailboxStatus : 'not_checked',
      schemaVersion: brief ? brief.schemaVersion : null,
      ...extra,
    });

    // 1. One profile-owned address is one logical contact. A human-protected
    // record for that address is reused untouched (never overwritten).
    const byAddress = email
      ? records.find(contact => contact.profileId === profileId && contact.email
        && contact.email.toLowerCase() === email)
      : null;
    if (byAddress) {
      if (machineCreated(byAddress)) {
        if (!byAddress.role && role) byAddress.role = role;
        recordContactProvenance(byAddress, provenance({ kind: 'reimport_same_address' }));
        byAddress.updatedAt = at;
      }
      outcome = {
        contactId: byAddress.id, id: byAddress.id, contact: byAddress,
        created: false, reconciled: true, reconciliation: 'same_address',
      };
      return store;
    }

    // 2. Deterministic re-import identity: repeating the same import lands on
    // the same record id instead of minting a second one.
    const contactSeed = `${profileId}:${name}:${email || company || ''}`;
    const contactId = id('contact', contactSeed);
    const sameSeed = contacts[contactId];
    if (sameSeed && sameSeed.profileId === profileId) {
      if (machineCreated(sameSeed)) {
        if (!sameSeed.role && role) sameSeed.role = role;
        recordContactProvenance(sameSeed, provenance({ kind: 'reimport_same_identity' }));
        sameSeed.updatedAt = at;
      }
      outcome = {
        contactId: sameSeed.id, id: sameSeed.id, contact: sameSeed,
        created: false, reconciled: true, reconciliation: 'same_identity',
      };
      return store;
    }

    // 3. Safe, bounded reconciliation for one name+company (normalized) inside
    // the same profile. Only clearly machine-created records are eligible, and
    // only when exactly one side of the pair holds the provider-reported
    // address: two address-bearing records are conflicting-address records and
    // are never collapsed.
    const peers = records.filter(sameIdentity);
    const openPeers = peers.filter(machineCreated);
    const peersWithAddress = openPeers.filter(contact => Boolean(contact.email));
    const peersWithoutAddress = openPeers.filter(contact => !contact.email);

    if (email && peersWithoutAddress.length === 1 && peersWithAddress.length === 0) {
      // The address-bearing import fills the single address-less peer instead of
      // creating a second logical contact; the merge stays explicit in history.
      const target = peersWithoutAddress[0];
      target.email = email;
      target.emailAttribution = attribution;
      target.emailStatus = emailStatus;
      target.contactBrief = brief ? contactBriefProvenance(brief) : null;
      if (!target.role && role) target.role = role;
      recordContactProvenance(target, provenance({ kind: 'merged_provider_reported_address', previousEmail: null }));
      target.updatedAt = at;
      outcome = {
        contactId: target.id, id: target.id, contact: target,
        created: false, reconciled: true, reconciliation: 'merged_provider_reported_address',
      };
      return store;
    }

    if (!email && peersWithAddress.length === 1) {
      // An address-less import for a name+company that already has one
      // machine-created address-bearing record is a re-import of that contact,
      // not a new person: reconcile onto it and keep the address.
      const target = peersWithAddress[0];
      if (!target.role && role) target.role = role;
      recordContactProvenance(target, provenance({ kind: 'reconciled_addressless_import', address: target.email, attribution: target.emailAttribution || null }));
      target.updatedAt = at;
      outcome = {
        contactId: target.id, id: target.id, contact: target,
        created: false, reconciled: true, reconciliation: 'reused_address_bearing_record',
      };
      return store;
    }

    // 4. No eligible peer: create the record.
    const contact = {
      id: contactId,
      profileId,
      name,
      role,
      company,
      email,
      emailAttribution: attribution,
      emailStatus,
      contactBrief: brief ? contactBriefProvenance(brief) : null,
      source,
      sourceText,
      provenance: field(args.source, source),
      relationshipEvidence: relationship,
      notes: field(args.notes),
      humanApproved: false,
      doNotUse: false,
      lastContactAt: null,
      createdAt: at,
      updatedAt: at,
    };
    recordContactProvenance(contact, provenance({ kind: brief ? 'staged_contact_brief' : 'imported_record' }));
    contacts[contactId] = contact;
    outcome = { contactId, id: contactId, contact, created: true, reconciled: false, reconciliation: null };
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

function contactContext(store, contact) {
  if (!contact) return { pathType: 'channel_pending', channel: 'unknown', warmth: 'unknown', reachable: false, researchIds: [] };
  const research = Object.values(store.research || {}).filter(record => record.profileId === contact.profileId
    && field(record.subjectName).toLowerCase() === field(contact.name).toLowerCase()
    && normalizeCompany(record.subjectCompany || record.company) === normalizeCompany(contact.company));
  // rc6: relationship evidence is the relationship/channel facts (the labeled
  // relationship, the contact notes, and matching research), never the whole
  // raw staged record. `contact.sourceText` is still stored verbatim as source
  // provenance; concatenating it here made reachability evidence a raw dump.
  const evidence = [contact.relationshipEvidence, contact.notes,
    ...research.map(record => [record.notes, ...(record.findings || [])].join(' '))].filter(Boolean).join('\n');
  const weak = /spoke once|met once|acquaintance|(?:we|they) (?:met|discussed)|study session|meetup/i.test(evidence)
    && !/no prior interaction/i.test(evidence);
  const cold = /no prior|relationship:\s*(?:none|no)|no (?:relationship|connection)|cold/i.test(evidence);
  const reachable = Boolean(contact.email) && !contact.doNotUse;
  return { pathType: !reachable ? 'channel_pending' : weak ? 'weak_acquaintance' : 'cold_professional_contact',
    channel: reachable ? 'email' : 'unknown', warmth: weak ? 'weak_acquaintance' : cold ? 'cold' : 'unknown',
    reachable, relationshipEvidence: evidence, researchIds: research.map(record => record.id),
    provenance: contact.provenance || contact.source };
}
function assertContactRelevant(contact, job) {
  if (!contact) return;
  if (contact.doNotUse) throw Object.assign(new Error('This contact is suppressed by a human decision.'), { code: 'contact_suppressed' });
  if (normalizeCompany(contact.company) !== normalizeCompany(job.company)) throw Object.assign(new Error('Contact company does not match the hiring company; a shared name is not identity evidence.'), { code: 'contact_company_mismatch' });
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
    if (contact.profileId !== profileId || contact.doNotUse) continue;
    if (!companyKey || normalizeCompany(contact.company) === companyKey) {
      people.push({
        id: contact.id,
        name: contact.name,
        role: contact.role || null,
        company: contact.company || job.company,
        email: contact.email || null,
        ...contactContext(store, contact),
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
    ...people.map(p => ({ type: p.pathType, personId: p.id, company: p.company, strength: p.warmth, reachable: p.reachable, reason: p.reachable ? 'Supplied professional email; no permission, deliverability or referral is inferred.' : 'Channel pending; profile/research citation is not a messaging route.' })),
    ...research.map(r => ({ type: 'research', personId: null, company: r.subjectCompany, strength: 'unknown', reachable: false, reason: `Research record ${r.subjectName || r.subjectCompany || 'for the company'}` })),
  ];
  return {
    ok: true,
    profileId,
    jobId,
    company: job.company,
    people,
    research,
    paths,
    reachable: paths.some(item => item.reachable),
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
    assertContactRelevant(contact, job);
    const access = contactContext(store, contact);
    const at = now();
    const planId = id('plan', `${profileId}:${jobId}:${goal}:${contactId || ''}:${at}`);
    const plan = {
      id: planId,
      jobId,
      profileId,
      contactId: contact ? contact.id : null,
      goal,
      ...access,
      recommended: access.reachable,
      internalNotes: 'Unsent planning only. Supplied channels are not verified deliverable; permission and any referral remain unknown. Human approval required.',
      steps: outreachSteps(goal, contact, job),
      reason: contact
        ? `${contact.name} at ${contact.company || job.company}: ${access.pathType}; ${access.reachable ? 'review the supplied professional channel before use' : 'obtain an appropriate channel or consensual introduction first'}.`
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

function outreachDraftBody(goal, contact, job, store, profileId) {
  const context = contactContext(store, contact);
  const evidence = `${context.relationshipEvidence || ''} ${job.description || ''}`;
  const role = contact?.role || '';
  const peer = /analytics|engineer|analyst/i.test(role) && !/manager|head|lead|director/i.test(role);
  const topic = /product manager/i.test(role)
    ? 'Which product metrics or self-service reporting questions most need attention from this role?'
    : peer
      ? 'How does the team review and test model changes before they reach shared reporting?'
      : /warehouse.*cost|transformation cost/i.test(evidence) && /metric|revenue definition/i.test(evidence)
        ? 'How is the team balancing consistent metric definitions with warehouse-cost improvements?'
        : 'What are the most important problems this role would help the team address?';
  const relationship = context.relationshipEvidence || '';
  const recalledTopic = /incremental[- ]model testing/i.test(relationship) ? 'incremental-model testing'
    : /tests for late.arriving/i.test(relationship) ? 'tests for late-arriving events' : null;
  const recollection = context.pathType === 'weak_acquaintance' && /spoke once|met once|we (?:met|discussed)/i.test(relationship)
    ? /study session/i.test(relationship)
      ? `We spoke${/once/i.test(relationship) ? ' once' : ''} at a study session${recalledTopic ? ` about ${recalledTopic}` : ''}; I would value a brief follow-up perspective.`
      : 'We spoke previously; I would value a brief follow-up perspective.'
    : '';
  const active = activeProofIdsForStore(store, profileId);
  const terms = new Set(tokenize(topic));
  const proofs = Object.values(store.proofPoints || {}).filter(proof => proof.profileId === profileId && active.has(proof.id));
  const score = proof => tokenize(proof.summary).filter(word => terms.has(word)).length;
  const proof = proofs.sort((a,b) => score(b) - score(a))[0];
  const lines = [contact ? `Hello ${contact.name},` : 'Hello,', '',
    `I am exploring the ${job.title} role at ${job.company || 'your company'}.`,
    recollection,
    contact?.role ? `Given your work as ${contact.role}, I would value your perspective.` : '',
    proof ? `In my previous work, I ${supportedAchievement(proof.summary).replace(/^([A-Z])/, letter => letter.toLowerCase()).replace(/[.]+$/, '')}.` : '', '', topic,
    goal === 'interview_prep' ? 'I would appreciate any context that could help me prepare for a possible conversation with the team.' : 'If you are open to a brief reply, I would appreciate your perspective.', '',
    'Thank you,', store.profiles[profileId].resume?.identity?.name || store.profiles[profileId].name];
  return { body: lines.filter((line,index,all) => line || all[index - 1]).join('\n'), proofPointIds: proof ? [proof.id] : [], context };
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
    assertContactRelevant(contact, job);
    const generated = outreachDraftBody(goal, contact, job, store, profileId);
    const at = now();
    const draftId = id('draft', `${profileId}:${jobId}:${goal}:${kind}:${at}`);
    const body = field(args.body, generated.body);
    const draft = {
      id: draftId,
      jobId,
      profileId,
      contactId: contact ? contact.id : null,
      kind,
      goal,
      subject: field(args.subject, `Question about ${job.title} at ${job.company}`),
      body,
      channel: generated.context.channel,
      pathType: generated.context.pathType,
      proofPointIds: args.body ? [] : generated.proofPointIds,
      researchIds: generated.context.researchIds,
      internalNotes: ['UNSENT. Human approval required; no prior send, interview, referral or recipient permission is assumed.', ...(generated.context.reachable ? [] : ['Channel pending: obtain an appropriate professional channel or consensual introduction before use.']), ...(args.body ? ['User-supplied copy requires factual review.'] : [])],
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
    // Retired stories and stories referencing historical or retired proof remain
    // in history but cannot contribute current interview coverage or preparation.
    const activeProofIds = activeProofIdsForStore(store, profileId);
    const storyList = Object.values(stories).filter(s =>
      s.profileId === profileId && s.state !== 'retired' &&
      (s.proofPointIds || []).every(proofId => activeProofIds.has(proofId)));
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
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(prep => ({ ...prep, freshness: evidenceFreshnessForStore(store, prep) }));
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