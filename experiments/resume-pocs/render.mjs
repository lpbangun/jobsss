import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resumeHtml, detectResumeRenderer } from '../../src/resume-browser.js';
import { RUBRIC, checkLayout, hash } from './contracts.mjs';
import { stableStringify } from '../../src/resume-compiler.js';

export function refreshCanonical(canonical) {
  const result = structuredClone(canonical);
  result.irSha256 = hash(stableStringify(result.ir));
  result.content = result.ir.nodes.filter(n => n.renderPolicy === 'required' && n.type !== 'skill')
    .flatMap(n => {
      const text = ['achievement', 'project_item'].includes(n.type) ? `- ${n.text}`
        : n.type === 'skills_group' ? `${n.text}: ${(n.items || []).join(', ')}` : n.text;
      return n.type === 'contact' && result.ir.headline ? [text, result.ir.headline] : [text];
    }).join('\n') + '\n';
  const summary = result.ir.nodes.find(n => n.type === 'summary');
  result.summary = summary ? { text: summary.text, claimIds: summary.claimIds } : null;
  // The POC exports IR, not production block renderer state.
  delete result.blocks;
  return result;
}

export function useSourceSummary(canonical) {
  const result = structuredClone(canonical);
  const quote = result.profile.summary?.trim();
  const claim = result.ledger.claims.find(c => c.status === 'active' && c.ownerId === 'profile' && c.sourceQuote === quote);
  const summary = result.ir.nodes.find(n => n.type === 'summary');
  if (!quote || !claim || !summary) throw new Error('No attributable candidate-supplied summary is available.');
  summary.text = quote; summary.claimIds = [claim.claimId];
  return refreshCanonical(result);
}

export function runProcess(command, args, { timeout = 45000, input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Process timed out after ${timeout}ms`)); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Process failed (${code}): ${stderr.slice(-1000)}`)); else resolve(stdout); });
    child.stdin.end(input);
  });
}

export function renderHtml(ir, density = 0) {
  const sizes = [10, 9.7, 9.5, 10.3, 10.5];
  const lines = [1.25, 1.22, 1.18, 1.28, 1.3];
  const gaps = [4, 3, 2, 5, 6];
  let html = resumeHtml(ir, { style: 'navy' });
  // Only generated, escaped text is transformed; arbitrary HTML stays escaped.
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return html.replace('</style>', `
body {font-size:${sizes[density]}pt;line-height:${lines[density]};}
li {margin-bottom:${gaps[density]}px;}
h2 {margin-top:${gaps[density] + 6}px;}
.education,.skill {font-size:9.5pt;}
a {color:inherit;text-decoration:none;}
</style>`);
}

const WIDTH = (8.5 - .48 - .48) * 96;
const HEIGHT = (11 - .40 - .42) * 96;
const scoreText = (text, posting) => {
  const terms = new Set(posting.toLowerCase().match(/[a-z]{4,}/g) || []);
  return [...new Set(text.toLowerCase().match(/[a-z]{4,}/g) || [])].filter(t => terms.has(t)).length;
};

export function repairSelection(canonical, posting, direction) {
  const result = structuredClone(canonical); const nodes = result.ir.nodes;
  if (direction === 'restore') {
    const used = new Set(nodes.flatMap(n => n.claimIds));
    const omitted = result.ledger.claims.filter(c => c.status === 'active' && c.roleIndex !== null
      && !used.has(c.claimId)
      && (!result.ir.presentation?.maxBulletsPerRole || nodes.filter(n => n.type === 'achievement' && n.roleRef?.roleIndex === c.roleIndex).length < result.ir.presentation.maxBulletsPerRole) && scoreText(c.sourceQuote, posting) >= 2)
      .sort((a, b) => scoreText(b.sourceQuote, posting) - scoreText(a.sourceQuote, posting) || a.claimId.localeCompare(b.claimId));
    const claim = omitted[0]; if (!claim) return null;
    const role = nodes.find(n => n.type === 'role' && n.roleRef?.roleIndex === claim.roleIndex);
    if (!role) return null;
    let at = nodes.indexOf(role) + 1;
    while (nodes[at]?.type === 'achievement') at++;
    nodes.splice(at, 0, { nodeId: `restored-${claim.claimId}`, type: 'achievement', text: claim.sourceQuote,
      claimIds: [claim.claimId], renderPolicy: 'required', roleRef: role.roleRef, ownerId: null, structuralReason: null });
  } else {
    const preferred = new Set(result.ir.revisionSelection?.preferClaimIds || []);
    const removable = nodes.filter(n => n.type === 'achievement' && !n.claimIds.some(id => preferred.has(id))
      && nodes.filter(p => p.type === 'achievement' && p.roleRef?.roleIndex === n.roleRef?.roleIndex).length > 1)
      .sort((a, b) => scoreText(a.text, posting) - scoreText(b.text, posting) || a.nodeId.localeCompare(b.nodeId));
    if (!removable.length) return null;
    nodes.splice(nodes.indexOf(removable[0]), 1);
  }
  nodes.forEach((n, i) => { n.order = i + 1; });
  return refreshCanonical(result);
}

