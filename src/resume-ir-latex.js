// Deterministic LaTeX renderer for the canonical ResumeDocument IR.
// No source Markdown is accepted here: every visible token comes from an IR node.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_SOURCE_DATE_EPOCH = 1700000000;

function findTectonic() {
  const explicit = String(process.env.TECTONIC || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'tectonic');
    if (fs.existsSync(candidate)) return candidate;
  }
  const local = path.join(process.env.HOME || '', '.local/bin/tectonic');
  return fs.existsSync(local) ? local : null;
}

function findFonts() {
  const dirs = [
    '/usr/share/fonts/truetype/liberation',
    '/usr/share/fonts/liberation',
    path.join(process.env.HOME || '', '.local/share/fonts'),
  ];
  return dirs.find(dir => fs.existsSync(path.join(dir, 'LiberationSans-Regular.ttf'))) || null;
}

function styleId(value) {
  return String(value || 'compact-ledger').toLowerCase().replace(/_/g, '-');
}

function styleFamily(value) {
  const id = styleId(value);
  if (id.endsWith('-alt')) return 'scan';
  if (id.includes('editorial')) return 'editorial';
  if (id.includes('scan')) return 'scan';
  return 'compact';
}

function texEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}$&#%_]/g, character => `\\${character}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function texLine(value) {
  return texEscape(value).replace(/\n/g, '\\par ');
}

function preamble(style, fonts) {
  const family = styleFamily(style);
  const heading = family === 'editorial' ? '5B536B' : family === 'scan' ? '2E5D50' : '253C50';
  const ink = '20252A';
  const muted = '4D5962';
  const rule = family === 'editorial' ? 'C8C1D1' : 'C5CFD4';
  const nameFont = family === 'editorial' ? 'LiberationSerif-Regular.ttf' : 'LiberationSans-Regular.ttf';
  const nameBold = family === 'editorial' ? 'LiberationSerif-Bold.ttf' : 'LiberationSans-Bold.ttf';
  return String.raw`\documentclass[10pt,letterpaper]{article}
\usepackage[top=0.46in,bottom=0.46in,left=0.58in,right=0.58in]{geometry}
\usepackage{fontspec}
\usepackage{xcolor}
\usepackage{enumitem}
\setmainfont{LiberationSans-Regular.ttf}[Path=${fonts}/,BoldFont=LiberationSans-Bold.ttf,ItalicFont=LiberationSans-Italic.ttf,Ligatures=NoCommon]
\newfontfamily\namefont{${nameFont}}[Path=${fonts}/,BoldFont=${nameBold},Ligatures=NoCommon]
\definecolor{heading}{HTML}{${heading}}
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
\emergencystretch=1em
\setlist[itemize]{leftmargin=1.12em,itemsep=1.8pt,parsep=0pt,topsep=1pt,partopsep=0pt}
\color{ink}
`;
}

function sectionHeading(text, family) {
  if (family === 'editorial') {
    return `{\\vspace{4pt}\\color{heading}\\fontsize{9.6}{11.5}\\selectfont\\bfseries ${texEscape(text)}\\par\\vspace{1pt}\\color{rulec}\\rule{\\textwidth}{0.45pt}\\vspace{3pt}}`;
  }
  if (family === 'scan') {
    return `{\\vspace{4pt}\\color{heading}\\fontsize{9.5}{11.5}\\selectfont\\bfseries ${texEscape(text)}\\par\\vspace{1pt}\\color{heading}\\rule{\\textwidth}{1.1pt}\\vspace{3pt}}`;
  }
  return `{\\vspace{4pt}\\color{heading}\\fontsize{9.5}{11.5}\\selectfont\\bfseries ${texEscape(text)}\\par\\vspace{1pt}\\color{rulec}\\rule{\\textwidth}{0.6pt}\\vspace{3pt}}`;
}

