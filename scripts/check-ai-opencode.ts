import assert from 'node:assert/strict';
import { getProviderDefinition } from '../src/lib/ai-router/registry';
import { openCodeFreeModels } from '../src/lib/ai-router/opencode-free';

const definition = getProviderDefinition('opencode');
assert.ok(definition, 'OpenCode Free must be a registered no-key provider');
assert.deepEqual(definition.authTypes, ['none']);
assert.deepEqual(
  openCodeFreeModels(['gpt-paid', 'big-pickle', 'example-free', 'jev-1.13-free', 'muse-spark-1.3-contributor-free']),
  ['big-pickle', 'example-free']
);
console.log('OpenCode Free checks passed: provider registration and free Chat model filtering');
