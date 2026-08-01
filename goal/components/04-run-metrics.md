# Run Metrics

> **Phase:** Leaf component — no dependencies on sibling components. Refine in parallel with other leaf components. Only Apply Engine emits to it, and it is optional/best-effort.

## Purpose

Optional, best-effort recording of run data that **never disrupts a run**. Owns observation — the what, where, and how of persisting metrics — and nothing else. This is a purely passive consumer: the engine calls it, it records, no response is required or awaited.

## Dependencies

| Direction | Component | Why |
|-----------|-----------|-----|
| Depends on | *(none)* | No sibling dependencies. Internally depends on a SQLite store (or no-op substitute) at `<workspace>/.dust/metrics.db`. |
| Depended on by | **Apply Engine** | The engine emits `recordRunStart`, `recordStep`, `recordRunEnd` calls during the apply loop. |

## Key Design Decisions

### Separate from Ash's Telemetry Stack

Ash ships a full telemetry stack (span/point events over protocol client, daemon fan-out). Dust deliberately does **not** adopt that machinery — no daemon, no protocol channel, no WebSocket. Instead it persists a small, local SQLite store owned by the extension.

> **Not the SQLite we dropped.** Ash's daemon-side correlation/routing SQLite was dropped. This is a different, single-process store whose only purpose is observability/analytics — it never participates in completion routing.

### Storage Location

One database per workspace at `<workspace>/.dust/metrics.db`. Best-effort: a failed write must never disrupt an apply run — silently dropped on failure.

Uses `better-sqlite3` (synchronous, no async overhead). The DB is initialized once on extension activation:

```sql
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
```

### Schema — Single Table `runs` (One Row per Step)

One physical table, one row per dispatched turn (per file, or per numbered step). Run-level attributes are denormalized; run rollups are derived at read time via `GROUP BY run_id`.

| Field | Grain | Source | Why it matters |
|-------|-------|--------|----------------|
| `run_id` | run (repeated) | generated (uuid) | Groups a run's steps |
| `actor_id`, `actor_kind` | run (repeated) | actor registry | Which actors get used (adoption) |
| `whole_target` | run (repeated) | engine | `true` = combined dispatch, `false` = per-file |
| `item_count` | run (repeated) | target enumerator | Fan-out size per run |
| `role` → `chatmode` | run (repeated) | role resolver | Which roles/chatmodes are exercised |
| `run_started_at` | run (repeated) | engine | Run start (min across rows) |
| `dust_version` | run (repeated) | package | Version-over-version comparison |
| `step_id` | step | engine | Row identity |
| `step_index` | step | engine | Ordering within a run |
| `correlation_id` | step | dispatch | Joins dispatch to callback frame |
| `item_path` | step | engine | Which file / numbered step |
| `dispatched_at`, `completed_at`, `duration_ms` | step | engine | Per-turn latency |
| `status` (`done`\|`error`\|`needs-input`) | step | callback | Authoritative turn outcome |
| `confidence` (0–100) | step | callback summary | Agent's self-reported confidence score |
| `actions_count` / `actions` | step | callback summary | What agent claims it did |
| `notes` | step | callback summary | Optional free-text signal |

Run rollups are queries, not columns:

- `run.ended_at = MAX(completed_at)`
- `run.duration_ms = MAX(completed_at) − MIN(dispatched_at)`
- `run.outcome = worst step status` (or cancelled sentinel)

Runs with no dispatched step still get one sentinel row (`step_index = 0`, `status = error`), so every run is represented and the "one row per step" invariant holds.

### Callback Summary Integration

The last four step fields mirror the completion callback summary (`ash-callback`'s `--status` + `## Outcome score`, `## Actions`, `## Notes`). Persisting them is nearly free: the completion adapter already parses the frame to resolve the waiter; it hands the parsed summary to the metrics sink on the same resolve path.

### Architecture Fit (Ports & Adapters)

| Layer | Element | Details |
|-------|---------|---------|
| Port | `MetricsSink` | `recordRunStart` / `recordRunEnd` / `recordStep` — core depends only on the interface |
| Adapter | SQLite Metrics Adapter | Implements against `.dust/metrics.db` |
| Test substitute | In-memory sink | Substitutable by a no-op sink for tests |

The core never knows it persists to SQLite.

### Self-Containedness

| Axis of change | Verdict |
|----------------|---------|
| Observability | Swappable concern; core never knows implementation. |
| Cohesion | High |

## Pseudo Code

```typescript
function recordRunStart(run: RunStart): void {
  // Sentinel row ensures every run is represented, even if zero steps dispatch.
  safeInsert({
    runId: run.runId,
    stepIndex: 0,
    status: 'error',   // overwritten by first real step
    dispatchedAt: null,
    completedAt: null,
    // ... run-level fields denormalized
  });
}

function recordStep(step: StepRecord): void {
  safeInsert({
    runId: step.runId,
    stepIndex: step.index,
    correlationId: step.correlationId,
    itemPath: step.itemPath,
    dispatchedAt: step.dispatchedAt,
    completedAt: step.completedAt,
    durationMs: step.completedAt - step.dispatchedAt,
    status: step.status,
    confidence: step.summary?.confidence,
    actions: JSON.stringify(step.summary?.actions ?? []),
    notes: step.summary?.notes ?? null,
  });
}

function recordRunEnd(runId: string): void { /* no-op; rollups are read-side queries */ }

function safeInsert(row: Record<string, unknown>): void {
  try { db.insert('runs', row); }
  catch { /* silently dropped — never disrupt a run */ }
}
```

## Key Data Types

```typescript
interface RunStart {
  runId: string;
  actorId: string;
  actorKind: 'single-file' | 'multi-step';
  wholeTarget: boolean;
  itemCount: number;
  role: string;
  chatMode: string;
  startedAt: number;       // Date.now()
  dustVersion: string;
}

interface StepRecord {
  runId: string;
  index: number;
  correlationId: string;
  itemPath: string;
  dispatchedAt: number;
  completedAt: number;
  status: 'done' | 'error' | 'needs-input';
  summary?: CompletionSummary;
}

interface CompletionSummary {
  confidence: number;       // 0–100
  actions: string[];
  notes?: string;
}
```

## Exposed Interface

```typescript
interface MetricsSink {
  /** Called once at the start of a dust.apply run. Writes a sentinel row. */
  recordRunStart(run: RunStart): void;

  /** Called after each dispatched turn completes (callback received). */
  recordStep(step: StepRecord): void;

  /** Called when a run finishes (natural end, error, or cancellation). */
  recordRunEnd(runId: string): void;
}
```

## To Be Refined

*(Nothing deferred. Run data shape is finalized; path is `dust.metrics.db`; rollups are read-side queries.)*

## Relevant Acceptance Criteria

From **Run Metrics (Local SQLite)**:

- Each `dust.apply` writes a run row and one step row per dispatched turn to `<workspace>/.dust/metrics.db`.
- Each step row persists the callback summary (`status`, `confidence` 0–100, `actions`, `notes`) joined by `correlation_id`.
- Metrics are **best-effort**: a DB failure never aborts or blocks an apply run. Always on — no configuration needed.
