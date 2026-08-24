import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
export const PLUGIN_NAME = 'jobsss';
export const SKILL_NAME = 'jobsss';
export const MCP_SERVER_NAME = 'jobos';
export const MCP_COMMAND = 'jobos';
export const MCP_ARGS = Object.freeze(['mcp']);

export const BASE_INVOCATION = '/jobsss';

export const SUB_INTENTS = Object.freeze([
  'start',
  'daily',
  'find',
  'pursue',
  'pipeline',
  'materials',
  'network',
  'interview',
  'review',
  'sync',
  'config',
  'doctor'
]);

export const INTENT_ROUTES = Object.freeze({
  daily: Object.freeze(['daily_discovery']),
  find: Object.freeze(['list_saved_searches', 'search_jobs', 'list_jobs', 'import_job_url']),
  pursue: Object.freeze(['pursue_job']),
  pipeline: Object.freeze(['list_jobs', 'applications_plan', 'list_tasks', 'list_lifecycle_observations']),
  materials: Object.freeze(['tailor_resume', 'draft_cover_letter', 'review_queue', 'diff_artifact']),
  network: Object.freeze(['map_reachable_network', 'start_people_research', 'plan_outreach', 'draft_outreach']),
  interview: Object.freeze(['interview_prep', 'list_interview_stories', 'draft_interview_story']),
  review: Object.freeze(['review_queue', 'diff_artifact', 'weekly_review', 'lifecycle_analytics'])
});

export const INTENT_HANDOFFS = Object.freeze({
  start: Object.freeze(['no MCP init', 'trusted CLI/TUI', 'setup']),
  sync: Object.freeze(['SQLite is canonical', 'derived', 'no cloud sync']),
  config: Object.freeze(['no MCP config', 'trusted CLI/TUI']),
  doctor: Object.freeze(['MCP', 'missing'])
});

export const HUMAN_ONLY_DOMAIN_TOOLS = Object.freeze([
  'approve_artifact',
  'reject_artifact',
  'approve_contact',
  'answers_add',
  'create_application_packet',
  'attest_application_submitted',
  'confirm_application_receipt',
  'checkpoint_application_form',
  'verify_interview_story',
  'retire_interview_story',
  'add_interview_question_source',
  'record_interview_debrief',
  'correct_interview_debrief',
  'record_job_feedback',
  'correct_memory_observation',
  'undo_memory_observation',
  'accept_memory_proposal',
  'reject_memory_proposal',
  'revoke_memory_proposal',
  'undo_memory_transition',
  'network_contact_record',
  'mark_outreach_sent'
]);

export const REPRESENTATIVE_AGENT_TOOLS = Object.freeze([
  'score_job',
  'daily_discovery',
  'pursue_job'
]);

export const PLUGIN_RELATIVE_FILES = Object.freeze([
  'plugin.json',
  'mcp.json',
  'skills/jobsss/SKILL.md'
]);

const PLUGIN_MANIFEST_KEYS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions'
]);

const NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SKILL_NAME_RE = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function pluginPath(...parts) {
  return path.join(REPO_ROOT, ...parts);
}

export function missingMessage(rel) {
  return `missing required product file ${rel} — implement the portable JobSSS Agent Plugin at the repository root (do not put it only under plugins/ or a client tree)`;
}

export function readRequired(rel) {
  const abs = pluginPath(rel);
  if (!existsSync(abs)) {
    const error = new Error(missingMessage(rel));
    error.code = 'jobsss_missing_product';
    throw error;
  }
  const stat = lstatSync(abs);
  if (stat.isSymbolicLink()) {
    throw new Error(`${rel} is a symlink; package paths must resolve inside the plugin root`);
  }
  if (!stat.isFile()) {
    throw new Error(`${rel} exists but is not a regular file`);
  }
  return readFileSync(abs, 'utf8');
}

