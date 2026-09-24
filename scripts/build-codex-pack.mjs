#!/usr/bin/env node
/**
 * Build the Codex job-search-stack adapter from three canonical products.
 *
 * The portable products remain canonical and independently installable. Codex
 * on Windows cannot directly execute their extensionless shebang launchers, so
 * this generated package mirrors only runtime/skill bytes and adds thin host
 * launch adapters. Every mirrored file is hashed in provenance.json.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPins } from './build-install-surfaces.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Keep product bytes outside compat/: that tree is reserved for thin host
// metadata and probes. The marketplace at compat/codex points back to this
// deterministic root-level package.
const OUT = path.join(ROOT, 'codex-pack', 'job-search-stack');
const PROVENANCE = 'provenance.json';
const ADAPTER_SOURCE_HASH = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitHead(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function ensurePinned(root, product) {
  const head = gitHead(root);
  if (head !== product.ref) throw new Error(`${product.name} checkout ${head} does not match pin ${product.ref}`);
  const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`${product.name} checkout has uncommitted changes; cannot claim pinned source`);
}

function ensureSelfProductPin(pins) {
  // A release commit contains generated adapters and can follow its product
  // commit. The pinned product bytes must still equal the source being packed.
  if (!fs.existsSync(path.join(ROOT, '.git'))) return; // source ZIP has no Git metadata
  const self = pins.products.find(product => product.name === 'jobsss');
  const changed = execFileSync('git', [
    '-C', ROOT, '-c', 'core.filemode=false', 'diff', '--name-only', '--ignore-space-at-eol', self.ref, '--',
    'bin', 'src', 'skills/jobsss', 'plugin.json', 'mcp.json', 'package.json'
  ], { encoding: 'utf8' }).trim();
  if (changed) throw new Error(`JobSSS product differs from its install pin:\n${changed}`);
}

function copyFile(sourceRoot, rel, destinationRoot, destinationRel = rel) {
  const source = path.join(sourceRoot, rel);
  const destination = path.join(destinationRoot, destinationRel);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const bytes = fs.readFileSync(source);
  // Git may materialize source text as CRLF on Windows while release checkouts
  // use LF. The pack inventory hashes distribution bytes, so normalize text at
  // the adapter boundary and keep binary inputs byte-for-byte.
  if (bytes.includes(0)) fs.writeFileSync(destination, bytes);
  else fs.writeFileSync(destination, bytes.toString('utf8').replace(/\r\n?/g, '\n'));
}

function copyTree(sourceRoot, rel, destinationRoot, destinationRel = rel) {
  const source = path.join(sourceRoot, rel);
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store' || /\.py[co]$/i.test(entry.name)) continue;
    const childRel = path.join(rel, entry.name);
    const childDestination = path.join(destinationRel, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in Codex pack input: ${childRel}`);
    if (entry.isDirectory()) copyTree(sourceRoot, childRel, destinationRoot, childDestination);
    else if (entry.isFile()) copyFile(sourceRoot, childRel, destinationRoot, childDestination);
  }
}

function listFiles(root, rel = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, child));
    else if (entry.isFile()) result.push(child.split(path.sep).join('/'));
  }
  return result;
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inventory(root) {
  return Object.fromEntries(listFiles(root).filter(rel => rel !== PROVENANCE).map(rel => [rel, hashFile(path.join(root, rel))]));
}

function distributionBytes(file) {
  const bytes = fs.readFileSync(file);
  return bytes.includes(0) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'));
}

function assertMirror(sourceRoot, sourceRel, destinationRel) {
  const source = path.join(sourceRoot, sourceRel);
  const destination = path.join(OUT, destinationRel);
  const sourceFiles = fs.statSync(source).isDirectory()
    ? listFiles(source).filter(rel => !rel.split('/').includes('__pycache__') && !rel.endsWith('/.DS_Store') && !/\.py[co]$/i.test(rel))
    : [''];
  const destinationFiles = fs.statSync(destination).isDirectory() ? listFiles(destination) : [''];
  if (JSON.stringify(sourceFiles) !== JSON.stringify(destinationFiles)) {
    throw new Error(`Codex pack source file set drifts from ${sourceRel}`);
  }
  for (const rel of sourceFiles) {
    const original = distributionBytes(path.join(source, rel));
    const packed = fs.readFileSync(path.join(destination, rel));
    if (!original.equals(packed)) {
      throw new Error(`Codex pack source bytes drift: ${sourceRel}${rel ? `/${rel}` : ''}`);
    }
  }
}

function pythonLauncher() {
  return `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\nimport { spawnSync } from 'node:child_process';\n\nconst [script, ...args] = process.argv.slice(2);\nif (!script) { console.error('python-launcher: script path required'); process.exit(2); }\nconst candidates = process.platform === 'win32'\n  ? [\n      process.env.PYTHON,\n      path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),\n      'python.exe',\n      'python3.exe'\n    ]\n  : [process.env.PYTHON, 'python3', 'python'];\nfor (const candidate of candidates.filter(Boolean)) {\n  if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;\n  const result = spawnSync(candidate, [script, ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env });\n  if (!result.error) process.exit(result.status ?? 1);\n  if (result.error.code !== 'ENOENT') { console.error(result.error.message); process.exit(1); }\n}\nconsole.error('python-launcher: no compatible Python runtime found');\nprocess.exit(127);\n`;
}

function writeJson(rel, value) {
  const destination = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function build() {
  const pins = readPins(ROOT);
  ensureSelfProductPin(pins);
  const products = Object.fromEntries(pins.products.map(product => [product.name, product]));
  const peopleRoot = path.resolve(arg('--people-finder') || process.env.PEOPLE_FINDER_SOURCE || '');
  const contactRoot = path.resolve(arg('--contact-brief') || process.env.CONTACT_BRIEF_SOURCE || '');
  if (!arg('--people-finder') && !process.env.PEOPLE_FINDER_SOURCE) throw new Error('--people-finder or PEOPLE_FINDER_SOURCE is required');
  if (!arg('--contact-brief') && !process.env.CONTACT_BRIEF_SOURCE) throw new Error('--contact-brief or CONTACT_BRIEF_SOURCE is required');
  ensurePinned(peopleRoot, products['people-finder']);
  ensurePinned(contactRoot, products['contact-brief']);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // JobSSS canonical runtime and skill.
  copyTree(ROOT, 'bin', OUT, path.join('products', 'jobsss', 'bin'));
  copyTree(ROOT, 'src', OUT, path.join('products', 'jobsss', 'src'));
  copyFile(ROOT, 'plugin.json', OUT, path.join('products', 'jobsss', 'plugin.json'));
  copyTree(ROOT, path.join('skills', 'jobsss'), OUT, path.join('skills', 'jobsss'));

  // people-finder exact pinned runtime and skill.
  copyTree(peopleRoot, 'bin', OUT, path.join('products', 'people-finder', 'bin'));
  copyTree(peopleRoot, 'src', OUT, path.join('products', 'people-finder', 'src'));
  copyTree(peopleRoot, path.join('skills', 'people-finder'), OUT, path.join('skills', 'people-finder'));

  // contact-brief is a compiler skill, not an MCP server. Keep its support
  // files beside SKILL.md so every documented relative path resolves.
  const contactSkill = path.join('skills', 'contact-brief');
  copyFile(contactRoot, path.join('skills', 'contact-brief', 'SKILL.md'), OUT, path.join(contactSkill, 'SKILL.md'));
  for (const dir of ['scripts', 'references', 'examples']) copyTree(contactRoot, dir, OUT, path.join(contactSkill, dir));
  for (const file of ['README.md', 'requirements.txt', 'routes.json', 'LICENSE']) {
    if (fs.existsSync(path.join(contactRoot, file))) copyFile(contactRoot, file, OUT, path.join(contactSkill, file));
  }

  fs.mkdirSync(path.join(OUT, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'scripts', 'python-launcher.mjs'), pythonLauncher());

  // Codex keys its cache by plugin version. Include every mirrored byte so a
  // canonical runtime hot-fix cannot be hidden behind a stale cache entry.
  const cachebuster = crypto.createHash('sha256').update(JSON.stringify({
    adapterSourceHash: ADAPTER_SOURCE_HASH,
    pins,
    files: inventory(OUT),
  })).digest('hex').slice(0, 12);

  writeJson(path.join('.codex-plugin', 'plugin.json'), {
    name: 'job-search-stack',
    version: `${pins.surfaceVersion}+codex.${cachebuster}`,
    description: 'Pinned Codex pack for JobSSS, people-finder, and contact-brief.',
    author: { name: 'Logani Paguh Bangun' },
    license: 'MIT',
    skills: './skills/',
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'JobSSS Career Operations',
      shortDescription: 'Local-first job search, resume, and contact research workflows.',
      longDescription: 'A pinned portable pack for evidence-grounded job discovery, tailored resumes, people research, and contact briefs.',
      developerName: 'Logani Paguh Bangun',
      category: 'Productivity',
      capabilities: ['Interactive', 'Write'],
      defaultPrompt: [
        'Create a local job-search profile from my resume.',
        'Find a suitable role and prepare a tailored resume.',
        'Research relevant contacts and draft unsent outreach.'
      ]
    }
  });
  writeJson('.mcp.json', {
    mcpServers: {
      jobsss: {
        command: 'node',
        // Legacy Codex .mcp.json does not interpolate ${PLUGIN_DATA} inside
        // args. The host still exports PLUGIN_DATA to the server process and
        // JobSSS reads it natively when --data is omitted.
        args: ['./products/jobsss/bin/jobsss', 'mcp'],
        cwd: '.',
        env_vars: ['PLUGIN_DATA', 'PATH', 'USERPROFILE', 'LOCALAPPDATA'],
        startup_timeout_sec: 30
      },
      'people-finder': {
        command: 'node',
        args: ['./scripts/python-launcher.mjs', './products/people-finder/bin/people-finder', 'mcp'],
        cwd: '.',
        env_vars: ['PATH', 'USERPROFILE', 'LOCALAPPDATA'],
        startup_timeout_sec: 30
      }
    }
  });

  writeJson(PROVENANCE, {
    schemaVersion: 1,
    generatedAt: 'deterministic',
    products: pins.products,
    adapter: {
      purpose: 'Codex Windows launch compatibility and three-product composition',
      businessLogic: false,
      sourceSha256: ADAPTER_SOURCE_HASH,
      pythonResolution: 'PATH first; Codex bundled dependency fallback on Windows',
      cachebuster
    },
    files: inventory(OUT)
  });
  return { files: Object.keys(inventory(OUT)).length, out: OUT };
}

function check() {
  const provenancePath = path.join(OUT, PROVENANCE);
  if (!fs.existsSync(provenancePath)) throw new Error(`missing ${path.relative(ROOT, provenancePath)}`);
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const pins = readPins(ROOT);
  ensureSelfProductPin(pins);
  if (JSON.stringify(provenance.products) !== JSON.stringify(pins.products)) throw new Error('Codex pack provenance does not match install pins');
  if (provenance.adapter?.sourceSha256 !== ADAPTER_SOURCE_HASH) throw new Error('Codex pack adapter source drift');
  const actual = inventory(OUT);
  if (JSON.stringify(actual) !== JSON.stringify(provenance.files)) throw new Error('Codex pack file inventory drift');
  // An inventory can agree with itself while canonical source has changed.
  // Always compare the current JobSSS product; compare siblings when their
  // checked-out sources are supplied to this release gate.
  for (const [source, packed] of [
    ['bin', 'products/jobsss/bin'],
    ['src', 'products/jobsss/src'],
    ['plugin.json', 'products/jobsss/plugin.json'],
    ['skills/jobsss', 'skills/jobsss']
  ]) assertMirror(ROOT, source, packed);
  const peopleRoot = arg('--people-finder') || process.env.PEOPLE_FINDER_SOURCE;
  const contactRoot = arg('--contact-brief') || process.env.CONTACT_BRIEF_SOURCE;
  if (Boolean(peopleRoot) !== Boolean(contactRoot)) {
    throw new Error('provide both people-finder and contact-brief sources for the full source check');
  }
  if (peopleRoot && contactRoot) {
    const products = Object.fromEntries(pins.products.map(product => [product.name, product]));
    ensurePinned(path.resolve(peopleRoot), products['people-finder']);
    ensurePinned(path.resolve(contactRoot), products['contact-brief']);
    for (const [source, packed] of [
      ['bin', 'products/people-finder/bin'],
      ['src', 'products/people-finder/src'],
      ['skills/people-finder', 'skills/people-finder']
    ]) assertMirror(path.resolve(peopleRoot), source, packed);
    for (const [source, packed] of [
      ['skills/contact-brief/SKILL.md', 'skills/contact-brief/SKILL.md'],
      ['scripts', 'skills/contact-brief/scripts'],
      ['references', 'skills/contact-brief/references'],
      ['examples', 'skills/contact-brief/examples'],
      ['README.md', 'skills/contact-brief/README.md'],
      ['requirements.txt', 'skills/contact-brief/requirements.txt'],
      ['routes.json', 'skills/contact-brief/routes.json'],
      ['LICENSE', 'skills/contact-brief/LICENSE']
    ]) {
      assertMirror(path.resolve(contactRoot), source, packed);
    }
  }
  return { files: Object.keys(actual).length, out: OUT };
}

const result = process.argv.includes('--check') ? check() : build();
console.log(`codex-pack: ${process.argv.includes('--check') ? 'verified' : 'wrote'} ${result.files} files at ${path.relative(ROOT, result.out)}`);
