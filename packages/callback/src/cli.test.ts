import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { completionPipeName } from '@dust/shared';

const CLI_PATH = path.resolve(__dirname, 'cli.js');

function runCli(
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function tempSummaryFile(contents: string): string {
  const file = path.join(os.tmpdir(), `dust-summary-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, contents);
  return file;
}

test('--help exits 0 and prints usage', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /dust-callback/);
});

test('missing required args exits 1', async () => {
  const { code, stderr } = await runCli([]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /missing or invalid/);
});

test('invalid status exits 1', async () => {
  const summary = tempSummaryFile(JSON.stringify({ confidence: 50, actions: [] }));
  try {
    const { code, stderr } = await runCli([
      '--status',
      'bogus',
      '--id',
      'cid',
      '--summary_file',
      summary,
      '--workspace',
      'ws',
    ]);
    assert.strictEqual(code, 1);
    assert.match(stderr, /status must be one of/);
  } finally {
    fs.unlinkSync(summary);
  }
});

test('invalid summary file exits 1', async () => {
  const summary = tempSummaryFile('not json');
  try {
    const { code, stderr } = await runCli([
      '--status',
      'done',
      '--id',
      'cid',
      '--summary_file',
      summary,
      '--workspace',
      'ws',
    ]);
    assert.strictEqual(code, 1);
    assert.match(stderr, /not valid JSON/);
  } finally {
    fs.unlinkSync(summary);
  }
});

test('summary file violating the schema exits 1', async () => {
  const summary = tempSummaryFile(JSON.stringify({ confidence: 150, actions: 'nope' }));
  try {
    const { code } = await runCli([
      '--status',
      'done',
      '--id',
      'cid',
      '--summary_file',
      summary,
      '--workspace',
      'ws',
    ]);
    assert.strictEqual(code, 1);
  } finally {
    fs.unlinkSync(summary);
  }
});

test('summary file with a non-string notes field exits 1', async () => {
  const summary = tempSummaryFile(JSON.stringify({ confidence: 50, actions: [], notes: 7 }));
  try {
    const { code, stderr } = await runCli([
      '--status',
      'done',
      '--id',
      'cid',
      '--summary_file',
      summary,
      '--workspace',
      'ws',
    ]);
    assert.strictEqual(code, 1);
    assert.match(stderr, /summary.notes must be a string/);
  } finally {
    fs.unlinkSync(summary);
  }
});

test('pipe connection failure exits 2', async () => {
  const summary = tempSummaryFile(JSON.stringify({ confidence: 50, actions: [] }));
  const workspace = `no-listener-${process.pid}-${Date.now()}`;
  try {
    const { code, stderr } = await runCli([
      '--status',
      'done',
      '--id',
      'cid',
      '--summary_file',
      summary,
      '--workspace',
      workspace,
    ]);
    assert.strictEqual(code, 2);
    assert.match(stderr, /failed to deliver/);
  } finally {
    fs.unlinkSync(summary);
  }
});

test('delivers a completion frame over the workspace pipe', async () => {
  const workspace = `ws-${process.pid}-${Date.now()}`;
  const pipeName = completionPipeName(workspace);
  const summary = tempSummaryFile(
    JSON.stringify({ confidence: 85, actions: ['read', 'write'], notes: 'ok' })
  );
  const received: string[] = [];

  const server = net.createServer((socket) => {
    socket.on('data', (chunk: Buffer) => received.push(chunk.toString()));
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName, resolve);
  });

  try {
    const { code } = await runCli([
      '--status',
      'done',
      '--id',
      'cid-123',
      '--summary_file',
      summary,
      '--workspace',
      workspace,
    ]);
    assert.strictEqual(code, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.unlinkSync(path.join(process.cwd(), pipeName));
    } catch {}
    fs.unlinkSync(summary);
  }

  const frame = JSON.parse(received.join('').trim());
  assert.deepStrictEqual(frame, {
    status: 'done',
    correlationId: 'cid-123',
    summary: { confidence: 85, actions: ['read', 'write'], notes: 'ok' },
  });
});
