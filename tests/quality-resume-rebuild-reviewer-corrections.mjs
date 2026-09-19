import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildConformanceBundle,
  checkCriterion,
  cloneBundle,
  extractPdf,
  normalizeText,
  parseFonts,
  sha256,
} from './helpers/resume-rebuild-checks.mjs';

const VALID_HASH = 'a'.repeat(64);

function criterion(id, artifact) {
  return checkCriterion(id, { artifacts: { [artifact.label]: artifact } });
}

function asPopplerExtraction(extraction, renderId) {
  const copy = cloneBundle(extraction);
  copy.source = 'poppler';
  copy.pages = copy.pages.map(page => ({
    ...page,
    blocks: (page.blocks || []).map(block => ({
      ...block,
      nodeId: null,
      words: (block.words || []).map(word => ({ ...word, nodeId: null })),
    })),
  }));
  copy.words = copy.pages.flatMap(page => page.blocks.flatMap(block => block.words || []));
  copy.blocks = copy.pages.flatMap(page => page.blocks);
  copy.generatedPage1Hash = VALID_HASH;
  copy.page1ProbeExitCode = 0;
  copy.page1ProbeStderr = '';
  copy.suppliedPage1 = 'design-a/renders/' + renderId + '-page1.png';
  copy.suppliedPage1Hash = VALID_HASH;
  copy.page1Validation = {
    required: true,
    ok: true,
    reason: 'ok',
    probeExitCode: 0,
    generatedHash: VALID_HASH,
    suppliedPath: copy.suppliedPage1,
    suppliedHash: VALID_HASH,
  };
  return copy;
}

function makeRealShapedArtifact() {
  const conformance = buildConformanceBundle();
  const artifact = cloneBundle(conformance.artifacts.A);
  artifact.synthetic = false;
  for (const [renderId, evidence] of Object.entries(artifact.renderEvidence)) {
    evidence.extraction = asPopplerExtraction(evidence.extraction, renderId);
  }
  return artifact;
}

function reflowPage(rows, pageNumber) {
  const width = 612;
  const height = 792;
  const spacing = rows.length > 1 ? 730 / (rows.length - 1) : 15;
  const blocks = rows.map((row, index) => {
    const y = 21 + index * spacing;
    const words = (row.words || []).map(word => ({
      ...word,
      y,
      page: pageNumber,
      nodeId: null,
    }));
    return {
      nodeId: null,
      text: row.text,
      page: pageNumber,
      y,
      words,
    };
  });
  return { number: pageNumber, width, height, blocks };
}

function makeTwoPageOrphanArtifact() {
  const artifact = makeRealShapedArtifact();
  const extraction = artifact.renderEvidence.primary.extraction;
  const rows = extraction.pages[0].blocks;
  const pageOneRows = rows.slice(0, 34);
  const pageTwoRows = rows.slice(34);
  const headingIndex = pageOneRows.findIndex(row => normalizeText(row.text) === 'experience');
  assert.notEqual(headingIndex, -1, 'real-shaped fixture must contain an EXPERIENCE row');
  const [heading] = pageOneRows.splice(headingIndex, 1);
  pageOneRows.push(heading);
  extraction.pages = [reflowPage(pageOneRows, 1), reflowPage(pageTwoRows, 2)];
  extraction.words = extraction.pages.flatMap(page => page.blocks.flatMap(block => block.words));
  extraction.blocks = extraction.pages.flatMap(page => page.blocks);
  extraction.text = extraction.blocks.map(block => block.text).join('\n');
  return artifact;
}

function installPageOneEvidence(artifact, extraction) {
  const target = artifact.renderEvidence.primary.extraction;
  Object.assign(target, {
    generatedPage1Hash: extraction.generatedPage1Hash,
    page1ProbeExitCode: extraction.page1ProbeExitCode,
    page1ProbeStderr: extraction.page1ProbeStderr,
    suppliedPage1: extraction.suppliedPage1,
    suppliedPage1Hash: extraction.suppliedPage1Hash,
    page1Validation: extraction.page1Validation,
  });
}

