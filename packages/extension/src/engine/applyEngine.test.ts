import * as assert from 'node:assert';
import { test } from 'node:test';
import type { Uri } from 'vscode';
import type { CompletionFrame } from '@dust/shared';
import { ActorEntry, InMemoryActorSource } from '../actors';
import { CompletionSource } from '../completion';
import { EchoAgentGateway, GatewayRegistry } from '../dispatch';
import { InMemoryMetricsSink } from '../metrics';
import { InMemoryFileSystem, createTargetResolver } from '../targets';
import { ApplyEngine, ApplyRequest, RunResult, createApplyEngine } from './index';

function makeUri(path: string): Uri {
  return { scheme: 'file', path } as unknown as Uri;
}

function writeFile(fs: InMemoryFileSystem, path: string, contents: string): void {
  fs.createFile(makeUri(path), Buffer.from(contents, 'utf8'));
}

/** A CompletionSource the test resolves by hand — the engine's testability seam. */
class ManualCompletionSource implements CompletionSource {
  private readonly waiters = new Map<string, { resolve: (f: CompletionFrame) => void }>();

  await(correlationId: string): Promise<CompletionFrame> {
    return new Promise((resolve) => {
      this.waiters.set(correlationId, { resolve });
    });
  }

  has(correlationId: string): boolean {
    return this.waiters.has(correlationId);
  }

  resolve(correlationId: string, frame?: Partial<CompletionFrame>): void {
    const waiter = this.waiters.get(correlationId);
    assert.ok(waiter, `no pending await for ${correlationId}`);
    this.waiters.delete(correlationId);
    waiter.resolve({
      status: 'done',
      correlationId,
      summary: { confidence: 90, actions: ['produced'], notes: 'ok' },
      ...frame,
    });
  }
}

interface EngineParts {
  engine: ApplyEngine;
  gateway: EchoAgentGateway;
  completion: ManualCompletionSource;
  metrics: InMemoryMetricsSink;
  fs: InMemoryFileSystem;
}

function buildEngine(actors: Record<string, ActorEntry>): EngineParts {
  const fs = new InMemoryFileSystem();
  const gateway = new EchoAgentGateway();
  const completion = new ManualCompletionSource();
  const metrics = new InMemoryMetricsSink();
  const engine = createApplyEngine({
    catalogue: new InMemoryActorSource({ name: 'actors', children: [] }, actors),
    targets: createTargetResolver(fs),
    gateways: new GatewayRegistry({}, gateway),
    completion,
    fs,
    metrics,
    version: '0.1.0-test',
    toFileUri: makeUri,
  });
  return { engine, gateway, completion, metrics, fs };
}

function buildSingleStepParts(
  stepPath: string,
  stepContents: string,
  actor?: Partial<ActorEntry>
): EngineParts {
  const parts = buildEngine({ solutioning: { steps: [stepPath], ...actor } });
  writeFile(parts.fs, stepPath, stepContents);
  writeFile(parts.fs, '/workspace/Goal.md', '# Goal');
  return parts;
}

function request(overrides: Partial<ApplyRequest> = {}): ApplyRequest {
  return {
    actorId: 'solutioning',
    targetUris: [makeUri('/workspace/Goal.md')],
    wholeTarget: false,
    workspacePath: '/workspace',
    ...overrides,
  };
}

/** Flushes the microtask queue so an awaited continuation can run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function extractCid(instruction: string): string {
  const match = instruction.match(/--id (\S+)/);
  assert.ok(match, `no --id found in instruction: ${instruction}`);
  return match[1];
}

/** Drives the run by resolving each dispatched turn's completion in order. */
async function runToCompletion(
  parts: EngineParts,
  req: ApplyRequest
): Promise<{ result: RunResult; cids: string[] }> {
  const run = parts.engine.apply(req);
  const cids: string[] = [];
  for (;;) {
    await settle();
    while (parts.gateway.dispatched.length > cids.length) {
      cids.push(extractCid(parts.gateway.dispatched[cids.length].instruction));
    }
    const last = cids[cids.length - 1];
    if (last !== undefined && parts.completion.has(last)) {
      parts.completion.resolve(last);
      continue;
    }
    break;
  }
  return { result: await run, cids };
}

