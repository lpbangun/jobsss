// Minimal local scoring — deterministic, no API keys.
// Attributed port: concept from JobOS src/scoring.js deterministicProposal
// and finalizeFitScore, simplified to token overlap and proof-agnostic
// local scoring for the standalone journey.
import { tokenize } from './store.js';

export function localScore({ profile, job }) {
  const resume = String(profile.resumeText || profile.name || '').toLowerCase();
  const jobText = `${job.title || ''}\n${job.company || ''}\n${job.description || ''}`.toLowerCase();
  const resumeTokens = [...new Set(tokenize(resume).filter(t => t.length > 2))];
  const jobTokens = new Set(tokenize(jobText));
  const hits = resumeTokens.filter(t => jobTokens.has(t));
  // Base 42 + 7 per hit, capped; ensures deterministic overall without providers
  const base = 42;
  const perHit = 7;
  const ceiling = 92;
  const floor = 38;
  const raw = base + hits.length * perHit;
  const overall = Math.max(floor, Math.min(ceiling, raw));
  // Clamp integer
  const clamped = Math.max(0, Math.min(100, Math.round(overall)));
  const scoreStatus = clamped >= 70 ? 'scored' : clamped >= 45 ? 'scored' : 'scored';
  const evidenceCoverage = Math.min(100, 60 + hits.length * 5);
  const confidence = evidenceCoverage >= 85 ? 'medium' : 'low';
  return {
    contract: 'jobos.fit-score.v1',
    jobId: job.id,
    profileId: profile.id,
    overall: clamped,
    baseOverall: clamped,
    scoreStatus,
    score: clamped,
    evidenceCoverage,
    confidence,
    mode: 'deterministic-degraded',
    dimensions: {
      roleFit: { status: 'scored', score: clamped, weight: 28, reason: `Local token overlap ${hits.length} hits`, evidenceRefs: [] },
    },
    constraints: [],
    postingRisks: [],
    reasoning: `Deterministic local score from ${hits.length} token overlaps; no external provider. Hits: ${hits.slice(0, 8).join(', ') || 'none'}.`,
    provider: null,
    providerError: null,
    generatedAt: new Date().toISOString(),
  };
}
