import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { test } from 'node:test';
import { completionPipeName } from '@dust/shared';
import { PipeCompletionSource } from './pipeCompletionSource';

function uniqueWorkspace(): string {
  return `ws-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function connect(pipeName: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function writeFrame(socket: net.Socket, frame: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${JSON.stringify(frame)}\n`, (error) => (error ? reject(error) : resolve()));
    socket.end();
  });
}

function writeChunks(socket: net.Socket, chunks: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let i = 0;
    const writeNext = (): void => {
      if (i === chunks.length) {
        socket.end();
        resolve();
        return;
      }
      socket.write(chunks[i++], (error) => (error ? reject(error) : writeNext()));
    };
    writeNext();
  });
}

function writeRaw(socket: net.Socket, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

test('forWorkspace derives the endpoint from the workspace path', () => {
  const source = PipeCompletionSource.forWorkspace('/tmp/My Project');
  assert.strictEqual(source.endpoint, completionPipeName('/tmp/My Project'));
  assert.ok(path.isAbsolute(source.endpoint) || source.endpoint.startsWith('\\\\.\\pipe\\'));
});

test('resolves the waiter for a matching correlation id', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const frame = { status: 'done', correlationId: 'cid-1', summary: { confidence: 85, actions: ['read'] } };
  const pending = source.await('cid-1');

  const socket = await connect(pipeName);
  await writeFrame(socket, frame);

  assert.deepStrictEqual(await pending, frame);
  source.dispose();
  await cleanupSocket(pipeName);
});

test('leaves unrelated waiters pending when another correlation id arrives', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  let bResolved = false;
  const pendingA = source.await('cid-a');
  const pendingB = source.await('cid-b');
  void pendingB.then(
    () => {
      bResolved = true;
    },
    () => {
      // Expected rejection on dispose(); not a resolution.
    }
  );

  const socket = await connect(pipeName);
  await writeFrame(socket, { status: 'done', correlationId: 'cid-a', summary: { confidence: 1, actions: [] } });

  assert.deepStrictEqual((await pendingA).correlationId, 'cid-a');
  assert.strictEqual(bResolved, false, 'cid-b waiter must not resolve on a cid-a frame');

  source.dispose();
  await cleanupSocket(pipeName);
});

test('delivering the second frame resolves the second waiter', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const pendingB = source.await('cid-b');
  const socket = await connect(pipeName);
  await writeFrame(socket, { status: 'done', correlationId: 'cid-b', summary: { confidence: 1, actions: [] } });

  assert.deepStrictEqual((await pendingB).correlationId, 'cid-b');
  source.dispose();
  await cleanupSocket(pipeName);
});

test('ignores malformed frames and frames without a matching waiter', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const pending = source.await('cid-1');
  const socket = await connect(pipeName);

  await writeFrame(socket, { status: 'done', correlationId: 'cid-999', summary: { confidence: 1, actions: [] } });
  const socket2 = await connect(pipeName);
  await writeFrame(socket2, '{not json');

  const socket3 = await connect(pipeName);
  await writeFrame(socket3, { status: 'done', correlationId: 'cid-1', summary: { confidence: 1, actions: [] } });

  assert.deepStrictEqual((await pending).correlationId, 'cid-1');
  source.dispose();
  await cleanupSocket(pipeName);
});

test('reassembles a frame split across multiple data chunks', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const frame = { status: 'done', correlationId: 'cid-chunked', summary: { confidence: 1, actions: [] } };
  const pending = source.await('cid-chunked');

  try {
    const socket = await connect(pipeName);
    const serialized = `${JSON.stringify(frame)}\n`;
    await writeChunks(socket, [serialized.slice(0, 10), serialized.slice(10)]);

    assert.deepStrictEqual(await pending, frame);
  } finally {
    source.dispose();
    await cleanupSocket(pipeName);
  }
});

test('handles multiple frames arriving in a single data chunk', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const pendingA = source.await('cid-a');
  const pendingB = source.await('cid-b');

  try {
    const socket = await connect(pipeName);
    const frameA = { status: 'done', correlationId: 'cid-a', summary: { confidence: 1, actions: [] } };
    const frameB = { status: 'done', correlationId: 'cid-b', summary: { confidence: 1, actions: [] } };
    socket.write(`${JSON.stringify(frameA)}\n${JSON.stringify(frameB)}\n`);
    socket.end();

    assert.deepStrictEqual((await pendingA).correlationId, 'cid-a');
    assert.deepStrictEqual((await pendingB).correlationId, 'cid-b');
  } finally {
    source.dispose();
    await cleanupSocket(pipeName);
  }
});

test('keeps partial lines from concurrent connections isolated', async () => {
  const workspace = uniqueWorkspace();
  const pipeName = completionPipeName(workspace);
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const frameA = { status: 'done', correlationId: 'cid-a', summary: { confidence: 1, actions: [] } };
  const frameB = { status: 'done', correlationId: 'cid-b', summary: { confidence: 1, actions: [] } };
  const pendingA = source.await('cid-a');
  const pendingB = source.await('cid-b');

  const serializedA = `${JSON.stringify(frameA)}\n`;
  const serializedB = `${JSON.stringify(frameB)}\n`;

  const socketA = await connect(pipeName);
  const socketB = await connect(pipeName);

  try {
    await writeRaw(socketA, serializedA.slice(0, 8));
    await writeRaw(socketB, serializedB.slice(0, 8));
    await writeRaw(socketA, serializedA.slice(8));
    await writeRaw(socketB, serializedB.slice(8));
    socketA.end();
    socketB.end();

    assert.deepStrictEqual((await pendingA).correlationId, 'cid-a');
    assert.deepStrictEqual((await pendingB).correlationId, 'cid-b');
  } finally {
    source.dispose();
    await cleanupSocket(pipeName);
  }
});

test('dispose rejects still-pending waiters', async () => {
  const workspace = uniqueWorkspace();
  const source = PipeCompletionSource.forWorkspace(workspace);
  await source.start();

  const pending = source.await('never-arrives');
  source.dispose();

  await assert.rejects(pending, /completion pipe closed/);
  await cleanupSocket(completionPipeName(workspace));
});

async function cleanupSocket(pipeName: string): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  try {
    fs.unlinkSync(pipeName);
  } catch {
    // Already gone or never materialised as a filesystem node.
  }
}
