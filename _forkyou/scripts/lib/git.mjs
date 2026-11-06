import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, runCommand, writeJson, nowIso, shortSha } from './util.mjs';

export function git(args, cwd, opts = {}) {
  return runCommand('git', args, {
    cwd,
    allowFail: opts.allowFail,
    timeoutMs: opts.timeoutMs || 0,
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=15',
      ...(opts.env || {})
    }
  });
}

export function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

export function cloneOrFetch(url, dest, opts = {}) {
  const depthArgs = opts.full ? [] : ['--depth', String(opts.depth || 1)];
  if (!fs.existsSync(dest) || !isGitRepo(dest)) {
    ensureDir(path.dirname(dest));
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    git(['clone', '--no-single-branch', ...depthArgs, url, dest], path.dirname(dest), { timeoutMs: opts.timeoutMs || 0 });
  } else {
    git(['remote', 'set-url', 'origin', url], dest, { allowFail: true });
    git(['fetch', '--all', '--prune', '--tags'], dest, { timeoutMs: opts.timeoutMs || 0 });
    if (opts.full) git(['fetch', '--unshallow'], dest, { allowFail: true });
    git(['remote', 'set-head', 'origin', '-a'], dest, { allowFail: true });
  }
  return dest;
}

export function listRemoteBranches(repoDir) {
  const r = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], repoDir);
  return r.stdout.split(/\r?\n/).map(s => s.trim())
    .filter(s => s && s !== 'origin' && s !== 'origin/HEAD')
    .map(s => s.replace(/^origin\//, ''))
    .filter(Boolean)
    .sort();
}

export function remoteBranchSha(repoDir, branch) {
  return git(['rev-parse', `origin/${branch}`], repoDir).stdout.trim();
}

export function ensureLocalBranches(repoDir, branches) {
  const existing = new Set(
    git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repoDir).stdout
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  );
  for (const b of branches) {
    if (existing.has(b)) continue;
    git(['branch', '--track', b, `origin/${b}`], repoDir, { allowFail: true });
  }
  // Move the default working tree forward without discarding local changes.
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir, { allowFail: true }).stdout.trim();
  if (current && current !== 'HEAD') {
    git(['merge', '--ff-only', `origin/${current}`], repoDir, { allowFail: true });
  }
}

function removeWorktree(repoDir, dir) {
  if (!fs.existsSync(dir)) return;
  git(['worktree', 'remove', '--force', dir], repoDir, { allowFail: true });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'prune'], repoDir, { allowFail: true });
}

export function prepareSnapshot({ provider, upstream, cloneDir, snapshotRoot, defaultBranch, maxBranches = 20 }) {
  ensureDir(snapshotRoot);
  const branches = listRemoteBranches(cloneDir);
  if (!branches.length) throw new Error(`No remote branches in ${cloneDir}`);
  const selected = branches.slice(0, Math.max(1, maxBranches));
  const info = {
    schema: 1,
    provider,
    upstream,
    fetched_at: nowIso(),
    clone_dir: cloneDir,
    default_branch: defaultBranch || branches[0],
    branches: [],
    branches_skipped: branches.slice(selected.length)
  };
  for (const branch of selected) {
    const safe = branch.replace(/[\\/]/g, '__');
    const dir = path.join(snapshotRoot, safe);
    removeWorktree(cloneDir, dir);
    git(['worktree', 'add', '--force', '--detach', dir, `origin/${branch}`], cloneDir);
    const sha = git(['rev-parse', 'HEAD'], dir).stdout.trim();
    const files = Number(git(['ls-tree', '-r', '--name-only', `origin/${branch}`], cloneDir).stdout.split(/\r?\n/).filter(Boolean).length);
    const entry = {
      name: branch,
      safe_name: safe,
      sha,
      short_sha: shortSha(sha),
      dir,
      files,
      default: branch === info.default_branch
    };
    if (!entry.default) {
      const counts = git(['rev-list', '--left-right', '--count', `origin/${info.default_branch}...origin/${branch}`], cloneDir).stdout.trim().split(/\s+/);
      entry.behind = Number(counts[0] || 0);
      entry.ahead = Number(counts[1] || 0);
      entry.diffstat = git(['diff', '--shortstat', `origin/${info.default_branch}..origin/${branch}`], cloneDir).stdout.trim();
      const changed = git(['diff', '--name-status', `origin/${info.default_branch}..origin/${branch}`], cloneDir).stdout
        .split(/\r?\n/).filter(Boolean);
      entry.changed_files_total = changed.length;
      entry.changed_files = changed.slice(0, 200);
      entry.commits = git(['log', '--oneline', '-10', `origin/${info.default_branch}..origin/${branch}`], cloneDir).stdout
        .split(/\r?\n/).filter(Boolean);
    } else {
      entry.behind = 0;
      entry.ahead = 0;
      entry.diffstat = '';
      entry.changed_files = [];
      entry.commits = git(['log', '--oneline', '-10', `origin/${branch}`], cloneDir).stdout
        .split(/\r?\n/).filter(Boolean);
    }
    info.branches.push(entry);
  }
  writeJson(path.join(snapshotRoot, 'snapshot.json'), info);
  return info;
}

export function repoStatus(repoDir) {
  const r = git(['status', '--porcelain'], repoDir, { allowFail: true });
  return r.stdout.trim();
}

export function ensureIdentity(repoDir, name, email) {
  git(['config', 'user.name', name], repoDir);
  git(['config', 'user.email', email], repoDir);
}

export function commitPaths(repoDir, paths, message, { dryRun = false } = {}) {
  ensureDir(repoDir);
  if (dryRun) {
    const st = git(['status', '--porcelain', '--', ...paths], repoDir, { allowFail: true });
    return { changed: Boolean(st.stdout.trim()), message, dryRun: true };
  }
  const add = git(['add', '-A', '--', ...paths], repoDir, { allowFail: true });
  if (add.status !== 0) throw new Error(add.stderr || add.stdout || 'git add failed');
  const staged = git(['diff', '--cached', '--quiet'], repoDir, { allowFail: true });
  if (staged.status === 0) {
    return { changed: false, message: 'nothing to commit' };
  }
  const commit = git(['commit', '-m', message], repoDir, { allowFail: true });
  if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout || 'git commit failed');
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir).stdout.trim();
  const push = git(['push', '-u', 'origin', `HEAD:${branch}`], repoDir, { allowFail: true });
  if (push.status !== 0) throw new Error(push.stderr || push.stdout || 'git push failed');
  return { changed: true, message, branch };
}

export function untrackedOrDirty(repoDir) {
  return repoStatus(repoDir).length > 0;
}
