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
const PROJECT_SUBSTANTIVE_RE = /\b(?:fell|dropped|reduced|improved|climbed|cut|grew|increased|closed|adopted|reached|eliminated|built|created|designed|shipped|launched|delivered|automated|migrated|used by|adopted by)\b/i;
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

function sentence(value) {
  const text = stripTrailingPeriod(value).trim();
  return text ? text + '.' : '';
}

function joinList(values) {
  const items = values.filter(Boolean);
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items.at(-1);
}

function contentTokens(value) {
  return unique(tokens(value).filter(token => token.length > 2 && !FUNCTION_WORDS.has(token) && !/^\d+$/.test(token)));
}

function projectItemHasSubstantiveEvidence(item) {
  return metricAtoms(item.text).length > 0 || PROJECT_SUBSTANTIVE_RE.test(item.text);
}

function selectProjects(projects, experience) {
  const experienceText = experience
    .flatMap(role => [role.employer, role.title, role.dates, ...role.bullets.map(bullet => bullet.text)])
    .join(' ');
  const normalizedExperience = normalize(experienceText);
  const experienceTokens = new Set(contentTokens(experienceText));

  return projects.map(project => {
    const titleTokens = contentTokens(project.title).filter(token => !/^\d+$/.test(token));
    const titlePhrase = normalize(titleTokens.join(' '));
    const titleOverlapsExperience = titleTokens.length >= 2
      && (titlePhrase && normalizedExperience.includes(titlePhrase)
        || titleTokens.filter(token => experienceTokens.has(token)).length / titleTokens.length >= 0.75);
    if (!titleOverlapsExperience) return project.items.length ? project : null;

    const uniqueSubstantiveItems = project.items.filter(item => {
      if (!projectItemHasSubstantiveEvidence(item)) return false;
      const itemTokens = contentTokens(item.text);
      const overlap = itemTokens.length
        ? itemTokens.filter(token => experienceTokens.has(token)).length / itemTokens.length
        : 0;
      const exactDuplicate = normalize(item.text) && normalizedExperience.includes(normalize(item.text));
      return !exactDuplicate && overlap < 0.8;
    });
    return uniqueSubstantiveItems.length ? { ...project, items: uniqueSubstantiveItems } : null;
  }).filter(Boolean);
}

function isCompanyLine(line, next) {
  return Boolean(next)
    && !line.startsWith('- ')
    && !line.includes('|')
    && Boolean(line.trim())
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

function isPrivateHeading(line) {
  return /^(?:#{1,6}\s*)?(?:PRIVATE|INTERNAL|PREFERENCES|BOUNDARIES|AUDIT|STRATEGY|LOGISTICS|PROOF VERIFICATION|ADDITIONAL NOTES)\b/i.test(cleanLine(line));
}

function sectionEnd(lines, start, names) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isPrivateHeading(lines[index]) || names.has(cleanLine(lines[index]).toUpperCase())) return index;
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

function splitSkillItems(text) {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[,;]/.test(text[index])) {
      items.push(text.slice(start, index).trim().replace(/\.$/, ''));
      start = index + 1;
    }
  }
  items.push(text.slice(start).trim().replace(/\.$/, ''));
  return items.filter(Boolean);
}

