import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ActorTree } from '../actors/schema';
import { ActorSourceAdapter, createActorSource } from './actorSourceAdapter';

function tempActorsRoot(): { root: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dust-actors-'));
  const root = path.join(dir, '.dust', 'actors');
  fs.mkdirSync(root, { recursive: true });
  return { root, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function write(root: string, rel: string, contents: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}

test('discovers a single-file actor leaf from the root', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'plan.md', '---\nmodel: Reason\n---\nYou are a planner.\n');
    const tree = createActorSource(root).loadTree();
    assert.strictEqual(tree.root.name, 'actors');
    assert.deepStrictEqual(tree.root.children, [
      { name: 'plan.md', actorId: 'plan.md', children: [] },
    ]);
    const actor = tree.getActor('plan.md');
    assert.ok(actor);
    assert.strictEqual(actor.model, 'Reason');
    assert.deepStrictEqual(actor.steps, [path.join(root, 'plan.md')]);
  } finally {
    cleanup();
  }
});

test('a folder of numbered .md steps loads as a single multi-step actor leaf', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'implement/01-plan.md', '---\nmodel: Reason\n---\n');
    write(root, 'implement/02-code.md', '---\nmodel: Build\n---\n');
    write(root, 'implement/10-review.md', '');
    const tree = createActorSource(root).loadTree();
    assert.deepStrictEqual(tree.root.children, [
      { name: 'implement', actorId: 'implement', children: [] },
    ]);
    const actor = tree.getActor('implement');
    assert.ok(actor);
    assert.strictEqual(actor.model, 'Reason');
    assert.deepStrictEqual(actor.steps.map((p) => path.basename(p)), [
      '01-plan.md',
      '02-code.md',
      '10-review.md',
    ]);
  } finally {
    cleanup();
  }
});

test('a folder with sub-folders loads as a sub-menu and recurses', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'team/plan.md', '---\nmodel: Reason\n---\n');
    write(root, 'team/review/check.md', '---\nmodel: Review\n---\n');
    write(root, 'team/review/deep/probe.md', '---\nmodel: Write\n---\n');
    const tree = createActorSource(root).loadTree();
    const team = tree.root.children[0];
    assert.strictEqual(team.name, 'team');
    assert.strictEqual(team.actorId, undefined);
    assert.deepStrictEqual(
      team.children.map((c) => c.name),
      ['plan.md', 'review']
    );
    assert.deepStrictEqual(
      team.children[1].children.map((c) => c.name),
      ['check.md', 'deep']
    );
    assert.strictEqual(tree.getActor('team/plan.md')?.model, 'Reason');
    assert.strictEqual(tree.getActor('team/review/check.md')?.model, 'Review');
    assert.strictEqual(tree.getActor('team/review/deep/probe.md')?.model, 'Write');
    assert.strictEqual(tree.getActor('team'), undefined);
  } finally {
    cleanup();
  }
});

test('a nested folder of numbered .md steps is a multi-step actor leaf', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'team/implement/01-plan.md', '---\nmodel: Reason\n---\n');
    write(root, 'team/implement/02-code.md', '---\nmodel: Build\n---\n');
    write(root, 'team/implement/10-review.md', '');
    const tree = createActorSource(root).loadTree();
    const team = tree.root.children[0];
    assert.strictEqual(team.name, 'team');
    const implement = team.children[0];
    assert.strictEqual(implement.name, 'implement');
    assert.strictEqual(implement.actorId, 'team/implement');
    assert.deepStrictEqual(implement.children, []);
    const actor = tree.getActor('team/implement');
    assert.ok(actor);
    assert.strictEqual(actor.model, 'Reason');
    assert.deepStrictEqual(actor.steps.map((p) => path.basename(p)), [
      '01-plan.md',
      '02-code.md',
      '10-review.md',
    ]);
  } finally {
    cleanup();
  }
});

test('a folder mixing numbered and non-numbered .md files is a sub-menu', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'mixed/01-step.md', '');
    write(root, 'mixed/notes.md', '');
    const tree = createActorSource(root).loadTree();
    const mixed = tree.root.children[0];
    assert.strictEqual(mixed.name, 'mixed');
    assert.strictEqual(mixed.actorId, undefined);
    assert.deepStrictEqual(
      mixed.children.map((c) => c.name),
      ['01-step.md', 'notes.md']
    );
    assert.ok(tree.getActor('mixed/01-step.md'));
    assert.ok(tree.getActor('mixed/notes.md'));
  } finally {
    cleanup();
  }
});

test('malformed front-matter fails fast with the offending file path', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'bad.md', '---\nmodel: Reason\n');
    assert.throws(() => createActorSource(root).loadTree(), (error: Error) => {
      return error.message.includes('bad.md') && error.message.includes('malformed actor front-matter');
    });
  } finally {
    cleanup();
  }
});

test('an invalid model value fails fast with the offending file path', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'bad.md', '---\nmodel: Quantum\n---\n');
    assert.throws(() => createActorSource(root).loadTree(), (error: Error) => {
      return error.message.includes('bad.md') && error.message.includes('must be one of');
    });
  } finally {
    cleanup();
  }
});

test('reads a gateway from single-file actor front-matter', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'plan.md', '---\nmodel: Reason\ngateway: cline\n---\nYou are a planner.\n');
    const tree = createActorSource(root).loadTree();
    assert.strictEqual(tree.getActor('plan.md')?.gateway, 'cline');
    assert.strictEqual(tree.getActor('plan.md')?.model, 'Reason');
  } finally {
    cleanup();
  }
});

test('a multi-step actor reads gateway from its first step front-matter', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'implement/01-plan.md', '---\nmodel: Reason\ngateway: cline\n---\n');
    write(root, 'implement/02-code.md', '---\nmodel: Build\n---\n');
    const tree = createActorSource(root).loadTree();
    assert.strictEqual(tree.getActor('implement')?.gateway, 'cline');
    assert.strictEqual(tree.getActor('implement')?.model, 'Reason');
  } finally {
    cleanup();
  }
});

test('an invalid gateway value fails fast with the offending file path', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'bad.md', '---\ngateway: llama\n---\n');
    assert.throws(() => createActorSource(root).loadTree(), (error: Error) => {
      return error.message.includes('bad.md') && error.message.includes('copilot, cline');
    });
  } finally {
    cleanup();
  }
});

test('a missing actors root yields an empty tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dust-actors-'));
  try {
    const missing = path.join(dir, '.dust', 'actors');
    const tree: ActorTree = new ActorSourceAdapter(missing).loadTree();
    assert.deepStrictEqual(tree.root.children, []);
    assert.strictEqual(tree.getActor('anything'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an actor without front-matter loads with no model', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'plain.md', 'Just a body.\n');
    const tree = createActorSource(root).loadTree();
    assert.strictEqual(tree.getActor('plain.md')?.model, undefined);
  } finally {
    cleanup();
  }
});

test('a single-file actor with no model yields a tree leaf with undefined model', () => {
  const { root, cleanup } = tempActorsRoot();
  try {
    write(root, 'plan.md', 'Just a body.\n');
    const tree = createActorSource(root).loadTree();
    assert.deepStrictEqual(tree.root.children, [
      { name: 'plan.md', actorId: 'plan.md', children: [] },
    ]);
  } finally {
    cleanup();
  }
});
