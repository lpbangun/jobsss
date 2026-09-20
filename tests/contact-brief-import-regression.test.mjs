// G5 corrective regression: native `contact-brief.v1` import and safe
// reconciliation of machine-created contact duplicates.
//
// Contract under test:
//   * a staged or inline `contact-brief.v1` payload is a first-class
//     `import_contact` source: the subject identity and the attribution-labelled
//     provider-reported address are parsed natively, so a caller never has to
//     restate them as inline fields, while the generic contact card/free-text
//     import keeps working;
//   * the imported record stays `humanApproved: false` with the provider
//     attribution and the `not_checked` mailbox status: a provider-reported
//     address is never presented as a verified mailbox, and nothing is sent;
//   * an idempotent restart (a second process, the same payload) returns the
//     same contact id and adds no duplicate logical contact and no duplicate
//     provenance entry;
//   * `record_contact_discovery` followed by an address-less staged import of the
//     same normalized name+company produces ONE logical contact;
//   * human-approved, suppressed, do-not-use, human-note and conflicting-address
//     records are never deleted, overwritten or collapsed;
//   * the arbitrary-path guard and the staged-file requirement are intact.
//
// Everything here is offline and synthetic: fixtures under
// tests/fixtures/contact-brief/ (fictional people, reserved .test domains),
// isolated temporary PLUGIN_DATA, no provider call, no send, no approval.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT, pluginPath } from './helpers/jobsss-gate0.mjs';
import {
  callRequest,
  initializeRequest,
  isRejected,
  isolate,
  mcp,
  parseToolValue,
  readStore,
  rejectionBlob,
  requireOk,
  resumeFixture
} from './helpers/jobsss-live-mcp.mjs';

const BRIEF_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'contact-brief');
const briefFixture = name => JSON.parse(readFileSync(path.join(BRIEF_DIR, name), 'utf8'));

/** Stage a fixture inside the isolated PLUGIN_DATA (the only allowed location). */
function stage(ctx, fixtureName, asName = fixtureName) {
  const target = path.join(ctx.dataDir, asName);
  copyFileSync(path.join(BRIEF_DIR, fixtureName), target);
  return target;
}

async function createProfile(ctx, name = 'Jordan Example') {
  const session = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'create_profile', { name, resumePath: resumeFixture(), path: resumeFixture() })
  ], { timeoutMs: 60_000 });
  return requireOk(session, 2, 'create_profile').profileId;
}

async function importContact(ctx, args, requestId = 2) {
  const session = await mcp(ctx, [initializeRequest(1), callRequest(requestId, 'import_contact', args)], { timeoutMs: 60_000 });
  const frame = session.frames.find(item => item.id === requestId);
  return { frame, value: parseToolValue(frame) };
}

/** One contact record per profile, keyed by id, plus the raw collection. */
function contactsOf(ctx) {
  const store = readStore(ctx.dataDir);
  return Object.values(store.contacts || {}).filter(contact => contact?.id);
}

function provenanceLength(contact) {
  return Array.isArray(contact?.provenanceHistory) ? contact.provenanceHistory.length : 0;
}

function decide(ctx, args) {
  const result = spawnSync(ctx.launcher, ['decide', '--data', ctx.dataDir, ...args], {
    cwd: REPO_ROOT, env: ctx.env, encoding: 'utf8'
  });
  const text = String(result.stdout || '').trim();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { code: result.status, json, text, stderr: String(result.stderr || '') };
}