test('a single-file actor over one file dispatches once and returns counts', async () => {
  const parts = buildEngine({
    solutioning: { model: 'Reason', steps: ['/actors/solutioning.md'] },
  });
  writeFile(parts.fs, '/actors/solutioning.md', '---\nmodel: Reason\n---\nYou are a solver. Read ${targetContent} and ${target}.\n');
  writeFile(parts.fs, '/workspace/Goal.md', '# The Goal');

  const { result, cids } = await runToCompletion(parts, request());
  const turn = parts.gateway.dispatched[0];

  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 1 });
  assert.strictEqual(parts.gateway.dispatched.length, 1);
  assert.ok(turn.instruction.includes('You are a solver. Read # The Goal and Goal.md.'));
  assert.ok(turn.instruction.includes('## Feedback'));
  assert.ok(turn.instruction.includes(`--id ${cids[0]} --summary_file <path/to/summary.json> --workspace workspace`));
  assert.strictEqual(turn.model, 'Reason');
});

test('wholeTarget: true over a folder dispatches once with the folder label and empty content', async () => {
  const parts = buildEngine({
    summarize: { model: 'Write', steps: ['/actors/summarize.md'] },
  });
  writeFile(parts.fs, '/actors/summarize.md', '---\nmodel: Write\n---\nSummarize ${target}:\n${targetContent}\n');
  parts.fs.createDirectory(makeUri('/workspace/designs'));
  writeFile(parts.fs, '/workspace/designs/a.md', 'A');

  const req = request({ actorId: 'summarize', targetUris: [makeUri('/workspace/designs')], wholeTarget: true });
  const { result } = await runToCompletion(parts, req);
  const turn = parts.gateway.dispatched[0];

  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 1 });
  assert.strictEqual(parts.gateway.dispatched.length, 1);
  assert.ok(turn.instruction.includes('Summarize designs:'));
  assert.ok(!turn.instruction.includes('Summarize designs:\nA'), 'folder content must be empty');
});

test('wholeTarget: false over a folder dispatches per file in deterministic order', async () => {
  const parts = buildEngine({
    review: { steps: ['/actors/review.md'] },
  });
  writeFile(parts.fs, '/actors/review.md', 'Review ${target}: ${targetContent}');
  parts.fs.createDirectory(makeUri('/workspace/designs'));
  writeFile(parts.fs, '/workspace/designs/b.md', 'BETA');
  writeFile(parts.fs, '/workspace/designs/a.md', 'ALPHA');

  const req = request({ actorId: 'review', targetUris: [makeUri('/workspace/designs')], wholeTarget: false });
  const { result } = await runToCompletion(parts, req);

  assert.deepStrictEqual(result, { itemCount: 2, stepCount: 2 });
  const instructions = parts.gateway.dispatched.map((t) => t.instruction);
  assert.ok(instructions[0].startsWith('Review a.md: ALPHA'), 'a.md dispatched first');
  assert.ok(instructions[1].startsWith('Review b.md: BETA'), 'b.md dispatched second');
});

test('wholeTarget: true multi-select dispatches once with comma-joined names and no content', async () => {
  const parts = buildEngine({
    plan: { steps: ['/actors/plan.md'] },
  });
  writeFile(parts.fs, '/actors/plan.md', 'Plan over ${target}. Content: ${targetContent}');
  writeFile(parts.fs, '/workspace/Goal.md', 'G');
  writeFile(parts.fs, '/workspace/Solution.md', 'S');

  const req = request({
    actorId: 'plan',
    targetUris: [makeUri('/workspace/Goal.md'), makeUri('/workspace/Solution.md')],
    wholeTarget: true,
  });
  const { result } = await runToCompletion(parts, req);

  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 1 });
  assert.ok(parts.gateway.dispatched[0].instruction.includes('Plan over Goal.md, Solution.md. Content: '));
});

