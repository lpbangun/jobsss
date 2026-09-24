// Domain handlers for the standalone JobSSS workflow.
// Attributed ports: JobOS profiles/jobs/discovery/scoring/lifecycle/artifacts,
// networking, and interview contracts, reimplemented over the bundled JSON
// store. JobOS is MIT licensed (see root LICENSE) and is never loaded at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slug, id, now, loadStore, commitStore, hashText, dedupeKeyForJob, tokenize,
  ensureDataDir, STORE_SCHEMA_VERSION, activeProofIdsForStore, storeSchemaVersionOnDisk,
} from './store.js';
import { localScore } from './scoring.js';
import {
  assertPublicJobUrl, fetchPublicJob, parseJobText, createSavedSearch as createSearch,
  getSavedSearch, listSavedSearches as savedSearches, fetchSavedSearchSource, runSavedSearch, runAllSearches,
  parseGreenhouseRef, resolveGreenhouseDetailSync, fetchApplicationDetail,
} from './discovery.js';
import {
  requireJobOwned, pursueJob as pursueLocal, saveJob as saveLocal, skipJob as skipLocal,
  archiveJob as archiveLocal, updateApplicationStatus as updateLocalStatus,
  listTasks as tasksForProfile, updateTask as updateLocalTask,
  tailorResume as tailorLocal, draftCoverLetter as coverLocal,
  listReviewArtifacts, addAnswer, listAnswers, matchAnswers, previewSync as syncPreview,
} from './workflows.js';
import {
  importContact, listContacts, recordResearch, listResearch, mapReachableNetwork,
  planOutreach, draftOutreach, listOutreach, draftInterviewStory,
  listInterviewStories, interviewPrep, getInterviewPrep, interviewDebriefHandoff,
} from './relationships.js';
import { PRODUCT_VERSION } from './version.js';
import { unansweredRequiredFor } from './checklist.js';

export { unansweredRequiredFor };

// Plugin root. In source mode this resolves to the repository root; in the
// standalone SEA bundle it derives from the binary's own location (see
// src/sea-build.js), so no build/checkout path is ever embedded.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IS_STANDALONE =
  typeof __sea !== 'undefined' && !!__sea && __sea.standalone === true;

// Source-mode allowlist: the two frozen Gate 0 fixture files in the checkout
// test tree, when that tree is present. `tests`/`fixtures` are joined at
// runtime so the contiguous scratch path never appears in the standalone
// bundle. A standalone release — and any install of the thin Agent Plugins
// package, which ships no test tree — resolves nothing here; the content-hash
// gate below (isFrozenFixture) still accepts the exact frozen fixture bytes
// wherever the harness stages them, and never requires a checkout.
const FIXTURE_DIR = ['tests', 'fixtures'];
function frozenFixtureAllowlist() {
  if (IS_STANDALONE) return [];
  const found = [];
  for (const name of ['profile-resume.md', 'job-posting.md']) {
    try {
      found.push(fs.realpathSync(path.join(ROOT, ...FIXTURE_DIR, name)));
    } catch {
      /* no checkout test tree next to the runtime; isFrozenFixture() covers it */
    }
  }
  return found;
}
const FROZEN_FIXTURES = new Set(frozenFixtureAllowlist());

// Frozen fixture content hashes (BENCHMARK.md artifact-hash section). These
// constants let a standalone release accept the exact frozen Gate 0 fixture
// bytes wherever the harness stages them, without depending on a checkout
// or embedding any path.
const FROZEN_FIXTURE_HASHES = new Map([
  ['profile-resume.md', '5e78590ab93031b334e2c67c4f081a52af0e5713306dcac3ad08eb4d88ac65e9'],
  ['job-posting.md', '736a9d6957d2a5ab8e3ed4c4f1f95639afcca949facf3b71767af7b358e00db6'],
]);

function isFrozenFixture(abs) {
  const expected = FROZEN_FIXTURE_HASHES.get(path.basename(abs));
  if (!expected) return false;
  try {
    return hashText(fs.readFileSync(abs, 'utf8')) === expected;
  } catch {
    return false;
  }
}

function error(code, message) {
  return Object.assign(new Error(message), { code });
}

function expected(args = {}) {
  return args.expectedRevision == null ? null : args.expectedRevision;
}

function mutate(dataDir, args, operation) {
  let value;
  const committed = commitStore(dataDir, { expectedRevision: expected(args) }, store => {
    value = operation(store);
    return store;
  });
  return value && typeof value === 'object' ? { ...value, revision: committed.revision } : value;
}

function requireProfile(store, profileId, { includeArchived = false } = {}) {
  const value = String(profileId || '').trim();
  if (!value) throw error('missing_profile', 'profileId is required');
  const profile = store.profiles?.[value];
  if (!profile) throw error('unknown_profile', 'Unknown profile: ' + value);
  if (profile.archivedAt && !includeArchived) {
    throw error('archived_profile', 'Profile ' + value + ' is archived; restore it before using it');
  }
  return profile;
}

function allowedIntakeFile(dataDir, raw, kind) {
  if (!raw) return null;
  let real;
  try { real = fs.realpathSync(path.resolve(String(raw))); }
  catch { throw error(`${kind}_read_error`, `${kind} staged file does not exist`); }
  const data = ensureDataDir(dataDir);
  const insideData = real === data || real.startsWith(`${data}${path.sep}`);
  if (!insideData && !FROZEN_FIXTURES.has(real) && !isFrozenFixture(real)) {
    throw error('unsafe_intake_path', `${kind} path is forbidden; stage the file under PLUGIN_DATA or provide inline content`);
  }
  if (!fs.statSync(real).isFile()) throw error('unsafe_intake_path', `${kind} path must name a regular staged file`);
  return real;
}

function readIntakeText(dataDir, args, kind, inlineKeys) {
  for (const key of inlineKeys) {
    const text = String(args[key] || '').trim();
    if (text) return { text, sourceName: 'inline' };
  }
  const requested = args.resumePath || args.path || args.filePath || null;
  if (!requested) return { text: '', sourceName: null };
  const real = allowedIntakeFile(dataDir, requested, kind);
  try { return { text: fs.readFileSync(real, 'utf8'), sourceName: path.basename(real), real }; }
  catch (cause) { throw error(`${kind}_read_error`, `Cannot read staged ${kind}: ${cause.message}`); }
}

// ---------------------------------------------------------------------------
// Resume-derived profile intake.
//
// create_profile used to seed preferences.targetRoleFamilies with the
// candidate's name and preferences.skills with name tokens, which fabricated
// targeting and search vocabulary, while proof extraction kept only lines that
// happened to contain an allowlisted action verb (most experience bullets were
// dropped) and recorded empty metrics for quantified claims. Preferences are
// now derived from what the resume actually states — role titles from the
// experience headings and the target/objective line, skills from the Skills
// section — and every experience bullet becomes a proof candidate with its
// evident metrics. An explicit `preferences` argument always wins; a resume
// that states nothing leaves the arrays empty rather than inventing values
// from the name.
// ---------------------------------------------------------------------------

