import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  FORBIDDEN_CLIENT_TREES,
  HUMAN_ONLY_DOMAIN_TOOLS,
  PLUGIN_NAME,
  REPO_ROOT,
  SKILL_NAME,
  assertInsideRoot,
  collectSkillCorpus,
  listDir,
  missingMessage,
  pluginPath,
  readRequired,
  readRequiredJson,
  secretFindings,
  validatePluginManifest,
  validateSkillDocument,
  walkPluginPackage
} from './helpers/jobsss-gate0.mjs';

export const STANDALONE_SERVER_NAME = 'jobsss';
export const STANDALONE_COMMAND = './bin/jobsss';
export const STANDALONE_ARGS = Object.freeze(['mcp', '--data', '${PLUGIN_DATA}']);
export const REQUIRED_JOURNEY_TOOLS = Object.freeze([
  'doctor',
  'start',
  'create_profile',
  'import_job',
  'list_jobs',
  'score_job',
  'pursue_job',
  'applications_plan',
  'review_queue'
]);
export const BLOCKED_MCP_TOOLS = Object.freeze([
  ...HUMAN_ONLY_DOMAIN_TOOLS,
  'submit_application_form',
  'inspect_application_form',
  'assist_application_form'
]);

const CORE_SLASH = Object.freeze([
  '/jobsss doctor',
  '/jobsss start',
  '/jobsss pursue',
  '/jobsss pipeline',
  '/jobsss review'
]);

function failMissing(rel) {
  assert.fail(missingMessage(rel));
}

function validateStandaloneMcpShape(doc) {
  const problems = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['mcp.json must be a JSON object'];
  }
  if (doc.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json') {
    problems.push('mcp.json $schema must be https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  }
  for (const key of Object.keys(doc)) {
    if (key !== '$schema' && key !== 'mcpServers') {
      problems.push(`mcp.json has unknown top-level field "${key}"`);
    }
  }
  if (doc.mcpServers === null || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) {
    problems.push('mcp.json mcpServers must be an object');
    return problems;
  }
  const names = Object.keys(doc.mcpServers);
  if (names.length !== 1) {
    problems.push('mcp.json must declare exactly one server');
  }
  const server = doc.mcpServers[names[0]];
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    problems.push('mcp server entry must be an object');
    return problems;
  }
  if (server.type !== 'stdio') problems.push('server type must be "stdio"');
  if (typeof server.command !== 'string' || !server.command.trim()) {
    problems.push('server command must be a non-empty string');
  }
  if (!Array.isArray(server.args) || server.args.some(value => typeof value !== 'string')) {
    problems.push('server args must be an array of strings');
  }
  const extra = Object.keys(server).filter(key => !['type', 'command', 'args'].includes(key));
  if (extra.length) {
    problems.push(`server has extra keys (${extra.join(', ')}); env/cwd/headers are forbidden`);
  }
  return problems;
}

test('B1 Agent Plugin manifest validity', () => {
  if (!existsSync(pluginPath('plugin.json'))) failMissing('plugin.json');
  const manifest = readRequiredJson('plugin.json');
  const problems = validatePluginManifest(manifest);
  assert.deepEqual(problems, [], problems.join('; '));
  assert.equal(manifest.name, PLUGIN_NAME);
});

test('B2 Agent Skill validity', () => {
  const skillRel = 'skills/jobsss/SKILL.md';
  const skillAbs = pluginPath(skillRel);
  if (!existsSync(skillAbs)) failMissing(skillRel);
  assert.equal(lstatSync(skillAbs).isFile(), true, `${skillRel} must be a regular file`);
  const text = readRequired(skillRel);
  const { problems } = validateSkillDocument(text, skillRel);
  assert.deepEqual(problems, [], problems.join('; '));

  const skillsDir = listDir('skills');
  assert.ok(skillsDir, missingMessage('skills/'));
  const skillDirs = skillsDir.filter(entry => entry.isDirectory() || entry.isSymbolicLink());
  assert.deepEqual(
    skillDirs.map(entry => entry.name),
    [SKILL_NAME],
    'this foundation permits exactly one skill directory: skills/jobsss/'
  );

  const refsAbs = pluginPath('skills/jobsss/references');
  assert.equal(existsSync(refsAbs), true, missingMessage('skills/jobsss/references/'));
  assert.equal(lstatSync(refsAbs).isDirectory(), true, 'skills/jobsss/references/ must be a directory');
  assert.equal(lstatSync(refsAbs).isSymbolicLink(), false, 'skills/jobsss/references/ must not be a symlink');
});

