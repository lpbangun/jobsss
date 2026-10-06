import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_EVIDENCE_ROOT = '/home/logani/oprun-evidence/jobsss-fake-journey-2026-09-16/resume-rebuild';
export const EVIDENCE_ROOT = path.resolve(process.env.RESUME_REBUILD_EVIDENCE || DEFAULT_EVIDENCE_ROOT);

export const CRITERION_IDS = Object.freeze(Array.from({ length: 14 }, (_, index) => `RR-${String(index + 1).padStart(2, '0')}`));
export const MACHINE_CRITERION_IDS = Object.freeze(CRITERION_IDS.slice(0, 13));
export const NEGATIVE_IDS = Object.freeze(Array.from({ length: 8 }, (_, index) => `RR-N${index + 1}`));
export const HOSTILE_GLYPHS = /[\u00a0\u200b-\u200f\u202a-\u202e\u2060\ufb00-\ufb06\ufffd\0]/u;
export const METRIC_ATOM_RE = /[$]?\d[\d.,]*(?:ms|s|x|%|K|M|\+)?/gi;
export const OUTCOME_RE = /\b(?:fell|dropped|reduced|improved|climbed|cut|grew|increased|closed|adopted|reached|eliminated)\b/i;
export const TRANSFORMATIONS = new Set([
  'verbatim',
  'shortened',
  'compressed',
  'reordered',
  'grammar_only',
  'punctuation_normalization',
]);
const STANDARD_PDF_FONTS = new Set([
  'Courier',
  'Courier-Bold',
  'Courier-BoldOblique',
  'Courier-Oblique',
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-BoldOblique',
  'Helvetica-Oblique',
  'Symbol',
  'Times-Bold',
  'Times-BoldItalic',
  'Times-Italic',
  'Times-Roman',
  'ZapfDingbats',
]);
export const CLAIM_STATUSES = new Set(['active', 'insufficient_evidence', 'rejected', 'needs_human_review']);
export const CONTENT_NODE_TYPES = new Set(['achievement', 'skill', 'project_item', 'education', 'project']);
export const REQUIRED_NODE_TYPES = new Set([
  'name',
  'contact',
  'section_heading',
  'summary',
  'role',
  'achievement',
  'education',
  'skills_group',
  'skill',
  'project',
  'project_item',
]);
export const HEADING_VOCABULARY = new Set(['SUMMARY', 'PROFILE', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'PROJECTS', 'CERTIFICATIONS']);
export const SECTIONS = Object.freeze(['SUMMARY', 'EXPERIENCE', 'PROJECTS', 'CERTIFICATIONS', 'EDUCATION', 'SKILLS']);
export const FUNCTION_WORDS = new Set(`a an and are as at be been being by can for from had has have he her his how i if in into is it its me more my no not of on or our she than that the their them then there these they this those to under was we were what when which who with without you your across after all also both but do does down during each few first four further here how however just less many may might most other over own same some such too very will would through within year years per used now present remote hybrid onsite`.split(/\s+/));
export const FORBIDDEN_IDENTITY_RE = /Logani|loganibangun|gse\.harvard\.edu|Underscoring|Indofood|Musim Mas/i;
export const FORBIDDEN_SURFACES = Object.freeze({
  A: Object.freeze([/\bhalcyon\b/i, /\bhalcyon grid\b/i, /\bprincipal platform engineer\b/i, /\bfedramp\b/i, /\bsoc[ -]?2\b/i]),
  B: Object.freeze([/\baurelia\b/i, /\baurelia health\b/i, /\bsenior product designer\b/i, /\bswift\b/i, /\bkotlin\b/i]),
});
export const GENERIC_METADATA_RE = /^\s*(?:Focus|Target|Tailored for|Prepared for)\b|insufficient evidence|human review|proof point|requirement id|coverage gap/i;

const POPPLER_DEFAULTS = Object.freeze({
  PDFTOTEXT: '/home/logani/.local/share/poppler-env/bin/pdftotext',
  PDFINFO: '/home/logani/.local/share/poppler-env/bin/pdfinfo',
  PDFTOPPM: '/home/logani/.local/share/poppler-env/bin/pdftoppm',
  PDFFONTS: '/home/logani/.local/share/poppler-env/bin/pdffonts',
});

const KEYED_REQUIREMENTS = Object.freeze({
  A: Object.freeze([
    { id: 'A-MH1', kind: 'must', groups: [/\bkubernetes\b/i], text: 'Own and evolve our Kubernetes platform for 60+ services across two regions.' },
    { id: 'A-MH2', kind: 'must', groups: [/\bslos?\b/i, /\bincident/i], text: 'Define SLOs and lead incident response for the reliability program.' },
    { id: 'A-MH3', kind: 'must', groups: [/\bterraform\b/i], text: 'Manage infrastructure as code with Terraform and keep environments reproducible.' },
    { id: 'A-MH4', kind: 'must', groups: [/\bcost\b/i], text: 'Drive cloud cost efficiency across engineering teams.' },
    { id: 'A-MH5', kind: 'must', groups: [/\bmentor/i], text: 'Mentor senior engineers and partner with product groups.' },
    { id: 'A-S1', kind: 'unsupported', groups: [/\bfedramp\b/i, /\bsoc[ -]?2\b/i], text: 'FedRAMP compliance audit experience is required for our utility customers.' },
    { id: 'A-P1', kind: 'preferred', groups: [/\bkafka\b/i], text: 'Managed Kafka experience.' },
    { id: 'A-P2', kind: 'preferred', groups: [/\bobservability\b/i, /\bdashboard/i], text: 'Observability dashboards and alerting.' },
    { id: 'A-P3', kind: 'preferred', groups: [/\bcloud cost\b/i, /\bcost program/i], text: 'Public cloud cost programs.' },
  ]),
  B: Object.freeze([
    { id: 'B-MH1', kind: 'must', groups: [/\bdesign systems?\b/i], text: 'Own the design system and scale it across the product.' },
    { id: 'B-MH2', kind: 'must', groups: [/\bwcag\b/i, /\baccessibility\b/i], text: 'Raise accessibility quality toward WCAG compliance in every release.' },
    { id: 'B-MH3', kind: 'must', groups: [/\busability\b/i, /\bresearch\b/i], text: 'Run research and usability testing with clinicians and patients.' },
    { id: 'B-MH4', kind: 'must', groups: [/\bengineering\b/i], text: 'Partner closely with engineering on component delivery.' },
    { id: 'B-MH5', kind: 'must', groups: [/\bmentor/i, /\bmentorship\b/i], text: 'Guide designers through critique and mentorship.' },
    { id: 'B-S1', kind: 'unsupported', groups: [/\bswift\b/i, /\bkotlin\b/i], text: 'Native mobile development experience (Swift or Kotlin) is required for our patient app.' },
    { id: 'B-P1', kind: 'preferred', groups: [/\bstorybook\b/i], text: 'Storybook documentation.' },
    { id: 'B-P2', kind: 'preferred', groups: [/\bcritique\b/i], text: 'Design critique facilitation.' },
    { id: 'B-P3', kind: 'preferred', groups: [/\bframer\b/i, /\bprototyping\b/i], text: 'Prototyping tools like Framer or After Effects.' },
  ]),
});

function result(ok, problems = [], details = {}) {
  return { ok: Boolean(ok) && problems.length === 0, problems, details };
}

function fail(message) {
  return String(message);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function hashJson(value) {
  return sha256(stableStringify(value));
}

export function cloneBundle(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value) {
  return [...normalizeText(value).matchAll(/[a-z0-9][a-z0-9+%._-]*/g)]
    .map(match => match[0].replace(/[._-]+$/, ''))
    .filter(Boolean);
}

export function metricAtoms(value) {
  return String(value ?? '').match(METRIC_ATOM_RE) || [];
}

function normalizedMetricAtoms(value) {
  return metricAtoms(value).map(atom => normalizeText(atom));
}

function wordCount(value) {
  return tokenize(value).length;
}

function firstToken(value) {
  return tokenize(value)[0] || '';
}

function unique(values) {
  return [...new Set(values)];
}

function fontName(font) {
  return typeof font === "string" ? font : String(font?.name || "");
}

function fontNames(fonts) {
  return (fonts || []).map(fontName).filter(Boolean);
}

function isStandardPdfFont(name) {
  return STANDARD_PDF_FONTS.has(String(name).replace(/^[A-Z]{6}\+/, ""));
}

function setIncludesAll(haystack, values) {
  const set = haystack instanceof Set ? haystack : new Set(haystack);
  return values.every(value => set.has(value));
}

function isHexHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function confined(root, declared, label) {
  if (typeof declared !== 'string' || !declared || path.isAbsolute(declared)) throw new Error(`${label} must be a non-empty relative path`);
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, declared);
  if (abs !== rootAbs && !abs.startsWith(`${rootAbs}${path.sep}`)) throw new Error(`${label} escapes ${rootAbs}: ${declared}`);
  return abs;
}

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function profileInfo(profileText) {
  const lines = String(profileText).replace(/\r\n/g, '\n').split('\n');
  const name = lines[0]?.trim() || '';
  const contact = lines[1]?.trim() || '';
  const experienceIndex = lines.findIndex(line => line.trim() === 'EXPERIENCE');
  const projectIndex = lines.findIndex(line => line.trim() === 'PROJECTS');
  const educationIndex = lines.findIndex(line => line.trim() === 'EDUCATION');
  const skillsIndex = lines.findIndex(line => line.trim() === 'SKILLS');
  const roleEnd = [projectIndex, educationIndex, skillsIndex, lines.length].filter(index => index > experienceIndex).sort((a, b) => a - b)[0] || lines.length;
  const roles = [];
  let current = null;
  for (let index = experienceIndex + 1; index < roleEnd; index += 1) {
    const line = lines[index];
    const roleMatch = line.match(/^(.+?) - (.+)$/);
    const titleMatch = line.match(/^(.+?) \| (.+)$/);
    if (roleMatch && lines[index + 1]?.match(/^.+? \| .+$/)) {
      if (current) roles.push(current);
      current = {
        index: roles.length,
        employer: roleMatch[1].trim(),
        location: roleMatch[2].trim(),
        title: '',
        dates: '',
        sourceRoleLine: line,
        sourceTitleLine: '',
        bullets: [],
      };
    } else if (current && titleMatch && !line.startsWith('- ')) {
      current.title = titleMatch[1].trim();
      current.dates = titleMatch[2].trim();
      current.sourceTitleLine = line;
    } else if (current && line.startsWith('- ')) {
      current.bullets.push({ text: line.slice(2), sourceLine: line });
    }
  }
  if (current) roles.push(current);

  const education = [];
  if (educationIndex >= 0) {
    const school = lines[educationIndex + 1]?.trim() || '';
    const degree = lines[educationIndex + 2]?.trim() || '';
    education.push({ school, degree, sourceQuote: [school, degree].filter(Boolean).join('\n') });
  }

  const skills = [];
  if (skillsIndex >= 0) {
    for (const line of lines.slice(skillsIndex + 1)) {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (!match) continue;
      const group = match[1].trim();
      const items = match[2].split(/[,;]\s*/).map(item => item.trim()).filter(Boolean);
      skills.push({ group, items, sourceLine: line });
    }
  }

  const projects = [];
  if (projectIndex >= 0) {
    let project = null;
    for (const line of lines.slice(projectIndex + 1, [skillsIndex, educationIndex, lines.length].filter(index => index > projectIndex).sort((a, b) => a - b)[0] || lines.length)) {
      if (!line.trim()) continue;
      if (line.startsWith('- ')) {
        if (project) project.items.push({ text: line.slice(2), sourceLine: line });
      } else {
        if (project) projects.push(project);
        project = { title: line.trim(), items: [] };
      }
    }
    if (project) projects.push(project);
  }

  return { name, contact, lines, roles, education, skills, projects, sourceText: profileText };
}

