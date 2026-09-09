import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCompensation } from '../src/compensation.js';
import { renderPdf, coverLetterCopy, resumeCopy } from '../src/documents.js';
import { localScore } from '../src/scoring.js';
import * as domain from '../src/domain.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(process.env.JOBSSS_TEST_DATA || os.tmpdir(), 'quality-output-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const resume = `# Source record
## Identity and preferences
Name: Casey Rivera
Email: casey@example.com
Professional profile: https://profiles.example.com/casey
Location: Denver, Colorado, United States.
Work authorization: US citizen. No UK work authorization.
Target: approximately four years experience. Not seeking staff or principal roles.
Hard minimum: USD 110,000 annual guaranteed base salary, excluding bonus/equity.
Remote only; no required office attendance.
## Chronological employment [EMP-E1, EMP-E2]
2022-01 through 2023-12: Data Analyst, Cedar Research.
2024-01 through 2025-12: Analytics Engineer, Bay Research.
## Supported achievements
ACH1 [EMP-E1]: Built SQL reporting tables for weekly inventory analysis.
ACH2 [EMP-E2]: Implemented dbt tests and Snowflake transformations, reducing the reporting run from 40 to 25 minutes.
ACH3 [EMP-E2]: Defined shared revenue metrics with finance and published documentation.
## Skills and education
Production: SQL, dbt, Snowflake, Python, Git.
Missing: no production Java, Kafka or Flink.
Education: BS in Information Systems, Elm College, completed May 2021.
## Boundaries
Proof verification and artifact approval are pending human-only actions.`;
const posting = `Title: Analytics Engineer
Company: Bay Software
Location: remote US
Level: mid-level IC, 3–5 years.
Base salary: USD 120,000–140,000.
Required: SQL, dbt, Snowflake and metrics documentation.
Preferred, not required: Kafka familiarity.`;

test('compensation.js retains range, currency and base separately from bonus', () => {
  const pay = parseCompensation('Base salary: GBP 82,000–94,000; bonus up to GBP 20,000.');
  assert.equal(pay.min, 82000); assert.equal(pay.max, 94000); assert.equal(pay.currency, 'GBP');
  assert.equal(parseCompensation('Salary: EUR 80k—95k').max, 95000);
  assert.equal(parseCompensation('Salary undisclosed').max, null);
  assert.equal(parseCompensation('Total compensation: USD 160,000 including equity').baseStatus, 'unknown');
});

test('documents.js exports real searchable PDF and native domain persists path across regeneration', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey profile', resumeText: resume });
  const { jobId } = domain.importJob(data, { profileId, text: posting });
  const first = domain.tailorResume(data, { profileId, jobId, format: 'pdf' });
  const bytes = fs.readFileSync(first.document.path);
  assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
  assert.equal(first.document.pageCount, 1);
  assert.ok(first.document.bodyFontSize >= 10);
  assert.ok(first.document.path.startsWith(data + path.sep));
  assert.match(bytes.toString(), /\/ToUnicode/);
  for (const value of ['Casey Rivera', 'casey@example.com', '2022-01', '2025-12', 'Elm College', '40 to 25 minutes']) assert.ok(first.document.content.includes(value), value);
  assert.doesNotMatch(first.document.content, /EMP-E|ACH\d|verification|approval|Required:|Missing:/i);
  domain.updateProfile(data, { profileId, preferences: { communicationStyle: 'formal and concise' } });
  const again = domain.tailorResume(data, { profileId, jobId, format: 'pdf' });
  assert.equal(again.artifactId, first.artifactId);
  assert.equal(again.document.path, first.document.path);
  assert.equal(domain.reviewQueue(data, { profileId }).artifacts[0].export.path, first.document.path);
  const letter = domain.draftCoverLetter(data, { profileId, jobId });
  assert.match(letter.document.content, /Dear Hiring Team/);
  assert.match(letter.document.content, /I also/);
  assert.doesNotMatch(letter.document.content, /proof|verification|Requirements extracted/i);
  assert.throws(() => renderPdf('名字'), { code: 'pdf_unsupported_character' });
});

