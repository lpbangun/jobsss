// Native applicant copy and dependency-free, searchable PDF export. Source facts
// stay separate from proof/coverage/review metadata; no posting text is evidence.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDataDir, hashText, tokenize } from './store.js';

function clean(value) {
  return String(value || '').replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s*/, '')
    .replace(/^[A-Z]+\d+\s*(?:\[[^\]]+\])?\s*:\s*/, '')
    .replace(/\s*\[[A-Z][A-Z0-9_-]*(?:[\s,–—-]+[A-Z0-9_-]+)*\]/g, '')
    .replace(/\*\*/g, '').trim();
}
export function supportedAchievement(value) {
  return clean(value).replace(/\s*\(fictional[^)]*\)/gi, '')
    .replace(/\s+(?:Do not claim|Do not describe|No GPA|No other language|No unlisted|No employment after)[\s\S]*$/i, '')
    .replace(/\s*This (?:is|was) [^.]*, not (?:proof|a claim) [^.]*\.?/gi, '')
    .replace(/\s*Observed before\/after association, not proof of sole causation\.?/gi, '')
    .replace(/\s*This was collaborative delivery[^.]*\.?/gi, '')
    .replace(/\s*Collaborative delivery, not (?:a claim of )?manag(?:ing|ement of) those colleagues\.?/gi, '')
    .replace(/;\s*(?:measured by|comparison used)[^.]*\.?/gi, '.')
    .replace(/;\s*in the team's issue log,/i, '; recorded')
    .replace(/;\s*team issue log monthly recurring/i, '; recorded monthly recurring')
    .trim();
}
function contribution(value) {
  const text = supportedAchievement(value);
  return text.replace(/^([A-Z])/, letter => letter.toLowerCase()).replace(/[.]+$/, '');
}

