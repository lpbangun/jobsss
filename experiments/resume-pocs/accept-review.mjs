import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewBinding, validateReview, validateReceipt, completionStatus } from './contracts.mjs';

// Host-agent handoff adapter. Recording model QA never records human approval.
export function acceptReview(directory, report, receipt) {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const request = JSON.parse(fs.readFileSync(path.join(directory, 'review-request.json')));
  const binding = reviewBinding({ source: fs.readFileSync(path.join(directory, 'candidate-source.txt')),
    posting: fs.readFileSync(path.join(directory, 'job-posting.txt')), ir: request.document.ir,
    pdf: fs.readFileSync(request.pdfPath), preview: fs.readFileSync(request.previewPath), rubric: request.rubric });
  if (binding !== manifest.binding || binding !== request.binding) throw new Error('Artifacts changed since reviewer request.');
  validateReview(report, binding);
  validateReceipt(receipt, binding);
  manifest.review = report; manifest.reviewer = receipt; manifest.evidenceClass = receipt.evidenceClass;
  manifest.status = completionStatus(manifest.mechanical, report);
  if (manifest.status === 'qa_passed_needs_human_review' && receipt.evidenceClass !== 'live') manifest.status = `${receipt.evidenceClass}_qa_passed`;
  fs.writeFileSync(path.join(directory, 'independent-review.json'), JSON.stringify({ report, receipt }, null, 2), { mode: 0o600 });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, reviewPath] = process.argv.slice(2);
  const { report, receipt } = JSON.parse(fs.readFileSync(reviewPath));
  console.log(JSON.stringify({ status: acceptReview(directory, report, receipt).status }));
}
