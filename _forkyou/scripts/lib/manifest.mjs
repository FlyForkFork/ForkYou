import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_FILE, readJson, writeJson, nowIso } from './util.mjs';

export function loadManifest() {
  const m = readJson(MANIFEST_FILE);
  if (!m) return { schema: 1, updated_at: null, projects: {} };
  if (!m.projects) m.projects = {};
  return m;
}

export function saveManifest(manifest) {
  manifest.updated_at = nowIso();
  writeJson(MANIFEST_FILE, manifest);
}

export function projectId(provider, upstream) {
  return `${provider}:${upstream}`;
}

const CATEGORY_RULES = [
  ['01-systems', ['kvm', 'keyboard', 'mouse', 'trackpad', 'clipboard', 'audio', 'desktop', 'window', 'driver', 'input', 'file sync', 'remote desktop', 'screen', 'display', 'macos', 'windows', 'linux', 'tauri', 'system', 'os ', 'sharing']],
  ['02-ai-cv', ['ai', 'ml', 'llm', 'vision', 'image', 'video', 'diffusion', 'model', 'agent', 'rag', 'pytorch', 'tensorflow', 'cuda', 'ocr', 'detect', 'segment', 'cv', 'inference']],
  ['03-infra', ['kubernetes', 'k8s', 'docker', 'container', 'devops', 'cloud', 'proxy', 'gateway', 'server', 'terraform', 'ansible', 'ci', 'observability', 'monitor', 'network', 'vpn', 'dns', 'deploy']],
  ['04-data', ['database', 'sql', 'etl', 'stream', 'kafka', 'analytics', 'storage', 'query', 'olap', 'data', 'vector db', 'redis', 'postgres', 'clickhouse']],
  ['05-devtools', ['cli', 'git', 'editor', 'compiler', 'debug', 'test', 'build', 'package', 'terminal', 'shell', 'linter', 'vscode', 'ide', 'formatter', 'runtime', 'toolchain']],
  ['06-web', ['web', 'frontend', 'react', 'vue', 'browser', 'http', 'css', 'ui', 'nextjs', 'node', 'html', 'javascript', 'typescript']]
];

export function classify(fork, config) {
  const overrides = config?.analysis?.category_overrides || {};
  if (overrides[fork.forkName]) return overrides[fork.forkName];
  if (overrides[fork.upstreamName]) return overrides[fork.upstreamName];
  const name = String(fork.forkName || '').toLowerCase();
  const desc = String(fork.description || '').toLowerCase();
  const topics = (fork.topics || []).join(' ').toLowerCase();
  const lang = String(fork.language || '').toLowerCase();
  const scores = new Map();
  for (const [cat, words] of CATEGORY_RULES) {
    let score = 0;
    for (const w of words) {
      if (name.includes(w)) score += 3;
      if (topics.includes(w)) score += 2;
      if (desc.includes(w)) score += 1;
      if (lang.includes(w)) score += 1;
    }
    scores.set(cat, score);
  }
  let best = '07-other';
  let bestScore = 0;
  for (const [cat] of CATEGORY_RULES) {
    const s = scores.get(cat) || 0;
    if (s > bestScore) { bestScore = s; best = cat; }
  }
  return best;
}

export function upsertProject(manifest, project) {
  const id = project.id;
  const old = manifest.projects[id] || {};
  manifest.projects[id] = {
    ...old,
    ...project,
    id,
    updated_at: nowIso()
  };
  return manifest.projects[id];
}

export function findByName(manifest, name) {
  const q = String(name || '').toLowerCase();
  return Object.values(manifest.projects).find(p =>
    p.name?.toLowerCase() === q ||
    p.fork?.split('/').pop()?.toLowerCase() === q ||
    p.upstream?.split('/').pop()?.toLowerCase() === q
  ) || null;
}

export function projectPath(project) {
  return `${project.category}/${project.name}`;
}

export function validateProjectDir(dir, opts = {}) {
  const errors = [];
  const warnings = [];
  const required = ['README.md', 'meta.json', '08-takeaways.md'];
  for (const f of required) {
    if (!fs.existsSync(path.join(dir, f))) errors.push(`missing ${f}`);
  }

  const metaFile = path.join(dir, 'meta.json');
  const meta = readJson(metaFile);
  if (!meta) errors.push('meta.json is not valid JSON');
  else {
    for (const k of ['id', 'name', 'provider', 'upstream', 'fork', 'category', 'depth', 'analyzed_commit', 'analyzed_at', 'upstream_url', 'license', 'branches', 'docs']) {
      if (meta[k] == null || meta[k] === '') errors.push(`meta.json missing ${k}`);
    }
    if (!Array.isArray(meta.docs) || meta.docs.length === 0) {
      errors.push('meta.json missing docs');
    } else {
      for (const f of meta.docs) {
        if (!fs.existsSync(path.join(dir, f))) errors.push(`meta.docs lists missing ${f}`);
      }
    }
    const profile = meta.analysis?.profile || meta.length || 'default';
    if (!meta.analysis?.profile) warnings.push('meta.json missing analysis.profile (required for new analyses)');
    if (!['lite', 'default', 'deep'].includes(profile)) warnings.push(`unknown analysis profile: ${profile}`);
    if (profile === 'deep') {
      const deepDocs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^04-deep-dive-.+\.md$/.test(f)) : [];
      if (deepDocs.length < 2) warnings.push(`deep profile has fewer than 2 deep-dive docs, found ${deepDocs.length}`);
    }
  }

  const guideFile = path.join(dir, 'guide.data.json');
  if (fs.existsSync(guideFile)) {
    const guide = readJson(guideFile);
    if (!guide) errors.push('guide.data.json is not valid JSON');
    else {
      if (!guide.title) errors.push('guide.data.json missing title');
      if (!Array.isArray(guide.architecture?.layers) || guide.architecture.layers.length === 0) errors.push('guide.data.json missing architecture.layers');
      if (!Array.isArray(guide.cheats) || guide.cheats.length < 3) warnings.push('guide.data.json has fewer than 3 cheat cards');
      if (!Array.isArray(guide.code_map) || guide.code_map.length < 5) warnings.push('guide.data.json has fewer than 5 code_map entries');
    }
  }

  const htmlFile = path.join(dir, 'guide.html');
  if (fs.existsSync(htmlFile)) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    if (!html.includes('window.GUIDE_DATA')) errors.push('guide.html is not rendered (missing window.GUIDE_DATA)');
    if (html.length < 5000) warnings.push('guide.html is very small');
  }

  // Placeholder scan, excluding the template files and binary-ish files.
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(md|json|html)$/.test(f)) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      if (/\{\{/.test(text)) errors.push(`${f} still contains {{...}} placeholders`);
      if (/TODO\b/.test(text)) warnings.push(`${f} contains TODO`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function statusCounts(manifest) {
  const out = { total: 0, analyzed: 0, prepared: 0, failed: 0, new: 0, skipped: 0 };
  for (const p of Object.values(manifest.projects)) {
    out.total += 1;
    out[p.status] = (out[p.status] || 0) + 1;
  }
  return out;
}
