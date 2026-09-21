/**
 * Install-surface invariants: the pinned trio and the generated Hermes pack.
 *
 * These are product-owned tests (not part of the reviewer-owned frozen bar):
 * they make the pins the single source of truth and fail on hand edits, so a
 * fix applied to one surface without regenerating it is caught mechanically.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HERMES_SURFACE_REL,
  PINS_REL,
  readPins,
  renderHermesPack,
  surfacesDrift
} from '../scripts/build-install-surfaces.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('install pins pin the reviewed trio to exact 40-character commits', () => {
  const pins = readPins(REPO_ROOT);
  assert.deepEqual(
    pins.products.map(product => product.name),
    ['jobsss', 'people-finder', 'contact-brief'],
    'the install stack is the three reviewed products, in order'
  );
  for (const product of pins.products) {
    assert.match(product.ref, /^[0-9a-f]{40}$/, `${product.name} must pin an exact commit`);
    assert.match(product.repo, /^[\w.-]+\/[\w.-]+$/, `${product.name} must name an owner/repo source`);
  }
  const jobsss = pins.products.find(product => product.name === 'jobsss');
  assert.equal(jobsss.subdir, 'agent-plugin', 'JobSSS installs from its generated thin package');
});

test('the committed Hermes pack is byte-identical to the pins render', () => {
  const drift = surfacesDrift(REPO_ROOT);
  assert.deepEqual(
    drift.changed,
    [],
    'run `node scripts/build-install-surfaces.mjs` after editing compat/install-pins.json'
  );
  assert.ok(fs.existsSync(path.join(REPO_ROOT, HERMES_SURFACE_REL)), `${HERMES_SURFACE_REL} must exist`);
});

test('the generated pack is metadata only: quoted commits, no product bytes, no tabs', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, HERMES_SURFACE_REL), 'utf8');
  assert.ok(!text.includes('\t'), 'pack must not contain tab characters');
  assert.match(text, /^name: find-people-stack$/m);
  assert.equal((text.match(/^  - repo: /gm) || []).length, 3, 'exactly one entry per product');
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('ref:')) {
      assert.match(line, /ref: "[0-9a-f]{40}"$/, 'refs stay quoted so hex pins never coerce to numbers');
    }
  }
  assert.ok(!text.includes('bin/'), 'a surface references products, never product bytes');
  assert.equal(renderHermesPack(readPins(REPO_ROOT)), text, 'render is deterministic');
});