/** Complete one human-only decision through the trusted local CLI surface. */
function humanDecision(ctx, action, entityId) {
  const listed = decide(ctx, ['--list']);
  assert.equal(listed.code, 0, `decide --list must exit 0: ${listed.text} ${listed.stderr}`);
  const item = (listed.json?.items || listed.json?.pending || [])
    .find(entry => entry.entityId === entityId || entry.id === entityId || entry.contactId === entityId);
  assert.ok(item, `no pending ${action} decision for ${entityId}: ${listed.text.slice(0, 600)}`);
  assert.ok((item.allowedActions || []).includes(action), `pending item must allow ${action}: ${JSON.stringify(item.allowedActions)}`);
  const done = decide(ctx, ['--action', action, '--id', item.entityId || item.id, '--revision', String(item.revision), '--content-hash', item.contentHash]);
  assert.equal(done.code, 0, `${action} must succeed through the trusted CLI: ${done.text} ${done.stderr}`);
  assert.equal(done.json?.ok, true, `${action} must report ok: ${done.text}`);
  return done.json;
}

test('G5-a staged contact-brief.v1 imports its subject identity and provider-reported address', async t => {
  const ctx = isolate(t, 'jobsss-g5a-staged-brief');
  const profileId = await createProfile(ctx);
  const staged = stage(ctx, 'contact-brief-v1.json');

  // Only the profile and the staged path are supplied: no inline identity, no
  // inline address. The brief itself must carry them.
  const { value } = await importContact(ctx, { profileId, path: staged });
  assert.equal(value?.ok, true, `staged contact-brief import must succeed: ${JSON.stringify(value)}`);
  assert.equal(value.created, true);
  const contact = value.contact;
  assert.equal(contact.name, 'Nadia Okonkwo', 'the subject name must come from the brief');
  assert.equal(contact.company, 'Lumen Learning Works', 'the subject company must come from the brief');
  assert.equal(contact.email, 'nadia.okonkwo@lumen-learning.test', 'the provider-reported address must come from the brief');
  assert.equal(contact.role, null, 'the frozen contract body carries no role; it must not be invented');
  assert.equal(contact.humanApproved, false, 'an import never grants human approval');
  assert.equal(contact.doNotUse, false);
  assert.equal(contact.source, 'staged_file');
  assert.equal(contact.emailAttribution, 'provider_reported');
  assert.equal(contact.emailStatus, 'provider_reported');
  assert.equal(contact.contactBrief?.schema, 'contact-brief.v1');
  assert.equal(contact.contactBrief?.mailboxStatus, 'not_checked', 'the mailbox must stay not_checked: no verification ran');
  assert.equal(contact.contactBrief?.lookupProvider, 'exa_agent_fiber', 'provider attribution must be preserved');
  assert.equal(contact.contactBrief?.providerRunId, 'fixture-run-contact-brief-1');
  assert.ok(Array.isArray(contact.contactBrief?.evidenceUrls) && contact.contactBrief.evidenceUrls.length > 0, 'the brief evidence refs must be kept as provenance');
  assert.equal(contact.provenanceHistory?.[0]?.kind, 'staged_contact_brief', 'the source must be recorded explicitly in provenance');
  assert.doesNotMatch(JSON.stringify(value), /mailbox verified|verified mailbox|\bsent\b/i, 'the import must not claim a verified mailbox or any send');

  const contacts = contactsOf(ctx);
  assert.equal(contacts.length, 1, 'exactly one logical contact must exist');
  assert.equal(contacts[0].id, contact.id);

  // Readback through the tool surface, not just the write response.
  const readback = await mcp(ctx, [initializeRequest(1), callRequest(2, 'list_contacts', { profileId })], { timeoutMs: 60_000 });
  const listed = requireOk(readback, 2, 'list_contacts');
  assert.equal(listed.count, 1);
  assert.equal(listed.contacts[0].email, 'nadia.okonkwo@lumen-learning.test');

  // A plain contact card is still parsed by the generic path (no regression).
  const card = readFileSync(pluginPath('tests/fixtures/contact-card.md'), 'utf8');
  const { value: cardValue } = await importContact(ctx, { profileId, email: 'sam.rivera@example.test', company: 'Example Learning Co', role: 'Hiring manager', text: card });
  assert.equal(cardValue?.ok, true, `generic card import must still succeed: ${JSON.stringify(cardValue)}`);
  assert.equal(cardValue.contact.name, 'Sam Rivera', 'the generic card parser must still read named fields');
  assert.equal(cardValue.contact.email, 'sam.rivera@example.test');
  assert.equal(cardValue.contact.emailAttribution, null, 'an inline address with no stated attribution stays unattributed');
});