// Section labels: Markdown headings plus bare ALL-CAPS record labels such as
// "EXPERIENCE" or "SKILLS [P01-SKILLS]". Anything else that looks like a
// heading ends the current section without claiming its lines.
const EXPERIENCE_HEADING = /\b(?:experience|employment|work history)\b/i;
const ACHIEVEMENT_HEADING = /\b(?:achievements|accomplishments)\b/i;
const SKILLS_HEADING = /\b(?:skills|competencies|technologies|tech stack)\b/i;
const TARGET_HEADING = /^(?:target(?:\s+role)?|desired\s+role|role\s+target|objective|headline|position\s+sought)$/i;
const TARGET_LABEL = /^(?:target(?:\s+role)?|desired\s+role|role\s+target|objective|headline|position\s+sought)\s*[:\u2013\u2014-]/i;
const ACTION_VERB = /\b(automated|reconciled|added|defined|built|led|managed|created|designed|improved|launched|reduced|increased|owned|shipped|analyzed|implemented|taught|researched|coordinated|facilitated|developed)\b/i;
const PAST_TENSE_OPENER = /^[A-Z][a-z]+ed\b/;
const BULLET_PREFIX = /^(?:[-*\u2022\u00b7]\s+|[A-Za-z]{1,4}\d{1,3}[:.)]\s+)/;
const DATED_ROLE_LINE = /^(?:\d{4}[-/]\d{1,2}|\w+\s+\d{4})\s*(?:-|\u2013|\u2014|to|through)\s*(?:\d{4}[-/]\d{1,2}|\w+\s+\d{4}|\d{4}|present|current)/i;
// Context prose that sits under an experience heading but is not a claim.
const PROOF_NOISE = /^(?:fixed-term|no subsequent|\W*available\b|\W*all human|\W*references|\W*notes?:|\W*disclaimer)|\bnot human-attested\b|\bpending human\b|\bhuman-only\b/i;
// Explicit restrictions and claim-handling instructions are profile context,
// never achievement evidence, even when formatted as a resume bullet.
const PROOF_CONSTRAINT = /\b(?:do not|don't|never)\s+(?:claim|say|state|infer|present|assert|use)\b|\bavoid\s+(?:claiming|saying|stating|presenting)\b|\bnot seeking\b|\bnot interested in\b|\bmissing:\s*no\b|\bexposure only\b|\bno experience (?:with|in)\b|\bi (?:do not|don't|cannot|can't|will not|won't)\s+(?:claim|have|use)\b/i;
const ROLE_NOUN = /\b(?:engineer|analyst|developer|programmer|manager|designer|scientist|architect|consultant|specialist|administrator|coordinator|director|supervisor|technician|strategist|planner|producer|editor|recruiter|marketer|writer|researcher|accountant|teacher|professor|officer|attorney|paralegal|translator|librarian|intern)\b/i;
const ROLE_TITLE = /(?:[A-Za-z][A-Za-z/&.+-]*\s+){0,2}(?:engineer|analyst|developer|programmer|manager|designer|scientist|architect|consultant|specialist|administrator|coordinator|director|supervisor|technician|strategist|planner|producer|editor|recruiter|marketer|writer|researcher|accountant|teacher|professor|officer|attorney|paralegal|translator|librarian)s?\b/gi;
const ROLE_LEVEL = /^(?:junior|senior|staff|principal|lead|mid-level|entry-level|associate|intern|apprentice|trainee|chief|head of|vp of|vice president of)\s+/i;
const SKILL_LABEL_NOISE = /^(?:missing|exposure only|exposure|none|no|not|without|avoid|education|degree|certifications? status|references|notes?)$/i;
const SKILL_ENTRY_NOISE = /\b(?:university|college|school|completed|degree|gpa|honors|sandbox|listed|certification)\b/i;

function headingKeyFor(line) {
  const raw = String(line || '').trim();
  if (!raw || raw.length > 90) return null;
  if (/^[-*\u2022\u00b7]/.test(raw)) return null;
  const md = raw.match(/^#{1,6}\s*(.+?)\s*#*$/);
  let text = md ? md[1] : raw;
  text = text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[:\u2013\u2014-]\s*$/, '').trim();
  if (!text) return null;
  const words = text.split(/\s+/);
  const bareLabel = words.length <= 5 && text.length <= 48 && /^[A-Z][A-Z0-9 &/+-]*$/.test(text);
  if (!md && !bareLabel) return null;
  if (TARGET_HEADING.test(text)) return 'target';
  if (ACHIEVEMENT_HEADING.test(text)) return 'achievements';
  if (EXPERIENCE_HEADING.test(text)) return 'experience';
  if (SKILLS_HEADING.test(text)) return 'skills';
  return 'other';
}

// True for a dated role header ("2022-01 through 2024-06: Data Analyst, Co."),
// which names a role instead of claiming an outcome.
function isRoleHeaderLine(line) {
  const text = String(line || '').trim();
  if (!DATED_ROLE_LINE.test(text)) return false;
  return !ACTION_VERB.test(text) && !PAST_TENSE_OPENER.test(text.replace(BULLET_PREFIX, ''));
}

