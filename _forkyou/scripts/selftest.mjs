import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, projectPath, validateProjectDir } from './lib/manifest.mjs';
import { renderRootReadme } from './lib/render.mjs';
import { parseArgs } from './lib/util.mjs';

const config = { analysis: { category_overrides: {} } };
assert.equal(classify({ forkName: 'demo-kvm', description: 'software KVM', topics: ['kvm'], language: 'Rust' }, config), '01-systems');
assert.equal(projectPath({ category: '01-systems', name: 'demo-kvm' }), '01-systems/demo-kvm');

const args = parseArgs(['--only', 'demo-a,demo-b', '--dry-run']);
assert.equal(args.only, 'demo-a,demo-b');
assert.equal(args['dry-run'], true);

// Minimal project: only README + meta + takeaways; guide and extra docs optional.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forkyou-'));
const meta = {
  id: 'github:owner/repo',
  name: 'repo',
  provider: 'github',
  upstream: 'owner/repo',
  fork: 'owner/repo',
  category: '07-other',
  depth: 'L1',
  length: 'lite',
  analysis: { profile: 'lite', reason: 'docs-only skill pack', skipped: [] },
  analyzed_commit: 'abc12345',
  analyzed_at: '2026-01-01',
  upstream_url: 'https://github.com/owner/repo',
  license: 'MIT',
  branches: ['main'],
  docs: ['README.md', '08-takeaways.md']
};
fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
fs.writeFileSync(path.join(dir, '08-takeaways.md'), '# takeaways\n');
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
const result = validateProjectDir(dir);
assert.deepEqual(result.errors, []);
fs.rmSync(dir, { recursive: true, force: true });

// Root README: star badge links to GitHub stargazers; missing guide is not linked.
const readme = renderRootReadme('', {
  updated_at: '2026-01-01T00:00:00Z',
  projects: {
    x: {
      status: 'analyzed', category: '07-other', path: '07-other/repo', name: 'repo',
      one_liner: 'docs-only', upstream: 'owner/repo', homepage: '', depth: 'L1',
      analyzed_at: '2026-01-01', guide: null
    }
  }
}, { analysis: { categories: [{ id: '07-other', label: '其他' }] } });
assert.ok(readme.includes('img.shields.io/github/stars/owner/repo'));
assert.ok(readme.includes('github.com/owner/repo/stargazers'));
assert.ok(!readme.includes('[Guide]'));

console.log('selftest OK');