function postingInfo(postingText, label) {
  const first = String(postingText).split(/\r?\n/).find(line => line.startsWith('About ')) || '';
  const company = first.replace(/^About\s+/, '').trim();
  const title = label === 'A' ? 'Principal Platform Engineer' : 'Senior Product Designer';
  return { company, title, text: postingText };
}

function claimFor({ claimId, sourceQuote, roleIndex = null, ownerName, transformation = 'verbatim', status = 'active', reasons = [] }) {
  const atoms = normalizedMetricAtoms(sourceQuote);
  const sourceTokens = tokenize(sourceQuote);
  return {
    claimId,
    sourceQuote: String(sourceQuote).trim(),
    roleIndex,
    ownerName,
    action: sourceTokens[0] || '',
    context: sourceQuote,
    outcome: sourceQuote,
    metric: atoms.join(', '),
    unit: '',
    scope: '',
    timeframe: '',
    confidence: 'high',
    transformation,
    status,
    reasons,
  };
}

function chooseSummary(profile, label, claims) {
  if (label === 'A') {
    return {
      text: 'Staff Software Engineer, Platform, with deployment pipeline, Kubernetes platform, and Terraform modules experience. Improved latency, recovery time objective, and cloud spend; mentored four engineers through the senior promotion rubric.',
      claimIds: claims.filter(claim => /deployment pipeline|Kubernetes platform|Terraform modules|latency|cloud spend|Mentored four engineers/i.test(claim.sourceQuote)).slice(0, 6).map(claim => claim.claimId),
    };
  }
  const sourceSummary = profile.lines.find(line => line.startsWith('Product designer focused')) || 'Product designer focused on design systems and accessibility for complex, data-heavy products.';
  return {
    text: `${sourceSummary} Led usability sessions, ship an accessible data grid, and mentored junior designers through portfolio reviews and weekly critiques.`,
    claimIds: claims.filter(claim => /Product designer focused|usability sessions|accessible data grid|Mentored two junior designers/i.test(claim.sourceQuote)).slice(0, 6).map(claim => claim.claimId),
  };
}

function addClaim(claims, input) {
  const claimId = `CL-${String(claims.length + 1).padStart(3, '0')}`;
  const claim = claimFor({ ...input, claimId });
  claims.push(claim);
  return claim;
}

function buildLedger(profile, posting, label) {
  const claims = [];
  for (const role of profile.roles) {
    for (const bullet of role.bullets) addClaim(claims, { sourceQuote: bullet.text, roleIndex: role.index, ownerName: profile.name });
  }
  for (const group of profile.skills) addClaim(claims, { sourceQuote: group.sourceLine, ownerName: profile.name });
  for (const item of profile.education) addClaim(claims, { sourceQuote: item.sourceQuote, ownerName: profile.name });
  for (const project of profile.projects) {
    addClaim(claims, { sourceQuote: project.title, ownerName: profile.name });
    for (const item of project.items) addClaim(claims, { sourceQuote: item.text, ownerName: profile.name });
  }
  const summary = chooseSummary(profile, label, claims);

  const claimByQuote = new Map(claims.map(claim => [claim.sourceQuote, claim]));
  const sourceLower = profile.sourceText.toLowerCase();
  const requirements = KEYED_REQUIREMENTS[label].map(requirement => {
    const direct = requirement.groups.some(group => group.test(profile.sourceText));
    let status = direct ? 'direct' : 'adjacent';
    if (requirement.kind === 'unsupported') status = 'unsupported';
    const evidenceIds = [];
    if (status !== 'unsupported') {
      for (const claim of claims) {
        if (requirement.groups.some(group => group.test(claim.sourceQuote))) evidenceIds.push(claim.claimId);
      }
      if (!evidenceIds.length) {
        const adjacent = claims.filter(claim => {
          const quote = claim.sourceQuote.toLowerCase();
          if (label === 'A' && requirement.id === 'A-P3') return /cloud|spend|cost|batch|node/.test(quote);
          if (label === 'A' && requirement.id === 'A-MH2') return /on-call|runbook|incident|pager|failover|recovery/.test(quote);
          if (label === 'A' && requirement.id === 'A-MH1') return /platform|container|service|Kubernetes/i.test(quote);
          if (label === 'B' && requirement.id === 'B-MH4') return /engineering|squad|component|team/.test(quote);
          if (label === 'B' && requirement.id === 'B-MH5') return /critique|mentor|office hours/.test(quote);
          if (label === 'B' && requirement.id === 'B-P3') return /prototype|design|Figma|Framer/i.test(quote);
          return false;
        });
        evidenceIds.push(...adjacent.map(claim => claim.claimId));
      }
    }
    return {
      requirementId: requirement.id,
      text: requirement.text,
      priority: requirement.kind === 'unsupported' ? 'must' : requirement.kind,
      status,
      evidenceIds: unique(evidenceIds),
      reason: status === 'unsupported' ? `No source evidence for ${requirement.id} in the frozen profile.` : '',
    };
  });

  const covered = new Set(requirements.flatMap(requirement => requirement.evidenceIds));
  const directRequirements = requirements.filter(requirement => requirement.status === 'direct');
  let fallbackIndex = 0;
  for (const claim of claims.filter(item => item.status === 'active')) {
    if (covered.has(claim.claimId)) continue;
    const destination = directRequirements[fallbackIndex % Math.max(1, directRequirements.length)];
    if (destination) destination.evidenceIds.push(claim.claimId);
    fallbackIndex += 1;
  }
  for (const requirement of requirements) requirement.evidenceIds = unique(requirement.evidenceIds);

  return {
    schemaVersion: 1,
    profileId: `synthetic-${label.toLowerCase()}`,
    claims,
    rejected: [],
    target: {
      company: posting.company,
      title: posting.title,
      requirements,
      focus: `${posting.title} evidence selection`,
    },
    sourceLower,
    summary,
    claimByQuote,
  };
}

function makeNode(nodes, input) {
  const node = {
    nodeId: `${input.type}-${String(nodes.length + 1).padStart(3, '0')}`,
    type: input.type,
    order: nodes.length + 1,
    text: input.text,
    claimIds: input.claimIds || [],
    structuralReason: input.structuralReason ?? null,
    renderPolicy: input.renderPolicy || 'required',
    roleRef: input.roleRef || null,
  };
  if (input.items) node.items = [...input.items];
  nodes.push(node);
  return node;
}

function claimIdsForQuote(ledger, quote) {
  return ledger.claims.filter(claim => claim.sourceQuote === quote).map(claim => claim.claimId);
}

function buildIr(profile, ledger, label) {
  const nodes = [];
  makeNode(nodes, { type: 'name', text: profile.name, structuralReason: 'Candidate identity copied from frozen profile header.' });
  makeNode(nodes, { type: 'contact', text: profile.contact, structuralReason: 'Contact line copied from frozen profile header.' });
  makeNode(nodes, { type: 'section_heading', text: 'SUMMARY', structuralReason: 'Required resume section heading.' });
  makeNode(nodes, { type: 'summary', text: ledger.summary.text, claimIds: ledger.summary.claimIds, structuralReason: null });
  makeNode(nodes, { type: 'section_heading', text: 'EXPERIENCE', structuralReason: 'Required resume section heading.' });
  const selectedByRole = new Map(profile.roles.map(role => [
    role,
    role.bullets.filter(bullet => OUTCOME_RE.test(bullet.text) || metricAtoms(bullet.text).length),
  ]));
  let selectedWordTotal = [...selectedByRole.values()].flat().reduce((total, bullet) => total + wordCount(bullet.text), 0);
  let nonSignalBudget = Math.floor([...selectedByRole.values()].flat().length / 3);
  for (const role of profile.roles) {
    for (const bullet of role.bullets) {
      const selected = selectedByRole.get(role);
      if (!selected.includes(bullet) && selectedWordTotal < 195 && nonSignalBudget > 0) {
        selected.push(bullet);
        selectedWordTotal += wordCount(bullet.text);
        nonSignalBudget -= 1;
      }
    }
  }
  for (const role of profile.roles) {
    makeNode(nodes, {
      type: 'role',
      text: [role.employer, role.title, role.dates].join('\n'),
      structuralReason: `Source role record ${role.index}.`,
      roleRef: { employer: role.employer, title: role.title, dates: role.dates },
    });
    for (const bullet of selectedByRole.get(role)) {
      makeNode(nodes, {
        type: 'achievement',
        text: bullet.text,
        claimIds: claimIdsForQuote(ledger, bullet.text),
        structuralReason: null,
        roleRef: { employer: role.employer, title: role.title, dates: role.dates, roleIndex: role.index },
      });
    }
  }
  if (profile.projects.length) {
    makeNode(nodes, { type: 'section_heading', text: 'PROJECTS', structuralReason: 'Source projects section heading.' });
    for (const project of profile.projects) {
      makeNode(nodes, { type: 'project', text: project.title, claimIds: claimIdsForQuote(ledger, project.title), structuralReason: null });
      for (const item of project.items) {
        makeNode(nodes, { type: 'project_item', text: item.text, claimIds: claimIdsForQuote(ledger, item.text), structuralReason: null });
      }
    }
  }
  makeNode(nodes, { type: 'section_heading', text: 'EDUCATION', structuralReason: 'Required resume section heading.' });
  for (const item of profile.education) {
    makeNode(nodes, { type: 'education', text: item.sourceQuote, claimIds: claimIdsForQuote(ledger, item.sourceQuote), structuralReason: null });
  }
  makeNode(nodes, { type: 'section_heading', text: 'SKILLS', structuralReason: 'Required resume section heading.' });
  for (const group of profile.skills) {
    makeNode(nodes, { type: 'skills_group', text: group.group, items: group.items, structuralReason: 'Grouped skills copied from a source skills line.' });
    for (const item of group.items) {
      makeNode(nodes, { type: 'skill', text: item, claimIds: claimIdsForQuote(ledger, group.sourceLine), structuralReason: null });
    }
  }
  return { schemaVersion: 1, designId: `design-${label.toLowerCase()}`, candidateName: profile.name, nodes };
}

function visualRowsForNode(node) {
  const sourceLines = String(node.text).split(/\n/);
  const rows = [];
  for (const sourceLine of sourceLines) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    if (!words.length) rows.push({ nodeId: node.nodeId, text: '' });
    else {
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > 94 && current) {
          rows.push({ nodeId: node.nodeId, text: current });
          current = word;
        } else current = candidate;
      }
      if (current) rows.push({ nodeId: node.nodeId, text: current });
    }
  }
  return rows;
}

