// Check #6 — no production egress bypasses the choke point (static invariant).
// Reviewer-owned: docs/BENCHMARK-sourcing-v1.md §3 #6.
//
// This is a code-shape invariant, not a runtime one (labelled as such in the
// manifest). It enumerates every outbound-egress construct under src/ and bin/
// and requires each hit to be classified by an explicit rule. Anything new
// fails, naming file and line — which is the point: a second fetch call site is
// a bypass even when every test still passes.
//
// Known limitation: comment stripping removes block comments and full-line `//`
// comments only. An inline comment that spells an egress call is a false RED;
// the fix is a justified allowlist entry (reviewer-owned), never a weaker
// pattern.
//
// Import scan scope: static ESM statements only (`import ... from`, bare
// `import '...'`, `export ... from`) — which is what this invariant claims to
// trace. The statement body is explicitly newline-tolerant: this tree formats
// multi-line named imports (src/domain.js), and a line-bounded regex silently
// truncated the closure at src/domain.js, hiding every module behind it and
// turning the invariant into a false pass.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from './helpers/sourcing-harness.mjs';

const EGRESS_PATTERNS = [
  { id: 'global-fetch', re: /globalThis\.fetch/g },
  { id: 'bare-fetch-call', re: /(?<![\w.$])fetch\s*\(/g },
  { id: 'await-fetch-impl-call', re: /await\s+fetchImpl\s*\(/g },
  { id: 'node-network-import', re: /(?:from|require\()\s*['"]node:(?:dns|dns\/promises|http|https|net|tls|http2)['"]/g },
  { id: 'node-network-call', re: /\b(?:https?|net|tls)\.(?:get|request|connect)\s*\(/g },
  { id: 'xhr', re: /XMLHttpRequest/g }
];

// Frozen allowlist. Every entry needs a reason; a new entry is a rubric change.
const ALLOWLIST = [
  { file: 'src/discovery.js', pattern: /import dns from 'node:dns\/promises'/, reason: 'choke-point module import' },
  { file: 'src/discovery.js', pattern: /fetchImpl = globalThis\.fetch/, reason: 'choke-point default parameter' },
  { file: 'src/discovery.js', pattern: /lookupImpl = dns\.lookup/, reason: 'choke-point default parameter' },
  { file: 'src/discovery.js', pattern: /const response = await fetchImpl\(/, reason: 'the single egress call inside the choke point' },
  {
    file: 'src/packaging.js',
    pattern: /https\.get\(target, \(res\) =>/,
    reason: 'generated native-evidence probe template string: release/evidence CLI path only, never the MCP runtime path',
    requiresQuotePrefix: true
  }
];

const SCAN_DIRS = ['src', 'bin'];
const RUNTIME_ENTRY = 'src/mcp.js';
const RUNTIME_EXCLUDED = ['src/packaging.js', 'src/release.js', 'src/evidence.js', 'src/sea-build.js', 'src/compat-probe.js'];

function listFiles(rel) {
  const abs = path.join(REPO_ROOT, rel);
  const out = [];
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
    }
  };
  walk(abs);
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function scanFile(abs) {
  const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
  const lines = stripComments(readFileSync(abs, 'utf8')).split('\n');
  const hits = [];
  lines.forEach((line, index) => {
    for (const { id, re } of EGRESS_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) hits.push({ rel, id, line: index + 1, text: line.trim() });
    }
  });
  return hits;
}

function classify(hit) {
  return ALLOWLIST.find(rule => rule.file === hit.rel
    && rule.pattern.test(hit.text)
    && (!rule.requiresQuotePrefix || /^\s*['"]/.test(hit.text)));
}

function allHits() {
  return SCAN_DIRS.flatMap(dir => listFiles(dir)).flatMap(scanFile);
}

// Static ESM statements, newline-tolerant between the keyword and `from`
// (`[^;]` may span lines but not cross a statement boundary). Nothing here
// widens what counts as an egress construct; it only stops the closure from
// being truncated at the first multi-line import block.
const STATIC_FROM = /(?:^|[\n;])\s*(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const STATIC_BARE = /(?:^|[\n;])\s*import\s+['"]([^'"]+)['"]/g;

function importsOf(abs) {
  const source = stripComments(readFileSync(abs, 'utf8'));
  const specifiers = [];
  for (const match of source.matchAll(STATIC_FROM)) specifiers.push(match[1]);
  for (const match of source.matchAll(STATIC_BARE)) specifiers.push(match[1]);
  return specifiers.filter(specifier => specifier.startsWith('.'));
}

function importClosure(entryRel) {
  const seen = new Set();
  const queue = [path.resolve(REPO_ROOT, entryRel)];
  while (queue.length) {
    const abs = queue.pop();
    if (seen.has(abs)) continue;
    seen.add(abs);
    for (const specifier of importsOf(abs)) queue.push(path.resolve(path.dirname(abs), specifier));
  }
  return [...seen].map(abs => path.relative(REPO_ROOT, abs).split(path.sep).join('/')).sort();
}

test('check #6: every egress construct is classified', async t => {
  await t.test('#6 no unclassified outbound-egress call site exists', () => {
    const unclassified = allHits().filter(hit => !classify(hit));
    assert.deepEqual(unclassified, [],
      `production egress must stay inside the single choke point; unclassified call sites: ${JSON.stringify(unclassified, null, 2)}`);
    const classified = allHits().filter(hit => classify(hit));
    assert.ok(classified.length >= 1, 'the choke point itself must be present in the classified set');
  });

  await t.test('#6 exactly one egress call exists in the whole tree', () => {
    const calls = allHits().filter(hit => hit.id === 'await-fetch-impl-call');
    assert.equal(calls.length, 1,
      `a second egress call is a bypass even if untested: ${JSON.stringify(calls, null, 2)}`);
  });

  await t.test('#6 the choke-point module is the only network-capable module', () => {
    const fetchers = new Set(allHits().filter(hit => hit.id === 'global-fetch').map(hit => hit.rel));
    assert.deepEqual([...fetchers], ['src/discovery.js'],
      `only src/discovery.js may reference globalThis.fetch: ${JSON.stringify([...fetchers])}`);
    const importers = new Set(allHits().filter(hit => hit.id === 'node-network-import').map(hit => hit.rel));
    assert.deepEqual([...importers], ['src/discovery.js'],
      `only src/discovery.js may import a node network module: ${JSON.stringify([...importers])}`);
  });

  await t.test('#6 the MCP runtime closure contains no reachable egress path', () => {
    const closure = importClosure(RUNTIME_ENTRY);
    assert.ok(closure.includes('src/discovery.js'), 'the runtime closure must include the choke-point module');
    for (const excluded of RUNTIME_EXCLUDED) {
      assert.equal(closure.includes(excluded), false,
        `${excluded} must not be reachable from the MCP runtime entry (${RUNTIME_ENTRY}); closure: ${JSON.stringify(closure)}`);
    }
    const runtimeHits = closure.flatMap(rel => scanFile(path.join(REPO_ROOT, rel)));
    const unclassified = runtimeHits.filter(hit => !classify(hit));
    assert.deepEqual(unclassified, [],
      `the MCP runtime path must have no unclassified egress: ${JSON.stringify(unclassified, null, 2)}`);
  });

  await t.test('#6 the allowlist stays minimal and justified', () => {
    for (const rule of ALLOWLIST) {
      assert.ok(typeof rule.reason === 'string' && rule.reason.length > 10,
        `allowlist entry for ${rule.file} must carry a real reason`);
    }
    const templateRule = ALLOWLIST.filter(rule => rule.file !== 'src/discovery.js');
    assert.equal(templateRule.length, 1,
      'exactly one non-choke-point allowlist entry is frozen (the generated probe template)');
  });
});
