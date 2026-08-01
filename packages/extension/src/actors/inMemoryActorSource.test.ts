import * as assert from 'node:assert';
import { test } from 'node:test';
import { ActorSource } from './index';
import { InMemoryActorSource } from './inMemoryActorSource';

test('in-memory source returns the tree and resolves actors by id', () => {
  const source = new InMemoryActorSource(
    { name: 'actors', children: [] },
    { 'plan.md': { model: 'Reason', steps: ['/actors/plan.md'] } }
  );
  const tree: ActorSource = source;
  assert.deepStrictEqual(tree.loadTree().getActor('plan.md'), {
    model: 'Reason',
    steps: ['/actors/plan.md'],
  });
  assert.strictEqual(tree.loadTree().getActor('missing'), undefined);
});

test('in-memory source returns the exact tree it was given', () => {
  const root = { name: 'actors', children: [] as never[] };
  const source = new InMemoryActorSource(root, {});
  assert.strictEqual(source.loadTree().root, root);
});

test('in-memory source does not leak prototype keys as actors', () => {
  const source = new InMemoryActorSource({ name: 'actors', children: [] }, {});
  assert.strictEqual(source.loadTree().getActor('toString'), undefined);
  assert.strictEqual(source.loadTree().getActor('constructor'), undefined);
});
