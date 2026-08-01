import * as assert from 'node:assert';
import { test } from 'node:test';
import { validateFrame } from './validateFrame';

test('validateFrame accepts a well-formed done frame', () => {
  assert.deepStrictEqual(
    validateFrame({ status: 'done', correlationId: 'cid-1', summary: { confidence: 85, actions: ['read', 'write'] } }),
    { status: 'done', correlationId: 'cid-1', summary: { confidence: 85, actions: ['read', 'write'] } }
  );
});

test('validateFrame accepts all three statuses', () => {
  for (const status of ['done', 'error', 'needs-input'] as const) {
    const frame = validateFrame({ status, correlationId: 'cid', summary: { confidence: 0, actions: [] } });
    assert.strictEqual(frame.status, status);
  }
});

test('validateFrame accepts an optional notes field', () => {
  const frame = validateFrame({
    status: 'error',
    correlationId: 'cid',
    summary: { confidence: 40, actions: [], notes: 'blocked on review' },
  });
  assert.deepStrictEqual(frame.summary.notes, 'blocked on review');
});

test('validateFrame accepts a summary without notes', () => {
  const frame = validateFrame({
    status: 'done',
    correlationId: 'cid',
    summary: { confidence: 90, actions: ['a'] },
  });
  assert.strictEqual('notes' in frame.summary, false);
});

test('validateFrame rejects non-object frames', () => {
  assert.throws(() => validateFrame(null));
  assert.throws(() => validateFrame('done'));
  assert.throws(() => validateFrame([]));
});

test('validateFrame rejects an unknown status', () => {
  assert.throws(() => validateFrame({ status: 'snooze', correlationId: 'cid', summary: { confidence: 1, actions: [] } }));
});

test('validateFrame rejects a missing or empty correlationId', () => {
  assert.throws(() => validateFrame({ status: 'done', summary: { confidence: 1, actions: [] } }));
  assert.throws(() => validateFrame({ status: 'done', correlationId: '', summary: { confidence: 1, actions: [] } }));
});

test('validateFrame rejects summary with out-of-range confidence', () => {
  assert.throws(() => validateFrame({ status: 'done', correlationId: 'c', summary: { confidence: 101, actions: [] } }));
  assert.throws(() => validateFrame({ status: 'done', correlationId: 'c', summary: { confidence: -1, actions: [] } }));
});

test('validateFrame rejects summary whose actions are not all strings', () => {
  assert.throws(() => validateFrame({ status: 'done', correlationId: 'c', summary: { confidence: 1, actions: [1] } }));
});

test('validateFrame rejects summary with a non-string notes field', () => {
  assert.throws(() =>
    validateFrame({ status: 'done', correlationId: 'c', summary: { confidence: 1, actions: [], notes: 7 } })
  );
});
