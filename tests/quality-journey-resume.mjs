import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = path.resolve(
  process.env.JOURNEY_RESUME_EVIDENCE
    || '/home/logani/oprun-evidence/jobsss-fake-journey-2026-09-16',
);
const EXPECTED_COMMIT = 'bd8e801e1e54e7611673aabd2a8f993d58764831';
const FORBIDDEN = /Logani|loganibangun|gse\.harvard\.edu|Underscoring|Indofood|Musim Mas/i;
const ATS_HOSTILE = /[\u00a0\u200b-\u200f\u202a-\u202e\u2060\ufb00-\ufb06\ufffd\0]/u;
const STYLES = new Set(['navy', 'editorial', 'scan']);

const SOURCES = Object.freeze({
  maya: {
    name: 'Maya Alvarez',
    city: 'Austin, TX',
    email: 'maya.alvarez.pm@example.com',
    school: 'University of Texas at Austin',
    styles: ['navy', 'editorial'],
    roles: [
      {
        employer: 'Northwind Analytics',
        title: 'Senior Product Manager',
        dates: 'March 2022 - Present',
      },
      {
        employer: 'Helios Workflows',
        title: 'Product Manager',
        dates: 'June 2019 - February 2022',
      },
    ],
    bullets: [
      'Shipped a self-serve usage dashboard used by 140 B2B accounts; cut "where\'s my data" tickets 31% in two quarters.',
      'Ran discovery with CS and sales engineers; turned 18 interviews into a PLG checkout that raised trial-to-paid 4 points.',
      'Owned roadmap for billing + seats; sequenced usage-based pricing without breaking existing annual contracts.',
      'Launched in-app checklists that reduced time-to-first-value from 9 days to 4 for mid-market admins.',
      'Partnered with design on a navigation IA rewrite; support volume on "can\'t find X" dropped after release.',
      'Wrote PRDs and acceptance tests for SSO/SAML; unblocked three enterprise deals that required it.',
    ],
    resumeText: `Maya Alvarez
Austin, TX | maya.alvarez.pm@example.com | linkedin.com/in/maya-alvarez-pm

EXPERIENCE
Northwind Analytics - Austin, TX / Remote
Senior Product Manager | March 2022 - Present
- Shipped a self-serve usage dashboard used by 140 B2B accounts; cut "where's my data" tickets 31% in two quarters.
- Ran discovery with CS and sales engineers; turned 18 interviews into a PLG checkout that raised trial-to-paid 4 points.
- Owned roadmap for billing + seats; sequenced usage-based pricing without breaking existing annual contracts.

Helios Workflows - San Francisco, CA
Product Manager | June 2019 - February 2022
- Launched in-app checklists that reduced time-to-first-value from 9 days to 4 for mid-market admins.
- Partnered with design on a navigation IA rewrite; support volume on "can't find X" dropped after release.
- Wrote PRDs and acceptance tests for SSO/SAML; unblocked three enterprise deals that required it.

EDUCATION
University of Texas at Austin
B.S. Information Systems | 2019

SKILLS
Product discovery; PLG metrics; roadmap sequencing; billing/packaging; SSO; stakeholder facilitation.`,
  },

  deshawn: {
    name: 'DeShawn Brooks',
    city: 'Chicago, IL',
    email: 'deshawn.brooks.sre@example.com',
    school: 'University of Illinois Chicago',
    styles: ['navy', 'scan'],
    roles: [
      {
        employer: 'Lake Michigan Compute',
        title: 'Staff Platform Engineer',
        dates: 'January 2021 - Present',
      },
      {
        employer: 'Harbor Freight Digital',
        title: 'SRE',
        dates: 'July 2017 - December 2020',
      },
    ],
    bullets: [
      'Built a Kubernetes platform for 40 services; paged-on-call load fell after SLOs and error budgets landed.',
      'Introduced Terraform modules for RDS and IAM; new environment standup went from days to a documented half-day.',
      'Wrote runbooks and a golden-path CI template; three product teams adopted it without a platform ticket.',
      'Owned Prometheus/Grafana for checkout; caught a cache stampede before Black Friday peak.',
      'Automated cert rotation; ended a class of expired-TLS incidents.',
      'Load-tested the payments path and published a capacity sheet used by the incident commander.',
    ],
    resumeText: `DeShawn Brooks
Chicago, IL | deshawn.brooks.sre@example.com | linkedin.com/in/deshawn-brooks-sre

EXPERIENCE
Lake Michigan Compute - Chicago, IL
Staff Platform Engineer | January 2021 - Present
- Built a Kubernetes platform for 40 services; paged-on-call load fell after SLOs and error budgets landed.
- Introduced Terraform modules for RDS and IAM; new environment standup went from days to a documented half-day.
- Wrote runbooks and a golden-path CI template; three product teams adopted it without a platform ticket.

Harbor Freight Digital - Chicago, IL
SRE | July 2017 - December 2020
- Owned Prometheus/Grafana for checkout; caught a cache stampede before Black Friday peak.
- Automated cert rotation; ended a class of expired-TLS incidents.
- Load-tested the payments path and published a capacity sheet used by the incident commander.

EDUCATION
University of Illinois Chicago
B.S. Computer Science | 2017

SKILLS
Kubernetes; Terraform; Prometheus; CI golden paths; incident response; capacity planning.`,
  },

  aisha: {
    name: 'Aisha Rahman',
    city: 'New York, NY',
    email: 'aisha.rahman.people@example.com',
    school: 'CUNY Hunter College',
    styles: ['editorial', 'scan'],
    roles: [
      {
        employer: 'Cedar & Pine Labs',
        title: 'People Operations Lead',
        dates: 'April 2021 - Present',
      },
      {
        employer: 'Brightline Education',
        title: 'Recruiting Coordinator',
        dates: 'August 2018 - March 2021',
      },
    ],
    bullets: [
      'Ran recruiting ops for engineering and GTM; time-to-schedule interview dropped after a structured intake + scorecard.',
      'Designed onboarding week for 60 hires; 30-day pulse scores on "I know how to get work done" improved.',
      'Built a lightweight HRIS workflow in Notion + Greenhouse; eliminated double-entry of offer letters.',
      'Coordinated 200+ onsite/virtual loops; candidate NPS comments cited clear logistics.',
      'Trained hiring managers on structured interviews; interview-to-offer conversion stabilized.',
      'Wrote a contractor-to-FTE playbook used by two subsequent People partners.',
    ],
    resumeText: `Aisha Rahman
New York, NY | aisha.rahman.people@example.com | linkedin.com/in/aisha-rahman-people

EXPERIENCE
Cedar & Pine Labs - New York, NY / Hybrid
People Operations Lead | April 2021 - Present
- Ran recruiting ops for engineering and GTM; time-to-schedule interview dropped after a structured intake + scorecard.
- Designed onboarding week for 60 hires; 30-day pulse scores on "I know how to get work done" improved.
- Built a lightweight HRIS workflow in Notion + Greenhouse; eliminated double-entry of offer letters.

Brightline Education - Brooklyn, NY
Recruiting Coordinator | August 2018 - March 2021
- Coordinated 200+ onsite/virtual loops; candidate NPS comments cited clear logistics.
- Trained hiring managers on structured interviews; interview-to-offer conversion stabilized.
- Wrote a contractor-to-FTE playbook used by two subsequent People partners.

EDUCATION
CUNY Hunter College
B.A. Psychology | 2018

SKILLS
Recruiting operations; structured interviews; onboarding design; Greenhouse; HRIS hygiene; hiring-manager coaching.`,
  },
});

