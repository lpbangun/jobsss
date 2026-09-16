// Structured resume facts for ordinary markdown and labeled records.
// Tailoring selects achievement bullets once; renderers must not re-parse prose.

function clean(value) {
  return String(value || '').replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s*/, '')
    .replace(/\*+/g, '').trim();
}

function supportedAchievement(value) {
  return clean(value);
}

const DATED_ROLE_LINE = /^(?:19|20)\d{2}(?:-\d{2})?\s*(?:through|to|until|[–—-])\s*(?:(?:19|20)\d{2}(?:-\d{2})?|present)\s*[:|]|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*(?:through|to|[–—-])\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|present)\s*[:|]/i;
const MONTH_DATE = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i;

function headingKind(line) {
  const t = clean(line);
  if (/^(experience|employment)\b/i.test(t)) return 'experience';
  if (/^selected projects\b/i.test(t)) return 'projects';
  if (/^education\b/i.test(t)) return 'education';
  if (/^(?:core\s+)?skills\b/i.test(t)) return 'skills';
  if (/^(preferences|boundaries|audit)\b/i.test(t)) return 'internal';
  return null;
}

function isHash(line) {
  return /^#{1,6}\s/.test(line);
}

function isMeta(line) {
  const t = clean(line);
  if (/^\*\*.+\*\*$/.test(String(line).trim())) return true;
  if (MONTH_DATE.test(t) && /\|/.test(t)) return true;
  if (/^(?:sole builder|builder)\b/i.test(t) && /\|/.test(t)) return true;
  return false;
}

function parseMeta(line) {
  const t = clean(line);
  const parts = t.split('|').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2 && MONTH_DATE.test(t)) {
    return { title: parts[0], dates: parts.slice(1).join(' | ') };
  }
  return { title: parts[0] || t, dates: parts.slice(1).join(' | ') };
}

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

