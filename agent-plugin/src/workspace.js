// User workspace bootstrap. Generated runtime files are snapshots of this
// package; personal state lives beside them, never in the installed plugin.
import fs from 'node:fs';
import path from 'node:path';
import { start } from './domain.js';

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function resolvedDestination(target) {
  let ancestor = target;
  const tail = [];
  while (!fs.existsSync(ancestor)) {
    tail.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Cannot resolve workspace parent');
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...tail);
}

function copyPackage(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Workspace package must not contain symlinks');
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source).sort()) copyPackage(path.join(source, name), path.join(destination, name));
  } else if (stat.isFile()) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, stat.mode & 0o777);
  } else throw new Error('Workspace package must contain only regular files and directories');
}

export function initWorkspace(argv, { repoRoot, standalone = false, cwd = process.cwd() }) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: jobsss init [folder]\n\nCreates ./jobsss-workspace by default, with local data, a runtime snapshot,\nand project configuration for Codex and Claude Code. Existing nonempty folders\nare never overwritten. Agent trust and activation remain host-managed.');
    return;
  }
  if (argv.length > 1 || (argv[0] && argv[0].startsWith('-'))) throw new Error('Usage: jobsss init [folder]');
  if (standalone) throw new Error('Workspace setup requires the source/npm package, including its skill files. Use the npm or npx installation.');
  const root = fs.realpathSync(repoRoot);
  const target = path.resolve(cwd, argv[0] || 'jobsss-workspace');
  const resolved = resolvedDestination(target);
  if (inside(root, resolved)) throw new Error('Choose a workspace outside the installed plugin directory');
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isDirectory()) throw new Error('Workspace must be a plain directory');
    if (fs.readdirSync(target).length) throw new Error('Workspace folder is not empty; choose a new folder. No existing files were changed.');
  }
  // Check required input before creating the user folder.
  for (const rel of ['bin/jobsss', 'src', 'skills/jobsss/SKILL.md', 'package.json', 'plugin.json', 'mcp.json']) {
    if (!fs.existsSync(path.join(root, rel))) throw new Error(`Installed package is missing ${rel}`);
  }
  fs.mkdirSync(target, { recursive: true });
  const plugin = path.join(target, '.jobsss', 'plugin');
  const data = path.join(target, '.jobsss', 'data');
  fs.mkdirSync(plugin, { recursive: true });
  for (const rel of ['bin', 'src', 'skills', 'package.json', 'plugin.json', 'mcp.json', 'LICENSE', 'NOTICE']) {
    if (fs.existsSync(path.join(root, rel))) copyPackage(path.join(root, rel), path.join(plugin, rel));
  }
  const write = (rel, text) => {
    const destination = path.join(target, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text, { flag: 'wx', mode: 0o600 });
  };
  start(data);
  fs.mkdirSync(path.join(data, 'intake'), { recursive: true });
  for (const rel of ['.agents/skills/jobsss', '.claude/skills/jobsss']) {
    copyPackage(path.join(root, 'skills', 'jobsss'), path.join(target, rel));
  }
  const args = [path.join(plugin, 'bin', 'jobsss'), 'mcp', '--data', data];
  write('.mcp.json', `${JSON.stringify({ mcpServers: { jobsss: { command: 'node', args } } }, null, 2)}\n`);
  write('.codex/config.toml', `[mcp_servers.jobsss]\ncommand = "node"\nargs = ${JSON.stringify(args)}\n`);
  write('jobsss.mjs', `import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport { spawnSync } from 'node:child_process';\nconst root = path.dirname(fileURLToPath(import.meta.url));\nconst args = process.argv.slice(2);\nif (['doctor', 'start', 'mcp', 'decide'].includes(args[0]) && !args.some(a => a === '--data' || a.startsWith('--data='))) args.push('--data', path.join(root, '.jobsss', 'data'));\nconst result = spawnSync(process.execPath, [path.join(root, '.jobsss', 'plugin', 'bin', 'jobsss'), ...args], { stdio: 'inherit' });\nif (result.error) console.error(result.error.message);\nprocess.exit(result.status ?? 1);\n`);
  const instructions = '# JobSSS workspace\n\nUse the JobSSS skill and MCP tools to manage this job search.\nPersonal state is in `.jobsss/data/`; the runtime is in `.jobsss/plugin/`.\nStage resume and job files in `.jobsss/data/intake/`, or provide text in chat.\nThe agent must use the configured MCP data directory for this workspace.\nIf JobSSS tools are unavailable, explain the host setup instead of writing\nthe store directly or creating another data directory.\nReview decisions stay on the trusted local CLI (`node jobsss.mjs decide`).\nNever send outreach, submit applications, or invent resume claims.\n';
  write('AGENTS.md', instructions);
  write('CLAUDE.md', instructions);
  write('.gitignore', '.jobsss/\n.mcp.json\n.codex/config.toml\n');
  write('README.md', '# Your JobSSS workspace\n\nOpen Codex or Claude Code in this folder. Review the host trust prompts,\nthen start a fresh chat so the local skill and MCP server load.\nOther hosts can use `.jobsss/plugin/` and the MCP configuration in `.mcp.json`.\nProject configuration support depends on your host version.\n\nTry: “Use JobSSS to create my profile from this resume, compare this job,\nand suggest my next steps.”\n\n- Paste your resume/job description, or put files in `.jobsss/data/intake/`.\n- Profiles, jobs, documents, and tasks live in `.jobsss/data/`.\n- Back up that data folder; do not publish it.\n- The core JobSSS plugin is included; companion plugins are installed separately.\n- Node.js 22+ is needed; resume PDF export also needs local Chrome or Edge.\n\nCheck setup with `node jobsss.mjs doctor`.\nList human decisions with `node jobsss.mjs decide --list`.\n\nThis workspace includes a runtime snapshot and works without the original\nnpm/npx cache. Keep the folder at this location: the agent configuration\ncontains absolute paths. Moving it requires updating those paths.\n');
  console.log(`Created your JobSSS workspace: ${target}\n\nNext steps:\n  1. Open a terminal in that folder.\n  2. Run: node jobsss.mjs doctor\n  3. Open Codex or Claude Code here and review its trust prompts.\n  4. Start a new chat and ask JobSSS to create your profile.\n\nYour data: ${data}\nResume/job files: ${path.join(data, 'intake')}\nThe core plugin is ready locally; companion plugins are installed separately.`);
  return { workspace: target, dataDir: data, pluginRoot: plugin };
}
