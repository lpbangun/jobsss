#!/usr/bin/env node
// Check #10 — the eval-lane evidence bundle, checked by an independent
// recomputation. Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #10.
//
// Rules this checker obeys:
//   * no live-count literals: every expectation is derived at check time from
//     the bundle, the repo's own mcp.json, and the frozen manifest;
//   * declared counts and hashes are never trusted — bytes at the returned path
//     are hashed here and compared against both the call record and the
//     artifact table;
//   * the runner (`checks.py`) must agree with the frozen manifest, so a lane
//     cannot quietly check itself against a different bar.
//
// Contract: evaluation/contracts/eval-lane-evidence.schema.json
//
// Usage: node evaluation/check10-evidence.mjs --bundle evidence/eval-lane --json

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EVALUATION_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(EVALUATION_DIR);
const HEX64 = /^[0-9a-f]{64}$/;

function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function parseArgs(argv) {
  const args = { bundle: null, json: false, manifest: path.join(EVALUATION_DIR, 'MANIFEST-sourcing-v1.json') };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--bundle') args.bundle = argv[index + 1];
    else if (argv[index] === '--manifest') args.manifest = argv[index + 1];
    else if (argv[index] === '--json') args.json = true;
  }
  return args;
}

function declaredCounts(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) declaredCounts(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'number' && /count|total|artifacts|entries|calls/i.test(key)) out.push({ key, value: item });
      else declaredCounts(item, out);
    }
  }
  return out;
}

function normalizeArtifacts(doc) {
  if (Array.isArray(doc?.artifacts)) {
    return doc.artifacts.map(entry => ({ path: String(entry?.path || ''), sha256: String(entry?.sha256 || '').toLowerCase() }));
  }
  if (doc?.artifacts && typeof doc.artifacts === 'object') {
    return Object.entries(doc.artifacts).map(([key, value]) => ({ path: key, sha256: String(value || '').toLowerCase() }));
  }
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const entries = Object.entries(doc).filter(([, value]) => typeof value === 'string' && HEX64.test(String(value).toLowerCase()));
    if (entries.length) return entries.map(([key, value]) => ({ path: key, sha256: String(value).toLowerCase() }));
  }
  return null;
}

function expectedToolPrefix() {
  const doc = JSON.parse(readFileSync(path.join(REPO_ROOT, 'mcp.json'), 'utf8'));
  const server = Object.keys(doc?.mcpServers || {})[0];
  if (!server) throw new Error('mcp.json declares no MCP server');
  return { server, prefix: `mcp_${server}_` };
}

function manifestChecks(manifestPath) {
  const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const checks = Array.isArray(doc?.checks) ? doc.checks : [];
  return checks.map(entry => ({ id: String(entry.id), command: String(entry.command) }));
}

function checkRunner(bundle) {
  const script = path.join(bundle, 'checks.py');
  const raw = execFileSync('python3', [script, '--list-checks', '--json'], {
    cwd: path.dirname(script),
    encoding: 'utf8',
    timeout: 120_000
  });
  const parsed = JSON.parse(raw);
  const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
  return checks.map(entry => ({ id: String(entry.id), command: String(entry.command ?? entry.commandLine ?? '') }));
}

