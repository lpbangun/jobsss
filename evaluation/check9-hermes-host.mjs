#!/usr/bin/env node
// Check #9 (MANDATORY) — Hermes-first host integration, boundary labelled.
// Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #9.
//
// The checker recomputes, it does not trust:
//   * every raw capture is re-hashed against its declared sha256;
//   * the plugin-tree hash and the skill digest are recomputed here (this file
//     is the reference implementation of both algorithms, so a recorder cannot
//     drift from the checker);
//   * the expected MCP tool set is derived by asking the plugin itself over the
//     documented JSON-RPC surface, never read from the bundle;
//   * the boundary claim must assert tool-only isolation and nothing more.
//
// Contract: evaluation/contracts/hermes-host-evidence.schema.json
//
// Usage:
//   node evaluation/check9-hermes-host.mjs --bundle evidence/hermes-host --json
//   node evaluation/check9-hermes-host.mjs --emit-plugin-tree-hash
//   node evaluation/check9-hermes-host.mjs --emit-skill-digest

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  expandDataArgs,
  initializeRequest,
  listToolsRequest,
  resolveStandaloneLauncher,
  runMcpRequests
} from '../tests/helpers/jobsss-live-mcp.mjs';

const EVALUATION_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(EVALUATION_DIR);

const TREE_EXCLUDED_DIRS = ['.git', 'node_modules', '.tmp', '.pi'];
const TREE_EXCLUDED_FILES = [];
const BOUNDARY_LABEL = 'source-skill+mcp-under-tool-only-isolation';
const FORBIDDEN_BOUNDARIES = ['native-plugin-loading', 'os-sandboxing'];
const REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const TOOL_TOKEN = /mcp_[a-z0-9]+_[a-z0-9_]+/g;
const SECRET_ASSIGNMENT = /(?:^|\n)\s*[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*\S+/;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function hashFile(abs) {
  return sha256(readFileSync(abs));
}

function walkFiles(root, rel = '') {
  const out = [];
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (TREE_EXCLUDED_DIRS.includes(entry.name)) continue;
      out.push(...walkFiles(root, next));
    } else if (entry.isFile()) {
      const base = path.basename(next);
      if (TREE_EXCLUDED_FILES.includes(base)) continue;
      out.push(next.split(path.sep).join('/'));
    }
  }
  return out;
}

function digestOfFiles(root, relativeFiles) {
  const lines = relativeFiles
    .slice()
    .sort()
    .map(rel => `${rel}\0${hashFile(path.join(root, rel))}\n`)
    .join('');
  return sha256(lines);
}

// Frozen algorithm (this file is the reference implementation).
export function pluginTreeHash(root = REPO_ROOT) {
  return digestOfFiles(root, walkFiles(root));
}

export function skillDigest(root = REPO_ROOT) {
  const skillsRoot = path.join(root, 'skills', 'jobsss');
  if (!existsSync(skillsRoot)) return '';
  const files = walkFiles(root).filter(rel => rel === 'skills/jobsss/SKILL.md' || rel.startsWith('skills/jobsss/'));
  return digestOfFiles(root, files);
}

