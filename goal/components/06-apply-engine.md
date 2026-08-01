# Apply Engine

> **Phase:** Hub component — depends on all five leaf components. Refine **after** the leaf components' interface shapes are settled. Its needs shape what Catalogue, Target Resolution, Agent Dispatch, and Completion Signalling must each offer.

## Purpose

The core loop and the only place sequencing lives: expand an actor into turns, iterate targets, compose each turn, dispatch, await completion, advance. Owns **orchestration** and the **correlation of in-flight turns**. This is the DIP hub: high-level policy insulated from low-level detail.

## Dependencies

| Direction      | Component                        | Why                                                                             |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| Depends on     | **Actor Catalogue**              | Reads the actor's definition to expand into turns (steps, scope, model).        |
|                | **Target Resolution**            | Gets the ordered work items to iterate over.                                    |
|                | **Agent Dispatch**               | Sends each composed turn to the agent via `AgentGateway` port.                  |
|                | **Completion Signalling**        | Awaits turn completion via `CompletionSource` port before advancing.            |
|                | **Run Metrics**                  | Emits `recordRunStart`, `recordStep`, `recordRunEnd` via `MetricsSink` port.    |
| Depended on by | **Command Surface & Activation** | Invokes the engine with `{ actorId, targetUri, overrideText? }` on user action. |

## Key Design Decisions

### The Apply Policy (Engine Loop)

```
expand actor → enumerate targets → for each target:
    compose instruction → dispatch to agent → await completion → advance
```

This is the **only place sequencing lives**. The engine is deliberately indifferent to what any actor means — it only knows files, ordering, and dispatch.

### Actor-Driven vs User-Driven Behaviours

- **Depth** (actor-driven) — single-file actor is one turn; multi-step actor is K ordered turns over the same target, each awaiting completion before the next.
- **Granularity** (user-driven) — the Webview's Each/Together toggle sets `wholeTarget`, which controls whether the engine dispatches per-file or as one combined unit.

### Instruction Composition

Each step file is read and parsed at dispatch time. The engine composes the final instruction from three pieces:

```
final = compose(step.body, uris)
      + ## Important Note (addendum, if provided)
      + ## Feedback
```

**`addendum`** is the free-text extra instructions collected from the Webview's "Extra Instructions" textarea. When provided, it is placed under the markdown heading `## Important Note` so the agent sees the user's last-minute guidance as a distinct, prominent section. Omitted when the field is blank.

The callback reminder is placed under the `## Feedback` heading so it stands out as a distinct section. It starts with the `--help` option so the agent can self-correct arguments, followed by the required flags and the summary file schema:

```
To signal completion, use the dust-callback command.
Run dust-callback --help first to verify the flag interface.

When done, invoke:
  dust-callback --status done --id ${cid} --summary_file <path/to/summary.json> --workspace ${workspaceName}

The summary file must be valid JSON matching this schema:
  { "confidence": <number 0-100>, "actions": ["<string>", ...], "notes": "<string>" }
```

**Slots.** Two placeholders may appear in the step body:

| Slot               | Single file         | Single folder (`wholeTarget: true`) | Multi-select (`wholeTarget: true` + composite)             |
| ------------------ | ------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `${target}`        | The file name       | The folder name                     | Comma-separated file names (e.g. `"Goal.md, Solution.md"`) |
| `${targetContent}` | Content of the file | *empty*                             | *empty*                                                    |

Slot names not found in the template are left as-is — the agent sees the raw `${slotName}` in the prompt. Unknown slots are harmless.

**`compose` function:**

```typescript
function compose(stepBody: string, uris: vscode.Uri[]): string {
  const target = uris.length === 1
    ? path.basename(uris[0].path)
    : uris.map(u => path.basename(u.path)).join(', ');

  const content = (uris.length === 1 && isFile(uris[0]))
    ? fs.read(uris[0])
    : '';

  return stepBody
    .replace(/\$\{target\}/g, target)
    .replace(/\$\{targetContent\}/g, content);
}
```

### Single vs Multi-Step Dispatch

- **Single-file actor:** one turn per target item.
- **Multi-step actor:** K ordered turns per target item — one per numbered step, each awaiting completion before the next. Same 1→K expansion Ash's `executeWorkflowFile` does via `loadActors` + `composeActorInstruction`.

### Architecture Fit (Ports & Adapters)

The Apply Orchestrator depends **only on ports** — never on adapters or host APIs:

| Port               | Shape                                            | Direction                |
| ------------------ | ------------------------------------------------ | ------------------------ |
| `AgentGateway`     | `dispatch(instruction, mode): void`              | Outbound                 |
| `CompletionSource` | `await(correlationId): Promise<void>`            | Inbound                  |
| `FileSystem`       | `list` / `read` / `write`                        | Inbound (for enumerator) |
| `ActorSource`      | `loadTree(): ActorTree`                          | Inbound                  |
| `MetricsSink`      | `recordRunStart` / `recordRunEnd` / `recordStep` | Outbound                 |

The engine knows nothing about VS Code, pipes, or menus.