test('G5-b repeat and alternate-shape imports of the same brief are one idempotent contact', async t => {
  const ctx = isolate(t, 'jobsss-g5b-idempotent');
  const profileId = await createProfile(ctx);
  const brief = briefFixture('contact-brief-v1.json');
  const withRole = briefFixture('contact-brief-v1-with-role.json');

  // 1. inline JSON text
  const first = await importContact(ctx, { profileId, text: JSON.stringify(brief) });
  assert.equal(first.value?.ok, true, `inline contact-brief import must succeed: ${JSON.stringify(first.value)}`);
  assert.equal(first.value.created, true);
  assert.equal(first.value.contact.source, 'inline_text');
  const contactId = first.value.contactId;
  assert.equal(contactsOf(ctx).length, 1);
  const provenanceAfterFirst = provenanceLength(contactsOf(ctx)[0]);
  assert.equal(provenanceAfterFirst, 1);

  // 2. the identical inline import in a NEW MCP process: an idempotent restart
  // must reuse the record and must not grow the provenance trail.
  const repeat = await importContact(ctx, { profileId, text: JSON.stringify(brief) });
  assert.equal(repeat.value?.ok, true);
  assert.equal(repeat.value.created, false, 'a repeat import must not create a second contact');
  assert.equal(repeat.value.contactId, contactId, 'a repeat import must return the same contact id');
  assert.equal(contactsOf(ctx).length, 1, 'a repeat import must add no duplicate logical contact');
  assert.equal(provenanceLength(contactsOf(ctx)[0]), provenanceAfterFirst, 'an identical repeat import must not grow the provenance trail');

  // 3. the same document through the staged path: still one contact, and the
  // newly used route is recorded exactly once.
  const staged = stage(ctx, 'contact-brief-v1.json');
  const viaStaged = await importContact(ctx, { profileId, path: staged });
  assert.equal(viaStaged.value?.ok, true);
  assert.equal(viaStaged.value.contactId, contactId, 'the staged route must resolve to the same logical contact');
  assert.equal(contactsOf(ctx).length, 1);
  const provenanceAfterStaged = provenanceLength(contactsOf(ctx)[0]);
  assert.equal(provenanceAfterStaged, provenanceAfterFirst + 1);
  assert.equal(contactsOf(ctx)[0].provenanceHistory.at(-1).kind, 'reimport_same_address');

  // 4. restarting that staged import adds nothing.
  const viaStagedAgain = await importContact(ctx, { profileId, path: staged });
  assert.equal(viaStagedAgain.value.contactId, contactId);
  assert.equal(provenanceLength(contactsOf(ctx)[0]), provenanceAfterStaged, 'a staged restart must be idempotent');
  assert.equal(contactsOf(ctx).length, 1);

  // 5. the same subject with a producer-supplied role through the inline brief
  // object: still one contact, and the role is now read from the payload.
  const viaBriefObject = await importContact(ctx, { profileId, brief: withRole });
  assert.equal(viaBriefObject.value?.ok, true, `inline brief object import must succeed: ${JSON.stringify(viaBriefObject.value)}`);
  assert.equal(viaBriefObject.value.contactId, contactId, 'the same address is the same logical contact, whatever the entry shape');
  const finalContacts = contactsOf(ctx);
  assert.equal(finalContacts.length, 1);
  assert.equal(finalContacts[0].role, 'Engineering Manager', 'a producer-supplied role must be read, not dropped');
  assert.equal(finalContacts[0].email, 'nadia.okonkwo@lumen-learning.test', 'the address must survive the re-import');
  assert.equal(finalContacts[0].emailAttribution, 'provider_reported');
  assert.equal(finalContacts[0].humanApproved, false);
  assert.equal(finalContacts[0].doNotUse, false);
});

