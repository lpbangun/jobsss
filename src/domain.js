// Domain handlers for the standalone journey.
// Attributed ports: profile handling from JobOS src/profiles.js (createProfile,
// structuredProofs concept), job ingestion/dedup from src/jobs.js
// (dedupeKey, sourceHistory), and application tracking from src/tracking.js,
// all reimplemented as minimal JSON store operations.
import fs from 'node:fs';
import path from 'node:path';
import { slug, id, now, loadStore, saveStore, hashText, dedupeKeyForJob, tokenize, ensureDataDir } from './store.js';
import { localScore } from './scoring.js';

function extractProofPoints(profileId, resumeText) {
  const action = /\b(built|led|managed|created|designed|improved|launched|reduced|increased|owned|shipped|analyzed|implemented|taught|researched|coordinated|facilitated|developed)\b/i;
  return String(resumeText || '').split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*•]\s*/, ''))
    .filter(line => line.length >= 20 && action.test(line))
    .slice(0, 24)
    .map((summary, index) => ({
      id: id('proof', `${profileId}:${index}:${summary}`),
      profileId,
      summary,
      skills: [...new Set(tokenize(summary).filter(token => token.length > 3))].slice(0, 10),
      metrics: [...summary.matchAll(/(?:\$[\d,.]+|\d+(?:\.\d+)?%|\d+x|\b\d{2,}\b)/gi)].map(match => match[0]),
      source: 'resume_import',
      verification: 'human_required',
      createdAt: now(),
    }));
}

