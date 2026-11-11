import * as assert from 'node:assert';
import { test } from 'node:test';
import {
  classifyFolder,
  isStepFile,
  numericPrefix,
  orderStepFiles,
  parseActorFrontMatter,
} from './actorParser';

test('parseActorFrontMatter reads a valid model role', () => {
  assert.deepStrictEqual(parseActorFrontMatter('---\nmodel: Reason\n---\nbody\n'), { model: 'Reason' });
});

test('parseActorFrontMatter returns empty for a file with no front-matter', () => {
  assert.deepStrictEqual(parseActorFrontMatter('just a body'), {});
  assert.deepStrictEqual(parseActorFrontMatter(''), {});
});

test('parseActorFrontMatter ignores unknown keys and keeps model', () => {
  assert.deepStrictEqual(parseActorFrontMatter('---\ntitle: Whatever\nmodel: Build\n---\n'), {
    model: 'Build',
  });
});

test('parseActorFrontMatter returns empty when model is absent', () => {
  assert.deepStrictEqual(parseActorFrontMatter('---\ntitle: Whatever\n---\n'), {});
});

test('parseActorFrontMatter fails fast on an invalid model value', () => {
  assert.throws(
    () => parseActorFrontMatter('---\nmodel: Quantum\n---\n'),
    /must be one of: Reason, Build, Review, Write, Repair/
  );
});

test('parseActorFrontMatter reads a valid gateway alongside model', () => {
  assert.deepStrictEqual(parseActorFrontMatter('---\nmodel: Reason\ngateway: cline\n---\nbody\n'), {
    model: 'Reason',
    gateway: 'cline',
  });
});

test('parseActorFrontMatter returns no gateway when gateway is absent', () => {
  assert.deepStrictEqual(parseActorFrontMatter('---\nmodel: Reason\n---\n'), { model: 'Reason' });
});

test('parseActorFrontMatter fails fast on an invalid gateway value', () => {
  assert.throws(
    () => parseActorFrontMatter('---\ngateway: llama\n---\n'),
    /must be one of: copilot, cline/
  );
});

test('parseActorFrontMatter fails fast on an unterminated front-matter block', () => {
  assert.throws(() => parseActorFrontMatter('---\nmodel: Reason\n'), /malformed actor front-matter/);
});

test('parseActorFrontMatter accepts CRLF line endings', () => {
  assert.deepStrictEqual(parseActorFrontMatter('---\r\nmodel: Reason\r\n---\r\nbody\r\n'), {
    model: 'Reason',
  });
});

test('isStepFile matches numbered step files', () => {
  assert.strictEqual(isStepFile('01-plan.md'), true);
  assert.strictEqual(isStepFile('1.build.md'), true);
  assert.strictEqual(isStepFile('42.md'), true);
  assert.strictEqual(isStepFile('plan.md'), false);
  assert.strictEqual(isStepFile('readme.md'), false);
});

test('numericPrefix extracts the leading number', () => {
  assert.strictEqual(numericPrefix('01-plan.md'), 1);
  assert.strictEqual(numericPrefix('10-review.md'), 10);
  assert.strictEqual(numericPrefix('plan.md'), 0);
});

test('orderStepFiles sorts by numeric prefix with a name tie-break', () => {
  assert.deepStrictEqual(
    orderStepFiles(['10-review.md', '01-plan.md', '2-build.md']),
    ['01-plan.md', '2-build.md', '10-review.md']
  );
  assert.deepStrictEqual(orderStepFiles(['1-a.md', '1-b.md']), ['1-a.md', '1-b.md']);
});

test('classifyFolder: only numbered .md files with no sub-folders is multi-step', () => {
  assert.strictEqual(classifyFolder(['01-plan.md', '02-code.md'], []), 'multi-step');
});

test('classifyFolder: any sub-folder makes it a sub-menu', () => {
  assert.strictEqual(classifyFolder(['01-plan.md'], ['sub']), 'sub-menu');
  assert.strictEqual(classifyFolder(['01-plan.md', 'notes.md'], ['sub']), 'sub-menu');
});

test('classifyFolder: a non-step .md file makes it a sub-menu', () => {
  assert.strictEqual(classifyFolder(['01-plan.md', 'notes.md'], []), 'sub-menu');
  assert.strictEqual(classifyFolder(['notes.md'], []), 'sub-menu');
});

test('classifyFolder: an empty folder is a sub-menu, not a zero-step multi-step actor', () => {
  assert.strictEqual(classifyFolder([], []), 'sub-menu');
});
