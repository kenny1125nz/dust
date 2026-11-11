import * as assert from 'node:assert';
import { test } from 'node:test';
import type { Uri } from 'vscode';
import type { RunResult } from '../engine';
import type { ActorTreeNode } from '../actors/schema';
import { InMemoryActorSource } from '../actors/inMemoryActorSource';
import { InMemoryFileSystem } from '../targets/inMemoryFileSystem';
import type { ApplyOptions } from './commandTrigger';
import type { CommandTrigger } from './commandTrigger';
import { DustCommandSurface, DustPanel } from './commandSurface';
import type { HostToWebview, WebviewApplyRequest } from './webviewProtocol';

function makeUri(p: string): Uri {
  return { scheme: 'file', path: p } as unknown as Uri;
}

class FakeTrigger implements CommandTrigger {
  readonly calls: Array<{ actorId: string; targetUris: Uri[]; wholeTarget: boolean; opts?: ApplyOptions }> = [];
  result: RunResult = { itemCount: 2, stepCount: 4 };
  error: Error | null = null;
  gate: Promise<RunResult> | null = null;

  async onApply(actorId: string, targetUris: Uri[], wholeTarget: boolean, opts?: ApplyOptions): Promise<RunResult> {
    this.calls.push({ actorId, targetUris, wholeTarget, opts });
    if (this.error) {
      throw this.error;
    }
    return this.gate ?? this.result;
  }
}

class FakePanel implements DustPanel {
  readonly messages: HostToWebview[] = [];
  disposed = false;
  readonly webview = {
    postMessage: (message: HostToWebview) => {
      this.messages.push(message);
    },
    onDidReceiveMessage: (listener: (message: unknown) => void) => {
      this.receivers.add(listener);
      return { dispose: () => this.receivers.delete(listener) };
    },
  };
  private readonly receivers = new Set<(message: unknown) => void>();
  private readonly disposeListeners = new Set<() => void>();

  onDidDispose(listener: () => void) {
    this.disposeListeners.add(listener);
    return { dispose: () => this.disposeListeners.delete(listener) };
  }

  dispose(): void {
    this.disposed = true;
    for (const listener of this.disposeListeners) {
      listener();
    }
  }

  receive(message: unknown): void {
    for (const listener of this.receivers) {
      listener(message);
    }
  }
}

function makeSurface(trigger: FakeTrigger, panel = new FakePanel()) {
  const fs = new InMemoryFileSystem();
  fs.createFile(makeUri('/workspace/.dust/actors/plan.md'), Buffer.from('Plan the work.'));
  const source = new InMemoryActorSource(
    { name: 'actors', children: [{ name: 'plan', actorId: 'plan', children: [] }] },
    { plan: { steps: ['/workspace/.dust/actors/plan.md'] } }
  );
  const surface = new DustCommandSurface(panel, { catalogue: source, trigger, fs, toFileUri: makeUri });
  return { panel, surface };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('loadTree posts the serialized actor tree', async () => {
  const trigger = new FakeTrigger();
  const { panel } = makeSurface(trigger);
  panel.receive({ type: 'loadTree' });
  await flush();
  assert.strictEqual(panel.messages.length, 1);
  const message = panel.messages[0];
  assert.strictEqual(message.type, 'tree');
  if (message.type === 'tree') {
    const child: ActorTreeNode | undefined = message.root.children[0];
    assert.strictEqual(child?.actorId, 'plan');
    assert.strictEqual(message.actors.plan.body, 'Plan the work.');
  }
});

test('apply forwards the mapped request and posts complete', async () => {
  const trigger = new FakeTrigger();
  const { panel } = makeSurface(trigger);
  const payload: WebviewApplyRequest = {
    actorId: 'plan',
    targetPaths: ['/workspace/round-2/Goal.md'],
    wholeTarget: false,
    workspacePath: '/workspace',
    model: 'Review',
    gateway: 'cline',
    addendum: 'Also consider edge cases.',
  };
  panel.receive({ type: 'apply', payload });
  await flush();
  assert.strictEqual(trigger.calls.length, 1);
  assert.strictEqual(trigger.calls[0].actorId, 'plan');
  assert.strictEqual(trigger.calls[0].targetUris[0].path, '/workspace/round-2/Goal.md');
  assert.strictEqual(trigger.calls[0].wholeTarget, false);
  assert.deepStrictEqual(trigger.calls[0].opts, {
    model: 'Review',
    gateway: 'cline',
    addendum: 'Also consider edge cases.',
  });
  assert.deepStrictEqual(panel.messages.find((m) => m.type === 'complete'), {
    type: 'complete',
    result: { itemCount: 2, stepCount: 4 },
  });
});

test('apply without model or addendum passes undefined options', async () => {
  const trigger = new FakeTrigger();
  const { panel } = makeSurface(trigger);
  panel.receive({
    type: 'apply',
    payload: { actorId: 'plan', targetPaths: ['/workspace/Goal.md'], wholeTarget: true, workspacePath: '/workspace' },
  });
  await flush();
  assert.deepStrictEqual(trigger.calls[0].opts, { model: undefined, gateway: undefined, addendum: undefined });
});

test('apply failure posts an error message', async () => {
  const trigger = new FakeTrigger();
  trigger.error = new Error('boom');
  const { panel } = makeSurface(trigger);
  panel.receive({
    type: 'apply',
    payload: { actorId: 'plan', targetPaths: ['/workspace/Goal.md'], wholeTarget: false, workspacePath: '/workspace' },
  });
  await flush();
  assert.deepStrictEqual(panel.messages.find((m) => m.type === 'error'), { type: 'error', message: 'boom' });
});

test('close disposes the panel', () => {
  const trigger = new FakeTrigger();
  const { panel } = makeSurface(trigger);
  panel.receive({ type: 'close' });
  assert.strictEqual(panel.disposed, true);
});

test('no message is posted once the panel has been disposed', async () => {
  let resolveRun: ((result: RunResult) => void) | undefined;
  const trigger = new FakeTrigger();
  trigger.gate = new Promise<RunResult>((resolve) => {
    resolveRun = resolve;
  });
  const { panel } = makeSurface(trigger);
  panel.receive({
    type: 'apply',
    payload: { actorId: 'plan', targetPaths: ['/workspace/Goal.md'], wholeTarget: false, workspacePath: '/workspace' },
  });
  await flush();
  panel.dispose();
  resolveRun?.({ itemCount: 1, stepCount: 1 });
  await flush();
  assert.strictEqual(panel.messages.length, 0);
});