function evaluate(args) {
  const failures = [];
  const facts = {};
  const fail = (code, message) => failures.push({ code, message });
  const bundle = args.bundle ? path.resolve(args.bundle) : null;

  if (!bundle || !existsSync(bundle) || !lstatSync(bundle).isDirectory()) {
    fail('bundle_missing', `No eval-lane evidence bundle at ${bundle || '(no --bundle)'}. Record mcp-calls.jsonl, artifact-hashes.json and checks.py before this check can pass.`);
    return { check: 10, ok: false, failures, facts };
  }

  const required = ['mcp-calls.jsonl', 'artifact-hashes.json', 'checks.py'];
  for (const name of required) {
    const abs = path.join(bundle, name);
    if (!existsSync(abs) || !lstatSync(abs).isFile()) fail('missing_required_artifact', `the bundle must contain ${name}`);
  }
  if (failures.length) return { check: 10, ok: false, failures, facts };

  const { server, prefix } = expectedToolPrefix();
  facts.server = server;

  // ---- calls -------------------------------------------------------------
  const callsText = readFileSync(path.join(bundle, 'mcp-calls.jsonl'), 'utf8');
  const lines = callsText.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) fail('calls_empty', 'mcp-calls.jsonl carries no tool calls');
  const calls = [];
  lines.forEach((line, index) => {
    try {
      const record = JSON.parse(line);
      calls.push({ ...record, lineNumber: index + 1 });
    } catch (error) {
      fail('call_unparseable', `mcp-calls.jsonl line ${index + 1} is not JSON: ${error.message}`);
    }
  });
  facts.callCount = calls.length;

  const seqs = calls.map(call => Number(call.seq));
  const sortedSeqs = [...seqs].sort((a, b) => a - b);
  if (seqs.some(value => !Number.isFinite(value)) || sortedSeqs.some((value, index) => value !== index + 1)) {
    fail('call_sequence_broken', `call seq must be a dense increasing sequence from 1: ${JSON.stringify(seqs)}`);
  }

  for (const call of calls) {
    const label = `call seq ${call.seq ?? call.lineNumber}`;
    const tool = String(call.tool || '');
    if (!tool) fail('call_tool_missing', `${label} carries no tool name`);
    else if (!tool.startsWith(prefix)) fail('call_tool_unexpected', `${label} calls ${tool}, which is not an ${prefix}* tool`);
    if (!String(call.callId || '')) fail('call_id_missing', `${label} carries no callId`);
    if (!String(call.resultPath || '').trim()) fail('call_result_path_missing', `${label} does not name the artifact path it returned`);
  }

  // ---- bytes at the returned paths, recomputed --------------------------
  const declaredCalls = new Map();
  for (const call of calls) {
    const resultPath = String(call.resultPath || '');
    if (!resultPath) continue;
    const abs = path.isAbsolute(resultPath) ? resultPath : path.join(bundle, resultPath);
    if (!existsSync(abs) || !lstatSync(abs).isFile()) {
      fail('artifact_missing', `call seq ${call.seq ?? call.lineNumber}: no artifact at the returned path ${resultPath}`);
      continue;
    }
    const actual = sha256File(abs);
    const declared = String(call.resultSha256 || '').toLowerCase();
    if (!HEX64.test(declared)) fail('artifact_hash_malformed', `call seq ${call.seq ?? call.lineNumber}: declared hash ${call.resultSha256} is not a sha256`);
    else if (declared !== actual) fail('artifact_hash_mismatch', `call seq ${call.seq ?? call.lineNumber}: ${resultPath} hashes to ${actual}, declared ${declared}`);
    declaredCalls.set(path.resolve(abs), { declared, actual });
  }
  facts.artifactCount = declaredCalls.size;
  if (declaredCalls.size !== calls.filter(call => String(call.resultPath || '').trim()).length) {
    fail('artifact_ambiguous_paths', 'two or more calls returned the same path: the artifact table cannot be attributed');
  }

  // ---- artifact table ----------------------------------------------------
  const hashesDoc = JSON.parse(readFileSync(path.join(bundle, 'artifact-hashes.json'), 'utf8'));
  const artifacts = normalizeArtifacts(hashesDoc);
  if (!artifacts) {
    fail('artifact_table_unreadable', 'artifact-hashes.json must map artifact paths to sha256 values');
    return { check: 10, ok: false, failures, facts };
  }
  facts.declaredArtifactCount = artifacts.length;

  const table = new Map();
  for (const entry of artifacts) {
    if (!entry.path) fail('artifact_path_missing', `an artifact-hashes entry has no path: ${JSON.stringify(entry)}`);
    const abs = path.isAbsolute(entry.path) ? entry.path : path.join(bundle, entry.path);
    if (!HEX64.test(entry.sha256)) fail('artifact_hash_malformed', `artifact-hashes entry ${entry.path} carries a non-sha256 value ${entry.sha256}`);
    if (table.has(abs)) fail('artifact_duplicate_entry', `artifact-hashes declares ${entry.path} more than once`);
    table.set(abs, entry.sha256);
  }

  for (const [abs, declared] of table) {
    if (!declaredCalls.has(abs)) fail('artifact_undeclared_call', `artifact-hashes declares ${abs} but no call returned it`);
    else if (declaredCalls.get(abs).actual !== declared) {
      fail('artifact_table_mismatch', `${abs} hashes to ${declaredCalls.get(abs).actual}, artifact-hashes says ${declared}`);
    }
  }
  for (const [abs, value] of declaredCalls) {
    if (!table.has(abs)) fail('artifact_missing_from_table', `${abs} was returned by a call but is absent from artifact-hashes.json`);
    else if (value.declared !== table.get(abs)) {
      fail('artifact_table_disagrees', `${abs}: call declares ${value.declared}, artifact-hashes says ${table.get(abs)}`);
    }
  }

  // ---- declared counts must match the recomputation ----------------------
  const declaredCounters = declaredCounts(hashesDoc);
  for (const counter of declaredCounters) {
    if (counter.value !== facts.artifactCount && counter.value !== facts.callCount) {
      fail('declared_count_wrong', `artifact-hashes.json declares ${counter.key}=${counter.value}, recomputed artifacts=${facts.artifactCount} calls=${facts.callCount}`);
    }
  }
  const runRecord = path.join(bundle, 'run.json');
  if (existsSync(runRecord)) {
    const doc = JSON.parse(readFileSync(runRecord, 'utf8'));
    for (const counter of declaredCounts({ ...doc, toolCalls: doc.toolCalls, counts: doc.counts })) {
      if (counter.value !== facts.callCount && counter.value !== facts.artifactCount) {
        fail('declared_count_wrong', `run.json declares ${counter.key}=${counter.value}, recomputed calls=${facts.callCount} artifacts=${facts.artifactCount}`);
      }
    }
  }

  // ---- the runner must agree with the frozen manifest --------------------
  let runnerChecks = [];
  try {
    runnerChecks = checkRunner(bundle);
  } catch (error) {
    fail('check_runner_failed', `python3 checks.py --list-checks --json did not produce a machine-readable check list: ${String(error?.message || error)}`);
  }
  let frozen = [];
  try {
    frozen = manifestChecks(path.resolve(args.manifest));
  } catch (error) {
    fail('manifest_unreadable', `cannot read the frozen manifest ${args.manifest}: ${String(error?.message || error)}`);
  }
  facts.runnerCheckCount = runnerChecks.length;
  facts.frozenCheckCount = frozen.length;
  if (runnerChecks.length && frozen.length) {
    const runnerIds = new Set(runnerChecks.map(entry => entry.id));
    const frozenIds = new Set(frozen.map(entry => entry.id));
    for (const id of frozenIds) if (!runnerIds.has(id)) fail('runner_missing_check', `checks.py does not run frozen check #${id}`);
    for (const id of runnerIds) if (!frozenIds.has(id)) fail('runner_extra_check', `checks.py runs check #${id}, which is not in the frozen manifest`);
    const runnerById = new Map(runnerChecks.map(entry => [entry.id, entry.command]));
    for (const entry of frozen) {
      const command = runnerById.get(entry.id);
      if (command && command !== entry.command) {
        fail('runner_command_diverges', `check #${entry.id}: checks.py runs "${command}", the frozen manifest says "${entry.command}"`);
      }
    }
  }

  return { check: 10, rubricVersion: 'sourcing-v1', ok: failures.length === 0, failures, facts };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parseArgs(process.argv.slice(2));
  let report;
  try {
    report = evaluate(args);
  } catch (error) {
    report = { check: 10, rubricVersion: 'sourcing-v1', ok: false, failures: [{ code: 'checker_error', message: String(error?.stack || error) }], facts: {} };
  }
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${report.ok ? 'PASS' : 'FAIL'} check #10 — ${report.failures.length} failure(s)\n${report.failures.map(item => `  - ${item.code}: ${item.message}`).join('\n')}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
