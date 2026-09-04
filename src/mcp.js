// Bundled JobSSS MCP server — stdio JSON-RPC.
// Framing/lifecycle concepts are attributed to JobOS src/mcp.js and are
// reimplemented here for the standalone PLUGIN_DATA runtime.
import * as domain from './domain.js';
import { ensureDataDir, redactSecrets } from './store.js';
import { listDecisionHandoffs, createDecisionHandoff } from './authority.js';
import { PRODUCT_VERSION } from './version.js';

const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
const string = { type: 'string' };
const profile = { profileId: string };
const jobProfile = { jobId: string, profileId: string, expectedRevision: { type: 'integer' } };
const tool = (name, description, inputSchema = schema()) => ({ name, description, inputSchema });

const TOOLS = [
  tool('doctor', 'Diagnose the bundled runtime and isolated PLUGIN_DATA; JobOS is not required.'),
  tool('start', 'Initialize or migrate versioned durable state under PLUGIN_DATA.', schema({ expectedRevision: { type: 'integer' } })),
  tool('create_profile', 'Create a profile from inline or safely staged resume content and extract proof candidates.', schema({ name: string, resumeText: string, text: string, content: string, resumePath: string, path: string, filePath: string, preferences: { type: 'object' }, expectedRevision: { type: 'integer' } }, ['name'])),
  tool('list_profiles', 'Read one profile-owned profile without raw resume text.', schema(profile, ['profileId'])),
  tool('list_resumes', 'List structured resume revisions and verification state for a profile.', schema(profile, ['profileId'])),
  tool('update_profile', 'Update local profile preferences.', schema({ ...profile, preferences: { type: 'object' }, name: string, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('add_proof_point', 'Add a structured proof candidate requiring human verification.', schema({ ...profile, summary: string, skills: { type: 'array' }, metrics: { type: 'array' }, expectedRevision: { type: 'integer' } }, ['profileId', 'summary'])),
  tool('import_job', 'Import job text inline or from an allowed staged file; deduplicates content.', schema({ ...profile, text: string, content: string, path: string, filePath: string, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('import_job_url', 'Fetch and parse a public http/https job URL for local review; rejects file and private URLs.', schema({ ...profile, url: string, expectedRevision: { type: 'integer' } }, ['profileId', 'url'])),
  tool('list_jobs', 'List profile-owned imported and discovered jobs.', schema(profile, ['profileId'])),
  tool('create_saved_search', 'Create a profile-owned public-ATS saved search using a board token or staged offline fixture.', schema({ ...profile, name: string, adapter: string, config: { type: 'object' }, minFit: { type: 'number' }, expectedRevision: { type: 'integer' } }, ['profileId', 'name', 'adapter'])),
  tool('list_saved_searches', 'List profile-owned saved searches.', schema(profile, ['profileId'])),
  tool('search_jobs', 'Run one saved search and retain discoveries database-only.', schema({ ...profile, search: string, searchId: string, name: string, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('daily_discovery', 'Run all profile public-ATS or staged searches; discoveries remain database-only until saved or pursued.', schema({ ...profile, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('score_job', 'Compute JobOS-compatible seven-dimension deterministic offline fit.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('save_job', 'Save a job locally and create next-action state; performs no external action.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('skip_job', 'Skip a job locally.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('archive_job', 'Archive a job locally.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('pursue_job', 'Record local pursuit and readiness tasks; never performs an external action.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('applications_plan', 'Read local pipeline readiness and next actions.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('update_application_status', 'Update local-only lifecycle state; authoritative external states are blocked.', schema({ ...jobProfile, applicationId: string, status: string }, ['jobId', 'profileId', 'status'])),
  tool('list_tasks', 'List persistent profile-owned tasks and next actions.', schema(profile, ['profileId'])),
  tool('update_task', 'Update a local task as open or completed.', schema({ ...profile, taskId: string, status: string, expectedRevision: { type: 'integer' } }, ['profileId', 'taskId', 'status'])),
  tool('tailor_resume', 'Create a proof-grounded resume draft for human review.', schema({ ...jobProfile, format: string }, ['jobId', 'profileId'])),
  tool('draft_cover_letter', 'Create a proof-grounded cover-letter draft for human review.', schema({ ...jobProfile, format: string }, ['jobId', 'profileId'])),
  tool('save_answer', 'Generate or store a reusable answer from exact selected proof summaries; never auto-fills or sends.', schema({ ...profile, question: string, answer: string, category: string, sensitivity: string, reuseScope: string, proofPointIds: { type: 'array' }, expectedRevision: { type: 'integer' } }, ['profileId', 'question', 'proofPointIds'])),
  tool('list_answers', 'List profile-owned reusable answer drafts.', schema(profile, ['profileId'])),
  tool('match_answers', 'Match stored answer drafts to questions for human review.', schema({ ...profile, questions: { type: 'array' }, employer: string }, ['profileId'])),
  tool('review_queue', 'List profile-owned draft artifacts and review items.', schema(profile, ['profileId'])),
  tool('import_contact', 'Import an inline or PLUGIN_DATA-staged profile-owned contact record; arbitrary paths are rejected.', schema({ ...profile, name: string, email: string, company: string, role: string, text: string, content: string, path: string, filePath: string, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('list_contacts', 'List profile-owned contacts.', schema(profile, ['profileId'])),
  tool('record_research', 'Record local people or company research notes.', schema({ ...jobProfile, subjectName: string, subjectCompany: string, company: string, notes: string, findings: { type: 'array' }, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('list_research', 'List profile-owned people/company research notes.', schema(profile, ['profileId'])),
  tool('map_reachable_network', 'Map local profile-owned contact paths to a job; never contacts anyone.', schema(jobProfile, ['jobId', 'profileId'])),
  tool('plan_outreach', 'Persist a local outreach plan; never transmits.', schema({ ...jobProfile, contactId: string, goal: string, expectedRevision: { type: 'integer' } }, ['jobId', 'profileId'])),
  tool('draft_outreach', 'Persist a local initial or follow-up outreach draft; never transmits.', schema({ ...jobProfile, contactId: string, goal: string, kind: string, followUp: { type: 'boolean' }, subject: string, body: string, expectedRevision: { type: 'integer' } }, ['jobId', 'profileId'])),
  tool('list_outreach', 'List local outreach plans and drafts.', schema(profile, ['profileId'])),
  tool('draft_interview_story', 'Persist a STAR story draft needing human verification.', schema({ ...profile, title: string, situation: string, task: string, action: string, result: string, reflection: string, proofPointIds: { type: 'array' }, expectedRevision: { type: 'integer' } }, ['profileId', 'situation', 'task', 'action', 'result'])),
  tool('list_interview_stories', 'List profile-owned interview story drafts.', schema(profile, ['profileId'])),
  tool('interview_prep', 'Persist interview questions, story coverage, gaps, and a human debrief handoff.', schema({ ...jobProfile, applicationId: string, expectedRevision: { type: 'integer' } }, ['profileId'])),
  tool('get_interview_prep', 'Read persisted interview preparation.', schema({ ...profile, jobId: string }, ['profileId'])),
  tool('interview_debrief_handoff', 'Return the trusted human-only debrief handoff without attesting an outcome.', schema(profile, ['profileId'])),
  tool('preview_sync', 'Return a secret-safe local sync/export preview; transmits nothing.', schema(profile, ['profileId'])),
  tool('list_decision_handoffs', 'List pending non-authoritative decision handoffs for a profile. Completion requires the trusted local CLI ./bin/jobsss decide; MCP never completes or forges human decisions.', schema(profile, ['profileId'])),
  tool('create_decision_handoff', 'Create a non-authoritative local handoff marker for human review. Grants no authority, performs no action, and never completes a human decision.', schema({ ...profile, kind: string, note: string }, ['profileId'])),
];

const HANDLERS = Object.freeze({
  doctor: domain.doctor, start: domain.start, create_profile: domain.createProfile,
  list_profiles: domain.listProfiles, list_resumes: domain.listResumes,
  update_profile: domain.updateProfile, add_proof_point: domain.addProofPoint,
  import_job: domain.importJob, import_job_url: domain.importJobUrl, list_jobs: domain.listJobs,
  create_saved_search: domain.createSavedSearch, list_saved_searches: domain.listSavedSearches,
  search_jobs: domain.searchJobs, daily_discovery: domain.dailyDiscovery, score_job: domain.scoreJob,
  save_job: domain.saveJob, skip_job: domain.skipJob, archive_job: domain.archiveJob,
  pursue_job: domain.pursueJob, applications_plan: domain.applicationsPlan,
  update_application_status: domain.updateApplicationStatus, list_tasks: domain.listTasks,
  update_task: domain.updateTask, tailor_resume: domain.tailorResume, draft_cover_letter: domain.draftCoverLetter,
  save_answer: domain.saveAnswer, list_answers: domain.answersList, match_answers: domain.answersMatch,
  review_queue: domain.reviewQueue, import_contact: domain.importContact, list_contacts: domain.listContacts,
  record_research: domain.recordResearch, list_research: domain.listResearch,
  map_reachable_network: domain.mapReachableNetwork, plan_outreach: domain.planOutreach,
  draft_outreach: domain.draftOutreach, list_outreach: domain.listOutreach,
  draft_interview_story: domain.draftInterviewStory, list_interview_stories: domain.listInterviewStories,
  interview_prep: domain.interviewPrep, get_interview_prep: domain.getInterviewPrep,
  interview_debrief_handoff: domain.interviewDebriefHandoff, preview_sync: domain.previewSync,
  list_decision_handoffs: listDecisionHandoffs,
  create_decision_handoff: createDecisionHandoff,
});

function result(value) { return { content: [{ type: 'text', text: redactSecrets(JSON.stringify(value, null, 2)) }] }; }
function parseDataDir(argv) {
  const idx = argv.indexOf('--data');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find(arg => arg.startsWith('--data='));
  return eq ? eq.slice('--data='.length) : process.env.PLUGIN_DATA || null;
}
async function callTool(dataDir, name, args = {}) {
  const handler = HANDLERS[name];
  if (!handler) throw Object.assign(new Error('Requested tool is blocked or not available to MCP.'), { code: 'mcp_tool_not_available' });
  return result(await handler(dataDir, args));
}
function send(message, framing = 'header') {
  const json = JSON.stringify(message);
  process.stdout.write(framing === 'jsonl' ? `${json}\n` : `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

export function startMcp({ dataDir, input = process.stdin, sendResponse = send, handleRequest = null, maxRequestBytes = 1024 * 1024, maxHeaderBytes = 8 * 1024 } = {}) {
  if (!dataDir) throw new Error('Missing --data <dir> and PLUGIN_DATA');
  dataDir = ensureDataDir(dataDir);
  let buffer = Buffer.alloc(0), active = null, ended = false, closing = false, settled = false, resolveCompleted;
  const completed = new Promise(resolve => { resolveCompleted = resolve; });
  const detach = () => { input.off('data', onData); input.off('end', onEnd); input.off('error', onError); };
  const finish = () => { if (settled || active) return; settled = true; detach(); resolveCompleted(); };
  const beginClose = ({ destroy = true } = {}) => { if (!closing) { closing = true; buffer = Buffer.alloc(0); detach(); input.pause?.(); if (destroy && input !== process.stdin && typeof input.destroy === 'function') input.destroy(); } finish(); };
  const parseError = (message, framing = 'header') => { sendResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message } }, framing); beginClose(); };
  const nextFrame = () => {
    if (!buffer.length) return null;
    const prefix = buffer.toString('utf8', 0, Math.min(buffer.length, 15));
    if ('Content-Length:'.startsWith(prefix) || prefix.startsWith('Content-Length:')) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) { if (buffer.length > maxHeaderBytes) throw Object.assign(new Error('MCP header exceeds limit'), { framing: 'header' }); return null; }
      if (headerEnd > maxHeaderBytes) throw Object.assign(new Error('MCP header exceeds limit'), { framing: 'header' });
      const match = buffer.toString('utf8', 0, headerEnd).match(/^Content-Length:\s*(\d+)\s*$/im);
      const length = Number(match?.[1]);
      if (!Number.isSafeInteger(length)) throw Object.assign(new Error('Missing Content-Length'), { framing: 'header' });
      if (length > maxRequestBytes) throw Object.assign(new Error('MCP request exceeds limit'), { framing: 'header' });
      const bodyStart = headerEnd + 4;
      if (buffer.length - bodyStart < length) return null;
      return { line: buffer.toString('utf8', bodyStart, bodyStart + length), framing: 'header', consumed: bodyStart + length };
    }
    const newline = buffer.indexOf('\n');
    if (newline < 0) { if (buffer.length > maxRequestBytes) throw Object.assign(new Error('MCP request exceeds limit'), { framing: 'jsonl' }); return null; }
    if (newline > maxRequestBytes) throw Object.assign(new Error('MCP request exceeds limit'), { framing: 'jsonl' });
    return { line: buffer.toString('utf8', 0, newline).trim(), framing: 'jsonl', consumed: newline + 1 };
  };
  const pump = () => {
    if (active || closing) return;
    let frame;
    try { frame = nextFrame(); } catch (cause) { parseError(cause.message, cause.framing); return; }
    if (!frame) { if (ended) { if (buffer.length) parseError('Incomplete MCP request'); else finish(); } else input.resume?.(); return; }
    buffer = buffer.subarray(frame.consumed);
    if (!frame.line) { pump(); return; }
    input.pause?.();
    active = Promise.resolve((handleRequest || handleLine)(dataDir, frame.line, msg => sendResponse(msg, frame.framing)))
      .catch(() => {}).finally(() => { active = null; if (closing) finish(); else pump(); });
  };
  const onData = chunk => { if (closing) return; const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); if (buffer.length + bytes.length > maxRequestBytes + maxHeaderBytes) { parseError('MCP input buffer exceeds limit'); return; } buffer = buffer.length ? Buffer.concat([buffer, bytes]) : Buffer.from(bytes); pump(); };
  const onEnd = () => { ended = true; pump(); };
  const onError = () => beginClose({ destroy: false });
  input.on('data', onData); input.once('end', onEnd); input.once('error', onError);
  return { completed, close() { beginClose(); } };
}

async function handleLine(dataDir, line, respond) {
  let msg;
  try { msg = JSON.parse(line); } catch (cause) { respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: cause.message } }); return; }
  try {
    if (msg.method === 'initialize') { respond({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'jobsss-bundled', version: PRODUCT_VERSION }, capabilities: { tools: {} } } }); return; }
    if (msg.method === 'notifications/initialized') return;
    if (msg.method === 'tools/list') { respond({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }); return; }
    if (msg.method === 'tools/call') { const { name, arguments: args } = msg.params || {}; respond({ jsonrpc: '2.0', id: msg.id, result: await callTool(dataDir, name, args || {}) }); return; }
    respond({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32601, message: 'Method not found' } });
  } catch (cause) {
    let message = cause?.code ? `${cause.code}: ${cause.message}` : cause.message;
    if (cause?.code === 'external_status_forbidden') message = 'external_status_forbidden: blocked human-only status is not available to MCP';
    respond({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message } });
  }
}

export function runFromArgv(argv = process.argv.slice(2)) {
  const dataDir = parseDataDir(argv);
  if (!dataDir) { console.error('jobsss mcp requires --data <dir> (or PLUGIN_DATA)'); process.exit(2); }
  startMcp({ dataDir });
}
if (import.meta.url === `file://${process.argv[1]}`) runFromArgv();