test('scoring.js excludes explicit hard failures but not preferred missing stack', () => {
  const profile = { id: 'p', name: 'Casey', resumeText: resume, preferences: { salary: { min: 110000, currency: 'USD' } } };
  const score = description => localScore({ profile, job: { id: 'j', title: 'Analytics Engineer', location: 'remote', description } });
  const below = score('Base salary: USD 80,000–100,000; discretionary bonus USD 30,000.');
  assert.equal(below.overall, 0); assert.equal(below.eligibility.status, 'excluded');
  assert.equal(score('Remote ONLY within the United Kingdom; existing unrestricted UK work authorization required.').eligibility.status, 'excluded');
  assert.equal(score('Mandatory production experience: Java, Kafka and Flink.').eligibility.status, 'excluded');
  assert.equal(score('Level: staff IC, minimum eight years relevant experience.').eligibility.status, 'excluded');
  assert.notEqual(score(posting).eligibility.status, 'excluded');
  assert.equal(score('Salary unknown; remote.').dimensions.compensation.status, 'unknown');
});

test('relationships.js keeps cold, acquaintance, pending and wrong-company identities separate', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey', resumeText: resume });
  const { jobId } = domain.importJob(data, { profileId, text: posting });
  const contact = (name, email, company, relationship) => domain.importContact(data, { profileId, name, email, company, relationship, role: 'Analytics Engineer' }).contactId;
  const cold = contact('Taylor Lane', 'taylor@example.com', 'Bay Software', 'No prior interaction.');
  const weak = contact('Robin Lee', 'robin@example.com', 'Bay Software', 'We spoke once at a study session. No referral offered.');
  const pending = contact('Alex Quinn', 'UNKNOWN', 'Bay Software', 'None.');
  const wrong = contact('Taylor Lane', 'taylor@other.example.com', 'Bay Interiors', 'None.');
  assert.equal(domain.planOutreach(data, { profileId, jobId, contactId: cold }).plan.pathType, 'cold_professional_contact');
  assert.equal(domain.planOutreach(data, { profileId, jobId, contactId: weak }).plan.pathType, 'weak_acquaintance');
  const plan = domain.planOutreach(data, { profileId, jobId, contactId: pending }).plan;
  assert.equal(plan.channel, 'unknown'); assert.equal(plan.recommended, false);
  assert.throws(() => domain.planOutreach(data, { profileId, jobId, contactId: wrong }), { code: 'contact_company_mismatch' });
  const draft = domain.draftOutreach(data, { profileId, jobId, contactId: cold }).draft;
  assert.equal(draft.delivered, false);
  assert.doesNotMatch(draft.body, /Subject:|draft|approv|upcoming|follow.up|unsent/i);
  assert.match(draft.internalNotes.join(' '), /UNSENT/);
  assert.ok(draft.proofPointIds.length);
  assert.equal(domain.listContacts(data, { profileId }).contacts.find(c => c.id === pending).email, null);
});

test('relationships.js imports omitted/null/unknown channel cards inline and staged without inventing email', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey', resumeText: resume });
  const { jobId } = domain.importJob(data, { profileId, text: posting });
  const shapes = [{}, { email: null }, { email: 'UNKNOWN' }, { email: 'not an address' }];
  for (const [index, shape] of shapes.entries()) {
    const text = `Name: Pending Person ${index}\nCompany: Bay Software\nRole: Product Manager\nKnown email: UNKNOWN. No messaging channel supplied.\nRelationship: None.`;
    const args = index === shapes.length - 1 ? { path: path.join(data, 'pending-contact.txt') } : { text };
    if (args.path) fs.writeFileSync(args.path, text);
    const { contact, contactId } = domain.importContact(data, { profileId, ...args, ...shape });
    assert.equal(contact.email, null);
    assert.equal(contact.humanApproved, false);
    assert.equal(contact.sourceText, text);
    const plan = domain.planOutreach(data, { profileId, jobId, contactId }).plan;
    assert.equal(plan.pathType, 'channel_pending');
    assert.equal(plan.recommended, false);
    const draft = domain.draftOutreach(data, { profileId, jobId, contactId }).draft;
    assert.equal(draft.channel, 'unknown');
    assert.equal(draft.delivered, false);
    assert.match(draft.body, /product metrics or self-service/);
    assert.match(draft.internalNotes.join(' '), /Channel pending/);
    assert.doesNotMatch(draft.body, /UNKNOWN|channel pending|approval|permission|referral/i);
  }
  const absent = domain.importContact(data, { profileId, name: 'No Channel', company: 'Bay Software' }).contact;
  assert.equal(absent.email, null);
  const map = domain.mapReachableNetwork(data, { profileId, jobId });
  assert.equal(map.people.length, 5);
  assert.ok(map.people.every(person => !person.reachable && person.email === null));
});