test('a multi-step actor runs steps in numeric order, each awaiting completion', async () => {
  const parts = buildEngine({
    implement: { model: 'Build', steps: ['/actors/implement/01-plan.md', '/actors/implement/02-code.md'] },
  });
  writeFile(parts.fs, '/actors/implement/01-plan.md', '---\nmodel: Reason\n---\nPLAN: ${targetContent}');
  writeFile(parts.fs, '/actors/implement/02-code.md', '---\nmodel: Build\n---\nCODE: ${targetContent}');
  writeFile(parts.fs, '/workspace/Goal.md', '# Goal');

  const run = parts.engine.apply(request({ actorId: 'implement' }));

  await settle();
  assert.strictEqual(parts.gateway.dispatched.length, 1, 'step 1 dispatched');
  assert.ok(parts.gateway.dispatched[0].instruction.startsWith('PLAN:'));
  const cid1 = extractCid(parts.gateway.dispatched[0].instruction);
  assert.ok(parts.completion.has(cid1), 'step 1 awaiting completion');

  parts.completion.resolve(cid1);
  await settle();
  assert.strictEqual(parts.gateway.dispatched.length, 2, 'step 2 dispatched only after step 1 completes');
  assert.ok(parts.gateway.dispatched[1].instruction.startsWith('CODE:'));
  const cid2 = extractCid(parts.gateway.dispatched[1].instruction);

  parts.completion.resolve(cid2);
  const result = await run;
  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 2 });
  assert.strictEqual(parts.gateway.dispatched[0].model, 'Reason', 'per-step model');
  assert.strictEqual(parts.gateway.dispatched[1].model, 'Build', 'per-step model');
});

test('model precedence: request overrides step overrides actor', async () => {
  const a = buildSingleStepParts('/actors/solutioning.md', '---\nmodel: Write\n---\nbody', {
    model: 'Build',
  });
  await runToCompletion(a, request({ model: 'Review' }));
  assert.strictEqual(a.gateway.dispatched[0].model, 'Review');

  const b = buildSingleStepParts('/actors/solutioning.md', '---\nmodel: Write\n---\nbody', {
    model: 'Build',
  });
  await runToCompletion(b, request());
  assert.strictEqual(b.gateway.dispatched[0].model, 'Write');
});

test('a step with no model falls back to the actor model', async () => {
  const parts = buildSingleStepParts('/actors/solutioning.md', 'body', { model: 'Build' });
  await runToCompletion(parts, request());
  assert.strictEqual(parts.gateway.dispatched[0].model, 'Build');
});

test('no model anywhere dispatches without a role (VS Code default applies)', async () => {
  const parts = buildSingleStepParts('/actors/solutioning.md', 'body');
  await runToCompletion(parts, request());
  assert.ok(!('model' in parts.gateway.dispatched[0]), 'no role means no mode is passed');
  assert.strictEqual(parts.gateway.dispatched[0].model, undefined);
});

test('an addendum is appended under ## Important Note', async () => {
  const a = buildSingleStepParts('/actors/solutioning.md', '---\nmodel: Reason\n---\nbody');
  await runToCompletion(a, request({ addendum: 'Keep it short.' }));
  assert.ok(a.gateway.dispatched[0].instruction.includes('## Important Note\nKeep it short.'));

  const b = buildSingleStepParts('/actors/solutioning.md', '---\nmodel: Reason\n---\nbody');
  await runToCompletion(b, request());
  assert.ok(!b.gateway.dispatched[0].instruction.includes('## Important Note'));
});

test('metrics record run start, one step per turn, and run end', async () => {
  const parts = buildEngine({
    implement: { model: 'Build', steps: ['/actors/implement/01.md', '/actors/implement/02.md'] },
  });
  writeFile(parts.fs, '/actors/implement/01.md', '---\nmodel: Reason\n---\nstep one');
  writeFile(parts.fs, '/actors/implement/02.md', '---\nmodel: Build\n---\nstep two');
  writeFile(parts.fs, '/workspace/Goal.md', '# Goal');

  const req = request({ actorId: 'implement' });
  const { result, cids } = await runToCompletion(parts, req);

  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 2 });
  assert.strictEqual(parts.metrics.runStarts.length, 1);
  const start = parts.metrics.runStarts[0];
  assert.strictEqual(start.actorId, 'implement');
  assert.strictEqual(start.actorKind, 'multi-step');
  assert.strictEqual(start.wholeTarget, false);
  assert.strictEqual(start.itemCount, 1);
  assert.strictEqual(start.role, 'Reason');
  assert.strictEqual(start.chatMode, 'Reason');
  assert.strictEqual(start.dustVersion, '0.1.0-test');

  assert.strictEqual(parts.metrics.steps.length, 2);
  assert.deepStrictEqual(
    parts.metrics.steps.map((s) => s.correlationId),
    cids
  );
  for (const step of parts.metrics.steps) {
    assert.strictEqual(step.status, 'done');
    assert.strictEqual(step.summary?.confidence, 90);
    assert.ok(step.completedAt >= step.dispatchedAt);
  }
  assert.strictEqual(parts.metrics.steps[0].itemPath, '/workspace/Goal.md');
  assert.strictEqual(parts.metrics.steps[1].itemPath, '/workspace/Goal.md');
  assert.deepStrictEqual(
    parts.metrics.steps.map((s) => s.index),
    [1, 2]
  );

  assert.deepStrictEqual(parts.metrics.runEnds, [start.runId]);
});

