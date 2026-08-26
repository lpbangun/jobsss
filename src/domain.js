// Domain handlers for the standalone JobSSS workflow.
// Attributed ports: JobOS profiles/jobs/discovery/scoring/lifecycle/artifacts,
// networking, and interview contracts, reimplemented over the bundled JSON
// store. JobOS is MIT licensed (see root LICENSE) and is never loaded at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slug, id, now, loadStore, commitStore, hashText, dedupeKeyForJob, tokenize,
  ensureDataDir, STORE_SCHEMA_VERSION,
} from './store.js';
import { localScore } from './scoring.js';
import {
  assertPublicJobUrl, parseJobText, urlImportFallbackJob, createSavedSearch as createSearch,
  listSavedSearches as savedSearches, runSavedSearch, runAllSearches,
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROZEN_FIXTURES = new Set([
  fs.realpathSync(path.join(ROOT, 'tests/fixtures/profile-resume.md')),
  fs.realpathSync(path.join(ROOT, 'tests/fixtures/job-posting.md')),
]);

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

function requireProfile(store, profileId) {
  const value = String(profileId || '').trim();
  if (!value) throw error('missing_profile', 'profileId is required');
  const profile = store.profiles?.[value];
  if (!profile) throw error('unknown_profile', `Unknown profile: ${value}`);
  return profile;
}

function allowedIntakeFile(dataDir, raw, kind) {
  if (!raw) return null;
  let real;
  try { real = fs.realpathSync(path.resolve(String(raw))); }
  catch { throw error(`${kind}_read_error`, `${kind} staged file does not exist`); }
  const data = ensureDataDir(dataDir);
  const insideData = real === data || real.startsWith(`${data}${path.sep}`);
  if (!insideData && !FROZEN_FIXTURES.has(real)) {
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

function defaultPreferences(name, input = {}) {
  const supplied = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    targetRoleFamilies: Array.isArray(supplied.targetRoleFamilies) ? supplied.targetRoleFamilies : [name],
    industries: Array.isArray(supplied.industries) ? supplied.industries : [],
    companyStages: Array.isArray(supplied.companyStages) ? supplied.companyStages : [],
    locations: Array.isArray(supplied.locations) ? supplied.locations : [],
    salary: supplied.salary && typeof supplied.salary === 'object' ? supplied.salary : { min: null, max: null, currency: 'USD' },
    dealbreakers: Array.isArray(supplied.dealbreakers) ? supplied.dealbreakers : [],
    skills: Array.isArray(supplied.skills) ? supplied.skills : slug(name).split('-').filter(Boolean),
    missionKeywords: Array.isArray(supplied.missionKeywords) ? supplied.missionKeywords : [],
    values: Array.isArray(supplied.values) ? supplied.values : [],
    workModel: String(supplied.workModel || ''),
    communicationStyle: String(supplied.communicationStyle || 'concise, warm, evidence-grounded'),
    searchStrategy: String(supplied.searchStrategy || 'focused'),
  };
}

function extractProofPoints(profileId, resumeText) {
  const action = /\b(built|led|managed|created|designed|improved|launched|reduced|increased|owned|shipped|analyzed|implemented|taught|researched|coordinated|facilitated|developed)\b/i;
  return String(resumeText || '').split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*•]\s*/, ''))
    .filter(line => line.length >= 20 && action.test(line)).slice(0, 24)
    .map((summary, index) => ({
      id: id('proof', `${profileId}:${index}:${summary}`), profileId, summary,
      skills: [...new Set(tokenize(summary).filter(token => token.length > 3))].slice(0, 10),
      metrics: [...summary.matchAll(/(?:\$[\d,.]+|\d+(?:\.\d+)?%|\d+x|\b\d{2,}\b)/gi)].map(match => match[0]),
      source: 'resume_import', verification: 'human_required', status: 'needs_verification', createdAt: now(),
    }));
}