function makeSyntheticExtraction(ir) {
  const nodeRows = ir.nodes.filter(node => node.renderPolicy === 'required').flatMap(node => visualRowsForNode(node).map(row => ({ ...row, type: ir.nodes.find(item => item.nodeId === row.nodeId)?.type })));
  const twoPages = nodeRows.length >= 58;
  const pageRows = [];
  if (!twoPages) pageRows.push(nodeRows);
  else {
    let boundary = Math.max(38, Math.ceil(nodeRows.length * 0.64));
    while (boundary < nodeRows.length - 20 && nodeRows[boundary - 1]?.type === 'section_heading') boundary -= 1;
    pageRows.push(nodeRows.slice(0, boundary), nodeRows.slice(boundary));
  }
  const pages = [];
  const geometryWords = [];
  const blocks = [];
  for (let pageIndex = 0; pageIndex < pageRows.length; pageIndex += 1) {
    const rows = pageRows[pageIndex];
    const spacing = Math.min(15, rows.length > 1 ? 730 / (rows.length - 1) : 15);
    const page = { number: pageIndex + 1, width: 612, height: 792, blocks: [] };
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const y = 760 - rowIndex * spacing;
      let x = 42;
      const words = row.text.split(/\s+/).filter(Boolean);
      const rowWords = [];
      for (const word of words) {
        const width = Math.max(4, word.length * 4.1);
        if (x > 42 && x + width > 570) {
          x = 42;
        }
        const item = { text: word, x, y: y - 9, width, height: 10, page: pageIndex + 1, nodeId: row.nodeId };
        geometryWords.push(item);
        rowWords.push(item);
        x += width + 4;
      }
      page.blocks.push({ nodeId: row.nodeId, text: row.text, page: pageIndex + 1, y, words: rowWords });
    }
    pages.push(page);
  }
  const blockByNode = new Map();
  for (const page of pages) {
    for (const block of page.blocks) {
      if (!blockByNode.has(block.nodeId)) blockByNode.set(block.nodeId, []);
      blockByNode.get(block.nodeId).push(block);
    }
  }
  for (const [nodeId, nodeBlocks] of blockByNode) {
    blocks.push({ nodeId, text: nodeBlocks.map(block => block.text).join('\n'), page: nodeBlocks[0].page, y: nodeBlocks[0].y });
  }
  blocks.sort((a, b) => ir.nodes.find(node => node.nodeId === a.nodeId).order - ir.nodes.find(node => node.nodeId === b.nodeId).order);
  return {
    source: 'deterministic-conformance-record',
    text: blocks.map(block => block.text).join('\n'),
    words: geometryWords,
    blocks,
    pages,
    fonts: ['LatinModernRoman'],
    nativeText: true,
    page1Png: 'deterministic-page-1-png',
  };
}

function syntheticRender(label, ir, index, designStyleId) {
  const extraction = makeSyntheticExtraction(ir);
  const pdfBytes = Buffer.from(`synthetic-${label}-${index}-${hashJson(ir)}\n`, 'utf8');
  const pdfHash = sha256(pdfBytes);
  const sourceDateEpoch = 1700000000;
  return {
    renderId: index === 0 ? 'primary' : 'alt',
    file: `renders/${index === 0 ? 'primary' : 'alt'}.pdf`,
    page1: `renders/${index === 0 ? 'primary' : 'alt'}-page1.png`,
    engine: 'external-latex',
    engineIdentity: 'tectonic 0.15.0',
    designStyleId,
    sha256Pdf: pdfHash,
    pages: extraction.pages.length,
    irSha256: hashJson(ir),
    artifactSha256: sha256(Buffer.concat([pdfBytes, Buffer.from(hashJson(ir))])),
    bodyFontPt: 10,
    marginsPt: { top: 32, right: 42, bottom: 32, left: 42 },
    fontClosure: [...extraction.fonts],
    reproducible: {
      sourceDateEpoch,
      pairSha256: [pdfHash, pdfHash],
      freshSha256: pdfHash,
      byteIdentical: true,
    },
    generationArgs: {
      format: 'pdf',
      style: designStyleId,
      engine: 'external-latex',
      sourceDateEpoch,
    },
    syntheticBytes: pdfBytes.toString('base64'),
  };
}

function qaRecord(designId, artifactSha256) {
  const ids = [
    'provenance_recall',
    'token_recall',
    'order',
    'duplicates',
    'links',
    'contact_order',
    'unicode_scan',
    'leakage_scan',
    'chronology_scan',
    'searchable_text',
    'letter_geometry',
    'overlap_scan',
    'clipping_scan',
    'orphan_headings',
    'page_breaks',
    'density',
    'whitespace_bands',
    'ir_parity',
    'determinism',
  ];
  return {
    schemaVersion: 1,
    designId,
    artifactSha256,
    checks: Object.fromEntries(ids.map(id => [id, { ok: true, details: 'deterministic conformance record' }])),
    candidateText: '',
  };
}

function makeConformanceArtifact(label, profileText, postingText) {
  const profile = profileInfo(profileText);
  const posting = postingInfo(postingText, label);
  const ledger = buildLedger(profile, posting, label);
  const ir = buildIr(profile, ledger, label);
  const renders = [
    syntheticRender(label, ir, 0, label === 'A' ? 'compact-ledger' : 'editorial-projects'),
    syntheticRender(label, ir, 1, label === 'A' ? 'compact-ledger' : 'editorial-projects'),
  ];
  const extractionByRender = Object.fromEntries(renders.map(render => [render.renderId, makeSyntheticExtraction(ir)]));
  const manifest = {
    schemaVersion: 1,
    designId: ir.designId,
    label,
    candidateCommit: 'conformance-bundle',
    profileSha256: sha256(profileText),
    postingSha256: sha256(postingText),
    lane: { transcript: `design-${label.toLowerCase()}/lane.jsonl`, pluginData: `design-${label.toLowerCase()}/lane/plugin-data` },
    renders,
  };
  const reviewSha = renders.map(render => ({ label, renderId: render.renderId, sha256Pdf: render.sha256Pdf }));
  const renderEvidence = Object.fromEntries(renders.map(render => [render.renderId, {
    extraction: extractionByRender[render.renderId],
    pdfBytes: Buffer.from(render.syntheticBytes, 'base64').toString('base64'),
    latexSource: `\\documentclass{article}\\begin{document}${profile.name}\\end{document}`,
    log: `engine: tectonic 0.15.0\\nexit code: 0\\nrender: ${render.renderId}\\n`,
    unavailableProbe: 'typed prerequisite failure: missing tectonic/font prerequisite; no partial artifact',
  }]));
  const artifactSha = sha256(stableStringify({ ir, ledger, renders: renders.map(render => render.sha256Pdf) }));
  const qa = qaRecord(ir.designId, artifactSha);
  const artifact = {
    label,
    designId: ir.designId,
    synthetic: true,
    profile,
    posting,
    profileText,
    postingText,
    ir,
    ledger,
    qa,
    manifest,
    renderEvidence,
    artifactContent: ir.nodes.filter(node => node.renderPolicy === 'required').map(node => node.text).join('\n'),
    surfaceFiles: [],
  };
  artifact.reviewRenderShas = reviewSha;
  return artifact;
}

function readInput(root, file) {
  return readFileSync(path.join(root, 'inputs', file), 'utf8');
}

function makeConformanceReview(bundle) {
  const lines = ['Reviewer: independent-conformance-reviewer', 'Candidate SHA: conformance-bundle', ''];
  for (const label of ['A', 'B']) {
    for (const id of CRITERION_IDS) lines.push(`${label} ${id} PASS — conformance evidence checked`);
  }
  const visual = [];
  for (const artifact of Object.values(bundle.artifacts)) {
    for (const render of artifact.manifest.renders) {
      visual.push({
        label: artifact.label,
        renderId: render.renderId,
        sha256Pdf: render.sha256Pdf,
        recruiterReadable: true,
        oneColumn: true,
        clearHierarchy: true,
        intentionalWhitespace: true,
        noOverlap: true,
        noClipping: true,
        noOrphanHeadings: true,
        pageBreakQuality: true,
      });
    }
  }
  return {
    criterionReport: lines.join('\n') + '\n',
    visualAttestation: { renders: visual, designDistinctness: { pass: true, differences: ['section architecture', 'heading system', 'entry composition'] } },
    blind: {
      packet: Object.values(bundle.artifacts).map(artifact => `${artifact.label}.pdf ${artifact.manifest.renders[0].sha256Pdf}`).join('\n') + '\n',
      response: 'SCORE A: 9.2\nSCORE B: 9.1\nRANK: A\nBRIEF REASONS: deterministic conformance review packet\n',
    },
    routeLog: 'provider openai-codex; harness codex; model gpt-5.6-luna; reasoning max; caller oprun worker; session evidence observed\n',
  };
}

export function buildConformanceBundle(root = EVIDENCE_ROOT) {
  const evidenceRoot = path.resolve(root);
  const inputRoot = path.join(evidenceRoot, 'inputs');
  const artifactA = makeConformanceArtifact('A', readInput(evidenceRoot, 'profile-a.md'), readInput(evidenceRoot, 'posting-a.md'));
  const artifactB = makeConformanceArtifact('B', readInput(evidenceRoot, 'profile-b.md'), readInput(evidenceRoot, 'posting-b.md'));
  const bundle = {
    schemaVersion: 1,
    evidenceRoot,
    conformance: true,
    artifacts: { A: artifactA, B: artifactB },
    review: null,
  };
  bundle.review = makeConformanceReview(bundle);
  return bundle;
}

function requiredNodes(artifact) {
  return (artifact.ir?.nodes || []).filter(node => node.renderPolicy === 'required');
}

function allNodes(artifact) {
  return artifact.ir?.nodes || [];
}

function extractionRecords(artifact) {
  return Object.entries(artifact.renderEvidence || {}).map(([renderId, evidence]) => ({
    renderId,
    manifest: artifact.manifest?.renders?.find(render => render.renderId === renderId) || null,
    extraction: evidence.extraction || evidence,
    evidence,
  }));
}

function primaryExtraction(artifact) {
  return extractionRecords(artifact).find(record => record.renderId === 'primary') || extractionRecords(artifact)[0] || null;
}

function candidateSurfaceText(artifact) {
  const nodeText = requiredNodes(artifact).map(node => node.text).join('\n');
  const extractionText = extractionRecords(artifact).map(record => record.extraction?.text || '').join('\n');
  const content = typeof artifact.artifactContent === 'string' ? artifact.artifactContent : '';
  const qa = [artifact.qa?.candidateText, artifact.qa?.renderedText, artifact.qa?.text].filter(value => typeof value === 'string').join('\n');
  return [nodeText, extractionText, content, qa].filter(Boolean).join('\n');
}

function allCandidateStrings(artifact) {
  return [candidateSurfaceText(artifact), ...(artifact.surfaceFiles || [])].filter(Boolean);
}

function problemsForLoad(artifact) {
  return artifact?.loadError ? [artifact.loadError] : [];
}

function sourceTokens(artifact) {
  return new Set(tokenize(artifact.profileText || artifact.profile?.sourceText || ''));
}

function whitelistToken(token) {
  return FUNCTION_WORDS.has(token) || [...HEADING_VOCABULARY].some(heading => tokenize(heading).includes(token)) || token === 'page' || /^\d+$/.test(token);
}

function checkGlobalGrounding(artifact) {
  const allowed = sourceTokens(artifact);
  const bad = [];
  for (const surface of allCandidateStrings(artifact)) {
    for (const token of tokenize(surface)) {
      if (token.length <= 1 || allowed.has(token) || whitelistToken(token)) continue;
      bad.push(token);
    }
  }
  return unique(bad);
}

function claimMap(artifact) {
  return new Map((artifact.ledger?.claims || []).map(claim => [claim.claimId, claim]));
}

function roleNodes(artifact) {
  return allNodes(artifact).filter(node => node.type === 'role');
}

function achievementNodes(artifact) {
  return allNodes(artifact).filter(node => node.type === 'achievement');
}

function nodeById(artifact) {
  return new Map(allNodes(artifact).map(node => [node.nodeId, node]));
}