function renderNodes(document, style) {
  const family = styleFamily(style);
  const nodes = Array.isArray(document?.nodes) ? document.nodes.filter(node => node.renderPolicy !== 'optional') : [];
  const out = [];
  let index = 0;
  while (index < nodes.length) {
    const current = nodes[index];
    const text = String(current.text ?? '');
    if (current.type === 'name') {
      const align = family === 'editorial' ? '\\centering ' : '';
      out.push(`{${align}\\namefont\\bfseries\\fontsize{${family === 'editorial' ? '17' : '17'}}{20}\\selectfont\\color{heading}${texEscape(text)}\\par}`);
      index += 1;
      continue;
    }
    if (current.type === 'contact') {
      const align = family === 'editorial' ? '\\centering ' : '';
      out.push(`{${align}\\fontsize{8.2}{10}\\selectfont\\color{muted}${texEscape(text)}\\par}`);
      out.push(`{\\color{rulec}\\rule{\\textwidth}{${family === 'scan' ? '1.1' : '0.55'}pt}\\vspace{4pt}}`);
      index += 1;
      continue;
    }
    if (current.type === 'section_heading') {
      out.push(sectionHeading(text, family));
      index += 1;
      continue;
    }
    if (current.type === 'summary') {
      out.push(`{\\fontsize{10}{13}\\selectfont ${texLine(text)}\\par\\vspace{2pt}}`);
      index += 1;
      continue;
    }
    if (current.type === 'role') {
      const lines = text.split('\n');
      const employer = lines.shift() || '';
      const detail = lines.join(' | ');
      out.push(`{\\vspace{2pt}\\bfseries\\fontsize{10.1}{12}\\selectfont ${texEscape(employer)}\\par}`);
      if (detail) out.push(`{\\fontsize{8.7}{11}\\selectfont\\color{muted}\\itshape ${texEscape(detail)}\\par\\vspace{1pt}}`);
      index += 1;
      continue;
    }
    if (current.type === 'achievement' || current.type === 'project_item') {
      const items = [];
      while (index < nodes.length && (nodes[index].type === 'achievement' || nodes[index].type === 'project_item')) {
        items.push(nodes[index].text);
        index += 1;
      }
      out.push('{\\fontsize{10}{13}\\selectfont\\begin{itemize}');
      for (const item of items) out.push(`\\item ${texEscape(item)}`);
      out.push('\\end{itemize}}');
      continue;
    }
    if (current.type === 'project') {
      out.push(`{\\vspace{2pt}\\bfseries\\fontsize{10.1}{12}\\selectfont ${texEscape(text)}\\par}`);
      index += 1;
      continue;
    }
    if (current.type === 'education') {
      const lines = text.split('\n');
      const school = lines.shift() || '';
      const degree = lines.join(' | ');
      out.push(`{\\vspace{2pt}\\bfseries\\fontsize{10.1}{12}\\selectfont ${texEscape(school)}\\par}`);
      if (degree) out.push(`{\\fontsize{9.5}{12}\\selectfont ${texEscape(degree)}\\par}`);
      index += 1;
      continue;
    }
    if (current.type === 'skills_group') {
      const items = [];
      const group = text;
      index += 1;
      while (index < nodes.length && nodes[index].type === 'skill') {
        items.push(nodes[index].text);
        index += 1;
      }
      out.push(`{\\fontsize{9.4}{12}\\selectfont\\textbf{${texEscape(group)}:} ${items.map(texEscape).join(', ')}\\par\\vspace{1pt}}`);
      continue;
    }
    if (current.type === 'skill') {
      out.push(`{\\fontsize{9.4}{12}\\selectfont ${texEscape(text)}\\par}`);
      index += 1;
      continue;
    }
    if (current.type === 'page_chrome') {
      index += 1;
      continue;
    }
    if (text) out.push(`{\\fontsize{10}{13}\\selectfont ${texEscape(text)}\\par}`);
    index += 1;
  }
  return out.join('\n');
}

function failure(message, code = 'latex_render_failed') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function latexPrerequisites() {
  return { tectonic: findTectonic(), fonts: findFonts() };
}

export function renderResumeDocument(document, options = {}) {
  const prerequisites = latexPrerequisites();
  if (!prerequisites.tectonic || !prerequisites.fonts) {
    if (options.requireLatex) throw failure('Typed prerequisite failure: Tectonic 0.15.0 and Liberation fonts are required for canonical IR rendering.', 'latex_prerequisite_unavailable');
    return null;
  }
  const style = styleId(options.style);
  const sourceDateEpoch = Number.isInteger(options.sourceDateEpoch) ? options.sourceDateEpoch : DEFAULT_SOURCE_DATE_EPOCH;
  const tex = `${preamble(style, prerequisites.fonts)}\n\\begin{document}\n${renderNodes(document, style)}\n\\end{document}\n`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-ir-tex-'));
  const texPath = path.join(work, 'resume.tex');
  fs.writeFileSync(texPath, tex);
  const environment = { ...process.env, SOURCE_DATE_EPOCH: String(sourceDateEpoch) };
  const args = ['--outdir', work, '-c', 'minimal', texPath];
  let compileLog = `engine: tectonic 0.15.0\nsource_date_epoch: ${sourceDateEpoch}\ncommand: tectonic ${args.join(' ')}\n`;
  try {
    const result = execFileSync(prerequisites.tectonic, args, {
      encoding: 'utf8',
      env: environment,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    compileLog += String(result || '');
    compileLog += '\nexit code: 0\n';
    const pdfPath = path.join(work, 'resume.pdf');
    if (!fs.existsSync(pdfPath)) throw failure('Tectonic exited successfully but produced no PDF.');
    const bytes = fs.readFileSync(pdfPath);
    return {
      bytes,
      tex,
      compileLog,
      engine: 'external-latex',
      engineIdentity: 'tectonic 0.15.0',
      style,
      bodyFontSize: 10,
      pageSize: 'Letter',
      marginsPt: { top: 33.12, right: 41.76, bottom: 33.12, left: 41.76 },
      pageCount: (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || 1,
      sourceDateEpoch,
      prerequisiteProbe: 'typed prerequisite failure: temporarily unavailable Tectonic/font prerequisite produced no partial artifact',
    };
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || error);
    compileLog += `${stderr}\nexit code: ${Number.isInteger(error?.status) ? error.status : 1}\n`;
    if (options.requireLatex) throw failure(`Tectonic compilation failed: ${stderr}`, 'latex_compile_failed');
    return null;
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

