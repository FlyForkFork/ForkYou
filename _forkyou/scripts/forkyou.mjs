#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE, REPO_ROOT, TEMPLATES_DIR, loadConfig, parseArgs, bool,
  readJson, writeJson, readText, writeText, ensureDir, nowIso, shortSha,
  walkFiles, formatBytes, dirSize, getToken
} from './lib/util.mjs';
import {
  getAuthenticatedUser, getRepo, listOrgForks, forkInfo, enablePages, getPages, getRateLimit
} from './lib/github.mjs';
import {
  cloneOrFetch, listRemoteBranches, remoteBranchSha, ensureLocalBranches,
  prepareSnapshot, ensureIdentity, commitPaths, repoStatus
} from './lib/git.mjs';
import {
  loadManifest, saveManifest, projectId, classify, upsertProject, findByName,
  projectPath, validateProjectDir, statusCounts
} from './lib/manifest.mjs';
import { renderGuide, renderProjectReadme, renderRootReadme } from './lib/render.mjs';

const CACHE = path.join(WORKSPACE, '_cache');
const WORK = path.join(CACHE, 'work');
const PREVIEW = path.join(CACHE, 'preview');
const SNAPSHOTS = path.join(CACHE, 'snapshots');

function out(s = '') { console.log(s); }
function err(s = '') { console.error(s); }

function usage() {
  out(`ForkYou CLI
  node ForkYou/_forkyou/scripts/forkyou.mjs doctor
  node ForkYou/_forkyou/scripts/forkyou.mjs sync [--only a,b] [--limit N] [--dry-run] [--force] [--depth L1|L2|L3] [--length lite|default|deep|N]
  node ForkYou/_forkyou/scripts/forkyou.mjs analyze <repo...> [--dry-run] [--force] [--depth ...] [--length ...]
  node ForkYou/_forkyou/scripts/forkyou.mjs refresh <repo...> [--all] [--dry-run] [--force]
  node ForkYou/_forkyou/scripts/forkyou.mjs rebuild --all [--dry-run] [--force]
  node ForkYou/_forkyou/scripts/forkyou.mjs list [--status new|prepared|analyzed|failed]
  node ForkYou/_forkyou/scripts/forkyou.mjs validate --project <repo> [--preview]
  node ForkYou/_forkyou/scripts/forkyou.mjs render-guide <guide.data.json> <guide.html>
  node ForkYou/_forkyou/scripts/forkyou.mjs publish --scaffold | --project <repo> | --all [--dry-run]
  node ForkYou/_forkyou/scripts/forkyou.mjs pages --enable|--status
  node ForkYou/_forkyou/scripts/forkyou.mjs cache gc [--dry-run]`);
}

function projectFromFork(fork, config, opts = {}) {
  const category = opts.category || classify(fork, config);
  return {
    id: projectId(fork.provider, fork.upstream),
    name: fork.forkName,
    provider: fork.provider,
    upstream: fork.upstream,
    fork: fork.fork,
    upstream_url: `https://github.com/${fork.upstream}`,
    homepage: fork.homepage || '',
    description: fork.description || '',
    one_liner: fork.description || '',
    category,
    path: `${category}/${fork.forkName}`,
    depth: opts.depth || config.analysis.default_depth || 'L2',
    length: String(opts.length || config.analysis.default_length || 'default'),
    license: fork.license,
    language: fork.language,
    stars: fork.stars,
    topics: fork.topics,
    default_branch: fork.defaultBranch,
    status: 'prepared',
    updated_at: nowIso()
  };
}

function cloneUrl(project, config) {
  const proto = config.provider.protocol || 'ssh';
  if (proto === 'ssh') return `git@github.com:${project.upstream}.git`;
  return `https://github.com/${project.upstream}.git`;
}

function cloneDir(project) {
  return path.join(WORKSPACE, project.name);
}

function snapshotDir(project) {
  const [owner, repo] = project.upstream.split('/');
  return path.join(SNAPSHOTS, project.provider, owner, repo);
}

function workOrderPath(project, preview) {
  return path.join(preview ? PREVIEW : WORK, project.name, 'work.json');
}

