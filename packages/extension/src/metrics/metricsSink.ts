import type { CallbackStatus, CompletionSummary } from '@dust/shared';

export type ActorKind = 'single-file' | 'multi-step';

export interface RunStart {
  runId: string;
  actorId: string;
  actorKind: ActorKind;
  wholeTarget: boolean;
  itemCount: number;
  role: string;
  chatMode: string;
  startedAt: number;
  dustVersion: string;
}

export interface StepRecord {
  runId: string;
  index: number;
  correlationId: string;
  itemPath: string;
  dispatchedAt: number;
  completedAt: number;
  status: CallbackStatus;
  summary?: CompletionSummary;
}

/**
 * Port: best-effort observation of apply runs. The core depends only on this
 * interface — it never knows whether metrics persist to SQLite, memory, or a
 * no-op. Implementations must never throw or block a run.
 */
export interface MetricsSink {
  /** Called once at the start of a dust.apply run. Writes a sentinel row. */
  recordRunStart(run: RunStart): void;

  /** Called after each dispatched turn completes (callback received). */
  recordStep(step: StepRecord): void;

  /** Called when a run finishes (natural end, error, or cancellation). */
  recordRunEnd(runId: string): void;
}