function resumeSections(resumeText) {
  const sections = [];
  let key = null;
  let lines = [];
  const flush = () => { sections.push({ key, lines }); key = null; lines = []; };
  for (const raw of String(resumeText || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const found = headingKeyFor(line);
    if (found) {
      // A dated role heading inside an achievement block opens a role, not a
      // new section: keep scanning the same block.
      const keepsSection = found === 'other' && (key === 'experience' || key === 'achievements')
        && /\b(?:19|20)\d{2}\b/.test(line);
      if (!keepsSection) { flush(); key = found; }
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections.filter(section => section.lines.length);
}

function roleParts(line) {
  return String(line || '').replace(/^#{1,6}\s*/, '').replace(/\[[^\]]*\]/g, ' ')
    .split(/[|,:]|\s{2,}/);
}

function normalizeRole(raw) {
  let role = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/[.,;:\u2013\u2014-]+$/, '').trim();
  if (!role || /\d/.test(role)) return null;
  role = role.replace(ROLE_LEVEL, '').trim();
  if (!role || role.length > 48 || role.split(/\s+/).length > 5) return null;
  if (!ROLE_NOUN.test(role)) return null;
  return role;
}

// Role families come from stated target/objective lines and from role titles in
// the experience headings. The candidate's name is never a role family.
function roleFamiliesFromResume(resumeText) {
  const out = [];
  const seen = new Set();
  const push = raw => {
    const role = normalizeRole(raw);
    if (!role) return;
    const key = role.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); out.push(role);
  };
  const pushTargetLine = line => {
    for (const match of String(line || '').matchAll(ROLE_TITLE)) push(match[0]);
  };
  let section = null;
  for (const raw of String(resumeText || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = headingKeyFor(line);
    if (key) {
      const datedRoleHeading = key === 'other' && (section === 'experience' || section === 'achievements')
        && /\b(?:19|20)\d{2}\b/.test(line);
      if (datedRoleHeading) for (const part of roleParts(line)) push(part);
      else section = key;
      continue;
    }
    if (TARGET_LABEL.test(line)) pushTargetLine(line);
    else if (section === 'target') pushTargetLine(line);
    if ((section === 'experience' || section === 'achievements') && isRoleHeaderLine(line)) {
      for (const part of roleParts(line)) push(part);
    }
  }
  return out.slice(0, 6);
}

// Skills come from the Skills section only. A `Missing:`/`Exposure only:`
// inventory names what the candidate does not have, so those labels are
// dropped instead of being promoted into skills.
function skillsFromResume(resumeText) {
  const out = [];
  const seen = new Set();
  for (const section of resumeSections(resumeText)) {
    if (section.key !== 'skills') continue;
    for (const line of section.lines) {
      const text = line.replace(BULLET_PREFIX, '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const label = text.match(/^([A-Za-z][A-Za-z /&+-]{0,24})\s*:/);
      if (label && SKILL_LABEL_NOISE.test(label[1].trim())) continue;
      const body = label ? text.slice(label[0].length) : text;
      if (/^(?:missing|exposure only|no|not|without|avoid)\b/i.test(body.trim())) continue;
      for (const entry of body.split(/[,;|\u2022\u00b7]/)) {
        const skill = entry.replace(/^[\s\-*]+/, '').replace(/\s+/g, ' ').replace(/\.$/, '')
          .replace(/^(?:and|plus|including|with)\s+/i, '').trim();
        if (skill.length < 2 || skill.length > 48 || !/[a-z]/i.test(skill)) continue;
        if (skill.split(/\s+/).length > 6 || SKILL_ENTRY_NOISE.test(skill)) continue;
        const key = skill.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key); out.push(skill);
      }
    }
  }
  return out.slice(0, 32);
}

// Evident metrics only: numbers carrying a unit (currency, percent, scale,
// count of things, duration). A bare four-digit year is a date, not a metric.
const METRIC_PATTERN = /(?:\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b)?|\b(?:usd|eur|gbp|cad|aud)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\s?x\b|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b)\b|\b\d[\d,]*(?:\.\d+)?\s+(?:services?|users?|customers?|events?|records?|rows?|requests?|reports?|dashboards?|models?|tests?|pipelines?|jobs?|meetings?|runs?|hours?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|quarters?|years?|colleagues?|engineers?|analysts?|teams?|people|projects?|tickets?|incidents?|stakeholders?|mentors?|students?|educators?)\b|\b\d{2,}(?:,\d{3})*\b)/gi;

function metricsFromText(text) {
  const out = [];
  for (const match of String(text || '').matchAll(METRIC_PATTERN)) {
    const value = match[0].trim();
    if (/^(?:19|20)\d{2}$/.test(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out.slice(0, 12);
}

// Every experience bullet is a proof candidate; outside an experience block a
// line qualifies on an allowlisted action verb (unchanged behaviour). Plain
// prose inside an experience block qualifies when it opens with a past-tense
// verb, so unlabeled resumes keep their achievements without swallowing
// preference or boundary prose.
const PROOF_THEME_STOPWORDS = new Set((
  'a an and are as at by for from in into it its of on or that the their them then through to was were with while after before each every'
  + ' built created developed implemented introduced delivered launched designed led managed owned automated improved reduced increased'
  + ' cut lowered decreased wrote partnered coordinated facilitated'
).split(/\s+/));

function proofThemeTokens(summary) {
  const normalized = String(summary || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return new Set(tokenize(normalized).filter(token => token.length > 2 && !PROOF_THEME_STOPWORDS.has(token))
    .map(token => token.length > 5 && token.endsWith('ing') ? token.slice(0, -3)
      : token.length > 4 && token.endsWith('ed') ? token.slice(0, -2)
        : token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token));
}

function nearDuplicateProof(left, right) {
  const leftMetrics = metricsFromText(left).map(value => value.toLowerCase()).sort();
  const rightMetrics = metricsFromText(right).map(value => value.toLowerCase()).sort();
  // Preserve distinct quantified claims even when they share a theme.
  if (leftMetrics.length && rightMetrics.length && JSON.stringify(leftMetrics) !== JSON.stringify(rightMetrics)) return false;
  const a = proofThemeTokens(left);
  const b = proofThemeTokens(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = new Set([...a, ...b]).size;
  const jaccard = shared / union;
  const containment = shared / Math.min(a.size, b.size);
  return jaccard >= 0.78 || (containment >= 0.9 && Math.max(a.size, b.size) / Math.min(a.size, b.size) <= 1.35);
}

function proofCandidatesFromResume(resumeText) {
  const candidates = [];
  let section = null;
  for (const raw of String(resumeText || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = headingKeyFor(line);
    if (key) {
      const keepsSection = key === 'other' && (section === 'experience' || section === 'achievements')
        && /\b(?:19|20)\d{2}\b/.test(line);
      if (!keepsSection) section = key;
      continue;
    }
    const bullet = BULLET_PREFIX.test(line);
    const body = line.replace(BULLET_PREFIX, '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!body || body.length < 20) continue;
    if (PROOF_NOISE.test(body) || PROOF_CONSTRAINT.test(body) || isRoleHeaderLine(body)) continue;
    const inAchievements = section === 'experience' || section === 'achievements';
    if (!inAchievements && !bullet && !ACTION_VERB.test(body)) continue;
    if (inAchievements && !bullet && !ACTION_VERB.test(body) && !PAST_TENSE_OPENER.test(body)) continue;
    if (!candidates.some(candidate => nearDuplicateProof(candidate, body))) candidates.push(body);
  }
  return candidates.slice(0, 40);
}

function defaultPreferences(input = {}, resumeText = '') {
  const supplied = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const excludeRoles = Array.isArray(supplied.excludeRoles) ? supplied.excludeRoles.map(String) : [];
  // Keep caller-authored dealbreakers at the text level. excludeRoles is an
  // independent structured preference and is not rewritten into that list.
  const dealbreakers = Array.isArray(supplied.dealbreakers) ? supplied.dealbreakers.map(String) : [];
  const salary = supplied.salary && typeof supplied.salary === 'object'
    ? { min: supplied.salary.min ?? null, max: supplied.salary.max ?? null, currency: supplied.salary.currency || 'USD' }
    : { min: null, max: null, currency: String(supplied.salaryCurrency || 'USD') };
  if (salary.min == null && supplied.minBaseSalary != null && Number.isFinite(Number(supplied.minBaseSalary))) {
    salary.min = Number(supplied.minBaseSalary);
  }
  if (salary.max == null && supplied.desiredBaseSalaryMax != null && Number.isFinite(Number(supplied.desiredBaseSalaryMax))) {
    salary.max = Number(supplied.desiredBaseSalaryMax);
  }
  const locations = Array.isArray(supplied.locations) ? [...supplied.locations] : [];
  if (!locations.length && supplied.location) locations.push(String(supplied.location));
  // Derived defaults are never fabricated: with no resume statement the arrays
  // stay empty and explicit caller values always win.
  const derivedRoleFamilies = Array.isArray(supplied.targetRoleFamilies) ? supplied.targetRoleFamilies : roleFamiliesFromResume(resumeText);
  const derivedSkills = Array.isArray(supplied.skills) ? supplied.skills : skillsFromResume(resumeText);
  return {
    targetRoleFamilies: derivedRoleFamilies,
    industries: Array.isArray(supplied.industries) ? supplied.industries : [],
    companyStages: Array.isArray(supplied.companyStages) ? supplied.companyStages : [],
    locations,
    salary,
    dealbreakers,
    excludeRoles,
    skills: derivedSkills,
    missionKeywords: Array.isArray(supplied.missionKeywords) ? supplied.missionKeywords : [],
    values: Array.isArray(supplied.values) ? supplied.values : [],
    workModel: String(supplied.workModel || (supplied.remoteOnly ? 'remote' : '')),
    communicationStyle: String(supplied.communicationStyle || 'concise, warm, evidence-grounded'),
    searchStrategy: String(supplied.searchStrategy || 'focused'),
  };
}

function extractProofPoints(profileId, resumeText) {
  return proofCandidatesFromResume(resumeText)
    .map((summary, index) => ({
      id: id('proof', `${profileId}:${index}:${summary}`), profileId, summary,
      skills: [...new Set(tokenize(summary).filter(token => token.length > 3))].slice(0, 10),
      metrics: metricsFromText(summary),
      source: 'resume_import', verification: 'human_required', status: 'needs_verification', createdAt: now(),
    }));
}

function resumeDocument(profileId, text, identityOverride = {}) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const detectedName = lines.find(line => /^Name:/i.test(line))?.replace(/^Name:\s*/i, '') || lines[0]?.replace(/^#\s*/, '') || '';
  const detectedEmail = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const identity = {
    name: String(identityOverride?.name ?? detectedName).trim(),
    email: String(identityOverride?.email ?? detectedEmail).trim(),
    verificationStatus: 'needs_verification',
  };
  return {
    schemaVersion: 1,
    profileId,
    identity,
    sourceHash: hashText(text),
    verificationStatus: 'needs_verification',
    importedAt: now(),
  };
}

function profileResumeEmail(profile, store) {
  const current = store.resumes?.[profile.currentResumeId]?.document?.identity;
  return String(profile.resumeIdentity?.email || profile.resume?.identity?.email || current?.email || '').trim().toLowerCase();
}

function resumeEmail(text, override = {}) {
  const detected = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  return String(override?.email ?? detected).trim().toLowerCase();
}

function normalizeResumeIdentityOverride(input, prior = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const next = { ...prior };
  for (const key of ['name', 'email']) {
    if (!Object.hasOwn(value, key)) continue;
    const text = String(value[key] ?? '').trim();
    if (text) next[key] = text;
    else delete next[key];
  }
  return Object.keys(next).length ? next : undefined;
}

function persistResumeRevision(store, profile, text, sourceName) {
  if (!text) return null;
  store.resumes = store.resumes || {};
  const sourceHash = hashText(text);
  const existing = Object.values(store.resumes).find(item => item.profileId === profile.id && item.sourceHash === sourceHash);
  if (existing) {
    // A→B→A: repoint the current pointer at the existing A revision while
    // retaining both A and B records and their revision ids. Identical
    // content never creates a duplicate content revision. Pointer changes are
    // recorded in the durable audit history so the change chronology survives
    // restart; resumeRevisionIds stays append-only.
    if (!Array.isArray(profile.resumeRevisionIds)) profile.resumeRevisionIds = [];
    if (!profile.resumeRevisionIds.includes(existing.id)) profile.resumeRevisionIds.push(existing.id);
    const prior = profile.currentResumeId || null;
    profile.currentResumeId = existing.id;
    if (prior !== existing.id) {
      store.audit = Array.isArray(store.audit) ? store.audit : [];
      store.audit.push({ event: 'resume_revision_restored', profileId: profile.id, resumeId: existing.id,
        revision: existing.revision, priorCurrentResumeId: prior, resumeRevisionIds: [...profile.resumeRevisionIds],
        createdAt: now() });
    }
    return existing;
  }
  const revision = Object.values(store.resumes).filter(item => item.profileId === profile.id).length + 1;
  const resumeId = id('resume', `${profile.id}:${sourceHash}`);
  const record = { id: resumeId, profileId: profile.id, revision, sourceName, sourceHash,
    document: resumeDocument(profile.id, text, profile.resumeIdentity), verificationStatus: 'needs_verification', createdAt: now() };
  store.resumes[resumeId] = record;
  profile.resumeRevisionIds = [...(profile.resumeRevisionIds || []), resumeId];
  profile.currentResumeId = resumeId;
  return record;
}

// Active-proof eligibility delegates to the canonical shared helper in
// store.js (activeProofIdsForStore) so every consumer — scoring, drafting,
// answers, coverage — applies one definition. Historical-only proof stays
// stored as history with its provenance and verification retained, but is
// excluded from current score evidence, draft selection, answer matching,
// and preparation coverage.
function isActiveProof(store, profile, proof) {
  if (!proof || !profile || proof.profileId !== profile.id) return false;
  const active = activeProofIdsForStore(store, profile.id);
  return active ? active.has(proof.id) : false;
}
function activeProofsFor(store, profile) {
  return Object.values(store.proofPoints || {}).filter(proof => isActiveProof(store, profile, proof));
}
function historicalProofIdsFor(store, profile) {
  const active = activeProofIdsForStore(store, profile.id);
  return Object.values(store.proofPoints || {})
    .filter(proof => proof.profileId === profile.id && !(active && active.has(proof.id)))
    .map(proof => proof.id);
}
function resolveCollisionSafeProfileId(store, name) {
  const matches = Object.values(store.profiles).filter(profile => profile.name === name);
  if (matches.length > 1) throw error('ambiguous_profile', `Ambiguous profile name "${name}"; import cannot select between distinct identities`);
  if (matches.length === 1) return matches[0].id;
  const base = slug(name);
  const existing = store.profiles[base];
  if (!existing) return base;
  // Same exact identity retries remain supported on the same record.
  if (existing.name === name) return base;
  // Distinct names (including non-Latin names and ASCII slug collisions)
  // must never silently overwrite another profile: allocate a distinct id.
  const extra = hashText(`profile:${String(name)}`).slice(0, 8);
  let candidate = `${base}-${extra}`;
  let counter = 1;
  while (store.profiles[candidate] && store.profiles[candidate].name !== name) {
    counter += 1;
    candidate = `${base}-${extra}-${counter}`;
  }
  return candidate;
}

export function doctor(dataDir) {
  const abs = ensureDataDir(dataDir);
  let writable = true;
  try { fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK); } catch { writable = false; }
  // Diagnose corrupt canonical state without modifying it: invalid JSON or
  // an invalid store shape reports non-ok accurately, while a healthy empty
  // installation (no store yet) still diagnoses normally.
  try {
    const storeFile = path.join(abs, 'store.json');
    if (fs.existsSync(storeFile)) {
      const raw = fs.readFileSync(storeFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, status: 'corrupt_store', runtime: 'jobsss-bundled', version: PRODUCT_VERSION,
          schemaVersion: STORE_SCHEMA_VERSION, dataDir: abs, pluginData: abs, storeExists: true,
          bundled: true, writable, launcher: './bin/jobsss',
          message: 'PLUGIN_DATA store is corrupt: valid JSON object required.' };
      }
      for (const field of ['version', 'schemaVersion']) {
        const numeric = Number(parsed[field]);
        if (parsed[field] != null && Number.isFinite(numeric) && numeric > STORE_SCHEMA_VERSION) {
          return { ok: false, status: 'unsupported_schema', runtime: 'jobsss-bundled', version: PRODUCT_VERSION,
            schemaVersion: STORE_SCHEMA_VERSION, dataDir: abs, pluginData: abs, storeExists: true,
            bundled: true, writable, launcher: './bin/jobsss',
            message: `PLUGIN_DATA store uses unsupported future ${field} ${parsed[field]}; this runtime supports schema ${STORE_SCHEMA_VERSION}.` };
        }
      }
    }
  } catch (cause) {
    return { ok: false, status: 'corrupt_store', runtime: 'jobsss-bundled', version: PRODUCT_VERSION,
      schemaVersion: STORE_SCHEMA_VERSION, dataDir: abs, pluginData: abs,
      storeExists: fs.existsSync(path.join(abs, 'store.json')), bundled: true, writable,
      launcher: './bin/jobsss', message: `PLUGIN_DATA store is corrupt: ${cause.message}` };
  }
  return {
    ok: writable, status: 'ok', runtime: 'jobsss-bundled', version: PRODUCT_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION, dataDir: abs, pluginData: abs,
    storeExists: fs.existsSync(path.join(abs, 'store.json')), bundled: true, writable,
    launcher: './bin/jobsss',
    message: 'Bundled runtime diagnosed; PLUGIN_DATA is isolated and writable. JobOS is not required. Do not invent jobs, scores, proofs, sends, or submissions.',
  };
}

export function start(dataDir, args = {}) {
  // rc6: `migrated` reports whether THIS call migrated a legacy store. A
  // genuinely empty PLUGIN_DATA (no store.json yet) and an already-current
  // store both report false; only a store below the bundled schema reports
  // true. Read before the commit so the value describes the pre-commit state.
  const schemaOnDisk = storeSchemaVersionOnDisk(dataDir);
  const committed = commitStore(dataDir, { expectedRevision: expected(args) }, store => {
    store.audit = Array.isArray(store.audit) ? store.audit : [];
    store.audit.push({ event: 'start', createdAt: now() });
    return store;
  });
  const migrated = schemaOnDisk !== null && schemaOnDisk < STORE_SCHEMA_VERSION;
  return { ok: true, initialized: true, migrated, schemaVersion: STORE_SCHEMA_VERSION, revision: committed.revision,
    dataDir: path.resolve(dataDir), storePath: committed.storePath, message: 'Versioned durable state initialized under PLUGIN_DATA' };
}

export function createProfile(dataDir, args = {}) {
  const requestedProfileId = String(args.profileId || '').trim();
  const name = String(args.name || args.profileName || '').trim();
  if (!name && !requestedProfileId) throw error('missing_name', 'create_profile requires name unless profileId explicitly targets an existing profile');
  const input = readIntakeText(dataDir, args, 'resume', ['resumeText', 'text', 'content']);
  return mutate(dataDir, args, store => {
    let profileId = requestedProfileId;
    let existing = null;
    let matchedBy = null;
    if (requestedProfileId) {
      existing = requireProfile(store, requestedProfileId);
      profileId = existing.id;
      matchedBy = 'profileId';
    } else {
      const exactName = Object.values(store.profiles).filter(profile =>
        profile.name === name || (Array.isArray(profile.nameAliases) && profile.nameAliases.includes(name)));
      if (exactName.length > 1) throw error('ambiguous_profile', 'Name "' + name + '" matches multiple profile histories; retry with an explicit profileId');
      const email = resumeEmail(input.text, args.resumeIdentity);
      const exactEmail = email
        ? Object.values(store.profiles).filter(profile => profileResumeEmail(profile, store) === email)
        : [];
      if (exactName.length && exactEmail.some(profile => profile.id !== exactName[0].id)) {
        throw error('profile_conflict', 'Name "' + name + '" and resume email identify different profiles; retry with the intended profileId');
      }
      if (exactName.length) {
        existing = exactName[0];
        profileId = existing.id;
        matchedBy = existing.name === name ? 'name' : 'nameAlias';
      } else {
        profileId = resolveCollisionSafeProfileId(store, name);
        existing = store.profiles[profileId] || null;
        matchedBy = existing ? 'name' : null;
      }
    }
    const incomingEmail = resumeEmail(input.text, args.resumeIdentity);
    const identityCollisionProfileIds = incomingEmail
      ? Object.values(store.profiles).filter(profile => profileResumeEmail(profile, store) === incomingEmail && profile.id !== profileId).map(profile => profile.id)
      : [];
    const profileName = name || existing?.name || '';
    if (existing) {
      requireProfile(store, profileId);
      if (input.text) {
        existing.resumeIdentity = normalizeResumeIdentityOverride(args.resumeIdentity, existing.resumeIdentity);
        existing.resumeText = input.text;
        existing.resumeSource = input.sourceName;
        existing.resume = resumeDocument(profileId, input.text, existing.resumeIdentity);
        persistResumeRevision(store, existing, input.text, input.sourceName);
        const currentResume = existing.currentResumeId && store.resumes?.[existing.currentResumeId];
        if (currentResume?.document) currentResume.document.identity = { ...existing.resume.identity };
        const proofs = extractProofPoints(profileId, input.text);
        // Unchanged re-import keeps verified proof records, decisions, and
        // audit history. Changed resume claims start unverified; manual proofs
        // remain attached to the profile.
        const manualIds = (existing.proofPointIds || []).filter(pid => {
          const prior = store.proofPoints[pid];
          return prior && prior.source !== 'resume_import';
        });
        const freshIds = [];
        for (const proof of proofs) {
          if (!store.proofPoints[proof.id]) store.proofPoints[proof.id] = proof;
          freshIds.push(proof.id);
        }
        existing.proofPointIds = [...new Set([...freshIds, ...manualIds])];
        existing.updatedAt = now();
      }
      const proofPoints = activeProofsFor(store, existing);
      const { resumeText: _private, ...safeProfile } = existing;
      return { profileId, id: profileId, profile: safeProfile, proofPoints,
        activeProofPointIds: proofPoints.map(proof => proof.id),
        historicalProofPointIds: historicalProofIdsFor(store, existing), created: false, matchedBy,
        identityCollisionProfileIds };
    }
    const resumeIdentity = normalizeResumeIdentityOverride(args.resumeIdentity);
    const proofPoints = extractProofPoints(profileId, input.text);
    const profile = {
      id: profileId, name: profileName, preferences: defaultPreferences(args.preferences, input.text),
      resumeSource: input.sourceName, resumeText: input.text,
      ...(resumeIdentity ? { resumeIdentity } : {}),
      resume: input.text ? resumeDocument(profileId, input.text, resumeIdentity) : null,
      proofPointIds: proofPoints.map(proof => proof.id), createdAt: now(), updatedAt: now(),
    };
    store.profiles[profileId] = profile;
    persistResumeRevision(store, profile, input.text, input.sourceName);
    for (const proof of proofPoints) {
      if (!store.proofPoints[proof.id]) store.proofPoints[proof.id] = proof;
    }
    const active = activeProofsFor(store, profile);
    const { resumeText: _private, ...safeProfile } = profile;
    return { profileId, id: profileId, profile: safeProfile, proofPoints: active,
      activeProofPointIds: active.map(proof => proof.id),
      historicalProofPointIds: historicalProofIdsFor(store, profile), created: true,
      identityCollisionProfileIds };
  });
}

export function listProfiles(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profile = requireProfile(store, args.profileId, { includeArchived: args.includeArchived === true });
  const { resumeText: _private, ...safeProfile } = profile;
  return { ok: true, profileId: profile.id, profiles: [safeProfile], items: [safeProfile], count: 1, archived: Boolean(profile.archivedAt) };
}

export function listResumes(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profile = requireProfile(store, args.profileId);
  const resumes = Object.values(store.resumes || {}).filter(item => item.profileId === args.profileId)
    .sort((a, b) => a.revision - b.revision)
    .map(item => ({ ...item, current: item.id === profile.currentResumeId }));
  return { ok: true, profileId: args.profileId, currentResumeId: profile.currentResumeId || null,
    resumes, items: resumes, count: resumes.length };
}

export function getResume(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profile = requireProfile(store, args.profileId);
  const resume = profile.currentResumeId && store.resumes?.[profile.currentResumeId]
    ? store.resumes[profile.currentResumeId]
    : Object.values(store.resumes || {}).find(item => item.profileId === profile.id)
      || { id: profile.currentResumeId, revision: 0, sourceName: null, document: profile.resume, sourceHash: null, verificationStatus: 'needs_verification' };
  return { ok: true, profileId: profile.id, currentResumeId: profile.currentResumeId || null,
    resume: { ...resume, document: resume.document || null },
    resumeText: profile.resumeText ?? '', identity: profile.resume?.identity || resume.document?.identity || null,
    verificationStatus: resume.verificationStatus || 'needs_verification' };
}

export function getScore(dataDir, args = {}) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  const store = loadStore(dataDir);
  requireProfile(store, profileId);
  if (!jobId) throw error('missing_job', 'get_score requires jobId');
  const fit = store.scores?.[jobId] || null;
  if (!fit) return { ok: true, profileId, jobId, score: null, hasScore: false, message: 'No stored score for this job yet; run score_job first.' };
  const owned = store.jobs?.[jobId] && store.jobs[jobId].profileId === profileId;
  if (!owned) throw error('job_not_owned', `Job ${jobId} is not owned by profile ${profileId}`);
  return { ok: true, profileId, jobId, hasScore: true,
    score: { overall: fit.overall, baseOverall: fit.baseOverall, scoreStatus: fit.scoreStatus,
      eligibility: fit.eligibility, constraints: fit.constraints, dimensions: fit.dimensions } };
}

export function updateProfile(dataDir, args = {}) {
  return mutate(dataDir, args, store => {
    const profile = requireProfile(store, args.profileId);
    if (args.preferences && typeof args.preferences === 'object') profile.preferences = defaultPreferences({ ...profile.preferences, ...args.preferences }, profile.resumeText);
    if (args.name) {
      const name = String(args.name).trim();
      if (Object.values(store.profiles).some(other => other.id !== profile.id
        && (other.name === name || (Array.isArray(other.nameAliases) && other.nameAliases.includes(name))))) {
        throw error('profile_conflict', 'Profile name "' + name + '" already exists in another profile history; rename cannot merge identities');
      }
      if (name !== profile.name) {
        const priorName = profile.name;
        profile.nameAliases = [...new Set([...(profile.nameAliases || []), priorName])];
        profile.name = name;
        store.audit = Array.isArray(store.audit) ? store.audit : [];
        store.audit.push({ event: 'profile_renamed', profileId: profile.id, priorName, name, createdAt: now() });
      }
    }
    if (args.resumeIdentity && typeof args.resumeIdentity === 'object') {
      const before = { ...(profile.resume?.identity || {}) };
      profile.resumeIdentity = normalizeResumeIdentityOverride(args.resumeIdentity, profile.resumeIdentity);
      if (profile.resumeText) {
        profile.resume = resumeDocument(profile.id, profile.resumeText, profile.resumeIdentity);
        const current = profile.currentResumeId && store.resumes?.[profile.currentResumeId];
        if (current?.document) current.document.identity = { ...profile.resume.identity };
      }
      const after = { ...(profile.resume?.identity || {}) };
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        store.audit = Array.isArray(store.audit) ? store.audit : [];
        store.audit.push({ event: 'resume_identity_corrected', profileId: profile.id,
          fieldsChanged: ['name', 'email'].filter(key => before[key] !== after[key]), createdAt: now() });
      }
    }
    profile.updatedAt = now();
    return { ok: true, profileId: profile.id, profile: { ...profile, resumeText: undefined } };
  });
}

function requireExpectedProfileRevision(args) {
  if (!Number.isSafeInteger(args?.expectedRevision) || args.expectedRevision < 1) {
    throw error('expected_revision_required', 'Profile archive and restore require the current integer expectedRevision');
  }
}

export function archiveProfile(dataDir, args = {}) {
  requireExpectedProfileRevision(args);
  return mutate(dataDir, args, store => {
    const profile = requireProfile(store, args.profileId);
    const at = now();
    profile.archivedAt = at;
    profile.archiveReason = String(args.reason || '').trim().slice(0, 500) || null;
    profile.updatedAt = at;
    store.audit = Array.isArray(store.audit) ? store.audit : [];
    store.audit.push({ event: 'profile_archived', profileId: profile.id,
      reason: profile.archiveReason, expectedRevision: args.expectedRevision, createdAt: at });
    return { ok: true, profileId: profile.id, archived: true, archivedAt: at, reason: profile.archiveReason };
  });
}

export function restoreProfile(dataDir, args = {}) {
  requireExpectedProfileRevision(args);
  return mutate(dataDir, args, store => {
    const profile = requireProfile(store, args.profileId, { includeArchived: true });
    if (!profile.archivedAt) throw error('profile_not_archived', 'Profile ' + profile.id + ' is not archived');
    const at = now();
    const priorArchivedAt = profile.archivedAt;
    delete profile.archivedAt;
    delete profile.archiveReason;
    profile.updatedAt = at;
    store.audit = Array.isArray(store.audit) ? store.audit : [];
    store.audit.push({ event: 'profile_restored', profileId: profile.id,
      priorArchivedAt, expectedRevision: args.expectedRevision, createdAt: at });
    return { ok: true, profileId: profile.id, archived: false, restoredAt: at };
  });
}

export function addProofPoint(dataDir, args = {}) {
  return mutate(dataDir, args, store => {
    const profile = requireProfile(store, args.profileId);
    const summary = String(args.summary || '').trim();
    if (!summary) throw error('missing_summary', 'add_proof_point requires summary');
    const content = { profileId: profile.id, summary,
      skills: Array.isArray(args.skills) ? args.skills.map(String) : [], metrics: Array.isArray(args.metrics) ? args.metrics.map(String) : [],
      source: 'inline' };
    // Compare only canonical content, never trusted status or timestamps. Keep
    // legacy identities and full verified snapshots intact on identical retry.
    const canonical = proof => JSON.stringify({ profileId: proof.profileId, summary: proof.summary,
      skills: proof.skills, metrics: proof.metrics, source: proof.source });
    const contentKey = canonical(content);
    const existing = Object.values(store.proofPoints).find(proof => canonical(proof) === contentKey);
    if (existing) return { ok: true, proofId: existing.id, id: existing.id, proofPoint: existing };
    let proofId = id('proof', `${profile.id}:${summary}`);
    if (store.proofPoints[proofId]) proofId = id('proof', contentKey);
    if (store.proofPoints[proofId]) throw error('proof_conflict', 'Proof identity collision; existing evidence cannot be overwritten');
    const proof = { id: proofId, ...content,
      verification: 'human_required', status: 'needs_verification', createdAt: now() };
    store.proofPoints[proofId] = proof;
    profile.proofPointIds = [...new Set([...(profile.proofPointIds || []), proofId])];
    return { ok: true, proofId, id: proofId, proofPoint: proof };
  });
}

export function importJob(dataDir, args = {}) {
  const profileId = String(args.profileId || '').trim();
  const input = readIntakeText(dataDir, args, 'job', ['text', 'content']);
  if (!input.text) throw error('missing_content', 'import_job requires inline text/content or a staged path');
  const parsed = parseJobText(input.text);
  // Verbatim posting for jobs/<id>/posting.md: inline intake trims, so
  // prefer the raw inline arg when present (parse/store still use input).
  const verbatimPosting = String(args.text || args.content || '').trim() !== ''
    ? String(args.text || args.content)
    : input.text;
  // P1b Greenhouse detail (additive, sync sources only: inline detail or a
  // staged PLUGIN_DATA fixture; never network, never blocking). Plain
  // non-Greenhouse imports keep their exact prior shape.
  const greenhouseArgs = greenhouseImportArgs(args);
  const greenhouseJob = greenhouseArgs.involved ? { ...parsed, url: greenhouseArgs.url || parsed.url } : null;
  const detail = greenhouseJob
    ? resolveGreenhouseDetailSync(greenhouseJob, {
        dataDir,
        postingText: input.text,
        inlineDetail: greenhouseArgs.detail,
        fixtureName: greenhouseArgs.fixtureName,
      })
    : null;
  const resultValue = mutate(dataDir, args, store => {
    requireProfile(store, profileId);
    const sourceHash = hashText(input.text);
    const duplicate = Object.values(store.jobs).find(job => job.profileId === profileId && job.sourceHash === sourceHash);
    if (duplicate) {
      if (greenhouseJob) linkGreenhouseDetail(duplicate, detail, verbatimPosting, greenhouseArgs.url);
      return {
        jobId: duplicate.id, id: duplicate.id, job: duplicate, deduped: true,
        ...(greenhouseJob ? greenhouseMarkers(duplicate) : {}),
      };
    }
    const jobId = id('job', `${profileId}:${sourceHash}`);
    const job = { id: jobId, jobId, profileId, ...parsed, source: input.real ? 'staged_file' : 'inline_text',
      sourceName: input.sourceName, sourceHash, dedupeKey: dedupeKeyForJob(parsed), discovered: false, saved: true,
      status: 'imported', createdAt: now(), updatedAt: now() };
    if (greenhouseJob) {
      if (greenhouseArgs.url && !job.url) job.url = greenhouseArgs.url;
      linkGreenhouseDetail(job, detail, verbatimPosting, greenhouseArgs.url);
    }
    store.jobs[jobId] = job;
    return { jobId, id: jobId, job, created: true, ...(greenhouseJob ? greenhouseMarkers(job) : {}) };
  });
  return resultValue;
}

/**
 * P1b: collect Greenhouse-specific import inputs (all optional/additive).
 * `involved` is true when the caller supplied Greenhouse inputs or the
 * posting text/URL parses as a Greenhouse reference.
 */
function greenhouseImportArgs(args = {}) {
  const url = String(args.greenhouseUrl || args.greenhouseDetailUrl || args.url || '').trim();
  const detail = args.greenhouseDetail && typeof args.greenhouseDetail === 'object' ? args.greenhouseDetail : null;
  const fixtureName = String(args.greenhouseDetailFixture || '').trim() || null;
  const involved = Boolean(
    String(args.greenhouseUrl || '').trim()
    || String(args.greenhouseDetailUrl || '').trim()
    || detail
    || fixtureName
    || parseGreenhouseRef({ url }, String(args.text || args.content || ''))
  );
  return { url, detail, fixtureName, involved };
}

/**
 * P1b (RC-1): the listing copy of a posting is the least authoritative
 * identity JobSSS holds — a page <title>, a board fallback, or the machine
 * placeholders below. A successful Greenhouse detail read carries the vendor's
 * own identity, so it fills ONLY the empty/generic top-level fields; authored
 * listing values are never replaced. sourceId, sourceHash, dedupeKey, URL and
 * the stored ask list keep their existing semantics.
 */
const GENERIC_LISTING_TITLES = new Set(['Imported role', 'Imported URL role']);
// Machine page-title wrappers public ATS pages emit; never a requisition title.
const PAGE_TITLE_LISTING_TITLE = /^(?:job application for .+|.+\s[-–—|]\s+careers at .+)$/i;

function isGenericListingTitle(value) {
  const text = String(value ?? '').trim();
  if (text === '' || GENERIC_LISTING_TITLES.has(text)) return true;
  return PAGE_TITLE_LISTING_TITLE.test(text);
}

function isGenericListingCompany(value) {
  const text = String(value ?? '').trim();
  return text === '' || text.toLowerCase() === 'unknown company';
}

function isGenericListingLocation(value) {
  const text = String(value ?? '').trim();
  return text === '' || text.toLowerCase() === 'unknown';
}

function isGenericWorkModel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === '' || text === 'unknown';
}

/** Fill only empty/generic listing identity fields from the normalized detail. */
function promoteGreenhouseListing(job, detail) {
  const listing = detail && detail.listing;
  if (!listing || typeof listing !== 'object') return job;
  if (listing.title && isGenericListingTitle(job.title)) job.title = listing.title;
  if (listing.company && isGenericListingCompany(job.company)) job.company = listing.company;
  if (listing.location && isGenericListingLocation(job.location)) job.location = listing.location;
  if (listing.workModel && listing.workModel !== 'unknown' && isGenericWorkModel(job.workModel)) job.workModel = listing.workModel;
  return job;
}

/**
 * P1b: persist/link Greenhouse application detail on a job record.
 * Success stores the verbatim posting plus normalized questions/documents
 * with provenance; degradation records an explicit marker and still keeps
 * the posting. Never throws.
 */
function linkGreenhouseDetail(job, detail, postingText, sourceUrl) {
  job.postingText = String(postingText || '');
  if (detail && detail.ok) {
    job.applicationDetail = {
      board: detail.board,
      jobId: detail.id,
      sourceUrl: job.url || sourceUrl || '',
      detailUrl: detail.detailUrl,
      fetchedAt: detail.fetchedAt,
      hash: hashText(detail.rawText),
      questions: detail.questions,
      documents: detail.documents,
      rawDetail: detail.rawDetail,
      source: detail.source,
    };
    job.detailCoverage = { status: 'ok', source: detail.source, detailUrl: detail.detailUrl, fetchedAt: detail.fetchedAt };
    job.questionsStatus = { status: 'ok', count: detail.questions.length, detailUrl: detail.detailUrl };
    // RC-1: the detail payload is the authoritative listing identity; fill
    // only the empty/generic top-level fields, never an authored value.
    promoteGreenhouseListing(job, detail);
  } else {
    // Degradation keeps a lightweight applicationDetail (empty ask list +
    // today's listing fields + explicit marker) so the per-job folder still
    // materializes jobs/<id>/application.json instead of vanishing.
    const failed = detail || { detailUrl: '', reason: 'detail_fetch_failed' };
    const reason = String(failed.reason || 'detail_fetch_failed');
    job.applicationDetail = {
      board: String(failed.board || ''),
      jobId: String(failed.id ?? failed.jobId ?? ''),
      sourceUrl: job.url || sourceUrl || '',
      detailUrl: String(failed.detailUrl || ''),
      fetchedAt: failed.fetchedAt || now(),
      hash: hashText(String(postingText || '')),
      questions: [],
      documents: [],
      rawDetail: null,
      source: 'degraded',
      status: 'degraded',
      degraded: true,
      reason,
      ...(failed.message ? { message: String(failed.message) } : {}),
      listing: {
        title: job.title || '',
        company: job.company || '',
        location: job.location || '',
        compensation: job.compensation || '',
        workModel: job.workModel || '',
        url: job.url || sourceUrl || '',
      },
    };
    job.detailCoverage = { status: 'degraded', reason, detailUrl: failed.detailUrl || '' };
    job.questionsStatus = { status: 'degraded', reason: failed.reason || 'detail_fetch_failed' };
  }
  job.updatedAt = now();
  return job;
}

function greenhouseMarkers(job) {
  return { detailCoverage: job.detailCoverage, questionsStatus: job.questionsStatus };
}

/**
 * P1b readiness gate (required questions minus saved answers, plus required
 * documents minus produced drafts). Implementation lives in src/checklist.js
 * so the deterministic workspace projection can render the identical gate
 * without importing this module (and without an import cycle).
 */

export async function importJobUrl(dataDir, args = {}) {
  const profileId = String(args.profileId || '').trim();
  const url = assertPublicJobUrl(args.url).href;
  const snapshot = loadStore(dataDir);
  requireProfile(snapshot, profileId);
  const prior = Object.values(snapshot.jobs).find(job => job.profileId === profileId && job.url === url && job.fetchStatus === 'fetched');
  if (prior) return { ok: true, jobId: prior.id, id: prior.id, job: prior, deduped: true, revision: snapshot.revision };
  const fetched = await fetchPublicJob(url);
  // P1b: link Greenhouse application detail when the URL is a Greenhouse
  // reference (fixture first, then the same public API trust level as the
  // listing fetch). Degradation never blocks the import.
  let urlDetail = null;
  let urlGreenhouse = false;
  try {
    const ref = parseGreenhouseRef({ url });
    urlGreenhouse = Boolean(ref);
    if (ref) {
      urlDetail = await fetchApplicationDetail({ url }, { dataDir, postingText: fetched.description || '' });
    }
  } catch {
    urlDetail = null;
  }
  return mutate(dataDir, args, store => {
    requireProfile(store, profileId);
    const duplicate = Object.values(store.jobs).find(job => job.profileId === profileId && job.url === fetched.url && job.fetchStatus === 'fetched');
    if (duplicate) {
      if (urlGreenhouse) {
        linkGreenhouseDetail(duplicate, urlDetail && urlDetail.ok ? urlDetail : (urlDetail || { ok: false, reason: 'detail_fetch_failed', detailUrl: '' }),
          typeof duplicate.postingText === 'string' && duplicate.postingText ? duplicate.postingText : fetched.description, url);
      }
      return { ok: true, jobId: duplicate.id, id: duplicate.id, job: duplicate, deduped: true, ...(urlGreenhouse ? greenhouseMarkers(duplicate) : {}) };
    }
    const sourceHash = hashText(fetched.description);
    const jobId = id('job', `${profileId}:url:${fetched.url}`);
    const job = { ...fetched, id: jobId, jobId, profileId, sourceHash,
      discovered: false, saved: false, status: 'imported_url', dedupeKey: dedupeKeyForJob(fetched),
      createdAt: now(), updatedAt: now() };
    if (urlGreenhouse) linkGreenhouseDetail(job, urlDetail && urlDetail.ok ? urlDetail : (urlDetail || { ok: false, reason: 'detail_fetch_failed', detailUrl: '' }), fetched.description, url);
    store.jobs[jobId] = job;
    return { ok: true, jobId, id: jobId, job, created: true, ...(urlGreenhouse ? greenhouseMarkers(job) : {}),
      message: 'Public job URL fetched and stored locally for review. No application or other external action was performed.' };
  });
}

export function listJobs(dataDir, args = {}) {
  const profileId = String(args.profileId || '').trim();
  const store = loadStore(dataDir);
  requireProfile(store, profileId);
  const jobs = Object.values(store.jobs).filter(job => job.profileId === profileId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, jobs, items: jobs, count: jobs.length, profileId };
}

export function scoreJob(dataDir, args = {}) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  return mutate(dataDir, args, store => {
    const job = requireJobOwned(store, jobId, profileId);
    const profile = requireProfile(store, profileId);
    // Current matching uses only active proof: current-resume set plus
    // independent nonretired manual proof. Historical-only proof remains
    // stored but cannot contribute score evidence.
    const proofPoints = activeProofsFor(store, profile);
    const fit = localScore({ profile: { ...profile, proofPoints }, job });
    store.scores[jobId] = fit;
    return { ...fit, jobId, profileId, profile: profileId, id: jobId, fit };
  });
}

export function pursueJob(dataDir, args = {}) {
  // P1b: ensure linked Greenhouse detail exists before the pursuit commit
  // so the per-job folder materializes with the ask list. Sync sources
  // only (inline args or staged fixture); never network, never blocking.
  const greenhouseArgs = greenhouseImportArgs(args);
  return mutate(dataDir, args, store => {
    const jobId = String(args.jobId || args.id || '');
    const profileId = String(args.profileId || '');
    const job = store.jobs?.[jobId] || null;
    if (job && job.profileId === profileId && !job.applicationDetail
      && (greenhouseArgs.involved || parseGreenhouseRef(job, job.description || ''))) {
      const detail = resolveGreenhouseDetailSync(
        { ...job, url: greenhouseArgs.url || job.url },
        { dataDir, postingText: job.description || '', inlineDetail: greenhouseArgs.detail, fixtureName: greenhouseArgs.fixtureName }
      );
      linkGreenhouseDetail(job, detail,
        typeof job.postingText === 'string' && job.postingText ? job.postingText : String(job.description || ''),
        greenhouseArgs.url || job.url);
    }
    return pursueLocal(store, { jobId: String(args.jobId || args.id || ''), profileId: String(args.profileId || '') });
  });
}

export function saveJob(dataDir, args = {}) {
  return mutate(dataDir, args, store => saveLocal(store, args));
}

export function skipJob(dataDir, args = {}) { return mutate(dataDir, args, store => skipLocal(store, args)); }
export function archiveJob(dataDir, args = {}) { return mutate(dataDir, args, store => archiveLocal(store, args)); }
export function updateApplicationStatus(dataDir, args = {}) {
  return mutate(dataDir, args, store => updateLocalStatus(store, args));
}

export function applicationsPlan(dataDir, args = {}) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  const store = loadStore(dataDir);
  const job = requireJobOwned(store, jobId, profileId);
  const fit = store.scores?.[jobId] || null;
  const application = store.applications?.[jobId] || { id: jobId, jobId, profileId, status: 'not_pursued', localOnly: true };
  const tasks = Object.values(store.tasks || {}).filter(task => task.profileId === profileId && task.jobId === jobId && task.status === 'open');
  const terminal = new Set(['skipped', 'archived', 'withdrawn', 'rejected', 'ghosted']);
  const isTerminal = terminal.has(application.status);
  const excluded = fit?.eligibility?.status === 'excluded';
  const nextActions = isTerminal || excluded
    ? []
    : [...new Set(tasks.map(task => task.text).concat(['human review', 'verify proof-grounded materials']))];
  // P1b: packet coverage cites the real ask list (persisted questions[] +
  // required documents) instead of a generic template.
  const detail = job.applicationDetail && Array.isArray(job.applicationDetail.questions) ? job.applicationDetail : null;
  const askList = detail ? detail.questions.map(item => String(item.label || '')).filter(Boolean) : [];
  const requiredQuestions = detail ? detail.questions.filter(item => item && item.required).map(item => String(item.label)) : [];
  const requiredDocuments = detail
    ? (Array.isArray(detail.documents) ? detail.documents : []).filter(item => item && item.required).map(item => String(item.kind))
    : [];
  const unansweredRequired = unansweredRequiredFor(store, job) || [];
  return { ok: true, jobId, profileId, application,
    plan: { jobId, profileId, status: application.status, readiness: isTerminal ? 'closed' : excluded ? 'excluded' : fit ? 'ready_for_review' : 'needs_score',
      score: fit ? { overall: fit.overall, scoreStatus: fit.scoreStatus } : null,
      nextActions },
    coverage: detail ? {
      source: 'application_detail',
      detailUrl: detail.detailUrl || '',
      askList, questions: askList, requiredQuestions, requiredDocuments,
      gaps: unansweredRequired, unansweredRequired,
    } : null,
    blockers: excluded ? fit.eligibility.hardFailures : [], warnings: [], message: 'Local pipeline plan; no external action was performed.' };
}

export function reviewQueue(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = String(args.profileId || '').trim();
  requireProfile(store, profileId);
  const artifacts = listReviewArtifacts(store, { profileId }).artifacts;
  const jobs = Object.values(store.jobs).filter(job => job.profileId === profileId);
  const terminal = new Set(['skipped', 'archived', 'withdrawn', 'rejected', 'ghosted']);
  const fallback = jobs.filter(job => (store.applications?.[job.id] || store.scores?.[job.id])
      && !terminal.has(store.applications?.[job.id]?.status)).map(job => ({
    id: job.id, jobId: job.id, profileId, title: job.title, kind: 'job_review', status: 'needs_review',
  }));
  // Every pending job remains visible even when another job has an artifact:
  // combine artifact entries with per-job fallbacks, without duplicating a
  // fallback for an already represented job.
  const represented = new Set(artifacts.map(item => item.jobId || item.id));
  const queue = [...artifacts, ...fallback.filter(item => !represented.has(item.jobId))];
  // P1b: per pursued job, surface the pre-decide readiness gate —
  // unansweredRequired[] covering required questions AND required
  // documents. Entries without a linked ask list keep their prior shape.
  const gated = queue.map(item => {
    const job = store.jobs?.[item.jobId || item.id] || null;
    if (!job || job.profileId !== profileId) return item;
    const unanswered = unansweredRequiredFor(store, job);
    if (!unanswered) return item;
    return { ...item, unansweredRequired: unanswered, unanswered_required: unanswered };
  });
  return { ok: true, profileId, queue: gated, items: gated, artifacts: gated, count: gated.length,
    message: 'Local review queue; human decision required for any external step.' };
}

export function createSavedSearch(dataDir, args = {}) {
  return mutate(dataDir, args, store => {
    // The fixture (when present) is resolved and validated against
    // PLUGIN_DATA here, so a rejected search never reaches the store and a
    // relative fixture never depends on the server process cwd.
    const result = createSearch(store, { ...args, dataDir, at: now() });
    return { ok: true, searchId: result.search.id, id: result.search.id, name: result.search.name, ...result };
  });
}
export function listSavedSearches(dataDir, args = {}) {
  const store = loadStore(dataDir); requireProfile(store, args.profileId);
  const searches = savedSearches(store, { profileId: args.profileId });
  return { ok: true, profileId: args.profileId, searches, items: searches, count: searches.length };
}
export async function searchJobs(dataDir, args = {}) {
  const ref = args.search || args.searchId || args.name;
  const snapshot = loadStore(dataDir);
  requireProfile(snapshot, args.profileId);
  const search = getSavedSearch(snapshot, ref);
  if (!search) throw error('unknown_saved_search', `Unknown saved search: ${ref}`);
  if (search.profileId !== args.profileId) throw error('profile_mismatch', `Saved search ${search.id} belongs to profile ${search.profileId}, not ${args.profileId}`);
  const sourceResult = await fetchSavedSearchSource(search, { dataDir });
  return mutate(dataDir, args, store => runSavedSearch(store, { searchRef: ref, profileId: args.profileId, dataDir, sourceResult }));
}
export async function dailyDiscovery(dataDir, args = {}) {
  const snapshot = loadStore(dataDir);
  requireProfile(snapshot, args.profileId);
  const searches = savedSearches(snapshot, { profileId: args.profileId });
  // Per-search fault isolation (rc5): one unresolvable saved search must not
  // abort the whole daily run. Each search's source failure is captured here
  // and reported in the aggregate per-search `errors` list (searchId /
  // searchName) while every resolvable search still returns its results.
  const outcomes = await Promise.all(searches.map(async search => {
    try {
      return { searchId: search.id, result: await fetchSavedSearchSource(search, { dataDir }) };
    } catch (error) {
      return { searchId: search.id, error };
    }
  }));
  const sourceResults = {};
  const sourceErrors = {};
  for (const outcome of outcomes) {
    if (outcome.error) sourceErrors[outcome.searchId] = outcome.error;
    else sourceResults[outcome.searchId] = outcome.result;
  }
  return mutate(dataDir, args, store => runAllSearches(store, {
    profileId: args.profileId, dataDir, sourceResults, sourceErrors,
  }));
}

export function listTasks(dataDir, args = {}) { return tasksForProfile(loadStore(dataDir), args); }
export function updateTask(dataDir, args = {}) { return mutate(dataDir, args, store => updateLocalTask(store, args)); }
export function tailorResume(dataDir, args = {}) { return mutate(dataDir, args, store => tailorLocal(store, { ...args, dataDir })); }
export function draftCoverLetter(dataDir, args = {}) { return mutate(dataDir, args, store => coverLocal(store, { ...args, dataDir })); }
export function saveAnswer(dataDir, args = {}) { return mutate(dataDir, args, store => addAnswer(store, args)); }
export function answersList(dataDir, args = {}) { return listAnswers(loadStore(dataDir), args); }
export function answersMatch(dataDir, args = {}) { return matchAnswers(loadStore(dataDir), args); }
export function previewSync(dataDir, args = {}) { return syncPreview(loadStore(dataDir), args); }

export {
  importContact, listContacts, recordResearch, listResearch, mapReachableNetwork,
  planOutreach, draftOutreach, listOutreach, draftInterviewStory,
  listInterviewStories, interviewPrep, getInterviewPrep, interviewDebriefHandoff,
};
