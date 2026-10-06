import { hash } from './contracts.mjs';

const clean = (value, field) => {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(`${field} must be a single line of user-supplied text.`);
  return value.trim();
};

// No inferred dates, employers, achievements, metrics, degrees or skills.
// Input is candidate-supplied evidence, never a human-verification attestation.
export function prepareIntake(input) {
  const questions = [];
  const identity = input.identity || {};
  const name = clean(identity.name || '', 'name');
  const email = clean(identity.email || '', 'email');
  if (name.split(/\s+/).length < 2) questions.push('What name should appear on your resume?');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) questions.push('Which email should appear on applications?');
  const lines = [`Name: ${name}`, [email, identity.location && clean(identity.location, 'location'),
    identity.phone && clean(identity.phone, 'phone'), identity.website && clean(identity.website, 'website')].filter(Boolean).join(' | ')];
  if (input.summary) lines.push('', 'SUMMARY', clean(input.summary, 'summary'));
  const roles = input.roles || [];
  if (roles.length) lines.push('', 'EXPERIENCE');
  for (const [i, role] of roles.entries()) {
    for (const key of ['employer', 'title', 'dates']) if (!role[key]) questions.push(`Please supply ${key} for role ${i + 1}.`);
    const employer = clean(role.employer || '', 'employer');
    const title = clean(role.title || '', 'title');
    const dates = clean(role.dates || '', 'dates');
    if (dates && !/\b(?:19|20)\d{2}\b/.test(dates)) questions.push(`Please supply dated employment history for role ${i + 1}.`);
    lines.push(employer, `${title} | ${dates}`);
    if (!role.achievements?.length) questions.push(`What did you do or accomplish in role ${i + 1}?`);
    for (const fact of role.achievements || []) lines.push(`- ${clean(fact, 'achievement')}`);
  }
  if (input.projects?.length) {
    lines.push('', 'PROJECTS');
    for (const project of input.projects) {
      lines.push(clean(project.title, 'project title'));
      for (const fact of project.achievements || []) lines.push(`- ${clean(fact, 'project achievement')}`);
    }
  }
  if (input.education?.length) lines.push('', 'EDUCATION', ...input.education.map(v => clean(v, 'education')));
  if (input.skills?.length) {
    lines.push('', 'SKILLS');
    for (const group of input.skills) lines.push(`${clean(group.group, 'skill group')}: ${group.items.map(v => clean(v, 'skill')).join(', ')}`);
  }
  if (!roles.length && !input.projects?.some(p => p.achievements?.length)) questions.push('Describe an employment, volunteer, coursework or personal project and what you did.');
  const source = lines.join('\n') + '\n';
  return { schema: 'candidate-intake.v1', record: structuredClone(input), inputSha256: hash(JSON.stringify(input)),
    sourceSha256: hash(source), source, readyForImport: questions.length === 0,
    questions, verification: 'needs_candidate_confirmation', masterResumeRequired: false };
}
