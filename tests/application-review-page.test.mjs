import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { reviewPage } from '../src/application-review-server.js';

test('emitted review page edits grouped skills as real lines and restores them on reopen', async () => {
  let saved = ['SQL', 'Python'];
  const patches = [];
  function page() {
    const elements = new Map();
    const all = [];
    const element = () => ({ dataset: {}, value: '', checked: false, hidden: false, children: [], append(...xs) { this.children.push(...xs); }, replaceChildren() { this.children = []; }, addEventListener() {} });
    const document = {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement() { const el = element(); all.push(el); return el; },
      createTextNode(text) { return { textContent: text }; },
      querySelector() { return null; },
      querySelectorAll(selector) { return all.filter(el => selector === '[data-key]' ? el.dataset.key : el.dataset.confirm); },
    };
    const context = vm.createContext({ document, location: { hash: '#fixture-token', pathname: '/' }, sessionStorage: { setItem() {}, getItem() { return 'fixture-token'; } }, history: { replaceState() {} }, fetch: async (url, options) => {
      if (url === '/api/edit') { const body = JSON.parse(options.body); patches.push(body.patch); saved = body.patch.resumeItems.skills; }
      return { ok: true, json: async () => ({ revision: patches.length + 1, version: patches.length + 1, source: { posting: 'Synthetic posting', url: 'https://example.invalid/posting' }, fields: [], facts: {}, resume: { nodes: [{ id: 'skills', type: 'skills_group', text: 'Tools', items: saved }] }, audit: { issues: [] } }) };
    } });
    vm.runInContext(reviewPage.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    return { context, all };
  }
  const first = page();
  await new Promise(resolve => setImmediate(resolve));
  const editor = first.all.find(el => el.dataset.key === 'items:skills');
  assert.equal(editor.value, 'SQL\nPython');
  editor.value = 'SQL\nPython\nResearch';
  await vm.runInContext('save()', first.context);
  assert.deepEqual(saved, ['SQL', 'Python', 'Research']);
  assert.deepEqual(patches[0].resumeItems.skills, saved);
  const reopened = page();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reopened.all.find(el => el.dataset.key === 'items:skills').value, 'SQL\nPython\nResearch');
});
