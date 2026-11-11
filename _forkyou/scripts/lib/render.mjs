import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText, ensureDir, nowIso, shortSha, REPO_ROOT } from './util.mjs';

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function safeHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
}

function starBadge(upstream) {
  const m = String(upstream || '').match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) return '—';
  const repo = `${m[1]}/${m[2]}`;
  return `[![GitHub stars](https://img.shields.io/github/stars/${repo}?style=flat-square&label=%E2%AD%90)](https://github.com/${repo}/stargazers)`;
}

function pagesBase(config) {
  const explicit = config?.publish?.pages_base;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const org = config?.provider?.org;
  const repo = config?.provider?.content_repo;
  return org && repo ? `https://${String(org).toLowerCase()}.github.io/${repo}` : '';
}

export function renderGuide(templatePath, data, meta = {}) {
  let html = readText(templatePath);
  if (!html) throw new Error(`Missing guide template: ${templatePath}`);
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/<\/script/gi, '<\\/script');
  html = html
    .replaceAll('__TITLE__', String(data.title || meta.name || 'Project'))
    .replaceAll('__SUBTITLE__', String(data.subtitle || data.one_liner || meta.description || ''))
    .replaceAll('__GENERATED__', String(data.generated_at || nowIso().slice(0, 10)))
    .replaceAll('__COMMIT__', shortSha(data.meta?.commit || meta.analyzed_commit || ''))
    .replaceAll('__UPSTREAM_URL__', safeHttp(data.links?.github) || safeHttp(meta.upstream_url) || '#')
    .replaceAll('__GUIDE_DATA__', json);
  return html;
}

export function renderProjectReadme(meta, templatePath) {
  const tpl = readText(templatePath);
  if (!tpl) throw new Error(`Missing project README template: ${templatePath}`);
  const quick = meta.quick_start || (Array.isArray(meta.run) && meta.run[0]?.command) || '# 见 07-contribute.md';
  const map = {
    '{{name}}': meta.name || '',
    '{{one_liner}}': meta.one_liner || meta.description || '',
    '{{upstream}}': meta.upstream || '',
    '{{upstream_url}}': meta.upstream_url || '',
    '{{homepage}}': meta.homepage ? `[${meta.homepage}](${meta.homepage})` : '—',
    '{{license}}': meta.license || 'NOASSERTION',
    '{{language}}': meta.language || '—',
    '{{depth}}': meta.depth || 'L2',
    '{{commit}}': shortSha(meta.analyzed_commit || ''),
    '{{date}}': String(meta.analyzed_at || '').slice(0, 10),
    '{{quick_start}}': quick,
    '{{takeaway}}': meta.takeaway || '—'
  };
  let out = tpl;
  for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, v);
  return out;
}

export function renderRootReadme(existing, manifest, config) {
  const start = '<!-- FORKYOU:INDEX:START -->';
  const end = '<!-- FORKYOU:INDEX:END -->';
  const projects = Object.values(manifest.projects || {})
    .filter(p => p.status === 'analyzed')
    .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
  const cats = config?.analysis?.categories || [];
  const pages = pagesBase(config);
  const byCat = new Map();
  for (const p of projects) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  const lines = [];
  if (!projects.length) {
    lines.push('还没有分析结果。');
    lines.push('');
    lines.push('运行 `node ForkYou/_forkyou/scripts/forkyou.mjs sync` 开始。');
  } else {
    lines.push(`已分析 **${projects.length}** 个项目。最后更新：${String(manifest.updated_at || '').slice(0, 19).replace('T', ' ')}。`);
    lines.push('');
    for (const [catId, label] of cats.map(c => [c.id, c.label])) {
      const list = byCat.get(catId) || [];
      if (!list.length) continue;
      lines.push(`### ${catId} · ${label}`);
      lines.push('');
      lines.push('| 项目 | 一句话 | 上游 | 应用地址 | Star | 深度 | 更新 | 分析 |');
      lines.push('|---|---|---|---|---|---|---|---|');
      for (const p of list) {
        const one = mdEscape(p.one_liner || p.description || '—');
        const upstream = p.upstream ? `[${p.upstream}](https://github.com/${p.upstream})` : '—';
        const home = safeHttp(p.homepage) ? `[打开](${p.homepage})` : '—';
        const wiki = `${p.path}/README.md`;
        const guideFile = p.guide ? path.join(REPO_ROOT, p.path, p.guide) : '';
        const guideHref = guideFile && fs.existsSync(guideFile)
          ? (pages ? `${pages}/${p.path}/${p.guide}` : `${p.path}/${p.guide}`)
          : '';
        const guide = guideHref ? ` · [Guide](${guideHref})` : '';
        lines.push(`| [${p.name}](${wiki}) | ${one} | ${upstream} | ${home} | ${starBadge(p.upstream)} | ${p.depth || 'L2'} | ${String(p.analyzed_at || '').slice(0, 10)} | [Wiki](${wiki})${guide} |`);
      }
      lines.push('');
    }
  }
  const block = `${start}\n${lines.join('\n')}\n${end}`;
  if (existing.includes(start) && existing.includes(end)) {
    return existing.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return `${existing.trimEnd()}\n\n${block}\n`;
}

export function writeRenderedGuide(templatePath, data, meta, outFile) {
  const html = renderGuide(templatePath, data, meta);
  ensureDir(path.dirname(outFile));
  writeText(outFile, html);
  return outFile;
}
