import * as assert from 'node:assert';
import { test } from 'node:test';
import type { Uri } from 'vscode';
import type { ApplyEngine, ApplyRequest, RunResult } from '../engine';
import { ApplyEngineTrigger } from './commandTrigger';

function makeUri(p: string): Uri {
  return { scheme: 'file', path: p } as unknown as Uri;
}

class RecordingEngine implements ApplyEngine {
  readonly requests: ApplyRequest[] = [];

  async apply(request: ApplyRequest): Promise<RunResult> {
    this.requests.push(request);
    return { itemCount: 1, stepCount: 1 };
  }
}

test('ApplyEngineTrigger forwards a CommandTrigger call as an ApplyRequest', async () => {
  const engine = new RecordingEngine();
  const trigger = new ApplyEngineTrigger(engine, '/workspace');

  const result = await trigger.onApply('plan', [makeUri('/workspace/Goal.md')], true, {
    model: 'Review',
    addendum: 'watch out',
  });

  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 1 });
  assert.deepStrictEqual(engine.requests, [
    {
      actorId: 'plan',
      targetUris: [makeUri('/workspace/Goal.md')],
      wholeTarget: true,
      workspacePath: '/workspace',
      model: 'Review',
      addendum: 'watch out',
    },
  ]);
});

test('ApplyEngineTrigger omits options when absent', async () => {
  const engine = new RecordingEngine();
  const trigger = new ApplyEngineTrigger(engine, '/workspace');

  await trigger.onApply('plan', [makeUri('/workspace/Goal.md')], false);

  assert.deepStrictEqual(engine.requests[0], {
    actorId: 'plan',
    targetUris: [makeUri('/workspace/Goal.md')],
    wholeTarget: false,
    workspacePath: '/workspace',
    model: undefined,
    addendum: undefined,
  });
});
