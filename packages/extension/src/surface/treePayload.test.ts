import * as assert from 'node:assert';
import { test } from 'node:test';
import type { Uri } from 'vscode';
import { InMemoryActorSource } from '../actors/inMemoryActorSource';
import type { ActorTreeNode } from '../actors/schema';
import { InMemoryFileSystem } from '../targets/inMemoryFileSystem';
import type { TargetNode } from '../targets/types';
import { buildActorTreePayload, buildTargetTreePayload } from './treePayload';

function makeUri(p: string): Uri {
  return { scheme: 'file', path: p } as unknown as Uri;
}

test('buildActorTreePayload renders the root as-is with a preview body per actor', async () => {
  const fs = new InMemoryFileSystem();
  fs.createFile(makeUri('/workspace/.dust/actors/solutioning/01.md'), Buffer.from('---\nmodel: Reason\n---\nYou are a solutioning architect.'));
  fs.createFile(makeUri('/workspace/.dust/actors/solutioning/02.md'), Buffer.from('Draft the Solution.md.'));
  fs.createFile(makeUri('/workspace/.dust/actors/plan.md'), Buffer.from('Plan the work.'));
  const root: ActorTreeNode = {
    name: 'actors',
    children: [
      { name: 'solutioning', actorId: 'solutioning', children: [] },
      { name: 'plan', actorId: 'plan', children: [] },
    ],
  };
  const source = new InMemoryActorSource(root, {
    solutioning: {
      model: 'Reason',
      steps: ['/workspace/.dust/actors/solutioning/01.md', '/workspace/.dust/actors/solutioning/02.md'],
    },
    plan: { steps: ['/workspace/.dust/actors/plan.md'] },
  });

  const payload = await buildActorTreePayload(source, fs, makeUri);

  assert.strictEqual(payload.root, root);
  assert.strictEqual(payload.actors.solutioning.model, 'Reason');
  assert.deepStrictEqual(payload.actors.solutioning.steps, [
    '/workspace/.dust/actors/solutioning/01.md',
    '/workspace/.dust/actors/solutioning/02.md',
  ]);
  assert.strictEqual(payload.actors.solutioning.body, 'You are a solutioning architect.\n\nDraft the Solution.md.');
  assert.strictEqual(payload.actors.plan.body, 'Plan the work.');
});

test('buildActorTreePayload marks unreadable steps so the user can see them', async () => {
  const source = new InMemoryActorSource(
    { name: 'actors', children: [{ name: 'broken', actorId: 'broken', children: [] }] },
    { broken: { steps: ['/workspace/.dust/actors/broken/01.md'] } }
  );
  const payload = await buildActorTreePayload(source, new InMemoryFileSystem(), makeUri);
  assert.match(payload.actors.broken.body, /\[unreadable: .*broken\/01\.md\]/);
});

test('buildActorTreePayload collects actors nested under sub-menus', async () => {
  const root: ActorTreeNode = {
    name: 'actors',
    children: [{ name: 'Design', children: [{ name: 'Ux', actorId: 'Design/Ux', children: [] }] }],
  };
  const fs = new InMemoryFileSystem();
  fs.createFile(makeUri('/workspace/.dust/actors/Design/Ux.md'), Buffer.from('ux body'));
  const source = new InMemoryActorSource(root, { 'Design/Ux': { steps: ['/workspace/.dust/actors/Design/Ux.md'] } });
  const payload = await buildActorTreePayload(source, fs, makeUri);
  assert.deepStrictEqual(Object.keys(payload.actors), ['Design/Ux']);
  assert.strictEqual(payload.actors['Design/Ux'].body, 'ux body');
});

test('buildTargetTreePayload maps TargetNodes to serializable nodes', () => {
  const nodes: TargetNode[] = [
    {
      name: 'round-2',
      uri: makeUri('/workspace/round-2'),
      children: [
        { name: 'Goal.md', uri: makeUri('/workspace/round-2/Goal.md'), children: [] },
        {
          name: 'designs',
          uri: makeUri('/workspace/round-2/designs'),
          children: [{ name: 'ux-design.md', uri: makeUri('/workspace/round-2/designs/ux-design.md'), children: [] }],
        },
      ],
    },
  ];

  const payload = buildTargetTreePayload(nodes);

  assert.strictEqual(payload[0].name, 'round-2');
  assert.strictEqual(payload[0].path, '/workspace/round-2');
  assert.strictEqual(payload[0].isDirectory, true);
  assert.strictEqual(payload[0].children[0].name, 'Goal.md');
  assert.strictEqual(payload[0].children[0].isDirectory, false);
  assert.strictEqual(payload[0].children[1].name, 'designs');
  assert.strictEqual(payload[0].children[1].children[0].name, 'ux-design.md');
});

test('buildTargetTreePayload maps a file leaf', () => {
  const payload = buildTargetTreePayload([{ name: 'Goal.md', uri: makeUri('/workspace/Goal.md'), children: [] }]);
  assert.deepStrictEqual(payload, [{ name: 'Goal.md', path: '/workspace/Goal.md', isDirectory: false, children: [] }]);
});
