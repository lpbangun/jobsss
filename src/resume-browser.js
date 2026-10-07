// Local-only HTML to PDF adapter. It never navigates to an employer site.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const candidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];

export function detectResumeRenderer() {
  const explicit = String(process.env.JOBSSS_RESUME_BROWSER || '').trim();
  const search = explicit ? [explicit] : candidates;
  const found = search.find(item => { try { return fs.statSync(item).isFile(); } catch { return false; } });
  return { available: Boolean(found), engine: 'local-chrome-edge', executable: found || null,
    message: found ? 'Local browser print adapter is available.' : 'Install local Chrome or Edge, or set JOBSSS_RESUME_BROWSER to its executable path.' };
}

function removeBrowserScratch(temp) {
  // Chrome can finish flushing profile files just after its parent exits.
  // Retry the whole traversal: rmSync's own retry only retries the final
  // rmdir and cannot remove files created after its first traversal.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { fs.rmSync(temp, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error.code) || attempt === 19) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function escape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const RESUME_DESIGNS = Object.freeze([
  Object.freeze({
    id: 'navy', name: 'Navy Professional', version: 2,
    description: 'The existing restrained navy design with a shaded summary and clear section dividers.',
    bodyFontSize: 9.7,
  }),
  Object.freeze({
    id: 'editorial', name: 'Editorial Serif', version: 2,
    description: 'A classic serif design with a centered name and a quiet, literary hierarchy.',
    bodyFontSize: 9.7,
  }),
  Object.freeze({
    id: 'scan', name: 'Quick Scan', version: 2,
    description: 'A compact sans-serif design with strong section labels and a high-contrast teal accent.',
    bodyFontSize: 9.4,
  }),
]);

export function listResumeDesigns() {
  return RESUME_DESIGNS.map(({ id, name, version, description }) => ({ id, name, version, description }));
}

function resolveResumeDesign(style = 'navy') {
  const id = String(style || 'navy').trim().toLowerCase();
  const design = RESUME_DESIGNS.find(item => item.id === id);
  if (!design) {
    throw Object.assign(new Error(`Unknown resume design "${id}". Choose navy, editorial, or scan.`), { code: 'resume_design_invalid' });
  }
  return design;
}

export function resumeHtml(document, { style = 'navy', density = 0 } = {}) {
  const design = resolveResumeDesign(style);
  const master = document.presentation?.mode === 'master';
  const sizes = [10, 10.25, 10.5, 10.75, 11, 9.75, 9.5];
  const gaps = [4, 5, 6, 7, 8, 3, 2];
  const font = sizes[density] ?? sizes[0];
  const gap = gaps[density] ?? gaps[0];
  const nodes = document.nodes.filter(node => node.renderPolicy === 'required');
  const body = [];
  let list = false;
  const close = () => { if (list) { body.push('</ul>'); list = false; } };
  for (const node of nodes) {
    if (master && node.type === 'skill') continue;
    if (node.type === 'achievement' || (node.type === 'project_item' && !master)) {
      if (!list) { body.push('<ul>'); list = true; }
      body.push(`<li>${escape(node.text)}</li>`);
      continue;
    }
    close();
    const tag = {
      name: 'h1', contact: 'p', section_heading: 'h2', summary: 'p', role: 'h3',
      project: 'h3', education: 'p', skills_group: 'p', skill: 'span',
    }[node.type] || 'p';
    const klass = ({ contact: 'contact', summary: 'summary', education: 'education', skills_group: 'skills-group', skill: 'skill' })[node.type] || node.type;
    const value = node.type === 'skills_group' && master
      ? `<strong>${escape(node.text)}:</strong> ${(node.items || []).map(escape).join(', ')}`
      : node.type === 'role' && master
      ? `<strong>${escape(node.text.split('\n')[0])}</strong><br><span class="role-details">${node.text.split('\n').slice(1).map(escape).join(' | ')}</span>`
      : ['role', 'education'].includes(node.type) ? String(node.text).split('\n').map(escape).join('<br>')
      : node.type === 'contact' && /Open to /i.test(node.text)
        ? escape(node.text).replace(/ \| (?=linkedin\.com\/)/i, '<br>')
        : escape(node.text);
    body.push(`<${tag} class="${klass}">${value}</${tag}>`);
    if (node.type === 'contact' && document.headline) body.push(`<p class="headline">${escape(document.headline)}</p>`);
  }
  close();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(document.candidateName)} Resume</title><style>
