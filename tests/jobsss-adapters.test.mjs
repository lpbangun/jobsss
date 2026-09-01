import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectSkillCorpus, pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  REQUIRED_EXTENDED_TOOLS,
  REQUIRED_JOURNEY_TOOLS,
  initializeRequest,
  isolate,
  listToolsRequest,
  mcp
} from './helpers/jobsss-live-mcp.mjs';
import {
  ADAPTER_BUSINESS_LOGIC,
  COMPAT_CLIENTS,
  HANDOFF_MCP_TOOLS,
  adapterFiles,
  assertClientStateUnchanged,
  assertHonestStatus,
  collectDocsCorpus,
  entryStatus,
  extractJson,
  isAdapterCode,
  matrixClients,
  matrixTargets,
  readCompatMatrix,
  runRepoJobsss,
  snapshotClientState
} from './helpers/jobsss-productization.mjs';

const CANONICAL_SKILL = 'skills/jobsss/SKILL.md';
const CANONICAL_RUNTIME = './bin/jobsss';

function clientId(entry) {
  return String(entry?.id || entry?.client || entry?.name || '').trim().toLowerCase();
}

function clientLoading(entry) {
  return String(entry?.loading || entry?.mode || entry?.integration || '').trim().toLowerCase();
}

test('B33 canonical skill and tools stay equivalent across generated and native adapters', async t => {
  const matrix = readCompatMatrix();
  const clients = matrixClients(matrix);
  const listed = clients.map(clientId);
  for (const client of COMPAT_CLIENTS) {
    assert.ok(listed.includes(client), `compat/matrix.json must include client ${client}`);
  }
  const ctx = isolate(t, 'jobsss-b33-tools');
  const session = await mcp(ctx, [
    initializeRequest(1),
    listToolsRequest(2)
  ]);
  const names = session.frames.find(frame => frame.id === 2)?.result?.tools?.map(tool => tool.name) || [];
  const required = [...REQUIRED_JOURNEY_TOOLS, ...REQUIRED_EXTENDED_TOOLS, ...HANDOFF_MCP_TOOLS];
  const missing = required.filter(tool => !names.includes(tool));
  assert.deepEqual(missing, [], `canonical MCP tools/list missing ${missing.join(', ')}`);

  const skill = collectSkillCorpus();
  for (const tool of required) {
    assert.match(skill, new RegExp(tool), `canonical skill/references must name ${tool}`);
  }
  assert.match(skill, /\/jobsss review/, 'canonical skill must keep /jobsss review');
  assert.match(skill, /\.\/bin\/jobsss decide/, 'canonical skill must route human authority to ./bin/jobsss decide');

  for (const file of adapterFiles()) {
    const text = readFileSync(file.abs, 'utf8');
    if (file.rel.endsWith('SKILL.md')) {
      const canonical = readFileSync(pluginPath(CANONICAL_SKILL), 'utf8');
      const pointsAtCanonical = text.includes(CANONICAL_SKILL) || text.includes('/skills/jobsss/SKILL.md');
      assert.ok(
        text === canonical || pointsAtCanonical,
        `${file.rel} must be an identical generated copy or a pointer to ${CANONICAL_SKILL}`
      );
    }
    if (/\.(json|md|yml|yaml)$/.test(file.rel) || isAdapterCode(file.rel)) {
      const mentionsRuntime = text.includes(CANONICAL_RUNTIME) || text.includes('bin/jobsss') || text.includes(CANONICAL_SKILL);
      const enumeratesTools = required.filter(tool => text.includes(tool));
      if (enumeratesTools.length) {
        const missingFromAdapter = required.filter(tool => !text.includes(tool));
        assert.deepEqual(
          missingFromAdapter,
          [],
          `${file.rel} enumerates JobSSS tools but is missing ${missingFromAdapter.join(', ')}`
        );
      }
      assert.ok(
        mentionsRuntime || enumeratesTools.length === 0,
        `${file.rel} must reference ${CANONICAL_SKILL} or ${CANONICAL_RUNTIME}`
      );
    }
  }
});

