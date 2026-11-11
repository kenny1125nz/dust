# Dust — A Condensed VS Code Extension (Summary)

> **Status:** Idea + High-Level Design  
> **Scope:** Standalone VS Code extension. Right-click a file/folder → "Apply Dust Actor…" → pick an actor → engine dispatches each target to Copilot Chat framed by that actor's markdown instructions. Actors are just `.md` files in a folder tree; the extension is deliberately ignorant of what any actor means.

This is a new standalone repo producing two artifacts: the VS Code extension and a global `dust-callback` CLI (`npm install -g`). Shared code lives once, consumed by both. Nothing in `ash-vscode-syntax`, `ash-js`, `ashd`, or `ash-protocol` is modified.

---

## 1. The Idea in One Sentence

Right-click a file/folder → choose an actor → the extension walks the target (recursively if folder) and dispatches each item to Copilot Chat framed by that actor's instructions.

Everything else from Ash (the .ash language, CLI, daemon, correlation router, WebSocket protocol) is out of scope.

### 1.1 Three Layers (Strictly Separated)

| Layer  | Responsibility                                                                                       | Knows about...                                              |
| ------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Engine | Traverse target tree in deterministic order; compose actor+item context; dispatch; await; advance.   | Files, ordering, dispatch. Not what actors do.              |
| Actors | Folder tree of `.md` files. Single file or numbered multi-step folder (persona + instructions).      | Their own prompt text. Nothing about the engine.            |
| UX     | Map actor folder tree 1:1 into nested Explorer context-menu sub-menus. Leaf triggers `engine.apply`. | The actor tree shape only. Not content or engine internals. |

The power: the engine doesn't care about target content, actors don't care about traversal, and UX only mirrors a directory tree.

### 1.2 Motivating Pipeline (Example, Not Built-in)

```
Goal.md
  └─(apply "Solutioning")→ Solution.md
       └─(apply "Design")→ designs/{ux-design.md, technical-design.md, component-architecture.md}
            └─(apply "Plan" over designs/)→ Implementation-Plan.md
                 └─(apply "Scaffold")→ action-plan/
                      └─(apply "Implement" over action-plan/)→ code
```

Each arrow is a human right-click choosing the next actor. Artifacts between steps are ordinary, editable files. **Human-in-the-loop is crucial** — between every step, a human reviews and revises produced artifacts. The chain is deliberately not automated end-to-end.

---

## 2. Actors as a Folder Tree → Menus as a Mirror

An actor is a markdown file (persona + instructions), organized in a folder tree mirrored 1:1 into nested Explorer sub-menus. Folders → sub-menus, `.md` files → clickable leaves, any depth. Actors come from three roots (project-local `.actors/`, user-global `~/.dust/actors/`, bundled defaults), merged nearest-wins.

An actor is either a **single file** (one dispatch per target) or a **numbered multi-step folder** (ordered steps over the same target). A step's `model` front-matter names an abstract role; the whole target is always the payload.

### 2.1 Model as an Abstract Role

`model` is not an LLM id — it names the **kind of intelligence** a step wants (`Reason`, `Build`, `Review`, `Write`, `Repair`). A target file may override the actor's role. Roles map to chatmodes via `dust.roleChatmodes` config.

---

## 3. Engine: Applying an Actor over a Target

Walk the target (single file, or folder recursively in deterministic order), frame each item with the actor's instructions, dispatch to Copilot Chat, wait for turn completion, advance. The engine is indifferent to what any actor means.

Actor-chosen behaviours:
- **Granularity** — per-file (`scope: item`) or whole-folder (`scope: folder`).
- **Depth** — single-file actor (one turn) or multi-step actor (K ordered turns over the same target).

**Completion** — knowing a turn is "done" before advancing — is the hard part, handled by the mandatory callback (§5).

---

## 4. How Much We Reuse from Ash

~50–60% of logic liftable from existing code. Actor composition core (`directory-mode.ts` + `interpolate.ts`) ~90% portable; Copilot dispatch ~85%; traversal/ordering concepts ~60–70%. The heavy Ash machinery — daemon, protocol, correlation routing, .ash language — is dropped.

---

## 5. Completion Signalling (Mandatory Callback)

Copilot exposes no turn-status API, so the agent signals "done" out-of-band. A workspace-keyed named pipe is opened by the extension; the global `dust-callback` CLI delivers a completion frame. The engine waits indefinitely — if the agent fails to callback, the step can be ended manually via the terminal. Multiple workspaces don't cross-talk (pipe name is path-scoped).

The signal carries a summary (status, outcome score 0–100, actions, notes), persisted as run metrics.

---

## 6. Run Metrics (Local SQLite)

Each run records a row per dispatched turn to `<workspace>/.dust/metrics.db`. Captures: actor, target, role, durations, callback summary. Best-effort (never blocks a run), disableable via `dust.metrics.enabled`. Local-only by default.

---

## 7. Architecture

Pure domain core (actor schema/parser, target enumerator, instruction composer, role resolver, apply orchestrator) surrounded by ports (`AgentGateway`, `CompletionSource`, `FileSystem`, `ActorSource`, `CommandTrigger`, `MetricsSink`). Adapters (VS Code chat, named-pipe callback, SQLite metrics, menu UI, `dust-callback` CLI) all depend inward — engine, actors, and UX stay mutually ignorant. The orchestrator is testable with no VS Code and no pipes.

---

## 8. Acceptance Criteria

| Area                   | Key Criterion                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actors & Discovery** | Three-root merge (project/user/bundled), nearest-wins. `.md` → single, numbered-folder → multi-step, sub-folder → sub-menu. Front-matter validated, fails fast.                                          |
| **UX**                 | Right-click → "Apply Dust Actor…" opens Webview mirroring actor tree 1:1. Per-run tweaks (model, scope, addendum).                                                                                       |
| **Engine**             | File → single dispatch; folder → recursive (numeric-then-lexical). `scope: item` iterates, `scope: folder` dispatches once. Multi-step runs in order, each awaiting completion. Whole target as payload. |
| **Model Roles**        | Abstract roles (`Reason`/`Build`/`Review`/`Write`/`Repair`) resolved via `dust.roleChatmodes`. Target-file overrides actor overrides default. Unknown → default + warning.                               |
| **Completion**         | Workspace-keyed named pipe + `dust-callback` CLI. Engine advances only on receipt. Manual fallback via terminal. No cross-talk between workspaces.                                                       |
| **Human-in-the-Loop**  | Chain never auto-advances across actor boundaries; artifacts remain plain editable files.                                                                                                                |
| **Run Metrics**        | SQLite per-workspace. Callback summary persisted per step. Best-effort, disableable, local-only.                                                                                                         |
| **Project Shape**      | Standalone repo, two artifacts (extension + CLI). No changes to existing Ash packages.                                                                                                                   |

## References

- Technical design: `dust-tech-design.md` / `design-condensed.md`
- Component decomposition: `component-map.md` / `dust-architecture-decomposition.md`
- Full system: `ash-system-architecture-hld.md`