function parseArgs(argv) {
  const args = { bundle: null, json: false, repoRoot: REPO_ROOT, hermesHomeRoot: process.env.HERMES_HOME || path.join(os.homedir(), '.hermes') };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--bundle') args.bundle = argv[index + 1];
    else if (value === '--repo-root') args.repoRoot = argv[index + 1];
    else if (value === '--hermes-home-root') args.hermesHomeRoot = argv[index + 1];
    else if (value === '--json') args.json = true;
    else if (value === '--emit-plugin-tree-hash') args.emit = 'tree';
    else if (value === '--emit-skill-digest') args.emit = 'skill';
  }
  return args;
}

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function deriveToolNames() {
  const { launcher, argsTemplate } = resolveStandaloneLauncher();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sourcing-check9-'));
  try {
    const session = await runMcpRequests(
      launcher,
      expandDataArgs(argsTemplate, dataDir),
      { ...process.env, PLUGIN_DATA: dataDir, PATH: process.env.PATH },
      [initializeRequest(1), listToolsRequest(2)],
      { timeoutMs: 60_000 }
    );
    const frame = session.frames.find(item => item.id === 2);
    const names = frame?.result?.tools?.map(tool => tool.name) || [];
    return { names, stderr: session.stderr };
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function collectToolTokens(text, server) {
  const tokens = String(text).match(TOOL_TOKEN) || [];
  const prefix = `mcp_${server}_`;
  return tokens.filter(token => token.startsWith(prefix));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.emit === 'tree') {
    process.stdout.write(`${pluginTreeHash(args.repoRoot)}\n`);
    return 0;
  }
  if (args.emit === 'skill') {
    process.stdout.write(`${skillDigest(args.repoRoot)}\n`);
    return 0;
  }

  const failures = [];
  const facts = {};
  const fail = (code, message) => failures.push({ code, message });
  const bundle = args.bundle ? path.resolve(args.bundle) : null;

  if (!bundle || !existsSync(bundle)) {
    fail('bundle_missing', `No recorded Hermes host bundle at ${bundle || '(no --bundle)'}. Run the L3 procedure and record it before this check can pass.`);
  } else {
    const runPath = path.join(bundle, 'run.json');
    if (!existsSync(runPath)) {
      fail('run_record_missing', `Missing ${runPath}; the bundle must carry a run.json per the contract.`);
    } else {
      let record = null;
      try {
        record = JSON.parse(readFileSync(runPath, 'utf8'));
      } catch (error) {
        fail('run_record_unparseable', `run.json is not valid JSON: ${error.message}`);
      }
      if (record) await inspect(record, bundle, args, fail, facts);
    }
  }

  const ok = failures.length === 0;
  const report = {
    check: 9,
    rubricVersion: 'sourcing-v1',
    ok,
    needsReview: facts.needsReview === true,
    boundaryClaimed: facts.boundaryClaimed || null,
    failures,
    facts
  };
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${ok ? 'PASS' : 'FAIL'} check #9 — ${failures.length} failure(s)\n${failures.map(item => `  - ${item.code}: ${item.message}`).join('\n')}\n`);
  return ok ? 0 : 1;
}

async function inspect(record, bundle, args, fail, facts) {
  const readRaw = rel => readFileSync(path.join(bundle, rel), 'utf8');
  const evidence = asArray(record.evidence);
  if (evidence.length === 0) fail('evidence_empty', 'run.json must list the raw captures it stands on (evidence[]).');

  for (const entry of evidence) {
    const rel = String(entry?.path || '');
    if (!rel) {
      fail('evidence_path_missing', `evidence entry without a path: ${JSON.stringify(entry).slice(0, 200)}`);
      continue;
    }
    const abs = path.join(bundle, rel);
    if (!existsSync(abs) || !lstatSync(abs).isFile()) {
      fail('evidence_file_missing', `evidence file missing: ${rel}`);
      continue;
    }
    const actual = hashFile(abs);
    if (String(entry.sha256 || '').toLowerCase() !== actual) {
      fail('evidence_hash_mismatch', `evidence file ${rel} hashes to ${actual}, declared ${entry.sha256}`);
    }
  }
  facts.evidenceFiles = evidence.length;

  // ---- Hermes version identity -------------------------------------------
  const hermes = record.hermes || {};
  if (!String(hermes.version || '').trim()) fail('hermes_version_missing', 'hermes.version must be recorded.');
  if (!/^[0-9a-f]{7,40}$/.test(String(hermes.installCommit || ''))) {
    fail('hermes_commit_invalid', `hermes.installCommit must be the installed hermes-agent commit: ${hermes.installCommit}`);
  }
  if (hermes.cleanInstall !== true) fail('clean_install_missing', 'a clean-install run against the recorded version must be recorded (hermes.cleanInstall === true).');
  for (const key of ['versionCapture', 'cleanInstallCapture']) {
    const rel = String(hermes[key] || '');
    if (!rel) fail('version_capture_missing', `hermes.${key} must name the raw capture it stands on.`);
    else if (existsSync(path.join(bundle, rel))) {
      const text = readRaw(rel);
      if (!String(text).includes(String(hermes.version))) {
        fail('version_capture_disagrees', `${rel} does not contain the recorded version ${hermes.version}`);
      }
    }
  }

  // ---- Isolation ----------------------------------------------------------
  const isolation = record.isolation || {};
  const hermesHome = String(isolation.hermesHome || '');
  const pluginData = String(isolation.pluginData || '');
  const pluginRoot = String(isolation.pluginRoot || args.repoRoot);
  if (!path.isAbsolute(hermesHome)) fail('hermes_home_not_absolute', `isolation.hermesHome must be absolute: ${hermesHome}`);
  else {
    const homeRoot = path.resolve(args.hermesHomeRoot);
    if (!isInside(hermesHome, homeRoot)) {
      fail('hermes_home_outside_tree', `the disposable HERMES_HOME must live beneath ${homeRoot} (an external /tmp home can become its own auth root): ${hermesHome}`);
    }
    if (path.resolve(hermesHome) === homeRoot) {
      fail('hermes_home_is_real_home', 'the run must use a disposable HERMES_HOME, not the real one');
    }
  }
  if (!path.isAbsolute(pluginData)) fail('plugin_data_not_absolute', `isolation.pluginData must be absolute: ${pluginData}`);
  else if (isInside(pluginData, pluginRoot)) {
    fail('plugin_data_inside_plugin', `PLUGIN_DATA must be outside the plugin tree: ${pluginData} vs ${pluginRoot}`);
  }

  const envRel = String(isolation.envCapture || '');
  if (!envRel || !existsSync(path.join(bundle, envRel))) {
    fail('env_capture_missing', 'isolation.envCapture must record the MCP subprocess environment.');
  } else {
    const envText = readRaw(envRel);
    if (!new RegExp(`PLUGIN_DATA\\s*=\\s*${pluginData.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(envText)) {
      fail('plugin_data_not_attested', `${envRel} must show PLUGIN_DATA pointed at the isolated dir ${pluginData}`);
    }
    if (SECRET_ASSIGNMENT.test(envText)) {
      fail('env_not_filtered', `${envRel} contains an API-key/token/secret assignment: the host env must be filtered.`);
    }
  }

  const expectedTree = pluginTreeHash(args.repoRoot);
  const tree = isolation.pluginTree || {};
  facts.pluginTreeHash = expectedTree;
  if (String(tree.beforeSha256 || '') !== String(tree.afterSha256 || '')) {
    fail('plugin_tree_written', 'the plugin tree changed during the run (before != after): the plugin directory must stay unwritten.');
  }
  if (String(tree.afterSha256 || '') !== expectedTree) {
    fail('plugin_tree_stale', `the recorded plugin tree hash ${tree.afterSha256} does not match this tree ${expectedTree}; the tree changed since the run, so re-run L3 and re-record.`);
  }

  // ---- Skill preload -----------------------------------------------------
  const skills = record.skills || {};
  const preloaded = asArray(skills.preloaded).map(String);
  if (!preloaded.includes('jobsss')) fail('skill_not_preloaded', `skills.preloaded must include the canonical jobsss skill: ${JSON.stringify(preloaded)}`);
  const expectedDigest = skillDigest(args.repoRoot);
  facts.skillDigest = expectedDigest;
  if (!expectedDigest) fail('skill_missing', 'the canonical skill corpus (skills/jobsss/**) is missing from the tree.');
  if (String(skills.digest || '') !== expectedDigest) {
    fail('skill_digest_mismatch', `the staged skill digest ${skills.digest} does not match the canonical corpus ${expectedDigest}; byte-exact consumption must be proven.`);
  }
  const commands = asArray(record.commands);
  const preloadCommand = commands.find(entry => asArray(entry?.argv).some((value, index, argv) => (String(value) === '-s' || String(value) === '--skills') && String(argv[index + 1] || '').includes('jobsss')));
  if (!preloadCommand) fail('preload_command_missing', 'no recorded command preloads the skill via the supported -s/--skills flag.');
  const mcpTestCommand = commands.find(entry => {
    const argv = asArray(entry?.argv).map(String);
    return argv.includes('hermes') && argv.includes('mcp') && argv.includes('test');
  });
  if (!mcpTestCommand) fail('mcp_test_command_missing', 'no recorded `hermes mcp test <server>` command.');
  else if (String(mcpTestCommand.exitCode ?? '') !== '0') {
    fail('mcp_test_failed', `hermes mcp test exited ${mcpTestCommand.exitCode}`);
  }

  // ---- MCP tool surface --------------------------------------------------
  const server = String(record.mcp?.server || 'jobsss');
  const captures = asArray(record.evidence).map(entry => String(entry?.path || ''));
  let observedTokens = [];
  let rawTexts = [];
  for (const rel of captures) {
    const abs = path.join(bundle, rel);
    if (!existsSync(abs) || !lstatSync(abs).isFile()) continue;
    const text = readFileSync(abs, 'utf8');
    rawTexts.push(text);
    observedTokens.push(...collectToolTokens(text, server));
  }

  const model = record.model || {};
  const transcript = String(model.transcript || '');
  let transcriptText = '';
  if (!transcript) fail('transcript_missing', 'model.transcript must name the Hermes-owned transcript that proves the real invocation.');
  else if (!existsSync(transcript)) fail('transcript_absent', `the recorded transcript does not exist: ${transcript}`);
  else {
    if (!path.isAbsolute(transcript) || !isInside(transcript, hermesHome)) {
      fail('transcript_outside_home', `the transcript must be a Hermes-owned artifact inside the disposable HERMES_HOME: ${transcript}`);
    }
    if (!path.basename(transcript).includes(String(record.session?.id || ''))) {
      fail('transcript_session_mismatch', `the transcript file name must carry the recorded session id ${record.session?.id}`);
    }
    transcriptText = readFileSync(transcript, 'utf8');
    observedTokens.push(...collectToolTokens(transcriptText, server));
  }

  facts.observedToolCount = new Set(observedTokens).size;
  let derived;
  try {
    derived = await deriveToolNames();
  } catch (error) {
    fail('plugin_probe_failed', `could not derive the expected tool set from ./bin/jobsss mcp: ${error.message}`);
    derived = { names: [] };
  }
  const expected = new Set(derived.names.map(name => `mcp_${server}_${String(name).replace(/[-.]/g, '_')}`));
  facts.expectedToolCount = expected.size;
  const observed = new Set(observedTokens);
  for (const name of expected) {
    if (!observed.has(name)) fail('tool_not_observed', `${name} is registered by the plugin but never appears in the recorded captures/transcript.`);
  }
  for (const name of observed) {
    if (!expected.has(name)) fail('tool_not_registered', `${name} appears in the evidence but is not registered by the plugin (stale or invented tool name).`);
  }
  const declared = asArray(record.mcp?.observedTools).map(String);
  facts.declaredToolCount = declared.length;
  for (const name of declared) {
    if (!observedTokens.includes(name)) fail('declared_tool_unbacked', `${name} is declared in mcp.observedTools but does not appear in any raw capture.`);
  }

  // ---- Real model events -------------------------------------------------
  const events = asArray(model.events);
  const assistantEvents = events.filter(event => String(event?.type) === 'assistant');
  const toolCalls = events.filter(event => String(event?.type) === 'tool_call');
  const toolResults = events.filter(event => String(event?.type) === 'tool_result');
  if (assistantEvents.length === 0) fail('model_events_missing', 'the record must carry at least one assistant event from a real provider response.');
  if (toolCalls.length === 0 || toolResults.length === 0) {
    fail('tool_pair_missing', 'at least one paired tool_call/tool_result event is required (exit 0 alone conceals an expired OAuth or an unsupported model).');
  }
  for (const call of toolCalls) {
    const paired = toolResults.find(result => String(result?.callId || '') === String(call?.callId || ''));
    if (!paired) fail('tool_pair_unmatched', `tool_call ${call?.callId} has no matching tool_result`);
    if (!String(call?.tool || '').startsWith(`mcp_${server}_`)) {
      fail('tool_call_not_mcp', `tool_call ${call?.tool} is not an mcp_${server}_* tool`);
    }
    if (transcriptText && !transcriptText.includes(String(call?.tool || ''))) {
      fail('tool_call_not_in_transcript', `tool name ${call?.tool} does not appear in the recorded transcript bytes`);
    }
  }
  for (const event of assistantEvents) {
    if (!String(event?.text || '').trim()) fail('assistant_text_empty', 'an assistant event with no response text proves nothing about a live provider.');
  }

  const route = model.route || {};
  const expectedRoute = route.expected || {};
  const resolvedRoute = route.resolved || {};
  facts.routeExpected = expectedRoute;
  facts.routeResolved = resolvedRoute;
  for (const key of ['provider', 'model']) {
    if (!String(resolvedRoute[key] || '').trim()) fail('route_unresolved', `model.route.resolved.${key} must record the provider/model actually used.`);
    if (String(resolvedRoute[key] || '') !== String(expectedRoute[key] || '')) facts.needsReview = true;
  }
  if (!REASONING_LEVELS.includes(String(resolvedRoute.reasoning || ''))) {
    fail('route_reasoning_invalid', `resolved reasoning level ${resolvedRoute.reasoning} is not one of ${REASONING_LEVELS.join('|')}`);
  }
  if (facts.needsReview) {
    fail('route_needs_review', `the resolved route ${JSON.stringify(resolvedRoute)} does not match the declared route ${JSON.stringify(expectedRoute)}; a mismatch is needs_review, never a silent pass.`);
  }
  for (const value of [resolvedRoute.provider, resolvedRoute.model]) {
    if (value && transcriptText && !transcriptText.includes(String(value))) {
      fail('route_not_in_transcript', `the resolved ${value} does not appear in the recorded transcript bytes`);
    }
  }
  const startedAt = Date.parse(String(record.startedAt || ''));
  const finishedAt = Date.parse(String(record.finishedAt || ''));
  facts.transcriptJsonl = false;
  if (transcriptText) {
    const lines = transcriptText.split('\n').map(line => line.trim()).filter(Boolean);
    facts.transcriptJsonl = lines.every(line => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });
    if (!String(record.session?.id || '') || !transcriptText.includes(String(record.session.id))) {
      fail('session_not_in_transcript', 'the recorded session id must appear in the transcript bytes');
    }
    if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
      const mtime = lstatSync(transcript).mtimeMs;
      if (mtime < startedAt - 1000 || mtime > finishedAt + 1000) {
        fail('transcript_not_current', 'the transcript mtime must fall inside the recorded run window (currency, not authenticity).');
      }
    } else {
      fail('run_window_missing', 'startedAt/finishedAt must be recorded so the transcript can be shown to belong to this run.');
    }
  }

  // ---- Boundary honesty --------------------------------------------------
  const claims = asArray(record.claims);
  const asserted = claims.filter(claim => claim?.asserted === true).map(claim => String(claim?.boundary || ''));
  facts.assertedBoundaries = asserted;
  facts.boundaryClaimed = asserted[0] || null;
  if (asserted.length !== 1) fail('boundary_claim_ambiguous', `exactly one asserted boundary label is required, got ${JSON.stringify(asserted)}`);
  if (!asserted.includes(BOUNDARY_LABEL)) {
    fail('boundary_label_wrong', `the sourcing claim must be labelled ${BOUNDARY_LABEL}, got ${JSON.stringify(asserted)}`);
  }
  for (const boundary of FORBIDDEN_BOUNDARIES) {
    if (asserted.includes(boundary)) {
      fail('boundary_overclaim', `${boundary} is asserted inside the sourcing claim; the documented procedure certifies tool-only isolation and nothing more.`);
    }
  }
  if (!String(record.summary || '').includes(BOUNDARY_LABEL)) {
    fail('summary_unlabelled', `the recorded summary must carry the boundary label ${BOUNDARY_LABEL} where a reader sees it.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run().then(code => { process.exitCode = code; }).catch(error => {
    process.stdout.write(`${JSON.stringify({ check: 9, rubricVersion: 'sourcing-v1', ok: false, failures: [{ code: 'checker_error', message: String(error?.stack || error) }] }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
