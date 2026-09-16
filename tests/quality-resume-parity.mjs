import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from './helpers/jobsss-gate0.mjs';
import {
  isolate, mcp, initializeRequest, callRequest, parseToolValue,
} from './helpers/jobsss-live-mcp.mjs';

const FIX = name => path.join(REPO_ROOT, 'tests/fixtures', name);
const MASTER = readFileSync(FIX('logani-master-resume.md'), 'utf8');
const JOBS = [
  { key: 'people-ops', name: 'Logani Bangun People Ops', families: ['People Operations'], style: 'navy', text: readFileSync(FIX('logani-job-people-ops.md'), 'utf8'), must: [/candidate screening/i, /client onboarding/i] },
  { key: 'tech-education', name: 'Logani Bangun Technical Education', families: ['Technical Education'], style: 'editorial', text: readFileSync(FIX('logani-job-tech-education.md'), 'utf8'), must: [/tutorials|self-service documentation/i, /learning materials|200\+/i] },
  { key: 'implementation', name: 'Logani Bangun Implementation', families: ['Implementation'], style: 'scan', text: readFileSync(FIX('logani-job-implementation.md'), 'utf8'), must: [/client onboarding/i, /workflow and product improvements|stakeholder coordination/i] },
];

const REQUIRED = [
  'LOGANI PAGUH BANGUN',
  'The Underscoring Company',
  'PT. Inti Garis Utama',
  'Founder & CEO',
  'July 2024 - June 2025',
  'Indofood Sukses Makmur',
  'February 2024 - March 2024',
  'Musim Mas',
  'June 2023 - August 2023',
  'Harvard Graduate School of Education',
  'University of Toronto, St. George',
  'OH SHI',
  'Jobsss',
  'EXPERIENCE',
  'SELECTED PROJECTS',
  'EDUCATION',
  'SKILLS',
];

function pick(frames, id, label) {
  const value = parseToolValue(frames.find(frame => frame.id === id));
  assert.ok(value && !value.error, `${label} failed: ${JSON.stringify(value?.error || value)?.slice(0, 500)}`);
  return value;
}

function pdfText(bytes) {
  const ascii = bytes.toString('latin1');
  const hex = [...ascii.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)].map(match => {
    const hex = match[1];
    let out = '';
    for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return out;
  });
  return hex.join('\n');
}

function geometry(bytes) {
  const ascii = bytes.toString('latin1');
  const ops = [...ascii.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map(match => ({ x: +match[1], y: +match[2] }));
  const fonts = [...ascii.matchAll(/\/BaseFont \/([A-Za-z-]+)/g)].map(match => match[1]);
  const ys = ops.map(item => item.y);
  const fill = !ys.length ? 0 : (Math.max(...ys) - Math.min(...ys) + 12) / 792;
  return { ops, fonts, fill, minX: Math.min(...ops.map(item => item.x)), maxX: Math.max(...ops.map(item => item.x)) };
}

function extractPdf(filePath) {
  const bytes = readFileSync(filePath);
  const text = pdfText(bytes);
  const geo = geometry(bytes);
  const words = text.split(/\s+/).filter(Boolean);
  return { bytes, text, words, geo, sha: createHash('sha256').update(bytes).digest('hex') };
}

function achievements(text) {
  const chunk = String(text).split(/SELECTED PROJECTS/i)[0];
  return chunk.split('\n').map(line => line.replace(/^[•\-]\s*/, '').trim()).filter(line => /^(Founded|Designed|Created|Conducted|Supported|Delivered|Built)/.test(line));
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter(item => B.has(item)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 1;
}

async function journey(t) {
  const ctx = isolate(t, 'qrp');
  const boot = await mcp(ctx, [initializeRequest(1), callRequest(2, 'start', {})], { timeoutMs: 20_000 });
  pick(boot.frames, 2, 'start');
  const tailored = [];
  for (const [index, job] of JOBS.entries()) {
    const created = await mcp(ctx, [
      initializeRequest(1),
      callRequest(2, 'create_profile', { name: job.name, resumeText: MASTER, preferences: { targetRoleFamilies: job.families } }),
    ], { timeoutMs: 20_000 });
    const profile = pick(created.frames, 2, `create ${job.key}`);
    const profileId = profile.profileId || profile.id;
    const imported = await mcp(ctx, [
      initializeRequest(1),
      callRequest(2, 'import_job', { profileId, text: job.text }),
    ], { timeoutMs: 20_000 });
    const jobRes = pick(imported.frames, 2, `import ${job.key}`);
    const jobId = jobRes.jobId || jobRes.id || jobRes.job?.id;
    const made = await mcp(ctx, [
      initializeRequest(1),
      callRequest(2, 'tailor_resume', { profileId, jobId, format: 'pdf', style: job.style }),
    ], { timeoutMs: 40_000 });
    const resume = pick(made.frames, 2, `tailor ${job.key}`);
    const pdfPath = resume.artifact?.export?.path || resume.document?.path;
    assert.equal(existsSync(pdfPath), true, `${job.key} missing pdf`);
    tailored.push({
      ...job, profileId, jobId, resume, pdfPath,
      pageCount: resume.artifact?.export?.pageCount || resume.document?.pageCount,
      body: resume.artifact?.content || resume.document?.content || '',
      pdf: extractPdf(pdfPath),
    });
  }
  const styles = {};
  const first = tailored[0];
  for (const style of ['navy', 'editorial', 'scan']) {
    const made = await mcp(ctx, [
      initializeRequest(1),
      callRequest(2, 'tailor_resume', { profileId: first.profileId, jobId: first.jobId, format: 'pdf', style }),
    ], { timeoutMs: 40_000 });
    const resume = pick(made.frames, 2, `style ${style}`);
    const pdfPath = resume.artifact?.export?.path || resume.document?.path;
    styles[style] = { body: resume.artifact?.content || '', pdf: extractPdf(pdfPath) };
  }
  return { tailored, styles };
}

function score(ok, id) {
  const value = ok ? 10 : 0;
  console.log(`${id}=${value.toFixed(1)}`);
  return value;
}

test('QRP-C1 Native end-to-end product shape', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const ok = run.tailored.length === 3
    && run.tailored.every(item => item.pdf.bytes.slice(0, 8).toString() === '%PDF-1.4')
    && run.tailored.every(item => item.pageCount === 1)
    && new Set(run.tailored.map(item => item.profileId)).size === 3
    && new Set(run.tailored.map(item => item.jobId)).size === 3;
  assert.equal(score(ok, 'QRP-C1'), 10);
});

test('QRP-C2 Restored factual structure', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const missing = [];
  for (const item of run.tailored) {
    const hay = `${item.body}\n${item.pdf.text}`;
    for (const needle of REQUIRED) {
      if (!hay.includes(needle)) missing.push(`${item.key}:${needle}`);
    }
    if (/gse\.harvard\.edu/i.test(hay) && !hay.includes('Harvard Graduate School of Education')) {
      missing.push(`${item.key}:email-as-school`);
    }
  }
  assert.deepEqual(missing, [], missing.join('; '));
  assert.equal(score(missing.length === 0, 'QRP-C2'), 10);
});

