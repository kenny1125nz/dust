import * as assert from 'node:assert';
import { test } from 'node:test';
import { completionPipeName, endpointIdentity } from './endpoint';

test('endpointIdentity returns the last path segment', () => {
  assert.strictEqual(endpointIdentity('/a/b/my-project'), 'my-project');
  assert.strictEqual(endpointIdentity('my-project'), 'my-project');
  assert.strictEqual(endpointIdentity('C:\\Users\\kenny\\dust-ws'), 'dust-ws');
  assert.strictEqual(endpointIdentity('/a/b/'), 'b');
  assert.strictEqual(endpointIdentity('/'), '');
  assert.strictEqual(endpointIdentity(''), '');
});

test('completionPipeName prefixes the endpoint identity with the dust pipe namespace', () => {
  assert.strictEqual(completionPipeName('/a/b/my-project'), '\\\\.\\pipe\\dust-my-project');
  assert.strictEqual(completionPipeName('my-project'), '\\\\.\\pipe\\dust-my-project');
  assert.strictEqual(completionPipeName('C:\\Users\\kenny\\dust-ws'), '\\\\.\\pipe\\dust-dust-ws');
});

test('different workspaces map to distinct pipe names (no cross-talk)', () => {
  assert.notStrictEqual(completionPipeName('/ws/alpha'), completionPipeName('/ws/beta'));
});
