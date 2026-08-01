# Dust — A Condensed VS Code Extension

> **Status:** Idea + High-Level Design (for alignment)  
> **Scope:** a standalone VS Code extension whose single job is to apply an actor over a selected file or folder (recursively) from the Explorer right-click menu. Actors are just markdown files organized in a folder tree; the extension is deliberately ignorant of what any actor means.

This document distills the full Ash system (see `ash-system-architecture-hld.md`) down to the one capability that carries most of the value, and estimates how much of the existing code base we can reuse.

This is a brand-new, standalone project — not a change to `ash-vscode-syntax/` or any other existing package. We borrow/port logic from the current code base (see §4), but nothing in `ash-js`, `ashd`, `ash-protocol`, or `ash-vscode-syntax` is modified. The intention is one project (single repo) that owns all the logic. That one project still produces two installable artifacts because they run in different hosts:

- the VS Code extension (installed from VSIX / Marketplace), and
- the global callback CLI (`npm install -g`), invoked by the agent (§5).

Shared code lives once in the repo and is consumed by both artifacts. The repo layout, config, and command surface are in the tech design (`dust-tech-design.md` §10).

## 1. The Idea in One Sentence

Right-click a file or folder → "Apply Dust Actor…" opens a Webview panel → choose an actor → the extension walks the target (recursively if a folder) and dispatches each item to Copilot Chat framed by that actor's instructions.

Everything else in Ash (the .ash language, the CLI, the daemon, the correlation router, the WebSocket protocol) is out of scope. What remains is three orthogonal layers that already exist conceptually in Ash but are here stripped to their essence.

### 1.1 The Three Layers (and Their Strict Separation)

| Layer | Responsibility | Knows about... |
|-------|---------------|----------------|
| Engine | Traverse a target file/folder tree in deterministic order; for each item, compose actor + item context and dispatch it to the agent; await completion; advance. | Files, ordering, dispatch. Not what actors do. |
| Actors | A folder tree of markdown files. An actor is either a single `.md` file or a numbered-prefix folder of `.md` steps run in order over each target (persona + instructions). | Their own prompt text. Nothing about the engine. |
| UX | Map the actor folder tree 1:1 into nested Explorer context-menu sub-menus. Selecting a leaf runs `engine.apply(actor, target)`. | The actor tree shape only. Not actor content or engine internals. |

The power comes from that indifference: the engine does not care what is inside the target folder, the actor files do not care about traversal, and the UX does not care what an actor is about — it only mirrors a directory tree into menus.

### 1.2 The Motivating Pipeline (Example, Not Built-in)

The chain below is just content — a set of actor files a user could ship. The extension has no knowledge of these names or their order:

```
Goal.md
  └─(apply "Solutioning")→ Solution.md
       └─(apply "Design")→ designs/{ux-design.md, technical-design.md, component-architecture.md}
            └─(apply "Plan" over designs/)→ Implementation-Plan.md
                 └─(apply "Scaffold")→ action-plan/  (task-tree of folders+files)
                      └─(apply "Implement" over action-plan/)→ code
```

Each arrow is a human right-click choosing the next actor. The artifacts between steps are ordinary files the user can inspect and edit — the extension never owns a hidden state machine.

**Human-in-the-loop is crucial.** Between every step, a human is expected to review and revise the produced artifacts — injecting insight, taste, and judgement the model cannot supply. The chain is deliberately not automated end to end; the pause-and-refine at each boundary is a core feature, not a gap.

## 2. Actors as a Folder Tree → Menus as a Mirror

An actor is user-authored content: a markdown file (persona + instructions), organised in a folder tree that mirrors 1:1 into nested Explorer sub-menus — folders become sub-menus, `.md` files become clickable leaves, to any depth. Actors are both predefined (bundled defaults) and user-defined (project-local and user-global), so anyone can add or override an actor by dropping a file.

An actor leaf is either a **single file** (one dispatch per target) or a **numbered multi-step folder** (ordered steps run over the same target, e.g. implement → assess → rework). Because a multi-step actor is just an ordered set of steps, actors compose into longer actors.

A step's `model` front-matter names an abstract role (see §2.1); the whole target is passed as the payload (no per-section selection) to keep it simple.

