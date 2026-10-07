import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMcp } from './mcp-client.mjs';
import { prepareIntake } from './intake.mjs';
import { fitAndRender, useSourceSummary } from './render.mjs';
import { RUBRIC, hash, reviewBinding, validateReview, validateReceipt, completionStatus } from './contracts.mjs';
import { codexReview, reviewPrompt } from './reviewer.mjs';

export async function buildApplication({ source, posting, dataDir, directory, route = 'tailor_resume', reviewer, browser }) {
  if (!['tailor_resume', 'revise_resume', 'render_resume', 'prepare_applications_batch'].includes(route)) throw new Error('Unsupported build route.');
  const rel = path.relative(path.resolve(dataDir), path.resolve(directory));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Build outputs must be a subdirectory of PLUGIN_DATA.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const mcp = openMcp(dataDir);
  try {
    await mcp.initialize(); await mcp.call('start', {});
    const profile = await mcp.call('create_profile', { name: source.split(/\r?\n/)[0].replace(/^Name:\s*/, ''), resumeText: source });
    const profileId = profile.profileId || profile.id;
    const imported = await mcp.call('import_job', { profileId, text: posting });
    const jobId = imported.jobId || imported.job?.id || imported.id;
    const args = { profileId, jobId, style: 'navy', format: 'markdown' };
    const routes = [];
    if (route === 'prepare_applications_batch') {
      const batch = await mcp.call(route, { profileId, jobIds: [jobId], format: 'markdown', coverLetter: false });
      fs.writeFileSync(path.join(directory, 'batch.json'), JSON.stringify(batch, null, 2)); routes.push(route);
    }
    // render_resume itself is deliberately exercised only when requested: its
    // baseline production QA is not substituted for the experiment QA.
    const built = await mcp.call(route === 'prepare_applications_batch' ? 'tailor_resume' : route, args);
    routes.push(route === 'prepare_applications_batch' ? 'tailor_resume' : route);
    let canonical = built.document?.resumeDocument || built.artifact?.resumeDocument;
    if (!canonical?.ir || !canonical?.ledger) throw new Error('MCP did not return a canonical evidence-linked document.');
    fs.writeFileSync(path.join(directory, 'mcp-result.json'), JSON.stringify(built, null, 2), { mode: 0o600 });
    const sourcePath = path.join(directory, 'candidate-source.txt'); const postingPath = path.join(directory, 'job-posting.txt');
    fs.writeFileSync(sourcePath, source, { mode: 0o600 }); fs.writeFileSync(postingPath, posting, { mode: 0o600 });
    let rendered, binding, reviewed = null, reviewerError = null;
    const reviewHistory = []; const seen = new Set();
    let sourceSummarySelected = false;
    let selection = canonical.ledger.revisionSelection || { preferClaimIds: [], excludeClaimIds: [] };
    for (let attempt = 0; attempt < RUBRIC.maxReviewAttempts; attempt++) {
      const attemptDirectory = path.join(directory, `attempt-${attempt + 1}`);
      rendered = await fitAndRender(canonical, posting, attemptDirectory, { browser });
      if (!rendered.pdfPath) {
        const failed = { schema: 'resume-poc-run.v1', status: 'qa_unresolved', reason: rendered.reason,
          routes, humanApproved: false, submitted: false, reviewHistory };
        fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(failed, null, 2)); return failed;
      }
      binding = reviewBinding({ source, posting, ir: rendered.canonical.ir,
        pdf: fs.readFileSync(rendered.pdfPath), preview: fs.readFileSync(rendered.previewPath) });
      const request = { schema: 'resume-review-request.v1', binding, rubric: RUBRIC,
        source, posting, document: rendered.canonical, mechanical: rendered.mechanical,
        previewPath: rendered.previewPath, pdfPath: rendered.pdfPath };
      fs.writeFileSync(path.join(attemptDirectory, 'review-request.json'), JSON.stringify(request, null, 2), { mode: 0o600 });
      fs.writeFileSync(path.join(attemptDirectory, 'review-prompt.txt'), reviewPrompt(request), { mode: 0o600 });
      // Stable latest pointer for a host-agent adapter; actual attempts are immutable.
      fs.writeFileSync(path.join(directory, 'review-request.json'), JSON.stringify(request, null, 2), { mode: 0o600 });
      reviewed = null;
      if (reviewer) {
        try { reviewed = await reviewer(request, attemptDirectory); validateReview(reviewed.report, binding); validateReceipt(reviewed.receipt, binding); }
        catch (error) { reviewed = null; reviewerError = error.message; }
      }
      reviewHistory.push({ attempt: attempt + 1, binding, mechanical: rendered.mechanical, review: reviewed?.report || null });
      if (!reviewed || reviewed.report.verdict !== 'repair' || attempt + 1 === RUBRIC.maxReviewAttempts) break;
      const preferClaimIds = reviewed.report.preferClaimIds || [];
      const excludeClaimIds = reviewed.report.excludeClaimIds || [];
      if (!preferClaimIds.length && !excludeClaimIds.length && reviewed.report.summaryMode !== 'source') break;
      try {
        let next = rendered.canonical;
        if (preferClaimIds.length || excludeClaimIds.length) {
          const nextPrefer = [...new Set([...(selection.preferClaimIds || []), ...preferClaimIds])].filter(id => !excludeClaimIds.includes(id));
          const nextExclude = [...new Set([...(selection.excludeClaimIds || []), ...excludeClaimIds])].filter(id => !preferClaimIds.includes(id));
          const revised = await mcp.call('revise_resume', { ...args, preferClaimIds: nextPrefer, excludeClaimIds: nextExclude });
          routes.push('revise_resume'); next = revised.document?.resumeDocument || revised.artifact?.resumeDocument;
          selection = next.ledger.revisionSelection;
        }
        sourceSummarySelected ||= reviewed.report.summaryMode === 'source';
        if (sourceSummarySelected) next = useSourceSummary(next);
        const digest = hash(JSON.stringify(next?.ir));
        if (!next?.ir || seen.has(digest) || digest === hash(JSON.stringify(canonical.ir))) {
          reviewerError = 'Repair produced no new canonical content.'; break;
        }
        seen.add(digest); canonical = next;
      } catch (error) { reviewerError = `Repair rejected: ${error.message}`; break; }
    }
    const manifest = { schema: 'resume-poc-run.v1', status: completionStatus(rendered.mechanical, reviewed?.report),
      evidenceClass: reviewed?.receipt?.evidenceClass || 'unreviewed', profileId, jobId, routes,
      binding, sourceSha256: hash(source), postingSha256: hash(posting),
      irSha256: hash(JSON.stringify(rendered.canonical.ir)), pdfSha256: hash(fs.readFileSync(rendered.pdfPath)),
      previewSha256: hash(fs.readFileSync(rendered.previewPath)), rubric: RUBRIC, mechanical: rendered.mechanical,
      review: reviewed?.report || null, reviewer: reviewed?.receipt || null, reviewerError,
      pdfPath: rendered.pdfPath, previewPath: rendered.previewPath,
      humanApproved: false, submitted: false, layoutAttempts: rendered.history.length, reviewHistory,
      limitations: ['Experimental host orchestration; production MCP routes do not enforce agent review.',
        'Repairs accept only source-linked claim selections; no arbitrary model rewriting.',
        'PDF bytes may differ across browser builds; semantic IR/rubric hashes are reproducible.'] };
    if (manifest.status === 'qa_passed_needs_human_review' && manifest.evidenceClass !== 'live') manifest.status = `${manifest.evidenceClass}_qa_passed`;
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return manifest;
  } finally { mcp.close(); }
}