test('G5-c record_contact_discovery then an address-less staged brief keeps ONE logical contact', async t => {
  const ctx = isolate(t, 'jobsss-g5c-discovery-then-import');
  const profileId = await createProfile(ctx);

  const jobSession = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'import_job', {
      profileId,
      text: 'Engineering Manager, Lumen Learning Works (fictional fixture).\nBuild learning products with a small platform team.\n'
    })
  ], { timeoutMs: 60_000 });
  const jobId = requireOk(jobSession, 2, 'import_job').jobId;

  const recorded = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'record_contact_discovery', {
      profileId,
      jobId,
      subjectName: 'Nadia Okonkwo',
      subjectCompany: 'Lumen Learning Works',
      role: 'Engineering Manager',
      status: 'contact_brief',
      email: 'nadia.okonkwo@lumen-learning.test',
      provider: 'exa_agent_fiber',
      runId: 'fixture-run-contact-brief-1',
      class: 'fixture'
    })
  ], { timeoutMs: 60_000 });
  const discovery = requireOk(recorded, 2, 'record_contact_discovery').discovery;
  const afterDiscovery = contactsOf(ctx);
  assert.equal(afterDiscovery.length, 1, 'a recorded brief creates exactly one contact');
  assert.equal(discovery.contactId, afterDiscovery[0].id);
  assert.equal(afterDiscovery[0].email, 'nadia.okonkwo@lumen-learning.test');

  // The staged brief is the same person with no looked-up address (and messy
  // casing in the recorded subject). It must land on the existing contact.
  const staged = stage(ctx, 'contact-brief-v1-no-address.json');
  const { value } = await importContact(ctx, { profileId, path: staged });
  assert.equal(value?.ok, true, `the address-less staged import must be accepted: ${JSON.stringify(value)}`);
  assert.equal(value.created, false, 'the address-less import must not create a second contact');
  assert.equal(value.contactId, discovery.contactId, 'it must reconcile onto the contact that already holds the address');
  assert.equal(value.reconciliation, 'reused_address_bearing_record');

  const contacts = contactsOf(ctx);
  assert.equal(contacts.length, 1, 'exactly one logical contact must exist after both routes');
  assert.equal(contacts[0].email, 'nadia.okonkwo@lumen-learning.test', 'the provider-reported address must not be cleared');
  assert.equal(contacts[0].humanApproved, false);
  assert.equal(contacts[0].doNotUse, false);
  assert.ok(contacts[0].provenanceHistory.some(entry => entry.kind === 'reconciled_addressless_import'), 'the reconciliation must be explicit in provenance');

  // The discovery record still points at the surviving logical contact.
  const store = readStore(ctx.dataDir);
  assert.equal(store.contactDiscoveries[discovery.id].contactId, contacts[0].id);
  assert.equal(store.contactDiscoveries[discovery.id].emailStatus, 'provider_reported');

  // And the reverse order is equally idempotent: the address-bearing import
  // after an address-less one merges instead of duplicating.
  const reverseCtx = isolate(t, 'jobsss-g5c-reverse');
  const reverseProfile = await createProfile(reverseCtx);
  const addressless = briefFixture('contact-brief-v1-no-address.json');
  const created = await importContact(reverseCtx, { profileId: reverseProfile, text: JSON.stringify(addressless) });
  assert.equal(created.value.created, true);
  assert.equal(created.value.contact.email, null, 'an address-less brief imports no address');
  const merged = await importContact(reverseCtx, {
    profileId: reverseProfile,
    text: JSON.stringify(briefFixture('contact-brief-v1-with-role.json'))
  });
  assert.equal(merged.value.created, false, 'the address-bearing brief must fill the existing record, not duplicate it');
  assert.equal(merged.value.contactId, created.value.contactId);
  assert.equal(merged.value.reconciliation, 'merged_provider_reported_address');
  const reverseContacts = contactsOf(reverseCtx);
  assert.equal(reverseContacts.length, 1, 'one logical contact after the merge');
  assert.equal(reverseContacts[0].email, 'nadia.okonkwo@lumen-learning.test');
  assert.equal(reverseContacts[0].emailAttribution, 'provider_reported');
  assert.equal(reverseContacts[0].humanApproved, false);
  assert.ok(reverseContacts[0].provenanceHistory.some(entry => entry.kind === 'staged_contact_brief'), 'the original address-less import stays in the history');
  assert.ok(reverseContacts[0].provenanceHistory.some(entry => entry.kind === 'merged_provider_reported_address'), 'the merge must be explicit in provenance');
});