const REQUIRED_SEQUENCE = Object.freeze([
  'doctor',
  'start',
  'create_profile',
  'create_saved_search',
  'search_jobs',
  'save_job',
  'save_job',
  'score_job',
  'score_job',
  'tailor_resume',
  'tailor_resume',
]);

const FROZEN_SUITE = Object.freeze([
  'tests/jobsss-gate0.test.mjs',
  'tests/jobsss-mcp-compat.test.mjs',
  'tests/jobsss-journey.test.mjs',
  'tests/jobsss-persistence.test.mjs',
  'tests/jobsss-discovery.test.mjs',
  'tests/jobsss-workflows.test.mjs',
  'tests/jobsss-integrity.test.mjs',
  'tests/jobsss-release.test.mjs',
  'tests/jobsss-adapters.test.mjs',
  'tests/jobsss-authority.test.mjs',
  'tests/jobsss-cross-platform.test.mjs',
]);

let cachedEvidence;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredFile(abs, label = abs) {
  assert.equal(existsSync(abs), true, `missing ${label}: ${abs}`);
  return readFileSync(abs);
}

function readJson(abs, label = abs) {
  let parsed;
  try {
    parsed = JSON.parse(requiredFile(abs, label).toString('utf8'));
  } catch (error) {
    throw new Error(`invalid JSON in ${label}: ${error.message}`);
  }
  return parsed;
}

