import * as assert from 'node:assert';
import { test } from 'node:test';
import type { Uri } from 'vscode';
import { InMemoryFileSystem } from './inMemoryFileSystem';
import { TargetResolver, createTargetResolver } from './targetResolver';

function makeUri(path: string): Uri {
  return { scheme: 'file', path } as unknown as Uri;
}

function paths(items: readonly { target: Uri | Uri[] }[]): string[] {
  return items.map((item) => (item.target as Uri).path);
}

interface Fixture {
  resolver: TargetResolver;
  root: Uri;
  sub: Uri;
  a: Uri;
  b: Uri;
  z: Uri;
  one: Uri;
  two: Uri;
  deepMd: Uri;
  notesMd: Uri;
  gitMd: Uri;
  depMd: Uri;
}

function buildFixture(): Fixture {
  const fs = new InMemoryFileSystem();
  const root = makeUri('/workspace');
  const sub = makeUri('/workspace/sub');
  const a = makeUri('/workspace/a.md');
  const b = makeUri('/workspace/b.md');
  const z = makeUri('/workspace/z.txt');
  const one = makeUri('/workspace/sub/01-one.md');
  const two = makeUri('/workspace/sub/02-two.md');
  const deepMd = makeUri('/workspace/sub/deep/deep.md');
  const notesMd = makeUri('/workspace/.vscode/notes.md');
  const gitMd = makeUri('/workspace/.git/secret.md');
  const depMd = makeUri('/workspace/node_modules/dep.md');

  fs.createDirectory(root);
  fs.createFile(a);
  fs.createFile(b);
  fs.createFile(z);
  fs.createDirectory(sub);
  fs.createFile(one);
  fs.createFile(two);
  fs.createDirectory(makeUri('/workspace/sub/deep'));
  fs.createFile(deepMd);
  fs.createDirectory(makeUri('/workspace/.vscode'));
  fs.createFile(notesMd);
  fs.createDirectory(makeUri('/workspace/.git'));
  fs.createFile(gitMd);
  fs.createDirectory(makeUri('/workspace/node_modules'));
  fs.createFile(depMd);

  return { resolver: createTargetResolver(fs), root, sub, a, b, z, one, two, deepMd, notesMd, gitMd, depMd };
}

test('wholeTarget: true wraps a single selection as one work item, untouched', async () => {
  const { resolver, a } = buildFixture();
  const items = await resolver.resolve(a, true);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].target, a);
});

test('wholeTarget: true wraps a multi-selection as one work item, untouched', async () => {
  const { resolver, a, sub } = buildFixture();
  const items = await resolver.resolve([a, sub], true);
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(items[0].target, [a, sub]);
});

test('wholeTarget: false yields one item per directly selected .md file', async () => {
  const { resolver, a } = buildFixture();
  const items = await resolver.resolve(a, false);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].target, a);
});

test('wholeTarget: false walks a folder recursively to sorted .md files, skipping ignored dirs', async () => {
  const { resolver, root } = buildFixture();
  assert.deepStrictEqual(paths(await resolver.resolve(root, false)), [
    '/workspace/sub/01-one.md',
    '/workspace/sub/02-two.md',
    '/workspace/a.md',
    '/workspace/b.md',
    '/workspace/sub/deep/deep.md',
  ]);
});

test('wholeTarget: false does not yield non-markdown files, walked or directly selected', async () => {
  const { resolver, root, z } = buildFixture();
  const resolved = paths(await resolver.resolve(root, false));
  assert.ok(!resolved.includes('/workspace/z.txt'));
  assert.deepStrictEqual(await resolver.resolve(z, false), []);
});

test('multi-selection flattens into one sorted, deduplicated list', async () => {
  const { resolver, b, sub, a, one } = buildFixture();
  assert.deepStrictEqual(paths(await resolver.resolve([b, sub, a, one], false)), [
    '/workspace/sub/01-one.md',
    '/workspace/sub/02-two.md',
    '/workspace/a.md',
    '/workspace/b.md',
    '/workspace/sub/deep/deep.md',
  ]);
});

test('wholeTarget: false on a missing selection yields no items', async () => {
  const fs = new InMemoryFileSystem();
  const resolver = createTargetResolver(fs);
  assert.deepStrictEqual(await resolver.resolve(makeUri('/nope'), false), []);
});

test('an empty selection yields no work items', async () => {
  const { resolver } = buildFixture();
  assert.deepStrictEqual(await resolver.resolve([], false), []);
  assert.deepStrictEqual(await resolver.resolve([], true), [{ target: [] }]);
});

test('files are sorted in numeric-then-lexical order', async () => {
  const fs = new InMemoryFileSystem();
  const root = makeUri('/nums');
  fs.createDirectory(root);
  fs.createFile(makeUri('/nums/10.md'));
  fs.createFile(makeUri('/nums/2.md'));
  fs.createFile(makeUri('/nums/1.md'));
  const resolver = createTargetResolver(fs);
  assert.deepStrictEqual(paths(await resolver.resolve(root, false)), [
    '/nums/1.md',
    '/nums/2.md',
    '/nums/10.md',
  ]);
});

test('resolveTree of a single file yields a leaf', async () => {
  const { resolver, a } = buildFixture();
  const tree = await resolver.resolveTree(a);
  assert.strictEqual(tree.length, 1);
  assert.deepStrictEqual(tree[0], { name: 'a.md', uri: a, children: [] });
});

test('resolveTree returns one root node per selected uri', async () => {
  const { resolver, a, sub } = buildFixture();
  const tree = await resolver.resolveTree([a, sub]);
  assert.strictEqual(tree.length, 2);
  assert.strictEqual(tree[0].name, 'a.md');
  assert.deepStrictEqual(tree[0].children, []);
  assert.strictEqual(tree[1].name, 'sub');
  assert.deepStrictEqual(
    tree[1].children.map((c) => c.name),
    ['01-one.md', '02-two.md', 'deep']
  );
});

test('resolveTree nests folders, sorts by name, and excludes ignored dirs and non-md files', async () => {
  const { resolver, root } = buildFixture();
  const tree = await resolver.resolveTree(root);
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].name, 'workspace');
  assert.deepStrictEqual(
    tree[0].children.map((c) => c.name),
    ['a.md', 'b.md', 'sub']
  );

  const sub = tree[0].children.find((c) => c.name === 'sub');
  assert.ok(sub);
  assert.deepStrictEqual(
    sub.children.map((c) => c.name),
    ['01-one.md', '02-two.md', 'deep']
  );

  const deep = sub.children.find((c) => c.name === 'deep');
  assert.ok(deep);
  assert.deepStrictEqual(deep.children.map((c) => c.name), ['deep.md']);
});

test('resolveTree preserves each selected uri as a root node', async () => {
  const { resolver, a } = buildFixture();
  const tree = await resolver.resolveTree([a, a]);
  assert.strictEqual(tree.length, 2);
});

test('resolveTree of an empty selection yields no nodes', async () => {
  const { resolver } = buildFixture();
  assert.deepStrictEqual(await resolver.resolveTree([]), []);
});

test('resolveTree of a missing selection falls back to an empty folder node', async () => {
  const { resolver } = buildFixture();
  const missing = makeUri('/nope');
  const tree = await resolver.resolveTree(missing);
  assert.strictEqual(tree.length, 1);
  assert.deepStrictEqual(tree[0], { name: 'nope', uri: missing, children: [] });
});
