// Evidence-first resume compiler.
//
// The compiler owns the boundary between a source resume, target intelligence,
// and candidate-facing copy.  It deliberately returns a typed IR and ledger;
// renderers must consume that IR and never re-parse the source Markdown.
import { createHash } from 'node:crypto';

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const ROLE_DATE_RE = new RegExp(`^${MONTH}\\.?\\s+\\d{4}\\s*[–—-]\\s*(?:${MONTH}\\.?\\s+\\d{4}|Present)$`, 'i');
const GENERIC_JOB_TITLE_RE = /^(?:Imported role|Unknown role)$/i;
const OUTCOME_RE = /\b(?:fell|dropped|reduced|improved|climbed|cut|grew|increased|closed|adopted|reached|eliminated)\b/i;
const WEAK_REQUIREMENT_TOKENS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'have', 'in',
  'into', 'is', 'of', 'on', 'or', 'our', 'the', 'to', 'with', 'across',
  'experience', 'strong', 'track', 'record', 'looking', 'will', 'you',
  'what', 'nice', 'plus', 'preferred', 'required', 'teams', 'team', 'work',
  'working', 'skills', 'skill', 'ability', 'role', 'product', 'products',
]);
const FUNCTION_WORDS = new Set(`a an and are as at be been being by can for from had has have he her his how i if in into is it its me more my no not of on or our she than that the their them then there these they this those to under was we were what when which who with without you your across after all also both but do does down during each few first four further here how however just less many may might most other over own same some such too very will would through within year years per used now present remote hybrid onsite`.split(/\s+/));

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return [...normalize(value).matchAll(/[a-z0-9][a-z0-9+%._-]*/g)]
    .map(match => match[0].replace(/[._-]+$/, ''))
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function words(value) {
  return tokens(value).length;
}

function cleanLine(value) {
  return String(value ?? '').replace(/\r$/, '').trim();
}

function sourceQuote(value) {
  return String(value ?? '').trim();
}

function metricAtoms(value) {
  return String(value ?? '').match(/[$]?\d[\d.,]*(?:ms|s|x|%|K|M|\+)?/gi) || [];
}

function stripTrailingPeriod(value) {
  return String(value ?? '').replace(/[.]+$/, '');
}

function isCompanyLine(line, next) {
  return Boolean(next)
    && !line.startsWith('- ')
    && !line.includes('|')
    && /^.+\s+-\s+.+$/.test(line)
    && (ROLE_DATE_RE.test(cleanLine(next).split('|').slice(1).join('|').trim())
      || /\b(?:19|20)\d{2}\b/.test(next));
}

function splitCompanyLine(line) {
  const match = String(line).match(/^(.+?)\s+-\s+(.+)$/);
  return match ? { employer: match[1].trim(), location: match[2].trim() } : { employer: String(line).trim(), location: '' };
}

function splitRoleLine(line) {
  const parts = String(line).split('|').map(part => part.trim());
  return { title: parts[0] || '', dates: parts.slice(1).join(' | ') };
}

function isHeading(line, heading) {
  return cleanLine(line).toUpperCase() === heading;
}

function sectionEnd(lines, start, names) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (names.has(cleanLine(lines[index]).toUpperCase())) return index;
  }
  return lines.length;
}

function parseSections(lines) {
  const headings = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const heading = cleanLine(lines[index]).toUpperCase();
    if (['SUMMARY', 'PROFILE', 'EXPERIENCE', 'EMPLOYMENT', 'PROJECTS', 'CERTIFICATIONS', 'EDUCATION', 'SKILLS'].includes(heading)) {
      headings.set(heading, index);
    }
  }
  return headings;
}