test('QRP-C3 Master-relative density', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const fails = run.tailored.filter(item => item.pageCount !== 1 || item.pdf.geo.fill < 0.8 || item.pdf.words.length < 345 || item.pdf.words.length > 430);
  assert.equal(fails.length, 0, fails.map(item => `${item.key} fill=${item.pdf.geo.fill.toFixed(3)} words=${item.pdf.words.length}`).join('; '));
  assert.equal(score(fails.length === 0, 'QRP-C3'), 10);
});

test('QRP-C4 Native ATS-safe PDF', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const ok = run.tailored.every(item => {
    const fonts = item.pdf.geo.fonts;
    const allowed = fonts.every(font => /Helvetica|Times|Courier/i.test(font));
    const glyphs = [...item.pdf.text].some(ch => ch === '\uFFFD' || ch === '\0');
    return allowed && !glyphs && !/JobOS|tectonic|chromium/i.test(item.pdf.bytes.toString('latin1').slice(0, 200));
  });
  assert.equal(score(ok, 'QRP-C4'), 10);
  assert.equal(ok, true);
});

test('QRP-C5 Real tailoring, not Focus-line variance', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const sets = run.tailored.map(item => achievements(item.body));
  const hashes = sets.map(list => createHash('sha256').update([...list].sort().join('\n')).digest('hex'));
  const distinct = new Set(hashes).size === 3;
  const similar = jaccard(sets[0], sets[1]) <= 0.8 && jaccard(sets[0], sets[2]) <= 0.8 && jaccard(sets[1], sets[2]) <= 0.8;
  const counts = sets.every(list => list.length >= 4 && list.length <= 8);
  const keywords = run.tailored.every(item => item.must.every(re => re.test(item.body)));
  const orphan = run.tailored.some(item => /SELECTED ACHIEVEMENTS/i.test(item.body));
  const unique = [0,1,2].every(i => [0,1,2].filter(j => j!==i).every(j => sets[i].some(line => !sets[j].includes(line))));
  const ok = distinct && similar && counts && keywords && !orphan && unique;
  assert.equal(ok, true, JSON.stringify({
    sizes: sets.map(list => list.length),
    jaccard: [jaccard(sets[0], sets[1]), jaccard(sets[0], sets[2]), jaccard(sets[1], sets[2])],
    keywords, orphan, unique, distinct,
    sets: sets.map(list => list.map(line => line.slice(0, 40))),
  }));
  assert.equal(score(ok, 'QRP-C5'), 10);
});

test('QRP-C6 Three compositionally distinct styles', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const { navy, editorial, scan } = run.styles;
  const facts = body => body.replace(/^Focus:.*$/m, '').replace(/\s+/g, ' ').trim();
  const sameFacts = facts(navy.body) === facts(editorial.body) && facts(navy.body) === facts(scan.body);
  const shas = new Set([navy.pdf.sha, editorial.pdf.sha, scan.pdf.sha]);
  const geo = [navy, editorial, scan].map(item => item.pdf.geo.minX + ':' + item.pdf.geo.maxX);
  const distinctGeo = new Set(geo).size >= 2;
  const ok = sameFacts && shas.size === 3 && distinctGeo;
  assert.equal(score(ok, 'QRP-C6'), 10);
  assert.equal(ok, true, JSON.stringify({ shas: [...shas], geo, sameFacts }));
});

test('QRP-C7 Structured ownership and no orphan bucket', { timeout: 180_000 }, async t => {
  const run = await journey(t);
  const ok = run.tailored.every(item => {
    const text = item.body;
    if (/SELECTED ACHIEVEMENTS/i.test(text)) return false;
    return /The Underscoring Company[\s\S]{0,200}Founder/i.test(text)
      && /Harvard Graduate School of Education[\s\S]{0,200}Master of Education/i.test(text);
  });
  assert.equal(score(ok, 'QRP-C7'), 10);
  assert.equal(ok, true);
});
