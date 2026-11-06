import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
export const WORKSPACE = path.resolve(REPO_ROOT, '..');
export const FORKYOU_DIR = path.join(REPO_ROOT, '_forkyou');
export const TEMPLATES_DIR = path.join(FORKYOU_DIR, 'templates');
export const STATE_DIR = path.join(FORKYOU_DIR, 'state');
export const MANIFEST_FILE = path.join(STATE_DIR, 'manifest.json');
export const CONFIG_FILE = path.join(FORKYOU_DIR, 'config.json');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, 'utf8');
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function loadConfig() {
  const cfg = readJson(CONFIG_FILE);
  if (!cfg) throw new Error(`Missing config: ${CONFIG_FILE}`);
  return cfg;
}

export function loadEnv() {
  const candidates = [
    path.join(WORKSPACE, '.env'),
    path.join(REPO_ROOT, '.env'),
    path.join(process.cwd(), '.env')
  ];
  const out = {};
  for (const file of candidates) {
    const text = readText(file, '');
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) continue;
      const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[m[1]] = v;
      } else if (/^(github_pat_|gh[pousr]_)/.test(raw) && !out.FORKYOU_GITHUB_TOKEN) {
        // The workspace .env intentionally contains only the token.
        out.FORKYOU_GITHUB_TOKEN = raw;
      }
    }
    break;
  }
  return out;
}

export function getToken() {
  const env = loadEnv();
  return process.env.FORKYOU_GITHUB_TOKEN || env.FORKYOU_GITHUB_TOKEN || '';
}

export function nowIso() {
  return new Date().toISOString();
}

export function shortSha(sha) {
  return String(sha || '').slice(0, 8);
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function slugify(name) {
  return String(name || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

export function walkFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) {
      try { total += fs.statSync(full).size; } catch {}
    }
  }
  return total;
}

export function runCommand(cmd, args, opts = {}) {
  const cwd = opts.cwd || WORKSPACE;
  const tmpDir = path.join(WORKSPACE, '_cache', 'tmp');
  ensureDir(tmpDir);
  const id = crypto.randomBytes(6).toString('hex');
  const outFile = path.join(tmpDir, `${id}.out`);
  const errFile = path.join(tmpDir, `${id}.err`);
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  const env = { ...process.env, ...(opts.env || {}) };
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', outFd, errFd],
    env,
    windowsHide: true,
    timeout: opts.timeoutMs || 0
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  const stdout = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  const stderr = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
  fs.rmSync(outFile, { force: true });
  fs.rmSync(errFile, { force: true });
  if (res.error) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.error.message}`);
  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.status})\n${stderr || stdout}`.trim());
  }
  return { status: res.status, stdout, stderr };
}

export function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key.includes('=')) {
        const [k, ...rest] = key.split('=');
        opts[k] = rest.join('=');
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts[key] = argv[++i];
      } else {
        opts[key] = true;
      }
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

export function bool(v) {
  return v === true || v === 'true' || v === '1' || v === 'yes';
}