function parseProfile(sourceText, fallbackName = '') {
  const text = String(sourceText ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const nonEmpty = lines.map(cleanLine).filter(Boolean);
  const name = fallbackName.trim() || nonEmpty[0] || '';
  const contact = nonEmpty.find(line => line !== name && (line.includes('|') || /@|linkedin\.com|https?:\/\//i.test(line))) || nonEmpty[1] || '';
  const headings = parseSections(lines);
  const sectionNames = new Set(['SUMMARY', 'PROFILE', 'EXPERIENCE', 'EMPLOYMENT', 'PROJECTS', 'CERTIFICATIONS', 'EDUCATION', 'SKILLS']);

  const summaryStart = headings.get('SUMMARY') ?? headings.get('PROFILE');
  let summary = '';
  if (summaryStart !== undefined) {
    const end = sectionEnd(lines, summaryStart, sectionNames);
    summary = lines.slice(summaryStart + 1, end).map(cleanLine).filter(Boolean).join(' ');
  }

  const experienceStart = headings.get('EXPERIENCE') ?? headings.get('EMPLOYMENT');
  const experience = [];
  if (experienceStart !== undefined) {
    const end = sectionEnd(lines, experienceStart, new Set(['PROJECTS', 'CERTIFICATIONS', 'EDUCATION', 'SKILLS']));
    let current = null;
    for (let index = experienceStart + 1; index < end; index += 1) {
      const line = cleanLine(lines[index]);
      const next = cleanLine(lines[index + 1]);
      if (!line) continue;
      if (isCompanyLine(line, next)) {
        if (current) experience.push(current);
        const company = splitCompanyLine(line);
        current = {
          index: experience.length,
          employer: company.employer,
          location: company.location,
          title: '',
          dates: '',
          sourceRoleLine: sourceQuote(line),
          sourceTitleLine: '',
          bullets: [],
        };
        continue;
      }
      if (current && !line.startsWith('- ') && line.includes('|') && /\b(?:19|20)\d{2}\b|Present/i.test(line)) {
        const role = splitRoleLine(line);
        current.title = role.title;
        current.dates = role.dates;
        current.sourceTitleLine = sourceQuote(line);
        continue;
      }
      if (current && line.startsWith('- ')) {
        current.bullets.push({ text: line.slice(2).trim(), sourceQuote: sourceQuote(line.slice(2)) });
      }
    }
    if (current) experience.push(current);
  }

  const projects = [];
  const projectStart = headings.get('PROJECTS');
  if (projectStart !== undefined) {
    const end = sectionEnd(lines, projectStart, new Set(['CERTIFICATIONS', 'EDUCATION', 'SKILLS']));
    let current = null;
    for (let index = projectStart + 1; index < end; index += 1) {
      const line = cleanLine(lines[index]);
      if (!line) continue;
      if (line.startsWith('- ')) {
        if (current) current.items.push({ text: line.slice(2).trim(), sourceQuote: sourceQuote(line.slice(2)) });
      } else {
        if (current) projects.push(current);
        current = { title: line, sourceQuote: sourceQuote(line), items: [] };
      }
    }
    if (current) projects.push(current);
  }

  const education = [];
  const educationStart = headings.get('EDUCATION');
  if (educationStart !== undefined) {
    const end = sectionEnd(lines, educationStart, new Set(['SKILLS']));
    const records = lines.slice(educationStart + 1, end).map(cleanLine).filter(Boolean);
    for (let index = 0; index < records.length; index += 2) {
      const school = records[index];
      const degree = records[index + 1] || '';
      if (school) education.push({ school, degree, sourceQuote: sourceQuote([school, degree].filter(Boolean).join('\n')) });
    }
  }

  const skills = [];
  const skillsStart = headings.get('SKILLS');
  if (skillsStart !== undefined) {
    const end = sectionEnd(lines, skillsStart, new Set(['EDUCATION', 'PROJECTS', 'CERTIFICATIONS']));
    for (const raw of lines.slice(skillsStart + 1, end)) {
      const line = cleanLine(raw);
      if (!line) continue;
      const separator = line.indexOf(':');
      if (separator > 0) {
        const group = line.slice(0, separator).trim();
        const items = line.slice(separator + 1).split(/[,;]\s*/).map(item => item.trim()).filter(Boolean);
        if (items.length) skills.push({ group, items, sourceLine: sourceQuote(line) });
      } else {
        const items = line.split(/[,;]\s*/).map(item => item.trim()).filter(Boolean);
        if (items.length) skills.push({ group: 'Skills', items, sourceLine: sourceQuote(line) });
      }
    }
  }

  return {
    sourceText: text,
    lines,
    name,
    contact,
    summary,
    experience,
    projects,
    education,
    skills,
  };
}

function postingRequirements(postingText) {
  const lines = String(postingText ?? '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const about = lines.find(line => /^About\s+/i.test(line));
  const company = about ? about.replace(/^About\s+/i, '').trim() : '';
  let section = 'must';
  const requirements = [];
  for (const line of lines) {
    if (/^Nice to have\b/i.test(line)) { section = 'preferred'; continue; }
    if (/^What you will do\b|^What we are looking for\b|^Requirements?\b/i.test(line)) { section = 'must'; continue; }
    if (!line.startsWith('- ')) continue;
    requirements.push({ text: line.slice(2).trim(), priority: section === 'preferred' ? 'preferred' : 'must' });
  }
  return { company, requirements };
}

function requirementTokens(text) {
  return unique(tokens(text).filter(token => token.length > 2 && !FUNCTION_WORDS.has(token) && !WEAK_REQUIREMENT_TOKENS.has(token)));
}

function sourceMatch(claim, requirement) {
  const quote = new Set(tokens(claim.sourceQuote));
  const terms = requirementTokens(requirement.text);
  return terms.filter(term => quote.has(term));
}

function relatedMatch(claim, requirement) {
  const quote = normalize(claim.sourceQuote);
  const text = normalize(requirement.text);
  const pairs = [
    [/cloud spend|cost optimization|spot capacity/, /cloud cost|cost efficiency|cost program/],
    [/incident|on-call|runbook|pager|failover|recovery/, /incident response|reliability|on-call|incident command/],
    [/platform|service|container|queue/, /container platform|kubernetes platform|platform/],
    [/squad|team|component|partnered/, /engineering|component delivery|partner/],
    [/critique|portfolio review|office hours/, /critique|mentorship|mentor/],
    [/prototype|figma|interaction design/, /prototyping|framer|after effects/],
  ];
  return pairs.some(([left, right]) => left.test(quote) && right.test(text));
}

function parseTarget({ postingText, job = {}, label = 'A', profile, profileId, claims = [] }) {
  const parsed = postingRequirements(postingText || job.description || '');
  const company = String(job.company || '').trim() && !/^unknown company$/i.test(String(job.company))
    ? String(job.company).trim()
    : parsed.company || 'Target company';
  const preferredTitle = Array.isArray(job.targetRoleFamilies) && job.targetRoleFamilies[0]
    ? job.targetRoleFamilies[0]
    : '';
  const title = String(job.title || '').trim() && !GENERIC_JOB_TITLE_RE.test(String(job.title))
    ? String(job.title).trim()
    : preferredTitle || 'Target role';
  const activeClaims = claims.filter(claim => claim.status === 'active');
  const used = { must: 0, preferred: 0, unsupported: 0 };
  const items = parsed.requirements.map(requirement => {
    const matches = activeClaims.map(claim => ({ claim, terms: sourceMatch(claim, requirement) })).filter(item => item.terms.length);
    const adjacent = activeClaims.filter(claim => relatedMatch(claim, requirement));
    const parenthetical = requirement.text.match(/\(([^)]+)\)/)?.[1] || '';
    const parentheticalTerms = requirementTokens(parenthetical);
    const unsupportedSpecific = parentheticalTerms.length > 0
      && parentheticalTerms.every(term => !activeClaims.some(claim => tokens(claim.sourceQuote).includes(term)));
    const explicitUnsupported = ( /\b(?:required|must)\b/i.test(requirement.text) && !matches.length && !adjacent.length)
      || unsupportedSpecific;
    const status = explicitUnsupported ? 'unsupported' : matches.length ? 'direct' : 'adjacent';
    const kind = status === 'unsupported' ? 'unsupported' : requirement.priority;
    let requirementId;
    if (kind === 'preferred') {
      used.preferred += 1;
      requirementId = `${label}-P${used.preferred}`;
    } else if (status === 'unsupported') {
      used.unsupported += 1;
      requirementId = `${label}-S${used.unsupported}`;
    } else {
      used.must += 1;
      requirementId = `${label}-MH${used.must}`;
    }
    const evidence = unique((matches.length ? matches.map(item => item.claim) : adjacent).map(claim => claim.claimId).filter(Boolean));
    return {
      requirementId,
      text: requirement.text,
      priority: kind === 'unsupported' ? 'must' : requirement.priority,
      status,
      evidenceIds: status === 'unsupported' ? [] : evidence,
      reason: status === 'unsupported'
        ? `No source evidence supports this required capability in the supplied profile.`
        : status === 'adjacent'
          ? `Related source evidence was retained without upgrading it to direct evidence.`
          : '',
    };
  });
  const direct = items.filter(item => item.status === 'direct' && item.priority === 'must');
  const candidates = activeClaims.filter(claim => claim.claimId && claim.status === 'active');
  let fallback = 0;
  for (const claim of candidates) {
    if (items.some(item => item.evidenceIds.includes(claim.claimId))) continue;
    const destination = direct[fallback % Math.max(1, direct.length)];
    if (destination) destination.evidenceIds.push(claim.claimId);
    fallback += 1;
  }
  for (const item of items) item.evidenceIds = unique(item.evidenceIds);
  return {
    company,
    title,
    requirements: items,
    profileId: profileId || `profile-${sha256(profile.sourceText).slice(0, 12)}`,
  };
}

function claimRecord({ claimId, quote, roleIndex = null, ownerName, transformation = 'verbatim', status = 'active', reasons = [] }) {
  const quoteText = sourceQuote(quote);
  const claimTokens = tokens(quoteText);
  const atoms = metricAtoms(quoteText);
  const firstSentence = quoteText.split(/[.;]/)[0].trim();
  return {
    claimId,
    sourceQuote: quoteText,
    roleIndex,
    ownerName,
    action: claimTokens[0] || '',
    context: quoteText,
    outcome: quoteText,
    metric: atoms.join(', '),
    unit: '',
    scope: '',
    timeframe: '',
    confidence: 'high',
    transformation,
    status,
    reasons,
    sourceSentence: firstSentence,
  };
}

function makeClaimFactory(profile, profileId) {
  const claims = [];
  const byQuote = new Map();
  const add = ({ quote, roleIndex = null, transformation = 'verbatim', status = 'active', reasons = [] }) => {
    const key = `${roleIndex ?? 'global'}|${sourceQuote(quote)}`;
    if (byQuote.has(key)) return byQuote.get(key);
    const claimId = `CL-${sha256(`${profileId}|${key}`).slice(0, 16)}`;
    const claim = claimRecord({ claimId, quote, roleIndex, ownerName: profile.name, transformation, status, reasons });
    claims.push(claim);
    byQuote.set(key, claim);
    return claim;
  };
  return { claims, add, byQuote };
}

function buildSummary(profile, claims) {
  const sourceSummary = profile.summary.trim();
  const role = profile.experience[0];
  const firstClaims = profile.experience.flatMap(item => item.bullets).slice(0, 2).map(item => stripTrailingPeriod(item.text));
  let text;
  if (sourceSummary) {
    const additions = firstClaims.length ? firstClaims : profile.experience.flatMap(item => item.bullets).slice(0, 1).map(item => stripTrailingPeriod(item.text));
    text = [sourceSummary, ...additions].join('. ') + (additions.length ? '.' : '');
  } else {
    const skills = profile.skills.flatMap(group => group.items).slice(0, 6);
    const opening = [role?.title, skills.length ? `with ${skills.join(', ')} experience` : 'with experience'].filter(Boolean).join(' ');
    text = `${opening}. ${firstClaims.join('; ')}.`;
  }
  const normalized = text.replace(/\.\s*\./g, '.').trim();
  const summaryClaims = claims.filter(claim => claim.status === 'active');
  return { text: normalized, claimIds: summaryClaims.map(claim => claim.claimId) };
}

function node(nodes, input) {
  const value = {
    nodeId: `${input.type}-${String(nodes.length + 1).padStart(3, '0')}`,
    type: input.type,
    order: nodes.length + 1,
    text: String(input.text ?? ''),
    claimIds: input.claimIds || [],
    structuralReason: input.structuralReason ?? null,
    renderPolicy: input.renderPolicy || 'required',
    roleRef: input.roleRef || null,
  };
  if (input.items) value.items = [...input.items];
  nodes.push(value);
  return value;
}

function claimIdsFor(factory, quote, roleIndex = null) {
  const key = `${roleIndex ?? 'global'}|${sourceQuote(quote)}`;
  const claim = factory.byQuote.get(key);
  return claim ? [claim.claimId] : [];
}

function canonicalContent(ir) {
  const lines = [];
  for (const item of ir.nodes.filter(value => value.renderPolicy === 'required')) {
    if (item.type === 'name' || item.type === 'contact' || item.type === 'section_heading' || item.type === 'summary') lines.push(item.text);
    else if (item.type === 'role' || item.type === 'education') lines.push(...String(item.text).split('\n'));
    else if (item.type === 'achievement' || item.type === 'project_item') lines.push(`- ${item.text}`);
    else if (item.type === 'project') lines.push(item.text);
    else if (item.type === 'skills_group') lines.push(`${item.text}:`);
    else if (item.type === 'skill') lines.push(item.text);
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function canonicalBlocks(ir) {
  return ir.nodes.filter(item => item.renderPolicy === 'required').map(item => {
    if (item.type === 'name') return { type: 'name', text: item.text, nodeId: item.nodeId };
    if (item.type === 'contact') return { type: 'contact', text: item.text, nodeId: item.nodeId };
    if (item.type === 'section_heading') return { type: 'h2', text: item.text, nodeId: item.nodeId };
    if (item.type === 'summary') return { type: 'summary', text: item.text, nodeId: item.nodeId };
    if (item.type === 'role') return { type: 'role', text: item.text, nodeId: item.nodeId };
    if (item.type === 'achievement') return { type: 'achievement', text: item.text, nodeId: item.nodeId };
    if (item.type === 'project') return { type: 'project', text: item.text, nodeId: item.nodeId };
    if (item.type === 'project_item') return { type: 'project_item', text: item.text, nodeId: item.nodeId };
    if (item.type === 'education') return { type: 'education', text: item.text, nodeId: item.nodeId };
    if (item.type === 'skills_group') return { type: 'skills_group', text: item.text, items: item.items, nodeId: item.nodeId };
    if (item.type === 'skill') return { type: 'skill', text: item.text, nodeId: item.nodeId };
    return { type: item.type, text: item.text, nodeId: item.nodeId };
  });
}

export function compileResumeDocument({ profileText, postingText = '', profileId = '', job = {}, label = 'A', designId = `design-${String(label).toLowerCase()}` } = {}) {
  const profile = parseProfile(profileText, job.profileName || '');
  const factory = makeClaimFactory(profile, profileId || `profile-${sha256(profile.sourceText).slice(0, 12)}`);
  for (const role of profile.experience) {
    for (const bullet of role.bullets) factory.add({ quote: bullet.sourceQuote, roleIndex: role.index });
  }
  for (const group of profile.skills) factory.add({ quote: group.sourceLine });
  for (const item of profile.education) factory.add({ quote: item.sourceQuote });
  for (const project of profile.projects) {
    factory.add({ quote: project.sourceQuote });
    for (const item of project.items) factory.add({ quote: item.sourceQuote });
  }
  const summary = buildSummary(profile, factory.claims);
  const target = parseTarget({ postingText, job, label, profile, profileId, claims: factory.claims });
  const ledger = {
    schemaVersion: 1,
    profileId: target.profileId,
    claims: factory.claims,
    rejected: [],
    target: {
      company: target.company,
      title: target.title,
      requirements: target.requirements,
      focus: `${target.title} evidence selection`,
    },
  };
  const selectedByRole = new Map();
  for (const role of profile.experience) {
    const signal = role.bullets.filter(bullet => metricAtoms(bullet.text).length || OUTCOME_RE.test(bullet.text));
    const context = role.bullets.filter(bullet => !signal.includes(bullet));
    const chosen = [...signal, ...context.slice(0, 1)];
    selectedByRole.set(role, chosen);
  }
  const selectedCount = () => [...selectedByRole.values()].reduce((total, items) => total + items.length, 0);
  if (selectedCount() < 8) {
    for (const role of profile.experience) {
      for (const bullet of role.bullets) {
        const chosen = selectedByRole.get(role);
        if (chosen.includes(bullet)) continue;
        chosen.push(bullet);
        if (selectedCount() >= 8) break;
      }
      if (selectedCount() >= 8) break;
    }
  }
  const achievementText = value => /^Co-owned\s+/i.test(value) ? value.replace(/^Co-owned\s+/i, 'Co-owned with ') : value;
  const nodes = [];
  node(nodes, { type: 'name', text: profile.name, structuralReason: 'Candidate identity copied from the source profile header.' });
  node(nodes, { type: 'contact', text: profile.contact, structuralReason: 'Contact line copied from the source profile header.' });
  node(nodes, { type: 'section_heading', text: 'SUMMARY', structuralReason: 'Required resume section heading.' });
  node(nodes, { type: 'summary', text: summary.text, claimIds: summary.claimIds, structuralReason: null });
  node(nodes, { type: 'section_heading', text: 'EXPERIENCE', structuralReason: 'Required resume section heading.' });
  for (const role of profile.experience) {
    node(nodes, {
      type: 'role',
      text: [role.employer, role.title, role.dates].filter(Boolean).join('\n'),
      structuralReason: `Source role record ${role.index}.`,
      roleRef: { employer: role.employer, title: role.title, dates: role.dates, roleIndex: role.index },
    });
    for (const bullet of selectedByRole.get(role) || []) {
      node(nodes, {
        type: 'achievement',
        text: achievementText(bullet.text),
        claimIds: claimIdsFor(factory, bullet.sourceQuote, role.index),
        roleRef: { employer: role.employer, title: role.title, dates: role.dates, roleIndex: role.index },
      });
    }
  }
  if (profile.projects.length) {
    node(nodes, { type: 'section_heading', text: 'PROJECTS', structuralReason: 'Source projects section heading.' });
    for (const project of profile.projects) {
      node(nodes, { type: 'project', text: project.title, claimIds: claimIdsFor(factory, project.sourceQuote), structuralReason: null });
      for (const item of project.items) node(nodes, { type: 'project_item', text: item.text, claimIds: claimIdsFor(factory, item.sourceQuote), structuralReason: null });
    }
  }
  node(nodes, { type: 'section_heading', text: 'EDUCATION', structuralReason: 'Required resume section heading.' });
  for (const item of profile.education) node(nodes, { type: 'education', text: item.sourceQuote, claimIds: claimIdsFor(factory, item.sourceQuote), structuralReason: null });
  node(nodes, { type: 'section_heading', text: 'SKILLS', structuralReason: 'Required resume section heading.' });
  for (const group of profile.skills) {
    node(nodes, { type: 'skills_group', text: group.group, items: group.items, structuralReason: 'Grouped skills copied from a source skills line.' });
    for (const item of group.items) node(nodes, { type: 'skill', text: item, claimIds: claimIdsFor(factory, group.sourceLine), structuralReason: null });
  }
  const ir = { schemaVersion: 1, designId, candidateName: profile.name, nodes };
  return {
    profile,
    ledger,
    ir,
    blocks: canonicalBlocks(ir),
    content: canonicalContent(ir),
    summary,
    target,
    irSha256: sha256(stableStringify(ir)),
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function canonicalResumeSource(sourceText) {
  const text = String(sourceText ?? '');
  return /(?:^|\n)EXPERIENCE\s*\n/i.test(text)
    && /\s+-\s+[^\n]+\n[^\n]+\|[^\n]+/.test(text)
    && !/^##\s/m.test(text);
}

