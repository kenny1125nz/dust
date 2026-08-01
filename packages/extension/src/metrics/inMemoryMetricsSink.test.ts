import * as assert from 'node:assert';
import { test } from 'node:test';
import { InMemoryMetricsSink } from './inMemoryMetricsSink';

test('records a run start', () => {
  const sink = new InMemoryMetricsSink();
  sink.recordRunStart({
    runId: 'run-1',
    actorId: 'solutioning',
    actorKind: 'single-file',
    wholeTarget: true,
    itemCount: 3,
    role: 'Reason',
    chatMode: 'copilot',
    startedAt: 1000,
    dustVersion: '0.1.0',
  });
  assert.strictEqual(sink.runStarts.length, 1);
  assert.strictEqual(sink.runStarts[0].runId, 'run-1');
  assert.strictEqual(sink.runStarts[0].itemCount, 3);
});

test('records dispatched steps in order', () => {
  const sink = new InMemoryMetricsSink();
  sink.recordStep({ runId: 'run-1', index: 0, correlationId: 'cid-0', itemPath: '/a.md', dispatchedAt: 100, completedAt: 200, status: 'done' });
  sink.recordStep({ runId: 'run-1', index: 1, correlationId: 'cid-1', itemPath: '/b.md', dispatchedAt: 300, completedAt: 400, status: 'error' });
  assert.strictEqual(sink.steps.length, 2);
  assert.strictEqual(sink.steps[0].index, 0);
  assert.strictEqual(sink.steps[1].status, 'error');
});

test('records a step summary when provided', () => {
  const sink = new InMemoryMetricsSink();
  sink.recordStep({
    runId: 'run-1',
    index: 0,
    correlationId: 'cid',
    itemPath: '/a.md',
    dispatchedAt: 100,
    completedAt: 200,
    status: 'done',
    summary: { confidence: 85, actions: ['read', 'wrote'], notes: 'ok' },
  });
  assert.deepStrictEqual(sink.steps[0].summary, { confidence: 85, actions: ['read', 'wrote'], notes: 'ok' });
});

test('records run end by id', () => {
  const sink = new InMemoryMetricsSink();
  sink.recordRunEnd('run-1');
  assert.deepStrictEqual(sink.runEnds, ['run-1']);
});

test('exposes defensive copies of recorded events', () => {
  const sink = new InMemoryMetricsSink();
  sink.recordRunStart({
    runId: 'run-1',
    actorId: 'a',
    actorKind: 'single-file',
    wholeTarget: false,
    itemCount: 1,
    role: 'Build',
    chatMode: 'copilot',
    startedAt: 0,
    dustVersion: '0.1.0',
  });
  const view = sink.runStarts;
  (view as unknown as { push: unknown }).push = null;
  assert.strictEqual(sink.runStarts.length, 1);
});