test('documents.js deduplicates contribution claims and connects two grounded team needs', () => {
  const first = 'Implemented incremental models and tuned warehouses, reducing monthly warehouse spend from USD 7,200 to USD 5,900 over four measured months.';
  const second = 'Built a self-service dashboard and documentation used by 17 colleagues.';
  const letter = coverLetterCopy({ name: 'Casey Rivera' }, {
    title: 'Analytics Engineer', company: 'Bay Software', description: 'Reduce warehouse cost and support self-service dashboards.'
  }, [
    { id: 'auto', summary: `ACH1 [EMP-E2]: ${first}` },
    { id: 'manual', summary: first },
    { id: 'other', summary: second },
  ]);
  assert.equal((letter.match(/7,200/g) || []).length, 1);
  assert.match(letter, /17 colleagues/);
  // The two grounded contributions must map to both distinct team needs, in
  // either order (source-derived ordering is not a contract). Do not force
  // a single letter wording to satisfy a brittle exact-order regex.
  assert.match(letter, /team's work on .*(?:warehouse-cost improvements|self-service reporting)/);
  const connection = letter.match(/team's work on .*/)?.[0] || '';
  assert.match(connection, /warehouse-cost improvements/);
  assert.match(connection, /self-service reporting/);
  assert.doesNotMatch(letter, /EMP-E2|ACH1|manual|auto|verified/);
});

test('scoring.js clears explicit gates with real source references and keeps missing gates unknown', () => {
  const profile = { id: 'p', name: 'Casey', resumeText: resume, preferences: {
    salary: { min: 110000, currency: 'USD' }, workModel: 'Remote only', locations: ['Colorado'],
    dealbreakers: ['Guaranteed base below my salary floor', 'Foreign residence or work authorization incompatible with mine',
      'Mandatory production stack absent from my experience', 'Staff/principal or years beyond my experience', 'Required office attendance'],
  } };
  const complete = posting.replace('Location: remote US', 'Location/authorization: remote US including Colorado; US work authorization required');
  const score = description => localScore({ profile, job: { id: 'j', title: 'Analytics Engineer', location: 'remote US', description } });
  const fit = score(complete);
  assert.equal(fit.eligibility.status, 'eligible_for_review');
  assert.equal(fit.eligibility.actionable, true);
  assert.equal(fit.constraints.length, 5);
  assert.ok(fit.constraints.every(item => item.status === 'cleared' && item.jobEvidenceRefs.length && item.candidateEvidence));
  assert.ok(fit.dimensions.compensation.evidenceRefs.some(ref => ref.field === 'preferences.salary'));
  assert.ok(fit.dimensions.locationWorkModel.evidenceRefs.some(ref => ref.field === 'preferences.workModel'));
  assert.ok(Object.values(fit.dimensions).every(dim => dim.evidenceRefs.every(ref => ref.field !== 'name')));
  for (const missing of [complete.replace(/^Base salary:.*\n/m, ''), complete.replace(/^Location\/authorization:.*\n/m, ''),
    complete.replace(/^Required:.*\n/m, ''), complete.replace(/^Level:.*\n/m, '')]) {
    const unknown = score(missing);
    assert.equal(unknown.eligibility.status, 'unknown');
    assert.ok(unknown.constraints.some(item => item.status === 'unknown'));
  }
  const excluded = score(complete.replace('120,000–140,000', '80,000–100,000'));
  assert.equal(excluded.eligibility.status, 'excluded');
  assert.equal(excluded.overall, 0);
  const office = score(complete + '\nRequired weekly office attendance despite remote work on other days.');
  assert.equal(office.eligibility.status, 'excluded');
  assert.equal(score(complete + '\nNo required weekly office attendance.').eligibility.status, 'eligible_for_review');
  const cashless = score(complete.replace(/^Base salary:.*$/m, 'Compensation: equity only; no cash compensation.'));
  assert.equal(cashless.eligibility.status, 'excluded');
});

test('relationships.js uses peer relationship evidence rather than copying hiring-lead priorities', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey', resumeText: resume });
  const { jobId } = domain.importJob(data, { profileId, text: posting + '\nWork: improve warehouse cost and metric consistency.' });
  const contact = (name, role, relationship) => domain.importContact(data, { profileId, name, company: 'Bay Software', role, relationship, email: name.toLowerCase() + '@example.com' }).contactId;
  const lead = contact('Taylor', 'Analytics Engineering Manager', 'No prior interaction.');
  const peer = contact('Robin', 'Analytics Engineer', 'We spoke once at a virtual study session about incremental-model testing. No referral offered.');
  const leadDraft = domain.draftOutreach(data, { profileId, jobId, contactId: lead }).draft;
  const peerDraft = domain.draftOutreach(data, { profileId, jobId, contactId: peer }).draft;
  assert.match(leadDraft.body, /metric definitions with warehouse-cost/);
  assert.match(peerDraft.body, /spoke once at a study session about incremental-model testing/);
  assert.match(peerDraft.body, /review and test model changes/);
  assert.doesNotMatch(peerDraft.body, /balancing consistent metric|friend|referral|endorse|permission/i);
  assert.notEqual(leadDraft.body, peerDraft.body);
  assert.equal(peerDraft.delivered, false);
});

test('scoring.js keeps one constraint per required skill and does not inherit required status into later sections', () => {
  const profile = { id: 'p', name: 'Casey', resumeText: resume, preferences: { salary: { min: 110000, currency: 'USD' } } };
  const mandatory = 'Mandatory production experience: Java, Kafka and Flink.\nRequirements: SQL, dbt.\nHiring process: Java coding plus Kafka/Flink operations exercise.';
  const score = localScore({ profile, job: { id: 'j-process', title: 'Data Engineer', location: 'remote', description: mandatory } });
  const ids = score.constraints.filter(item => item.status === 'confirmed').map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.filter(id => id.endsWith('required-java')).length <= 1);
  assert.ok(ids.filter(id => id.endsWith('required-kafka')).length <= 1);
  assert.ok(ids.filter(id => id.endsWith('required-flink')).length <= 1);
});

