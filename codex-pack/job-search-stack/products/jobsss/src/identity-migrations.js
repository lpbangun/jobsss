// Versioned, lossless migration for contract identifiers written by legacy releases.
// Only exact values on contract fields are rewritten; prose and historical data remain intact.
export const IDENTITY_CONTRACT_MIGRATION_VERSION = 1;

const LEGACY_CONTRACT_IDS = Object.freeze({
  'jobos.fit-score.v1': 'jobsss.fit-score.v1',
  'jobos.posting-liveness.v1': 'jobsss.posting-liveness.v1',
});

/**
 * Upgrade legacy contract identifiers in a parsed JSON store in place.
 *
 * This read migration changes no payload fields, history, or free text. Calling it
 * more than once is safe: after the first pass there are no legacy values left.
 */
export function migrateIdentityContractsInPlace(value) {
  let migrated = 0;
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node.contract === 'string' && Object.hasOwn(LEGACY_CONTRACT_IDS, node.contract)) {
      node.contract = LEGACY_CONTRACT_IDS[node.contract];
      migrated += 1;
    }
    for (const item of Object.values(node)) visit(item);
  }

  visit(value);
  return {
    version: IDENTITY_CONTRACT_MIGRATION_VERSION,
    changed: migrated > 0,
    migrated,
  };
}