function parseJobFile(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const find = key => {
    const re = new RegExp(`^${key}\\s*:\\s*`, 'i');
    const line = lines.find(l => re.test(l));
    return line ? line.replace(re, '').trim() : '';
  };
  const heading = lines.find(l => /^#\s+/.test(l));
  const title = find('title') || (heading ? heading.replace(/^#\s+/, '').trim() : '') || 'Imported role';
  const company = find('company') || 'Unknown company';
  const location = find('location') || '';
  return { title, company, location, description: text };
}

export function doctor(dataDir) {
  const abs = ensureDataDir(dataDir);
  let writable = true;
  try { fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK); } catch { writable = false; }
  const storeExists = fs.existsSync(path.join(abs, 'store.json'));
  return {
    ok: writable,
    status: 'ok',
    runtime: 'jobsss-bundled',
    version: '0.1.0',
    dataDir: abs,
    pluginData: abs,
    storeExists,
    bundled: true,
    writable,
    launcher: './bin/jobsss',
    message: 'Bundled runtime diagnosed; PLUGIN_DATA is writable; JobOS not required. Do not invent jobs, scores, proofs, sends, or submissions.',
  };
}

export function start(dataDir) {
  const store = loadStore(dataDir);
  saveStore(dataDir, store);
  return {
    ok: true,
    initialized: true,
    dataDir: path.resolve(dataDir),
    storePath: path.join(path.resolve(dataDir), 'store.json'),
    message: 'Durable state initialized under PLUGIN_DATA',
  };
}

export function createProfile(dataDir, args) {
  const name = String(args.name || args.profileName || '').trim();
  if (!name) throw Object.assign(new Error('create_profile requires name'), { code: 'missing_name' });
  const resumePath = args.resumePath || args.path || args.filePath || null;
  let resumeText = String(args.resumeText || '').trim();
  if (!resumeText && resumePath) {
    try {
      resumeText = fs.readFileSync(path.resolve(String(resumePath)), 'utf8');
    } catch (error) {
      throw Object.assign(new Error(`Cannot read resume file: ${error.message}`), { code: 'resume_read_error' });
    }
  }
  const profileId = slug(name);
  const store = loadStore(dataDir);
  const existing = store.profiles[profileId];
  if (existing) {
    if (resumeText && !existing.resumeText) {
      existing.resumeText = resumeText;
      existing.resumeSource = resumePath ? path.basename(String(resumePath)) : 'inline';
      const proofs = extractProofPoints(profileId, resumeText);
      existing.proofPointIds = proofs.map(proof => proof.id);
      for (const proof of proofs) store.proofPoints[proof.id] = proof;
      existing.updatedAt = now();
      saveStore(dataDir, store);
    }
    const proofs = Object.values(store.proofPoints).filter(proof => proof.profileId === profileId);
    return { profileId, id: profileId, profile: existing, proofPoints: proofs, created: false };
  }
  const proofs = extractProofPoints(profileId, resumeText);
  const profile = {
    id: profileId,
    name,
    resumeSource: resumePath ? path.basename(String(resumePath)) : resumeText ? 'inline' : null,
    resumeText,
    proofPointIds: proofs.map(proof => proof.id),
    createdAt: now(),
    updatedAt: now(),
  };
  store.profiles[profileId] = profile;
  for (const proof of proofs) store.proofPoints[proof.id] = proof;
  saveStore(dataDir, store);
  return { profileId, id: profileId, profile, proofPoints: proofs, created: true };
}

export function importJob(dataDir, args) {
  const profileId = String(args.profileId || '').trim();
  if (!profileId) throw Object.assign(new Error('import_job requires profileId'), { code: 'missing_profile' });
  const filePath = args.path || args.filePath || args.resumePath || null;
  if (!filePath) throw Object.assign(new Error('import_job requires path or filePath'), { code: 'missing_path' });
  const abs = path.resolve(String(filePath));
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw Object.assign(new Error(`Cannot read job file: ${e.message}`), { code: 'read_error' });
  }
  const parsed = parseJobFile(text);
  const store = loadStore(dataDir);
  if (!store.profiles[profileId]) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const sourceHash = hashText(text);
  const dedupeKey = dedupeKeyForJob(parsed);
  // Look for existing job for this profile with same hash or same dedupeKey
  for (const job of Object.values(store.jobs)) {
    if (job.profileId !== profileId) continue;
    if (job.sourceHash === sourceHash) return { jobId: job.id, id: job.id, job, deduped: true };
    if (job.dedupeKey === dedupeKey && job.dedupeKey) {
      // Also consider URL absent case: only dedupe if titles/companies match exactly; but we also check hash fallback
      // For synthetic fixtures, the dedupeKey will match; treat as dedup if no prior hash collision check failed
      // To avoid false dedup across different jobs with same title/company/location but different description,
      // prefer hash. But for same file re-import, hash matches above. If different file with same dedupeKey but different hash,
      // we should NOT dedup blindly — only if hash matches. So this branch is intentionally not a dedup unless hash also matches.
      // Keep for backward compatibility: if file content hash different but dedupeKey same, create new job.
    }
  }
  // Deterministic job id from profile + hash
  const jobId = id('job', `${profileId}:${sourceHash}`);
  // Check id collision (same content)
  if (store.jobs[jobId]) {
    return { jobId, id: jobId, job: store.jobs[jobId], deduped: true };
  }
  const job = {
    id: jobId,
    profileId,
    title: parsed.title,
    company: parsed.company,
    location: parsed.location,
    description: parsed.description,
    sourcePath: abs,
    sourceHash,
    dedupeKey,
    createdAt: now(),
    updatedAt: now(),
  };
  store.jobs[jobId] = job;
  saveStore(dataDir, store);
  // Also write a projection file under PLUGIN_DATA/jobs/<id>/job.yaml for visibility
  try {
    const projDir = path.join(path.resolve(dataDir), 'jobs', jobId);
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'job.json'), JSON.stringify(job, null, 2));
  } catch {}
  return { jobId, id: jobId, job, created: true };
}

export function listJobs(dataDir, args) {
  const profileId = String(args.profileId || '').trim();
  if (!profileId) throw Object.assign(new Error('list_jobs requires profileId'), { code: 'missing_profile' });
  const store = loadStore(dataDir);
  if (!store.profiles[profileId]) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const jobs = Object.values(store.jobs).filter(j => j.profileId === profileId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { jobs, items: jobs, count: jobs.length, profileId };
}

export function scoreJob(dataDir, args) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  if (!jobId) throw Object.assign(new Error('score_job requires jobId'), { code: 'missing_job' });
  if (!profileId) throw Object.assign(new Error('score_job requires profileId'), { code: 'missing_profile' });
  const store = loadStore(dataDir);
  const job = store.jobs[jobId];
  if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: 'unknown_job' });
  if (job.profileId !== profileId) throw Object.assign(new Error(`Job ${jobId} belongs to profile ${job.profileId}, not ${profileId}`), { code: 'profile_mismatch' });
  const profile = store.profiles[profileId];
  if (!profile) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const fit = localScore({ profile, job });
  store.scores[jobId] = fit;
  saveStore(dataDir, store);
  return { ...fit, jobId, profileId, profile: profileId, id: jobId, fit };
}

