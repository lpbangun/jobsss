import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCoverLetterBlocks } from '../src/cover-letter-layout.js';
import { renderCoverLetterDocx } from '../src/docx.js';

const letter = `Amara Osei
Denver, CO | amara@example.com

September 30, 2026

Hiring Team
Pillarline Systems
Platform Engineer

Dear Hiring Team,

I built release tooling for forty services. I would welcome a conversation about the team's deployment work.

I also wrote the runbooks used for incident triage.

Sincerely,

Amara Osei`;

test('business-letter blocks preserve explicit text and group manual contact lines', () => {
  const blocks = classifyCoverLetterBlocks(letter);
  assert.deepEqual(blocks.map(block => block.type), ['contact', 'date', 'recipient', 'salutation', 'paragraph', 'paragraph', 'closing', 'signature']);
  assert.equal(blocks.map(block => block.text).join('\n\n'), letter);
  assert.equal(classifyCoverLetterBlocks('Plain paragraph.\n\nAnother paragraph.')[0].type, 'paragraph');
});

test('editable letters use ordinary paragraph spacing and keep the closing with its signature', () => {
  const bytes = renderCoverLetterDocx(letter);
  const xml = bytes.toString('utf8');
  assert.match(xml, /Times New Roman/);
  assert.match(xml, /w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/);
  assert.match(xml, /w:line="276" w:lineRule="auto"/);
  assert.match(xml, /<w:widowControl\/>/);
  assert.match(xml, /<w:keepNext\/>/);
  assert.match(xml, /<w:br\/>/);
  assert.doesNotMatch(xml, /<w:t[^>]*><\/w:t>/);
  assert.doesNotMatch(xml, /w:pBdr|w:tbl|w:jc w:val="both"/);
  assert.ok(bytes.includes(Buffer.from('incident triage')));
});
