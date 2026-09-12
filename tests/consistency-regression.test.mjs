import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as domain from '../src/domain.js';
import { parseJobText } from '../src/discovery.js';
import { hashText } from '../src/store.js';
import { pluginPath } from './helpers/jobsss-gate0.mjs';

// rc6 consistency regression (written RED first against unchanged code).
//
// Six minor consistency items, one behavior change per item, no schema
// renames, no authority changes, no parser broadening. Every test below was
// run against the pre-fix runtime and the items 1-5 tests failed then; item 6
// is a documented no-change decision (see its own test).

function workspace(t, label = 'rc6-consistency') {
  const parent = mkdtempSync(path.join(tmpdir(), `${label}-`));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dataDir = path.join(parent, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

// A resume that yields exactly one requirement-relevant proof, so an extra
// (unselected) proof can be added explicitly per test.
const RESUME = `Name: Riley Probe
Email: riley@example.com

## Employment
2022-01 through 2024-12 | Analytics Engineer | North Pine

## Supported achievements
- Built 18 dbt models in Snowflake, cutting the daily run from 52 to 31 minutes.
`;

function seedProfile(dataDir, name = 'Riley Probe') {
  domain.start(dataDir, {});
  const created = domain.createProfile(dataDir, { name, resumeText: RESUME });
  const profileId = created.profileId || created.id || created.profile?.id;
  assert.ok(profileId, `create_profile must return an id: ${JSON.stringify(created).slice(0, 300)}`);
  return profileId;
}

test('rc6-1 import_job fills the top-level compensation text from the parsed range', t => {
  const dataDir = workspace(t, 'rc6-item1');
  const profileId = seedProfile(dataDir);
  const posting = `# Analytics Engineer
Company: North Pine
Location: remote US
Required: dbt models in Snowflake.
Salary range: USD 180,000 - 200,000 annually.
`;
  const parsed = parseJobText(posting);
  assert.equal(parsed.compensationJson.min, 180000, 'harness: the range must be parsed');
  assert.equal(parsed.compensationJson.max, 200000, 'harness: the range must be parsed');
  assert.equal(
    parsed.compensation,
    parsed.compensationJson.text,
    `an unlabeled pay range must populate the top-level compensation text: ${JSON.stringify({ compensation: parsed.compensation, parsed: parsed.compensationJson })}`
  );

  const imported = domain.importJob(dataDir, { profileId, text: posting });
  assert.equal(imported.job.compensation, parsed.compensationJson.text, 'the stored job must carry the same text as parseJobText');
  assert.equal(imported.job.compensationJson.min, 180000, 'the stored job keeps the parsed range');

  // An explicit qualitative label is a real value and must never be replaced
  // by a parseable range elsewhere in the posting (frozen intake-t3 contract).
  const labeled = parseJobText('# Backend Engineer\nPay: competitive\nWe offer USD 140,000 - 160,000 per year.\n');
  assert.equal(labeled.compensation, 'competitive', `an explicit label must survive: ${JSON.stringify(labeled.compensation)}`);
  assert.equal(labeled.compensationJson.min, 140000, 'harness: the whole-source range is still parsed alongside the label');

  // Nothing parsed and nothing labeled stays empty: no invented pay text.
  const none = parseJobText('# Analytics Engineer\nCompany: North Pine\nWe build reporting tools.\n');
  assert.equal(none.compensationJson.min, null, 'harness: no range in this posting');
  assert.equal(none.compensation, '', 'a posting with no pay evidence must keep an empty compensation text');
});

test('rc6-2 a saved search records the same minFit in its identity as on the record', t => {
  const dataDir = workspace(t, 'rc6-item2');
  const profileId = seedProfile(dataDir);
  const config = { boardToken: 'example-learning', company: 'Example Learning Co' };

  const strict = domain.createSavedSearch(dataDir, { profileId, name: 'Strict board', adapter: 'greenhouse', config, minFit: 88 });
  assert.equal(strict.search.minFit, 88, 'the requested floor is stored');
  assert.match(
    strict.search.identity,
    /"minFit":88/,
    `the identity must record the same floor as the record: ${strict.search.identity}`
  );

  // A different floor is a different search: the identity must not collapse it.
  const relaxed = domain.createSavedSearch(dataDir, { profileId, name: 'Relaxed board', adapter: 'greenhouse', config, minFit: 70 });
  assert.equal(relaxed.created, true, `a search with a different minFit must not dedupe into the first: ${JSON.stringify(relaxed.search)}`);
  assert.notEqual(relaxed.search.id, strict.search.id, 'distinct floors stay distinct searches');
  assert.equal(relaxed.search.minFit, 70);
  assert.match(relaxed.search.identity, /"minFit":70/, `the relaxed identity records its own floor: ${relaxed.search.identity}`);

  // The same floor still dedupes (identity stability is preserved).
  const repeat = domain.createSavedSearch(dataDir, { profileId, name: 'Strict board again', adapter: 'greenhouse', config, minFit: 88 });
  assert.equal(repeat.deduped, true, 'an equivalent search with the same floor must dedupe');
  assert.equal(repeat.search.id, strict.search.id);

  // Default: the documented default floor is what both the record and the
  // identity say — never 70 on the record and null in the identity.
  const fallback = domain.createSavedSearch(dataDir, { profileId, name: 'Default board', adapter: 'greenhouse', config: { boardToken: 'other-learning', company: 'Other Learning Co' } });
  assert.equal(fallback.search.minFit, 70, 'the default floor stays 70');
  assert.match(fallback.search.identity, /"minFit":70/, `the default identity must agree with the record: ${fallback.search.identity}`);
});

test('rc6-3 cover letter citations come only from selectedProofPointIds', t => {
  const dataDir = workspace(t, 'rc6-item3');
  const profileId = seedProfile(dataDir);
  const posting = `# Analytics Engineer
Company: North Pine
Location: remote US
Required: dbt models in Snowflake.
We also care about product management, roadmap briefs and stakeholder reporting.
`;
  const imported = domain.importJob(dataDir, { profileId, text: posting });
  const jobId = imported.jobId || imported.id;
  // Relevant to the posting wording (so the letter's own ranking prefers it)
  // but not requirement-matched, therefore never in selectedProofPointIds.
  const unrelated = domain.addProofPoint(dataDir, {
    profileId,
    summary: 'Wrote 40 product management roadmap briefs for stakeholder reporting at three sites.',
    skills: ['product management', 'roadmap', 'stakeholder'],
  });
  const unrelatedId = unrelated.proofId || unrelated.id;

  const letter = domain.draftCoverLetter(dataDir, { profileId, jobId, format: 'markdown' });
  const selected = letter.selectedProofPointIds || letter.selectedProofIds || [];
  const cited = letter.artifact?.proofPointIds || letter.proofPointIds || [];
  assert.ok(selected.length >= 1, `harness: the dbt proof must be selected: ${JSON.stringify(letter).slice(0, 400)}`);
  assert.equal(
    selected.includes(unrelatedId),
    false,
    `harness: the unrelated proof must not be requirement-selected: ${JSON.stringify(selected)}`
  );
  for (const id of cited) {
    assert.ok(
      selected.includes(id),
      `every cited proof must be among selectedProofPointIds: cited ${JSON.stringify(cited)} vs selected ${JSON.stringify(selected)}`
    );
  }
  assert.equal(
    cited.includes(unrelatedId),
    false,
    `the unselected proof must not be cited by the draft: ${JSON.stringify(cited)}`
  );
  const content = letter.document?.content || letter.artifact?.content || '';
  assert.doesNotMatch(
    content,
    /40 product management roadmap briefs/,
    'an unselected proof must not be copied into the letter'
  );
  assert.match(content, /18 dbt models/, 'the selected proof still grounds the letter');
});

test('rc6-4 relationship evidence keeps relationship/channel facts, not the raw staged record', t => {
  const dataDir = workspace(t, 'rc6-item4');
  const profileId = seedProfile(dataDir);
  const imported = domain.importJob(dataDir, { profileId, text: '# Analytics Engineer\nCompany: North Pine\nRequired: dbt models.\n' });
  const jobId = imported.jobId || imported.id;
  const card = `Name: Robin Lee
Company: North Pine
Role: Analytics Engineer
Known email: robin@example.com
Relationship: We spoke once at a study session. No referral offered.
Stage: stage-42 internal tracking note
Internal id: xyz-999
Recruiter pipeline snapshot: awaiting review by committee chair
`;
  const contact = domain.importContact(dataDir, { profileId, text: card });
  assert.equal(contact.contact.relationshipEvidence, 'We spoke once at a study session. No referral offered.', 'harness: the labeled relationship is kept on the contact');
  assert.equal(contact.contact.sourceText, card, 'the raw staged record is still stored as source text (unchanged)');

  const map = domain.mapReachableNetwork(dataDir, { profileId, jobId });
  const person = map.people.find(entry => entry.id === contact.contactId);
  assert.ok(person, 'the contact must appear in the reachable map');
  assert.match(person.relationshipEvidence, /spoke once at a study session/, 'relationship evidence still reaches the map');
  assert.doesNotMatch(person.relationshipEvidence, /stage-42|Internal id|Recruiter pipeline snapshot/i, `the raw staged record must not be concatenated into relationshipEvidence: ${JSON.stringify(person.relationshipEvidence)}`);
  // Classification behaviour is preserved: the relationship facts still
  // produce the same path/channel answer.
  assert.equal(person.pathType, 'weak_acquaintance', `warmth classification must be unchanged: ${JSON.stringify(person)}`);
  assert.equal(person.channel, 'email');
});

test('rc6-5 start reports migrated only when a migration actually ran', t => {
  const emptyDir = workspace(t, 'rc6-item5-empty');
  const fresh = domain.start(emptyDir, {});
  assert.equal(fresh.migrated, false, `a genuinely empty PLUGIN_DATA must not report a migration: ${JSON.stringify(fresh)}`);
  assert.equal(fresh.schemaVersion, 2, 'the current schema is written');
  const again = domain.start(emptyDir, {});
  assert.equal(again.migrated, false, 'an already-current store is not migrated again');

  const legacyDir = workspace(t, 'rc6-item5-legacy');
  copyFileSync(pluginPath('tests/fixtures/legacy-store-v1.json'), path.join(legacyDir, 'store.json'));
  const migrated = domain.start(legacyDir, {});
  assert.equal(migrated.migrated, true, `a legacy v1 store must report its migration: ${JSON.stringify(migrated)}`);
  assert.equal(migrated.schemaVersion, 2, 'the migrated store is current');
});

// rc6-6 (documented, no behavior change): the inline `sourceHash` stays a hash
// of the stored posting text after intake normalization (inline intake trims;
// a staged file keeps its exact bytes). It is deliberately NOT re-derived from
// a further normalized content form, because that would move every existing
// dedupe key: frozen greenhouse-benchmark (G9 `sourceHash must stay the hash of
// the verbatim posting`) and intake-t3 pin `hashText(<posting>.trim())`, and
// `findDuplicateJob` relies on text-record `sourceHash` equality for dedupe.
// The item is therefore closed as "document and leave", and this test pins the
// documented behavior (it passes before and after this lane's changes).
test('rc6-6 inline sourceHash stays the normalized-intake text hash (documented, unchanged)', t => {
  const dataDir = workspace(t, 'rc6-item6');
  const profileId = seedProfile(dataDir);
  const posting = '# Analytics Engineer\nCompany: North Pine\nRequired: dbt models in Snowflake.\n';
  const first = domain.importJob(dataDir, { profileId, text: posting });
  assert.equal(first.job.sourceHash, hashText(posting.trim()), 'sourceHash is the hash of the intake-normalized (trimmed) posting text');
  const repeat = domain.importJob(dataDir, { profileId, text: posting });
  assert.equal(repeat.deduped, true, 'the same text dedupes on that hash');
  assert.equal(repeat.jobId, first.jobId, 'a repeat import returns the same job');
  const padded = domain.importJob(dataDir, { profileId, text: `\n\n  ${posting}\n\n ` });
  assert.equal(padded.deduped, true, 'intake normalization keeps whitespace-only variants stable');
  assert.equal(padded.jobId, first.jobId, 'trim-only normalization must not fork the record');
  const changed = domain.importJob(dataDir, { profileId, text: `${posting}Hybrid, three days on site.\n` });
  assert.equal(changed.deduped ?? false, false, 'changed text is a distinct record');
  assert.notEqual(changed.jobId, first.jobId, 'dedupe stays stable for the changed text');
});
