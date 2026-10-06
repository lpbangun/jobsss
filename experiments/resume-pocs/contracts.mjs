import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const RUBRIC = Object.freeze(JSON.parse(fs.readFileSync(new URL('../../skills/jobsss/references/resume-quality/rubric.json', import.meta.url), 'utf8')));

export function checkLayout(layout) {
  const failures = [];
  if (!Number.isFinite(layout.fill) || layout.fill < RUBRIC.minFill) failures.push('underfilled');
  if (layout.fill > RUBRIC.maxFill) failures.push('overfilled');
  if (layout.minX < -1 || layout.maxX > layout.width + 1 || layout.maxY > layout.height + 1) failures.push('overflow');
  if (layout.minBodyPt < RUBRIC.minBodyPt) failures.push('unreadable_type');
  if (layout.maxGap > 36) failures.push('excessive_gap');
  if (layout.rawMarkdown) failures.push('literal_markdown');
  return { passed: failures.length === 0, failures };
}

export function reviewBinding({ source, posting, ir, pdf, preview, rubric = RUBRIC }) {
  return hash(JSON.stringify({ source: hash(source), posting: hash(posting),
    ir: hash(JSON.stringify(ir)), pdf: hash(pdf), preview: hash(preview), rubric }));
}

export function validateReview(report, binding) {
  if (!report || report.schema !== 'resume-review.v1' || report.binding !== binding
      || !['pass', 'repair', 'blocked'].includes(report.verdict) || !Array.isArray(report.findings)
      || !report.findings.every(f => ['blocker', 'major', 'minor'].includes(f.severity)
        && ['content', 'layout', 'accuracy'].includes(f.category) && typeof f.message === 'string')) {
    throw Object.assign(new Error('Malformed or stale independent review.'), { code: 'review_invalid' });
  }
  for (const key of ['preferClaimIds', 'excludeClaimIds']) {
    if (report[key] !== undefined && (!Array.isArray(report[key]) || report[key].some(id => typeof id !== 'string'))) {
      throw Object.assign(new Error('Review edits must be claim ID arrays.'), { code: 'review_invalid' });
    }
  }
  if (report.summaryMode !== undefined && !['keep', 'source'].includes(report.summaryMode)) {
    throw Object.assign(new Error('Unsupported summary repair.'), { code: 'review_invalid' });
  }
  if (report.fitGaps !== undefined && (!Array.isArray(report.fitGaps) || report.fitGaps.some(v => typeof v !== 'string'))) {
    throw Object.assign(new Error('Fit gaps must be separate text entries.'), { code: 'review_invalid' });
  }
  if (report.verdict === 'pass' && report.findings.some(f => ['blocker', 'major'].includes(f.severity))) {
    throw Object.assign(new Error('Passing review contains blocking findings.'), { code: 'review_invalid' });
  }
  return report;
}

export function completionStatus(mechanical, review) {
  if (!mechanical.passed) return 'qa_unresolved';
  return review?.verdict === 'pass' ? 'qa_passed_needs_human_review'
    : !review ? 'qa_pending' : 'qa_unresolved';
}

export function validateReceipt(receipt, binding) {
  if (!receipt || typeof receipt.model !== 'string' || !receipt.model.trim()
      || typeof receipt.runId !== 'string' || !receipt.runId.trim()
      || !['live', 'fixture', 'replay'].includes(receipt.evidenceClass)
      || (receipt.binding !== undefined && receipt.binding !== binding)) {
    throw Object.assign(new Error('Attributed reviewer receipt required.'), { code: 'review_receipt_invalid' });
  }
  return receipt;
}
