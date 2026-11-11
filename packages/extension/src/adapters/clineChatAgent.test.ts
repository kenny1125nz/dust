import * as assert from 'node:assert';
import { test } from 'node:test';
import { ClineChatAgent } from './clineChatAgent';
import type { ClineAPI } from './clineApi';

type LoggedArgs = string[];

function captureConsoleError(): { logged: LoggedArgs[]; restore: () => void } {
  const originalError = console.error;
  const logged: LoggedArgs[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String));
  };
  return { logged, restore: () => (console.error = originalError) };
}

test('dispatch calls startNewTask with the composed instruction', async () => {
  const started: string[] = [];
  const api: ClineAPI = {
    startNewTask: (task?: string) => {
      if (task !== undefined) {
        started.push(task);
      }
      return Promise.resolve();
    },
  };
  const agent = new ClineChatAgent(async () => api);
  agent.dispatch('Rewrite the harness', 'Repair');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(started, ['Rewrite the harness']);
});

test('dispatch logs and skips when the Cline API is unavailable', async () => {
  const capture = captureConsoleError();
  try {
    const agent = new ClineChatAgent(async () => undefined);
    agent.dispatch('Boop');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(capture.logged.length, 1);
    assert.ok(capture.logged[0][0].includes('cline gateway requested'));
  } finally {
    capture.restore();
  }
});

test('dispatch swallows startNewTask failures (fire-and-forget, error logged)', async () => {
  const api: ClineAPI = {
    startNewTask: () => Promise.reject(new Error('panel busy')),
  };
  const capture = captureConsoleError();
  try {
    const agent = new ClineChatAgent(async () => api);
    agent.dispatch('Do it');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(capture.logged.length, 1);
    assert.ok(capture.logged[0][0].includes('failed to dispatch to Cline'));
  } finally {
    capture.restore();
  }
});

test('dispatch swallows resolver failures (fire-and-forget, error logged)', async () => {
  const capture = captureConsoleError();
  try {
    const agent = new ClineChatAgent(async () => {
      throw new Error('activation failed');
    });
    agent.dispatch('Do it');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(capture.logged.length, 1);
    assert.ok(capture.logged[0][0].includes('failed to resolve Cline API'));
  } finally {
    capture.restore();
  }
});

test('dispatch returns undefined (AgentGateway port contract)', () => {
  const agent = new ClineChatAgent(async () => undefined);
  assert.strictEqual(agent.dispatch('Build it', 'Build'), undefined);
});
