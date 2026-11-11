import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { MetricsSink, RunStart, StepRecord } from '../metrics/metricsSink';

type SqliteDatabase = Database.Database;
type SqliteStatement = Database.Statement;

/** Minimal structural surface of the `better-sqlite3` module used at runtime. */
type SqliteModule = new (filePath: string) => SqliteDatabase;

/**
 * Loads `better-sqlite3` lazily. The module is a native addon that is never
 * bundled into the packaged extension, so it may be absent at runtime. Returns
 * `null` when unavailable so metrics degrade to a no-op sink instead of
 * breaking extension activation.
 */
function loadBetterSqlite3(): SqliteModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('better-sqlite3') as SqliteModule;
  } catch {
    return null;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id          TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  actor_kind      TEXT NOT NULL,
  whole_target    INTEGER NOT NULL,
  item_count      INTEGER NOT NULL,
  role            TEXT,
  chatmode        TEXT,
  run_started_at  INTEGER NOT NULL,
  dust_version    TEXT NOT NULL,
  step_id         TEXT PRIMARY KEY,
  step_index      INTEGER NOT NULL,
  correlation_id  TEXT,
  item_path       TEXT,
  dispatched_at   INTEGER,
  completed_at    INTEGER,
  duration_ms     INTEGER,
  status          TEXT NOT NULL DEFAULT 'error',
  confidence      INTEGER,
  actions         TEXT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
`;

const UPSERT = `
INSERT INTO runs (
  run_id, actor_id, actor_kind, whole_target, item_count, role, chatmode,
  run_started_at, dust_version, step_id, step_index, correlation_id, item_path,
  dispatched_at, completed_at, duration_ms, status, confidence, actions, notes
) VALUES (
  @run_id, @actor_id, @actor_kind, @whole_target, @item_count, @role, @chatmode,
  @run_started_at, @dust_version, @step_id, @step_index, @correlation_id, @item_path,
  @dispatched_at, @completed_at, @duration_ms, @status, @confidence, @actions, @notes
)
ON CONFLICT(step_id) DO UPDATE SET
  run_id = excluded.run_id,
  actor_id = excluded.actor_id,
  actor_kind = excluded.actor_kind,
  whole_target = excluded.whole_target,
  item_count = excluded.item_count,
  role = excluded.role,
  chatmode = excluded.chatmode,
  run_started_at = excluded.run_started_at,
  dust_version = excluded.dust_version,
  step_index = excluded.step_index,
  correlation_id = excluded.correlation_id,
  item_path = excluded.item_path,
  dispatched_at = excluded.dispatched_at,
  completed_at = excluded.completed_at,
  duration_ms = excluded.duration_ms,
  status = excluded.status,
  confidence = excluded.confidence,
  actions = excluded.actions,
  notes = excluded.notes
`;

interface RowParams {
  [key: string]: string | number | null;
}

/** Deterministic row identity: one row per (run, step). */
function stepId(runId: string, stepIndex: number): string {
  return `${runId}:${stepIndex}`;
}

/**
 * Adapter: persists run metrics to `<workspace>/.dust/metrics.db`.
 * Best-effort end to end — a DB that cannot be opened or written never throws,
 * so a metrics failure can never disrupt an apply run.
 */
export class SqliteMetricsSink implements MetricsSink {
  private readonly db: SqliteDatabase | null;
  private readonly upsert: SqliteStatement | null;
  private readonly runStarts = new Map<string, RunStart>();

  constructor(dbPath: string) {
    let db: SqliteDatabase | null = null;
    try {
      const sqlite = loadBetterSqlite3();
      if (sqlite) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        db = new sqlite(dbPath);
        db.exec(SCHEMA);
      }
    } catch {
      // Unopenable DB degrades to a no-op sink; never disrupt activation.
      db?.close();
      db = null;
    }
    this.db = db;
    this.upsert = db ? db.prepare(UPSERT) : null;
  }

  recordRunStart(run: RunStart): void {
    this.runStarts.set(run.runId, run);
    this.safeUpsert({
      ...this.runLevelColumns(run),
      step_id: stepId(run.runId, 0),
      step_index: 0,
      correlation_id: null,
      item_path: null,
      dispatched_at: null,
      completed_at: null,
      duration_ms: null,
      status: 'error',
      confidence: null,
      actions: null,
      notes: null,
    });
  }

  recordStep(step: StepRecord): void {
    const run = this.runStarts.get(step.runId);
    this.safeUpsert({
      ...this.runLevelColumns(run),
      step_id: stepId(step.runId, step.index),
      step_index: step.index,
      correlation_id: step.correlationId,
      item_path: step.itemPath,
      dispatched_at: step.dispatchedAt,
      completed_at: step.completedAt,
      duration_ms: step.completedAt - step.dispatchedAt,
      status: step.status,
      confidence: step.summary?.confidence ?? null,
      actions: JSON.stringify(step.summary?.actions ?? []),
      notes: step.summary?.notes ?? null,
    });
  }

  recordRunEnd(_runId: string): void {
    // No-op: run rollups are read-side GROUP BY queries, not columns.
  }

  /** Closes the underlying database handle. Safe to call when never opened. */
  close(): void {
    this.db?.close();
  }

  private runLevelColumns(run: RunStart | undefined): RowParams {
    return {
      run_id: run?.runId ?? '',
      actor_id: run?.actorId ?? '',
      actor_kind: run?.actorKind ?? 'single-file',
      whole_target: run?.wholeTarget ? 1 : 0,
      item_count: run?.itemCount ?? 0,
      role: run?.role ?? null,
      chatmode: run?.chatMode ?? null,
      run_started_at: run?.startedAt ?? 0,
      dust_version: run?.dustVersion ?? '',
    };
  }

  private safeUpsert(row: RowParams): void {
    if (!this.upsert) {
      return;
    }
    try {
      this.upsert.run(row);
    } catch {
      // Silently dropped — never disrupt a run.
    }
  }
}