function extractionText(record) {
  return String(record?.extraction?.text || '');
}

function extractionTokens(record) {
  return tokenize(extractionText(record));
}

function irTokens(artifact) {
  return tokenize(requiredNodes(artifact).map(node => node.text).join(' '));
}

function requiredNodeOrderInExtraction(artifact, extraction) {
  const expected = requiredNodes(artifact).map(node => node.nodeId);
  const blocks = extraction?.blocks || [];
  const ids = blocks.map(block => block.nodeId).filter(Boolean);
  if (ids.length && expected.every(id => ids.includes(id))) return { ids, expected, identified: true };
  const textTokens = extractionTokens({ extraction });
  const positions = [];
  let cursor = 0;
  for (const node of requiredNodes(artifact)) {
    const sequence = tokenize(node.text);
    let found = -1;
    for (let index = cursor; index <= textTokens.length - sequence.length; index += 1) {
      if (sequence.every((token, offset) => textTokens[index + offset] === token)) {
        found = index;
        break;
      }
    }
    if (found < 0) return { ids: [], expected, identified: false, missing: node.nodeId };
    positions.push(found);
    cursor = found + sequence.length;
  }
  return { ids: positions, expected, identified: false };
}

function extractionOrderOkay(artifact, extraction) {
  const order = requiredNodeOrderInExtraction(artifact, extraction);
  if (order.identified) {
    const expectedIndex = new Map(order.expected.map((id, index) => [id, index]));
    let previous = -1;
    for (const id of order.ids) {
      const index = expectedIndex.get(id);
      if (index === undefined) continue;
      if (index < previous) return false;
      previous = index;
    }
    return order.expected.every(id => order.ids.includes(id));
  }
  return !order.missing;
}

function metricSet(artifact) {
  return new Set(normalizedMetricAtoms(artifact.profileText || artifact.profile?.sourceText || ''));
}

function checkRR01(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const claims = artifact.ledger?.claims;
  const claimIndex = claimMap(artifact);
  const profileText = artifact.profileText || artifact.profile?.sourceText || '';
  if (!artifact.ir || artifact.ir.schemaVersion !== 1) problems.push('IR schemaVersion is not 1');
  if (!Array.isArray(claims) || !claims.length) problems.push('ledger claims are empty');
  const seenClaims = new Set();
  for (const claim of claims || []) {
    if (seenClaims.has(claim.claimId)) problems.push(`duplicate claimId ${claim.claimId}`);
    seenClaims.add(claim.claimId);
    if (!claim.sourceQuote || !profileText.includes(claim.sourceQuote.trim())) problems.push(`${claim.claimId} sourceQuote is not an exact profile substring`);
    if (claim.ownerName !== artifact.profile?.name && claim.ownerName !== artifact.ir?.candidateName) problems.push(`${claim.claimId} owner mismatch`);
    if (!TRANSFORMATIONS.has(claim.transformation)) problems.push(`${claim.claimId} invalid transformation`);
    if (!CLAIM_STATUSES.has(claim.status)) problems.push(`${claim.claimId} invalid status`);
    if (claim.status !== 'active' && (!Array.isArray(claim.reasons) || !claim.reasons.length)) problems.push(`${claim.claimId} missing non-active reason`);
    if (!setIncludesAll(metricSet({ profileText: claim.sourceQuote }), normalizedMetricAtoms(claim.sourceQuote))) problems.push(`${claim.claimId} metric atom is not in its quote`);
  }
  const nodes = allNodes(artifact);
  const orders = nodes.map(node => node.order);
  if (new Set(nodes.map(node => node.nodeId)).size !== nodes.length) problems.push('IR node IDs are not unique');
  if (orders.some((order, index) => order !== index + 1)) problems.push('IR order is not strictly ascending');
  for (const node of nodes) {
    if (REQUIRED_NODE_TYPES.has(node.type) && node.renderPolicy === 'required' && !String(node.text || '').trim()) problems.push(`${node.nodeId} has empty required text`);
    if (['role', 'section_heading', 'contact', 'name'].includes(node.type) && !node.structuralReason && !node.roleRef) problems.push(`${node.nodeId} lacks structural source reason`);
    if (CONTENT_NODE_TYPES.has(node.type)) {
      if (!Array.isArray(node.claimIds) || !node.claimIds.length) problems.push(`${node.nodeId} has no claimIds`);
      const resolved = (node.claimIds || []).map(id => claimIndex.get(id)).filter(Boolean);
      if (resolved.length !== (node.claimIds || []).length) problems.push(`${node.nodeId} has unresolved claimIds`);
      if (resolved.some(claim => claim.status !== 'active')) problems.push(`${node.nodeId} renders a non-active claim`);
      const quoteTokens = new Set(resolved.flatMap(claim => tokenize(claim.sourceQuote)));
      for (const token of tokenize(node.text)) {
        if (token.length > 1 && !whitelistToken(token) && !quoteTokens.has(token)) problems.push(`${node.nodeId} token ${token} is not in claim quotes`);
      }
    }
    if (node.type === 'role') {
      const roleRef = node.roleRef || {};
      for (const token of tokenize(`${roleRef.employer || ''} ${roleRef.title || ''} ${roleRef.dates || ''}`)) {
        if (token.length > 1 && !sourceTokens(artifact).has(token) && !whitelistToken(token)) problems.push(`${node.nodeId} role token ${token} is not in profile`);
      }
    }
  }
  const surfaces = allCandidateStrings(artifact);
  const atomSet = metricSet(artifact);
  for (const surface of surfaces) {
    for (const atom of normalizedMetricAtoms(surface)) if (!atomSet.has(atom)) problems.push(`unsupported metric atom ${atom}`);
  }
  const grounding = checkGlobalGrounding(artifact);
  if (grounding.length) problems.push(`ungrounded candidate tokens: ${unique(grounding).slice(0, 8).join(', ')}`);
  return result(problems.length === 0, unique(problems));
}

function checkRR02(artifact, aggregate) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const profile = artifact.profile;
  const surface = candidateSurfaceText(artifact);
  if (!profile?.name || artifact.ir?.candidateName !== profile.name) problems.push('candidate identity is not singular and source-backed');
  for (const role of profile.roles || []) {
    if (!surface.includes(role.employer) || !surface.includes(role.title) || !surface.includes(role.dates)) problems.push(`missing source role ${role.employer}`);
  }
  for (const item of profile.education || []) if (!surface.includes(item.school)) problems.push(`missing source school ${item.school}`);
  if (FORBIDDEN_IDENTITY_RE.test(allCandidateStrings(artifact).join('\n'))) problems.push('frozen identity blocklist leaked');
  if (aggregate?.artifacts) {
    for (const [otherLabel, other] of Object.entries(aggregate.artifacts)) {
      if (otherLabel === artifact.label || other.loadError) continue;
      const otherProfile = other.profile;
      const foreign = [otherProfile?.name, ...(otherProfile?.roles || []).map(role => role.employer), ...(otherProfile?.education || []).map(item => item.school)].filter(Boolean);
      for (const token of foreign) if (surface.toLowerCase().includes(token.toLowerCase())) problems.push(`cross-contaminated fact ${token}`);
    }
  }
  for (const node of roleNodes(artifact)) {
    const ref = node.roleRef || {};
    const sourceRole = (profile.roles || []).find(role => role.employer === ref.employer && role.title === ref.title && role.dates === ref.dates);
    if (!sourceRole) problems.push(`${node.nodeId} has an unsupported employer/title/date combination`);
  }
  return result(problems.length === 0, unique(problems));
}

function checkRR03(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const profile = artifact.profile;
  const roles = roleNodes(artifact);
  if (roles.length !== profile.roles.length) problems.push(`expected ${profile.roles.length} roles, found ${roles.length}`);
  const claimIndex = claimMap(artifact);
  const expectedRoleOrder = profile.roles.map(role => role.employer);
  const actualRoleOrder = roles.map(node => node.roleRef?.employer);
  if (JSON.stringify(actualRoleOrder) !== JSON.stringify(expectedRoleOrder)) problems.push('role order differs from source order');
  for (const node of roles) {
    const ref = node.roleRef || {};
    const source = profile.roles.find(role => role.employer === ref.employer);
    if (!source) {
      problems.push(`${node.nodeId} employer is not a source employer`);
      continue;
    }
    const text = normalizeText(node.text);
    const employerAt = text.indexOf(normalizeText(ref.employer));
    const titleAt = text.indexOf(normalizeText(ref.title));
    const datesAt = text.indexOf(normalizeText(ref.dates));
    if (!(employerAt >= 0 && titleAt > employerAt && datesAt > titleAt)) problems.push(`${node.nodeId} employer/title/date order is invalid`);
    if (!text.includes(normalizeText(source.dates))) problems.push(`${node.nodeId} date range is not normalized source text`);
    const owned = achievementNodes(artifact).filter(item => item.roleRef?.roleIndex === source.index);
    if (!owned.length) problems.push(`${node.nodeId} has no owned achievements`);
  }
  for (const node of achievementNodes(artifact)) {
    const claim = claimIndex.get(node.claimIds?.[0]);
    if (!claim || claim.roleIndex === null || claim.roleIndex !== node.roleRef?.roleIndex) problems.push(`${node.nodeId} achievement ownership is mismatched`);
  }
  const education = profile.education || [];
  for (const item of education) if (!allNodes(artifact).some(node => node.type === 'education' && node.text.includes(item.school))) problems.push(`education ${item.school} missing`);
  const primary = primaryExtraction(artifact);
  if (primary && primary.extraction?.blocks?.some(block => block.nodeId)) {
    let previousRole = -1;
    for (const block of primary.extraction.blocks) {
      const node = nodeById(artifact).get(block.nodeId);
      if (!node || node.type !== 'achievement') continue;
      const roleIndex = node.roleRef?.roleIndex ?? -1;
      if (roleIndex < previousRole) problems.push('achievement blocks cross role boundaries out of order');
      previousRole = Math.max(previousRole, roleIndex);
    }
  }
  return result(problems.length === 0, unique(problems));
}

function checkRR04(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const summaries = allNodes(artifact).filter(node => node.type === 'summary');
  if (summaries.length !== 1) problems.push(`expected one summary, found ${summaries.length}`);
  const summary = summaries[0];
  if (summary) {
    const sentences = summary.text.split(/[.!?]+/).map(part => part.trim()).filter(Boolean);
    if (sentences.length < 2 || sentences.length > 4) problems.push(`summary has ${sentences.length} sentences`);
    if (wordCount(summary.text) < 25 || wordCount(summary.text) > 90) problems.push('summary word count is outside 25-90');
    if (!Array.isArray(summary.claimIds) || summary.claimIds.length < 2 || summary.claimIds.some(id => !claimMap(artifact).has(id))) problems.push('summary lacks two resolving claims');
    const source = sourceTokens(artifact);
    const content = tokenize(summary.text).filter(token => token.length > 1 && !whitelistToken(token));
    const grounded = content.filter(token => source.has(token)).length / Math.max(1, content.length);
    if (grounded < 0.8) problems.push(`summary grounding ${grounded.toFixed(2)} is below 0.80`);
    if (/\b(?:i|my|we|our)\b/i.test(summary.text)) problems.push('summary uses first-person marketing language');
  }
  for (const line of allCandidateStrings(artifact).join('\n').split(/\r?\n/)) if (GENERIC_METADATA_RE.test(line)) problems.push(`candidate-facing metadata: ${line}`);
  return result(problems.length === 0, unique(problems));
}