function fakeCommandSource(kind) {
  if (kind === 'pdfinfo') return [
    '#!/usr/bin/env node',
    "process.stdout.write('Pages: 1\\nPage size: 612 x 792 pts\\n');",
  ].join('\n') + '\n';
  if (kind === 'pdftotext') return [
    '#!/usr/bin/env node',
    "if (process.argv.includes('-bbox')) process.stdout.write('<doc><page width=\"612\" height=\"792\"><word xMin=\"42\" yMin=\"42\" xMax=\"70\" yMax=\"52\">Example</word></page></doc>');",
    "else process.stdout.write('Example\\n');",
  ].join('\n') + '\n';
  if (kind === 'pdffonts') return [
    '#!/usr/bin/env node',
    "process.stdout.write('name type encoding emb sub uni object ID\\n------------------------------------ ----------------- --- --- --- ---------\\nCustomSans Type 1 Identity-H yes no yes 1 0\\n');",
  ].join('\n') + '\n';
  return [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    "if (process.env.FAKE_PDFTOPPM_FAIL === '1') { process.stderr.write('probe failed\\n'); process.exit(17); }",
    "const base = process.argv[process.argv.length - 1];",
    "writeFileSync(base + '.png', Buffer.from(process.env.FAKE_PDFTOPPM_BYTES || 'generated-page-one'));",
  ].join('\n') + '\n';
}

function runFakePoppler({ generatedBytes = 'generated-page-one', suppliedBytes = generatedBytes, writeSupplied = true, failPpm = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'resume-rebuild-correction-poppler-'));
  const pdfPath = path.join(root, 'resume.pdf');
  const page1Path = path.join(root, 'primary-page1.png');
  writeFileSync(pdfPath, Buffer.from('fake-pdf'));
  if (writeSupplied) writeFileSync(page1Path, Buffer.from(suppliedBytes));
  const commandFiles = {
    PDFINFO: path.join(root, 'pdfinfo'),
    PDFTOTEXT: path.join(root, 'pdftotext'),
    PDFFONTS: path.join(root, 'pdffonts'),
    PDFTOPPM: path.join(root, 'pdftoppm'),
  };
  for (const [envName, commandPath] of Object.entries(commandFiles)) {
    const kind = envName.toLowerCase();
    writeFileSync(commandPath, fakeCommandSource(kind));
    chmodSync(commandPath, 0o755);
  }
  const envNames = [...Object.keys(commandFiles), 'FAKE_PDFTOPPM_BYTES', 'FAKE_PDFTOPPM_FAIL'];
  const previous = new Map(envNames.map(name => [name, process.env[name]]));
  try {
    for (const [envName, commandPath] of Object.entries(commandFiles)) process.env[envName] = commandPath;
    process.env.FAKE_PDFTOPPM_BYTES = generatedBytes;
    process.env.FAKE_PDFTOPPM_FAIL = failPpm ? '1' : '0';
    return extractPdf(pdfPath, { page1Path });
  } finally {
    for (const name of envNames) {
      if (previous.get(name) === undefined) delete process.env[name];
      else process.env[name] = previous.get(name);
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function makeFontArtifact(fonts) {
  const artifact = makeRealShapedArtifact();
  const root = mkdtempSync(path.join(tmpdir(), 'resume-rebuild-correction-fonts-'));
  for (const render of artifact.manifest.renders) {
    const evidence = artifact.renderEvidence[render.renderId];
    const pdfPath = path.join(root, render.renderId + '.pdf');
    const latexPath = path.join(root, render.renderId + '.tex');
    const logPath = path.join(root, render.renderId + '.log');
    const probePath = path.join(root, render.renderId + '-unavailable-probe.txt');
    writeFileSync(pdfPath, Buffer.from('fake-pdf'));
    writeFileSync(latexPath, '\\documentclass{article}\\begin{document}Example\\end{document}\\n');
    writeFileSync(logPath, 'engine: tectonic 0.15.0\\nexit code: 0\\n');
    writeFileSync(probePath, 'typed prerequisite failure: missing tectonic/font prerequisite; no partial artifact\\n');
    Object.assign(evidence, {
      filePath: pdfPath,
      latexSourcePath: latexPath,
      logPath,
      unavailableProbePath: probePath,
      logText: 'engine: tectonic 0.15.0\\nexit code: 0\\n',
    });
    evidence.extraction.fonts = cloneBundle(fonts);
    evidence.extraction.nativeText = true;
    render.fontClosure = fonts.map(font => font.name);
  }
  return { artifact, root };
}

test('RR-11 accepts Poppler-shaped rows with null nodeIds when no heading is orphaned', () => {
  const artifact = makeRealShapedArtifact();
  assert.equal(artifact.renderEvidence.primary.extraction.blocks.every(block => block.nodeId === null), true);
  const verdict = criterion('RR-11', artifact);
  assert.equal(verdict.ok, true, verdict.problems.join('; '));
});

test('RR-11 detects a real-shaped null-nodeId section heading left as the last row of a non-final page', () => {
  const artifact = makeTwoPageOrphanArtifact();
  const extraction = artifact.renderEvidence.primary.extraction;
  assert.equal(extraction.blocks.every(block => block.nodeId === null), true);
  assert.equal(extraction.pages[0].blocks.at(-1).text, 'EXPERIENCE');
  const verdict = criterion('RR-11', artifact);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /orphan heading/i);
});

test('C12 matching supplied page-one PNG is hash-bound and surfaced as reviewer evidence', () => {
  const extraction = runFakePoppler();
  assert.equal(extraction.page1Validation.ok, true);
  assert.equal(extraction.suppliedPage1Hash, extraction.generatedPage1Hash);
  const artifact = makeRealShapedArtifact();
  installPageOneEvidence(artifact, extraction);
  const verdict = criterion('RR-11', artifact);
  assert.equal(verdict.ok, true, verdict.problems.join('; '));
  assert.equal(verdict.details.perArtifact[0].details.pageOne[0].ok, true);
});

test('C12 stale supplied page-one PNG fails RR-11 with the mismatch surfaced', () => {
  const extraction = runFakePoppler({ suppliedBytes: 'stale-page-one' });
  assert.equal(extraction.page1Validation.ok, false);
  assert.notEqual(extraction.suppliedPage1Hash, extraction.generatedPage1Hash);
  const artifact = makeRealShapedArtifact();
  installPageOneEvidence(artifact, extraction);
  const verdict = criterion('RR-11', artifact);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /supplied page-one PNG hash does not match regenerated/i);
});