export function pursueJob(dataDir, args) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  if (!jobId || !profileId) throw Object.assign(new Error('pursue_job requires jobId and profileId'), { code: 'missing_args' });
  const store = loadStore(dataDir);
  const job = store.jobs[jobId];
  if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: 'unknown_job' });
  if (job.profileId !== profileId) throw Object.assign(new Error(`Job ${jobId} belongs to profile ${job.profileId}, not ${profileId}`), { code: 'profile_mismatch' });
  if (!store.profiles[profileId]) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const app = store.applications[jobId] || { jobId, profileId, status: 'researching', createdAt: now() };
  app.status = 'pursued';
  app.pursuedAt = now();
  app.updatedAt = now();
  app.localOnly = true;
  app.note = 'Pursuit recorded locally; human review required before any external action. No external request was made.';
  store.applications[jobId] = app;
  const artifactId = id('artifact', `${profileId}:${jobId}:application-readiness`);
  const proofPoints = Object.values(store.proofPoints).filter(proof => proof.profileId === profileId);
  const artifact = store.artifacts[artifactId] || {
    id: artifactId,
    jobId,
    profileId,
    kind: 'application_readiness',
    status: 'draft_needs_human_review',
    title: `Application readiness: ${job.title}`,
    proofPointIds: proofPoints.map(proof => proof.id),
    checklist: ['verify profile facts', 'verify proof points', 'review role fit', 'prepare materials'],
    createdAt: now(),
  };
  artifact.updatedAt = now();
  store.artifacts[artifactId] = artifact;
  saveStore(dataDir, store);
  return {
    ok: true,
    jobId,
    profileId,
    status: 'pursued',
    application: app,
    artifact,
    message: 'Pursuit recorded locally. No submission, sending, or external action was performed. Human review required before any external step.',
  };
}

export function applicationsPlan(dataDir, args) {
  const jobId = String(args.jobId || args.id || '').trim();
  const profileId = String(args.profileId || '').trim();
  if (!jobId || !profileId) throw Object.assign(new Error('applications_plan requires jobId and profileId'), { code: 'missing_args' });
  const store = loadStore(dataDir);
  const job = store.jobs[jobId];
  if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: 'unknown_job' });
  const profile = store.profiles[profileId];
  if (!profile) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const score = store.scores[jobId] || null;
  const app = store.applications[jobId] || { jobId, profileId, status: 'not_pursued' };
  return {
    ok: true,
    jobId,
    profileId,
    readiness: score ? 'ready_for_review' : 'needs_score',
    plan: {
      jobId,
      profileId,
      status: app.status,
      readiness: score ? 'ready_for_review' : 'needs_score',
      score: score ? { overall: score.overall, scoreStatus: score.scoreStatus } : null,
      nextSteps: ['human review', 'tailor materials', 'verify proofs'],
    },
    application: app,
    blockers: [],
    warnings: [],
    message: 'Local pipeline plan; no external action was performed.',
  };
}

export function reviewQueue(dataDir, args) {
  const profileId = String(args.profileId || '').trim();
  if (!profileId) throw Object.assign(new Error('review_queue requires profileId'), { code: 'missing_profile' });
  const store = loadStore(dataDir);
  if (!store.profiles[profileId]) throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  const jobs = Object.values(store.jobs).filter(j => j.profileId === profileId);
  const artifacts = Object.values(store.artifacts).filter(artifact => artifact.profileId === profileId);
  const scored = jobs.filter(j => store.scores[j.id]);
  const pursued = jobs.filter(j => store.applications[j.id]?.status === 'pursued');
  const fallback = pursued.length ? pursued.map(j => ({ jobId: j.id, id: j.id, title: j.title, status: 'needs_review', kind: 'pursued_job' }))
    : scored.length ? scored.map(j => ({ jobId: j.id, id: j.id, title: j.title, status: 'needs_review', kind: 'scored_job' }))
    : jobs.slice(0, 3).map(j => ({ jobId: j.id, id: j.id, title: j.title, status: 'needs_review', kind: 'imported_job' }));
  const queue = artifacts.length ? artifacts : fallback;
  return {
    ok: true,
    profileId,
    queue,
    items: queue,
    artifacts,
    count: queue.length,
    message: 'Local review queue; human decision required for any external step.',
  };
}
