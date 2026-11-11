# Dust — Technical Design (Condensed)

> Condensed from `design.md`. Covers mechanisms, architecture, and component decomposition.

## 1. Actor Discovery & Resolution

Actors discovered from three roots, merged nearest-wins by relative path:

| Priority | Root                        | Scope         |
| -------- | --------------------------- | ------------- |
| Highest  | `<workspace>/.actors/`      | Project-local |
| Middle   | `~/.dust/actors/`           | User global   |
| Lowest   | extension bundled `actors/` | Defaults      |

Numeric prefixes drive display order (stripped from labels). Folders become sub-menus; `.md` files become leaf commands. Tree recursed to any depth.

## 2. Folder Classification

- **Single-File Actor:** One `.md` file = one dispatch per target.
- **Multi-Step Actor:** Folder of numbered `.md` steps run in order over the same target.
- **Disambiguation:** Direct children are numbered `.md` step files → leaf; contains sub-folders or non-step actors → branch. An `actor.yml` sentinel can force leaf.

Each step file carries its own front-matter (`subagent`, `model`).

## 3. Actor File Format

YAML front-matter + body with interpolation slots: `${targetContent}`, `${targetPath}`, `${targetRelPath}`, `${targetFileName}`.

## 4. Front-Matter Schema

| Key        | Type           | Meaning                                                    |
| ---------- | -------------- | ---------------------------------------------------------- |
| `title`    | string         | Optional display label override                            |
| `model`    | role enum      | Abstract role (`Reason`/`Build`/`Review`/`Write`/`Repair`) |
| `subagent` | string         | Chat mode / persona hint                                   |
| `scope`    | item \| folder | Per-item iteration vs whole-target. Default `item`.        |

Validated with TypeBox at load. Target files honor only `model`.

## 5. Model Role → Chatmode Resolution

Five predefined roles:

| Role       | Purpose                                      |
| ---------- | -------------------------------------------- |
| **Reason** | Solutioning, architecture, planning          |
| **Build**  | Implementation, scaffolding, code generation |
| **Review** | Review, assessment, gap-finding              |
| **Write**  | Documentation, summarization, prose          |
| **Repair** | Debugging, refactor, rework from feedback    |

Precedence: target-file `model` overrides actor `model` overrides `dust.defaultRole`. Mapped role → chatmode → model via configurable `dust.roleChatmodes`.

## 6. Engine Mechanics

Flow: right-click → actor sub-menu → `applyActor(actorPath, targetUri)` → enumerate targets → for each target: compose instruction → dispatch to Copilot Chat → await completion → next. Deterministic ordering, completion-gated via callback (§8).

**Target enumeration:** file → single item; folder → recursive walk (numeric-then-lexical). **Scope:** per-item or whole-target driven by actor's `scope` front-matter.

## 7. Reuse Map

~50-60% logic reusable from existing codebase. Key sources:

- Actor model, section assembly, instruction composition (`directory-mode.ts` + `interpolate.ts`): ~90-95% portable
- Actor-tree resolution: ~70% (re-pointed at new roots, extended to sub-menus)
- Agent dispatch (`copilot-bridge.js`): ~85% (direct `executeCommand`, drop transport code)
- Completion coordination: ~30% (keep pipe naming, drop daemon/router stack)

## 8. Completion Signalling

Workspace-keyed named pipe + global `dust-callback` CLI. Extension owns a named pipe (`\\.\pipe\dust-<label>-<hash>`); the agent invokes `dust-callback` at step end with `--status`, `--id` (correlation_id), `--summary_file`, `--workspace`. Extension resolves waiter by correlation_id and advances. No daemon, no WebSocket — in-process listener only.

## 9. Run-Metrics Persistence

SQLite at `<workspace>/.dust/metrics.db`. One table `runs`, one row per step. Run-level attributes denormalized; rollups via `GROUP BY run_id`. Fields: run metadata (id, actor, target, scope, role, timestamps, version) + step data (step_id, index, correlation_id, path, timings, status, outcome_score, actions, notes). Implemented as a `MetricsSink` port + SQLite adapter, substitutable for tests. Config: `dust.metrics.enabled`, `dust.metrics.db`.

## 10. Configuration

Single Explorer context-menu command `"Apply Dust Actor…"` (`dust.open`) opens a Webview surface rendering the actor tree, with per-run tweaks (model, scope, addendum). Config keys: `dust.actorRoots`, `dust.defaultRole`, `dust.roleChatmodes`, `dust.metrics.enabled`, `dust.metrics.db`.

## Architecture: Ports & Adapters

Domain core (pure, no VS Code/IPC):
- **Actor Schema** — vocabulary + TypeBox validation
- **Actor Parser** — bytes → `ActorDefinition`, folder classification
- **Target Enumerator** — `(targetUri, scope) → ordered WorkItem[]`
- **Instruction Composer** — slot interpolation, pure function
- **Role Resolver** — role → chatmode lookup
- **Endpoint Identity** — `workspacePath → pipeName` (shared kernel)
- **Apply Orchestrator** — expand → enumerate → compose → dispatch → await → advance

Ports (defined by domain, segregated via ISP):
- `AgentGateway` — `dispatch(instruction, mode): void`
- `CompletionSource` — `await(correlationId): Promise<void>`
- `FileSystem`, `ActorSource`, `CommandTrigger`, `MetricsSink`

Adapters: VS Code Chat, Named-Pipe Completion, VS Code FS, Actor Source, Webview Surface (`getTree()` → render), SQLite Metrics, `dust-callback` CLI.

Dependency direction: everything points inward toward the pure core. Adapters implement ports; core never imports adapters. The orchestrator is testable with no VS Code and no pipes.

## Repository Layout

```
dust/
  packages/
    core/         — shared: actor parsing, schema, endpoint/pipe naming, types
    extension/    — VS Code extension (consumes core)
    callback/     — global `dust-callback` bin (consumes core)