// Applicant-only line shapes: process notes, preference blocks, missing-skill
// inventories and audit caveats stay in source/metadata, never in copy.
const INTERNAL_SECTION = /boundaries|preferences|audit|proof verification|internal|approval/i;
const APPLICANT_NOISE = /proof verification|artifact approval|pending human-only|internal verification|human review|unverified approval/i;
const PREFERENCE_LINE = /^\s*(remote only|hybrid\b|target\b|hard minimum\b|not seeking\b)|\bhard minimum\b|\bnot seeking\b|\bno required office attendance\b|annual guaranteed base salary/i;
// Labeled preference/context lines must never be misread as contact or
// achievement copy (work authorization, salary floor, target/role, schedule,
// interest and search constraints stay source facts, not resume prose).
const APPLICANT_PREFERENCE = /^\s*(?:work authorization|authorization|target\b|hard minimum|remote only|remote:|interest\b|available|availability|desired|not seeking|open to|no (?:relocation|required|office|permanent)|compensation|salary|annual|location|preferences|candidate preferences|looking for|i seek|i am available|my minimum|i value)/i;
const AUTHORIZATION_LINE = /\b(?:work authorization|authorization to work|authorized to work|right to work)\b|\bcitizen\b/i;
// Unlabeled dated role records (`2021-09 through 2023-02: Role, Company.`)
// keep closed dated chronology even when no Experience heading is supplied.
const DATED_ROLE_LINE = /^(?:19|20)\d{2}(?:-\d{2})?\s*(?:through|to|until|[–—-])\s*(?:19|20)\d{2}(?:-\d{2})?\s*[:|]|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*(?:through|to|[–—-])\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*[:|]/i;
const BARE_SECTION = /^(?:#{1,6}\s*)?(experience|employment|skills|education|preferences|boundaries)\b/i;

function applicantLine(raw) {
  if (APPLICANT_NOISE.test(raw) || PREFERENCE_LINE.test(raw)) return null;
  let text = String(raw).replace(/\s*Missing:[^.\n]*\.?/i, '').trim();
  text = supportedAchievement(text).replace(/\s*No GPA[^.]*\.?/gi, '').replace(/[.]{2,}$/, '.').trim();
  return text || null;
}

// Applicant prose candidate for resumes without labeled headings: real
// contribution paragraphs survive, while preference/context lines are not
// promoted into applicant copy merely because they are not contacts.
function applicantProse(raw) {
  const text = String(raw || '').trim();
  if (!text || APPLICANT_PREFERENCE.test(text) || AUTHORIZATION_LINE.test(text)) return false;
  return Boolean(applicantLine(text));
}

function focusLine(preferences, job) {
  // Truthful targeting line: the candidate's stored target-role preference
  // plus the posting being tailored for. A real preference revision (or a
  // different posting) yields a distinct native revision; formatting-only
  // changes such as communicationStyle leave it untouched, so unchanged
  // regeneration still deduplicates to the same artifact.
  const target = Array.isArray(preferences?.targetRoleFamilies) ? String(preferences.targetRoleFamilies[0] || '').trim() : '';
  const title = String(job?.title || '').trim();
  const company = String(job?.company || '').trim();
  if (!target || !title) return null;
  return `Focus: ${target} — ${title}${company && company !== 'Unknown company' ? ` at ${company}` : ''}`;
}

// Ordinary Markdown resumes (`# Name` / `## Experience` / dated role headings)
// carry the same preference/audit shapes as labeled records. Select 4-6
// supported relevant achievements globally while keeping every dated role,
// education, identity and contact lines on a readable one-page PDF.
function ordinaryResumeCopy(identity, lines, selected = [], options = {}) {
  const contacts = [];
  let section = '';
  const roles = [];
  const opening = [];
  const skills = [], education = [];
  const current = () => roles.at(-1);
  for (const raw of lines) {
    const bare = raw.match(BARE_SECTION);
    if (bare && !/\b(?:19|20)\d{2}\b/.test(raw)) {
      const heading = bare[1];
      if (INTERNAL_SECTION.test(heading) || /preferences|boundaries/i.test(heading)) { section = 'internal'; continue; }
      if (/experience|employment/i.test(heading)) { section = 'experience'; continue; }
      if (/skills/i.test(heading)) { section = 'skills'; continue; }
      if (/education/i.test(heading)) { section = 'education'; continue; }
    }
    if (/^#{1,6}\s/.test(raw)) {
      const heading = clean(raw);
      if (INTERNAL_SECTION.test(heading)) section = 'internal';
      else if (/experience|employment/i.test(heading)) section = 'experience';
      else if (/skills/i.test(heading)) section = 'skills';
      else if (/education/i.test(heading)) section = 'education';
      else section = /experience|employment/i.test(section) ? section : 'other';
      if (/experience|employment/i.test(heading)) continue;
      if (section === 'internal') continue;
      // A dated subheading inside Experience opens a role; other headings
      // are prose context, not applicant achievements.
      if (section === 'experience' && /\b(?:19|20)\d{2}\b/.test(raw)) {
        roles.push({ text: clean(raw), bullets: [] });
      }
      continue;
    }
    if (section === 'internal') continue;
    if (/experience|employment/i.test(section)) {
      // Dated role headers start with a closed date range. Achievement
      // sentences that merely mention a year stay with the current role.
      if (DATED_ROLE_LINE.test(raw)) {
        roles.push({ text: clean(raw), bullets: [] });
      } else {
        if (!current()) roles.push({ text: '', bullets: [] });
        current().bullets.push(raw);
      }
    } else if (section === 'skills' || section === 'education') {
      if (/^(?:Exposure only|Missing):/i.test(raw)) continue;
      (section === 'skills' ? skills : education).push(raw);
    } else if (!section || section === 'other') {
      if (/@|https?:\/\//.test(raw)) contacts.push(clean(raw));
      else if (/^Location:/i.test(raw)) contacts.push(clean(raw.replace(/^Location:\s*/i, '')).split(/\.\s*Timezone:/i)[0].replace(/\.$/, ''));
      else if (AUTHORIZATION_LINE.test(raw)) {
        // Work authorization and citizenship are identity/context facts, not
        // contact lines or achievements; they stay out of applicant copy.
      } else if (DATED_ROLE_LINE.test(raw)) {
        roles.push({ text: supportedAchievement(clean(raw)), bullets: [] });
      } else if (applicantProse(raw) && clean(raw) !== identity) {
        opening.push(raw);
      }
    }
  }
  const selectedText = selected.map(proof => clean(proof.summary));
  const rank = raw => { const index = selectedText.indexOf(clean(raw)); return index < 0 ? 0 : selectedText.length - index; };
  const pool = [];
  for (const role of roles) {
    const kept = [];
    for (const raw of role.bullets) {
      const text = applicantLine(raw);
      if (text) kept.push({ raw, text, rank: rank(raw) });
    }
    kept.sort((a, b) => b.rank - a.rank);
    role.ranked = kept;
    pool.push(...kept);
  }
  // Simple/unlabeled achievement paragraphs are real resume facts, not an
  // empty document: they participate in the same global selection pool.
  for (const raw of opening) {
    const text = applicantLine(raw);
    if (text) pool.push({ raw, text, rank: rank(raw) });
  }
  pool.sort((a, b) => b.rank - a.rank);
  // Global 4-6: keep every dated role, emphasize relevant achievements
  // within it, overflow selected material under its own heading.
  const chosen = new Set(pool.filter(item => item.rank > 0).slice(0, 6));
  if (chosen.size < 4) for (const item of pool) { if (chosen.size >= 4) break; chosen.add(item); }
  const placed = new Set();
  const output = [identity, contacts.join(' | '), '', 'EXPERIENCE'];
  const ordinaryFocus = focusLine(options.preferences, options.job);
  if (ordinaryFocus) output.splice(2, 0, ordinaryFocus, '');
  if (roles.length) {
    for (const role of [...roles].reverse()) {
      if (role.text) output.push(role.text);
      const within = role.ranked.filter(item => chosen.has(item)).slice(0, 2);
      for (const item of within) placed.add(item);
      output.push(...within.map(item => `- ${item.text}`), '');
    }
    const extra = [...chosen].filter(item => !placed.has(item)).slice(0, Math.max(0, 6 - placed.size));
    if (extra.length) output.push('SELECTED ACHIEVEMENTS', ...extra.map(item => `- ${item.text}`), '');
  } else {
    for (const item of pool.filter(item => chosen.has(item)).slice(0, 6)) output.push(`- ${item.text}`);
    if (chosen.size) output.push('');
  }
  const skillLines = skills.map(applicantLine).filter(Boolean);
  if (skillLines.length) output.push('SKILLS', ...skillLines, '');
  const schoolLines = education.map(applicantLine).filter(Boolean);
  if (schoolLines.length) output.push('EDUCATION', ...schoolLines);
  return output.join('\n').trim() + '\n';
}

export function resumeCopy(profile, selected = [], omittedProofs = [], options = {}) {
  const source = String(profile.resumeText || '');
  const omitted = new Set(omittedProofs.map(proof => clean(proof.summary)));
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !omitted.has(clean(line)));
  const explicitName = lines.find(line => /^Name:\s*/i.test(line));
  const identity = explicitName ? clean(explicitName.replace(/^Name:\s*/i, ''))
    : profile.resume?.identity?.name || profile.name;
  // Labeled source records carry preference/audit sections, not applicant prose.
  const record = Boolean(explicitName && lines.some(line => /^##.*(?:employment|achievements)/i.test(line)));
  if (!record) return ordinaryResumeCopy(identity, lines, selected, options);
  const contacts = lines.filter(line => /^(Email|Phone|Professional profile|LinkedIn|Website):/i.test(line))
    .map(line => clean(line.replace(/^[^:]+:\s*/, '')));
  const location = lines.find(line => /^Location:/i.test(line));
  if (location) contacts.push(clean(location.replace(/^Location:\s*/i, '')).split(/\.\s*Timezone:/i)[0].replace(/\.$/, ''));
  let section = '';
  const employment = [], achievements = [], skills = [], education = [];
  for (const raw of lines) {
    if (/^##\s/.test(raw)) { section = clean(raw).toLowerCase(); continue; }
    if (/employment|experience/.test(section) && /\b(?:19|20)\d{2}(?:-\d{2})?\b/.test(raw) && /:/.test(raw)) {
      const refs = raw.match(/\[[^\]]+\]/g) || [];
      employment.push({ text: supportedAchievement(raw).replace(/\.\s*Fixed-term[\s\S]*$/i, '.'), refs, bullets: [] });
    } else if (/achievements|accomplishments/.test(section) && /\b(automated|reconciled|built|added|defined|implemented|led|created|developed|reduced|improved|designed|launched|owned|shipped)\b/i.test(raw)) {
      achievements.push({ raw, text: supportedAchievement(raw), refs: raw.match(/\[[^\]]+\]/g) || [] });
    } else if (/skills|education/.test(section)) {
      if (/^(Production|Skills|Languages):/i.test(raw)) skills.push(supportedAchievement(raw));
      if (/^Education:/i.test(raw)) education.push(supportedAchievement(raw.replace(/^Education:\s*/i, '')));
    }
  }
  // Some source records enumerate employment references in the section heading
  // rather than each dated line. Resolve those references by source order only.
  const employmentHeading = lines.find(line => /^##.*(?:employment|experience)/i.test(line)) || '';
  const headingRefs = [...employmentHeading.matchAll(/\b[A-Z][A-Z0-9]*-[A-Z]\d+\b/g)].map(match => `[${match[0]}]`);
  employment.forEach((entry, index) => { if (!entry.refs.length && headingRefs[index]) entry.refs = [headingRefs[index]]; });
  const unassigned = [];
  for (const achievement of achievements) {
    const employer = employment.find(entry => entry.refs.some(ref => achievement.refs.includes(ref)));
    (employer ? employer.bullets : unassigned).push(achievement);
  }
  const selectedText = selected.map(proof => clean(proof.summary));
  const rank = bullet => { const index = selectedText.indexOf(clean(bullet.raw)); return index < 0 ? 0 : selectedText.length - index; };
  const output = [identity, contacts.join(' | '), '', 'EXPERIENCE'];
  const recordFocus = focusLine(options.preferences ?? profile?.preferences, options.job);
  if (recordFocus) output.splice(2, 0, recordFocus, '');
  for (const entry of [...employment].reverse()) {
    output.push(entry.text);
    // Keep every dated role; emphasize relevant achievements within that role.
    const bullets = [...entry.bullets].sort((a, b) => rank(b) - rank(a)).slice(0, 2);
    output.push(...bullets.map(bullet => `- ${bullet.text}`), '');
  }
  if (unassigned.length) output.push('SELECTED ACHIEVEMENTS', ...unassigned.map(bullet => `- ${bullet.text}`), '');
  if (skills.length) output.push('SKILLS', ...skills, '');
  if (education.length) output.push('EDUCATION', ...education);
  return output.join('\n').trim() + '\n';
}

export function coverLetterCopy(profile, job, selected) {
  const name = String(profile.resumeText || '').match(/^Name:\s*(.+)$/im)?.[1]
    || profile.resume?.identity?.name || profile.name;
  // Intake extraction and explicit proof retention can describe the same claim.
  // Deduplicate copy, not stored proofs: historical provenance stays intact.
  const normalizeClaim = text => tokenize(text).join(' ');
  const unique = [];
  for (const proof of selected) {
    const summary = String(proof.summary || '');
    if (APPLICANT_PREFERENCE.test(summary) || AUTHORIZATION_LINE.test(summary)
      || /\bI seek\b|working preferences|candidate-stated preferences|guaranteed base/i.test(summary)) continue;
    const text = contribution(summary);
    const key = tokenize(text).join(' ');
    if (!key) continue;
    if (unique.some(item => item.key === key || (Math.min(item.key.split(' ').length, key.split(' ').length) >= 8
      && (item.key.startsWith(key + ' ') || key.startsWith(item.key + ' '))))) continue;
    unique.push({ text, key });
  }
  const posting = `${job.title || ''}\n${job.description || ''}\n${(job.requirements || []).join('\n')}`;
  const topics = [
    { pattern: /warehouse.{0,30}(?:cost|spend)|(?:cost|spend).{0,30}warehouse/i, label: 'warehouse-cost improvements' },
    { pattern: /self.service|dashboard/i, label: 'self-service reporting' },
    { pattern: /metric|data dictionary/i, label: 'consistent metric definitions' },
    { pattern: /test|data quality|data defect/i, label: 'reliable, tested data models' },
    { pattern: /transformation|dbt|dimensional model/i, label: 'maintainable data transformations' },
    { pattern: /reconcil|automat/i, label: 'reliable reporting workflows' },
  ].filter(topic => topic.pattern.test(posting));
  const terms = new Set(tokenize(posting).filter(term => term.length > 3));
  const ranked = unique.map(item => ({ ...item,
    topics: topics.filter(topic => topic.pattern.test(item.text)),
    overlap: [...new Set(tokenize(item.text))].filter(term => terms.has(term)).length,
  })).sort((a, b) => b.topics.length - a.topics.length || b.overlap - a.overlap);
  const chosen = [];
  while (ranked.length && chosen.length < 2) {
    // Prefer a second contribution covering a different relevant team need.
    const index = chosen.length ? ranked.findIndex(item => item.topics.some(topic => !chosen[0].topics.includes(topic))) : 0;
    chosen.push(ranked.splice(index < 0 ? 0 : index, 1)[0]);
  }
  const contributions = chosen.map(item => item.text);
  const connections = [...new Set(chosen.flatMap(item => item.topics.map(topic => topic.label)))].slice(0, 2);
  return [
    'Dear Hiring Team,', '',
    `I am interested in the ${job.title} role at ${job.company}.`, '',
    contributions.length ? `In my previous work, I ${contributions[0]}.` : '',
    contributions[1] ? `I also ${contributions[1]}.` : '', '',
    connections.length ? `I would welcome the opportunity to apply this experience to your team's work on ${connections.join(' and ')}.`
      : contributions.length ? 'I would welcome the opportunity to bring this experience to your team and discuss how it could support the role.'
      : 'I would welcome a conversation about the role and the experience your team needs.', '',
    'Thank you for your consideration,', clean(name), '',
  ].filter((line, index, all) => line || all[index - 1]).join('\n');
}

// Standard PDF Helvetica widths (ASCII, thousandths of an em). WinAnsi
// punctuation uses conservative widths; unsupported scripts fail explicitly.
const WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const SPECIAL = new Map([['€',128],['‘',145],['’',146],['“',147],['”',148],['•',149],['–',150],['—',151],['…',133]]);
function encode(text) {
  return [...text].map(char => {
    const code = SPECIAL.get(char) ?? char.codePointAt(0);
    if (code < 32 || (code > 126 && code < 160 && !SPECIAL.has(char)) || code > 255) {
      throw Object.assign(new Error(`Native PDF cannot encode character U+${char.codePointAt(0).toString(16)}; use Markdown for this script.`), { code: 'pdf_unsupported_character' });
    }
    return code.toString(16).padStart(2, '0');
  }).join('');
}
function width(text, size, bold = false) {
  return [...text].reduce((sum, char) => sum + (WIDTHS[char.charCodeAt(0) - 32] || 1000), 0) * size / 1000 * (bold ? 1.1 : 1);
}
function wrap(text, size, bold, maxWidth) {
  const out = []; let line = '';
  for (const word of text.split(/\s+/)) {
    if (width(word, size, bold) > maxWidth) {
      if (line) { out.push(line); line = ''; }
      let chunk = '';
      for (const char of word) {
        if (width(chunk + char, size, bold) > maxWidth) { out.push(chunk); chunk = ''; }
        chunk += char;
      }
      line = chunk;
    } else if (line && width(`${line} ${word}`, size, bold) > maxWidth) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}
export function renderPdf(content) {
  const source = content.split('\n');
  let pages, bodyFontSize;
  for (const size of [11, 10.5, 10]) {
    pages = [[]]; let y = 748;
    for (const [index, raw] of source.entries()) {
      if (!raw.trim()) { y -= size * 0.45; continue; }
      const text = clean(raw);
      const heading = index === 0 || /^[A-Z][A-Z\s]+$/.test(text);
      const fontSize = index === 0 ? 18 : heading ? 11 : size;
      const lineHeight = fontSize * 1.2;
      for (const line of wrap(raw.startsWith('- ') ? `• ${text}` : text, fontSize, heading, 524)) {
        if (y < 44 + lineHeight) { pages.push([]); y = 748; }
        pages.at(-1).push({ text: line, size: fontSize, bold: heading, y });
        y -= lineHeight;
      }
    }
    bodyFontSize = size;
    if (pages.length === 1) break;
  }
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  const catalog = add(''); const pageTree = add('');
  const mappings = new Map();
  for (const page of pages) for (const line of page) for (const char of line.text) mappings.set(encode(char), char.codePointAt(0).toString(16).padStart(4, '0'));
  const entries = [...mappings];
  const cmap = ['/CIDInit /ProcSet findresource begin 12 dict begin begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /JobSSSText def /CMapType 2 def', '1 begincodespacerange <00> <FF> endcodespacerange'];
  for (let start = 0; start < entries.length; start += 100) {
    const chunk = entries.slice(start, start + 100);
    cmap.push(`${chunk.length} beginbfchar`, ...chunk.map(([a,b]) => `<${a}> <${b}>`), 'endbfchar');
  }
  cmap.push('endcmap CMapName currentdict /CMap defineresource pop end end');
  const stream = value => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`;
  const unicode = add(stream(cmap.join('\n')));
  const regular = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode ${unicode} 0 R >>`);
  const bold = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding /ToUnicode ${unicode} 0 R >>`);
  const ids = pages.map(page => {
    const commands = page.map(line => `BT /${line.bold ? 'F2' : 'F1'} ${line.size} Tf 1 0 0 1 44 ${line.y.toFixed(2)} Tm <${encode(line.text)}> Tj ET`).join('\n');
    const contents = add(stream(commands));
    return add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contents} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { bytes: Buffer.from(pdf), pageCount: pages.length, bodyFontSize, pageSize: 'Letter', marginsPt: 44, atsReadability: 'Searchable single-column text; no proprietary ATS score or compatibility guarantee.' };
}

export function exportPdf(dataDir, content) {
  const { bytes, ...layout } = renderPdf(content);
  const root = ensureDataDir(dataDir);
  const sha256 = hashText(bytes);
  const filePath = path.join(root, `document-${sha256}.pdf`);
  try { fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(filePath).equals(bytes)) throw Object.assign(new Error('Document export path is not the expected regular PDF file.'), { code: 'unsafe_export_path' });
  }
  return { path: filePath, filePath, mimeType: 'application/pdf', sha256, byteLength: bytes.length, ...layout };
}
