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

export function resumeHtml(document) {
  const nodes = document.nodes.filter(node => node.renderPolicy === 'required');
  const body = [];
  let list = false;
  const close = () => { if (list) { body.push('</ul>'); list = false; } };
  for (const node of nodes) {
    if (node.type === 'achievement' || node.type === 'project_item') {
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
    const value = ['role', 'education'].includes(node.type) ? String(node.text).split('\n').map(escape).join('<br>')
      : node.type === 'contact' && /Open to /i.test(node.text)
        ? escape(node.text).replace(/ \| (?=linkedin\.com\/)/i, '<br>')
        : escape(node.text);
    body.push(`<${tag} class="${klass}">${value}</${tag}>`);
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
</style></head><body>${body.join('\n')}</body></html>`;
}

export function renderResumeBrowser(document) {
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
    const htmlText = resumeHtml(document);
    fs.writeFileSync(html, htmlText, { mode: 0o600 });
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
      document.title='JOBSSS_QA:'+btoa(JSON.stringify({maxX,minX,maxY,scrollWidth:document.body.scrollWidth,
        scrollHeight:document.body.scrollHeight,bodyFontPx:parseFloat(getComputedStyle(document.body).fontSize)}));
    </script>`;
    fs.writeFileSync(qaHtml, htmlText.replace("default-src 'none'; style-src 'unsafe-inline'",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .replace('</body>', `${script}</body>`), { mode: 0o600 });
    const commonFlags = ['--headless', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
      '--disable-dev-shm-usage', `--user-data-dir=${path.join(temp, 'browser-profile')}`];
    const layoutRun = spawnSync(capability.executable, [...commonFlags, '--dump-dom', pathToFileURL(qaHtml).href],
      { encoding: 'utf8', timeout: 45000, windowsHide: true });
    const encoded = layoutRun.stdout?.match(/JOBSSS_QA:([A-Za-z0-9+/=]+)/)?.[1];
    if (layoutRun.error || layoutRun.status !== 0 || !encoded) {
      throw Object.assign(new Error(`Local browser could not measure resume layout (status ${layoutRun.status}; ${layoutRun.error?.message || layoutRun.stderr?.slice(0, 500) || 'QA marker absent'}).`), { code: 'resume_layout_qa_failed' });
    }
    const measured = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (measured.minX < -1 || measured.maxX > printableWidthPx + 1 || measured.maxY > printableHeightPx + 1
        || measured.scrollWidth > printableWidthPx + 1 || measured.scrollHeight > printableHeightPx + 1
        || measured.bodyFontPx < 12) {
      throw Object.assign(new Error('Resume layout exceeds Letter printable bounds or uses unreadable body type.'), { code: 'resume_layout_qa_failed' });
    }
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
    return { bytes, pageCount, pageSize: 'Letter', bodyFontSize: 9.7, marginsPt: 28.8,
      pageMarginsPt: { top: 28.8, right: 34.56, bottom: 30.24, left: 34.56 },
      engine: 'local-chrome-edge', rendererExecutable: capability.executable,
      qa: { onePage: true, searchableTextMapping: true,
        layoutBoundsPx: { minX: measured.minX, maxX: measured.maxX, maxY: measured.maxY,
          printableWidth: printableWidthPx, printableHeight: printableHeightPx },
        measuredBodyFontPx: measured.bodyFontPx, contentReview: 'required', visualReview: 'required' } };
  } finally { removeBrowserScratch(temp); }
}