test('G5-d human-protected and conflicting-address records are never collapsed', async t => {
  const ctx = isolate(t, 'jobsss-g5d-protected');
  const profileId = await createProfile(ctx);
  const brief = briefFixture('contact-brief-v1-with-role.json');
  const payloadFor = (name, company, address) => JSON.stringify({
    ...brief,
    subject: { name, company },
    email: { ...brief.email, address }
  });

  // (1) A human-approved, address-bearing contact is reused but never rewritten.
  const approved = await importContact(ctx, { profileId, text: JSON.stringify(brief) });
  assert.equal(approved.value?.ok, true, `the first import must succeed: ${JSON.stringify(approved.value)}`);
  humanDecision(ctx, 'contact.approve', approved.value.contactId);
  const approvedBefore = contactsOf(ctx).find(contact => contact.id === approved.value.contactId);
  assert.equal(approvedBefore.humanApproved, true);

  const staged = stage(ctx, 'contact-brief-v1.json');
  const reimported = await importContact(ctx, { profileId, path: staged });
  assert.equal(reimported.value?.ok, true);
  assert.equal(reimported.value.contactId, approved.value.contactId, 'the same address still resolves to the approved record');
  const approvedAfter = contactsOf(ctx).find(contact => contact.id === approved.value.contactId);
  assert.deepEqual(approvedAfter, approvedBefore, 'a human-approved record must not be rewritten by an import');
  assert.equal(contactsOf(ctx).length, 1, 'no replacement record may appear for an approved contact');

  // (2) A human-suppressed contact stays suppressed and untouched.
  const suppressedImport = await importContact(ctx, {
    profileId,
    name: 'Owen Marsh',
    email: 'owen.marsh@tideline-fintech.test',
    company: 'Tideline Fintech Labs'
  });
  assert.equal(suppressedImport.value?.ok, true, `the suppressed-record import must succeed: ${JSON.stringify(suppressedImport.value)}`);
  humanDecision(ctx, 'contact.suppress', suppressedImport.value.contactId);
  const suppressedBefore = contactsOf(ctx).find(contact => contact.id === suppressedImport.value.contactId);
  assert.equal(suppressedBefore.doNotUse, true);
  const suppressedReimport = await importContact(ctx, {
    profileId,
    name: 'Owen Marsh',
    email: 'owen.marsh@tideline-fintech.test',
    company: 'Tideline Fintech Labs'
  });
  assert.equal(suppressedReimport.value.contactId, suppressedImport.value.contactId);
  const suppressedAfter = contactsOf(ctx).find(contact => contact.id === suppressedImport.value.contactId);
  assert.deepEqual(suppressedAfter, suppressedBefore, 'a suppressed (do-not-use) record must not be resurrected or rewritten');

  // (3) An approved address-less record is never given an address by a later
  // brief: the address lands on a new machine record instead of collapsing into
  // the human-approved one.
  const approvedAddressless = await importContact(ctx, { profileId, name: 'Priya Raman', company: 'Cascade Test Labs' });
  assert.equal(approvedAddressless.value?.ok, true, `the address-less import must succeed: ${JSON.stringify(approvedAddressless.value)}`);
  assert.equal(approvedAddressless.value.contact.email, null);
  humanDecision(ctx, 'contact.approve', approvedAddressless.value.contactId);
  const addresslessBefore = contactsOf(ctx).find(contact => contact.id === approvedAddressless.value.contactId);
  const addressed = await importContact(ctx, { profileId, text: payloadFor('Priya Raman', 'Cascade Test Labs', 'priya.raman@cascade-test.test') });
  assert.equal(addressed.value?.ok, true, `the addressed brief must import: ${JSON.stringify(addressed.value)}`);
  assert.equal(addressed.value.created, true, 'the address must not merge into a human-approved record');
  assert.notEqual(addressed.value.contactId, approvedAddressless.value.contactId);
  const addresslessAfter = contactsOf(ctx).find(contact => contact.id === approvedAddressless.value.contactId);
  assert.deepEqual(addresslessAfter, addresslessBefore, 'the human-approved address-less record must be unchanged');
  assert.equal(addresslessAfter.email, null);
  assert.equal(addressed.value.contact.email, 'priya.raman@cascade-test.test');

  // (4) Two different addresses for one name+company are conflicting-address
  // records: neither is collapsed or overwritten.
  const conflicting = await importContact(ctx, { profileId, text: payloadFor('Priya Raman', 'Cascade Test Labs', 'priya.alt@cascade-test.test') });
  assert.equal(conflicting.value?.ok, true, `the conflicting-address brief must import: ${JSON.stringify(conflicting.value)}`);
  assert.equal(conflicting.value.created, true, 'a conflicting address must not merge into the existing record');
  assert.notEqual(conflicting.value.contactId, addressed.value.contactId);
  assert.equal(contactsOf(ctx).find(contact => contact.id === addressed.value.contactId).email, 'priya.raman@cascade-test.test');
  assert.equal(contactsOf(ctx).find(contact => contact.id === conflicting.value.contactId).email, 'priya.alt@cascade-test.test');

  // (5) The same name at another company is a different person: never reconciled.
  const otherCompany = await importContact(ctx, {
    profileId,
    name: 'Nadia Okonkwo',
    email: 'nadia.okonkwo@other-employer.test',
    company: 'Other Employer Group'
  });
  assert.equal(otherCompany.value?.ok, true);
  assert.equal(otherCompany.value.created, true, 'the same name at a different company is not identity evidence');
  assert.equal(contactsOf(ctx).filter(contact => contact.name === 'Nadia Okonkwo').length, 2);
});