function parseProfile(sourceText, fallbackName = '', sourceFormat = 'normalized') {
  const text = String(sourceText ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const nonEmpty = lines.map(cleanLine).filter(Boolean);
  const name = fallbackName.trim() || nonEmpty[0] || '';
  if (!name || /^(?:summary|profile|experience|employment|education|skills|projects|name)$/i.test(name)
      || /@|https?:\/\/|\|/.test(name) || name.split(/\s+/).length < 2) {
    throw Object.assign(new Error('A candidate name must be supplied in the profile header.'), { code: 'resume_identity_missing' });
  }
  const firstSection = lines.findIndex(line => /^(?:SUMMARY|PROFILE|EXPERIENCE|EMPLOYMENT|PROJECTS|CERTIFICATIONS|EDUCATION|SKILLS)$/i.test(cleanLine(line)) || isPrivateHeading(line));
  const headerLines = lines.slice(0, firstSection < 0 ? lines.length : firstSection).map(cleanLine).filter(Boolean);
  const contact = headerLines.find(line => line !== name && (line.includes('|') || /@|linkedin\.com|https?:\/\//i.test(line))) || '';
  if (!/@[^\s|]+\.[^\s|]+/.test(contact)) {
    throw Object.assign(new Error('A selected applicant email is required in the profile contact line.'), { code: 'resume_contact_missing' });
  }
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
    for (let index = 0; index < records.length; index += sourceFormat === 'migrated_legacy' ? 1 : 2) {
      const school = records[index];
      const degree = sourceFormat === 'migrated_legacy' ? '' : records[index + 1] || '';
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
        const items = splitSkillItems(line.slice(separator + 1));
        if (items.length) skills.push({ group, items, sourceLine: sourceQuote(line) });
      } else {
        const items = splitSkillItems(line);
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

export function postingRequirements(postingText) {
  const lines = String(postingText ?? '').split(/\r?\n/).map(cleanLine);
  const about = lines.find(line => /^About\s+/i.test(line));
  const company = about ? about.replace(/^About\s+/i, '').trim() : '';
  let section = 'contextual';
  const requirements = [];
  for (const [lineIndex, line] of lines.entries()) {
    if (/^(?:Nice to have|Preferred)\b/i.test(line)) { section = 'preferred'; continue; }
    if (/^(?:What you will do|Responsibilities)\b/i.test(line)) { section = 'contextual'; continue; }
    if (/^(?:What we are looking for|Requirements?)\b/i.test(line)) { section = 'required'; continue; }
    if (!line.startsWith('- ')) continue;
    requirements.push({ text: line.slice(2).trim(), priority: section, sourceLine: lineIndex + 1 });
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

function semanticCoverage(claim, requirement) {
  const source = normalize(claim.sourceQuote);
  const target = normalize(requirement.text);
  // These actions are materially different even when their surrounding nouns overlap.
  const distinctions = [
    [/\bschedul(?:e|ing)\b.*\binterview/, /\b(?:screen|participat|interviewed|assist)\w*\b/],
    [/\bhir(?:e|ed|ing)\b.*\b(?:designer|team|staff)/, /\b(?:design|creat|deliver)\w*\b.*\b(?:learning|material|training)/],
  ];
  if (distinctions.some(([need, adjacent]) => need.test(target) && adjacent.test(source) && !need.test(source))) return 'adjacent';
  const terms = requirementTokens(requirement.text);
  const matched = sourceMatch(claim, requirement);
  if (terms.length && matched.length >= Math.max(2, Math.ceil(terms.length * 0.6))) return 'direct';
  const analogues = [
    [/interview|recruit|candidate|hiring/, /screen|interview|recruit|candidate/],
    [/scheduling|coordination|calendar/, /stakeholder|client|follow-through|coordination/],
    [/customer education|academy|enablement/, /onboard|training|tutorial|documentation/],
    [/instructional|learning|curriculum/, /learning|instruction|training|education/],
    [/many moving pieces|stay calm|shifting priorities/, /shifting priorities|managed client engagements/],
    [/inefficien|improv.*operate/, /product improvements|AI-enabled workflows|operating documentation/],
    [/cross-functional delivery|product and technical teams/, /liaison between clients and technical teams/],
    [/on-demand|self-paced|interactive simulations/, /tutorial|self-service|spaced repetition|onboarding MVP/],
    [/credential ladder|certified credential/, /certify loop|certification|badging/],
    [/academy as a product|own the academy/, /workplace-learning and onboarding MVP|product decisions|professional-development platform/],
    [/content operations/, /instructional content|learning materials|tutorial|documentation/],
  ];
  if (analogues.some(([need, evidence]) => need.test(target) && evidence.test(source))) return 'adjacent';
  return (matched.length >= 2 && matched.length / Math.max(1, terms.length) >= 0.35) || relatedMatch(claim, requirement)
    ? 'adjacent' : 'unknown';
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
    const direct = activeClaims.filter(claim => semanticCoverage(claim, requirement) === 'direct');
    const adjacent = activeClaims.filter(claim => semanticCoverage(claim, requirement) === 'adjacent');
    const allEvidence = activeClaims.map(claim => normalize(claim.sourceQuote)).join(' ');
    const specificCapabilities = [
      [/\b(?:ashby|ats)\b/i, /\b(?:ashby|ats|applicant tracking system)\b/i],
      [/\b(?:full scheduling|interview scheduling|calendar invite timezone)\b/i, /\b(?:scheduled interviews|interview scheduling|calendar coordination)\b/i],
      [/\bhigh.volume\b/i, /\bhigh.volume\b/i],
      [/\b\d+\+? years\b/i, /\b\d+\+? years\b/i],
      [/\bhire and lead\b/i, /\b(?:hired|hiring|led a team of instructional designers)\b/i],
      [/\b(?:cpe|ce accreditation|accreditation)\b/i, /\b(?:cpe|ce accreditation|accreditation)\b/i],
      [/\b(?:accounting|finance|regulated industry)\b/i, /\b(?:accounting|finance|regulated industry)\b/i],
      [/\b(?:adoption, retention|adoption and retention|product adoption, retention)\b/i, /\b(?:adoption|retention)\b/i],
      [/\b(?:production software engineering|kubernetes)\b/i, /\b(?:production software engineering|kubernetes)\b/i],
    ];
    const missingSpecific = specificCapabilities.some(([needed, proof]) => needed.test(requirement.text) && !proof.test(allEvidence));
    const parenthetical = requirement.text.match(/\(([^)]+)\)/)?.[1] || '';
    const parentheticalTerms = requirementTokens(parenthetical);
    const unsupportedSpecific = parentheticalTerms.length > 0
      && parentheticalTerms.every(term => !activeClaims.some(claim => tokens(claim.sourceQuote).includes(term)));
    const explicitUnsupported = missingSpecific || unsupportedSpecific || (/\b(?:required|must)\b/i.test(requirement.text) && !direct.length && !adjacent.length);
    const status = explicitUnsupported ? 'unsupported' : direct.length ? 'direct' : adjacent.length ? 'adjacent' : 'unknown';
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
    const supporters = direct.length ? direct : adjacent;
    const evidence = unique([...supporters]
      .sort((a, b) => sourceMatch(b, requirement).length - sourceMatch(a, requirement).length
        || a.sourceQuote.length - b.sourceQuote.length
        || a.claimId.localeCompare(b.claimId))
      .slice(0, 2).map(claim => claim.claimId).filter(Boolean));
    return {
      requirementId,
      text: requirement.text,
      sourceLine: requirement.sourceLine,
      priority: requirement.priority,
      status,
      evidenceIds: status === 'unsupported' ? [] : evidence,
      reason: status === 'adjacent' && /academy as a product|own the academy/i.test(requirement.text)
        ? 'Related product and learning work does not establish Academy ownership, roadmap, or outcomes.'
        : status === 'adjacent' && /content operations/i.test(requirement.text)
          ? 'Content creation and L&D operations are related; ongoing product-release content operations are not established.'
        : status === 'adjacent' && /credential ladder|certified credential/i.test(requirement.text)
          ? 'A coursework certify loop is related, but does not establish a shipped credential ladder.'
        : status === 'unsupported'
        ? 'The supplied profile does not establish the specific capability.'
        : status === 'adjacent'
          ? 'Related evidence is present, but does not establish the full requirement.'
          : status === 'unknown' ? 'No source evidence establishes this requirement.' : 'Source wording directly supports this requirement.',
    };
  });
  for (const item of items) item.evidenceIds = unique(item.evidenceIds);
  return {
    company,
    title,
    requirements: items,
    profileId: profileId || `profile-${sha256(profile.sourceText).slice(0, 12)}`,
  };
}

function claimRecord({ claimId, quote, roleIndex = null, ownerId = 'profile', sourceLine = null, sourceMatch = null, normalizedSourceLine = null, ownerName, transformation = 'verbatim', status = 'active', reasons = [], proofPoint = null }) {
  const quoteText = sourceQuote(quote);
  const claimTokens = tokens(quoteText);
  const atoms = metricAtoms(quoteText);
  const firstSentence = quoteText.split(/[.;]/)[0].trim();
  return {
    claimId,
    sourceQuote: quoteText,
    sourceLine,
    sourceMatch,
    normalizedSourceLine,
    ownerId,
    roleIndex,
    ownerName,
    action: claimTokens[0] || '',
    context: quoteText,
    outcome: quoteText,
    metric: atoms.join(', '),
    unit: '',
    scope: '',
    timeframe: '',
    confidence: proofPoint?.status === 'verified' ? 'high' : 'unverified',
    verificationStatus: proofPoint?.status === 'verified' ? 'verified' : 'needs_verification',
    proofPointId: proofPoint?.id || null,
    transformation,
    status,
    reasons,
    sourceSentence: firstSentence,
  };
}

function makeClaimFactory(profile, profileId, proofByQuote = new Map(), originalSourceText = null) {
  const claims = [];
  const byQuote = new Map();
  const originalLines = String(originalSourceText ?? profile.sourceText).split(/\r?\n/);
  const add = ({ quote, roleIndex = null, ownerId = roleIndex == null ? 'profile' : `employment-${roleIndex}`, transformation = 'verbatim', status = 'active', reasons = [] }) => {
    const key = `${ownerId}|${sourceQuote(quote)}`;
    if (byQuote.has(key)) return byQuote.get(key);
    const claimId = `CL-${sha256(`${profileId}|${key}`).slice(0, 16)}`;
    const normalizedSourceLine = profile.lines.findIndex(line => cleanLine(line).replace(/^[-*]\s*/, '') === sourceQuote(quote)) + 1 || null;
    const exactLine = originalLines.findIndex(line => {
      const cleaned = sourceQuote(line).replace(/^[-*]\s*/, '');
      const cited = sourceQuote(quote);
      return cleaned === cited || (cited.length >= 24 && cleaned.includes(cited));
    }) + 1 || null;
    let sourceLine = exactLine;
    if (!sourceLine && originalSourceText && originalSourceText !== profile.sourceText) {
      const cited = new Set(contentTokens(quote));
      const ranked = originalLines.map((line, index) => {
        const terms = new Set(contentTokens(line));
        const overlap = [...cited].filter(term => terms.has(term)).length;
        return { line: index + 1, score: overlap / Math.max(1, cited.size) };
      }).sort((a, b) => b.score - a.score || a.line - b.line);
      if (ranked[0]?.score >= .62 && ranked[0].score - (ranked[1]?.score || 0) >= .06) sourceLine = ranked[0].line;
    }
    const claim = claimRecord({ claimId, quote, roleIndex, ownerId, sourceLine,
      sourceMatch: exactLine ? 'exact' : sourceLine ? 'inferred_legacy_projection' : null,
      ownerName: profile.name,
      transformation: originalSourceText && originalSourceText !== profile.sourceText && !exactLine ? 'legacy_projection' : transformation,
      status, reasons,
      normalizedSourceLine, proofPoint: proofByQuote.get(sourceQuote(quote)) || null });
    claims.push(claim);
    byQuote.set(key, claim);
    return claim;
  };
  return { claims, add, byQuote };
}

function buildSummary(profile, claims, target) {
  const sourceSummary = profile.summary.trim();
  const firstRole = profile.experience.map(role => role.title).find(Boolean) || 'Experience';
  const firstSkills = profile.skills.flatMap(group => group.items).slice(0, 2).join(', ');
  const lead = sourceSummary.split(/(?<=[.!?])\s+/)[0]
    || (firstSkills ? `${firstRole} with experience in ${firstSkills}` : `${firstRole} experience`);
  const headline = /recruit|people|talent/i.test(target.title) ? 'Recruiting and People Operations'
    : /education|learning|training/i.test(target.title) ? 'Customer Education and Learning Design'
    : target.title;

  const skillQuotes = new Set(profile.skills.map(group => sourceQuote(group.sourceLine)));
  const preferredClaims = claims.filter(claim => claim.status === 'active'
    && (skillQuotes.has(claim.sourceQuote) || (sourceSummary && claim.sourceQuote === sourceSummary)));
  const fallbackClaims = claims.filter(claim => claim.status === 'active' && !preferredClaims.includes(claim));
  const summaryClaims = [...preferredClaims, ...fallbackClaims].slice(0, Math.max(2, preferredClaims.length));
  const find = pattern => claims.find(claim => claim.status === 'active' && pattern.test(claim.sourceQuote));
  if (/recruit|people|talent/i.test(target.title)) {
    const recruiting = find(/candidate screening.*job interviews.*skills assessment/i);
    const founder = find(/Founded and operated.*venture/i);
    const coordination = find(/stakeholder follow-through|client engagements/i);
    const harvard = find(/Harvard Graduate School of Education/i);
    const toronto = find(/Industrial Relations\s*\/\s*Human Resources/i);
    const writing = find(/written documentation|operating documentation/i);
    if (recruiting && founder && coordination && harvard && toronto && writing) return {
      text: 'Recruiting Coordinator | People Operations | Harvard GSE graduate with Industrial Relations/HR training, Indofood recruiting support, and founder-level experience coordinating clients and operating details. Brings candidate screening and skills assessment, written documentation, and follow-through.',
      claimIds: unique([recruiting, founder, coordination, harvard, toronto, writing].map(claim => claim.claimId)),
    };
  }
  if (/education|learning|training/i.test(target.title)) {
    const onboarding = find(/designed and delivered client onboarding and training/i);
    const instruction = find(/designed instructional content and learning materials/i);
    const project = find(/workplace-learning and onboarding MVP/i);
    if (onboarding && instruction && project) return {
      text: 'Customer Education and Learning Design | Client onboarding and training delivery, instructional content, and learning-product prototyping.',
      claimIds: unique([onboarding.claimId, instruction.claimId, project.claimId]),
    };
  }
  return { text: `${headline} | ${sentence(lead)}`, claimIds: summaryClaims.map(claim => claim.claimId) };
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
    ownerId: input.ownerId || null,
  };
  if (input.items) value.items = [...input.items];
  nodes.push(value);
  return value;
}

function claimIdsFor(factory, quote, roleIndex = null, ownerId = roleIndex == null ? 'profile' : `employment-${roleIndex}`) {
  const key = `${ownerId}|${sourceQuote(quote)}`;
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
    else if (item.type === 'skills_group') lines.push(`${item.text}: ${(item.items || []).join(', ')}`.trim());
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

export function compileResumeDocument({ profileText, originalSourceText = null, sourceFormat = 'normalized', postingText = '', profileId = '', job = {}, label = 'A', designId = `design-${String(label).toLowerCase()}`, contactEmail = '', locationNote = '', proofPoints = null, activeProofPointIds = null, excludeClaimIds = [], preferClaimIds = [] } = {}) {
  const profile = parseProfile(profileText, job.profileName || '', sourceFormat);
  const sourceContact = profile.contact;
  if (contactEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw Object.assign(new Error('A valid selected contact email is required.'), { code: 'resume_contact_invalid' });
    profile.contact = profile.contact.replace(/[^\s|]+@[^\s|]+\.[^\s|]+/, contactEmail);
  }
  if (locationNote) {
    if (!/^Open to [A-Za-z][A-Za-z ,.-]{1,60}$/.test(locationNote)) {
      throw Object.assign(new Error('Location note must be a short verified applicant-facing “Open to …” phrase.'), { code: 'resume_location_note_invalid' });
    }
    profile.contact = profile.contact.includes(' | ')
      ? profile.contact.replace(' | ', ` | ${locationNote} | `)
      : `${profile.contact} | ${locationNote}`;
  }
  const proofByQuote = new Map((proofPoints || []).map(proof => [sourceQuote(proof.summary), proof]));
  const activeProofs = activeProofPointIds ? new Set(activeProofPointIds) : null;
  const eligible = bullet => {
    if (!proofPoints) return true;
    const proof = proofByQuote.get(sourceQuote(bullet.sourceQuote));
    return Boolean(proof && !proof.retiredAt && proof.status !== 'retired' && (!activeProofs || activeProofs.has(proof.id)));
  };
  for (const role of profile.experience) role.bullets = role.bullets.filter(eligible);
  for (const project of profile.projects) project.items = project.items.filter(eligible);
  const factory = makeClaimFactory(profile, profileId || `profile-${sha256(profile.sourceText).slice(0, 12)}`, proofByQuote, originalSourceText);
  for (const role of profile.experience) {
    for (const bullet of role.bullets) factory.add({ quote: bullet.sourceQuote, roleIndex: role.index });
  }
  if (profile.summary.trim()) factory.add({ quote: profile.summary });
  for (const group of profile.skills) factory.add({ quote: group.sourceLine });
  for (const item of profile.education) factory.add({ quote: item.sourceQuote });
  for (const project of profile.projects) {
    const ownerId = `project-${sha256(project.title).slice(0, 12)}`;
    factory.add({ quote: project.sourceQuote, ownerId });
    for (const item of project.items) factory.add({ quote: item.sourceQuote, ownerId });
  }
  const editableIds = new Set([
    ...profile.experience.flatMap(role => role.bullets.map(bullet => factory.byQuote.get(`employment-${role.index}|${sourceQuote(bullet.sourceQuote)}`)?.claimId)),
    ...profile.projects.flatMap(project => project.items.map(item => factory.byQuote.get(`project-${sha256(project.title).slice(0, 12)}|${sourceQuote(item.sourceQuote)}`)?.claimId)),
  ].filter(Boolean));
  const validateEdit = (ids, field) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !editableIds.has(id))) {
      throw Object.assign(new Error(`${field} must contain only source-linked achievement or project-item claim IDs from this profile.`), { code: 'resume_claim_invalid' });
    }
    return new Set(ids);
  };
  const excluded = validateEdit(excludeClaimIds, 'excludeClaimIds');
  const preferred = validateEdit(preferClaimIds, 'preferClaimIds');
  if ([...excluded].some(id => preferred.has(id))) {
    throw Object.assign(new Error('A claim cannot be both excluded and preferred.'), { code: 'resume_claim_conflict' });
  }
  for (const claim of factory.claims) if (excluded.has(claim.claimId)) {
    claim.status = 'suppressed';
    claim.reasons = ['User selected this source-backed claim for exclusion from this draft.'];
  }
  const target = parseTarget({ postingText, job, label, profile, profileId, claims: factory.claims });
  const summary = buildSummary(profile, factory.claims, target);
  const ledger = {
    schemaVersion: 1,
    profileId: target.profileId,
    claims: factory.claims,
    rejected: [...excluded],
    revisionSelection: { excludeClaimIds: [...excluded], preferClaimIds: [...preferred] },
    target: {
      company: target.company,
      title: target.title,
      requirements: target.requirements,
      focus: `${target.title} evidence selection`,
    },
  };
  const targetTokens = new Set(requirementTokens(`${target.title} ${target.requirements.map(item => item.text).join(' ')}`));
  const relevance = text => {
    const terms = contentTokens(text);
    const overlap = terms.filter(term => targetTokens.has(term)).length;
    const title = normalize(target.title);
    const people = /recruit|people|talent/.test(title);
    const learning = /education|learning|training/.test(title);
    const focus = people ? /recruit|candidate|interview|screen|skills assessment|stakeholder|coordination/i
      : learning ? /onboard|training|learning|tutorial|documentation|instruction|education/i : /product|client|user|workflow|research/i;
    return overlap * 2 + (focus.test(text) ? 4 : 0) + (OUTCOME_RE.test(text) ? 0.5 : 0);
  };
  const selectedByRole = new Map();
  for (const role of profile.experience) {
    const learningMiddle = role.index === 1 && /education|learning|training/i.test(target.title);
    const allowedBullets = role.bullets.filter(bullet => factory.byQuote.get(`employment-${role.index}|${sourceQuote(bullet.sourceQuote)}`)?.status === 'active');
    const rank = bullet => relevance(bullet.text) + (preferred.has(factory.byQuote.get(`employment-${role.index}|${sourceQuote(bullet.sourceQuote)}`)?.claimId) ? 100 : 0);
    const chosen = [...allowedBullets].sort((a, b) => rank(b) - rank(a)
      || role.bullets.indexOf(a) - role.bullets.indexOf(b)).slice(0, role.index === 0 || learningMiddle ? 3 : 2);
    if (role.index === 0 && /education|learning|training/i.test(target.title)) {
      const documentation = allowedBullets.find(bullet => /walkthrough|tutorial|written documentation/i.test(bullet.text));
      if (documentation && !chosen.includes(documentation)) chosen[chosen.length - 1] = documentation;
    }
    if (/recruit|people|talent|education|learning|training/i.test(target.title) && /Musim Mas/i.test(role.employer)) {
      const fieldTraining = allowedBullets.find(bullet => /200\+ participants/i.test(bullet.text));
      const leaders = allowedBullets.find(bullet => /12\+ community leaders/i.test(bullet.text));
      if (fieldTraining && leaders) chosen.splice(0, chosen.length, fieldTraining, leaders);
    }
    selectedByRole.set(role, chosen);
  }
  const selectedCount = () => [...selectedByRole.values()].reduce((total, items) => total + items.length, 0);
  if (selectedCount() < 8) {
    for (const role of profile.experience) {
      for (const bullet of role.bullets.filter(item => factory.byQuote.get(`employment-${role.index}|${sourceQuote(item.sourceQuote)}`)?.status === 'active')) {
        const chosen = selectedByRole.get(role);
        if (chosen.includes(bullet)) continue;
        chosen.push(bullet);
        if (selectedCount() >= 8) break;
      }
      if (selectedCount() >= 8) break;
    }
  }
  const projectRelevance = project => {
    const title = normalize(project.title);
    const role = normalize(target.title);
    const laneBoost = /recruit|people|talent/.test(role)
      ? (/bukti/.test(title) ? 9 : /jobos|jobsss/.test(title) ? 4 : 0)
      : /education|learning|training/.test(role)
        ? (/probixio/.test(title) ? 10 : /evolveed/.test(title) ? 8 : 0)
        : 0;
    const preferredItem = project.items.some(item => preferred.has(factory.byQuote.get(`project-${sha256(project.title).slice(0, 12)}|${sourceQuote(item.sourceQuote)}`)?.claimId));
    return laneBoost + relevance(`${project.title} ${project.items.map(item => item.text).join(' ')}`) + (preferredItem ? 100 : 0);
  };
  const activeExperience = profile.experience.map(role => ({ ...role,
    bullets: role.bullets.filter(item => factory.byQuote.get(`employment-${role.index}|${sourceQuote(item.sourceQuote)}`)?.status === 'active'),
  }));
  const activeProjects = profile.projects.map(project => ({ ...project,
    items: project.items.filter(item => factory.byQuote.get(`project-${sha256(project.title).slice(0, 12)}|${sourceQuote(item.sourceQuote)}`)?.status === 'active'),
  })).filter(project => project.items.length);
  const selectedProjects = selectProjects(activeProjects, activeExperience)
    .sort((a, b) => projectRelevance(b) - projectRelevance(a))
    .slice(0, /recruit|people|talent/i.test(target.title) ? 1 : 2);
  const nodes = [];
  node(nodes, { type: 'name', text: profile.name, structuralReason: 'Candidate identity copied from the source profile header.' });
  node(nodes, { type: 'contact', text: profile.contact, structuralReason: sourceContact === profile.contact
    ? 'Contact line copied from the source profile header.'
    : 'Application-specific contact choices were supplied explicitly; base contact details came from the source profile header.' });
  node(nodes, { type: 'section_heading', text: 'SUMMARY', structuralReason: 'Required resume section heading.' });
  node(nodes, { type: 'summary', text: summary.text, claimIds: summary.claimIds, structuralReason: null });
  node(nodes, { type: 'section_heading', text: 'EXPERIENCE', structuralReason: 'Required resume section heading.' });
  for (const role of profile.experience) {
    node(nodes, {
      type: 'role',
      text: [[role.employer, role.location].filter(Boolean).join(' - '), role.title, role.dates].filter(Boolean).join('\n'),
      structuralReason: `Source role record ${role.index}.`,
      roleRef: { employer: role.employer, title: role.title, dates: role.dates, roleIndex: role.index },
    });
    for (const bullet of selectedByRole.get(role) || []) {
      node(nodes, {
        type: 'achievement',
        text: bullet.text,
        claimIds: claimIdsFor(factory, bullet.sourceQuote, role.index),
        roleRef: { employer: role.employer, title: role.title, dates: role.dates, roleIndex: role.index },
      });
    }
  }
  if (selectedProjects.length) {
    node(nodes, { type: 'section_heading', text: 'PROJECTS', structuralReason: 'Source projects section heading.' });
    for (const project of selectedProjects) {
      const ownerId = `project-${sha256(project.title).slice(0, 12)}`;
      node(nodes, { type: 'project', text: project.title, claimIds: claimIdsFor(factory, project.sourceQuote, null, ownerId), ownerId, structuralReason: null });
      for (const item of project.items) node(nodes, { type: 'project_item', text: item.text, claimIds: claimIdsFor(factory, item.sourceQuote, null, ownerId), ownerId, structuralReason: null });
    }
  }
  node(nodes, { type: 'section_heading', text: 'EDUCATION', structuralReason: 'Required resume section heading.' });
  for (const item of profile.education) node(nodes, { type: 'education', text: item.sourceQuote, claimIds: claimIdsFor(factory, item.sourceQuote), structuralReason: null });
  node(nodes, { type: 'section_heading', text: 'SKILLS', structuralReason: 'Required resume section heading.' });
  const peopleSkills = /recruit|people|talent/i.test(target.title) ? [
    ['candidate screening', /candidate screening/i],
    ['interview participation', /job interviews/i],
    ['skills assessment', /skills assessment/i],
    ['stakeholder coordination', /stakeholder follow-through|stakeholder coordination/i],
    ['written documentation', /written documentation/i],
    ['operating follow-through', /stakeholder follow-through|shifting priorities and follow-through/i],
    ['distributed-team collaboration', /remote collaborators across Indonesia and distributed teams/i],
    ['AI-enabled workflows', /AI-enabled workflows/i],
  ].map(([text, pattern]) => ({ text, claim: factory.claims.find(claim => claim.status === 'active' && pattern.test(claim.sourceQuote)) }))
    .filter(item => item.claim) : [];
  const skillGroupRelevance = group => relevance(`${group.group} ${group.items.join(' ')}`)
    + (/education|learning|training/i.test(target.title) && /product|AI/i.test(group.group) ? 5 : 0);
  const rankedSkillGroups = [...profile.skills].sort((a, b) => skillGroupRelevance(b) - skillGroupRelevance(a));
  if (peopleSkills.length >= 6) {
    node(nodes, { type: 'skills_group', text: 'Recruiting and operations', items: peopleSkills.map(item => item.text), structuralReason: 'Skills selected from source-linked recruiting and operating evidence.' });
    for (const item of peopleSkills) node(nodes, { type: 'skill', text: item.text, claimIds: [item.claim.claimId] });
  } else for (const group of rankedSkillGroups.slice(0, 2)) {
    const chosen = [...group.items].sort((a, b) => relevance(b) - relevance(a)).slice(0, 7);
    node(nodes, { type: 'skills_group', text: group.group, items: chosen, structuralReason: 'Grouped skills copied from a source skills line.' });
    for (const item of chosen) node(nodes, { type: 'skill', text: item, claimIds: claimIdsFor(factory, group.sourceLine), structuralReason: null });
  }
  const ir = { schemaVersion: 2, designId, sourceFormat, revisionSelection: ledger.revisionSelection,
    candidateName: profile.name, contactEmail: profile.contact.match(/[^\s|]+@[^\s|]+\.[^\s|]+/)?.[0] || '',
    profileId: target.profileId, profileSha256: sha256(originalSourceText ?? profile.sourceText),
    normalizedSourceSha256: sha256(profile.sourceText), postingSha256: sha256(postingText || job.description || ''), nodes };
  const claimsById = new Map(factory.claims.map(claim => [claim.claimId, claim]));
  for (const item of nodes) for (const claimId of item.claimIds) {
    const claim = claimsById.get(claimId);
    if (!claim || claim.status !== 'active' || (item.roleRef && claim.ownerId !== `employment-${item.roleRef.roleIndex}`)
      || (item.ownerId && claim.ownerId !== item.ownerId)) {
      throw Object.assign(new Error(`Invalid source ownership for ${item.nodeId}.`), { code: 'resume_evidence_ownership' });
    }
  }
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