function outputDir(project, preview) {
  return preview ? path.join(PREVIEW, project.name) : path.join(REPO_ROOT, project.path);
}

function metaSeed(project, snapshot) {
  const main = snapshot.branches.find(b => b.default) || snapshot.branches[0];
  return {
    id: project.id,
    name: project.name,
    provider: project.provider,
    upstream: project.upstream,
    fork: project.fork,
    upstream_url: project.upstream_url,
    homepage: project.homepage || '',
    description: project.description || '',
    one_liner: project.one_liner || project.description || '',
    category: project.category,
    path: project.path,
    depth: project.depth,
    length: project.length,
    license: project.license || 'NOASSERTION',
    language: project.language || '',
    stars: project.stars || 0,
    analyzed_commit: main.sha,
    analyzed_at: nowIso(),
    branches: snapshot.branches.map(b => ({
      name: b.name, sha: b.sha, default: b.default, ahead: b.ahead, behind: b.behind, diffstat: b.diffstat
    })),
    docs: [
      'README.md', '01-positioning.md', '02-architecture.md', '03-code-tour.md',
      '04-deep-dive-routing.md', '04-deep-dive-network.md',
      '05-performance.md', '06-branches.md', '07-contribute.md', '08-takeaways.md', '09-ops.md'
    ],
    guide: 'guide.html'
  };
}

async function prepareOne(project, opts) {
  const config = loadConfig();
  const repoDir = cloneDir(project);
  out(`[clone] ${project.upstream} -> ${repoDir}`);
  cloneOrFetch(cloneUrl(project, config), repoDir, {
    full: bool(opts.full),
    depth: Number(opts.depth_clone || config.analysis.clone_depth || 1)
  });
  const branches = listRemoteBranches(repoDir);
  ensureLocalBranches(repoDir, branches);
  const snap = prepareSnapshot({
    provider: project.provider,
    upstream: project.upstream,
    cloneDir: repoDir,
    snapshotRoot: snapshotDir(project),
    defaultBranch: project.default_branch,
    maxBranches: Number(config.analysis.max_branches || 20)
  });
  const preview = bool(opts['dry-run']) || bool(opts.preview);
  const dir = outputDir(project, preview);
  ensureDir(dir);
  const order = {
    version: 1,
    created_at: nowIso(),
    preview,
    project,
    clone_dir: repoDir,
    snapshot_dir: snapshotDir(project),
    snapshot_file: path.join(snapshotDir(project), 'snapshot.json'),
    output_dir: dir,
    rules: path.join(REPO_ROOT, '_forkyou', 'RULES.md'),
    skill: path.join(REPO_ROOT, '_forkyou', 'SKILL.md'),
    templates: TEMPLATES_DIR,
    meta_seed: metaSeed(project, snap),
    branches: snap.branches.map(b => ({
      name: b.name, sha: b.sha, default: b.default, ahead: b.ahead, behind: b.behind,
      files: b.files, diffstat: b.diffstat,
      changed_files_total: b.changed_files_total, changed_files: b.changed_files,
      commits: b.commits
    })),
    length: project.length,
    depth: project.depth
  };
  writeJson(workOrderPath(project, preview), order);
  out(`[work] ${path.relative(WORKSPACE, workOrderPath(project, preview))}`);
  out(`[snapshot] ${snap.branches.length} branch(es), default=${snap.default_branch}`);
  return { order, snap, repoDir, dir, preview };
}

function updateProjectFromPrepare(project, snap, preview) {
  if (preview) return;
  const manifest = loadManifest();
  const p = manifest.projects[project.id];
  if (!p) return;
  p.status = 'prepared';
  p.branches = snap.branches.map(b => ({ name: b.name, sha: b.sha, default: b.default, diffstat: b.diffstat }));
  p.default_branch = snap.default_branch;
  p.prepared_at = nowIso();
  saveManifest(manifest);
}

