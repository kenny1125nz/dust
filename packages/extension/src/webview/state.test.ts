import * as assert from 'node:assert';
import { test } from 'node:test';
import type { ActorTreeNode } from '../actors/schema';
import type { PanelState } from './state';
import { createInitialState, parseInitialData, panelReducer } from './state';

const tree: ActorTreeNode = {
  name: 'actors',
  children: [{ name: 'plan', actorId: 'plan', children: [] }],
};

test('createInitialState defaults to Each mode, empty phase, and the given target data', () => {
  const state = createInitialState({
    targetTree: [{ name: 'Goal.md', path: '/w/Goal.md', isDirectory: false, children: [] }],
    targetPaths: ['/w/Goal.md'],
    workspacePath: '/w',
  });
  assert.strictEqual(state.wholeTarget, false);
  assert.strictEqual(state.phase, 'empty');
  assert.strictEqual(state.selectedActorId, null);
  assert.deepStrictEqual(state.targetPaths, ['/w/Goal.md']);
  assert.strictEqual(state.workspacePath, '/w');
});

test('parseInitialData tolerates missing or malformed input', () => {
  assert.deepStrictEqual(parseInitialData(undefined), { targetTree: [], targetPaths: [], workspacePath: '' });
  assert.deepStrictEqual(parseInitialData('garbage'), { targetTree: [], targetPaths: [], workspacePath: '' });
});

test('SET_TREE stores the actor tree and preview map', () => {
  const state = createInitialState({ targetTree: [], targetPaths: [], workspacePath: '' });
  const next = panelReducer(state, { type: 'SET_TREE', root: tree, actors: {} });
  assert.strictEqual(next.actorTree, tree);
});

test('SELECT_ACTOR moves to preview and highlights the actor', () => {
  const base = {
    ...createInitialState({ targetTree: [], targetPaths: [], workspacePath: '' }),
    actors: { plan: { model: 'Build' as const, steps: ['/a/plan.md'], body: 'body' } },
  };
  const next = panelReducer(base, { type: 'SELECT_ACTOR', id: 'plan' });
  assert.strictEqual(next.selectedActorId, 'plan');
  assert.strictEqual(next.phase, 'preview');
});

test('SELECT_ACTOR ignores unknown ids', () => {
  const state = createInitialState({ targetTree: [], targetPaths: [], workspacePath: '' });
  const next = panelReducer(state, { type: 'SELECT_ACTOR', id: 'nope' });
  assert.strictEqual(next.selectedActorId, null);
  assert.strictEqual(next.phase, 'empty');
});

test('SELECT_ACTOR is a no-op while running', () => {
  const base = {
    ...createInitialState({ targetTree: [], targetPaths: [], workspacePath: '' }),
    actors: { plan: { steps: [], body: 'b' } },
    phase: 'running' as const,
  };
  const next = panelReducer(base, { type: 'SELECT_ACTOR', id: 'plan' });
  assert.strictEqual(next.selectedActorId, null);
});

test('per-run tweaks update in place', () => {
  let state = createInitialState({ targetTree: [], targetPaths: [], workspacePath: '' });
  state = panelReducer(state, { type: 'SET_WHOLE_TARGET', wholeTarget: true });
  assert.strictEqual(state.wholeTarget, true);
  state = panelReducer(state, { type: 'SET_MODEL', model: 'Review' });
  assert.strictEqual(state.model, 'Review');
  state = panelReducer(state, { type: 'SET_MODEL', model: null });
  assert.strictEqual(state.model, null);
  state = panelReducer(state, { type: 'SET_ADDENDUM', text: 'watch out' });
  assert.strictEqual(state.addendum, 'watch out');
});

test('SET_RUNNING, SET_COMPLETE and SET_ERROR drive the phase', () => {
  let state: PanelState = { ...createInitialState({ targetTree: [], targetPaths: [], workspacePath: '' }), phase: 'preview' };
  state = panelReducer(state, { type: 'SET_RUNNING' });
  assert.strictEqual(state.phase, 'running');
  state = panelReducer(state, { type: 'SET_COMPLETE', result: { itemCount: 3, stepCount: 6 } });
  assert.strictEqual(state.phase, 'complete');
  assert.deepStrictEqual(state.result, { itemCount: 3, stepCount: 6 });
  state = panelReducer(state, { type: 'SET_ERROR', message: 'nope' });
  assert.strictEqual(state.phase, 'error');
  assert.strictEqual(state.error, 'nope');
});
