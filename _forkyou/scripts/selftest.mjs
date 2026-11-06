import assert from 'node:assert/strict';
import { classify, projectPath } from './lib/manifest.mjs';
import { parseArgs } from './lib/util.mjs';

const config = { analysis: { category_overrides: { oink: '01-systems' } } };
assert.equal(classify({ forkName: 'oink', description: 'software KVM', topics: ['kvm'], language: 'Rust' }, config), '01-systems');
assert.equal(projectPath({ category: '01-systems', name: 'oink' }), '01-systems/oink');

const args = parseArgs(['--only', 'oink,WechatOnCloud', '--dry-run']);
assert.equal(args.only, 'oink,WechatOnCloud');
assert.equal(args['dry-run'], true);

console.log('selftest OK');