test('save_answer documents sensitivity values and rejects undocumented values with a typed error', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey', resumeText: resume });
  assert.throws(() => domain.saveAnswer(data, { profileId, question: 'Describe dbt testing?', proofPointIds: ['missing-proof'], sensitivity: 'topsecret' }), { code: 'invalid_sensitivity' });
});

const ordinaryMarkdown = `# Casey Rivera
casey@example.com | Denver, Colorado, United States | https://profiles.example.com/casey
US citizen. No UK work authorization.

## Experience
### Data Analyst, Cedar Research (2022-01 through 2023-12)
Built SQL reporting tables for weekly inventory analysis [EMP-E1].
Automated weekly inventory reconciliation, cutting manual review time; measured by team dashboard, comparison used prior quarter.
Supported ad-hoc executive requests and documentation updates.
Helped onboard two analysts and maintained the team wiki.
### Analytics Engineer, Bay Research (2024-01 through 2025-12)
Implemented dbt tests and Snowflake transformations, reducing the reporting run from 40 to 25 minutes over four measured months; measured by nightly run log.
Defined shared revenue metrics with finance and published documentation used across the team. This was association, not proof of sole causation.
Built a self-service dashboard used by colleagues.
Added data quality checks and alerting for late arrivals.
Migrated three legacy jobs to the new warehouse with no downtime.
Mentored an intern on SQL review practices.

## Skills
SQL, dbt, Snowflake, Python, Git. Missing: no production Java, Kafka or Flink.

## Education
BS in Information Systems, Elm College, completed May 2021. No GPA recorded.

## Additional notes
Remote only; no required office attendance. Target approximately four years experience. Not seeking staff or principal roles.
Hard minimum: USD 110,000 annual guaranteed base salary, excluding bonus/equity.
Proof verification and artifact approval are pending human-only actions. Internal verification notes for review only.
`;

