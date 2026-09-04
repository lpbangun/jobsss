// The root plugin manifest is the sole authority for the JobSSS product version.
// Source execution reads the checkout manifest; the SEA reads the manifest shipped
// beside its bin/ directory. This module is included in the deterministic bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_STANDALONE =
  typeof __sea !== 'undefined' && !!__sea && __sea.standalone === true;

const MODULE_FILE = fileURLToPath(import.meta.url);
export const PLUGIN_MANIFEST_PATH = IS_STANDALONE
  ? path.resolve(path.dirname(process.execPath), '..', 'plugin.json')
  : path.resolve(path.dirname(MODULE_FILE), '..', 'plugin.json');

function readProductVersion() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8'));
  } catch (cause) {
    throw new Error(`JobSSS plugin manifest is unreadable: ${cause.message}`);
  }
  const version = String(manifest && manifest.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('JobSSS plugin manifest must contain a semantic version');
  }
  return version;
}

export const PRODUCT_VERSION = readProductVersion();