export async function fitAndRender(canonical, posting, directory, { browser } = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  browser ||= detectResumeRenderer().executable;
  if (!browser) throw Object.assign(new Error('Local Chrome/Edge is required.'), { code: 'resume_renderer_unavailable' });
  const flags = ['--headless', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-dev-shm-usage', `--user-data-dir=${path.join(directory, 'browser-scratch')}`];
  const probe = `<style>html,body{width:${WIDTH}px}</style><script>
const root=document.body.getBoundingClientRect();
const els=[...document.querySelectorAll('h1,h2,h3,p,li,.skill')];
const boxes=els.map(e=>e.getBoundingClientRect()).filter(b=>b.width&&b.height);
const bottom=Math.max(...boxes.map(b=>b.bottom))-root.top;
const ordered=boxes.toSorted((a,b)=>a.top-b.top);let end=root.top,gap=0;
for(const b of ordered){gap=Math.max(gap,b.top-end);end=Math.max(end,b.bottom)}
const facts={minX:Math.min(...boxes.map(b=>b.left))-root.left,maxX:Math.max(...boxes.map(b=>b.right))-root.left,
maxY:bottom,width:${WIDTH},height:${HEIGHT},fill:bottom/${HEIGHT},maxGap:gap,
minBodyPt:Math.min(...[...document.querySelectorAll('li,.education,.skill')].map(e=>parseFloat(getComputedStyle(e).fontSize)*.75)),
rawMarkdown:/\\[[^\\]]+\\]\\(https?:/.test(document.body.innerText)};
document.title='POC_QA:'+btoa(JSON.stringify(facts));</script>`;
  const history = []; let candidate = structuredClone(canonical); let density = 0; let best = null;
  for (let attempt = 0; attempt < RUBRIC.maxLayoutAttempts; attempt++) {
    const html = renderHtml(candidate.ir, density);
    const probePath = path.join(directory, 'probe.html');
    fs.writeFileSync(probePath, html.replace("style-src 'unsafe-inline'", "style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .replace('</body>', probe + '</body>'), { mode: 0o600 });
    const dom = await runProcess(browser, [...flags, '--dump-dom', pathToFileURL(probePath).href]);
    const marker = dom.match(/POC_QA:([A-Za-z0-9+/=]+)/)?.[1];
    if (!marker) throw new Error('Browser layout measurement absent.');
    const layout = JSON.parse(Buffer.from(marker, 'base64').toString());
    const qa = checkLayout(layout);
    history.push({ attempt: attempt + 1, density, irSha256: hash(JSON.stringify(candidate.ir)), layout, qa });
    const validBounds = layout.fill <= RUBRIC.maxFill && !qa.failures.some(f => f !== 'underfilled');
    if (validBounds && (!best || Math.abs(layout.fill - RUBRIC.targetFill) < Math.abs(best.layout.fill - RUBRIC.targetFill))) {
      best = { candidate: structuredClone(candidate), html, layout, qa, density };
    }
    if (qa.passed && layout.fill >= 0.90) break;
    if (layout.fill < 0.90) {
      const expanded = repairSelection(candidate, posting, 'restore');
      if (expanded) { candidate = expanded; density = 0; continue; }
      if (density < 3) { density = 3; continue; }
      if (density === 3) { density = 4; continue; }
      break;
    }
    if (density < 2) { density++; continue; }
    const reduced = repairSelection(candidate, posting, 'reduce');
    if (!reduced) break;
    candidate = reduced; density = 0;
  }
  fs.writeFileSync(path.join(directory, 'layout-history.json'), JSON.stringify(history, null, 2));
  if (!best) return { status: 'qa_unresolved', reason: 'No readable bounded layout found.', history };
  const htmlPath = path.join(directory, 'resume.html'); const pdfPath = path.join(directory, 'resume.pdf');
  const previewPath = path.join(directory, 'preview.png');
  fs.writeFileSync(htmlPath, best.html, { mode: 0o600 });
  await runProcess(browser, [...flags, '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href]);
  const previewHtmlPath = path.join(directory, 'preview.html');
  fs.writeFileSync(previewHtmlPath, best.html.replace('</style>', `
@media screen {html{width:816px;}body{width:${WIDTH}px;margin:38.4px 46.08px 40.32px;}}
</style>`));
  await runProcess(browser, [...flags, '--hide-scrollbars', '--window-size=816,1056', '--force-device-scale-factor=1',
    `--screenshot=${previewPath}`, pathToFileURL(previewHtmlPath).href]);
  const pdf = fs.readFileSync(pdfPath);
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  const searchable = pdf.includes(Buffer.from('/ToUnicode'));
  const mechanical = { ...best.qa, pageCount, searchable, layout: best.layout };
  if (pageCount !== 1) mechanical.failures.push('page_count');
  if (!searchable) mechanical.failures.push('unsearchable_pdf');
  mechanical.passed = mechanical.failures.length === 0;
  return { canonical: best.candidate, pdfPath, previewPath, htmlPath, mechanical, history,
    status: mechanical.passed ? 'qa_pending' : 'qa_unresolved' };
}