> → Discovery roots & precedence, folder-vs-actor disambiguation, file format & interpolation slots, and the front-matter schema live in the tech design: `dust-tech-design.md` §1–§4.

### 2.1 Model as an Abstract Role (Portable Across LLMs)

`model` is not a specific LLM id — it names the **kind of intelligence** a step wants (`Reason`, `Build`, `Review`, `Write`, `Repair`), so actors stay portable as available models change. A target file may override the actor's role for itself. The five roles map to reasoning / implementation / review / writing / repair, and users can add their own.

> → How roles resolve to a concrete model (VS Code chatmode mapping, precedence): `dust-tech-design.md` §5.

## 3. Engine: Applying an Actor over a Target

The engine's whole job: given a chosen actor and a right-clicked target, walk the target (a single file, or a folder recursively in deterministic order), frame each item with the actor's instructions, dispatch it to Copilot Chat, wait for the turn to finish, then advance. It is deliberately indifferent to what any actor means.

Two behaviours the actor (not the engine) chooses:

- **Granularity** — apply per file (`scope: item`) or over the whole folder as one unit (`scope: folder`, e.g. "Summarize" / "Plan").
- **Depth** — a single-file actor is one turn; a multi-step actor is K ordered turns over the same target, each awaiting completion before the next.

**Completion** — knowing a turn is "done" before advancing — is the one hard part; it is a mandatory callback (§5).

> → Enumeration/ordering, target-type awareness, dispatch shapes, and the engine flow diagram: `dust-tech-design.md` §6.

## 4. How Much We Reuse from Ash

Most of the valuable logic already exists in Ash and ports with little change: the actor + context + composition core (`directory-mode.ts` + `interpolate.ts`, ~90%) and the one-line Copilot dispatch (~85%). Traversal/ordering and actor resolution are reused as ideas (~60–70%). The heavy Ash machinery — daemon, protocol, correlation routing, the .ash language — is dropped as unnecessary here.

**Bottom line:** ~50–60% of the logic we'd otherwise write is liftable; the bulk of the original repository is not needed.

> → Full concern-by-concern reuse table and net picture: `dust-tech-design.md` §7.

## 5. Completion Signalling (Mandatory Callback)

The callback is not optional: the engine can only advance once it knows the agent finished the current turn, and Copilot exposes no turn-status API — so the agent itself signals "done" out-of-band. This keeps the human-in-the-loop chain honest (each step truly completes before the next begins) without any daemon or protocol server.

The signal carries a small callback summary (status + an outcome score, actions, and notes) which we also persist as run metrics (§6).

> → Transport mechanism (workspace-keyed named pipe + the global `dust-callback` bin, discovery file, frame flow): `dust-tech-design.md` §8.

## 6. Run Metrics (Harvesting Runtime Data)

Even without Ash's telemetry stack, harvesting runtime data is essential for product improvement, so each run is persisted locally for later analysis. Dust records, per apply run and per dispatched step, the key metrics — which actors/roles get used, fan-out, durations, outcomes — and, on each step, the callback summary (status, outcome score 0–100, actions, notes) from §5.

It is local-first and opt-in-friendly: stored on the user's machine, best-effort (never blocks a run), and disableable. What (if anything) to aggregate beyond the machine is deferred.

> → SQLite schema (run/step tables, callback-summary mapping), best-effort semantics, and config: `dust-tech-design.md` §9.

## 7. How We Build It (Architecture)

The component decomposition — the how — lives in a dedicated companion so this document stays focused on what we build. It reasons the split from first principles (axes of change → SRP seams, Ports & Adapters, SOLID) and includes the inward-dependency diagram, the ports/adapters catalog, self-containedness verdicts, and the package/module sketch.

See `dust-architecture-decomposition.md`.

In one line: a pure domain core (actor schema/parser, target enumerator, instruction composer, role resolver, endpoint identity, apply orchestrator) surrounded by ports (`AgentGateway`, `CompletionSource`, `FileSystem`, `ActorSource`, `CommandTrigger`, `MetricsSink`) whose adapters (VS Code chat, named-pipe callback, SQLite metrics, menu UI, `dust-callback` CLI) all depend inward — so engine, actors, and UX stay mutually ignorant.

## 8. Why This Is a Faithful Condensation