test('an unknown actor fails fast with a clear message', async () => {
  const parts = buildEngine({});
  await assert.rejects(parts.engine.apply(request({ actorId: 'nope' })), /unknown actor: nope/);
});

test('a metrics sink that throws never disrupts the run', async () => {
  const parts = buildEngine({
    solutioning: { steps: ['/actors/solutioning.md'] },
  });
  writeFile(parts.fs, '/actors/solutioning.md', 'body');
  writeFile(parts.fs, '/workspace/Goal.md', '# Goal');

  parts.metrics.recordRunStart = () => {
    throw new Error('boom');
  };
  parts.metrics.recordStep = () => {
    throw new Error('boom');
  };
  parts.metrics.recordRunEnd = () => {
    throw new Error('boom');
  };

  const run = parts.engine.apply(request());

  await settle();
  assert.strictEqual(parts.gateway.dispatched.length, 1);
  parts.completion.resolve(extractCid(parts.gateway.dispatched[0].instruction));
  assert.deepStrictEqual(await run, { itemCount: 1, stepCount: 1 });
});

test('a missing step file rejects with a path-prefixed error and still records run end', async () => {
  const parts = buildEngine({
    implement: { model: 'Build', steps: ['/actors/implement/01.md', '/actors/implement/02.md'] },
  });
  writeFile(parts.fs, '/actors/implement/01.md', '---\nmodel: Reason\n---\nstep one');
  writeFile(parts.fs, '/workspace/Goal.md', '# Goal');

  const run = parts.engine.apply(request({ actorId: 'implement' }));

  await settle();
  assert.strictEqual(parts.gateway.dispatched.length, 1, 'step 1 dispatched');
  parts.completion.resolve(extractCid(parts.gateway.dispatched[0].instruction));

  await assert.rejects(run, /\/actors\/implement\/02\.md: ENOENT/);
  assert.strictEqual(parts.metrics.steps.length, 1, 'the completed step is still recorded');
  assert.strictEqual(parts.metrics.steps[0].index, 1);
  assert.deepStrictEqual(parts.metrics.runEnds, [parts.metrics.runStarts[0].runId], 'run end recorded on failure');
});

test('a broken first step still emits the run-start sentinel', async () => {
  const parts = buildEngine({
    solutioning: { model: 'Build', steps: ['/actors/missing.md'] },
  });
  writeFile(parts.fs, '/workspace/Goal.md', '# Goal');

  await assert.rejects(parts.engine.apply(request()), /\/actors\/missing\.md: ENOENT/);
  assert.strictEqual(parts.metrics.runStarts.length, 1, 'sentinel emitted despite broken first step');
  assert.strictEqual(parts.metrics.runStarts[0].role, 'Build', 'falls back to actor model for the role');
  assert.deepStrictEqual(parts.metrics.runEnds, [parts.metrics.runStarts[0].runId]);
});

test('wholeTarget: true on a single file dispatches once with the full content', async () => {
  const parts = buildEngine({
    review: { steps: ['/actors/review.md'] },
  });
  writeFile(parts.fs, '/actors/review.md', 'Review ${target}: ${targetContent}');
  writeFile(parts.fs, '/workspace/Goal.md', '# The Goal');

  const req = request({ actorId: 'review', wholeTarget: true });
  const { result } = await runToCompletion(parts, req);

  assert.deepStrictEqual(result, { itemCount: 1, stepCount: 1 });
  assert.strictEqual(parts.gateway.dispatched.length, 1);
  assert.ok(parts.gateway.dispatched[0].instruction.includes('Review Goal.md: # The Goal'));
});