test('B3 package-boundary safety', () => {
  for (const rel of ['plugin.json', 'mcp.json', 'skills/jobsss/SKILL.md']) {
    if (!existsSync(pluginPath(rel))) failMissing(rel);
    assertInsideRoot(pluginPath(rel), rel);
    assert.equal(lstatSync(pluginPath(rel)).isSymbolicLink(), false, `${rel} must not be a symlink`);
  }

  const walked = walkPluginPackage();
  assert.ok(walked.length > 0, 'plugin package files are missing');
  for (const entry of walked) {
    if (entry.stat.isSymbolicLink()) {
      assert.fail(`${entry.rel} is a symlink; package paths must stay inside the plugin root`);
    }
    assertInsideRoot(entry.abs, entry.rel);
  }

  const mcp = readRequiredJson('mcp.json');
  const names = Object.keys(mcp?.mcpServers || {});
  const command = mcp?.mcpServers?.[names[0]]?.command;
  assert.equal(typeof command, 'string', 'stdio command must be present');
  const isBare = !command.includes('/') && !command.includes('\\');
  const isPluginRelative = command.startsWith('./') && !command.includes('..');
  assert.ok(
    isBare || isPluginRelative,
    'stdio command must be a bare executable name or a plugin-relative ./ path'
  );
  if (isPluginRelative) {
    assertInsideRoot(path.resolve(REPO_ROOT, command), 'mcp.json command');
  }

  for (const tree of FORBIDDEN_CLIENT_TREES) {
    const abs = pluginPath(tree);
    if (!existsSync(abs)) continue;
    const mcpInside = existsSync(path.join(abs, 'mcp.json'));
    assert.equal(
      mcpInside,
      false,
      `${tree}/ must not replace portable root mcp.json as the source of truth`
    );
  }

  const corpus = walkPluginPackage()
    .filter(entry => entry.stat.isFile())
    .map(entry => `${entry.rel}\n${readRequired(entry.rel)}`)
    .join('\n');
  assert.match(corpus, /\S/, 'plugin package is empty');
  assert.doesNotMatch(corpus, /(?:^|[\s'"=])(?:\/home\/[A-Za-z0-9._-]+|~\/)/m);
});

test('B4 valid secret-free mcp.json', () => {
  if (!existsSync(pluginPath('mcp.json'))) failMissing('mcp.json');
  const doc = readRequiredJson('mcp.json');
  const schemaProblems = validateStandaloneMcpShape(doc);
  const secrets = [
    ...secretFindings(JSON.stringify(doc), 'mcp.json'),
    ...walkPluginPackage()
      .filter(entry => entry.stat.isFile())
      .flatMap(entry => secretFindings(readRequired(entry.rel), entry.rel))
  ];
  assert.deepEqual(schemaProblems, [], schemaProblems.join('; '));
  assert.deepEqual(secrets, [], `secret or user-path leakage: ${secrets.join('; ')}`);
});

test('B5 exact stdio bundled ./bin/jobsss contract', () => {
  if (!existsSync(pluginPath('mcp.json'))) failMissing('mcp.json');
  const doc = readRequiredJson('mcp.json');
  const problems = validateStandaloneMcpShape(doc);
  assert.deepEqual(problems, [], problems.join('; '));
  assert.deepEqual(Object.keys(doc.mcpServers), [STANDALONE_SERVER_NAME]);
  assert.deepEqual(doc.mcpServers[STANDALONE_SERVER_NAME], {
    type: 'stdio',
    command: STANDALONE_COMMAND,
    args: [...STANDALONE_ARGS]
  });
});

test('B6 standalone core journey intents', () => {
  if (!existsSync(pluginPath('skills/jobsss/SKILL.md'))) failMissing('skills/jobsss/SKILL.md');
  const corpus = collectSkillCorpus();
  assert.match(corpus, /\/jobsss(?!\w)/, 'skill must document the /jobsss base invocation');
  const missingSlash = CORE_SLASH.filter(value => !corpus.includes(value));
  assert.deepEqual(missingSlash, [], `skill/references must document: ${missingSlash.join(', ')}`);
  assert.ok(
    /create_profile|import_profile|\/jobsss profile/i.test(corpus),
    'skill must document profile create/import'
  );
  assert.match(corpus, /import_job|\/jobsss find/i, 'skill must document local job import/discover');
  assert.match(corpus, /score_job|\/jobsss score/i, 'skill must document scoring');
  for (const tool of REQUIRED_JOURNEY_TOOLS) {
    assert.match(corpus, new RegExp(tool), `skill/references must name frozen MCP tool ${tool}`);
  }
  assert.ok(corpus.includes('PLUGIN_DATA'), 'skill must name PLUGIN_DATA as the state root');
  assert.ok(corpus.includes('./bin/jobsss'), 'skill must name the bundled launcher ./bin/jobsss');
  assert.match(
    corpus,
    /without JobOS|JobOS (?:is )?not (?:required|needed|used)|no JobOS (?:CLI|runtime|executable)|JobOS absent/i,
    'skill must say the standalone runtime does not require JobOS'
  );
  for (const topic of ['network', 'interview', 'schedul', 'browser']) {
    assert.match(
      corpus,
      new RegExp(`${topic}[\\s\\S]{0,160}(out of scope|not available|handoff|blocked|human-only)`, 'i'),
      `skill must mark ${topic} as blocked, handed off, or out of scope`
    );
  }
  assert.match(
    corpus,
    /never (?:claim|fabricate|invent).{0,80}(?:submission|sending|approval|deferred|future capability)/i,
    'skill must forbid fabricated submission, sending, approval, or deferred capability'
  );
});

test('B7 accurate human-only handoffs', () => {
  if (!existsSync(pluginPath('skills/jobsss/SKILL.md'))) failMissing('skills/jobsss/SKILL.md');
  const corpus = collectSkillCorpus();
  const missing = HUMAN_ONLY_DOMAIN_TOOLS.filter(name => !corpus.includes(name));
  assert.deepEqual(missing, [], `human-only tools missing from skill/references: ${missing.join(', ')}`);
  assert.match(corpus, /trusted (?:CLI|TUI|cli\/tui|CLI\/TUI)/i, 'handoffs must point at trusted CLI/TUI');
  assert.match(
    corpus,
    /not (?:available to MCP|an? MCP tool|MCP-attestable)|must not (?:call|expose|claim).{0,40}MCP/i,
    'skill must say human-only tools are not MCP-attestable'
  );
  for (const banned of ['mark_outreach_sent', 'attest_application_submitted', 'approve_artifact']) {
    assert.match(corpus, new RegExp(banned), `handoff catalog must include ${banned}`);
  }
});

test('B8 self-contained bundled runtime without JobOS', () => {
  const launcher = pluginPath('bin/jobsss');
  const srcDir = pluginPath('src');
  assert.equal(existsSync(launcher), true, missingMessage('bin/jobsss'));
  assert.equal(lstatSync(launcher).isFile(), true, 'bin/jobsss must be a regular file');
  assert.equal(lstatSync(launcher).isSymbolicLink(), false, 'bin/jobsss must not be a symlink');
  assertInsideRoot(launcher, 'bin/jobsss');
  assert.equal(existsSync(srcDir), true, missingMessage('src/'));
  assert.equal(lstatSync(srcDir).isDirectory(), true, 'src/ must be a directory');
  assert.equal(lstatSync(srcDir).isSymbolicLink(), false, 'src/ must not be a symlink');

  const findings = [];
  const jobApp = '/home/logani/projects/Job App';
  const inspect = ['bin/jobsss', 'src', 'plugin.json', 'mcp.json', 'skills'];
  const files = [];
  for (const rel of inspect) {
    const abs = pluginPath(rel);
    if (!existsSync(abs)) continue;
    const stat = lstatSync(abs);
    if (stat.isFile()) files.push(rel);
    else if (stat.isDirectory()) {
      const stack = [rel];
      while (stack.length) {
        const current = stack.pop();
        for (const entry of listDir(current) || []) {
          const child = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(child);
          else if (entry.isFile()) files.push(child);
        }
      }
    }
  }
  let jsCount = 0;
  let mentionsJobos = false;
  for (const rel of files) {
    if (!/\.(md|js|mjs|cjs|ts|json|sh)$/i.test(rel)) continue;
    const text = readRequired(rel);
    if (/\.(js|mjs|cjs|ts)$/i.test(rel)) jsCount += 1;
    if (/jobos/i.test(text)) mentionsJobos = true;
    if (text.includes(jobApp)) findings.push(`${rel}: absolute JobOS source path`);
    if (/(?:from|import)\s+['"][^'"]*Job App[^'"]*['"]/.test(text)) {
      findings.push(`${rel}: imports JobOS source tree`);
    }
    if (/\bspawn(?:Sync)?\([^)]*['"]jobos['"]/.test(text) || /\bexecFile(?:Sync)?\([^)]*['"]jobos['"]/.test(text)) {
      findings.push(`${rel}: spawns jobos executable`);
    }
  }
  assert.deepEqual(findings, [], `bundled runtime must not depend on JobOS files (${findings.join('; ')})`);
  assert.ok(jsCount > 0, 'src/ must contain the standalone runtime implementation');

  if (jsCount > 0) {
    assert.equal(existsSync(pluginPath('LICENSE')), true, 'shipping src/ requires a LICENSE notice at the plugin root');
    const license = readRequired('LICENSE');
    assert.match(license, /MIT/, 'LICENSE must preserve the MIT notice');
    if (mentionsJobos) {
      assert.match(license, /JobOS/, 'ported JobOS behavior must keep a JobOS attribution in LICENSE or NOTICE');
    }
  }
});

test('B9 doctor diagnoses bundled runtime and PLUGIN_DATA', () => {
  if (!existsSync(pluginPath('skills/jobsss/SKILL.md'))) failMissing('skills/jobsss/SKILL.md');
  const corpus = collectSkillCorpus();
  assert.match(corpus, /\/jobsss doctor/, 'recovery must be exposed as /jobsss doctor');
  assert.ok(corpus.includes('PLUGIN_DATA'), 'doctor guidance must name PLUGIN_DATA');
  assert.ok(corpus.includes('./bin/jobsss'), 'doctor guidance must name ./bin/jobsss');
  assert.match(
    corpus,
    /do not (?:claim|invent|fabricate|pretend)/i,
    'doctor guidance must forbid invented success'
  );
  assert.doesNotMatch(
    corpus,
    /Recover by installing JobOS, putting `jobos` on `PATH`/i
  );
});

test('reviewer lock lives at repo root, not a client or .tmp tree', () => {
  assert.equal(path.basename(REPO_ROOT), 'jobsss');
  assert.equal(existsSync(pluginPath('BENCHMARK.md')), true, 'BENCHMARK.md must remain at the repository root');
});

test('synthetic fixtures stay secret-free and local', () => {
  for (const rel of ['tests/fixtures/profile-resume.md', 'tests/fixtures/job-posting.md']) {
    assert.equal(existsSync(pluginPath(rel)), true, missingMessage(rel));
    const text = readRequired(rel);
    assert.match(text, /\S/, `${rel} is empty`);
    assert.deepEqual(secretFindings(text, rel), [], `${rel} must not contain secrets or user paths`);
    assert.doesNotMatch(text, /@gmail\.com|@yahoo\.com|sk-[A-Za-z0-9]{16,}/);
  }
});