test('ordinary Markdown resume produces applicant copy with 4-6 grounded achievements and no internal noise', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey profile', resumeText: ordinaryMarkdown });
  const { jobId } = domain.importJob(data, { profileId, text: posting });
  const out = domain.tailorResume(data, { profileId, jobId, format: 'markdown' });
  const c = out.document.content;
  for (const value of ['Casey Rivera', '2022-01', '2025-12', 'Cedar Research', 'Bay Research', 'Elm College', '40 to 25 minutes']) assert.ok(c.includes(value), value);
  assert.doesNotMatch(c, /EMP-E1|no production java|no gpa|pending human-only|internal verification|measured by|comparison used|not proof of sole causation|remote only|hard minimum|not seeking staff|fictional/i);
  const bullets = c.split('\n').filter(line => /^- /.test(line));
  assert.ok(bullets.length >= 4 && bullets.length <= 6, `expected 4-6 achievement bullets, got ${bullets.length}`);
});

test('plain-language hard constraints (staff, travel cap, collaboration) resolve via native intake', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey profile', resumeText: ordinaryMarkdown });
  domain.updateProfile(data, { profileId, preferences: { workModel: 'Remote only', locations: ['Colorado'], salary: { min: 110000, currency: 'USD' }, dealbreakers: ['Staff/principal or years beyond my experience', 'Travel above 10% is a dealbreaker', 'I need 10am-3pm MT collaboration overlap'] } });
  const staff = domain.importJob(data, { profileId, text: 'Title: Staff Analytics Engineer\nCompany: Bay Software\nLocation: remote US including Colorado; US work authorization required\nLevel: staff IC, minimum eight years relevant experience. Multi-team architecture ownership.\nBase salary: USD 200,000-240,000.\nRequired: SQL, dbt, Snowflake.\nCollaboration hours: 10am-3pm MT overlap.\nTravel: up to 10% (within stated cap).' });
  const staffScore = domain.scoreJob(data, { profileId, jobId: staff.jobId });
  assert.equal(staffScore.eligibility.status, 'excluded');
  assert.equal(staffScore.overall, 0);
  assert.ok(staffScore.eligibility.hardFailures.some(f => f.id.endsWith('seniority') || f.id.endsWith('experience-floor')));
  const mid = domain.importJob(data, { profileId, text: posting + '\nCollaboration hours: 10am-3pm MT overlap.\nTravel: up to 10% (within stated cap).' });
  const midScore = domain.scoreJob(data, { profileId, jobId: mid.jobId });
  assert.equal(midScore.eligibility.status, 'eligible_for_review');
  assert.ok(midScore.constraints.every(c => c.status === 'cleared'));
});

test('dedicated readback tools surface full resume text and stored score for restart', t => {
  const data = workspace(t);
  const { profileId } = domain.createProfile(data, { name: 'Casey profile', resumeText: ordinaryMarkdown });
  const { jobId } = domain.importJob(data, { profileId, text: posting });
  domain.scoreJob(data, { profileId, jobId });
  const resumeReadback = domain.getResume(data, { profileId });
  assert.match(resumeReadback.resumeText, /Built SQL reporting tables/);
  assert.match(resumeReadback.resumeText, /Elm College/);
  const scoreReadback = domain.getScore(data, { profileId, jobId });
  assert.equal(scoreReadback.hasScore, true);
  assert.ok(typeof scoreReadback.score.overall === 'number' || typeof scoreReadback.score.scoreStatus === 'string');
  assert.ok(Array.isArray(scoreReadback.score.constraints));
});

