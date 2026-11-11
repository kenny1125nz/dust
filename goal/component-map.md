# Dust — Component Map

> **Top-layer feature components and their collaborations.** Concrete interfaces, schemas, and internal decomposition are deferred to each component's own refinement cycle.

## How to Read

- **Components are feature clusters, not layers.** Each owns its logic and schema. No separate "foundation" tier — shared types grow from the owning component.
- **Interactions are abstract.** Arrows capture intent; concrete signatures are refinement work.
- **Commit now, refine one at a time.** Learnings from each refinement feed back into neighbouring components.

## Components

| Component                        | Responsibility                                                                                                                                | Refined later                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Actor Catalogue**              | Discover, parse, classify, merge, and order actor files across configured roots. Owns the actor model.                                        | Actor definition, tree read-model     |
| **Target Resolution**            | Turn an Explorer selection into work items (file/folder, recursion, per-item vs whole-folder scope). Owns all traversal.                      | Work-item shape                       |
| **Apply Engine**                 | Core loop: expand actor → turns, iterate targets, compose, dispatch, await completion, advance. Owns orchestration and in-flight correlation. | Turn/correlation model, concurrency   |
| **Agent Dispatch**               | Send a composed turn to the coding agent; selects role/mode. Owns the outbound edge.                                                          | Dispatch call, role→mode mapping      |
| **Completion Signalling**        | Detect turn completion via in-editor listener + external agent callback. Match signal to awaiting turn. Owns the inbound edge.                | Signalling channel, callback contract |
| **Command Surface & Activation** | Explorer menu trigger + startup wiring that assembles components. Owns UI trigger and composition root.                                       | Command/menu contributions, config    |
| **Run Metrics**                  | Optional, best-effort run recording that never disrupts a run. Owns observation.                                                              | Run record shape, storage             |

## Interactions

```
Command Surface ──menu tree──▶ Actor Catalogue
Command Surface ──apply to target──▶ Apply Engine
Apply Engine ──actor definition──▶ Actor Catalogue
Apply Engine ──work items──▶ Target Resolution
Apply Engine ──send a turn──▶ Agent Dispatch ──turn──▶ coding agent
Apply Engine ──await completion──▶ Completion Signalling
coding agent - - callback when done - -▶ Completion Signalling
Apply Engine ──record run/step──▶ Run Metrics
```

- **Command Surface** asks Catalogue for the actor tree; on run, invokes Apply Engine with chosen actor + target.
- **Apply Engine** gets the actor definition and work items, then loops: dispatch turn → await completion → advance, emitting progress to Run Metrics.
- **Completion Signalling** is woken by the agent's out-of-band callback and matched to the waiting turn.

All payloads ("actor definition", "work items", "a turn", "a completion", "a run record") stay abstract until their owning component is refined.

## Deferred

- No foundation-first schema tier — each component owns and defines its shapes.
- Interfaces stay abstract until both sides are refined.
- Transport & mechanism are component-internal.

## Proceed

Refine one component per cycle. Start with **Apply Engine** — its needs shape what every other component must offer. Feed refinements into neighbours before moving on.