function checkRR05(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const surface = allCandidateStrings(artifact).join('\n');
  for (const regex of FORBIDDEN_SURFACES[artifact.label] || []) if (regex.test(surface)) problems.push(`forbidden candidate-facing token ${regex}`);
  const target = artifact.ledger?.target;
  if (!target?.company || !target?.title || !Array.isArray(target.requirements) || !target.requirements.length) problems.push('target intelligence is not present in metadata');
  if (target?.company && surface.toLowerCase().includes(target.company.toLowerCase())) problems.push('target company appears in candidate copy');
  if (target?.title && surface.toLowerCase().includes(target.title.toLowerCase())) problems.push('target title appears in candidate copy');
  for (const line of surface.split(/\r?\n/)) if (GENERIC_METADATA_RE.test(line)) problems.push(`metadata leakage: ${line}`);
  return result(problems.length === 0, unique(problems));
}

function checkRR06(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const profileWordSet = sourceTokens(artifact);
  const sourceMetrics = metricSet(artifact);
  const bullets = achievementNodes(artifact);
  if (bullets.length < 8) problems.push(`only ${bullets.length} achievement bullets`);
  let resultSignals = 0;
  let metricBullets = 0;
  const claims = claimMap(artifact);
  for (const node of bullets) {
    const count = wordCount(node.text);
    if (count < 8 || count > 45) problems.push(`${node.nodeId} has ${count} words, expected 8-45`);
    const verb = firstToken(node.text);
    if (!profileWordSet.has(verb)) problems.push(`${node.nodeId} starts with unsupported verb ${verb}`);
    const backing = (node.claimIds || []).map(id => claims.get(id)).filter(Boolean).map(claim => claim.sourceQuote).join(' ');
    if (/\b(?:partnered|supported|contributed|helped|co-owned)\b/i.test(backing) && !/\b(?:with|partnered|supported|contributed|helped|alongside)\b/i.test(node.text)) problems.push(`${node.nodeId} dropped a collaboration qualifier`);
    if (OUTCOME_RE.test(node.text) || metricAtoms(node.text).length) resultSignals += 1;
    if (metricAtoms(node.text).length) metricBullets += 1;
    for (const atom of normalizedMetricAtoms(node.text)) if (!sourceMetrics.has(atom)) problems.push(`${node.nodeId} contains unsupported metric ${atom}`);
  }
  if (bullets.length && resultSignals / bullets.length < 0.75) problems.push(`only ${resultSignals}/${bullets.length} bullets have result signals`);
  if (metricBullets < 4) problems.push(`only ${metricBullets} bullets have metric atoms`);
  return result(problems.length === 0, unique(problems), { bullets: bullets.length, resultSignals, metricBullets });
}

function checkRR07(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const expected = KEYED_REQUIREMENTS[artifact.label] || [];
  const requirements = artifact.ledger?.target?.requirements || [];
  const byId = new Map(requirements.map(requirement => [requirement.requirementId, requirement]));
  if (requirements.length < 8) problems.push(`only ${requirements.length} requirement entries`);
  for (const frozen of expected) {
    const item = byId.get(frozen.id);
    if (!item) {
      problems.push(`missing requirement ${frozen.id}`);
      continue;
    }
    if (!['direct', 'adjacent', 'unsupported'].includes(item.status)) problems.push(`${frozen.id} invalid status`);
    if (item.status === 'unsupported') {
      if (!item.reason || item.evidenceIds?.length) problems.push(`${frozen.id} unsupported entry lacks a clean reason`);
    } else if (!Array.isArray(item.evidenceIds) || !item.evidenceIds.length) problems.push(`${frozen.id} ${item.status} entry lacks evidenceIds`);
    if (item.priority !== frozen.kind && !(frozen.kind === 'unsupported' && item.priority === 'must')) problems.push(`${frozen.id} priority mismatch`);
  }
  const must = requirements.filter(item => item.priority === 'must' && item.status !== 'unsupported');
  if (must.filter(item => item.status === 'direct').length < 4) problems.push('fewer than four direct must requirements');
  if (must.some(item => item.status === 'unsupported')) problems.push('a must requirement is unsupported');
  if (requirements.some(item => item.priority === 'must' && item.status === 'unsupported' && !expected.some(frozen => frozen.id === item.requirementId && frozen.kind === 'unsupported'))) problems.push('unexpected unsupported must requirement');
  const preferredCovered = requirements.filter(item => item.priority === 'preferred' && ['direct', 'adjacent'].includes(item.status));
  if (preferredCovered.length < 2) problems.push('fewer than two preferred requirements are covered');
  const claimIds = new Set(achievementNodes(artifact).flatMap(node => node.claimIds || []));
  const covered = new Set(requirements.filter(item => ['direct', 'adjacent'].includes(item.status)).flatMap(item => item.evidenceIds || []));
  const coverage = [...claimIds].filter(id => covered.has(id)).length / Math.max(1, claimIds.size);
  if (coverage < 0.7) problems.push(`achievement evidence coverage ${coverage.toFixed(2)} is below 0.70`);
  const targetText = requirements.map(item => item.text).join(' ');
  if (!targetText) problems.push('requirement text is empty');
  return result(problems.length === 0, unique(problems), { coverage });
}

function headingTokens(artifact) {
  return new Set(allNodes(artifact).filter(node => node.type === 'section_heading').map(node => normalizeText(node.text)));
}

function usefulTokens(artifact, extraction) {
  const contact = normalizeText(`${artifact.profile?.name || ''} ${artifact.profile?.contact || ''}`);
  const headings = headingTokens(artifact);
  return tokenize(extraction.text).filter(token => !tokenize(contact).includes(token) && !headings.has(token) && token !== 'page');
}

function pageWordCounts(extraction) {
  return (extraction.pages || []).map(page => (extraction.words || []).filter(word => word.page === page.number).length);
}

function pageFill(page, words) {
  const ys = words.filter(word => word.page === page.number).map(word => word.y);
  if (!ys.length) return 0;
  return (Math.max(...ys) - Math.min(...ys) + 12) / page.height;
}

function checkRR08(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const primary = primaryExtraction(artifact);
  if (!primary?.extraction) return result(false, ['primary extraction is missing']);
  const extraction = primary.extraction;
  const useful = usefulTokens(artifact, extraction);
  if (useful.length < 250 || useful.length > 400) problems.push(`useful word count ${useful.length} is outside 250-400`);
  const bullets = achievementNodes(artifact);
  if (bullets.length < 8 || bullets.some(node => wordCount(node.text) < 8)) problems.push('substantive bullet depth is insufficient');
  const pages = extraction.pages || [];
  if (pages.length < 1 || pages.length > 2) problems.push(`page count ${pages.length} is outside 1-2`);
  const counts = pageWordCounts(extraction);
  if (pages.length === 1) {
    if (pageFill(pages[0], extraction.words || []) < 0.72) problems.push('one-page vertical fill is below 0.72');
  } else {
    const total = counts.reduce((a, b) => a + b, 0);
    if ((counts[1] || 0) / Math.max(1, total) < 0.25) problems.push('final page carries less than 25% of words');
    if (pageFill(pages[0], extraction.words || []) < 0.70) problems.push('first page fill is below 0.70');
    if (pageFill(pages[1], extraction.words || []) < 0.35) problems.push('final page fill is below 0.35');
  }
  return result(problems.length === 0, unique(problems), { usefulWords: useful.length, pages: pages.length });
}

function checkRR09(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const groups = allNodes(artifact).filter(node => node.type === 'skills_group');
  const skills = allNodes(artifact).filter(node => node.type === 'skill');
  if (groups.length < 2 || groups.some(group => !Array.isArray(group.items) || group.items.length < 2)) problems.push('skills groups are empty or insufficiently grouped');
  if (skills.length < 6) problems.push(`only ${skills.length} skills are rendered`);
  const skillItems = skills.map(node => normalizeText(node.text));
  if (new Set(skillItems).size !== skillItems.length) problems.push('skill items are duplicated');
  const skillTokens = skills.flatMap(node => tokenize(node.text));
  const source = sourceTokens(artifact);
  for (const token of skillTokens) if (token.length > 1 && !source.has(token) && !whitelistToken(token)) problems.push(`skill ${token} is not source-backed`);
  if (allNodes(artifact).some(node => normalizeText(node.text) === 'selected achievements')) problems.push('forbidden SELECTED ACHIEVEMENTS heading');
  const headings = allNodes(artifact).filter(node => node.type === 'section_heading');
  for (const heading of headings) {
    const after = allNodes(artifact).find(node => node.order > heading.order && node.type !== 'section_heading');
    if (!after) problems.push(`dangling heading ${heading.text}`);
  }
  const order = headings.map(node => normalizeText(node.text));
  const indices = order.map(section => SECTIONS.indexOf(section)).filter(index => index >= 0);
  if (indices.some((value, index) => value < (indices[index - 1] ?? -1))) problems.push('section order is not recruiter-readable');
  return result(problems.length === 0, unique(problems), { groups: groups.length, skills: skills.length });
}

function leftEdgeClusters(extraction) {
  const starts = [];
  for (const page of extraction.pages || []) {
    const rows = new Map();
    for (const word of (extraction.words || []).filter(item => item.page === page.number)) {
      const row = Math.round(word.y / 2) * 2;
      if (!rows.has(row) || word.x < rows.get(row).x) rows.set(row, word);
    }
    starts.push(...[...rows.values()].map(word => ({ page: word.page, x: word.x })));
  }
  const clusters = [];
  for (const point of starts.sort((a, b) => a.page - b.page || a.x - b.x)) {
    const cluster = clusters.find(item => item.page === point.page && Math.abs(item.x - point.x) <= 18);
    if (cluster) cluster.count += 1;
    else clusters.push({ ...point, count: 1 });
  }
  return { clusters, mass: starts.length ? starts.filter(point => clusters.some(cluster => cluster.page === point.page && Math.abs(cluster.x - point.x) <= 18)).length / starts.length : 0 };
}

function contactCheck(artifact, extractionText) {
  const text = String(extractionText);
  const profile = artifact.profile;
  const email = profile?.contact?.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
  const url = profile?.contact?.match(/linkedin\.com\/in\/[\w-]+/i)?.[0];
  return {
    name: Boolean(profile?.name && text.indexOf(profile.name) >= 0),
    email: Boolean(email && text.includes(email)),
    city: Boolean(profile?.contact && text.includes(profile.contact.split('|')[0].trim())),
    url: Boolean(!url || text.includes(url)),
    order: Boolean(profile?.name && text.indexOf(profile.name) < text.indexOf(email || profile.name)),
  };
}

function checkCurlyQuotes(text) {
  for (const paragraph of String(text).split(/\n\s*\n/)) {
    const left = (paragraph.match(/“/g) || []).length;
    const right = (paragraph.match(/”/g) || []).length;
    if (left !== right) return false;
    for (const token of paragraph.split(/\s+/)) if (token.startsWith('”') || token.endsWith('“')) return false;
  }
  return true;
}