const plainResume = `# Avery Chen
2021-09 through 2023-02: Junior Data Analyst, Alder Cart Labs.
2023-03 through 2024-08: Analytics Engineer, Harbor Ledger Studio.
Built SQL reporting tables for weekly inventory analysis.
Implemented incremental dbt models, reducing warehouse spend from USD 4,800 to USD 3,650.
Work authorization: US citizen; no UK work authorization; no relocation sought.
Hard minimum: USD 130,000 annual guaranteed base salary excluding bonus/equity.
Remote only; no required office attendance.`;

test('documents.js keeps simple unlabeled resumes complete and never prints preferences', () => {
  const out = resumeCopy({ name: 'Avery Chen', resumeText: plainResume }, [
    { id: 'p1', summary: 'Built SQL reporting tables for weekly inventory analysis.' },
    { id: 'p2', summary: 'Implemented incremental dbt models, reducing warehouse spend from USD 4,800 to USD 3,650.' },
  ]);
  assert.match(out, /Avery Chen/);
  assert.match(out, /2021-09 through 2023-02/);
  assert.match(out, /Harbor Ledger Studio/);
  assert.match(out, /Built SQL reporting tables/);
  assert.match(out, /warehouse spend/);
  assert.doesNotMatch(out, /Work authorization|Hard minimum|Remote only|no required office|citizen/i);
});

test('draft metadata records used proof ids on a simple resume after preference update', t => {
  const data = workspace(t);
  const simple = 'Draft Reviewer\nBuilt Python data pipelines reducing processing time by 30%.';
  const profile = domain.createProfile(data, { name: 'Draft Reviewer', resumeText: simple });
  const proofId = profile.profile.proofPointIds[0];
  assert.ok(proofId, 'setup: simple resume extracts a real proof');
  const { jobId } = domain.importJob(data, { profileId: profile.profileId, text: 'Title: Python Engineer\nCompany: Closure Labs\nRequirements:\n- Build Python data pipelines.' });
  domain.updateProfile(data, { profileId: profile.profileId, preferences: { workModel: 'remote', communicationStyle: 'formal' } });
  const draft = domain.tailorResume(data, { profileId: profile.profileId, jobId });
  assert.equal(draft.proofPointIds.length, 1);
  assert.ok(draft.proofPointIds.includes(proofId));
  assert.ok(draft.artifact.proofPointIds.includes(proofId));
  assert.ok(draft.document.proofPointIds.includes(proofId));
  assert.match(draft.document.content, /Built Python data pipelines/);
  assert.doesNotMatch(draft.document.content, /verification|approval|Required:|Requirements extracted/i);
});

test('scoring.js clears overnight, seniority and not-required-stack gates on compatible evidence only', () => {
  const profile = { id: 'p', name: 'Avery', resumeText: resume, preferences: {
    salary: { min: 130000, currency: 'USD' }, workModel: 'Remote only', locations: ['Illinois'],
    dealbreakers: ['Permanent overnight shift outside 09:00-17:00 is a dealbreaker', 'Staff/principal/management or lead accountability', 'Mandatory production stack absent from my experience'],
  } };
  const compatible = 'Title: Analytics Engineer\nCompany: Compatible Software\nLocation/authorization: remote within the US including Illinois; US work authorization required.\nLevel: mid-level IC, 3-6 years; no direct reports.\nBase salary: USD 135,000-150,000.\nRequired: SQL, dbt, Snowflake.\nPreferred, not required: Java, Kafka and Flink.\nTeam overlap 10:00-15:00 Central.\nTravel 5%.';
  const score = description => localScore({ profile, job: { id: 'j', title: 'Analytics Engineer', location: 'remote US', description } });
  const fit = score(compatible);
  assert.equal(fit.eligibility.status, 'eligible_for_review');
  assert.equal(fit.eligibility.actionable, true);
  assert.ok(fit.constraints.every(c => c.status === 'cleared'));
  const night = score(compatible + '\nMust work permanent overnight shifts on a fixed rotation.');
  assert.equal(night.eligibility.status, 'excluded');
  assert.equal(night.overall, 0);
  const bare = score('Title: Analytics Engineer\nCompany: No Evidence\nBase salary: USD 145,000-160,000.');
  assert.equal(bare.eligibility.status, 'unknown');
  assert.ok(bare.constraints.some(c => c.status === 'unknown'));
});