@page { size: Letter; margin: .40in .48in .42in .48in; }
* { box-sizing:border-box; } html,body { background:#fff; }
body { font-family:Arial,Helvetica,sans-serif; color:#202633; font-size:9.7pt; line-height:1.23; margin:0; border-top:4px solid #233e63; padding-top:8px; }
h1 { color:#233e63; font-size:16.5pt; letter-spacing:.035em; line-height:1; margin:0 0 2px; }
.contact { color:#536071; font-size:8.6pt; line-height:1.12; margin:0 0 9px; }
.summary { background:#eef3f8; border-left:3px solid #233e63; font-size:9.8pt; line-height:1.28; margin:0 0 10px; padding:7px 10px; }
h2 { color:#233e63; border-bottom:1px solid #acb8c6; font-size:9.7pt; letter-spacing:.085em; line-height:1.05; margin:10px 0 5px; padding-bottom:3px; text-transform:uppercase; break-after:avoid; }
h3 { color:#202633; font-size:9.6pt; line-height:1.13; margin:5px 0 2px; break-after:avoid; }
p { margin:0 0 3px; } .education { font-size:9.3pt; } .skills-group { font-weight:bold; margin-bottom:1px; }
.skill { display:inline; font-size:9pt; } .skill:after { content:" · "; } .skill:last-child:after { content:""; }
ul { margin:2px 0 5px 18px; padding:0; } li { margin:0 0 3px; padding-left:3px; }

/* Editorial keeps the same single-column content order but uses typographic
   hierarchy and spacing in place of the navy design's shaded panels. */
.design-editorial { font-family:Georgia,'Times New Roman',serif; color:#302d2a; line-height:1.22; padding-top:0; border-top:0; }
.design-editorial h1 { color:#513a3a; font-size:21pt; font-weight:normal; letter-spacing:.01em; line-height:1.04; text-align:center; margin:0 0 4px; }
.design-editorial .contact { color:#625d58; font-family:Arial,Helvetica,sans-serif; font-size:8.4pt; line-height:1.2; text-align:center; border-bottom:1px solid #cfc5b8; margin:0 0 9px; padding-bottom:7px; }
.design-editorial .summary { background:transparent; border-left:2px solid #9a775b; color:#48433e; font-size:9.7pt; line-height:1.3; margin:0 0 9px; padding:2px 0 2px 10px; }
.design-editorial h2 { color:#76554d; border-bottom:1px solid #d8cec3; font-family:Arial,Helvetica,sans-serif; font-size:9.5pt; font-weight:700; letter-spacing:.04em; line-height:1.1; margin:9px 0 4px; padding-bottom:3px; text-transform:uppercase; }
.design-editorial h3 { color:#302d2a; font-size:9.6pt; line-height:1.15; margin:4px 0 2px; }
.design-editorial p { margin-bottom:3px; } .design-editorial .education { color:#47413c; font-size:9.2pt; }
.design-editorial .skills-group { color:#514840; font-family:Arial,Helvetica,sans-serif; font-size:9.2pt; }
.design-editorial .skill { font-family:Arial,Helvetica,sans-serif; font-size:8.9pt; }
.design-editorial .skill:after { content:"  /  "; color:#a28d7b; }
.design-editorial .skill:last-child:after { content:""; }
.design-editorial ul { margin:2px 0 5px 17px; } .design-editorial li { margin-bottom:3px; padding-left:2px; }

/* Quick Scan uses a compact sans-serif rhythm and shaded section labels. */
.design-scan { font-family:Arial,Helvetica,sans-serif; color:#1e2933; font-size:9.4pt; line-height:1.18; border-top:4px solid #187b78; padding-top:7px; }
.design-scan h1 { color:#173b47; font-size:19pt; letter-spacing:.005em; line-height:1.02; margin:0 0 3px; }
.design-scan .contact { color:#425761; font-size:8.4pt; line-height:1.1; margin:0 0 7px; }
.design-scan .summary { background:#fff; border:0; border-bottom:1px solid #bac9cc; color:#253a40; font-size:9.5pt; line-height:1.22; margin:0 0 7px; padding:0 0 7px; }
.design-scan h2 { background:#edf3f3; border:0; border-left:3px solid #187b78; color:#174c4c; font-size:9.4pt; letter-spacing:.07em; line-height:1.04; margin:8px 0 4px; padding:4px 6px; text-transform:uppercase; }
.design-scan h3 { color:#1e2933; font-size:9.3pt; line-height:1.25; margin:5px 0 3px; }
.design-scan p { margin:0 0 2px; } .design-scan .education { color:#384950; font-size:9pt; }
.design-scan .skills-group { color:#25464a; font-size:9pt; margin-bottom:0; }
.design-scan .skill { color:#35444b; font-size:8.7pt; }
.design-scan .skill:after { content:"  •  "; color:#57918e; }
.design-scan .skill:last-child:after { content:""; }
.design-scan ul { margin:1px 0 4px 17px; } .design-scan li { margin-bottom:2px; padding-left:2px; }

.headline {color:#233e63;font-size:11pt;font-weight:bold;margin:0 0 5px;break-after:avoid;}
${master ? `
body {font-size:${font}pt;line-height:1.25;padding-top:6px;}
h1 {font-size:22pt;letter-spacing:.01em;}
.contact {border-bottom:1px solid #233e63;padding-bottom:6px;margin-bottom:7px;}
.summary {background:transparent;border:0;padding:0;font-size:inherit;line-height:inherit;margin-bottom:6px;}
h2 {margin-top:${gap + 5}px;margin-bottom:4px;}
h3.role {font-size:inherit;}
.role-details {font-weight:normal;}
.education,.skill,.skills-group {font-size:inherit;}
.skills-group {font-weight:normal;margin-bottom:3px;}
.project_item {margin:0 0 ${gap}px;}
li {margin-bottom:${gap}px;}
` : ''}
</style></head><body class="design-${design.id}">${body.join('\n')}</body></html>`;
}

export function renderResumeBrowser(document, { style = 'navy' } = {}) {
  const design = resolveResumeDesign(style);
  if (!document?.candidateName?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.contactEmail || '')
      || !document.nodes?.some(node => node.type === 'name' && node.text === document.candidateName)
      || !document.nodes?.some(node => node.type === 'contact' && node.text.includes(document.contactEmail))) {
    throw Object.assign(new Error('Resume PDF requires a validated name and selected contact.'), { code: 'resume_ir_invalid' });
  }
  const capability = detectResumeRenderer();
  if (!capability.available) throw Object.assign(new Error(capability.message), { code: 'resume_renderer_unavailable' });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-resume-'));
  try {
    const html = path.join(temp, 'resume.html');
    const pdf = path.join(temp, 'resume.pdf');
    let htmlText; let measured; let selectedDensity = 0;
    const attempts = [];
    const master = document.presentation?.mode === 'master';
    // Probe the same CSS at Letter's printable width. The browser measures
    // actual laid-out boxes before export; the PDF page count remains a
    // separate post-render check below.
    const printableWidthPx = (8.5 - .48 - .48) * 96;
    const printableHeightPx = (11 - .40 - .42) * 96;
    const qaHtml = path.join(temp, 'layout-qa.html');
    const script = `<style>html,body{width:${printableWidthPx}px}</style><script>
      const boxes=[...document.body.querySelectorAll('*')].map(el=>el.getBoundingClientRect());
      const root=document.body.getBoundingClientRect();
      const maxX=Math.max(root.right,...boxes.map(box=>box.right))-root.left;
      const minX=Math.min(root.left,...boxes.map(box=>box.left))-root.left;
      const maxY=Math.max(root.bottom,...boxes.map(box=>box.bottom))-root.top;
      const content=[...document.querySelectorAll('h1,h2,h3,p,li,.skill')];
      const minBodyPt=Math.min(...content.filter(el=>el.matches('li,.education,.skill,.project_item,.skills-group')).map(el=>parseFloat(getComputedStyle(el).fontSize)*.75));
      const visibleBottom=Math.max(...content.map(el=>el.getBoundingClientRect().bottom))-root.top;
      let bottom=root.top,maxGap=0;
      for(const box of content.map(el=>el.getBoundingClientRect()).sort((a,b)=>a.top-b.top)){maxGap=Math.max(maxGap,box.top-bottom);bottom=Math.max(bottom,box.bottom)}
      document.title='JOBSSS_QA:'+btoa(JSON.stringify({maxX,minX,maxY,scrollWidth:document.body.scrollWidth,
        scrollHeight:document.body.scrollHeight,minBodyPt,maxGap,visibleFill:visibleBottom/977.28,bodyFontPx:parseFloat(getComputedStyle(document.body).fontSize)}));
    </script>`;
    const commonFlags = ['--headless', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
      '--disable-dev-shm-usage', `--user-data-dir=${path.join(temp, 'browser-profile')}`];
    let best = null;
    for (const density of master ? [0, 1, 2, 3, 4, 5, 6] : [0]) {
      const candidateHtml = resumeHtml(document, { style: design.id, density });
      fs.writeFileSync(qaHtml, candidateHtml.replace("default-src 'none'; style-src 'unsafe-inline'",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
        .replace('</body>', `${script}</body>`), { mode: 0o600 });
      const run = spawnSync(capability.executable, [...commonFlags, '--dump-dom', pathToFileURL(qaHtml).href],
        { encoding: 'utf8', timeout: 45000, windowsHide: true });
      const encoded = run.stdout?.match(/JOBSSS_QA:([A-Za-z0-9+/=]+)/)?.[1];
      if (run.error || run.status !== 0 || !encoded) throw Object.assign(new Error('Local browser could not measure resume layout.'), { code: 'resume_layout_qa_failed' });
      const facts = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      const bounded = facts.minX >= -1 && facts.maxX <= printableWidthPx + 1
        && facts.maxY <= printableHeightPx + 1 && facts.scrollWidth <= printableWidthPx + 1
        && facts.scrollHeight <= printableHeightPx + 1 && facts.bodyFontPx >= 12
        && (!master || (facts.minBodyPt >= 9.5 && facts.maxGap <= 36));
      attempts.push({ density, ...facts, bounded });
      if (bounded && (!best || Math.abs(facts.visibleFill - .93) < Math.abs(best.facts.visibleFill - .93))) best = { facts, html: candidateHtml, density };
      if (bounded && (!master || (facts.visibleFill >= .90 && facts.visibleFill <= .96))) break;
    }
    if (!best) throw Object.assign(new Error('Resume layout exceeds Letter printable bounds or uses unreadable body type.'), { code: 'resume_layout_qa_failed' });
    measured = best.facts; htmlText = best.html; selectedDensity = best.density;
    if (document.presentation?.fillPage && (measured.visibleFill < .88 || measured.visibleFill > .96)) {
      throw Object.assign(new Error('Supported source cannot meet full-page balance within the readable layout limits.'), { code: 'resume_page_fill_unresolved', layoutAttempts: attempts });
    }
    fs.writeFileSync(html, htmlText, { mode: 0o600 });
    const flags = [...commonFlags, '--no-pdf-header-footer',
      `--print-to-pdf=${pdf}`, pathToFileURL(html).href];
    const result = spawnSync(capability.executable, flags, { encoding: 'utf8', timeout: 45000, windowsHide: true });
    if (result.error || result.status !== 0 || !fs.existsSync(pdf)) {
      throw Object.assign(new Error(`Local browser PDF export failed: ${result.error?.message || result.stderr || result.status}`), { code: 'resume_render_failed' });
    }
    const bytes = fs.readFileSync(pdf);
    const pageCount = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    if (pageCount !== 1 || !bytes.includes(Buffer.from('/ToUnicode'))) {
      throw Object.assign(new Error(`Resume PDF QA failed: ${pageCount} page(s) or missing searchable-text mapping.`), { code: 'resume_pdf_qa_failed' });
    }
    return { bytes, pageCount, pageSize: 'Letter', bodyFontSize: measured.bodyFontPx * .75, marginsPt: 28.8,
      pageMarginsPt: { top: 28.8, right: 34.56, bottom: 30.24, left: 34.56 },
      engine: 'local-chrome-edge', rendererExecutable: capability.executable,
      design: { id: design.id, name: design.name, version: design.version, description: design.description },
      designId: design.id,
      qa: { headline: document.headline || null, headlineKind: document.headlineKind || null,
        presentation: document.presentation || null, visibleFill: measured.visibleFill, minBodyPt: measured.minBodyPt,
        maxGapPx: measured.maxGap, selectedDensity, layoutAttempts: attempts,
        fullPageBalanced: measured.visibleFill >= .88 && measured.visibleFill <= .96, onePage: true, searchableTextMapping: true, designId: design.id,
        layoutBoundsPx: { minX: measured.minX, maxX: measured.maxX, maxY: measured.maxY,
          printableWidth: printableWidthPx, printableHeight: printableHeightPx },
        measuredBodyFontPx: measured.bodyFontPx, contentReview: 'required', visualReview: 'required' } };
  } finally { removeBrowserScratch(temp); }
}