test('C12 missing supplied page-one PNG fails RR-11', () => {
  const extraction = runFakePoppler({ writeSupplied: false });
  assert.equal(extraction.page1Validation.ok, false);
  assert.equal(extraction.suppliedPage1Hash, null);
  const artifact = makeRealShapedArtifact();
  installPageOneEvidence(artifact, extraction);
  const verdict = criterion('RR-11', artifact);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /supplied page-one PNG is missing or unreadable/i);
});

test('C12 failed PDFTOPPM probe is an explicit RR-11 failure', () => {
  const extraction = runFakePoppler({ failPpm: true });
  assert.equal(extraction.page1Validation.ok, false);
  assert.equal(extraction.page1ProbeExitCode, 17);
  const artifact = makeRealShapedArtifact();
  installPageOneEvidence(artifact, extraction);
  const verdict = criterion('RR-11', artifact);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /PDFTOPPM probe failed with exit code 17/i);
});

test('pdffonts parser retains representative names, type, and emb metadata', () => {
  const parsed = parseFonts([
    'name type encoding emb sub uni object ID',
    '------------------------------------ ----------------- --- --- --- ---------',
    'ABCDEF+CustomSans CID TrueType Identity-H yes yes yes 12 0',
    'Helvetica Type 1 WinAnsi no no no 13 0',
  ].join('\n'));
  assert.deepEqual(parsed.map(font => ({ name: font.name, type: font.type, encoding: font.encoding, emb: font.emb, sub: font.sub, uni: font.uni })), [
    { name: 'ABCDEF+CustomSans', type: 'CID TrueType', encoding: 'Identity-H', emb: 'yes', sub: 'yes', uni: 'yes' },
    { name: 'Helvetica', type: 'Type 1', encoding: 'WinAnsi', emb: 'no', sub: 'no', uni: 'no' },
  ]);
});

test('RR-13 rejects an unembedded non-standard font on a real-shaped extraction', () => {
  const fonts = [
    { name: 'CustomSans', type: 'Type 1', emb: 'no', sub: 'no', uni: 'yes', objectId: '1 0' },
    { name: 'Helvetica', type: 'Type 1', emb: 'no', sub: 'no', uni: 'no', objectId: '2 0' },
  ];
  const { artifact, root } = makeFontArtifact(fonts);
  try {
    const verdict = criterion('RR-13', artifact);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /CustomSans.*not embedded/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('RR-13 accepts an embedded non-standard font and an unembedded standard font', () => {
  const fonts = [
    { name: 'CustomSans', type: 'Type 1', emb: 'yes', sub: 'no', uni: 'yes', objectId: '1 0' },
    { name: 'Helvetica', type: 'Type 1', emb: 'no', sub: 'no', uni: 'no', objectId: '2 0' },
  ];
  const { artifact, root } = makeFontArtifact(fonts);
  try {
    const verdict = criterion('RR-13', artifact);
    assert.equal(verdict.ok, true, verdict.problems.join('; '));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