test('B34 isolated available-client launch paths report verified vs unverified truthfully', { timeout: 120_000 }, async t => {
  const matrix = readCompatMatrix();
  const clients = matrixClients(matrix);
  const byId = new Map(clients.map(entry => [clientId(entry), entry]));
  const before = snapshotClientState();
  t.after(() => assertClientStateUnchanged(before));

  for (const client of COMPAT_CLIENTS) {
    const entry = byId.get(client);
    assert.ok(entry, `compat/matrix.json missing ${client}`);
    const status = entryStatus(entry);
    assertHonestStatus(status, `client ${client}`);
    const configDir = mkdtempSync(path.join(tmpdir(), `jobsss-compat-${client}-`));
    const ctx = isolate(t, `jobsss-b34-${client}`);
    const result = await runRepoJobsss(
      ['compat-probe', '--client', client, '--config-dir', configDir, '--plugin-root', pluginPath('.')],
      {
        ...ctx.env,
        HOME: configDir,
        XDG_CONFIG_HOME: path.join(configDir, 'config'),
        XDG_DATA_HOME: path.join(configDir, 'data')
      },
      { timeoutMs: 45_000 }
    );
    assert.equal(
      result.code,
      0,
      `./bin/jobsss compat-probe --client ${client} must exit 0 with a truthful JSON status (got ${result.code}): ${result.stderr.slice(0, 400) || result.stdout.slice(0, 400)}`
    );
    const payload = extractJson(result.stdout) || extractJson(result.stderr) || {};
    const probed = String(payload.status || payload.verification || '').toLowerCase();
    assert.match(probed, /^(verified|unverified)$/, `${client} probe must report verified or unverified: ${JSON.stringify(payload)}`);
    assert.equal(
      status,
      probed,
      `compat/matrix.json ${client} status ${status} must match isolated probe ${probed}`
    );
    if (probed === 'verified') {
      const blob = JSON.stringify(payload).toLowerCase();
      assert.match(blob, /jobsss/, `${client} verified probe must name the JobSSS runtime`);
      assert.doesNotMatch(blob, /jobos mcp\b/);
    }
  }
  assertClientStateUnchanged(before);
});

test('B35 generated adapters contain no business logic', () => {
  const matrix = readCompatMatrix();
  const clients = matrixClients(matrix);
  assert.ok(clients.length >= COMPAT_CLIENTS.length, 'compat/matrix.json must list every frozen client');
  const files = adapterFiles();
  for (const entry of clients) {
    const loading = clientLoading(entry);
    const adapter = entry.adapter || entry.path || entry.generated;
    if (loading.includes('generated') || (typeof adapter === 'string' && adapter.trim())) {
      const rel = String(adapter || '').replace(/^\.\//, '');
      assert.ok(
        files.some(file => file.rel === rel || file.rel.startsWith(`${rel.replace(/\/$/, '')}/`))
          || existsSync(pluginPath(rel)),
        `${clientId(entry)} claims generated adapter ${rel} but the files are missing`
      );
    }
  }
  for (const file of files) {
    if (!isAdapterCode(file.rel)) continue;
    const text = readFileSync(file.abs, 'utf8');
    for (const [pattern, label] of ADAPTER_BUSINESS_LOGIC) {
      assert.equal(
        pattern.test(text),
        false,
        `${file.rel} contains ${label}; adapters must only reference canonical skill/runtime`
      );
    }
  }
});

test('B41 documentation distinguishes verified, unverified, local preparation, and human observation', () => {
  const corpus = collectDocsCorpus();
  assert.ok(corpus.includes('./bin/jobsss decide'), 'docs must name the trusted local surface ./bin/jobsss decide');
  assert.ok(corpus.includes('/jobsss review'), 'docs must keep /jobsss review');
  assert.ok(
    /pending decisions?|decision handoff|trusted local/i.test(corpus),
    '/jobsss review must route to pending decisions plus trusted-local instructions'
  );
  for (const client of COMPAT_CLIENTS) {
    assert.ok(new RegExp(`\\b${client}\\b`, 'i').test(corpus), `docs/matrix must name client ${client}`);
  }
  const matrix = readCompatMatrix();
  for (const entry of matrixClients(matrix)) {
    assertHonestStatus(entryStatus(entry), `client ${clientId(entry)}`);
  }
  const targets = matrixTargets(matrix);
  assert.ok(targets.length >= 1, 'compat/matrix.json must list intended platforms/targets with verified|built|intended|unverified');
  for (const entry of targets) {
    assertHonestStatus(entryStatus(entry), `target ${entry.id || entry.target || entry.name}`);
  }
  assert.ok(/\bunverified\b/i.test(corpus), 'docs must use unverified for unproven clients or platforms');
  assert.ok(/human[- ]observed|observed by a human|human observation/i.test(corpus), 'docs must distinguish human observation from product action');
  assert.ok(/local preparation|prepare locally|local draft/i.test(corpus), 'docs must distinguish local preparation');
  assert.ok(/unsupported|not available|blocked|out of scope/i.test(corpus), 'docs must distinguish unsupported behavior');
  assert.equal(/install(?:ing)? JobOS|put(?:ting)? `?jobos`? on `?PATH`?/i.test(corpus), false, 'docs must not tell the agent to install JobOS');
  assert.equal(/\bjobos tui\b/i.test(corpus), false, 'docs must not route to a JobOS TUI this plugin does not ship');
  assert.equal(/\bJobSSS (?:sent|submitted|interviewed|applied)\b/.test(corpus), false, 'docs must not claim JobSSS performed external actions');
  assert.equal(/\/jobsss (?:network|interview|schedule)\b/.test(corpus), false, 'docs must not add blocked slash sub-intents');
});