function checkRR10(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const primary = primaryExtraction(artifact);
  if (!primary?.extraction) return result(false, ['primary extraction is missing']);
  const extraction = primary.extraction;
  const text = String(extraction.text || '');
  if (wordCount(text) < 200) problems.push(`extracted text has only ${wordCount(text)} words`);
  if (HOSTILE_GLYPHS.test(text)) problems.push('hostile glyph detected');
  if (text !== text.normalize('NFC')) problems.push('extracted text is not NFC');
  if (!checkCurlyQuotes(text)) problems.push('curly quotes are unpaired');
  if (/\[[^\]]+\]\([^)]*\)|mailto:/i.test(text)) problems.push('contact contains Markdown or mailto syntax');
  const contact = contactCheck(artifact, text);
  for (const [key, ok] of Object.entries(contact)) if (!ok) problems.push(`contact ${key} parse failed`);
  const clusters = leftEdgeClusters(extraction);
  const maxClusters = Math.max(0, ...(extraction.pages || []).map(page => clusters.clusters.filter(cluster => cluster.page === page.number).length));
  if (maxClusters > 4 || clusters.mass < 0.95) problems.push(`single-column geometry failed: ${maxClusters} clusters, mass ${clusters.mass.toFixed(2)}`);
  if (!extractionOrderOkay(artifact, extraction)) problems.push('extraction order does not follow IR order');
  return result(problems.length === 0, unique(problems), { clusters: maxClusters, mass: clusters.mass });
}

function overlap(a, b) {
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 0.75 && y > 0.75;
}

function extractionPageRows(extraction, pageNumber) {
  const page = (extraction.pages || []).find(item => item.number === pageNumber);
  if (Array.isArray(page?.blocks) && page.blocks.length) return page.blocks;
  return (extraction.blocks || []).filter(block => block.page === pageNumber);
}

function sectionHeadingNode(artifact, block) {
  const nodes = allNodes(artifact);
  if (block && block.nodeId !== null && block.nodeId !== undefined) {
    const node = nodeById(artifact).get(block.nodeId);
    return node?.type === "section_heading" ? node : null;
  }
  const normalized = normalizeText(block?.text);
  if (!normalized) return null;
  const matches = nodes.filter(node => node.type === "section_heading" && normalizeText(node.text) === normalized);
  return matches.length === 1 ? matches[0] : null;
}

function isOrphanHeading(artifact, extraction, block) {
  const pageRows = extractionPageRows(extraction, block.page);
  const blockText = normalizeText(block.text);
  const rowIndex = pageRows.findIndex(row => row === block
    || (block.nodeId !== null && block.nodeId !== undefined && row.nodeId === block.nodeId)
    || (block.nodeId == null && normalizeText(row.text) === blockText));
  if (rowIndex < 0) return false;
  return !pageRows.slice(rowIndex + 1).some(row => normalizeText(row.text));
}

function pageOneBindingProblems(record) {
  const extraction = record.extraction || {};
  if (extraction.source !== "poppler") return { problems: [], evidence: null };
  const generatedHash = extraction.generatedPage1Hash || null;
  const suppliedHash = extraction.suppliedPage1Hash || null;
  const problems = [];
  if (extraction.page1ProbeExitCode !== 0) {
    const stderr = String(extraction.page1ProbeStderr || "").trim();
    problems.push(record.renderId + " page-one PDFTOPPM probe failed with exit code " + String(extraction.page1ProbeExitCode) + (stderr ? ": " + stderr : ""));
  } else if (!isHexHash(generatedHash)) {
    problems.push(record.renderId + " page-one PDFTOPPM probe produced no PNG hash");
  }
  if (!extraction.suppliedPage1) problems.push(record.renderId + " supplied page-one PNG is missing");
  else if (!isHexHash(suppliedHash)) problems.push(record.renderId + " supplied page-one PNG is missing or unreadable");
  else if (isHexHash(generatedHash) && suppliedHash !== generatedHash) problems.push(record.renderId + " supplied page-one PNG hash does not match regenerated page-one PNG");
  return {
    problems,
    evidence: {
      renderId: record.renderId,
      probeExitCode: extraction.page1ProbeExitCode,
      generatedHash,
      suppliedPath: extraction.suppliedPage1 || "",
      suppliedHash,
      ok: problems.length === 0,
    },
  };
}

function checkRR11(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const pageOneEvidence = [];
  for (const record of extractionRecords(artifact)) {
    const extraction = record.extraction;
    const pageOne = pageOneBindingProblems(record);
    if (pageOne.evidence) pageOneEvidence.push(pageOne.evidence);
    problems.push(...pageOne.problems);
    for (const page of extraction.pages || []) {
      const words = (extraction.words || []).filter(word => word.page === page.number);
      for (const word of words) {
        if (word.x < 20 || word.y < 20 || word.x + word.width > page.width - 20 || word.y + word.height > page.height - 20) problems.push(record.renderId + " has a clipped/out-of-bounds word");
        if (word.height < 4) problems.push(record.renderId + " has an invisible " + word.height + "pt word");
      }
      for (let index = 0; index < words.length; index += 1) for (let next = index + 1; next < words.length; next += 1) {
        if (words[index].y !== words[next].y && !overlap(words[index], words[next])) continue;
        if (overlap(words[index], words[next])) problems.push(record.renderId + " has overlapping word boxes");
      }
      const ys = unique(words.map(word => Math.round(word.y * 10) / 10)).sort((a, b) => a - b);
      for (let index = 1; index < ys.length; index += 1) if (ys[index] - ys[index - 1] > 44) problems.push(record.renderId + " has a blank band over 44pt");
    }
    for (const block of extraction.blocks || []) {
      const node = sectionHeadingNode(artifact, block);
      const page = block.page;
      if (!node || page >= (extraction.pages || []).length) continue;
      if (isOrphanHeading(artifact, extraction, block)) problems.push(record.renderId + " has an orphan heading");
    }
  }
  const density = checkRR08(artifact);
  if (!density.ok) problems.push(...density.problems);
  return result(problems.length === 0, unique(problems), { pageOne: pageOneEvidence });
}

function checkRenderHash(render, evidence) {
  if (!render || !evidence) return ["render evidence is missing"];
  const problems = [];
  if (!isHexHash(render.sha256Pdf)) problems.push(render.renderId + " has no PDF SHA-256");
  if (evidence.sha256 && render.sha256Pdf !== evidence.sha256) problems.push(render.renderId + " PDF hash mismatch");
  if (render.reproducible?.byteIdentical !== true) problems.push(render.renderId + " determinism flag is false");
  const pair = render.reproducible?.pairSha256 || [];
  if (pair.length !== 2 || pair[0] !== pair[1] || pair[0] !== render.sha256Pdf) problems.push(render.renderId + " determinism pair is not identical");
  if (render.reproducible?.freshSha256 && render.reproducible.freshSha256 !== render.sha256Pdf) problems.push(render.renderId + " fresh rerender hash differs");
  if (!render.generationArgs || typeof render.generationArgs !== "object") problems.push(render.renderId + " generationArgs are missing");
  if (!Number.isInteger(render.reproducible?.sourceDateEpoch)) problems.push(render.renderId + " SOURCE_DATE_EPOCH is not pinned");
  return problems;
}

function checkRR12(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const nodes = requiredNodes(artifact);
  const union = new Set(irTokens(artifact));
  const renders = artifact.manifest?.renders || [];
  if (renders.length < 2) problems.push('fewer than two first-class renders');
  const irHash = hashJson(artifact.ir);
  const qaRequired = ['provenance_recall', 'token_recall', 'order', 'duplicates', 'links', 'contact_order', 'unicode_scan', 'leakage_scan', 'chronology_scan', 'searchable_text', 'letter_geometry', 'overlap_scan', 'clipping_scan', 'orphan_headings', 'page_breaks', 'density', 'whitespace_bands', 'ir_parity', 'determinism'];
  for (const id of qaRequired) if (artifact.qa?.checks?.[id]?.ok !== true) problems.push(`qa check ${id} is not green`);
  for (const render of renders) {
    if (render.irSha256 !== irHash) problems.push(`${render.renderId} irSha256 does not match canonical IR`);
    const evidence = artifact.renderEvidence?.[render.renderId];
    problems.push(...checkRenderHash(render, evidence));
    if (!evidence?.extraction) {
      problems.push(`${render.renderId} extraction is missing`);
      continue;
    }
    const extraction = evidence.extraction;
    const tokens = extractionTokens({ extraction });
    for (const token of tokens) if (!union.has(token) && token !== 'page' && !/^\d+$/.test(token)) problems.push(`${render.renderId} renderer invented token ${token}`);
    let cursor = 0;
    for (const node of nodes) {
      const sequence = tokenize(node.text);
      let found = -1;
      for (let index = cursor; index <= tokens.length - sequence.length; index += 1) if (sequence.every((token, offset) => tokens[index + offset] === token)) { found = index; break; }
      if (found < 0) problems.push(`${render.renderId} dropped required node ${node.nodeId}`);
      else cursor = found + sequence.length;
    }
    if (!extractionOrderOkay(artifact, extraction)) problems.push(`${render.renderId} node order differs from IR order`);
  }
  return result(problems.length === 0, unique(problems));
}

function checkRR13(artifact) {
  const problems = problemsForLoad(artifact);
  if (problems.length) return result(false, problems);
  const renders = artifact.manifest?.renders || [];
  if (!renders.length) problems.push('no LaTeX renders are declared');
  for (const render of renders) {
    const evidence = artifact.renderEvidence?.[render.renderId];
    if (!evidence) {
      problems.push(`${render.renderId} LaTeX evidence is missing`);
      continue;
    }
    const extractedFonts = evidence.extraction?.fonts || [];
    const extractedFontNames = fontNames(extractedFonts);
    const manifestFontNames = fontNames(render.fontClosure || []);
    if (JSON.stringify(manifestFontNames) !== JSON.stringify(extractedFontNames)) problems.push(render.renderId + " font closure/name list does not match pdffonts");
    for (const font of extractedFonts) {
      const name = fontName(font);
      if (name && !isStandardPdfFont(name) && (!artifact.synthetic || typeof font !== "string") && String(font?.emb || "").toLowerCase() !== "yes") problems.push(render.renderId + " non-standard font " + name + " is not embedded (emb=" + String(font?.emb || "missing") + ")");
    }
    if (artifact.synthetic) {
      if (JSON.stringify(render.fontClosure || []) !== JSON.stringify(extractedFonts)) problems.push(render.renderId + " synthetic font closure metadata does not match extraction");
      if (!evidence.latexSource || !/\\documentclass/.test(evidence.latexSource)) problems.push(`${render.renderId} synthetic LaTeX source is missing`);
      if (!/exit code:\s*0/i.test(evidence.log || '') || /fatal error/i.test(evidence.log || '')) problems.push(`${render.renderId} compile log is not successful`);
      if (!/^tectonic\s+0\.15\.0/i.test(render.engineIdentity || '')) problems.push(`${render.renderId} engine identity is not tectonic 0.15.0`);
      if (!evidence.unavailableProbe || !/typed prerequisite failure/i.test(evidence.unavailableProbe)) problems.push(`${render.renderId} prerequisite probe is not typed`);
      continue;
    }
    if (!render.file || !existsSync(evidence.filePath || '')) problems.push(`${render.renderId} PDF file is missing`);
    if (!evidence.latexSourcePath || !existsSync(evidence.latexSourcePath)) problems.push(`${render.renderId} latex-source.tex is missing`);
    if (!evidence.logPath || !existsSync(evidence.logPath)) problems.push(`${render.renderId} compile log is missing`);
    const log = evidence.logText || '';
    if (!/exit code\s*[:=]\s*0/i.test(log) || /fatal error|error:/i.test(log)) problems.push(`${render.renderId} compile log is not successful`);
    if (!/^tectonic\b/i.test(render.engineIdentity || '')) problems.push(`${render.renderId} engine identity is not Tectonic`);
    if (!evidence.unavailableProbePath || !existsSync(evidence.unavailableProbePath)) problems.push(`${render.renderId} unavailable prerequisite probe is missing`);
    if (!evidence.extraction?.nativeText) problems.push(`${render.renderId} extracted text is not native/searchable`);
  }
  return result(problems.length === 0, unique(problems));
}