test('a run with no work items records start and end with zero counts', async () => {
  const parts = buildEngine({
    solutioning: { steps: ['/actors/solutioning.md'] },
  });
  writeFile(parts.fs, '/actors/solutioning.md', 'body');

  const req = request({ targetUris: [makeUri('/workspace/none.md')] });
  const result = await parts.engine.apply(req);

  assert.deepStrictEqual(result, { itemCount: 0, stepCount: 0 });
  assert.strictEqual(parts.metrics.runStarts.length, 1);
  assert.strictEqual(parts.metrics.runStarts[0].itemCount, 0);
  assert.deepStrictEqual(parts.metrics.runEnds, [parts.metrics.runStarts[0].runId]);
  assert.strictEqual(parts.gateway.dispatched.length, 0);
});

interface DualGatewayParts {
  engine: ApplyEngine;
  copilot: EchoAgentGateway;
  cline: EchoAgentGateway;
  completion: ManualCompletionSource;
  fs: InMemoryFileSystem;
}

/** Wires two echo gateways (copilot + cline) and drives a run to completion. */
async function runDual(
  actors: Record<string, ActorEntry>,
  stepContents: Record<string, string>,
  req: ApplyRequest
): Promise<DualGatewayParts> {
  const fs = new InMemoryFileSystem();
  const copilot = new EchoAgentGateway();
  const cline = new EchoAgentGateway();
  const completion = new ManualCompletionSource();
  const metrics = new InMemoryMetricsSink();
  const engine = createApplyEngine({
    catalogue: new InMemoryActorSource({ name: 'actors', children: [] }, actors),
    targets: createTargetResolver(fs),
    gateways: new GatewayRegistry({ copilot, cline }, copilot),
    completion,
    fs,
    metrics,
    version: '0.1.0-test',
    toFileUri: makeUri,
  });
  writeFile(fs, '/workspace/Goal.md', '# Goal');
  for (const [p, c] of Object.entries(stepContents)) {
    writeFile(fs, p, c);
  }
  const parts: DualGatewayParts = { engine, copilot, cline, completion, fs };
  const run = parts.engine.apply(req);
  let copilotCursor = 0;
  let clineCursor = 0;
  for (;;) {
    await settle();
    let progressed = false;
    while (copilot.dispatched.length > copilotCursor) {
      progressed = true;
      completion.resolve(extractCid(copilot.dispatched[copilotCursor++].instruction));
    }
    while (cline.dispatched.length > clineCursor) {
      progressed = true;
      completion.resolve(extractCid(cline.dispatched[clineCursor++].instruction));
    }
    if (!progressed) {
      break;
    }
  }
  await run;
  return parts;
}

test('gateway precedence: request overrides step overrides actor, default is copilot', async () => {
  const requestG = (overrides: Partial<ApplyRequest> = {}) => request({ actorId: 'g', ...overrides });
  const actorCline = await runDual(
    { g: { gateway: 'cline', steps: ['/actors/g.md'] } },
    { '/actors/g.md': '---\ngateway: cline\n---\nbody' },
    requestG()
  );
  assert.strictEqual(actorCline.copilot.dispatched.length, 0);
  assert.strictEqual(actorCline.cline.dispatched.length, 1, 'actor gateway wins');

  const stepCline = await runDual(
    { g: { steps: ['/actors/g.md'] } },
    { '/actors/g.md': '---\ngateway: cline\n---\nbody' },
    requestG()
  );
  assert.strictEqual(stepCline.copilot.dispatched.length, 0);
  assert.strictEqual(stepCline.cline.dispatched.length, 1, 'step gateway wins over absent actor');

  const requestCline = await runDual(
    { g: { gateway: 'copilot', steps: ['/actors/g.md'] } },
    { '/actors/g.md': '---\ngateway: cline\n---\nbody' },
    requestG({ gateway: 'cline' })
  );
  assert.strictEqual(requestCline.copilot.dispatched.length, 0);
  assert.strictEqual(requestCline.cline.dispatched.length, 1, 'request gateway wins');

  const noGateway = await runDual(
    { g: { steps: ['/actors/g.md'] } },
    { '/actors/g.md': 'body' },
    requestG()
  );
  assert.strictEqual(noGateway.copilot.dispatched.length, 1, 'defaults to copilot');
  assert.strictEqual(noGateway.cline.dispatched.length, 0);
});