### Composition Root

`extension/activate()` is the only place that knows all the concretions: it instantiates the adapters and injects them into the orchestrator. Nothing else constructs its own dependencies (DIP), which keeps every other unit independently testable.

### Testability

Because the orchestrator depends only on ports, the entire apply policy is testable with **no VS Code and no pipes**: inject an Echo `AgentGateway`, an in-memory `FileSystem`, and a `CompletionSource` you resolve by hand. If that test is easy to write, the seams are right; if it isn't, a dependency has leaked.

### Self-Containedness

| Axis of change                                                   | Verdict                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| The apply policy (expand → iterate → dispatch → await → advance) | The only place sequencing lives.                         |
| Cohesion                                                         | High                                                     |
| Single reason to change                                          | Yes (sequencing)                                         |
| Hidden coupling risk                                             | Temptation to leak FS/agent detail in — guard with ports |
| Verdict                                                          | Solid if it touches only ports                           |

### Key Boundaries

- **Dispatch and completion** are two channels, modeled as two ports. They must never be collapsed. This lets the completion transport and dispatch transport evolve independently.
- **Endpoint Identity** is a shared kernel between extension and callback — correctness depends on both computing the identical pipe name. It stays pure and lives in core.

## Pseudo Code

```typescript
async function apply(request: ApplyRequest): Promise<RunResult> {
  const actor = catalogue.getActor(request.actorId);
  const items = targetResolver.resolve(request.targetUris, request.wholeTarget);
  const workspaceName = path.basename(request.workspacePath);

  let stepIndex = 0;
  for (const item of items) {
    const uris = Array.isArray(item.target) ? item.target : [item.target];
    for (const stepPath of actor.steps) {
      const step = parseActorFile(fs.read(stepPath));
      stepIndex++;
      const cid = crypto.randomUUID();
      const instruction = [
        compose(step.body, uris),
        request.addendum ? `## Important Note\n${request.addendum}` : '',
        `## Feedback\nTo signal completion, use the dust-callback command. Run dust-callback --help first to verify the flag interface.\n\nWhen done, invoke:\n  dust-callback --status done --id ${cid} --summary_file <path/to/summary.json> --workspace ${workspaceName}\n\nThe summary file must be valid JSON matching:\n  { "confidence": <number 0-100>, "actions": ["<string>", ...], "notes": "<string>" }`,
      ].filter(Boolean).join('\n\n');

      agentGateway.dispatch(instruction, request.model ?? step.model ?? actor.model);
      await completionSource.await(cid);
    }
  }

  return { itemCount: items.length, stepCount: stepIndex };
}

function parseActorFile(raw: string): { body: string; model?: Role } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);
  if (!match) return { body: raw };
  const fmLines = match[1].split('\n').filter(Boolean);
  const fm: Record<string, string> = {};
  for (const line of fmLines) {
    const [key, ...rest] = line.split(':');
    fm[key.trim()] = rest.join(':').trim();
  }
  return { body: match[2].trim(), model: fm['model'] as Role | undefined };
}

function compose(stepBody: string, uris: vscode.Uri[]): string {
  const target = uris.length === 1
    ? path.basename(uris[0].path)
    : uris.map(u => path.basename(u.path)).join(', ');

  const content = (uris.length === 1 && isFile(uris[0]))
    ? fs.read(uris[0])
    : '';

  return stepBody
    .replace(/\$\{target\}/g, target)
    .replace(/\$\{targetContent\}/g, content);
}
```

## Key Data Types

```typescript
interface ApplyRequest {
  actorId: string;
  targetUris: vscode.Uri[];
  wholeTarget: boolean;
  workspacePath: string;     // workspace root path, used to derive the `--workspace` value
  model?: Role;
  addendum?: string;         // extra instructions from the Webview's "Extra Instructions" textarea
}

interface RunResult {
  itemCount: number;
  stepCount: number;
}
```

## Exposed Interface

```typescript
interface ApplyEngine {
  /** Run the full apply loop: expand → enumerate → compose → dispatch → await → advance. */
  apply(request: ApplyRequest): Promise<RunResult>;
}
```


## Relevant Acceptance Criteria

From **Engine (Apply)**:

- Applying to a **file** dispatches over that one file; applying to a **folder** enumerates targets in deterministic (numeric-then-lexical) order.
- **`wholeTarget: false`** iterates per file; **`wholeTarget: true`** dispatches once with all target content as one unit.
- A **multi-step actor** runs its steps in numeric order, each awaiting completion before the next.
- The whole target is passed as payload (no per-section reads selection).

From **Human-in-the-Loop**:

- The chain never auto-advances across actor boundaries without the human initiating the next `dust.apply`; artifacts between steps remain plain, editable files.

From **Model Roles**:

- `model` front-matter is treated as an abstract role (`Reason` / `Build` / `Review` / `Write` / `Repair`), passed directly as the VS Code chat mode. If no role specified, VS Code uses the user's configured default.

### Configuration

*(No configuration keys — the role name is the chat mode name, passed directly.)*