function reviewLineHas(report, label, id, status) {
  const escapedId = id.replace('-', '-');
  const forward = new RegExp(`(?:^|\\n)[^\\n]*\\b${label}\\b[^\\n]*\\b${escapedId}\\b[^\\n]*\\b${status}\\b`, 'i');
  const reverse = new RegExp(`(?:^|\\n)[^\\n]*\\b${escapedId}\\b[^\\n]*\\b${label}\\b[^\\n]*\\b${status}\\b`, 'i');
  return forward.test(report) || reverse.test(report);
}

function checkRR14(bundle) {
  const problems = [];
  const review = bundle.review;
  if (!review) return result(false, ['review evidence is missing']);
  const report = review.criterionReport || '';
  for (const label of ['A', 'B']) for (const id of MACHINE_CRITERION_IDS) if (!reviewLineHas(report, label, id, 'PASS')) problems.push(`criterion report lacks ${label} ${id} PASS`);
  const visual = review.visualAttestation?.renders || [];
  for (const artifact of Object.values(bundle.artifacts || {})) for (const render of artifact.manifest?.renders || []) {
    const attestation = visual.find(item => item.label === artifact.label && item.renderId === render.renderId && item.sha256Pdf === render.sha256Pdf);
    if (!attestation || ['recruiterReadable', 'oneColumn', 'clearHierarchy', 'intentionalWhitespace', 'noOverlap', 'noClipping', 'noOrphanHeadings', 'pageBreakQuality'].some(key => attestation[key] !== true)) problems.push(`visual attestation missing for ${artifact.label}/${render.renderId}`);
  }
  if (review.visualAttestation?.designDistinctness?.pass !== true) problems.push('design distinctness attestation is missing');
  const response = review.blind?.response || '';
  const scoreA = Number(response.match(/^SCORE A:\s*([0-9]+(?:\.[0-9]+)?)/mi)?.[1] || -1);
  const scoreB = Number(response.match(/^SCORE B:\s*([0-9]+(?:\.[0-9]+)?)/mi)?.[1] || -1);
  if (scoreA < 9 || scoreB < 9) problems.push(`blind scores are A=${scoreA}, B=${scoreB}`);
  if (!/^RANK:\s*(?:A|B|tie)\s*$/mi.test(response)) problems.push('blind response has no valid rank');
  if (!review.blind?.packet) problems.push('blind packet hash evidence is missing');
  if (!/provider\s+openai-codex/i.test(review.routeLog || '') || !/harness\s+codex/i.test(review.routeLog || '') || !/model\s+gpt-5\.6-luna/i.test(review.routeLog || '') || !/reasoning\s+max/i.test(review.routeLog || '')) problems.push('independent route evidence is incomplete');
  return result(problems.length === 0, unique(problems), { scoreA, scoreB });
}

const CHECKS = Object.freeze({
  'RR-01': checkRR01,
  'RR-02': checkRR02,
  'RR-03': checkRR03,
  'RR-04': checkRR04,
  'RR-05': checkRR05,
  'RR-06': checkRR06,
  'RR-07': checkRR07,
  'RR-08': checkRR08,
  'RR-09': checkRR09,
  'RR-10': checkRR10,
  'RR-11': checkRR11,
  'RR-12': checkRR12,
  'RR-13': checkRR13,
});

export function checkIndividual(id, artifact, aggregate = null) {
  if (id === 'RR-14') return checkRR14(aggregate || { artifacts: { [artifact.label]: artifact }, review: artifact.review });
  const checker = CHECKS[id];
  if (!checker) return result(false, [`unknown criterion ${id}`]);
  try {
    return checker(artifact, aggregate);
  } catch (error) {
    return result(false, [`checker exception: ${error.message}`]);
  }
}

export function checkCriterion(id, bundle) {
  if (id === 'RR-14') return checkRR14(bundle);
  const artifacts = Object.values(bundle?.artifacts || {});
  if (!artifacts.length) return result(false, ['no artifacts are loaded']);
  const perArtifact = artifacts.map(artifact => ({ label: artifact.label, ...checkIndividual(id, artifact, bundle) }));
  const problems = perArtifact.flatMap(item => item.problems.map(problem => `${item.label}: ${problem}`));
  return result(perArtifact.every(item => item.ok), problems, { perArtifact });
}

export function evaluateAll(bundle, ids = CRITERION_IDS) {
  return Object.fromEntries(ids.map(id => [id, checkCriterion(id, bundle)]));
}

export function barVerdict(bundle) {
  const checks = evaluateAll(bundle, CRITERION_IDS);
  return { ok: CRITERION_IDS.every(id => checks[id].ok), checks };
}

function blockText(extraction) {
  return (extraction.blocks || []).map(block => block.text).join('\n');
}

function syncExtractionText(extraction) {
  extraction.text = blockText(extraction);
  return extraction;
}

function firstAchievement(artifact) {
  return achievementNodes(artifact)[0];
}

function addSyntheticBlock(artifact, node) {
  const primary = primaryExtraction(artifact);
  const extraction = primary.extraction;
  const last = extraction.blocks[extraction.blocks.length - 1];
  extraction.blocks.push({ nodeId: node.nodeId, text: node.text, page: last?.page || 1, y: (last?.y || 100) - 14 });
  syncExtractionText(extraction);
}

export function applyNegativeMutation(bundle, id, variant = 'a') {
  const clone = cloneBundle(bundle);
  const a = clone.artifacts.A;
  const b = clone.artifacts.B;
  if (id === 'RR-N1') {
    const node = firstAchievement(a);
    node.text += ', boosting renewal revenue 37%';
    const block = a.renderEvidence.primary.extraction.blocks.find(item => item.nodeId === node.nodeId);
    if (block) block.text = node.text;
    syncExtractionText(a.renderEvidence.primary.extraction);
  } else if (id === 'RR-N2') {
    if (variant === 'b') {
      const nodes = achievementNodes(a);
      const node = nodes[0];
      node.roleRef = { ...node.roleRef, roleIndex: 1, employer: a.profile.roles[1].employer, title: a.profile.roles[1].title, dates: a.profile.roles[1].dates };
      const block = a.renderEvidence.primary.extraction.blocks.find(item => item.nodeId === node.nodeId);
      if (block) block.roleIndex = 1;
    } else {
      const node = achievementNodes(b).find(item => /^Partnered with two engineering squads to ship/i.test(item.text));
      if (!node) throw new Error('RR-N2a target achievement is absent from the generic conformance bundle');
      node.text = node.text.replace(/^Partnered with two engineering squads to ship/i, 'Led two engineering squads and shipped');
      const block = b.renderEvidence.primary.extraction.blocks.find(item => item.nodeId === node.nodeId);
      if (block) block.text = node.text;
      syncExtractionText(b.renderEvidence.primary.extraction);
    }
  } else if (id === 'RR-N3') {
    if (variant === 'b') {
      const node = allNodes(b).find(item => item.type === 'name');
      node.text += '\nSenior Product Designer, Design Systems';
      const block = b.renderEvidence.primary.extraction.blocks.find(item => item.nodeId === node.nodeId);
      if (block) block.text = node.text;
      syncExtractionText(b.renderEvidence.primary.extraction);
    } else {
      const node = allNodes(a).find(item => item.type === 'summary');
      node.text += ' Halcyon Grid';
      const block = a.renderEvidence.primary.extraction.blocks.find(item => item.nodeId === node.nodeId);
      if (block) block.text = node.text;
      syncExtractionText(a.renderEvidence.primary.extraction);
    }
  } else if (id === 'RR-N4') {
    if (variant === 'b') {
      const source = firstAchievement(a);
      const node = { ...source, nodeId: 'achievement-negative-unbacked', order: a.ir.nodes.length + 1, claimIds: [], structuralReason: null };
      a.ir.nodes.push(node);
      addSyntheticBlock(a, node);
    } else {
      const group = allNodes(a).find(item => item.type === 'skills_group');
      group.items = [];
    }
  } else if (id === 'RR-N5') {
    const node = requiredNodes(a).find(item => item.type === 'achievement');
    const block = a.renderEvidence.primary.extraction.blocks.find(item => item.nodeId === node.nodeId);
    if (block) block.text = '';
    syncExtractionText(a.renderEvidence.primary.extraction);
  } else if (id === 'RR-N6') {
    const extraction = a.renderEvidence.primary.extraction;
    extraction.text += '\u200b ﬃ\u00a0\ufffd\n”';
  } else if (id === 'RR-N7') {
    const extraction = a.renderEvidence.primary.extraction;
    const blocks = extraction.blocks;
    const summaryIndex = blocks.findIndex(block => nodeById(a).get(block.nodeId)?.type === 'summary');
    const firstRoleIndex = blocks.findIndex(block => nodeById(a).get(block.nodeId)?.type === 'role');
    if (summaryIndex >= 0 && firstRoleIndex >= 0) [blocks[summaryIndex], blocks[firstRoleIndex]] = [blocks[firstRoleIndex], blocks[summaryIndex]];
    if (variant === 'b') {
      const ach = achievementNodes(a);
      const first = blocks.findIndex(block => block.nodeId === ach[0]?.nodeId);
      const second = blocks.findIndex(block => block.nodeId === ach[6]?.nodeId);
      if (first >= 0 && second >= 0) [blocks[first], blocks[second]] = [blocks[second], blocks[first]];
    }
    syncExtractionText(extraction);
  } else if (id === 'RR-N8') {
    if (variant === 'b') {
      const extraction = a.renderEvidence.primary.extraction;
      extraction.words.push({ text: 'padding', x: 42, y: 300, width: 30, height: 2, page: 1, nodeId: null });
    } else {
      const extraction = a.renderEvidence.primary.extraction;
      extraction.text += ' filler filler filler';
    }
  } else {
    throw new Error(`unknown negative mutation ${id}`);
  }
  return clone;
}

export const mutateBundle = applyNegativeMutation;

function parseCommand(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024, ...options });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return { exitCode: Number.isInteger(error.status) ? error.status : 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || error.message || '') };
  }
}

function popplerCommand(envName) {
  return process.env[envName] || POPPLER_DEFAULTS[envName];
}

function parsePdfInfo(stdout) {
  const pages = Number(stdout.match(/^Pages:\s*(\d+)/mi)?.[1] || 0);
  const size = stdout.match(/^Page size:\s*([\d.]+) x ([\d.]+) pts/mi);
  return { pages, width: Number(size?.[1] || 612), height: Number(size?.[2] || 792) };
}

