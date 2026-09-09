import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const mod = await import('../src/p3-contracts.js');
const C = mod.default ?? mod;

const goodPacket = () => ({
  format: 'jobsss.packet/v1',
  jobId: 'job-abc123',
  revision: 2,
  contentHash: 'PLACEHOLDER',
  components: {
    resumePdf: 'packet/resume.pdf',
    coverLetter: 'packet/cover-letter.md',
    answers: 'packet/answers.json',
    checklist: 'packet/checklist.json',
  },
  asks: [{ id: 'ask-1', label: 'Why this role?' }],
  answers: [{ askId: 'ask-1', text: 'Synthetic answer.' }],
  checklist: [{ label: 'Proofread', status: 'done' }],
  readiness: 'ready',
});
const withHash = (p) => ({ ...p, contentHash: C.computePacketHash(p) });

describe('packet contract', () => {
  it('accepts a valid complete packet', () => {
    const r = C.validatePacket(withHash(goodPacket()));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.completeness, 'complete');
  });

  it('treats missing PDF/answers as incomplete, not ready', () => {
    const p = goodPacket();
    p.components = { ...p.components, resumePdf: null };
    p.answers = [];
    p.readiness = 'incomplete';
    const r = C.validatePacket(withHash(p));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.completeness, 'incomplete');
    assert.ok(r.missing.length > 0);
  });

  it('rejects fabricated readiness', () => {
    const p = goodPacket();
    p.components = { ...p.components, resumePdf: null };
    p.answers = [];
    p.readiness = 'ready';
    const r = C.validatePacket(withHash(p));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'fabricated_readiness'));
  });

  it('rejects send/apply attestation claims', () => {
    for (const field of ['sent', 'submitted', 'applied']) {
      const p = withHash({ ...goodPacket(), [field]: true });
      const r = C.validatePacket(p);
      assert.equal(r.ok, false, field);
      assert.ok(r.errors.some((e) => e.code === 'remote_attestation'));
    }
  });

  it('keeps missing asks degraded, rejects unlinked answers', () => {
    const p = goodPacket();
    p.asks = [
      { id: 'ask-1', label: 'Why this role?' },
      { id: 'ask-2', label: 'Unanswered synthetic question' },
    ];
    p.readiness = 'incomplete';
    const r = C.validatePacket(withHash(p));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.completeness, 'incomplete');
    assert.ok(r.missing.includes('ask-2'));

    const bad = withHash({ ...goodPacket(), answers: [{ askId: 'ask-nope', text: 'x' }] });
    const r2 = C.validatePacket(bad);
    assert.equal(r2.ok, false);
    assert.ok(r2.errors.some((e) => e.code === 'unlinked_answer'));
  });

  it('rejects absolute paths and traversal', () => {
    for (const evil of ['/abs/resume.pdf', '../escape.pdf', 'a/../../b.pdf', 'C:\\win.pdf']) {
      const p = goodPacket();
      p.components = { ...p.components, resumePdf: evil };
      const r = C.validatePacket(withHash(p));
      assert.equal(r.ok, false, evil);
      assert.ok(r.errors.some((e) => e.code === 'unsafe_path'));
    }
  });

  it('rejects stale contentHash', () => {
    const p = withHash(goodPacket());
    p.revision = 99;
    const r = C.validatePacket(p);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'content_hash_mismatch'));
  });
});

describe('outcome contract', () => {
  const goodOutcome = () => ({
    action: 'artifact.approve',
    id: 'artifact-1',
    revision: 3,
    contentHash: sha256('synthetic-payload'),
    actor: 'trusted_local',
  });

  it('accepts a valid outcome', () => {
    const r = C.validateOutcome(goodOutcome());
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('rejects missing hash/revision and unknown action', () => {
    for (const o of [
      { ...goodOutcome(), contentHash: undefined },
      { ...goodOutcome(), revision: 0 },
      { ...goodOutcome(), revision: -1 },
      { ...goodOutcome(), action: 'application.approve' },
      { ...goodOutcome(), action: 'job.approve' },
    ]) {
      assert.equal(C.validateOutcome(o).ok, false, JSON.stringify(o));
    }
    const codes = C.validateOutcome({ ...goodOutcome(), action: 'nope.x' }).errors.map((e) => e.code);
    assert.ok(codes.includes('unknown_decision_action'));
    assert.ok(C.validateOutcome({ ...goodOutcome(), contentHash: undefined }).errors.some((e) => e.code === 'missing_binding'));
  });

  it('normalizes uppercase hash like authority.js (toLowerCase then hex check)', () => {
    const o = { ...goodOutcome(), contentHash: sha256('synthetic-payload').toUpperCase() };
    const r = C.validateOutcome(o);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.normalized.contentHash, o.contentHash.toLowerCase());
  });

  it('rejects non-trusted actors and MCP-shaped approve payloads', () => {
    assert.equal(C.validateOutcome({ ...goodOutcome(), actor: 'mcp' }).ok, false);
    assert.equal(C.validateOutcome({ ...goodOutcome(), actor: undefined }).ok, false);
    const mcpShaped = { tool: 'artifact.approve', jobId: 'job-1', expectedRevision: 3 };
    const r = C.validateOutcome(mcpShaped);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'missing_binding'));
  });

  it('rejects remote-attestation claims in outcomes', () => {
    const r = C.validateOutcome({ ...goodOutcome(), applied: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'remote_attestation'));
  });
});

