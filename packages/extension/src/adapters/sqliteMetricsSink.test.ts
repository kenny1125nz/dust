import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { SqliteMetricsSink } from './sqliteMetricsSink';
import type { RunStart } from '../metrics/metricsSink';

function tempDb(): { dbPath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dust-metrics-'));
  return { dbPath: path.join(dir, '.dust', 'metrics.db'), dir };
}

function sampleRun(overrides: Partial<RunStart> = {}): RunStart {
  return {
    runId: 'run-1',
    actorId: 'solutioning',
    actorKind: 'single-file',
    wholeTarget: true,
    itemCount: 3,
    role: 'Reason',
    chatMode: 'copilot',
    startedAt: 1000,
    dustVersion: '0.1.0',
    ...overrides,
  };
}

test('creates the runs table and run_id index on open', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  sink.recordRunStart(sampleRun());
  sink.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'`).all();
    assert.strictEqual(tables.length, 1);
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_run_id'`)
      .all();
    assert.strictEqual(indexes.length, 1);
  } finally {
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recordRunStart writes a sentinel row with run-level fields', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  sink.recordRunStart(sampleRun());
  sink.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`SELECT * FROM runs WHERE run_id = 'run-1'`).all();
    assert.strictEqual(rows.length, 1);
    const row = rows[0] as Record<string, unknown>;
    assert.strictEqual(row.step_index, 0);
    assert.strictEqual(row.status, 'error');
    assert.strictEqual(row.actor_id, 'solutioning');
    assert.strictEqual(row.actor_kind, 'single-file');
    assert.strictEqual(row.whole_target, 1);
    assert.strictEqual(row.item_count, 3);
    assert.strictEqual(row.role, 'Reason');
    assert.strictEqual(row.chatmode, 'copilot');
    assert.strictEqual(row.run_started_at, 1000);
    assert.strictEqual(row.dust_version, '0.1.0');
    assert.strictEqual(row.dispatched_at, null);
    assert.strictEqual(row.completed_at, null);
  } finally {
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recordStep writes one row per step with duration and summary', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  sink.recordRunStart(sampleRun());
  sink.recordStep({
    runId: 'run-1',
    index: 1,
    correlationId: 'cid-1',
    itemPath: '/workspace/a.md',
    dispatchedAt: 2000,
    completedAt: 2500,
    status: 'done',
    summary: { confidence: 85, actions: ['read', 'write'], notes: 'ok' },
  });
  sink.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(`SELECT * FROM runs WHERE run_id = 'run-1' ORDER BY step_index`)
      .all();
    assert.strictEqual(rows.length, 2);
    const step = rows[1] as Record<string, unknown>;
    assert.strictEqual(step.step_id, 'run-1:1');
    assert.strictEqual(step.step_index, 1);
    assert.strictEqual(step.correlation_id, 'cid-1');
    assert.strictEqual(step.item_path, '/workspace/a.md');
    assert.strictEqual(step.dispatched_at, 2000);
    assert.strictEqual(step.completed_at, 2500);
    assert.strictEqual(step.duration_ms, 500);
    assert.strictEqual(step.status, 'done');
    assert.strictEqual(step.confidence, 85);
    assert.strictEqual(step.actions, '["read","write"]');
    assert.strictEqual(step.notes, 'ok');
    assert.strictEqual(step.actor_id, 'solutioning');
  } finally {
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the first real step overwrites the sentinel row (one row per step)', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  sink.recordRunStart(sampleRun());
  sink.recordStep({
    runId: 'run-1',
    index: 0,
    correlationId: 'cid-0',
    itemPath: '/workspace/a.md',
    dispatchedAt: 2000,
    completedAt: 2500,
    status: 'done',
    summary: { confidence: 90, actions: ['a'] },
  });
  sink.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`SELECT * FROM runs WHERE run_id = 'run-1'`).all();
    assert.strictEqual(rows.length, 1, 'sentinel overwritten by first real step');
    const row = rows[0] as Record<string, unknown>;
    assert.strictEqual(row.status, 'done');
    assert.strictEqual(row.step_index, 0);
    assert.strictEqual(row.confidence, 90);
  } finally {
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('step without a summary records null summary fields', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  sink.recordRunStart(sampleRun());
  sink.recordStep({
    runId: 'run-1',
    index: 1,
    correlationId: 'cid-1',
    itemPath: '/a.md',
    dispatchedAt: 100,
    completedAt: 200,
    status: 'error',
  });
  sink.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT * FROM runs WHERE step_id = 'run-1:1'`)
      .get() as Record<string, unknown>;
    assert.strictEqual(row.confidence, null);
    assert.strictEqual(row.actions, '[]');
    assert.strictEqual(row.notes, null);
  } finally {
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recordRunEnd is a no-op', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  sink.recordRunStart(sampleRun());
  sink.recordRunEnd('run-1');
  sink.close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM runs`).get() as { n: number };
    assert.strictEqual(rows.n, 1);
  } finally {
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a DB that cannot be opened degrades to a silent no-op sink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dust-metrics-'));
  const blocked = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocked, 'plain file');
  const dbPath = path.join(blocked, 'metrics.db');

  const sink = new SqliteMetricsSink(dbPath);
  assert.doesNotThrow(() => sink.recordRunStart(sampleRun()));
  assert.doesNotThrow(() =>
    sink.recordStep({
      runId: 'run-1',
      index: 0,
      correlationId: 'cid',
      itemPath: '/a.md',
      dispatchedAt: 1,
      completedAt: 2,
      status: 'done',
    })
  );
  assert.doesNotThrow(() => sink.recordRunEnd('run-1'));
  assert.doesNotThrow(() => sink.close());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failing write is silently dropped and never throws', () => {
  const { dbPath, dir } = tempDb();
  const sink = new SqliteMetricsSink(dbPath);
  const db = new Database(dbPath);
  // Break the table to force write failures while the sink still holds its handle.
  db.prepare(`DROP TABLE runs`).run();
  db.close();

  assert.doesNotThrow(() => sink.recordRunStart(sampleRun()));
  assert.doesNotThrow(() =>
    sink.recordStep({
      runId: 'run-1',
      index: 0,
      correlationId: 'cid',
      itemPath: '/a.md',
      dispatchedAt: 1,
      completedAt: 2,
      status: 'done',
    })
  );
  assert.doesNotThrow(() => sink.close());
  fs.rmSync(dir, { recursive: true, force: true });
});
