import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
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

test('completionPipeName on Windows uses the named-pipe namespace', () => {
  if (process.platform === 'win32') {
    assert.strictEqual(completionPipeName('/a/b/my-project'), '\\\\.\\pipe\\dust-my-project');
    assert.strictEqual(completionPipeName('my-project'), '\\\\.\\pipe\\dust-my-project');
    assert.strictEqual(completionPipeName('C:\\Users\\kenny\\dust-ws'), '\\\\.\\pipe\\dust-dust-ws');
  }
});

test('completionPipeName on POSIX is an absolute socket path under tmp', () => {
  const name = completionPipeName('/a/b/my-project');
  if (process.platform === 'win32') {
    assert.strictEqual(name, '\\\\.\\pipe\\dust-my-project');
  } else {
    assert.ok(path.isAbsolute(name), `expected absolute path, got ${name}`);
    assert.strictEqual(name, path.join(os.tmpdir(), 'dust-my-project.sock'));
  }
});

test('completionPipeName is CWD-independent: same name regardless of where it is called from', () => {
  const name = completionPipeName('/a/b/my-project');
  assert.strictEqual(completionPipeName('/a/b/my-project'), name);
  assert.ok(path.isAbsolute(name) || name.startsWith('\\\\.\\pipe\\'));
});

test('different workspaces map to distinct pipe names (no cross-talk)', () => {
  assert.notStrictEqual(completionPipeName('/ws/alpha'), completionPipeName('/ws/beta'));
});