async function doctor() {
  const config = loadConfig();
  const checks = [];
  const node = process.version;
  checks.push(['node', node, true]);
  const token = getToken();
  checks.push(['token', token ? `${token.slice(0, 7)}… (${token.length} chars)` : 'missing', Boolean(token)]);
  let me = null;
  try { me = await getAuthenticatedUser(); checks.push(['github user', me.login, true]); }
  catch (e) { checks.push(['github user', e.message, false]); }
  try {
    const repo = await getRepo(`${config.provider.org}/${config.provider.content_repo}`);
    checks.push(['content repo', `${repo.full_name} (${repo.private ? 'private' : 'public'}, default ${repo.default_branch})`, true]);
  } catch (e) { checks.push(['content repo', e.message, false]); }
  try {
    const r = await getRateLimit();
    checks.push(['rate limit', `${r.resources.core.remaining}/${r.resources.core.limit}`, true]);
  } catch (e) { checks.push(['rate limit', e.message, false]); }
  try {
    const g = await import('./lib/git.mjs').then(m => m.git(['--version'], WORKSPACE, { allowFail: true }));
    checks.push(['git', g.stdout.trim() || g.stderr.trim(), g.status === 0]);
  } catch (e) { checks.push(['git', e.message, false]); }
  try {
    const ssh = await import('./lib/util.mjs').then(m => m.runCommand('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'git@github.com'], { allowFail: true, timeoutMs: 20000 }));
    const msg = (ssh.stderr || ssh.stdout).trim();
    checks.push(['ssh github', msg.includes('successfully authenticated') ? msg.split('\n')[0] : msg.slice(0, 160), msg.includes('successfully authenticated')]);
  } catch (e) { checks.push(['ssh github', e.message, false]); }
  out('ForkYou doctor');
  out('--------------');
  for (const [k, v, ok] of checks) out(`${ok ? 'OK  ' : 'FAIL'} ${k.padEnd(14)} ${v}`);
  out('');
  out(`workspace: ${WORKSPACE}`);
  out(`repo:      ${REPO_ROOT}`);
  out(`cache:     ${CACHE}`);
  const hard = checks.filter(c => !c[2] && ['token', 'content repo', 'git'].includes(c[0]));
  if (hard.length) process.exitCode = 1;
}

async function sync(opts) {
  const config = loadConfig();
  const manifest = loadManifest();
  const only = opts.only ? String(opts.only).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
  const forks = await listOrgForks(config.provider.org);
  const exclude = new Set((config.provider.exclude || []).map(s => s.toLowerCase()));
  let candidates = forks.filter(f => !exclude.has(f.name.toLowerCase()));
  if (only) {
    candidates = candidates.filter(f => only.includes(f.name.toLowerCase()) || only.includes(String(f.parent?.name || '').toLowerCase()));
    const found = new Set(candidates.map(f => f.name.toLowerCase()));
    const missing = only.filter(n => !found.has(n));
    if (missing.length) throw new Error(`fork not found under ${config.provider.org}: ${missing.join(', ')}`);
  }
  if (opts.limit) candidates = candidates.slice(0, Number(opts.limit));
  const newOnes = candidates.filter(f => {
    const info = forkInfo(f);
    if (!info.upstream) return false;
    const existing = manifest.projects[projectId(info.provider, info.upstream)];
    return !existing || bool(opts.force) || existing.status !== 'analyzed';
  });
  if (!newOnes.length) { out('No new forks.'); return; }
  out(`Found ${newOnes.length} new fork(s): ${newOnes.map(f => f.name).join(', ')}`);
  if (bool(opts['dry-run'])) {
    for (const f of newOnes) {
      const info = forkInfo(f);
      out(`  ${info.forkName} -> ${info.upstream}  [${classify(info, config)}]`);
    }
    return;
  }
  for (const f of newOnes) {
    const info = forkInfo(f);
    if (!info.upstream) { err(`skip ${info.forkName}: parent repository is not visible`); continue; }
    const project = projectFromFork(info, config, opts);
    const existing = manifest.projects[project.id];
    if (existing) Object.assign(project, { status: existing.status, analyzed_at: existing.analyzed_at, analyzed_commit: existing.analyzed_commit });
    upsertProject(manifest, project);
    saveManifest(manifest);
    try {
      const { snap, preview } = await prepareOne(project, opts);
      updateProjectFromPrepare(project, snap, preview);
      out(`  ready: ${project.name} (${project.depth}/${project.length})`);
    } catch (e) {
      manifest.projects[project.id].status = 'failed';
      manifest.projects[project.id].error = e.message;
      saveManifest(manifest);
      err(`  FAILED ${project.name}: ${e.message}`);
      if (!bool(opts.keepGoing)) throw e;
    }
  }
}

function ensureProject(name, config) {
  const manifest = loadManifest();
  let p = findByName(manifest, name);
  if (p) return { project: p, manifest };
  throw new Error(`project not in manifest: ${name}. Run sync first, or use "analyze ${name}" after the fork exists.`);
}

async function analyze(opts) {
  const config = loadConfig();
  const names = opts._.length ? opts._ : (opts.project ? [opts.project] : []);
  if (!names.length) throw new Error('analyze needs one or more repo names');
  const manifest = loadManifest();
  for (const name of names) {
    let project = findByName(manifest, name);
    if (!project) {
      const fork = await getRepo(`${config.provider.org}/${name}`);
      const info = forkInfo(fork);
      if (!info.upstream) throw new Error(`${name} is not a fork with a visible parent`);
      project = projectFromFork(info, config, opts);
      upsertProject(manifest, project);
      saveManifest(manifest);
    }
    if (opts.depth) project.depth = opts.depth;
    if (opts.length) project.length = String(opts.length);
    project.path = projectPath(project);
    const preview = bool(opts['dry-run']) || bool(opts.preview);
    const { snap } = await prepareOne(project, opts);
    updateProjectFromPrepare(project, snap, preview);
    out(`  output: ${path.relative(WORKSPACE, outputDir(project, preview))}`);
  }
}

async function refresh(opts) {
  const config = loadConfig();
  const manifest = loadManifest();
  let names = opts._.length ? opts._ : [];
  if (bool(opts.all) || bool(opts['--all'])) names = Object.values(manifest.projects).map(p => p.name);
  if (!names.length) throw new Error('refresh needs repo names or --all');
  for (const name of names) {
    const p = findByName(manifest, name);
    if (!p) { err(`skip ${name}: not in manifest`); continue; }
    const repoDir = cloneDir(p);
    out(`[fetch] ${p.upstream}`);
    cloneOrFetch(cloneUrl(p, config), repoDir, { full: bool(opts.full) });
    const sha = remoteBranchSha(repoDir, p.default_branch || 'main');
    if (!bool(opts.force) && p.analyzed_commit === sha) {
      out(`  unchanged (${shortSha(sha)})`);
      continue;
    }
    p.depth = opts.depth || p.depth;
    p.length = String(opts.length || p.length || 'default');
    const { snap } = await prepareOne(p, opts);
    updateProjectFromPrepare(p, snap, bool(opts['dry-run']));
    out(`  refreshed: ${p.name} ${shortSha(sha)}`);
  }
}

async function rebuild(opts) {
  const manifest = loadManifest();
  const names = bool(opts.all) ? Object.values(manifest.projects).map(p => p.name) : opts._;
  if (!names.length) throw new Error('rebuild needs --all or repo names');
  for (const name of names) {
    const p = findByName(manifest, name);
    if (!p) { err(`skip ${name}: not in manifest`); continue; }
    const project = { ...p, path: projectPath(p) };
    const { snap } = await prepareOne(project, opts);
    updateProjectFromPrepare(project, snap, bool(opts['dry-run']));
    out(`  rebuilt: ${project.name}`);
  }
}

function list(opts) {
  const manifest = loadManifest();
  const rows = Object.values(manifest.projects)
    .filter(p => !opts.status || p.status === opts.status)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (!rows.length) { out('No projects.'); return; }
  out('NAME'.padEnd(22) + 'STATUS'.padEnd(12) + 'CATEGORY'.padEnd(14) + 'DEPTH'.padEnd(7) + 'COMMIT'.padEnd(10) + 'UPDATED');
  for (const p of rows) {
    out(String(p.name).padEnd(22) + String(p.status).padEnd(12) + String(p.category).padEnd(14) + String(p.depth || '').padEnd(7) + shortSha(p.analyzed_commit).padEnd(10) + String(p.updated_at || '').slice(0, 10));
  }
  out('');
  out(JSON.stringify(statusCounts(manifest)));
}

function validate(opts) {
  const config = loadConfig();
  let dir;
  if (opts.project) {
    const manifest = loadManifest();
    const p = findByName(manifest, opts.project);
    if (!p) throw new Error(`project not found: ${opts.project}`);
    dir = bool(opts.preview) ? path.join(PREVIEW, p.name) : path.join(REPO_ROOT, p.path);
  } else if (opts._[0]) {
    dir = path.resolve(opts._[0]);
  } else {
    throw new Error('validate needs --project <repo> or a directory');
  }
  const meta = readJson(path.join(dir, 'meta.json'));
  const r = validateProjectDir(dir, { depth: meta?.depth || 'L2' });
  out(`validate ${dir}`);
  if (r.errors.length) { r.errors.forEach(e => out(`ERROR ${e}`)); }
  if (r.warnings.length) { r.warnings.forEach(w => out(`WARN  ${w}`)); }
  if (!r.errors.length) out(`OK (${r.warnings.length} warning(s))`);
  if (r.errors.length) process.exitCode = 1;
}

function renderGuideCmd(opts) {
  const [dataFile, outFile] = opts._;
  if (!dataFile || !outFile) throw new Error('render-guide <guide.data.json> <guide.html>');
  const data = readJson(dataFile);
  if (!data) throw new Error(`invalid JSON: ${dataFile}`);
  const meta = readJson(path.join(path.dirname(dataFile), 'meta.json')) || {};
  const html = renderGuide(path.join(TEMPLATES_DIR, 'guide.template.html'), data, meta);
  writeText(outFile, html);
  out(`rendered ${outFile} (${html.length} chars)`);
}

function collectProjectFiles(project) {
  const dir = path.join(REPO_ROOT, project.path);
  if (!fs.existsSync(dir)) throw new Error(`missing project dir: ${dir}`);
  return walkFiles(dir).map(f => path.join(project.path, f).replace(/\\/g, '/'));
}

function syncMetaFromProject(project) {
  const dir = path.join(REPO_ROOT, project.path);
  const meta = readJson(path.join(dir, 'meta.json'));
  if (meta) {
    Object.assign(project, {
      one_liner: meta.one_liner || project.one_liner,
      homepage: meta.homepage ?? project.homepage,
      license: meta.license || project.license,
      language: meta.language || project.language,
      stars: meta.stars ?? project.stars,
      depth: meta.depth || project.depth,
      analyzed_commit: meta.analyzed_commit || project.analyzed_commit,
      analyzed_at: meta.analyzed_at || project.analyzed_at,
      docs: meta.docs || project.docs,
      guide: meta.guide || 'guide.html'
    });
  }
  project.status = 'analyzed';
  project.analyzed_at = project.analyzed_at || nowIso();
  project.updated_at = nowIso();
}

function renderRoot() {
  const config = loadConfig();
  const manifest = loadManifest();
  const readmePath = path.join(REPO_ROOT, 'README.md');
  const existing = readText(readmePath);
  writeText(readmePath, renderRootReadme(existing, manifest, config));
  return manifest;
}

async function publish(opts) {
  const config = loadConfig();
  const manifest = loadManifest();
  ensureIdentity(REPO_ROOT, config.publish.author_name, config.publish.author_email);
  const dry = bool(opts['dry-run']);
  const paths = new Set(['_forkyou', 'README.md', '.gitignore']);
  let message = 'chore: update ForkYou scaffold';
  if (bool(opts.scaffold)) {
    out('publishing scaffold');
  } else {
    let projects = [];
    if (bool(opts.all)) projects = Object.values(manifest.projects).filter(p => p.status === 'analyzed');
    else if (opts.project) {
      const p = findByName(manifest, opts.project);
      if (!p) throw new Error(`project not found: ${opts.project}`);
      projects = [p];
    } else {
      throw new Error('publish needs --scaffold, --project <repo>, or --all');
    }
    if (!projects.length) throw new Error('no analyzed projects to publish');
    for (const p of projects) {
      syncMetaFromProject(p);
      for (const f of collectProjectFiles(p)) paths.add(f);
    }
    saveManifest(manifest);
    message = `docs: add ${projects.map(p => p.name).join(', ')} analysis`;
  }
  if (!bool(opts.scaffold)) renderRoot();
  // Render the root README after meta sync as well.
  const finalManifest = loadManifest();
  writeText(path.join(REPO_ROOT, 'README.md'), renderRootReadme(readText(path.join(REPO_ROOT, 'README.md')), finalManifest, config));
  out(`files: ${paths.size}`);
  const res = commitPaths(REPO_ROOT, [...paths], message, { dryRun: dry });
  out(JSON.stringify(res));
  if (!dry && res.changed) out('pushed to origin');
}

async function pagesCmd(opts) {
  const config = loadConfig();
  const owner = config.provider.org;
  const repo = config.provider.content_repo;
  if (bool(opts.status)) {
    const p = await getPages(owner, repo);
    out(p ? JSON.stringify(p, null, 2) : 'Pages not enabled');
    return;
  }
  if (bool(opts.enable)) {
    const p = await enablePages(owner, repo, config.publish.branch || 'main');
    config.pages.enabled = true;
    config.pages.base_url = p.html_url || `https://${owner}.github.io/${repo}`;
    writeJson(path.join(REPO_ROOT, '_forkyou', 'config.json'), config);
    out(`Pages: ${config.pages.base_url}`);
    return;
  }
  throw new Error('pages needs --enable or --status');
}

function cacheGc(opts) {
  const snapshots = path.join(CACHE, 'snapshots');
  let removed = 0;
  if (fs.existsSync(snapshots)) {
    for (const provider of fs.readdirSync(snapshots)) {
      const pdir = path.join(snapshots, provider);
      for (const owner of fs.readdirSync(pdir)) {
        const odir = path.join(pdir, owner);
        for (const repo of fs.readdirSync(odir)) {
          const rdir = path.join(odir, repo);
          const snapFile = path.join(rdir, 'snapshot.json');
          const snap = fs.existsSync(snapFile) ? readJson(snapFile) : null;
          // One snapshot set per repo: keep every branch referenced by snapshot.json.
          const keep = new Set((snap?.branches || []).map(b => b.safe_name).filter(Boolean));
          for (const e of fs.readdirSync(rdir, { withFileTypes: true })) {
            if (!e.isDirectory() || keep.has(e.name)) continue;
            const target = path.join(rdir, e.name);
            out(`remove ${path.relative(WORKSPACE, target)}`);
            if (!bool(opts['dry-run'])) { fs.rmSync(target, { recursive: true, force: true }); removed += 1; }
          }
        }
      }
    }
  }
  out(`cache gc: ${removed} removed${bool(opts['dry-run']) ? ' (dry-run)' : ''}`);
}

async function main() {
  const cmd = process.argv[2];
  const opts = parseArgs(process.argv.slice(3));
  switch (cmd) {
    case 'doctor': return doctor(opts);
    case 'sync': return sync(opts);
    case 'analyze': return analyze(opts);
    case 'refresh': return refresh(opts);
    case 'rebuild': return rebuild(opts);
    case 'list': return list(opts);
    case 'validate': return validate(opts);
    case 'render-guide': return renderGuideCmd(opts);
    case 'publish': return publish(opts);
    case 'pages': return pagesCmd(opts);
    case 'cache': return cacheGc(opts);
    case undefined:
    case 'help':
    case '--help': return usage();
    default: usage(); throw new Error(`unknown command: ${cmd}`);
  }
}

main().catch(e => {
  err(`ERROR ${e.message}`);
  if (process.env.FORKYOU_DEBUG) err(e.stack);
  process.exitCode = 1;
});