function confined(root, declared, label) {
  assert.equal(typeof declared, 'string', `${label} must be a string`);
  assert.ok(declared.length > 0, `${label} must not be empty`);
  assert.equal(path.isAbsolute(declared), false, `${label} must be relative`);
  const abs = path.resolve(root, declared);
  assert.ok(
    abs.startsWith(`${path.resolve(root)}${path.sep}`),
    `${label} escapes evidence root: ${declared}`,
  );
  return abs;
}

function parseJsonl(abs) {
  const lines = requiredFile(abs, abs).toString('utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  assert.ok(lines.length > 0, `empty transcript: ${abs}`);
  let previousSeq = null;
  return lines.map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${abs}:${index + 1}: invalid JSON: ${error.message}`);
    }
    assert.equal(typeof value, 'object', `${abs}:${index + 1}: record must be an object`);
    assert.equal(Array.isArray(value), false, `${abs}:${index + 1}: record must not be an array`);
    assert.equal(typeof value.seq, 'number', `${abs}:${index + 1}: seq must be numeric`);
    assert.equal(typeof value.tool, 'string', `${abs}:${index + 1}: tool must be a string`);
    assert.equal(typeof value.arguments, 'object', `${abs}:${index + 1}: arguments must be an object`);
    assert.equal(Array.isArray(value.arguments), false, `${abs}:${index + 1}: arguments must not be an array`);
    assert.equal(typeof value.result, 'object', `${abs}:${index + 1}: result must be an object`);
    assert.equal(Array.isArray(value.result), false, `${abs}:${index + 1}: result must not be an array`);
    if (previousSeq != null) {
      assert.ok(value.seq > previousSeq, `${abs}:${index + 1}: seq must increase`);
    }
    previousSeq = value.seq;
    return value;
  });
}

function successful(call, label) {
  assert.ok(call, `missing call: ${label}`);
  assert.equal(call.result?.ok === false, false, `${label} returned ok:false`);
  assert.equal(Boolean(call.result?.error), false, `${label} returned an error`);
  assert.equal(Boolean(call.result?.isError), false, `${label} returned isError`);
  return call.result;
}

function norm(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9+%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function words(value) {
  return norm(value).split(' ').filter(Boolean);
}

function numbers(value) {
  return new Set(String(value || '').match(/\b\d+(?:[.,]\d+)?%?\+?\b/g) || []);
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const union = new Set([...A, ...B]);
  if (!union.size) return 1;
  let intersection = 0;
  for (const value of A) if (B.has(value)) intersection += 1;
  return intersection / union.size;
}

function command(name, args, options = {}) {
  try {
    return execFileSync(name, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    const stdout = String(error?.stdout || '').trim();
    throw new Error(
      `${name} failed: ${stderr || stdout || error.message}`,
    );
  }
}

function pdfText(abs) {
  return command(process.env.PDFTOTEXT || 'pdftotext', ['-layout', abs, '-']);
}

function pdfInfo(abs) {
  const raw = command(process.env.PDFINFO || 'pdfinfo', [abs]);
  return Object.fromEntries(
    raw.split(/\r?\n/)
      .map(line => line.match(/^([^:]+):\s*(.*)$/))
      .filter(Boolean)
      .map(match => [match[1].trim().toLowerCase(), match[2].trim()]),
  );
}

function decodeXml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function bbox(abs) {
  const xml = command(process.env.PDFTOTEXT || 'pdftotext', ['-bbox-layout', abs, '-']);
  const pages = [];

  for (const pageMatch of xml.matchAll(
    /<page\b[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*>([\s\S]*?)<\/page>/g,
  )) {
    const page = {
      width: Number(pageMatch[1]),
      height: Number(pageMatch[2]),
      words: [],
    };

    for (const match of pageMatch[3].matchAll(
      /<word\b[^>]*xMin="([^"]+)"[^>]*yMin="([^"]+)"[^>]*xMax="([^"]+)"[^>]*yMax="([^"]+)"[^>]*>([\s\S]*?)<\/word>/g,
    )) {
      page.words.push({
        x1: Number(match[1]),
        y1: Number(match[2]),
        x2: Number(match[3]),
        y2: Number(match[4]),
        text: decodeXml(match[5]),
      });
    }
    pages.push(page);
  }

  assert.ok(pages.length > 0, `pdftotext produced no page geometry for ${abs}`);
  assert.ok(pages.every(page => page.words.length > 0), `empty PDF page geometry: ${abs}`);
  return pages;
}

function verticalFill(page) {
  const min = Math.min(...page.words.map(word => word.y1));
  const max = Math.max(...page.words.map(word => word.y2));
  return (max - min) / page.height;
}

function geometrySignature(pages) {
  const payload = pages.map(page => ({
    width: Math.round(page.width),
    height: Math.round(page.height),
    words: page.words.map(word => [
      Math.round(word.x1 * 2) / 2,
      Math.round(word.y1 * 2) / 2,
      Math.round(word.x2 * 2) / 2,
      Math.round(word.y2 * 2) / 2,
    ]),
  }));
  return sha256(Buffer.from(JSON.stringify(payload)));
}

function pngDimensions(abs) {
  const bytes = requiredFile(abs, abs);
  assert.ok(bytes.length > 24, `PNG is too short: ${abs}`);
  assert.equal(
    bytes.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    `not a PNG: ${abs}`,
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function rasterizePageOne(pdf) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobsss-jr-raster-'));
  const prefix = path.join(dir, 'page');
  try {
    command(process.env.PDFTOPPM || 'pdftoppm', [
      '-f', '1',
      '-singlefile',
      '-png',
      pdf,
      prefix,
    ]);
    return readFileSync(`${prefix}.png`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function overlappingWords(page) {
  let overlaps = 0;
  for (let i = 0; i < page.words.length; i += 1) {
    const a = page.words[i];
    for (let j = i + 1; j < page.words.length; j += 1) {
      const b = page.words[j];
      const x = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      const y = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
      if (x > 0.75 && y > 0.75) overlaps += 1;
    }
  }
  return overlaps;
}

function artifactFor(store, entry) {
  const artifact = store.artifacts?.[entry.artifactId];
  assert.ok(artifact, `missing artifact ${entry.artifactId}`);
  assert.equal(artifact.jobId, entry.jobId, `${entry.artifactId}: wrong job ownership`);
  assert.equal(artifact.kind, 'resume_draft', `${entry.artifactId}: not a resume draft`);
  assert.equal(artifact.format, 'pdf', `${entry.artifactId}: not PDF`);
  assert.equal(artifact.export?.style, entry.style, `${entry.artifactId}: wrong style`);
  return artifact;
}

function selectedBullets(source, text) {
  const haystack = norm(text);
  return source.bullets
    .map((bullet, index) => ({ index, bullet }))
    .filter(item => haystack.includes(norm(item.bullet)));
}

function strippedTailoringText(text) {
  return norm(
    String(text)
      .split(/\r?\n/)
      .filter(line => !/^\s*Focus:/i.test(line))
      .filter(line => !/@|linkedin\.com/i.test(line))
      .join('\n'),
  );
}

function loadEvidence() {
  if (cachedEvidence) return cachedEvidence;

  const manifestPath = path.join(EVIDENCE_ROOT, 'manifest.json');
  const manifest = readJson(manifestPath, 'manifest.json');
  assert.equal(manifest.schemaVersion, 1, 'manifest.schemaVersion must be 1');
  assert.equal(manifest.candidateCommit, EXPECTED_COMMIT, 'wrong candidate commit');
  assert.equal(typeof manifest.implementer, 'string', 'manifest.implementer is required');
  assert.ok(manifest.implementer.trim(), 'manifest.implementer must not be empty');
  assert.equal(manifest.independentReviewer?.role, 'independent-scorer');
  assert.ok(manifest.independentReviewer?.name, 'independent reviewer name is required');
  assert.equal(manifest.journeyOperators?.length, 3, 'three journey operators are required');
  assert.equal(new Set(manifest.journeyOperators).size, 3, 'journey operators must differ');

  const excludedReviewers = new Set([
    manifest.implementer,
    ...manifest.journeyOperators,
  ].map(value => norm(value)));
  assert.equal(
    excludedReviewers.has(norm(manifest.independentReviewer.name)),
    false,
    'independent reviewer must differ from implementer and journey operators',
  );

  assert.equal(Array.isArray(manifest.lanes), true, 'manifest.lanes must be an array');
  assert.equal(manifest.lanes.length, 3, 'exactly three lanes are required');
  assert.deepEqual(
    [...manifest.lanes.map(lane => lane.key)].sort(),
    Object.keys(SOURCES).sort(),
    'lane keys must be maya, deshawn, and aisha',
  );

  const seenPdfPaths = new Set();
  const lanes = manifest.lanes.map(lane => {
    const source = SOURCES[lane.key];
    assert.equal(lane.name, source.name, `${lane.key}: wrong name`);
    assert.equal(Array.isArray(lane.jobs), true, `${lane.key}: jobs must be an array`);
    assert.equal(lane.jobs.length, 2, `${lane.key}: exactly two jobs are required`);

    const pluginData = confined(EVIDENCE_ROOT, lane.pluginData, `${lane.key}.pluginData`);
    const transcriptPath = confined(EVIDENCE_ROOT, lane.transcript, `${lane.key}.transcript`);
    const storePath = path.join(pluginData, 'store.json');
    const store = readJson(storePath, `${lane.key} store`);
    const calls = parseJsonl(transcriptPath);

    const jobs = lane.jobs.map(entry => {
      assert.ok(STYLES.has(entry.style), `${lane.key}: unsupported style ${entry.style}`);
      const pdf = confined(EVIDENCE_ROOT, entry.pdf, `${lane.key}.pdf`);
      const page1 = confined(EVIDENCE_ROOT, entry.page1, `${lane.key}.page1`);
      assert.equal(seenPdfPaths.has(pdf), false, `PDF reused across entries: ${pdf}`);
      seenPdfPaths.add(pdf);

      const bytes = requiredFile(pdf, pdf);
      assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', `not a PDF: ${pdf}`);
      const digest = sha256(bytes);
      const text = pdfText(pdf);
      const info = pdfInfo(pdf);
      const pages = bbox(pdf);
      const artifact = artifactFor(store, entry);

      assert.equal(artifact.export?.sha256, digest, `${entry.artifactId}: copied PDF SHA mismatch`);
      return {
        ...entry,
        pdf,
        page1,
        bytes,
        sha: digest,
        text,
        info,
        pages,
        artifact,
      };
    });

    return {
      ...lane,
      source,
      pluginData,
      transcriptPath,
      store,
      calls,
      jobs,
    };
  });

  assert.equal(seenPdfPaths.size, 6, 'exactly six unique PDFs are required');
  cachedEvidence = { manifest, lanes };
  return cachedEvidence;
}

function register(id, title, fn, timeout = 180_000) {
  test(`${id} ${title}`, { timeout }, async () => {
    let failure = null;
    try {
      await fn(loadEvidence());
    } catch (error) {
      failure = error;
    }
    console.log(`${id}=${failure ? '0.0' : '9.0'}`);
    if (failure) throw failure;
  });
}

register('JR-J1', 'live ohshi journey flow', ({ lanes }) => {
  for (const lane of lanes) {
    assert.equal(
      lane.calls.some(call => call.tool === 'import_job'),
      false,
      `${lane.key}: import_job is forbidden`,
    );
    assert.deepEqual(
      lane.calls.map(call => call.tool),
      REQUIRED_SEQUENCE,
      `${lane.key}: wrong tool sequence`,
    );

    lane.calls.forEach(call => successful(call, `${lane.key}:${call.tool}`));

    const doctor = lane.calls[0].result;
    assert.equal(doctor.ok, true, `${lane.key}: doctor did not pass`);
    assert.equal(doctor.runtime, 'jobsss-bundled', `${lane.key}: wrong runtime`);

    assert.ok(
      lane.store.audit?.some(event => event.event === 'start'),
      `${lane.key}: start audit event missing`,
    );

    const create = lane.calls.find(call => call.tool === 'create_profile');
    assert.equal(create.arguments.resumeText, lane.source.resumeText, `${lane.key}: resumeText changed`);
    const profileId = create.result.profileId || create.result.id;
    assert.ok(profileId, `${lane.key}: create_profile returned no profile id`);

    const searchCreate = lane.calls.find(call => call.tool === 'create_saved_search');
    assert.equal(searchCreate.arguments.profileId, profileId);
    assert.equal(searchCreate.arguments.adapter, 'ohshi');
    assert.equal(
      Object.hasOwn(searchCreate.arguments.config || {}, 'fixture'),
      false,
      `${lane.key}: fixture-backed search is forbidden`,
    );

    const searchCall = lane.calls.find(call => call.tool === 'search_jobs');
    assert.equal(searchCall.arguments.profileId, profileId);
    assert.ok(
      Number(searchCall.result.counts?.fetched || searchCall.result.jobs?.length || 0) >= 1,
      `${lane.key}: live search returned no jobs`,
    );
    const discoveredIds = new Set(
      (searchCall.result.jobs || searchCall.result.items || [])
        .map(job => job.jobId || job.id)
        .filter(Boolean),
    );

    const saves = lane.calls.filter(call => call.tool === 'save_job');
    const scores = lane.calls.filter(call => call.tool === 'score_job');
    const tailors = lane.calls.filter(call => call.tool === 'tailor_resume');
    assert.equal(saves.length, 2);
    assert.equal(scores.length, 2);
    assert.equal(tailors.length, 2);

    for (const entry of lane.jobs) {
      assert.ok(discoveredIds.has(entry.jobId), `${lane.key}: selected job was not in search_jobs`);
      assert.ok(
        saves.some(call => call.arguments.jobId === entry.jobId),
        `${lane.key}: ${entry.jobId} was not saved`,
      );
      assert.ok(
        scores.some(call => call.arguments.jobId === entry.jobId),
        `${lane.key}: ${entry.jobId} was not scored`,
      );
      assert.ok(
        tailors.some(call => (
          call.arguments.jobId === entry.jobId
          && call.arguments.profileId === profileId
          && call.arguments.format === 'pdf'
          && call.arguments.style === entry.style
        )),
        `${lane.key}: missing PDF tailor call for ${entry.jobId}`,
      );

      const job = lane.store.jobs?.[entry.jobId];
      assert.ok(job, `${lane.key}: missing stored job ${entry.jobId}`);
      assert.equal(job.profileId, profileId);
      assert.equal(job.source, 'ohshi');
      assert.equal(job.discovered, true);
      assert.equal(job.saved, true);
      assert.ok(job.discoveryRunId, `${lane.key}: missing discovery run id`);
      assert.equal(job.liveness?.status, 'active', `${lane.key}: posting is not live`);
      assert.ok(/^https?:\/\//i.test(job.url || ''), `${lane.key}: missing public posting URL`);
      assert.ok(lane.store.scores?.[entry.jobId], `${lane.key}: missing stored score`);
    }
  }
});

register('JR-J2', 'synthetic identity integrity', ({ manifest, lanes }) => {
  const completeEvidence = [
    JSON.stringify(manifest),
    ...lanes.flatMap(lane => [
      JSON.stringify(lane.store),
      readFileSync(lane.transcriptPath, 'utf8'),
      ...lane.jobs.map(job => job.text),
    ]),
  ].join('\n');

  assert.doesNotMatch(completeEvidence, FORBIDDEN);

  for (const lane of lanes) {
    for (const job of lane.jobs) {
      assert.match(job.text, new RegExp(lane.source.name, 'i'));
      assert.match(job.text, new RegExp(lane.source.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      assert.match(job.text, new RegExp(lane.source.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      for (const role of lane.source.roles) {
        assert.match(
          job.text,
          new RegExp(role.employer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        );
      }
    }
  }
});

register('JR-J3', 'chronology and achievement ownership', ({ lanes }) => {
  for (const lane of lanes) {
    for (const job of lane.jobs) {
      const text = norm(job.text);
      assert.equal(text.includes(norm('SELECTED ACHIEVEMENTS')), false);

      for (let index = 0; index < lane.source.roles.length; index += 1) {
        const role = lane.source.roles[index];
        const employerAt = text.indexOf(norm(role.employer));
        const titleAt = text.indexOf(norm(role.title), employerAt);
        const datesAt = text.indexOf(norm(role.dates), titleAt);
        const boundary = index + 1 < lane.source.roles.length
          ? text.indexOf(norm(lane.source.roles[index + 1].employer), datesAt)
          : text.indexOf(norm('EDUCATION'), datesAt);

        assert.ok(employerAt >= 0, `${job.pdf}: missing ${role.employer}`);
        assert.ok(titleAt > employerAt, `${job.pdf}: title is not owned by ${role.employer}`);
        assert.ok(datesAt > titleAt, `${job.pdf}: dates are not owned by ${role.employer}`);
        assert.ok(boundary > datesAt, `${job.pdf}: malformed role boundary`);

        const sourceRoleBullets = index === 0
          ? lane.source.bullets.slice(0, 3)
          : lane.source.bullets.slice(3);
        assert.ok(
          sourceRoleBullets.some(bullet => {
            const at = text.indexOf(norm(bullet), datesAt);
            return at > datesAt && at < boundary;
          }),
          `${job.pdf}: ${role.employer} has no owned source achievement`,
        );
      }

      const educationAt = text.indexOf(norm('EDUCATION'));
      const schoolAt = text.indexOf(norm(lane.source.school), educationAt);
      assert.ok(educationAt >= 0, `${job.pdf}: EDUCATION missing`);
      assert.ok(schoolAt > educationAt, `${job.pdf}: school name missing`);
      assert.equal(
        lane.source.school.includes('@'),
        false,
        `${lane.key}: school oracle must not be an email domain`,
      );
    }
  }
});

register('JR-J4', 'achievement-body tailoring', ({ lanes }) => {
  for (const lane of lanes) {
    const selected = lane.jobs.map(job => selectedBullets(lane.source, job.text));
    assert.ok(selected.every(list => list.length >= 4), `${lane.key}: fewer than four source bullets`);

    const left = selected[0].map(item => item.index);
    const right = selected[1].map(item => item.index);
    const similarity = jaccard(left, right);
    assert.ok(similarity <= 0.80, `${lane.key}: bullet Jaccard ${similarity.toFixed(3)} > 0.80`);
    assert.notDeepEqual([...left].sort(), [...right].sort(), `${lane.key}: identical bullet bodies`);

    assert.notEqual(
      strippedTailoringText(lane.jobs[0].text),
      strippedTailoringText(lane.jobs[1].text),
      `${lane.key}: pair differs only in contact/Focus/layout`,
    );

    const allowedNumbers = numbers(lane.source.resumeText);
    for (const job of lane.jobs) {
      const artifactContent = String(job.artifact.content || '');
      const achievementLines = artifactContent
        .split(/\r?\n/)
        .filter(line => /^\s*[-•]/.test(line));
      for (const token of numbers(achievementLines.join('\n'))) {
        assert.ok(
          allowedNumbers.has(token),
          `${lane.key}: invented achievement metric ${token} in ${job.pdf}`,
        );
      }
    }
  }
});

register('JR-J5', 'two real styles per person', ({ lanes }) => {
  const allStyles = new Set();
  for (const lane of lanes) {
    assert.deepEqual(
      [...lane.jobs.map(job => job.style)].sort(),
      [...lane.source.styles].sort(),
      `${lane.key}: wrong style pair`,
    );
    lane.jobs.forEach(job => allStyles.add(job.style));
    assert.notEqual(lane.jobs[0].sha, lane.jobs[1].sha, `${lane.key}: identical PDF SHA`);
    assert.notEqual(
      geometrySignature(lane.jobs[0].pages),
      geometrySignature(lane.jobs[1].pages),
      `${lane.key}: style pair has identical color-stripped geometry`,
    );
  }
  assert.deepEqual([...allStyles].sort(), ['editorial', 'navy', 'scan']);
});

register('JR-J6', 'ATS-safe PDF mechanics', ({ lanes }) => {
  for (const job of lanes.flatMap(lane => lane.jobs)) {
    const pages = Number(job.info.pages);
    assert.ok(pages === 1 || pages === 2, `${job.pdf}: expected one or two pages`);
    assert.match(job.info['page size'] || '', /612\s+x\s+792|letter/i, `${job.pdf}: not Letter`);
    assert.ok(words(job.text).length > 0, `${job.pdf}: no searchable text`);
    assert.doesNotMatch(job.text, ATS_HOSTILE, `${job.pdf}: ATS-hostile glyph`);
    assert.ok(job.artifact.export?.bodyFontSize >= 10, `${job.pdf}: body font below 10pt`);
    assert.ok(
      ['native', 'tectonic'].includes(job.artifact.export?.engine),
      `${job.pdf}: forbidden or unknown PDF engine`,
    );

    const rendererEvidence = JSON.stringify({
      export: job.artifact.export,
      info: job.info,
    });
    assert.doesNotMatch(rendererEvidence, /chrome|chromium|jobos/i);

    if (pages === 2) {
      const total = job.pages.reduce((sum, page) => sum + page.words.length, 0);
      const last = job.pages.at(-1);
      assert.ok(last.words.length / total >= 0.25, `${job.pdf}: orphan final page`);
      assert.ok(verticalFill(last) >= 0.35, `${job.pdf}: underfilled final page`);
    }
  }
});

register('JR-J7', 'truthful density without padding', ({ lanes }) => {
  for (const lane of lanes) {
    const sourceWords = words(lane.source.resumeText).length;
    for (const job of lane.jobs) {
      const extractedWords = words(job.text).length;
      const artifactWords = words(job.artifact.content).length;
      const pageCount = Number(job.info.pages);

      assert.ok(
        extractedWords >= Math.floor(sourceWords * 0.72),
        `${job.pdf}: ${extractedWords} words is below truthful source band`,
      );
      assert.ok(
        extractedWords <= Math.ceil(sourceWords * 1.20),
        `${job.pdf}: ${extractedWords} words exceeds truthful source band`,
      );

      const agreement = extractedWords / Math.max(artifactWords, 1);
      assert.ok(
        agreement >= 0.90 && agreement <= 1.10,
        `${job.pdf}: PDF/artifact word disagreement ${agreement.toFixed(3)}`,
      );

      if (pageCount === 1) {
        assert.ok(
          verticalFill(job.pages[0]) >= 0.80,
          `${job.pdf}: fill ${verticalFill(job.pages[0]).toFixed(3)} < 0.80`,
        );
      } else {
        const total = job.pages.reduce((sum, page) => sum + page.words.length, 0);
        const last = job.pages.at(-1);
        assert.ok(last.words.length / total >= 0.25, `${job.pdf}: orphan final page`);
        assert.ok(verticalFill(last) >= 0.35, `${job.pdf}: sparse final page`);
      }

      const sourceTokenSet = new Set(words(lane.source.resumeText));
      const contentWithoutFocus = String(job.artifact.content || '')
        .split(/\r?\n/)
        .filter(line => !/^\s*Focus:/i.test(line))
        .join('\n');
      const contentTokens = words(contentWithoutFocus)
        .filter(token => !['experience', 'education', 'skills'].includes(token));
      const grounded = contentTokens.filter(token => sourceTokenSet.has(token)).length
        / Math.max(contentTokens.length, 1);
      assert.ok(grounded >= 0.95, `${job.pdf}: source grounding ${grounded.toFixed(3)} < 0.95`);
    }
  }
});

register('JR-J8', 'visual recruiter UX', ({ manifest, lanes }) => {
  for (const job of lanes.flatMap(lane => lane.jobs)) {
    const supplied = pngDimensions(job.page1);
    const regenerated = rasterizePageOne(job.pdf);
    const regeneratedPath = path.join(
      mkdtempSync(path.join(tmpdir(), 'jobsss-jr-png-')),
      'page.png',
    );

    try {
      const header = regenerated;
      assert.equal(header.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      assert.equal(supplied.width, width, `${job.page1}: raster width mismatch`);
      assert.equal(supplied.height, height, `${job.page1}: raster height mismatch`);
    } finally {
      rmSync(path.dirname(regeneratedPath), { recursive: true, force: true });
    }

    assert.equal(overlappingWords(job.pages[0]), 0, `${job.pdf}: overlapping word boxes`);
    assert.doesNotMatch(job.text, /\[[^\]]+\]\(https?:\/\/[^)]+\)/i);

    const review = manifest.visualReview?.[job.artifactId];
    assert.ok(review, `${job.artifactId}: missing independent visual review`);
    assert.equal(review.sha256, job.sha, `${job.artifactId}: visual review SHA mismatch`);
    for (const field of [
      'recruiterReadable',
      'oneColumn',
      'clearHierarchy',
      'sectionStructure',
      'noOverlap',
      'noMarkdownLinks',
    ]) {
      assert.equal(review[field], true, `${job.artifactId}: visual review failed ${field}`);
    }
  }
});

register('JR-J9', 'three isolated stores', ({ lanes }) => {
  const dataPaths = lanes.map(lane => realpathSync(lane.pluginData));
  assert.equal(new Set(dataPaths).size, 3, 'PLUGIN_DATA directories are shared');

  const profileIds = [];
  const globalJobIds = new Set();
  const globalArtifactIds = new Set();

  for (const lane of lanes) {
    const profiles = Object.values(lane.store.profiles || {});
    assert.equal(profiles.length, 1, `${lane.key}: store must contain exactly one profile`);
    const profile = profiles[0];
    assert.equal(profile.name, lane.source.name, `${lane.key}: wrong stored profile`);
    profileIds.push(profile.id);

    for (const record of Object.values(lane.store.searches || {})) {
      assert.equal(record.profileId, profile.id, `${lane.key}: cross-profile search`);
    }
    for (const record of Object.values(lane.store.jobs || {})) {
      assert.equal(record.profileId, profile.id, `${lane.key}: cross-profile job`);
    }
    for (const record of Object.values(lane.store.artifacts || {})) {
      assert.equal(record.profileId, profile.id, `${lane.key}: cross-profile artifact`);
    }

    for (const entry of lane.jobs) {
      assert.equal(globalJobIds.has(entry.jobId), false, `job id shared across lanes: ${entry.jobId}`);
      assert.equal(
        globalArtifactIds.has(entry.artifactId),
        false,
        `artifact id shared across lanes: ${entry.artifactId}`,
      );
      globalJobIds.add(entry.jobId);
      globalArtifactIds.add(entry.artifactId);
    }

    const first = lane.store.jobs[lane.jobs[0].jobId];
    const second = lane.store.jobs[lane.jobs[1].jobId];
    assert.notEqual(
      `${norm(first.company)}|${norm(first.title)}`,
      `${norm(second.company)}|${norm(second.title)}`,
      `${lane.key}: selected jobs have the same company and title`,
    );
  }

  assert.equal(new Set(profileIds).size, 3, 'profile IDs are shared across lanes');
});

register('JR-J10', 'frozen AGENTS.md suite', () => {
  const run = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...FROZEN_SUITE],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    },
  );

  assert.equal(run.error, undefined, `frozen suite could not run: ${run.error?.message}`);
  assert.equal(
    run.status,
    0,
    `frozen suite failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
}, 620_000);