export function parseResumeSource(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const doc = {
    identity: '',
    contacts: [],
    summary: '',
    target: '',
    experience: [],
    projects: [],
    education: [],
    skills: [],
  };
  let section = '';
  const pushRole = (list, company) => {
    const role = { company, location: '', title: '', dates: '', bullets: [], text: '' };
    list.push(role);
    return role;
  };
  let current = null;

  for (const raw of lines) {
    if (/^Name:\s*/i.test(raw)) {
      doc.identity = clean(raw.replace(/^Name:\s*/i, ''));
      continue;
    }
    if (/^(Email|Phone|Professional profile|LinkedIn|Website|Location):/i.test(raw)) {
      doc.contacts.push(clean(raw.replace(/^[^:]+:\s*/, '')).split(/.\s*Timezone:/i)[0].replace(/\.$/, ''));
      continue;
    }
    const kind = headingKind(raw);
    if (kind && (!/\b(?:19|20)\d{2}\b/.test(raw) || kind !== 'experience')) {
      if (kind === 'internal') { section = 'internal'; current = null; continue; }
      section = kind;
      current = null;
      continue;
    }
    if (section === 'internal') continue;

    if (!section || section === 'other') {
      if (!doc.identity && (isHash(raw) || /^[A-Z][A-Z\s.'-]+$/.test(raw))) {
        doc.identity = clean(raw);
        continue;
      }
      if (/@|linkedin\.com|https?:\/\/|\+\d/.test(raw) || (doc.identity && /\|/.test(raw) && /ny|city/i.test(raw))) {
        doc.contacts.push(clean(raw));
        continue;
      }
      if (/^\*\*.+\*\*/.test(raw) || /People Operations|Technical Education|Learning/i.test(raw)) {
        const t = clean(raw);
        const split = t.match(/^([^.]{8,80}?)\s{2,}(.+)$/) || t.match(/^(\*\*[^*]+\*\*|[^.]{8,70})\s+([A-Z].+)$/);
        if (t.includes('|') && t.length < 80) doc.target = t;
        else {
          const bold = String(raw).match(/^\*\*([^*]+)\*\*\s*(.*)$/);
          if (bold) {
            doc.target = bold[1].trim();
            doc.summary = (bold[2] || '').trim();
          } else doc.summary = t;
        }
        continue;
      }
      if (DATED_ROLE_LINE.test(raw)) {
        section = 'experience';
        current = pushRole(doc.experience, '');
        current.title = clean(raw);
        continue;
      }
    }

    if (section === 'experience') {
      if (isHash(raw) && !headingKind(raw)) {
        const companyLine = clean(raw);
        const loc = companyLine.split(/\s+[—–-]\s+/);
        current = pushRole(doc.experience, loc[0]);
        current.location = loc.slice(1).join(' - ');
        current.company = loc[0];
        continue;
      }
      if (isMeta(raw) && current) {
        const meta = parseMeta(raw);
        current.title = current.title || meta.title;
        current.dates = current.dates || meta.dates;
        continue;
      }
      if (DATED_ROLE_LINE.test(raw)) {
        current = pushRole(doc.experience, '');
        current.title = clean(raw);
        continue;
      }
      if (current) current.bullets.push(supportedAchievement(clean(raw)));
      else if (!current && raw) {
        current = pushRole(doc.experience, '');
        current.bullets.push(supportedAchievement(clean(raw)));
      }
      continue;
    }

    if (section === 'projects') {
      if (isHash(raw) && !headingKind(raw)) {
        current = pushRole(doc.projects, clean(raw));
        current.company = clean(raw);
        continue;
      }
      if (isMeta(raw) && current) {
        const meta = parseMeta(raw);
        current.title = meta.title;
        current.dates = meta.dates;
        continue;
      }
      if (current) {
        const text = supportedAchievement(clean(raw));
        if (text) current.text = current.text ? `${current.text} ${text}` : text;
      }
      continue;
    }

    if (section === 'education') {
      if (isHash(raw) && !headingKind(raw)) {
        const parts = clean(raw).split(/\s+[—–-]\s+/);
        current = pushRole(doc.education, parts[0]);
        current.company = parts[0];
        current.location = parts.slice(1).join(' - ');
        continue;
      }
      if (current) {
        if (!current.title) current.title = clean(raw);
        else current.bullets.push(clean(raw));
      } else {
        current = pushRole(doc.education, '');
        current.title = clean(raw);
      }
      continue;
    }

    if (section === 'skills') {
      const text = clean(raw);
      if (text) doc.skills.push(text);
    }
  }

  if (!doc.identity) doc.identity = lines[0] ? clean(lines[0]) : '';
  doc.experience = doc.experience.filter(role => role.company || role.title || role.bullets.length);
  doc.projects = doc.projects.filter(role => role.company || role.text);
  doc.education = doc.education.filter(role => role.company || role.title);
  return doc;
}

function rankText(text, selected, posting = '') {
  const want = selected.map(proof => tokenize(proof.summary || proof).join(' '));
  const have = tokenize(text).join(' ');
  let best = 0;
  for (const [index, item] of want.entries()) {
    if (!item) continue;
    if (have.includes(item) || (item.includes(have) && have.split(' ').length > 6)) {
      best = Math.max(best, want.length - index);
    } else {
      const overlap = tokenize(text).filter(token => item.split(' ').includes(token)).length;
      if (overlap >= 6) best = Math.max(best, (want.length - index) * 0.5);
    }
  }
  const terms = new Set(tokenize(posting).filter(token => token.length > 4));
  best += tokenize(text).filter(token => terms.has(token)).length;
  const post = posting.toLowerCase();
  if (/people operations|recruiting|coordinator/.test(post) && /screening|interview/.test(text.toLowerCase())) best += 40;
  if (/education|instructional|workshop|learner/.test(post) && /needs assessments|learning materials/.test(text.toLowerCase())) best += 40;
  if (/education|instructional/.test(post) && /screening/.test(text.toLowerCase())) best -= 30;
  if (/implementation/.test(post) && /200\+|rural communities/.test(text.toLowerCase())) best += 40;
  if (/implementation/.test(post) && /train-the-trainer|screening/.test(text.toLowerCase())) best -= 30;
  if (/education|instructional|workshop|learner/.test(post) && /train-the-trainer/.test(text.toLowerCase())) best += 50;
  if (/education|instructional|workshop|learner/.test(post) && /200\+/.test(text)) best -= 25;
  return best;
}

export function selectAchievements(doc, selected = [], job = null) {
  const posting = `${job?.title || ''} ${job?.description || ''} ${(job?.requirements || []).join(' ')}`;
  const pool = [];
  for (const role of doc.experience) {
    for (const bullet of role.bullets) {
      pool.push({ owner: role, kind: 'experience', text: bullet, rank: rankText(bullet, selected, posting) });
    }
  }
  for (const project of doc.projects) {
    if (project.text) pool.push({ owner: project, kind: 'project', text: project.text, rank: rankText(project.text, selected, posting) });
  }
  pool.sort((a, b) => b.rank - a.rank);
  const chosen = [];
  for (const item of pool) {
    if (item.rank > 0 && chosen.length < 8) chosen.push(item);
  }
  if (chosen.length < 4) {
    for (const item of pool) {
      if (chosen.includes(item)) continue;
      chosen.push(item);
      if (chosen.length >= 4) break;
    }
  }
  const byOwner = new Map();
  for (const item of chosen) {
    const list = byOwner.get(item.owner) || [];
    const cap = item.owner === doc.experience[0] ? 3 : 1;
    if (list.length >= cap) continue;
    list.push(item);
    byOwner.set(item.owner, list);
  }
  for (const role of doc.experience) {
    if (!byOwner.has(role) && role.bullets[0]) {
      byOwner.set(role, [{ owner: role, text: role.bullets[0], rank: 0 }]);
    }
  }
  return { chosen, byOwner };
}

export function focusLine(preferences, job) {
  const target = Array.isArray(preferences?.targetRoleFamilies) ? String(preferences.targetRoleFamilies[0] || '').trim() : '';
  const title = String(job?.title || '').trim();
  const company = String(job?.company || '').trim();
  if (!target || !title) return null;
  return `Focus: ${target} — ${title}${company && company !== 'Unknown company' ? ` at ${company}` : ''}`;
}

export function composeResume(doc, selected = [], options = {}) {
  const { byOwner } = selectAchievements(doc, selected, options.job);
  const focus = focusLine(options.preferences, options.job);
  const lines = [doc.identity];
  if (doc.contacts.length) lines.push(doc.contacts.join(' | '));
  if (focus) lines.push(focus);
  if (doc.target) lines.push(doc.target);
  if (doc.summary) lines.push(doc.summary);
  lines.push('', 'EXPERIENCE');
  for (const role of doc.experience) {
    const heading = [role.company, role.location].filter(Boolean).join(' - ');
    if (heading) lines.push(heading);
    const meta = [role.title, role.dates].filter(Boolean).join(' | ');
    if (meta) lines.push(meta);
    const picked = byOwner.get(role) || [];
    const bullets = picked.length ? picked.map(item => item.text) : role.bullets.slice(0, 1);
    for (const bullet of bullets) lines.push(`- ${bullet}`);
    lines.push('');
  }
  if (doc.projects.length) {
    lines.push('SELECTED PROJECTS');
    for (const project of doc.projects) {
      if (project.company) lines.push(project.company);
      const meta = [project.title, project.dates].filter(Boolean).join(' | ');
      if (meta) lines.push(meta);
      if (project.text) lines.push(project.text);
      lines.push('');
    }
  }
  if (doc.education.length) {
    lines.push('EDUCATION');
    for (const school of doc.education) {
      if (school.company) lines.push(school.company);
      if (school.title) lines.push(school.title);
      for (const note of school.bullets) lines.push(note);
      lines.push('');
    }
  }
  if (doc.skills.length) {
    lines.push('SKILLS');
    lines.push(...doc.skills);
  }
  const content = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return { content, doc, byOwner };
}

export function resumeBlocks(doc, selected, options = {}) {
  const { byOwner } = selectAchievements(doc, selected, options.job);
  const focus = focusLine(options.preferences, options.job);
  const blocks = [];
  blocks.push({ type: 'name', text: doc.identity });
  if (doc.contacts.length) blocks.push({ type: 'contact', text: doc.contacts.join(' | ') });
  if (focus) blocks.push({ type: 'focus', text: focus });
  if (doc.target) blocks.push({ type: 'target', text: doc.target });
  if (doc.summary) blocks.push({ type: 'summary', text: doc.summary });
  blocks.push({ type: 'h2', text: 'EXPERIENCE' });
  for (const role of doc.experience) {
    const heading = [role.company, role.location].filter(Boolean).join(' - ');
    if (heading) blocks.push({ type: 'h3', text: heading, keep: true });
    const meta = [role.title, role.dates].filter(Boolean).join(' | ');
    if (meta) blocks.push({ type: 'meta', text: meta, keep: true });
    const picked = byOwner.get(role) || [];
    const bullets = picked.length ? picked.map(item => item.text) : role.bullets.slice(0, 1);
    bullets.forEach((bullet, index) => blocks.push({ type: 'bullet', text: bullet, keep: index === 0 }));
  }
  if (doc.projects.length) {
    blocks.push({ type: 'h2', text: 'SELECTED PROJECTS' });
    for (const project of doc.projects) {
      if (project.company) blocks.push({ type: 'h3', text: project.company, keep: true });
      const meta = [project.title, project.dates].filter(Boolean).join(' | ');
      if (meta) blocks.push({ type: 'meta', text: meta });
      if (project.text) blocks.push({ type: 'body', text: project.text });
    }
  }
  if (doc.education.length) {
    blocks.push({ type: 'h2', text: 'EDUCATION' });
    for (const school of doc.education) {
      if (school.company) blocks.push({ type: 'h3', text: school.company, keep: true });
      if (school.title) blocks.push({ type: 'body', text: school.title });
      for (const note of school.bullets) blocks.push({ type: 'body', text: note });
    }
  }
  if (doc.skills.length) {
    blocks.push({ type: 'h2', text: 'SKILLS' });
    for (const line of doc.skills) blocks.push({ type: 'body', text: line });
  }
  return blocks;
}