test('G5-e the arbitrary-path guard and the staged-file requirement are intact', async t => {
  const ctx = isolate(t, 'jobsss-g5e-path-guard');
  const profileId = await createProfile(ctx);
  const outside = path.join(BRIEF_DIR, 'contact-brief-v1.json');

  const rejected = await importContact(ctx, { profileId, path: outside, filePath: outside });
  assert.ok(isRejected(rejected.frame, rejected.value), `an arbitrary path must be refused: ${JSON.stringify(rejected.value)}`);
  assert.match(rejectionBlob(rejected.frame, rejected.value), /arbitrary_path/, 'the refusal must use the typed arbitrary_path code');

  const missing = await importContact(ctx, { profileId, path: path.join(ctx.dataDir, 'not-staged.json') });
  assert.ok(isRejected(missing.frame, missing.value), 'a missing staged file must be refused');
  assert.match(rejectionBlob(missing.frame, missing.value), /contact_read_error/, 'the refusal must use the typed contact_read_error code');

  const store = readStore(ctx.dataDir);
  assert.deepEqual(Object.values(store.contacts || {}).filter(contact => contact?.id), [], 'a refused import must persist no contact');
  assert.doesNotMatch(JSON.stringify(store), /nadia\.okonkwo@lumen-learning\.test/, 'a refused import must not read the unread payload into the store');

  // A copy staged under PLUGIN_DATA is the supported path.
  const accepted = await importContact(ctx, { profileId, path: stage(ctx, 'contact-brief-v1.json') });
  assert.equal(accepted.value?.ok, true, `a PLUGIN_DATA-staged brief must import: ${JSON.stringify(accepted.value)}`);
  assert.equal(contactsOf(ctx).length, 1);
});