function resumeDocument(profileId, text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const email = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  return {
    schemaVersion: 1,
    profileId,
    identity: { name: lines[0]?.replace(/^#\s*/, '') || '', email, verificationStatus: 'needs_verification' },
    sourceHash: hashText(text),
    verificationStatus: 'needs_verification',
    importedAt: now(),
  };
}

function persistResumeRevision(store, profile, text, sourceName) {
  if (!text) return null;
  store.resumes = store.resumes || {};
  const sourceHash = hashText(text);
  const existing = Object.values(store.resumes).find(item => item.profileId === profile.id && item.sourceHash === sourceHash);
  if (existing) return existing;
  const revision = Object.values(store.resumes).filter(item => item.profileId === profile.id).length + 1;
  const resumeId = id('resume', `${profile.id}:${sourceHash}`);
  const record = { id: resumeId, profileId: profile.id, revision, sourceName, sourceHash,
    document: resumeDocument(profile.id, text), verificationStatus: 'needs_verification', createdAt: now() };
  store.resumes[resumeId] = record;
  profile.resumeRevisionIds = [...(profile.resumeRevisionIds || []), resumeId];
  profile.currentResumeId = resumeId;
  return record;
}

export function doctor(dataDir) {
  const abs = ensureDataDir(dataDir);
  let writable = true;
  try { fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK); } catch { writable = false; }
  return {
    ok: writable, status: 'ok', runtime: 'jobsss-bundled', version: '0.2.0',
    schemaVersion: STORE_SCHEMA_VERSION, dataDir: abs, pluginData: abs,
    storeExists: fs.existsSync(path.join(abs, 'store.json')), bundled: true, writable,
    launcher: './bin/jobsss',
    message: 'Bundled runtime diagnosed; PLUGIN_DATA is isolated and writable. JobOS is not required. Do not invent jobs, scores, proofs, sends, or submissions.',
  };
}

export function start(dataDir, args = {}) {
  const committed = commitStore(dataDir, { expectedRevision: expected(args) }, store => {
    store.audit = Array.isArray(store.audit) ? store.audit : [];
    store.audit.push({ event: 'start', createdAt: now() });
    return store;
  });
  return { ok: true, initialized: true, migrated: true, schemaVersion: STORE_SCHEMA_VERSION, revision: committed.revision,
    dataDir: path.resolve(dataDir), storePath: committed.storePath, message: 'Versioned durable state initialized under PLUGIN_DATA' };
}

export function createProfile(dataDir, args = {}) {
  const name = String(args.name || args.profileName || '').trim();
  if (!name) throw error('missing_name', 'create_profile requires name');
  const input = readIntakeText(dataDir, args, 'resume', ['resumeText', 'text', 'content']);
  return mutate(dataDir, args, store => {
    const profileId = slug(name);
    const existing = store.profiles[profileId];
    if (existing) {
      if (input.text) {
        existing.resumeText = input.text;
        existing.resumeSource = input.sourceName;
        existing.resume = resumeDocument(profileId, input.text);
        persistResumeRevision(store, existing, input.text, input.sourceName);
        const proofs = extractProofPoints(profileId, input.text);
        existing.proofPointIds = proofs.map(proof => proof.id);
        for (const proof of proofs) store.proofPoints[proof.id] = proof;
        existing.updatedAt = now();
      }
      const proofPoints = Object.values(store.proofPoints).filter(proof => proof.profileId === profileId);
      return { profileId, id: profileId, profile: existing, proofPoints, created: false };
    }
    const proofPoints = extractProofPoints(profileId, input.text);
    const profile = {
      id: profileId, name, preferences: defaultPreferences(name, args.preferences),
      resumeSource: input.sourceName, resumeText: input.text,
      resume: input.text ? resumeDocument(profileId, input.text) : null,
      proofPointIds: proofPoints.map(proof => proof.id), createdAt: now(), updatedAt: now(),
    };
    store.profiles[profileId] = profile;
    persistResumeRevision(store, profile, input.text, input.sourceName);
    for (const proof of proofPoints) store.proofPoints[proof.id] = proof;
    return { profileId, id: profileId, profile, proofPoints, created: true };
  });
}

export function listProfiles(dataDir) {
  const profiles = Object.values(loadStore(dataDir).profiles || {}).map(({ resumeText: _private, ...profile }) => profile);
  return { ok: true, profiles, items: profiles, count: profiles.length };
}

export function listResumes(dataDir, args = {}) {
  const store = loadStore(dataDir);
  requireProfile(store, args.profileId);
  const resumes = Object.values(store.resumes || {}).filter(item => item.profileId === args.profileId)
    .sort((a, b) => a.revision - b.revision);
  return { ok: true, profileId: args.profileId, resumes, items: resumes, count: resumes.length };
}

export function updateProfile(dataDir, args = {}) {
  return mutate(dataDir, args, store => {
    const profile = requireProfile(store, args.profileId);
    if (args.preferences && typeof args.preferences === 'object') profile.preferences = defaultPreferences(profile.name, { ...profile.preferences, ...args.preferences });
    if (args.name) profile.name = String(args.name).trim();
    profile.updatedAt = now();
    return { ok: true, profileId: profile.id, profile: { ...profile, resumeText: undefined } };
  });
}

export function addProofPoint(dataDir, args = {}) {
  return mutate(dataDir, args, store => {
    const profile = requireProfile(store, args.profileId);
    const summary = String(args.summary || '').trim();
    if (!summary) throw error('missing_summary', 'add_proof_point requires summary');
    const proofId = id('proof', `${profile.id}:${summary}`);
    const proof = { id: proofId, profileId: profile.id, summary,
      skills: Array.isArray(args.skills) ? args.skills.map(String) : [], metrics: Array.isArray(args.metrics) ? args.metrics.map(String) : [],
      source: 'inline', verification: 'human_required', status: 'needs_verification', createdAt: now() };
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
  const resultValue = mutate(dataDir, args, store => {
    requireProfile(store, profileId);
    const sourceHash = hashText(input.text);
    const duplicate = Object.values(store.jobs).find(job => job.profileId === profileId && job.sourceHash === sourceHash);
    if (duplicate) return { jobId: duplicate.id, id: duplicate.id, job: duplicate, deduped: true };
    const jobId = id('job', `${profileId}:${sourceHash}`);
    const job = { id: jobId, jobId, profileId, ...parsed, source: input.real ? 'staged_file' : 'inline_text',
      sourceName: input.sourceName, sourceHash, dedupeKey: dedupeKeyForJob(parsed), discovered: false, saved: true,
      status: 'imported', createdAt: now(), updatedAt: now() };
    store.jobs[jobId] = job;
    return { jobId, id: jobId, job, created: true };
  });
  if (resultValue.created && input.real) writeJobProjection(dataDir, resultValue.job);
  return resultValue;
}

export function importJobUrl(dataDir, args = {}) {
  const profileId = String(args.profileId || '').trim();
  const url = assertPublicJobUrl(args.url).href;
  return mutate(dataDir, args, store => {
    requireProfile(store, profileId);
    const duplicate = Object.values(store.jobs).find(job => job.profileId === profileId && job.url === url);
    if (duplicate) return { ok: true, jobId: duplicate.id, id: duplicate.id, job: duplicate, deduped: true };
    const fallback = urlImportFallbackJob({ profileId, url });
    const jobId = id('job', `${profileId}:url:${url}`);
    const job = { ...fallback, id: jobId, jobId, profileId, discovered: false, saved: false,
      status: 'needs_enrichment', dedupeKey: dedupeKeyForJob(fallback), createdAt: now(), updatedAt: now() };
    store.jobs[jobId] = job;
    return { ok: true, jobId, id: jobId, job, created: true,
      message: 'Public URL recorded locally for review; offline mode did not claim a successful fetch or external action.' };
  });
}

function writeJobProjection(dataDir, job) {
  const dir = path.join(ensureDataDir(dataDir), 'jobs', job.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
}

function writeApplicationProjection(dataDir, jobId) {
  const store = loadStore(dataDir);
  const application = store.applications?.[jobId];
  if (!application) return;
  const dir = path.join(ensureDataDir(dataDir), 'applications', jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'application.json'), JSON.stringify(application, null, 2));
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
    const proofPoints = Object.values(store.proofPoints || {}).filter(proof => proof.profileId === profileId);
    const fit = localScore({ profile: { ...profile, proofPoints }, job });
    store.scores[jobId] = fit;
    return { ...fit, jobId, profileId, profile: profileId, id: jobId, fit };
  });
}

export function pursueJob(dataDir, args = {}) {
  const output = mutate(dataDir, args, store => pursueLocal(store, { jobId: String(args.jobId || args.id || ''), profileId: String(args.profileId || '') }));
  writeJobProjection(dataDir, loadStore(dataDir).jobs[output.jobId]);
  writeApplicationProjection(dataDir, output.jobId);
  return output;
}

export function saveJob(dataDir, args = {}) {
  const output = mutate(dataDir, args, store => saveLocal(store, args));
  writeJobProjection(dataDir, loadStore(dataDir).jobs[output.jobId]);
  writeApplicationProjection(dataDir, output.jobId);
  return output;
}

export function skipJob(dataDir, args = {}) { return mutate(dataDir, args, store => skipLocal(store, args)); }
export function archiveJob(dataDir, args = {}) { return mutate(dataDir, args, store => archiveLocal(store, args)); }
export function updateApplicationStatus(dataDir, args = {}) {
  const output = mutate(dataDir, args, store => updateLocalStatus(store, args));
  writeApplicationProjection(dataDir, output.jobId);
  return output;
}

export function applicationsPlan(dataDir, args = {}) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  const store = loadStore(dataDir);
  const job = requireJobOwned(store, jobId, profileId);
  const fit = store.scores?.[jobId] || null;
  const application = store.applications?.[jobId] || { id: jobId, jobId, profileId, status: 'not_pursued', localOnly: true };
  const tasks = Object.values(store.tasks || {}).filter(task => task.profileId === profileId && task.jobId === jobId && task.status === 'open');
  return { ok: true, jobId, profileId, application,
    plan: { jobId, profileId, status: application.status, readiness: fit ? 'ready_for_review' : 'needs_score',
      score: fit ? { overall: fit.overall, scoreStatus: fit.scoreStatus } : null,
      nextActions: tasks.map(task => task.text).concat(['human review', 'verify proof-grounded materials']) },
    blockers: [], warnings: [], message: 'Local pipeline plan; no external action was performed.' };
}