async function main() {
  const [command, ...argv] = process.argv.slice(2); const args = {};
  for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith('--') || !argv[i + 1]) throw new Error('Expected --key value pairs.'); args[argv[i].slice(2)] = argv[i + 1]; }
  if (!args.out) throw new Error('--out is required, outside the plugin checkout.');
  const directory = path.resolve(args.out); const root = fileURLToPath(new URL('../../', import.meta.url));
  const relative = path.relative(root, directory);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('All run state must be outside the plugin checkout.');
  if (command === 'intake') {
    const result = prepareIntake(JSON.parse(fs.readFileSync(args.input, 'utf8').replace(/^\uFEFF/, '')));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'intake.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'candidate-source.txt'), result.source, { mode: 0o600 });
    console.log(JSON.stringify({ readyForImport: result.readyForImport, questions: result.questions, directory })); return;
  }
  if (command !== 'build' || !args.source || !args.job || !args.data) throw new Error('build requires --source, --job, --data and --out.');
  const source = fs.readFileSync(args.source, 'utf8').replace(/^\uFEFF/, '');
  const jobInput = fs.readFileSync(args.job, 'utf8').replace(/^\uFEFF/, '');
  const posting = args.job.endsWith('.json') ? JSON.parse(jobInput).text : jobInput;
  if (typeof posting !== 'string' || !posting.trim()) throw new Error('Job snapshot requires non-empty text.');
  if (args.reviewer && args.reviewer !== 'codex') throw new Error('Unknown reviewer adapter.');
  const reviewer = args.reviewer === 'codex' ? (request, attemptDirectory) => codexReview(request,
    { directory: attemptDirectory, executable: args.codex || 'codex', model: args.model || 'gpt-6-luna', effort: args.effort || 'max' }) : undefined;
  const manifest = await buildApplication({ source, posting, dataDir: path.resolve(args.data), directory,
    route: args.route || 'tailor_resume', reviewer });
  console.log(JSON.stringify({ status: manifest.status, pdfPath: manifest.pdfPath, binding: manifest.binding,
    mechanical: manifest.mechanical, reviewerError: manifest.reviewerError }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