- **Same actor concept**, same file format as Ash's `actors/` — user-authored markdown with a persona, numeric-ordered. Existing actor files could be reused unchanged.
- **Same dispatch mechanism** — supported `workbench.action.chat.open`, no fragile UI automation.
- **Radically less plumbing** — no language, no CLI, no daemon, no protocol, because a single-process, human-in-the-loop extension does not need cross-process correlation.
- **Strict layer separation preserved** — engine/actors/UX stay mutually ignorant, which is the property that made the example pipeline (Goal → Solution → Design → Plan → Scaffold → Implement) expressible as content, not code.

## 9. Acceptance Criteria

The MVP is considered done when all of the following hold:

### Actors & Discovery

- Actors are discovered from all three roots (project-local `.actors/`, user global `~/.dust/actors/`, bundled) and merged nearest-wins by relative path.
- A single `.md` file loads as a single-file actor; a folder of numbered `.md` steps loads as a multi-step actor; a folder of sub-folders/non-step actors loads as a sub-menu — per the disambiguation rule (`dust-tech-design.md` §2).
- Front-matter is validated against the schema (`dust-tech-design.md` §4); malformed front-matter fails fast with a clear, actionable message and does not crash the extension.

### UX (Command Surface)

- Right-clicking a file or folder in the Explorer offers a single "Apply Dust Actor…" entry that opens a Dust panel (Webview) mirroring the actor tree 1:1, with numeric prefixes stripped from labels and nesting to arbitrary depth. The panel previews the chosen actor before running and exposes per-run tweaks (model, whole-target vs walk, and a free-text one-time addendum).
- Choosing an actor invokes `dust.apply` with the correct `{ actorId, targetUri }` (plus any per-run `overrideText`).

### Engine (Apply)

- Applying an actor to a file dispatches over that one file; applying to a folder enumerates targets in deterministic (numeric-then-lexical) order.
- `scope: item` iterates per target; `scope: folder` dispatches once with the whole target as context.
- A multi-step actor runs its steps in numeric order, each awaiting completion before the next.
- The whole target is passed as payload (no per-section reads selection).

### Model Roles

- `model` front-matter is treated as an abstract role (`Reason` / `Build` / `Review` / `Write` / `Repair`), resolved via `dust.roleChatmodes` to a chatmode; target-file role overrides actor role overrides `dust.defaultRole`; unknown role falls back to the default with a warning.

### Completion Callback (Mandatory)

- The extension opens a workspace-keyed named pipe and writes `.dust/endpoint.json`.
- The global `dust-callback` bin resolves the workspace pipe and delivers a completion frame; the engine advances only on receiving it. If the agent fails to call back, the step can be ended manually by invoking `dust-callback` from the terminal (the engine waits indefinitely).
- `dust-callback` does not collide with the existing `ash-callback` global.
- Multiple VS Code windows/workspaces do not cross-talk (pipe name is path-scoped).

### Human-in-the-Loop

- The chain never auto-advances across actor boundaries without the human initiating the next `dust.apply`; artifacts between steps remain plain, editable files.

### Run Metrics (Local SQLite)

- Each `dust.apply` writes a run row and one step row per dispatched turn to `<workspace>/.dust/metrics.db`.
- Each step row persists the callback summary (`status`, `outcome_score` 0–100, `actions`, `notes`) joined by `correlation_id`.
- Metrics writes are best-effort: a DB failure never aborts or blocks an apply run.
- Metrics can be disabled via `dust.metrics.enabled`, and the store is local-only by default.

### Project Shape

- Delivered as a new standalone repo producing two installable artifacts (VS Code extension + `npm install -g` callback); no changes to `ash-vscode-syntax`, `ash-js`, `ashd`, or `ash-protocol`.

## References

- Technical design (the how): `dust-tech-design.md`
- Component decomposition (the how): `dust-architecture-decomposition.md`
- Full system: `ash-system-architecture-hld.md`
- Actor model & cascade: `ash-directory-mode-extensions.md`
- Actor/UX unification: `ash-directory-mode-actors-unification.md`
- Reused dispatch: `ash-vscode-syntax/copilot-bridge.js`
- Reused core: `ash-js/src/directory-mode.ts`, `ash-js/src/interpolate.ts`
