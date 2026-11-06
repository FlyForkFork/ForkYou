import { getToken } from './util.mjs';

const API = 'https://api.github.com';

async function gh(path, opts = {}) {
  const token = getToken();
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ForkYou/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {})
  };
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500);
    const err = new Error(`GitHub ${opts.method || 'GET'} ${path} -> ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getAuthenticatedUser() {
  return gh('/user');
}

export async function getRepo(fullName) {
  return gh(`/repos/${fullName}`);
}

export async function listOrgForks(org) {
  const out = [];
  let page = 1;
  for (;;) {
    const batch = await gh(`/orgs/${encodeURIComponent(org)}/repos?type=forks&per_page=100&page=${page}&sort=created&direction=desc`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  // The org repo list omits `parent`; fetch details only when needed.
  const details = await Promise.all(out.map(r => r.parent ? r : getRepo(r.full_name).catch(() => r)));
  return details;
}

function normalizeLicense(id) {
  const map = {
    'GPL-3.0': 'GPL-3.0-only',
    'GPL-2.0': 'GPL-2.0-only',
    'LGPL-2.1': 'LGPL-2.1-only',
    'AGPL-3.0': 'AGPL-3.0-only'
  };
  return map[id] || id || 'NOASSERTION';
}

export function forkInfo(repo) {
  const parent = repo.parent || null;
  return {
    fork: repo.full_name,
    forkName: repo.name,
    provider: 'github',
    upstream: parent ? parent.full_name : null,
    upstreamName: parent ? parent.name : repo.name,
    description: repo.description || parent?.description || '',
    homepage: repo.homepage || parent?.homepage || null,
    language: parent?.language || repo.language || '',
    stars: parent?.stargazers_count ?? repo.stargazers_count ?? 0,
    forks: parent?.forks_count ?? repo.forks_count ?? 0,
    license: normalizeLicense(parent?.license?.spdx_id || repo.license?.spdx_id || 'NOASSERTION'),
    topics: parent?.topics || repo.topics || [],
    defaultBranch: parent?.default_branch || repo.default_branch || 'main',
    createdAt: repo.created_at,
    pushedAt: parent?.pushed_at || repo.pushed_at,
    size: parent?.size ?? repo.size ?? 0,
    openIssues: parent?.open_issues_count ?? repo.open_issues_count ?? 0,
    htmlUrl: parent?.html_url || repo.html_url
  };
}

export async function getRateLimit() {
  return gh('/rate_limit');
}
