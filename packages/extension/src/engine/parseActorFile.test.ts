import * as assert from 'node:assert';
import { test } from 'node:test';
import { parseActorFile } from './parseActorFile';

test('parses model front-matter and the body', () => {
  assert.deepStrictEqual(parseActorFile('---\nmodel: Reason\n---\nYou are a planner.\n'), {
    body: 'You are a planner.',
    model: 'Reason',
  });
});

test('returns the whole file as body when there is no front-matter', () => {
  assert.deepStrictEqual(parseActorFile('Just a body.\n'), { body: 'Just a body.\n' });
  assert.deepStrictEqual(parseActorFile(''), { body: '' });
});

test('ignores unknown front-matter keys and keeps model', () => {
  assert.deepStrictEqual(parseActorFile('---\ntitle: Whatever\nmodel: Build\n---\nbody\n'), {
    body: 'body',
    model: 'Build',
  });
});

test('returns no model when model is absent', () => {
  assert.deepStrictEqual(parseActorFile('---\ntitle: Whatever\n---\nbody\n'), {
    body: 'body',
    model: undefined,
  });
});

test('fails fast on an invalid model value', () => {
  assert.throws(
    () => parseActorFile('---\nmodel: Quantum\n---\nbody\n'),
    /must be one of: Reason, Build, Review, Write, Repair/
  );
});

test('accepts CRLF line endings', () => {
  assert.deepStrictEqual(parseActorFile('---\r\nmodel: Reason\r\n---\r\nbody\r\n'), {
    body: 'body',
    model: 'Reason',
  });
});

test('a front-matter-only file parses to an empty body', () => {
  assert.deepStrictEqual(parseActorFile('---\nmodel: Reason\n---\n'), { body: '', model: 'Reason' });
  assert.deepStrictEqual(parseActorFile('---\nmodel: Reason\n---'), { body: '', model: 'Reason' });
});

test('a body containing a --- line does not break the closing fence', () => {
  assert.deepStrictEqual(parseActorFile('---\nmodel: Reason\n---\nkeep --- this\n'), {
    body: 'keep --- this',
    model: 'Reason',
  });
});
