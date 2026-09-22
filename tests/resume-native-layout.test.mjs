import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdf } from '../src/documents.js';
import { resumeBlocks } from '../src/resume-document.js';

test('native PDF section rules leave readable clearance before following text', () => {
  const pdf = renderPdf('', { blocks: [
    { type: 'name', text: 'CASEY RIVERA' },
    { type: 'h2', text: 'EXPERIENCE' },
    { type: 'h3', text: 'Example Company - New York, NY' },
  ] }).bytes.toString('latin1');
  const rule = pdf.match(/0\.6 w\n\d+(?:\.\d+)? (\d+(?:\.\d+)?) m/);
  assert.ok(rule, 'expected native section rule');
  const afterRule = pdf.slice((rule.index || 0) + rule[0].length);
  const nextText = afterRule.match(/1 0 0 1 \d+(?:\.\d+)? (\d+(?:\.\d+)?) Tm/);
  assert.ok(nextText, 'expected text after section rule');
  assert.ok(Number(rule[1]) - Number(nextText[1]) >= 10, 'section rule must not collide with next baseline');
});

test('resume skill categories stay compact instead of one paragraph per semicolon', () => {
  const doc = {
    identity: 'Casey Rivera', contacts: [], summary: '', target: '', experience: [], projects: [], education: [],
    skills: ['People & Learning: onboarding; training design; documentation', 'AI & Automation: agent workflows; MCP integrations'],
  };
  const blocks = resumeBlocks(doc, []);
  const skillHeading = blocks.findIndex(block => block.type === 'h2' && block.text === 'SKILLS');
  assert.ok(skillHeading >= 0);
  assert.deepEqual(blocks.slice(skillHeading + 1).map(block => block.text), doc.skills);
});
