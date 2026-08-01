# Completion Signalling

> **Phase:** Leaf component — no dependencies on sibling components. Refine in parallel with other leaf components. Apply Engine cannot advance without this signalling channel.

## Purpose

Learns when a dispatched turn has finished and matches the signal back to the waiting turn. Spans two hosts: the **in-editor listener** (inside the VS Code extension) and the **external callback CLI** (`dust-callback`) the agent invokes on completion. Owns the **inbound completion edge** — and nothing else.

## Dependencies

| Direction | Component | Why |
|-----------|-----------|-----|
| Depends on | *(none)* | No sibling dependencies. Internally depends on Endpoint Identity (shared kernel for pipe naming), OS named pipes, and the `dust-callback` CLI. |
| Depended on by | **Apply Engine** | The engine awaits completion via the `CompletionSource` port before advancing to the next step/file. |

## Key Design Decisions

### Why a Mandatory Callback

Copilot exposes **no public turn-status API**. The engine can only advance once it knows the agent finished the current turn — so the agent itself must signal "done" out-of-band. This keeps the human-in-the-loop chain honest (each step truly completes before the next begins) without any daemon or protocol server.

### Solution — Workspace-Keyed Named Pipe + Global Callback CLI

1. **Extension** owns a named pipe whose name embeds workspace identity (`basename` of workspace path) — so multiple windows don't cross-talk. No discovery file is written; both sides compute the pipe name from the workspace path independently via the shared `endpointIdentity` kernel.
2. **`dust-callback` CLI** (npm global install, package `@dust/callback`) is invoked by the agent at the end of each step (baked into the actor prompt). It receives the workspace name via the mandatory `--workspace` flag and computes the pipe name via `endpointIdentity`, then writes a completion frame directly.
3. On receiving the frame, the in-process listener matches `correlation_id` → resolves the step's waiter → engine advances.

No ashd singleton, no correlation router, no WebSocket. The listener lives inside the extension; routing is implicit in the per-workspace pipe name.

**Distinct naming:** `dust-callback` must not collide with the existing `ash-callback` global.

### Callback Input Contract

Four mandatory fields:

| Field | Flag | Purpose |
|-------|------|---------|
| `status` | `--status <done\|error\|needs-input>` | Authoritative turn outcome; drives the waiter and the metrics step row. |
| `correlation_id` | `--id <id>` | Routes the frame to the exact awaiting step. Non-optional because the engine may have parallel steps in flight. |
| `summary_file` | `--summary_file <path>` | Path to a JSON file matching the summary schema below. File path not inline — avoids argv limits. |
| `workspace` | `--workspace <name>` | Workspace folder name — the same `basename` the extension uses to name the pipe. |

`--help` is **mandatory**. The bin prints full usage with every flag, its type, whether it is required, and a copy-pasteable example. The agent is the primary caller — `dust-callback --help` is the contract it consults to self-correct. Additionally, if any required argument is missing, the bin prints the error to stderr followed by the full usage and exits with code 1.

### Flow

```
agent finishes step  →  dust-callback --status done \
                            --id <correlationId> \
                            --summary_file <path/to/summary.json> \
                            --workspace <name>
                           │ \\.\pipe\dust-<workspace-name> via endpointIdentity
                           ▼
               \\.\pipe\dust-<workspace-name>   (extension listener)
                           ▼
               engine: match correlation_id → resolve waiter → dispatch next step/file
```

### Architecture Fit (Ports & Adapters)

| Layer | Element | Details |
|-------|---------|---------|
| Port | `CompletionSource` | `await(correlationId): Promise<void>` — inbound only. Never shares an interface with dispatch. |
| Adapter (extension side) | Named-Pipe Completion Adapter | Opens workspace pipe (name from Endpoint Identity), resolves waiter on frame arrival. |
| Adapter (CLI side) | `dust-callback` | Producer on the completion transport. Depends on Endpoint Identity only. Receives workspace name via `--workspace`. |
| Shared kernel | Endpoint Identity | `basename(workspacePath)` → pipe name. Pure, deterministic. The only code both hosts import. |

### Self-Containedness

| Axis of change | Verdict |
|----------------|---------|
| How completion is signalled / transported | Swap transport (pipe today, something else tomorrow) without touching policy. |
| Workspace → endpoint name | Must change in exactly one place (shared kernel). |
| Cohesion | High |

### Manual Advance (No Timeout)

The engine waits **indefinitely** for the callback — there is no automatic timeout. If the agent never calls back (crash, hang, or the user wants to force the step to end), the user can invoke `dust-callback` manually from the terminal:

```
dust-callback --status done --id <correlationId> --summary_file <path> --workspace <name>
```

This resolves the same pipe and delivers a frame just as the agent would, allowing the engine to advance without restarting the run. The manual path is the canonical fallback instead of a timeout.

## Pseudo Code

