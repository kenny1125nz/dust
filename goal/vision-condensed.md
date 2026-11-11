# Dust — Vision (Condensed)

> **Status:** Idea + High-Level Design, Technical Design, and Component Map (condensed)
> **Scope:** A standalone VS Code extension that applies an actor over a selected file or folder (recursively) from the Explorer right-click menu. Actors are markdown files in a folder tree; the extension is deliberately ignorant of what any actor means.

A brand-new, standalone project (single repo) producing two installable artifacts that share code once:

- **VS Code extension** (installed from VSIX / Marketplace)
- **Global `dust-callback` CLI** (`npm install -g`), invoked by the agent

Nothing in `ash-vscode-syntax`, `ash-js`, `ashd`, or `ash-protocol` is modified.

---

## 1. The Idea

Right-click a file/folder → pick an actor from a nested sub-menu → the extension walks the target (recursively if a folder) and dispatches each item to Copilot Chat framed by that actor's instructions.

Everything else in Ash (.ash language, CLI, daemon, correlation router, WebSocket protocol) is out of scope.

### Three Layers (Strictly Separated)

| Layer  | Responsibility                                                                                                      | Knows about…                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Engine | Traverse target tree (deterministic order); compose actor + item context; dispatch; await completion; advance.      | Files, ordering, dispatch. Not what actors do.          |
| Actors | Folder tree of `.md` files. Single file or numbered-prefix folder of steps (persona + instructions).                | Their own prompt text. Nothing about the engine.        |
| UX     | Mirror the actor folder tree 1:1 into nested Explorer context-menu sub-menus. Leaf → `engine.apply(actor, target)`. | Actor tree shape only. Not content or engine internals. |

The power is the mutual indifference: engine ⇄ actors ⇄ UX each stay ignorant of the others.

### Motivating Pipeline (Content, Not Built-in)

```
Goal.md
  └─(apply "Solutioning")→ Solution.md
       └─(apply "Design")→ designs/{ux-design.md, technical-design.md, component-architecture.md}
            └─(apply "Plan" over designs/)→ Implementation-Plan.md
                 └─(apply "Scaffold")→ action-plan/
                      └─(apply "Implement" over action-plan/)→ code
```

Each arrow is a human right-click. Artifacts between steps are ordinary, editable files — **no hidden state machine**. Human-in-the-loop is crucial: the pause-and-refine at each boundary is a core feature.

---

## 2. Actors as a Folder Tree → Menus as a Mirror

An actor is user-authored markdown (persona + instructions) in a folder tree mirrored 1:1 into nested Explorer sub-menus (folders → sub-menus, `.md` → leaves, any depth). Three discovery roots, merged nearest-wins:

| Priority | Root                   | Scope         |
| -------- | ---------------------- | ------------- |
| Highest  | `<workspace>/.actors/` | Project-local |
| Middle   | `~/.dust/actors/`      | User global   |
| Lowest   | extension bundled      | Defaults      |

Actor leaf is either a **single file** (one dispatch per target) or a **numbered multi-step folder** (ordered steps over the same target). Multi-step actors compose into longer actors.

`model` front-matter names an **abstract role** — `Reason`, `Build`, `Review`, `Write`, `Repair` — not a specific LLM id, so actors stay portable as models change. A target file may override the actor's role for itself. Roles map to chatmodes via configurable `dust.roleChatmodes`.

### Front-Matter Schema

| Key        | Type           | Meaning                                             |
| ---------- | -------------- | --------------------------------------------------- |
| `title`    | string         | Optional display label override                     |
| `model`    | role enum      | Abstract role (resolved role → chatmode → model)    |
| `subagent` | string         | Chat mode / persona hint                            |
| `scope`    | item \| folder | Per-item iteration vs whole-target. Default `item`. |

File format: YAML front-matter + body with interpolation slots `${targetContent}`, `${targetPath}`, `${targetRelPath}`, `${targetFileName}`. Validated with TypeBox at load (fails fast, no crash). Target files honor only `model`.

---

## 3. Engine

Walk the target (file → one item; folder → recursive walk in numeric-then-lexical order), frame each item with the actor's instructions, dispatch to Copilot Chat, await completion, advance. The engine is indifferent to actor meaning.

Actor-chosen behaviours:
- **Granularity** — per-file (`scope: item`) or over the whole folder as one unit (`scope: folder`, e.g. "Summarize"/"Plan").
- **Depth** — single-file actor = one turn; multi-step actor = K ordered turns over the same target, each awaiting completion before the next.

**Completion** — knowing a turn is "done" before advancing — is the one hard part, handled by the mandatory callback (§5).

---

## 4. Reuse from Ash

~50–60% of needed logic is liftable with little change:

| Concern                           | Source                                        | Reuse   |
| --------------------------------- | --------------------------------------------- | ------- |
| Actor model, context, composition | `directory-mode.ts` + `interpolate.ts`        | ~90–95% |
| Actor-tree resolution / cascade   | `resolveActorDir` (re-pointed)                | ~70%    |
| Target traversal / ordering       | `collectWorkflowFiles` (generalized)          | ~60%    |
| Copilot dispatch                  | `copilot-bridge.js` → direct `executeCommand` | ~85%    |
| Completion coordination           | keep pipe naming, drop daemon/router          | ~30%    |

Dropped outright: daemon, protocol, correlation routing, .ash language/parser/CLI/grammar, dispatch transport.

---

## 5. Completion Signalling (Mandatory Callback)

Copilot exposes no turn-status API, so the agent signals "done" out-of-band. A **workspace-keyed named pipe** (`\\.\pipe\dust-<label>-<hash>`) is opened by the extension; a discovery file is written to `<workspace>/.dust/endpoint.json`.