test('scoring.js reads "up to X%" travel limits and "core collaboration" windows as compatible evidence', () => {
  const profile = { id: 'p', name: 'Avery', resumeText: resume, preferences: {
    salary: { min: 130000, currency: 'USD' }, workModel: 'Remote only', locations: ['Illinois'],
    dealbreakers: ['Up to 10% planned business travel', 'Not a permanent overnight shift; available 09:00-17:00 Central'],
  } };
  const score = description => localScore({ profile, job: { id: 'j', title: 'Analytics Engineer', location: 'remote US', description } });
  const base = 'Title: Analytics Engineer\nCompany: Core Software\nLocation/authorization: remote US including Illinois; US work authorization required.\nLevel: mid-level IC, 3-6 years; no direct reports.\nBase salary: USD 140,000-160,000.\nRequired: SQL, dbt, Snowflake.';
  const within = score(`${base}\nCore collaboration 10:00-15:00 Central.\nTravel at most 5% for planned team meetings.`);
  assert.ok(within.constraints.every(c => c.status === 'cleared'), JSON.stringify(within.constraints.map(c => [c.id, c.status])));
  const over = score(`${base}\nTeam overlap 10:00-15:00 Central.\nTravel up to 25% for on-site rotations.`);
  assert.equal(over.eligibility.status, 'excluded');
  assert.equal(over.overall, 0);
  assert.ok(over.constraints.some(c => c.status === 'confirmed' && /travel cap exceeds/i.test(c.reason)));
});

