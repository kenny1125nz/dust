import * as assert from 'node:assert';
import { test } from 'node:test';
import { endpointIdentity } from './endpoint';

test('endpointIdentity returns the last path segment', () => {
  assert.strictEqual(endpointIdentity('/a/b/my-project'), 'my-project');
  assert.strictEqual(endpointIdentity('my-project'), 'my-project');
  assert.strictEqual(endpointIdentity('C:\\Users\\kenny\\dust-ws'), 'dust-ws');
  assert.strictEqual(endpointIdentity('/a/b/'), 'b');
  assert.strictEqual(endpointIdentity('/'), '');
  assert.strictEqual(endpointIdentity(''), '');
});