The global **`dust-callback` bin** (must not collide with `ash-callback`) resolves the pipe and writes a completion frame. It takes four mandatory flags: `--status <done|error|needs-input>`, `--id <correlation_id>`, `--summary_file <path>`, `--workspace <id|path>`. `--help` is mandatory (the agent is the primary caller). The engine advances only on receiving the frame — no daemon, no WebSocket, in-process listener only.

The signal carries a callback summary (status, outcome score 0–100, actions, notes), persisted as run metrics (§6). On timeout, degradation (timeout / manual "Continue ▶") is a backup.

---

## 6. Run Metrics (Local SQLite)

Each run records rows to `<workspace>/.dust/metrics.db` — one row per step (one dispatched turn). Run-level attributes denormalized per row; rollups derived via `GROUP BY run_id` (no separate run table). Captures: actor, target kind, scope, item count, role → chatmode, timings, correlation_id, plus the callback summary per step.

Best-effort (a failed write never disrupts a run), disableable via `dust.metrics.enabled`, local-only by default.

---

## 7. Architecture (Component Map)

Seven feature components, each owning its logic and schema:

| Component                        | Responsibility                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| **Actor Catalogue**              | Discover, parse, classify, merge, order actor files. Owns the actor model.              |
| **Target Resolution**            | Explorer selection → work items (file/folder, recursion, scope). Owns traversal.        |
| **Apply Engine**                 | Core loop: expand → iterate → compose → dispatch → await → advance. Owns orchestration. |
| **Agent Dispatch**               | Send composed turn to the coding agent; selects role/mode.                              |
| **Completion Signalling**        | Learn turn completion via in-editor listener + external callback; match to waiter.      |
| **Command Surface & Activation** | Explorer menu trigger + startup wiring (composition root).                              |
| **Run Metrics**                  | Optional, best-effort run recording. Never disrupts a run.                              |

Interactions stay abstract (payloads — actor definition, work items, turns, completions, run records — are refined per component, one per cycle, starting with the Apply Engine). No foundation-first schema tier; shared types grow from the owning component.

Earlier Ports & Adapters decomposition (`dust-architecture-decomposition.md`): superseded as a committed design, but retained as reasoned input — a pure domain core (Actor Schema/Parser, Target Enumerator, Instruction Composer, Role Resolver, Endpoint Identity, Apply Orchestrator) surrounded by ports (`AgentGateway`, `CompletionSource`, `FileSystem`, `ActorSource`, `CommandTrigger`, `MetricsSink`), with adapters (VS Code chat, named pipe, SQLite, Webview surface, `dust-callback` CLI) depending inward. Endpoint Identity is the single shared kernel between the two hosts.

---

## 8. Configuration & Command Surface

One command `dust.apply` taking `{ actorId, targetUri, overrideText? }`. A single `contributes.menus["explorer/context"]` entry — "Apply Dust Actor…" — opens a Webview panel mirroring the actor tree from `getTree()`, previews the chosen actor, exposes per-run tweaks (model, scope, free-text addendum), then invokes `dust.apply`. No static submenu contributions — the tree is rendered at runtime.

Config keys: `dust.actorRoots`, `dust.defaultRole`, `dust.roleChatmodes`, `dust.callbackTimeoutMs`, `dust.metrics.enabled`, `dust.metrics.db`.

---

## 9. Why This Is a Faithful Condensation

- **Same actor concept/file format** — existing Ash actor files could be reused unchanged.
- **Same dispatch mechanism** — supported `workbench.action.chat.open`, no fragile UI automation.
- **Radically less plumbing** — no language, CLI, daemon, or protocol; a single-process, human-in-the-loop extension needs no cross-process correlation.
- **Strict layer separation preserved** — engine/actors/UX stay mutually ignorant.

---

## 10. Acceptance Criteria

| Area                   | Key Criterion                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actors & Discovery** | Three-root merge (project/user/bundled), nearest-wins. `.md` → single; numbered folder → multi-step; sub-folder → sub-menu. Front-matter validated, fails fast.                                          |
| **UX**                 | Right-click → "Apply Dust Actor…" → Webview mirroring the actor tree 1:1, numeric prefixes stripped, arbitrary depth. Per-run tweaks (model, scope, addendum).                                           |
| **Engine**             | File → single dispatch; folder → recursive (numeric-then-lexical). `scope: item` iterates; `scope: folder` dispatches once. Multi-step runs in order, each awaiting completion. Whole target as payload. |
| **Model Roles**        | Abstract roles resolved via `dust.roleChatmodes`; target-file overrides actor overrides `dust.defaultRole`; unknown → default + warning.                                                                 |
| **Completion**         | Workspace-keyed named pipe + `dust-callback` CLI. Engine advances only on receipt. No cross-talk between workspaces. `dust-callback --help` is the contract.                                             |
| **Human-in-the-Loop**  | Chain never auto-advances across actor boundaries; artifacts remain plain editable files.                                                                                                                |
| **Run Metrics**        | SQLite per-workspace, one step row per dispatched turn, callback summary joined by `correlation_id`. Best-effort, disableable, local-only.                                                               |
| **Project Shape**      | Standalone repo, two artifacts (extension + CLI). No changes to existing Ash packages.                                                                                                                   |

## References

- Full HLD: `goal.md` / `goal-condensed.md`
- Technical design: `design.md` / `design-condensed.md`
- Component map: `component-map.md`
- Superseded architecture exploration: `dust-architecture-decomposition.md`