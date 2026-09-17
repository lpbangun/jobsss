// Optional pretty PDF via tectonic + Liberation fonts. Native Helvetica remains
// the fallback when tectonic or fonts are absent. Never required at runtime.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function whichTectonic() {
  const env = String(process.env.TECTONIC || '').trim();
  if (env && fs.existsSync(env)) return env;
  const candidates = [];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'tectonic'));
  }
  const home = process.env.HOME || '';
  if (home) candidates.push(path.join(home, '.local/bin/tectonic'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function fontDir() {
  const dirs = [
    '/usr/share/fonts/truetype/liberation',
    '/usr/share/fonts/liberation',
    path.join(process.env.HOME || '', '.local/share/fonts'),
  ];
  return dirs.find(dir => fs.existsSync(path.join(dir, 'LiberationSans-Regular.ttf'))) || null;
}

function texEscape(value) {
  return String(value || '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}$&#%_]/g, ch => `\\${ch}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function resolveStyle(style) {
  const id = String(style || 'navy').toLowerCase().replace(/_/g, '-');
  if (id === 'editorial' || id === 'a') return 'editorial';
  if (id === 'scan' || id === 'recruiter-scan' || id === 'c') return 'scan';
  return 'navy';
}

function preamble(style, fonts) {
  const navy = '253C50';
  const ink = '222222';
  const muted = '444444';
  const rule = 'C2CAD0';
  const nameFont = style === 'editorial' ? 'LiberationSerif-Regular.ttf' : 'LiberationSans-Regular.ttf';
  const nameBold = style === 'editorial' ? 'LiberationSerif-Bold.ttf' : 'LiberationSans-Bold.ttf';
  const nameSpace = style === 'editorial' ? '0.6' : '-1.2';
  return String.raw`\documentclass[10pt,letterpaper]{article}
\usepackage[top=0.46in,bottom=0.42in,left=0.55in,right=0.55in]{geometry}
\usepackage{fontspec}
\usepackage{xcolor}
\usepackage{enumitem}
\setmainfont{LiberationSans-Regular.ttf}[
  Path=${fonts}/,
  BoldFont=LiberationSans-Bold.ttf,
  ItalicFont=LiberationSans-Italic.ttf,
  Ligatures=NoCommon]
\newfontfamily\namefont{${nameFont}}[
  Path=${fonts}/,
  BoldFont=${nameBold},
  Ligatures=NoCommon,
  LetterSpace=${nameSpace}]
\definecolor{navy}{HTML}{${navy}}
\definecolor{ink}{HTML}{${ink}}
\definecolor{muted}{HTML}{${muted}}
\definecolor{rulec}{HTML}{${rule}}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\raggedright
\hyphenpenalty=10000
\exhyphenpenalty=10000
\pretolerance=10000
\tolerance=2000
\emergencystretch=2em
\setlist[itemize]{leftmargin=1.1em,itemsep=2.1pt,parsep=0pt,topsep=1pt,partopsep=0pt}
\color{ink}
`;
}

function blocksToTex(blocks, style) {
  const out = [];
  const flushItems = (items) => {
    if (!items.length) return;
    out.push('{\\fontsize{12}{16}\\selectfont');
    out.push('\\begin{itemize}');
    for (const item of items) out.push(`  \\item ${texEscape(item)}`);
    out.push('\\end{itemize}}');
    items.length = 0;
  };
  const items = [];
  let i = 0;
  const blocksList = blocks || [];
  while (i < blocksList.length) {
    const block = blocksList[i];
    if (block.type === 'name') {
      flushItems(items);
      const name = `{\\namefont\\bfseries\\fontsize{21.5}{24}\\selectfont\\color{navy}${texEscape(block.text)}\\par}`;
      if (style === 'editorial') out.push(`{\\centering ${name}}`);
      else if (style === 'scan') {
        const contact = blocksList[i + 1]?.type === 'contact' ? blocksList[++i] : null;
        const lines = contact ? String(contact.text).split('|').map(part => part.trim()).filter(Boolean) : [];
        out.push('\\noindent\\begin{minipage}[t]{0.62\\textwidth}');
        out.push(name);
        out.push('\\end{minipage}\\hfill\\begin{minipage}[t]{0.35\\textwidth}\\raggedleft\\fontsize{8}{10}\\selectfont\\color{muted}');
        for (const line of lines) out.push(`${texEscape(line)}\\\\`);
        out.push('\\end{minipage}\\par');
        out.push('{\\color{navy}\\rule{\\textwidth}{1.6pt}}\\vspace{5pt}');
      } else {
        out.push(name);
      }
      i += 1;
      continue;
    }
    if (block.type === 'contact') {
      flushItems(items);
      if (style === 'editorial') {
        out.push(`{\\centering\\fontsize{8}{10}\\selectfont\\color{muted}${texEscape(block.text)}\\par}`);
        out.push('{\\color{rulec}\\rule{\\textwidth}{0.5pt}}\\vspace{6pt}');
      } else {
        out.push(`{\\fontsize{8.1}{10}\\selectfont\\color{muted}${texEscape(block.text)}\\par}`);
        out.push('{\\color{navy}\\rule{\\textwidth}{0.9pt}}\\vspace{6pt}');
      }
      i += 1;
      continue;
    }
    if (block.type === 'focus' || block.type === 'target') {
      flushItems(items);
      out.push(`{\\color{navy}\\fontsize{10}{12}\\selectfont\\bfseries ${texEscape(block.text)}\\par}\\vspace{2pt}`);
      i += 1;
      continue;
    }
    if (block.type === 'summary' || block.type === 'body') {
      flushItems(items);
      out.push(`{\\fontsize{12}{15}\\selectfont ${texEscape(block.text)}\\par}\\vspace{3pt}`);
      i += 1;
      continue;
    }
    if (block.type === 'h2') {
      flushItems(items);
      if (block.text === 'EDUCATION') out.push('\\vspace{84pt}');
      if (block.text === 'SKILLS') out.push('\\vspace{88pt}');
      out.push(`\\vspace{8pt}{\\color{navy}\\fontsize{9.8}{12}\\selectfont\\bfseries ${texEscape(block.text)}\\par}`);
      out.push('{\\color{rulec}\\rule{\\textwidth}{0.4pt}}\\vspace{3pt}');
      i += 1;
      continue;
    }
    if (block.type === 'h3') {
      flushItems(items);
      out.push(`\\vspace{3pt}{\\bfseries\\fontsize{9.7}{12}\\selectfont ${texEscape(block.text)}}\\par`);
      i += 1;
      continue;
    }
    if (block.type === 'meta') {
      flushItems(items);
      out.push(`{\\fontsize{8.7}{11}\\selectfont\\color{muted}\\itshape ${texEscape(block.text)}\\par}`);
      i += 1;
      continue;
    }
    if (block.type === 'bullet') items.push(block.text);
    i += 1;
  }
  flushItems(items);
  return out.join('\n');
}

export function latexAvailable() {
  return Boolean(whichTectonic() && fontDir());
}

export function renderLatexPdf(content, options = {}) {
  if (options.engine === 'native' || process.env.JOBSSS_PDF_ENGINE === 'native') return null;
  const tectonic = whichTectonic();
  const fonts = fontDir();
  if (!tectonic || !fonts) return null;
  const style = resolveStyle(options.style);
  const blocks = Array.isArray(options.blocks) && options.blocks.length ? options.blocks : null;
  if (!blocks) return null;
  const tex = `${preamble(style, fonts)}
\\begin{document}
${blocksToTex(blocks, style)}
\\end{document}
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-tex-'));
  const texPath = path.join(dir, 'resume.tex');
  fs.writeFileSync(texPath, tex);
  try {
    execFileSync(tectonic, ['--outdir', dir, '-c', 'minimal', texPath], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pdfPath = path.join(dir, 'resume.pdf');
    if (!fs.existsSync(pdfPath)) return null;
    const bytes = fs.readFileSync(pdfPath);
    return {
      bytes,
      pageCount: (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || 1,
      bodyFontSize: 12,
      pageSize: 'Letter',
      marginsPt: 40,
      engine: 'tectonic',
      style,
      atsReadability: 'Searchable single-column text; no proprietary ATS score or compatibility guarantee.',
    };
  } catch (error) {
    const log = String(process.env.JOBSSS_TEX_LOG || '').trim();
    if (log) {
      try {
        fs.writeFileSync(log, String(error?.stderr || error?.message || error));
      } catch {}
    }
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