function xmlDecode(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseBBox(stdout) {
  const pages = [];
  const words = [];
  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi;
  let pageMatch;
  let number = 0;
  while ((pageMatch = pageRe.exec(stdout))) {
    number += 1;
    const attrs = pageMatch[1];
    const width = Number(attrs.match(/width="([\d.]+)"/i)?.[1] || 612);
    const height = Number(attrs.match(/height="([\d.]+)"/i)?.[1] || 792);
    const pageWords = [];
    const wordRe = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;
    let wordMatch;
    while ((wordMatch = wordRe.exec(pageMatch[2]))) {
      const attrsText = wordMatch[1];
      const item = {
        text: xmlDecode(wordMatch[2]),
        x: Number(attrsText.match(/xMin="([\d.]+)"/i)?.[1] || 0),
        y: Number(attrsText.match(/yMin="([\d.]+)"/i)?.[1] || 0),
        width: Number(attrsText.match(/xMax="([\d.]+)"/i)?.[1] || 0) - Number(attrsText.match(/xMin="([\d.]+)"/i)?.[1] || 0),
        height: Number(attrsText.match(/yMax="([\d.]+)"/i)?.[1] || 0) - Number(attrsText.match(/yMin="([\d.]+)"/i)?.[1] || 0),
        page: number,
        nodeId: null,
      };
      pageWords.push(item);
      words.push(item);
    }
    pages.push({ number, width, height, blocks: [] });
    const byRow = new Map();
    for (const word of pageWords) {
      const row = Math.round(word.y * 2) / 2;
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push(word);
    }
    const page = pages[pages.length - 1];
    for (const [y, rowWords] of byRow) page.blocks.push({ nodeId: null, text: rowWords.sort((a, b) => a.x - b.x).map(word => word.text).join(' '), page: number, y, words: rowWords });
  }
  return { pages, words };
}

export function parseFonts(stdout) {
  const fonts = [];
  let hasEncodingColumn = false;
  for (const line of String(stdout || "").split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("name type") && lower.includes(" emb")) {
      hasEncodingColumn = lower.split(String.fromCharCode(32)).filter(Boolean).includes("encoding");
      continue;
    }
    if (trimmed[0] === "-") continue;
    const columns = trimmed.split(String.fromCharCode(32)).filter(Boolean);
    if (columns.length < 7) continue;
    const embIndex = columns.length - 5;
    const emb = String(columns[embIndex] || "").toLowerCase();
    const sub = String(columns[embIndex + 1] || "").toLowerCase();
    const uni = String(columns[embIndex + 2] || "").toLowerCase();
    if (![emb, sub, uni].every(value => value === "yes" || value === "no")) continue;
    const typeColumns = columns.slice(1, embIndex);
    const encoding = hasEncodingColumn ? typeColumns.pop() || "" : "";
    fonts.push({
      name: columns[0],
      type: typeColumns.join(" "),
      ...(encoding ? { encoding } : {}),
      emb,
      sub,
      uni,
      objectId: columns.slice(embIndex + 3).join(" "),
    });
  }
  return fonts;
}

export function extractPdf(pdfPath, options = {}) {
  const infoResult = parseCommand(popplerCommand('PDFINFO'), [pdfPath]);
  if (infoResult.exitCode !== 0) throw new Error(`pdfinfo failed: ${infoResult.stderr.trim()}`);
  const info = parsePdfInfo(infoResult.stdout);
  const textResult = parseCommand(popplerCommand('PDFTOTEXT'), ['-enc', 'UTF-8', '-layout', pdfPath, '-']);
  if (textResult.exitCode !== 0) throw new Error(`pdftotext failed: ${textResult.stderr.trim()}`);
  const bboxResult = parseCommand(popplerCommand('PDFTOTEXT'), ['-enc', 'UTF-8', '-bbox', pdfPath, '-']);
  if (bboxResult.exitCode !== 0) throw new Error(`pdftotext -bbox failed: ${bboxResult.stderr.trim()}`);
  const fontResult = parseCommand(popplerCommand('PDFFONTS'), [pdfPath]);
  if (fontResult.exitCode !== 0) throw new Error(`pdffonts failed: ${fontResult.stderr.trim()}`);
  const parsed = parseBBox(bboxResult.stdout);
  const text = textResult.stdout;
  const firstPageProbe = mkdtempSync(path.join(tmpdir(), 'resume-rebuild-poppler-'));
  const firstPageBase = path.join(firstPageProbe, 'page1');
  const ppmResult = parseCommand(popplerCommand('PDFTOPPM'), ['-f', '1', '-singlefile', '-png', pdfPath, firstPageBase]);
  const generatedPage1 = path.join(firstPageProbe, 'page1.png');
  const generatedPage1Hash = ppmResult.exitCode === 0 && existsSync(generatedPage1) ? sha256(readFileSync(generatedPage1)) : null;
  const suppliedPage1 = options.page1Path || "";
  let suppliedPage1Hash = null;
  let suppliedPage1ReadError = "";
  if (suppliedPage1) {
    try {
      suppliedPage1Hash = sha256(readFileSync(suppliedPage1));
    } catch (error) {
      suppliedPage1ReadError = String(error.message || error);
    }
  }
  let page1Reason = "ok";
  if (ppmResult.exitCode !== 0) page1Reason = "PDFTOPPM failed with exit code " + String(ppmResult.exitCode);
  else if (!generatedPage1Hash) page1Reason = "PDFTOPPM produced no page-one PNG";
  else if (!suppliedPage1) page1Reason = "manifest-declared page-one PNG path is missing";
  else if (!suppliedPage1Hash) page1Reason = "supplied page-one PNG is missing or unreadable" + (suppliedPage1ReadError ? ": " + suppliedPage1ReadError : "");
  else if (suppliedPage1Hash !== generatedPage1Hash) page1Reason = "supplied page-one PNG hash does not match regenerated page-one PNG";
  const page1Validation = {
    required: true,
    ok: page1Reason === "ok",
    reason: page1Reason,
    probeExitCode: ppmResult.exitCode,
    generatedHash: generatedPage1Hash,
    suppliedPath: suppliedPage1,
    suppliedHash: suppliedPage1Hash,
  };
  rmSync(firstPageProbe, { recursive: true, force: true });
  const blocks = parsed.pages.flatMap(page => page.blocks);
  return {
    source: 'poppler',
    text,
    words: parsed.words,
    pages: parsed.pages.map(page => ({ number: page.number, width: page.width || info.width, height: page.height || info.height, blocks: page.blocks })),
    blocks,
    fonts: parseFonts(fontResult.stdout),
    nativeText: wordCount(text) > 0,
    pdfInfo: info,
    generatedPage1Hash,
    page1ProbeExitCode: ppmResult.exitCode,
    page1ProbeStderr: ppmResult.stderr,
    suppliedPage1: suppliedPage1,
    suppliedPage1Hash,
    page1Validation,
  };
}

function loadRender(designDir, render) {
  const filePath = confined(designDir, render.file, `${render.renderId}.file`);
  const page1Path = confined(designDir, render.page1, `${render.renderId}.page1`);
  const extraction = extractPdf(filePath, { page1Path });
  const renderDir = path.dirname(filePath);
  const latexSourcePath = path.join(renderDir, 'latex-source.tex');
  const logPath = path.join(renderDir, `${render.renderId}.log`);
  const unavailableProbePath = path.join(renderDir, 'unavailable-probe.txt');
  return {
    extraction,
    sha256: sha256(readFileSync(filePath)),
    filePath,
    page1Path,
    latexSourcePath,
    logPath,
    unavailableProbePath,
    latexSource: existsSync(latexSourcePath) ? readFileSync(latexSourcePath, 'utf8') : '',
    logText: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '',
  };
}

function loadRealArtifact(root, label) {
  const designDir = path.join(root, `design-${label.toLowerCase()}`);
  const inputProfilePath = path.join(root, 'inputs', `profile-${label.toLowerCase()}.md`);
  const inputPostingPath = path.join(root, 'inputs', `posting-${label.toLowerCase()}.md`);
  const profileText = readFileSync(inputProfilePath, 'utf8');
  const postingText = readFileSync(inputPostingPath, 'utf8');
  const manifest = readJson(path.join(designDir, 'manifest.json'));
  const artifact = {
    label,
    designId: manifest.designId,
    synthetic: false,
    profileText,
    postingText,
    profile: profileInfo(profileText),
    posting: postingInfo(postingText, label),
    ir: readJson(path.join(designDir, 'ir.json')),
    ledger: readJson(path.join(designDir, 'ledger.json')),
    qa: readJson(path.join(designDir, 'qa.json')),
    manifest,
    renderEvidence: {},
    artifactContent: '',
    surfaceFiles: [],
  };
  if (manifest.profileSha256 !== sha256(profileText)) throw new Error(`${label} profileSha256 does not match frozen input`);
  if (manifest.postingSha256 !== sha256(postingText)) throw new Error(`${label} postingSha256 does not match frozen input`);
  for (const render of manifest.renders || []) {
    const evidence = loadRender(designDir, render);
    artifact.renderEvidence[render.renderId] = evidence;
    artifact.artifactContent += `${evidence.extraction.text}\n`;
  }
  if (manifest.lane?.transcript) {
    const transcriptPath = confined(root, manifest.lane.transcript, 'lane.transcript');
    if (existsSync(transcriptPath)) artifact.surfaceFiles.push(readFileSync(transcriptPath, 'utf8'));
  }
  return artifact;
}

function loadReview(root) {
  const reviewDir = path.join(root, 'review');
  if (!existsSync(reviewDir)) return null;
  const review = {
    criterionReport: existsSync(path.join(reviewDir, 'criterion-report.md')) ? readFileSync(path.join(reviewDir, 'criterion-report.md'), 'utf8') : '',
    visualAttestation: existsSync(path.join(reviewDir, 'visual-attestation.json')) ? readJson(path.join(reviewDir, 'visual-attestation.json')) : null,
    blind: {
      packet: existsSync(path.join(reviewDir, 'blind', 'packet.sha256')) ? readFileSync(path.join(reviewDir, 'blind', 'packet.sha256'), 'utf8') : '',
      response: existsSync(path.join(reviewDir, 'blind', 'response.raw.txt')) ? readFileSync(path.join(reviewDir, 'blind', 'response.raw.txt'), 'utf8') : '',
    },
    routeLog: existsSync(path.join(root, 'benchmark', 'route-log.txt')) ? readFileSync(path.join(root, 'benchmark', 'route-log.txt'), 'utf8') : '',
  };
  return review;
}

export function loadEvidenceBundle(root = EVIDENCE_ROOT) {
  const evidenceRoot = path.resolve(root);
  const artifacts = {};
  for (const label of ['A', 'B']) {
    try {
      artifacts[label] = loadRealArtifact(evidenceRoot, label);
    } catch (error) {
      artifacts[label] = { label, loadError: `${label} bundle unavailable: ${error.message}`, profile: null, manifest: null, ir: null, ledger: null, qa: null, renderEvidence: {}, surfaceFiles: [] };
    }
  }
  return { schemaVersion: 1, evidenceRoot, conformance: false, artifacts, review: loadReview(evidenceRoot) };
}

export function criterionDescription(id) {
  const descriptions = {
    'RR-01': 'Evidence provenance and claim integrity',
    'RR-02': 'Candidate ownership and role compatibility',
    'RR-03': 'Chronology and employer/title credibility',
    'RR-04': 'Neutral summary and no candidate-facing metadata',
    'RR-05': 'Target-company/title leakage prevention',
    'RR-06': 'Achievement specificity and source-backed results',
    'RR-07': 'Requirement coverage without keyword-only fabrication',
    'RR-08': 'Content depth and recruiter scanability',
    'RR-09': 'Grouped skills and information architecture',
    'RR-10': 'ATS-safe text: reading order, Unicode, links, contact',
    'RR-11': 'Visual quality: hierarchy, density, whitespace, clipping, overlap, page breaks',
    'RR-12': 'Canonical IR parity and rendering determinism',
    'RR-13': 'Lightweight LaTeX backend compilation and native text',
    'RR-14': 'Independent review and blind scores',
  };
  return descriptions[id] || id;
}

export const frozenRequirementTables = KEYED_REQUIREMENTS;
export const forbiddenSurfaceSets = FORBIDDEN_SURFACES;