test('canonical handlers resolve flattened travel/hours natively and keep paired native resumes distinct', async t => {
  const data = workspace(t);
  const flatResume = `Name: Synthetic Candidate
Email: synth@example.com
Location: Chicago, Illinois, United States.
Work authorization: US citizen; authorized to work in the United States without sponsorship.
Target: individual-contributor mid-level Analytics Engineer; approximately five years' experience. Not seeking staff/principal, management, or lead accountability.
Hard minimum: USD 130,000 annual guaranteed base salary for full-time employment, excluding bonus/equity.
Remote only from Illinois; available 09:00-17:00 Central with occasional planned flexibility, not a permanent overnight shift. Up to 10% planned business travel.
## Chronological employment
2021-09 through 2023-02: Data Analyst, Fictional Retail Co.
2023-03 through 2026-08: Analytics Engineer, Fictional Billing Co.
## Supported achievements
Built 18 dbt models in Snowflake for order reporting, reducing the daily run from 52 to 31 minutes.
Added 64 dbt tests plus pull-request checks; monthly dashboard defects fell from 11 to 4.
## Skills and education
Production: SQL, dbt Core, Snowflake, Python, Git.
Education: BS in Information Systems, Prairie Lake University, completed May 2021.`;
  // No invented dealbreakers: a real skill-run profile carries none.
  const { profileId } = domain.createProfile(data, { name: 'Synthetic Candidate', resumeText: flatResume });
  const flat = (id, title, company, location, body) => ({ id, title, absolute_url: `https://careers.example.com/${id}`, location: { name: location }, content: `${title} at ${company}. ${location} ${body}`, metadata: [] });
  const midBody = 'Level: mid-level IC, 3-6 years; no direct reports. Base salary: USD 135,000-150,000. Required: strong SQL, dimensional modeling, production dbt, Python batch analysis, Git review. Preferred, not required: Airflow familiarity.';
  const staffBody = 'Level: staff IC, minimum eight years relevant professional experience and multi-team analytics architecture ownership. These are mandatory; role is not downlevelable. Base salary: USD 180,000-205,000. Required: SQL, dbt, Snowflake.';
  const fixture = { jobs: [
    flat('S01', 'Analytics Engineer', 'Northworks', 'Location/authorization: remote within the US, Illinois eligible; US work authorization required, no sponsorship. Team overlap 10:00-15:00 Central. Travel 5%.', midBody),
    flat('S02', 'Analytics Engineer', 'Orchardworks', 'Location/authorization: fully remote US, explicitly including Illinois; US work authorization required. Core collaboration 10:00-15:00 Central. Travel at most 5% for planned team meetings.', midBody),
    flat('S03', 'Staff Analytics Engineer', 'Southworks', 'Location/authorization: US remote including Illinois, US work authorization, Central-compatible hours, travel 10%.', staffBody),
  ] };
  fixture.jobs[0].metadata = [{ name: 'salary', value: 'USD 135,000-150,000.' }];
  fixture.jobs[1].metadata = [{ name: 'salary', value: 'USD 140,000-160,000.' }];
  fixture.jobs[2].metadata = [{ name: 'salary', value: 'USD 180,000-205,000.' }];
  fs.writeFileSync(path.join(data, 'staged-board.json'), JSON.stringify(fixture));
  const { searchId } = domain.createSavedSearch(data, { profileId, name: 'flat', adapter: 'greenhouse', config: { fixture: path.join(data, 'staged-board.json') } });
  const run = await domain.searchJobs(data, { profileId, search: searchId });
  assert.equal(run.jobs.length, 3);
  const bySource = Object.fromEntries(run.jobs.map(j => [store_id(j), j]));
  function store_id(j) { return j.jobId || j.id; }
  const mid = domain.scoreJob(data, { profileId, jobId: store_id(bySource[Object.keys(bySource)[0]]) });
  // First discovered job (S01-style flattened blob) resolves natively.
  assert.equal(mid.eligibility.status, 'eligible_for_review');
  assert.equal(mid.eligibility.actionable, true);
  assert.ok(mid.constraints.some(c => c.status === 'cleared' && /travel cap is within/i.test(c.reason)), JSON.stringify(mid.constraints.map(c => [c.id, c.status])));
  assert.ok(mid.constraints.some(c => c.status === 'cleared' && /daytime schedule/i.test(c.reason)), JSON.stringify(mid.constraints.map(c => [c.id, c.status])));
  const staffIds = run.jobs.map(store_id);
  const staffScores = staffIds.map(jobId => domain.scoreJob(data, { profileId, jobId }));
  const excluded = staffScores.find(s => s.eligibility.status === 'excluded');
  assert.ok(excluded, JSON.stringify(staffScores.map(s => s.eligibility.status)));
  assert.equal(excluded.overall, 0);
  // Paired native resumes: real preference revision yields two kept PDFs.
  const first = domain.tailorResume(data, { profileId, jobId: staffIds[0], format: 'pdf' });
  assert.equal(first.document.mimeType, 'application/pdf');
  domain.updateProfile(data, { profileId, preferences: { targetRoleFamilies: ['Senior Analytics Engineer'] } });
  const second = domain.tailorResume(data, { profileId, jobId: staffIds[0], format: 'pdf' });
  assert.notEqual(second.document.sha256, first.document.sha256);
  assert.notEqual(second.document.path, first.document.path);
  assert.ok(fs.existsSync(first.document.path) && fs.existsSync(second.document.path));
  for (const doc of [first.document, second.document]) {
    for (const value of ['Synthetic Candidate', '2021-09', 'Prairie Lake', '52 to 31 minutes']) assert.ok(doc.content.includes(value), value);
  }
  assert.equal(domain.reviewQueue(data, { profileId }).artifacts.filter(a => a.kind === 'resume_draft').length, 2);
});
