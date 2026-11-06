import assert from 'node:assert/strict';
import { classify, projectPath } from './lib/manifest.mjs';
import { parseArgs } from './lib/util.mjs';

const config = { analysis: { category_overrides: {} } };
assert.equal(classify({ forkName: 'demo-kvm', description: 'software KVM', topics: ['kvm'], language: 'Rust' }, config), '01-systems');
assert.equal(projectPath({ category: '01-systems', name: 'demo-kvm' }), '01-systems/demo-kvm');

const args = parseArgs(['--only', 'demo-a,demo-b', '--dry-run']);
assert.equal(args.only, 'demo-a,demo-b');
assert.equal(args['dry-run'], true);

console.log('selftest OK');
