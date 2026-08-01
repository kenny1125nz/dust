# Agent Dispatch

> **Phase:** Leaf component — no dependencies on sibling components. Refine in parallel with other leaf components. Apply Engine needs the dispatch interface to advance.

## Purpose

Hands a composed turn (instruction + context) to the coding agent and selects the role/mode it runs under. Owns the **outbound edge** to the agent — and nothing else. The only thing this component knows how to do: take a fully-formed instruction and a resolved chatmode, and send it to Copilot Chat.

## Dependencies

| Direction | Component | Why |
|-----------|-----------|-----|
| Depends on | *(none)* | No sibling dependencies. Internally depends on the VS Code chat API (`workbench.action.chat.open`) and the role→chatmode resolver. |
| Depended on by | **Apply Engine** | The engine sends each composed turn through Agent Dispatch as part of the compose → dispatch → await → advance loop. |

## Key Design Decisions

### Dispatch Mechanism

Calls `vscode.commands.executeCommand('workbench.action.chat.open', ...)` directly from inside the extension host — no named pipe, no socket server. The wrapping module (`dispatch.ts`) is a thin wrapper ported from `copilot-bridge.js`'s `sendToCopilot` + `resolveMode` (~85% reuse).

Delete all transport/endpoint code on the dispatch path — the extension already lives in the same process as the chat.

### Role → Chatmode → Model Resolution

`model` names an abstract role (`Reason`, `Build`, `Review`, `Write`, `Repair`), not a specific LLM id, keeping actors portable as models change.

Resolution chain: **actor `model`** is the only source. If no model is specified, the engine passes no role — VS Code falls back to whatever chat mode the user has configured as default.

The dispatch wrapper passes the role directly as the chat mode — the role name IS the chat mode name (e.g. `Reason`, `Build`). No mapping table, no config. Users create VS Code chat modes with the same names as the role values.

### The Split from Completion

Agent Dispatch and Completion Signalling are **two decoupled channels**, modeled as two separate ports — this is the ISP expression. Dispatch is fire-and-forget (`dispatched ≠ done`); Completion is the authoritative "done" signal arriving out-of-band through a different process (`dust-callback`). They must never be collapsed into one "agent client" interface.

### Architecture Fit (Ports & Adapters)

| Layer | Element | Details |
|-------|---------|---------|
| Port | `AgentGateway` | `dispatch(instruction, mode): void` — outbound only |
| Adapter | VS Code Chat Adapter | Implements `AgentGateway` via `workbench.action.chat.open` (+ `resolveMode`) |
| Test substitute | Echo Adapter | Records dispatched turns in memory, no chat window needed |
| Core | Role Resolver | No-op — role name IS the chat mode name, passed directly. |

### Self-Containedness

| Axis of change | Verdict |
|----------------|---------|
| How we talk to the agent | Swap adapter (e.g. echo for tests) without touching policy. |
| Cohesion | High |

## Pseudo Code

```typescript
function dispatch(instruction: string, model?: Role): void {
  await vscode.commands.executeCommand(
    'workbench.action.chat.open',
    { query: instruction, mode: model }
  );
}
```

## Key Data Types

```typescript
type Role = 'Reason' | 'Build' | 'Review' | 'Write' | 'Repair';
```

## Exposed Interface

```typescript
interface AgentGateway {
  /** Sends a composed instruction to the coding agent.
   *  @param instruction  Free-text prompt to open in the chat.
   *  @param model        Optional role name, passed directly as the VS Code chat mode. */
  dispatch(instruction: string, model?: Role): void;
}
```

## To Be Refined

*(Nothing deferred — the dispatch interface is fully specified.)*

## Relevant Acceptance Criteria

From **Model Roles**:

- `model` front-matter is treated as an abstract role (`Reason` / `Build` / `Review` / `Write` / `Repair`), passed directly as the VS Code chat mode name. If no model specified, VS Code uses the user's configured default.