export function readRequiredJson(rel) {
  const text = readRequired(rel);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${rel} is not valid JSON: ${error.message}`);
  }
}

export function listDir(rel) {
  const abs = pluginPath(rel);
  if (!existsSync(abs)) return null;
  return readdirSync(abs, { withFileTypes: true });
}

export function walkPluginPackage() {
  const files = [];
  const roots = ['plugin.json', 'mcp.json', 'skills'];
  for (const rel of roots) {
    walk(pluginPath(rel), rel, files);
  }
  return files;
}

function walk(abs, rel, files) {
  if (!existsSync(abs)) return;
  const stat = lstatSync(abs);
  files.push({ abs, rel, stat });
  if (stat.isDirectory()) {
    for (const entry of readdirSync(abs)) {
      walk(path.join(abs, entry), path.join(rel, entry), files);
    }
  }
}

export function assertInsideRoot(abs, label) {
  const root = realpathSync(REPO_ROOT);
  let resolved;
  try {
    resolved = realpathSync(abs);
  } catch {
    resolved = path.resolve(abs);
  }
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`${label} resolves outside the plugin root: ${resolved}`);
  }
}

export function validatePluginManifest(manifest) {
  const problems = [];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['plugin.json must be a JSON object'];
  }
  if (manifest.$schema !== PLUGIN_SCHEMA) {
    problems.push(`plugin.json $schema must be ${PLUGIN_SCHEMA}`);
  }
  if (manifest.name !== PLUGIN_NAME) {
    problems.push(`plugin.json name must be "${PLUGIN_NAME}"`);
  } else if (typeof manifest.name === 'string' && (manifest.name.length > 64 || !NAME_RE.test(manifest.name))) {
    problems.push('plugin.json name fails Agent Plugins 1.0.0 character rules');
  }
  for (const key of Object.keys(manifest)) {
    if (!PLUGIN_MANIFEST_KEYS.has(key)) {
      problems.push(`plugin.json has unknown top-level field "${key}"`);
    }
  }
  if (manifest.version !== undefined && typeof manifest.version !== 'string') {
    problems.push('plugin.json version must be a string when present');
  }
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    problems.push('plugin.json description must be a string when present');
  }
  if (manifest.author !== undefined) {
    if (manifest.author === null || typeof manifest.author !== 'object' || Array.isArray(manifest.author)) {
      problems.push('plugin.json author must be an object when present');
    } else {
      for (const key of Object.keys(manifest.author)) {
        if (!['name', 'email', 'url'].includes(key) || typeof manifest.author[key] !== 'string') {
          problems.push(`plugin.json author.${key} is invalid`);
        }
      }
    }
  }
  if (manifest.keywords !== undefined) {
    if (!Array.isArray(manifest.keywords) || manifest.keywords.some(item => typeof item !== 'string')) {
      problems.push('plugin.json keywords must be an array of strings when present');
    }
  }
  if (manifest.extensions !== undefined) {
    if (manifest.extensions === null || typeof manifest.extensions !== 'object' || Array.isArray(manifest.extensions)) {
      problems.push('plugin.json extensions must be an object when present');
    } else if (Object.keys(manifest.extensions).length > 0) {
      problems.push('plugin.json extensions must be omitted or empty — client-specific packaging is out of scope');
    }
  }
  return problems;
}

export function validateMcpDocument(doc) {
  const problems = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['mcp.json must be a JSON object'];
  }
  if (doc.$schema !== MCP_SCHEMA) {
    problems.push(`mcp.json $schema must be ${MCP_SCHEMA}`);
  }
  for (const key of Object.keys(doc)) {
    if (key !== '$schema' && key !== 'mcpServers') {
      problems.push(`mcp.json has unknown top-level field "${key}"`);
    }
  }
  if (doc.mcpServers === null || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) {
    problems.push('mcp.json mcpServers must be an object');
    return problems;
  }
  const names = Object.keys(doc.mcpServers);
  if (names.length !== 1 || names[0] !== MCP_SERVER_NAME) {
    problems.push(`mcp.json must declare exactly one server named "${MCP_SERVER_NAME}"`);
  }
  const server = doc.mcpServers[MCP_SERVER_NAME];
  if (!server) return problems;
  if (server.type !== 'stdio') problems.push('jobos server type must be "stdio"');
  if (server.command !== MCP_COMMAND) {
    problems.push(`jobos server command must be the bare executable "${MCP_COMMAND}"`);
  }
  if (!Array.isArray(server.args) || server.args.length !== MCP_ARGS.length || server.args.some((value, i) => value !== MCP_ARGS[i])) {
    problems.push('jobos server args must be exactly ["mcp"]');
  }
  const extra = Object.keys(server).filter(key => !['type', 'command', 'args'].includes(key));
  if (extra.length) {
    problems.push(`jobos server has extra keys (${extra.join(', ')}); frozen contract forbids env/cwd/headers`);
  }
  return problems;
}

export function parseSkillMarkdown(text, rel = 'skills/jobsss/SKILL.md') {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    throw new Error(`${rel} must start with YAML frontmatter delimited by ---`);
  }
  const stripped = text.replace(/^---\r?\n/, '');
  const close = stripped.search(/\r?\n---(?:\r?\n|$)/);
  if (close < 0) throw new Error(`${rel} frontmatter is not closed by ---`);
  const yaml = stripped.slice(0, close);
  const body = stripped.slice(close).replace(/^\r?\n---(?:\r?\n|$)/, '');
  return { yaml, body, fields: parseSimpleYaml(yaml) };
}

function parseSimpleYaml(yaml) {
  const fields = {};
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const raw = match[2];
    if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      const block = [];
      i += 1;
      while (i < lines.length && (lines[i] === '' || /^\s+/.test(lines[i]))) {
        block.push(lines[i].replace(/^\s+/, ''));
        i += 1;
      }
      i -= 1;
      fields[key] = block.join('\n').trim();
      continue;
    }
    fields[key] = unquote(raw.trim());
  }
  return fields;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function validateSkillDocument(text, rel = 'skills/jobsss/SKILL.md') {
  const problems = [];
  const parsed = parseSkillMarkdown(text, rel);
  const name = parsed.fields.name;
  const description = parsed.fields.description;
  if (name !== SKILL_NAME) problems.push(`${rel} frontmatter name must be "${SKILL_NAME}"`);
  if (typeof name === 'string' && (name.length > 64 || !SKILL_NAME_RE.test(name))) {
    problems.push(`${rel} name fails Agent Skills character rules`);
  }
  if (typeof description !== 'string' || description.length < 1 || description.length > 1024) {
    problems.push(`${rel} description must be 1–1024 characters`);
  }
  if (!String(parsed.body || '').trim()) {
    problems.push(`${rel} must have a non-empty Markdown body after frontmatter`);
  }
  return { problems, parsed };
}

export function collectSkillCorpus() {
  const skillRel = 'skills/jobsss/SKILL.md';
  const skillText = readRequired(skillRel);
  const parts = [skillText];
  const refsDir = pluginPath('skills/jobsss/references');
  if (existsSync(refsDir) && lstatSync(refsDir).isDirectory()) {
    for (const entry of readdirSync(refsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      parts.push(readFileSync(path.join(refsDir, entry.name), 'utf8'));
    }
  }
  return parts.join('\n\n');
}

export function secretFindings(text, rel) {
  const findings = [];
  const patterns = [
    [/\b(api[_-]?key|secret|password|token|private[_-]?key)\s*[:=]\s*['\"]?[^\'\"\s]{8,}/i, 'credential-like assignment'],
    [/\bAuthorization\s*:\s*Bearer\s+\S+/i, 'Authorization bearer header'],
    [/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, 'private key material'],
    [/\bsk-[A-Za-z0-9]{16,}\b/, 'secret-looking token'],
    [/(?:^|[\s'"=])(?:\/home\/[A-Za-z0-9._-]+|~\/|(?:\$HOME|%USERPROFILE%)[\\/])/, 'user-home path'],
    [/\bJOBOS_HOME\s*=\s*\S+/, 'JOBOS_HOME assignment'],
    [/(?:^|[^\w./-])(?:\.jobos|jobos-workspace)(?:[\\/]|$)/, 'JobOS user-state path']
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) findings.push(`${rel}: ${label}`);
  }
  return findings;
}

export const IMPLEMENTATION_FINGERPRINTS = Object.freeze([
  [/\bsql\.js\b/, 'sql.js runtime'],
  [/\bbetter-sqlite3\b/, 'native sqlite binding'],
  [/CREATE TABLE\s+/i, 'SQL schema'],
  [/export\s+const\s+DOMAIN_TOOLS\b/, 'domain-tool registry'],
  [/export\s+const\s+HUMAN_ONLY_DOMAIN_TOOLS\b/, 'policy replica'],
  [/export\s+function\s+startMcp\b/, 'MCP server implementation'],
  [/export\s+(?:async\s+)?function\s+callDomainTool\b/, 'domain-tool dispatcher'],
  [/jobos\.sqlite/, 'JobOS sqlite file'],
  [/from\s+['"]\.\/domain-tools\.js['"]/, 'copied JobOS module import']
]);

export const FORBIDDEN_COPIED_MODULES = Object.freeze([
  'src/cli.js',
  'src/mcp.js',
  'src/domain-tools.js',
  'src/capabilities.js',
  'src/db.js'
]);

export const FORBIDDEN_CLIENT_TREES = Object.freeze([
  '.cursor',
  '.claude',
  '.omp',
  '.hermes',
  '.github'
]);