describe('bulk input contract', () => {
  const rec = (i = 1, extra = {}) => ({
    id: `rec-${i}`,
    text: `Synthetic posting ${i} for a fictional role.`,
    provenance: 'host_provided',
    ...extra,
  });
  const jsonl = (arr) => arr.map((r) => JSON.stringify(r)).join('\n') + '\n';

  it('accepts a happy-path JSONL drop', () => {
    const r = C.parseBulkJsonl(jsonl([rec(1), rec(2, { url: 'https://example.com/jobs/1' })]));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.records.length, 2);
  });

  it('flags duplicate text without aborting', () => {
    const r = C.parseBulkJsonl(jsonl([rec(1), rec(2, { text: rec(1).text })]));
    assert.equal(r.ok, true);
    assert.ok(r.duplicates.length >= 1);
    assert.ok(r.records.length >= 1);
  });

  it('rejects file: urls, credentialed urls, and non-public hosts per record', () => {
    for (const url of [
      'file:///etc/passwd',
      'https://user:pass@example.com/jobs',
      'http://localhost:8080/jobs',
      'http://127.0.0.1/jobs',
      'https://internal.example.local/jobs',
    ]) {
      const r = C.parseBulkJsonl(jsonl([rec(1, { url })]));
      assert.equal(r.ok, false, url);
      assert.ok(r.errors.length > 0);
    }
  });

  it('rejects absolute paths, traversal, and secret-like fields', () => {
    assert.equal(C.parseBulkJsonl(jsonl([rec(1, { stagedPath: '/abs/x.txt' })])).ok, false);
    assert.equal(C.parseBulkJsonl(jsonl([rec(1, { stagedPath: '../x.txt' })])).ok, false);
    assert.equal(C.parseBulkJsonl(jsonl([{ ...rec(1), api_key: 'sk-live-123' }])).ok, false);
  });

  it('enforces max records and max bytes', () => {
    assert.ok(Number.isInteger(C.MAX_BULK_RECORDS) && C.MAX_BULK_RECORDS <= 1000);
    assert.ok(Number.isInteger(C.MAX_BULK_BYTES) && C.MAX_BULK_BYTES <= 10 * 1024 * 1024);
    const many = Array.from({ length: C.MAX_BULK_RECORDS + 1 }, (_, i) => rec(i));
    const r = C.parseBulkJsonl(jsonl(many));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'bulk_over_limit'));
    const big = C.parseBulkJsonl('x'.repeat(C.MAX_BULK_BYTES + 1));
    assert.equal(big.ok, false);
  });

  it('requires text and/or url per record', () => {
    const r = C.parseBulkJsonl(jsonl([{ id: 'empty', provenance: 'host_provided' }]));
    assert.equal(r.ok, false);
  });
});

describe('schemas, examples, docs', () => {
  it('schemas exist and examples (if any) validate', () => {
    for (const f of ['packet.schema.json', 'outcome.schema.json', 'bulk-input.schema.json', 'README.md']) {
      assert.ok(existsSync(path.join(ROOT, 'contracts', f)), f);
    }
    for (const s of ['packet.schema.json', 'outcome.schema.json', 'bulk-input.schema.json']) {
      JSON.parse(readFileSync(path.join(ROOT, 'contracts', s), 'utf8'));
    }
    const exDir = path.join(ROOT, 'contracts', 'examples');
    let examples = [];
    try {
      examples = readdirSync(exDir).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'));
    } catch { examples = []; }
    assert.ok(examples.length > 0, 'expected at least one example');
    for (const f of examples) {
      const full = path.join(exDir, f);
      const text = readFileSync(full, 'utf8');
      if (f.startsWith('packet-complete')) assert.equal(C.validatePacket(withHash(JSON.parse(text))).ok, true, f);
      else if (f.startsWith('packet-incomplete')) {
        const r = C.validatePacket(withHash(JSON.parse(text)));
        assert.equal(r.ok, true, f);
        assert.equal(r.completeness, 'incomplete', f);
      } else if (f.startsWith('outcome-')) assert.equal(C.validateOutcome(JSON.parse(text)).ok, true, f);
      else if (f.startsWith('bulk-')) assert.equal(C.parseBulkJsonl(text).ok, true, f);
      else throw new Error(`unasserted example ${f}`);
    }
  });

  it('docs separate currently-callable from P4 future; no vendor names', () => {
    const readme = readFileSync(path.join(ROOT, 'contracts', 'README.md'), 'utf8');
    assert.ok(/currently callable/i.test(readme));
    assert.ok(/P4|future/i.test(readme));
    const forbidden = ['job' + 'man', 'oh' + 'shi', 'ex' + 'ecutor'];
    const hay = [readme];
    const walk = (dir) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== 'node_modules') walk(full); }
        else if (/\.(md|json|jsonl|mjs|js)$/.test(f.name)) hay.push(readFileSync(full, 'utf8'));
      }
    };
    walk(path.join(ROOT, 'contracts'));
    hay.push(readFileSync(path.join(ROOT, 'src', 'p3-contracts.js'), 'utf8'));
    const lower = hay.join('\n').toLowerCase();
    for (const w of [...forbidden, 'scr' + 'aper', 'cra' + 'wler']) {
      assert.ok(!lower.includes(w), `vendor/crawler term present: ${w}`);
    }
    assert.ok(!/(^|[^a-z])feed([^a-z]|$)/.test(lower), 'word "feed" present');
  });
});
