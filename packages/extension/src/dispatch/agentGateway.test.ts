import * as assert from 'node:assert';
import { test } from 'node:test';
import { ROLES } from '@dust/shared';
import {
  AgentGateway,
  ChatCommandExecutor,
  EchoAgentGateway,
  chatOpenArgs,
  resolveChatMode,
  sendToCopilot,
} from './index';

test('dispatch records a turn with instruction and model', () => {
  const gateway = new EchoAgentGateway();
  gateway.dispatch('Fix the test harness', 'Repair');
  assert.deepStrictEqual(gateway.dispatched, [{ instruction: 'Fix the test harness', model: 'Repair' }]);
});

test('dispatch without a model records the instruction only', () => {
  const gateway = new EchoAgentGateway();
  gateway.dispatch('Just do it');
  assert.deepStrictEqual(gateway.dispatched, [{ instruction: 'Just do it' }]);
});

test('dispatch records multiple turns in order', () => {
  const gateway = new EchoAgentGateway();
  gateway.dispatch('one', 'Write');
  gateway.dispatch('two');
  gateway.dispatch('three', 'Review');
  assert.deepStrictEqual(gateway.dispatched, [
    { instruction: 'one', model: 'Write' },
    { instruction: 'two' },
    { instruction: 'three', model: 'Review' },
  ]);
});

test('every role passes through unchanged as the chat mode', () => {
  for (const role of ROLES) {
    assert.strictEqual(resolveChatMode(role), role);
  }
  assert.strictEqual(resolveChatMode(undefined), undefined);
});

test('chatOpenArgs maps instruction to query and role directly to mode', () => {
  assert.deepStrictEqual(chatOpenArgs('Summarize this', 'Reason'), {
    query: 'Summarize this',
    mode: 'Reason',
  });
});

test('chatOpenArgs omits mode when no role is given (VS Code default applies)', () => {
  assert.deepStrictEqual(chatOpenArgs('Summarize this'), { query: 'Summarize this' });
});

test('sendToCopilot invokes workbench.action.chat.open with the composed payload', () => {
  const calls: { command: string; args: unknown[] }[] = [];
  const executor: ChatCommandExecutor = {
    executeCommand: (command: string, ...rest: unknown[]) => {
      calls.push({ command, args: rest });
      return Promise.resolve(undefined);
    },
  };

  sendToCopilot(executor, 'Rewrite this', 'Review');

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].command, 'workbench.action.chat.open');
  assert.deepStrictEqual(calls[0].args, [{ query: 'Rewrite this', mode: 'Review' }]);
});

test('sendToCopilot omits mode when no role is given', () => {
  const calls: { command: string; args: unknown[] }[] = [];
  const executor: ChatCommandExecutor = {
    executeCommand: (command: string, ...rest: unknown[]) => {
      calls.push({ command, args: rest });
      return Promise.resolve(undefined);
    },
  };

  sendToCopilot(executor, 'Draft a plan');

  assert.deepStrictEqual(calls[0].args, [{ query: 'Draft a plan' }]);
});

test('sendToCopilot swallows executor failures (fire-and-forget, error logged)', async () => {
  const executor: ChatCommandExecutor = {
    executeCommand: () => Promise.reject(new Error('command not found')),
  };
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    sendToCopilot(executor, 'Boop');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(logged.length, 1);
    assert.ok(logged[0].length >= 2);
  } finally {
    console.error = originalError;
  }
});

test('echo gateway satisfies the AgentGateway port contract', () => {
  const gateway: AgentGateway = new EchoAgentGateway();
  const result = gateway.dispatch('Build it', 'Build');
  assert.strictEqual(result, undefined);
  const echo: EchoAgentGateway = gateway as EchoAgentGateway;
  assert.deepStrictEqual(echo.dispatched, [{ instruction: 'Build it', model: 'Build' }]);
});