```typescript
// --- Extension side (listener) ---

function startListener(workspacePath: string): CompletionSource {
  const pipeName = endpointIdentity(workspacePath);
  const pipe = namedPipe.createServer(`\\\\.\\pipe\\dust-${pipeName}`);

  const waiters = new Map<string, (frame: CompletionFrame) => void>();

  pipe.on('frame', (raw: unknown) => {
    const frame = validateFrame(raw);
    const resolve = waiters.get(frame.correlationId);
    if (resolve) {
      waiters.delete(frame.correlationId);
      resolve(frame);   // unblocks the engine's await below
    }
  });

  return {
    await: (correlationId: string) => new Promise<CompletionFrame>((resolve) => {
      waiters.set(correlationId, resolve);
    }),
  };
}

// --- CLI side (dust-callback) ---

async function dustCallback(args: CallbackArgs): Promise<void> {
  if (args.help) { printUsage(); process.exit(0); }

  const missing = validateRequired(args, ['status', 'id', 'summaryFile', 'workspace']);
  if (missing.length > 0) {
    console.error(`Error: missing required arguments: ${missing.join(', ')}`);
    printUsage();
    process.exit(1);
  }

  const pipeName = endpointIdentity(args.workspace!);
  const pipe = namedPipe.connect(`\\\\.\\pipe\\dust-${pipeName}`);
  const summary = validateSummary(JSON.parse(fs.readFile(args.summaryFile!)));
  pipe.write({ status: args.status!, correlationId: args.id!, summary });
  pipe.end();
}
```

## Key Data Types

```typescript
type CallbackStatus = 'done' | 'error' | 'needs-input';

interface CompletionFrame {
  status: CallbackStatus;
  correlationId: string;
  summary: CompletionSummary;
}

/** The JSON schema of the file passed to `--summary_file`. */
interface CompletionSummary {
  /** How confident the agent is in its result. 0–100. */
  confidence: number;
  /** The list of actions the agent claims it performed. */
  actions: string[];
  /** Optional free-text notes from the agent. */
  notes?: string;
}

/** The on-disk JSON schema for `--summary_file <path>`. Validated against this shape. */
const SummaryFileSchema = {
  type: 'object',
  required: ['confidence', 'actions'],
  properties: {
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    actions:   { type: 'array', items: { type: 'string' } },
    notes:     { type: 'string' },
  },
};

// Example file content:
// {
//   "confidence": 85,
//   "actions": ["Read Goal.md", "Produced Solution.md", "Cross-checked against acceptance criteria"],
//   "notes": "The design section could use more detail on error handling."
// }

interface CallbackArgs {
  /** Required. --status <done|error|needs-input> */
  status?: CallbackStatus;
  /** Required. --id <correlationId> */
  id?: string;
  /** Required. --summary_file <path> */
  summaryFile?: string;
  /** Required. --workspace <name> */
  workspace?: string;
  /** --help / -h */
  help?: boolean;
}

```

## Exposed Interface

```typescript
interface CompletionSource {
  /** Returns a promise that resolves when a callback frame matches the given correlation id. */
  await(correlationId: string): Promise<CompletionFrame>;
}

/** Pure function: workspace path → pipe name (`basename`). Shared kernel between extension and CLI. */
function endpointIdentity(workspacePath: string): string;
```

## Distribution

`dust-callback` is published as `@dust/callback` on npm and installed globally:

```
npm install -g @dust/callback
```

This places the `dust-callback` binary on `PATH` so the agent can invoke it from any project directory without a local dependency. The `--help` output includes the npm package name and version for reference.

## Finalized Specifications

### Endpoint Identity

```typescript
import { basename } from 'path';

function endpointIdentity(workspacePath: string): string {
  return basename(workspacePath);
}
// Pipe name: \\.\pipe\dust-<workspace-name>
// Example: \\.\pipe\dust-my-project
```

The pipe name uses the workspace folder name in clear text. The extension derives it from the workspace path; the CLI receives it via the mandatory `--workspace <name>` flag (injected into the agent's prompt by the engine). Multiple VS Code windows on different workspaces get different pipes; two windows on the same workspace share one pipe (correct — same workspace, same listener).

### Signalling Channel

| Property | Specification |
|----------|--------------|
| Transport | Named pipe (`\\.\pipe\dust-<workspace-name>`) |
| Direction | One-way: CLI writes, extension reads |
| Encoding | Newline-delimited JSON (`\n` terminated) |
| Handshake | None — CLI connects, writes one frame, disconnects |
| Frame | `CompletionFrame` JSON object (see types below) |
| Acknowledgment | None — extension does not reply |

The pipe is created by the extension on activation and destroyed on deactivation. The CLI opens it, writes one line of JSON, and disconnects. The extension listener reads each line, parses the JSON, validates the frame, and resolves the matching waiter.

### Callback Contract (Final)

```
dust-callback --status <done|error|needs-input> \
              --id <correlationId> \
              --summary_file <path/to/summary.json> \
              --workspace <name>

dust-callback --help    # prints full usage
dust-callback -h        # alias for --help
```

**Exit codes:** `0` on success, `1` on missing arguments or invalid summary file, `2` on pipe connection failure.

The `--workspace` value is the workspace folder name — injected into the agent's prompt template by the engine. `--status` and `--id` are likewise injected so the agent knows what to signal on completion.

## Relevant Acceptance Criteria

From **Completion Callback (Mandatory)**:

- The extension opens a workspace-keyed named pipe; the CLI receives the workspace name via the mandatory `--workspace` flag — no discovery file needed.
- The global `dust-callback` bin resolves the workspace pipe and delivers a completion frame.
- The engine advances only on receiving the frame. If the agent fails to call back, the step can be ended manually by invoking `dust-callback` from the terminal (the engine waits indefinitely).
- `dust-callback` does not collide with the existing `ash-callback` global.
- Multiple VS Code windows/workspaces do not cross-talk (pipe name is path-scoped).
