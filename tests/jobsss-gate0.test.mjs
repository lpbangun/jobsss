import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  BASE_INVOCATION,
  FORBIDDEN_CLIENT_TREES,
  FORBIDDEN_COPIED_MODULES,
  HUMAN_ONLY_DOMAIN_TOOLS,
  IMPLEMENTATION_FINGERPRINTS,
  INTENT_HANDOFFS,
  INTENT_ROUTES,
  PLUGIN_NAME,
  REPO_ROOT,
  SKILL_NAME,
  SUB_INTENTS,
  assertInsideRoot,
  collectSkillCorpus,
  listDir,
  missingMessage,
  pluginPath,
  readRequired,
  readRequiredJson,
  secretFindings,
  validateMcpDocument,
  validatePluginManifest,
  validateSkillDocument,
  walkPluginPackage
} from './helpers/jobsss-gate0.mjs';

function failMissing(rel) {
  assert.fail(missingMessage(rel));
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
  const command = mcp?.mcpServers?.jobos?.command;
  assert.equal(command, 'jobos', 'stdio command must be the bare executable jobos, not a path');
  if (typeof command === 'string') {
    assert.equal(command.includes('/') || command.includes('\\'), false, 'command must not be a filesystem path');
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
  const schemaProblems = validateMcpDocument(doc);
  const secrets = [
    ...secretFindings(JSON.stringify(doc), 'mcp.json'),
    ...walkPluginPackage()
      .filter(entry => entry.stat.isFile())
      .flatMap(entry => secretFindings(readRequired(entry.rel), entry.rel))
  ];
  assert.deepEqual(schemaProblems, [], schemaProblems.join('; '));
  assert.deepEqual(secrets, [], `secret or user-path leakage: ${secrets.join('; ')}`);
});

test('B5 exact stdio jobos ["mcp"] contract', () => {
  if (!existsSync(pluginPath('mcp.json'))) failMissing('mcp.json');
  const doc = readRequiredJson('mcp.json');
  const problems = validateMcpDocument(doc);
  assert.deepEqual(problems, [], problems.join('; '));
  assert.deepEqual(doc.mcpServers.jobos, {
    type: 'stdio',
    command: 'jobos',
    args: ['mcp']
  });
});

test('B6 base + 12 required JobSSS intents', () => {
  if (!existsSync(pluginPath('skills/jobsss/SKILL.md'))) failMissing('skills/jobsss/SKILL.md');
  const corpus = collectSkillCorpus();
  assert.match(corpus, new RegExp(BASE_INVOCATION.replace('/', '\\/')), 'skill must document the /jobsss base invocation');
  const missingIntents = [];
  const missingRoutes = [];
  const missingHandoffs = [];
  for (const intent of SUB_INTENTS) {
    const slash = `${BASE_INVOCATION} ${intent}`;
    if (!corpus.includes(slash)) missingIntents.push(slash);
    const tools = INTENT_ROUTES[intent] || [];
    for (const tool of tools) {
      if (!corpus.includes(tool)) missingRoutes.push(`${slash} -> ${tool}`);
    }
    const phrases = INTENT_HANDOFFS[intent] || [];
    for (const phrase of phrases) {
      if (!corpus.toLowerCase().includes(phrase.toLowerCase())) {
        missingHandoffs.push(`${slash} needs "${phrase}"`);
      }
    }
  }
  assert.deepEqual(missingIntents, [], `skill/references must document every frozen sub-intent: ${missingIntents.join(', ')}`);
  assert.deepEqual(missingRoutes, [], `skill/references must name the frozen JobOS route for: ${missingRoutes.join(', ')}`);
  assert.deepEqual(missingHandoffs, [], `skill/references must state the frozen handoff for: ${missingHandoffs.join(', ')}`);
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

test('B8 no duplicated JobOS implementation', () => {
  if (!existsSync(pluginPath('plugin.json')) || !existsSync(pluginPath('skills/jobsss/SKILL.md'))) {
    assert.fail('cannot prove the plugin avoids duplicating JobOS because the portable package is missing');
  }
  const copied = FORBIDDEN_COPIED_MODULES.filter(rel => existsSync(pluginPath(rel)));
  assert.deepEqual(copied, [], `do not copy JobOS modules into JobSSS: ${copied.join(', ')}`);

  const findings = [];
  for (const entry of walkPluginPackage()) {
    if (!entry.stat.isFile()) continue;
    if (!/\.(md|js|mjs|cjs|ts|json)$/i.test(entry.rel)) continue;
    const text = readRequired(entry.rel);
    for (const [pattern, label] of IMPLEMENTATION_FINGERPRINTS) {
      if (pattern.test(text)) findings.push(`${entry.rel}: ${label}`);
    }
  }
  assert.deepEqual(findings, [], `JobSSS must not reimplement JobOS (${findings.join('; ')})`);
});

test('B9 useful failure when jobos is unavailable', () => {
  if (!existsSync(pluginPath('skills/jobsss/SKILL.md'))) failMissing('skills/jobsss/SKILL.md');
  const corpus = collectSkillCorpus();
  assert.match(corpus, /\/jobsss doctor/, 'missing-runtime recovery must be exposed as /jobsss doctor');
  assert.match(
    corpus,
    /jobos.{0,40}(?:unavailable|not (?:installed|found|on PATH|resolvable)|missing)|(?:unavailable|missing|not found).{0,40}jobos/i,
    'skill must describe the jobos-unavailable case'
  );
  assert.match(corpus, /\bPATH\b/, 'recovery must mention putting jobos on PATH');
  assert.match(corpus, /jobos mcp/, 'recovery must name the stdio entry jobos mcp');
  assert.match(
    corpus,
    /do not (?:claim|invent|fabricate|pretend)/i,
    'unavailable-jobos guidance must forbid invented success'
  );
});

test('reviewer lock lives at repo root, not a client or .tmp tree', () => {
  assert.equal(path.basename(REPO_ROOT), 'jobsss');
  assert.equal(existsSync(pluginPath('BENCHMARK.md')), true, 'BENCHMARK.md must remain at the repository root');
});
