import * as assert from 'node:assert';
import { test } from 'node:test';
import type { Uri } from 'vscode';
import { compose, feedbackSection, importantNote, targetLabel } from './compose';

function uri(path: string): Uri {
  return { scheme: 'file', path } as unknown as Uri;
}

test('targetLabel is the file name for a single uri', () => {
  assert.strictEqual(targetLabel([uri('/workspace/Goal.md')]), 'Goal.md');
});

test('targetLabel is the folder name for a single folder uri', () => {
  assert.strictEqual(targetLabel([uri('/workspace/designs')]), 'designs');
});

test('targetLabel joins multi-select names with a comma', () => {
  assert.strictEqual(
    targetLabel([uri('/workspace/Goal.md'), uri('/workspace/Solution.md')]),
    'Goal.md, Solution.md'
  );
});

test('compose fills the target slot from a single file name', () => {
  assert.strictEqual(
    compose('Read ${target} carefully.', 'Goal.md', ''),
    'Read Goal.md carefully.'
  );
});

test('compose fills the target slot for a folder (wholeTarget)', () => {
  assert.strictEqual(
    compose('Plan over ${target}.', 'designs', ''),
    'Plan over designs.'
  );
});

test('compose fills the target slot with comma-joined names for multi-select', () => {
  assert.strictEqual(
    compose('Read ${target}.', 'Goal.md, Solution.md', ''),
    'Read Goal.md, Solution.md.'
  );
});

test('compose fills the targetContent slot for a single file', () => {
  assert.strictEqual(
    compose('Analyze:\n${targetContent}', 'Goal.md', '# The Goal\nbody'),
    'Analyze:\n# The Goal\nbody'
  );
});

test('compose leaves targetContent empty for a folder or multi-select', () => {
  assert.strictEqual(compose('${targetContent}', 'designs', ''), '');
});

test('compose replaces all occurrences of both slots', () => {
  const body = '${target} then ${targetContent} again ${target}';
  assert.strictEqual(
    compose(body, 'Goal.md', 'content'),
    'Goal.md then content again Goal.md'
  );
});

test('compose leaves unknown slots as-is', () => {
  assert.strictEqual(
    compose('Do ${unknown} with ${target}.', 'Goal.md', ''),
    'Do ${unknown} with Goal.md.'
  );
});

test('importantNote wraps the addendum under its heading', () => {
  assert.strictEqual(importantNote('Keep it short.'), '## Important Note\nKeep it short.');
});

test('feedbackSection embeds the correlation id, workspace, and summary schema', () => {
  const section = feedbackSection('cid-123', 'my-project');
  assert.ok(section.startsWith('## Feedback\n'));
  assert.ok(section.includes('Run dust-callback --help first to verify the flag interface.'));
  assert.ok(section.includes('dust-callback --status done --id cid-123 --summary_file <path/to/summary.json> --workspace my-project'));
  assert.ok(section.includes('{ "confidence": <number 0-100>, "actions": ["<string>", ...], "notes": "<string>" }'));
});

test('feedbackSection matches the binding template exactly', () => {
  const expected = [
    '## Feedback',
    'To signal completion, use the dust-callback command. Run dust-callback --help first to verify the flag interface.',
    '',
    'When done, invoke:',
    '  dust-callback --status done --id abc-123 --summary_file <path/to/summary.json> --workspace dust-workspace',
    '',
    'The summary file must be valid JSON matching:',
    '  { "confidence": <number 0-100>, "actions": ["<string>", ...], "notes": "<string>" }',
  ].join('\n');
  assert.strictEqual(feedbackSection('abc-123', 'dust-workspace'), expected);
});