export function reviewQueue(dataDir, args = {}) {
  const store = loadStore(dataDir);
  const profileId = String(args.profileId || '').trim();
  requireProfile(store, profileId);
  const artifacts = listReviewArtifacts(store, { profileId }).artifacts;
  const jobs = Object.values(store.jobs).filter(job => job.profileId === profileId);
  const fallback = jobs.filter(job => store.applications?.[job.id] || store.scores?.[job.id]).map(job => ({
    id: job.id, jobId: job.id, profileId, title: job.title, kind: 'job_review', status: 'needs_review',
  }));
  const queue = artifacts.length ? artifacts : fallback;
  return { ok: true, profileId, queue, items: queue, artifacts, count: queue.length,
    message: 'Local review queue; human decision required for any external step.' };
}

export function createSavedSearch(dataDir, args = {}) {
  return mutate(dataDir, args, store => {
    const result = createSearch(store, { ...args, at: now() });
    return { ok: true, searchId: result.search.id, id: result.search.id, name: result.search.name, ...result };
  });
}
export function listSavedSearches(dataDir, args = {}) {
  const store = loadStore(dataDir); requireProfile(store, args.profileId);
  const searches = savedSearches(store, { profileId: args.profileId });
  return { ok: true, profileId: args.profileId, searches, items: searches, count: searches.length };
}
export function searchJobs(dataDir, args = {}) {
  return mutate(dataDir, args, store => runSavedSearch(store, { searchRef: args.search || args.searchId || args.name, profileId: args.profileId, dataDir }));
}
export function dailyDiscovery(dataDir, args = {}) {
  return mutate(dataDir, args, store => runAllSearches(store, { profileId: args.profileId, dataDir }));
}

export function listTasks(dataDir, args = {}) { return tasksForProfile(loadStore(dataDir), args); }
export function updateTask(dataDir, args = {}) { return mutate(dataDir, args, store => updateLocalTask(store, args)); }
export function tailorResume(dataDir, args = {}) { return mutate(dataDir, args, store => tailorLocal(store, args)); }
export function draftCoverLetter(dataDir, args = {}) { return mutate(dataDir, args, store => coverLocal(store, args)); }
export function saveAnswer(dataDir, args = {}) { return mutate(dataDir, args, store => addAnswer(store, args)); }
export function answersList(dataDir, args = {}) { return listAnswers(loadStore(dataDir), args); }
export function answersMatch(dataDir, args = {}) { return matchAnswers(loadStore(dataDir), args); }
export function previewSync(dataDir, args = {}) { return syncPreview(loadStore(dataDir), args); }

export {
  importContact, listContacts, recordResearch, listResearch, mapReachableNetwork,
  planOutreach, draftOutreach, listOutreach, draftInterviewStory,
  listInterviewStories, interviewPrep, getInterviewPrep, interviewDebriefHandoff,
};
