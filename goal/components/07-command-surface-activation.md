# Command Surface & Activation

> **Phase:** Terminal component — depends on Actor Catalogue and Apply Engine; nothing depends on it. Refine **last**, after the engine and catalogue interfaces are stable. This is the composition root and the only place that wires all concretions together.

## Purpose

The Explorer menu that lets a user trigger an apply, plus the wiring that assembles the components at startup. Owns the **UI trigger** and the **composition root**. This is the entry point for the user into the Dust system.

## Dependencies

| Direction      | Component           | Why                                                                                                            |
| -------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Depends on     | **Actor Catalogue** | Reads the actor tree to render the Webview panel (actor selection UI).                                         |
|                | **Apply Engine**    | Invokes the engine with `{ actorId, targetUri, overrideText? }` on user action via `CommandTrigger` port.      |
| Depended on by | *(none)*            | This is the entry point; no other component invokes it. The composition root (`extension/activate()`) wire it. |

## Key Design Decisions

### Command Surface

A **single** `contributes.menus["explorer/context"]` command — `"Apply Dust Actor…"` (`dust.open`, contributed once for files and folders) — that opens a **Webview panel**. There are **no static submenu contributions** — the actor tree is data rendered at runtime, not declared in `package.json`.

The Webview panel:
1. Renders the actor tree as-is from the Catalogue's `getTree()` — folder structure is the presented structure, nesting to arbitrary depth.
2. Previews the chosen actor before running.
3. Exposes per-run tweaks:
   - **Model** — override the role/chatmode for this run.
   - **Target mode** — Each (per-file) vs Together (one combined run).
   - **Free-text addendum** — a one-time prompt addition the user types inline.
4. Posts the run request back to `dust.apply` with `{ actorId, targetUri, overrideText? }`.

### Webview Wireframe

Layout: **flex column** — five stacked sections ordered top-to-bottom.

```
┌─────────────────────────────────────────────────────────┐
│ Dust                                          [×]       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1  Selected Target                                     │
│     ○ Each (iterate)      ● Together (one run)          │
│     ┌─────────────────────────────────────────────┐     │
│     │ ▶ round-2/                                   │     │
│     │   · Goal.md                                  │     │
│     │   · Solution.md                              │     │
│     │   ▶ designs/                                 │     │
│     │     · ux-design.md                           │     │
│     │     · technical-design.md                    │     │
│     └─────────────────────────────────────────────┘     │
│                                                         │
│  2  Actors                                              │
│  ┌───────────────┬───────────────────────────────────┐  │
│  │ ▼ Solutioning │  ## Solutioning                    │  │
│  │ ▼ Design      │                                    │  │
│  │   ▶ Ux        │  You are a solutioning architect.  │  │
│  │   ▶ Technical │  Read the target content and       │  │
│  │   ▶ Comp Arch │  produce a Solution.md that...      │  │
│  │ ▶ Plan        │                                    │  │
│  │ ▶ Scaffold    │                                    │  │
│  │ ▼ Implement   │                                    │  │
│  │   ▶ implement │                                    │  │
│  │   ▶ assess    │                                    │  │
│  │   ▶ rework    │                                    │  │
│  └───────────────┴───────────────────────────────────┘  │
│                                                         │
│  3  Model                                               │
│     [ (no override)                ▾ ]                   │
│                                                         │
│  4  Extra Instructions                                  │
│     ┌─────────────────────────────────────────────┐     │
│     │ Also consider edge cases for empty input... │     │
│     └─────────────────────────────────────────────┘     │
│                                                         │
│  5                         [ Cancel ]    [ ▶ Apply ]    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Regions:**

| #     | Region                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Selected Target**    | Shows the Explorer-selected file(s) and folder(s) as a read-only file tree. The tree is collapsed by default with top-level entries visible; folders are expandable (`▼`/`▶`), files are leaf nodes (`·`). In **Each** mode, every file leaf represents one work item. In **Together** mode, the tree is informational — the whole selection is passed as one context unit. For multi-selection across disjoint paths, root nodes are shown side-by-side without a shared parent. |
|       | Target mode           | Radio buttons: **Each** (iterate per file) or **Together** (one run over the whole target). Stored as `wholeTarget: boolean`. Default: `false` (Each). |
| **2** | **Actors**             | Split pane: **left** = actor tree, **right** = actor preview. Resizable divider.                                                                                                                                                                                                                                                                                                                                                                                                  |
|       | Actor tree (left)      | Hierarchical tree from `Catalogue.getTree()`. Folder structure is the presented structure — no mapping, no normalization. Folders expand/collapse (`▼`/`▶`). Single-file actors and multi-step actor folders are clickable leaves. Selected actor highlighted.                                                                                                                                                                                                                                                                     |
|       | Actor preview (right)  | Renders the selected actor's markdown content — persona + instruction body. Interpolation slots shown as `${slotName}` placeholders. Read-only. When no actor selected: "Select an actor from the tree."                                                                                                                                                                                                                                                                          |
| **3** | **Model**              | Dropdown. First option is `(no override)` — selected by default, meaning the actor's own front-matter role is used as-is. Other options: `Reason`, `Build`, `Review`, `Write`, `Repair`. Choosing one overrides the role for this run only. |
| **4** | **Extra Instructions** | Multi-line textarea. Free-text appended to the actor's prompt body before dispatch. Placeholder: "Add a one-time instruction for this run…".                                                                                                                                                                                                                                                                                                                                      |
| **5** | **Actions**            | `[ Cancel ]` — closes the panel without applying. `[ ▶ Apply ]` — posts `{ actorId, targetUris, wholeTarget, model?, addendum? }` to `dust.apply` via `CommandTrigger`. Disabled until an actor is selected. |

**States:**

| State        | Trigger                         | What shows                                                                                                                                                                              |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empty**    | Panel opened, no actor selected | Preview shows "Select an actor from the tree." Apply button disabled.                                                                                                                   |
| **Preview**  | Actor selected in tree          | Preview renders actor markdown. All controls active with defaults. Apply button enabled.                                                                                                |
| **Running**  | Apply clicked                   | Panel shows "Running..." with a progress bar and step counter (e.g. "3 of 12 — user.ts"). Actor tree dimmed (read-only). Apply button becomes spinner. Cancel button toggles to "Stop". |
| **Complete** | Engine finishes                 | Progress area shows "Done — 12 items in 45s" with a summary. Apply button re-enables for another run.                                                                                   |
| **Error**    | Dispatch/completion failure     | Progress area shows error message in red. Apply button re-enables.                                                                                                                      |

**Interactions:**

```
target mode toggle   →  switches Each (per-file) / Together (one combined run)
actor tree click     →  right pane renders preview, defaults populate
model dropdown       →  overrides role for this run; default "(no override)" means use actor's role
extra instructions   →  stored as addendum, appended to prompt before dispatch
[▶ Apply] click      →  posts { actorId, targetUris, wholeTarget, model?, addendum? }
                         to dust.apply via CommandTrigger
[ Cancel ] click     →  closes the panel
```

### The UX Layer's Indifference

The panel depends on `ActorTree` (a read-only model) and `CommandTrigger` (a single call) — nothing else. It is **swappable** for a QuickPick or static menu UI with **zero engine impact**. This is the encoded form of "the UX layer does not care what an actor is about" — it only mirrors a directory tree into menus.

### Composition Root

`extension/activate()` is the **only place** that knows all the concretions: it instantiates adapters and injects them into the orchestrator and the Webview surface adapter. Nothing else constructs its own dependencies (DIP), which keeps every other unit independently testable.

### Command

`dust.apply` takes `{ actorId, targetUri, overrideText? }`.

### Architecture Fit (Ports & Adapters)

| Layer            | Element                 | Details                                                                                                                                 |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Port             | `CommandTrigger`        | `onApply(actorId, targetUri)` — the UI's only handle into the engine.                                                                   |
| Adapter          | Webview Surface Adapter | Consumes read-only `ActorTree`, renders panel, collects per-run tweaks, calls `CommandTrigger`. Swappable for QuickPick or static menu. |
| Composition root | `extension/activate()`  | Instantiates all adapters and injects them.                                                                                             |

### UI Framework

**Preact** (3 KB) — chosen for the webview. React-compatible API (hooks, JSX) with a tiny bundle. The actor tree maps naturally to a recursive `<TreeNode data={node} />` component. Per-run tweaks are simple controlled inputs bound to local `useState`. Communication with the extension host via `postMessage` / `onDidReceiveMessage` through a single `useWebview` hook wrapping the VS Code API.

Styles must follow VS Code's design language: use `@vscode/webview-ui-toolkit` components where available (dropdown, button, textarea) for built-in theming and keyboard accessibility, and rely on CSS custom properties (`--vscode-*`) for colors, spacing, and typography so the panel respects the user's active theme (light, dark, high-contrast). The actor tree and target tree should match the Explorer's indent guides, selection highlight, and chevron icons for visual consistency with the surrounding IDE.

``` typescript
State shape (single top-level reducer or a few useStates):
  actorTree: ActorTree          // from Catalogue.getTree() via postMessage
  selectedActorId: string|null  // which actor leaf is highlighted
  wholeTarget: boolean          // false = Each, true = Together
  model: string|null            // null = "(no override)", use actor's role
  workspacePath: string         // from vscode.workspace
  addendum: string              // free-text extra instructions
  phase: 'empty' | 'preview' | 'running' | 'complete' | 'error'
  progress: { step, total, currentPath } | null
```

Component tree:

```html
<App>
  <Header targetTree={targetTree} />
  <Section label="Selected Target">
    <TargetTree data={targetTree} />
    <TargetToggle wholeTarget={wholeTarget} onChange={setWholeTarget} />
  </Section>
  <Section label="Actors">
    <SplitPane>
      <ActorTree data={actorTree} selected={selectedActorId} onSelect={setSelectedActorId} />
      <ActorPreview actor={selectedActor} />
    </SplitPane>
  </Section>
  <Section label="Model">
    <ModelDropdown value={model} onChange={setModel} actorDefault={selectedActor?.model} />
  </Section>
  <Section label="Extra Instructions">
    <TextArea value={addendum} onChange={setAddendum} />
  </Section>
  <Actions>
    <CancelButton onClick={handleCancel} />
    <ApplyButton disabled={phase !== 'preview'} onClick={handleApply} />
  </Actions>
</App>
```

### Self-Containedness

| Axis of change                   | Verdict                                        |
| -------------------------------- | ---------------------------------------------- |
| How the actor tree becomes menus | Contained: pure UI concern; engine unaffected. |
| Cohesion                         | High                                           |
| Single reason to change          | Yes (UX)                                       |
| Hidden coupling risk             | Must depend only on read-model + trigger       |
| Verdict                          | Solid                                          |

## Pseudo Code

```typescript
// --- Extension host (composition root) ---

function activate(context: vscode.ExtensionContext): void {
  const catalogue = new ActorSourceAdapter(fs);
  const engine = new ApplyEngine({ catalogue, targetResolver, agentGateway, completionSource, metrics });

  context.subscriptions.push(
    vscode.commands.registerCommand('dust.open', (clickedUri: Uri, selectedUris: Uri[]) => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const targetTree = buildTargetTree(selectedUris.length > 0 ? selectedUris : [clickedUri]);
      const panel = vscode.window.createWebviewPanel(
        'dust',
        'dust',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'loadTree') {
          panel.webview.postMessage({ type: 'tree', tree: catalogue.loadTree() });
        } else if (msg.type === 'apply') {
          engine.apply(msg.payload);
        }
      });
      panel.webview.html = renderApp({ targetTree, workspacePath });
    })
  );
}

// --- Webview side (Preact) ---

function App(): VNode {
  const [state, dispatch] = useReducer(reducer, initialState);

  // On mount, request the actor tree
  useEffect(() => { vscode.postMessage({ type: 'loadTree' }); }, []);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'tree') dispatch({ type: 'SET_TREE', tree: e.data.tree });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleApply = () => {
    vscode.postMessage({
      type: 'apply',
      payload: {
        actorId: state.selectedActorId,
        targetUris: state.targetTree.uris,
        wholeTarget: state.wholeTarget,
        workspacePath: state.workspacePath,
        model: state.model,
        addendum: state.addendum,
      }
    });
    dispatch({ type: 'SET_PHASE', phase: 'running' });
  };

  return (
    <div class="dust-panel">
      <Section label="Selected Target">
        <TargetTree data={state.targetTree} />
        <TargetToggle value={state.wholeTarget} onChange={v => dispatch({ type: 'SET_WHOLE_TARGET', wholeTarget: v })} />
      </Section>
      <Section label="Actors">
        <SplitPane>
          <ActorTree data={state.actorTree} selected={state.selectedActorId}
            onSelect={id => dispatch({ type: 'SELECT_ACTOR', id })} />
          <ActorPreview actor={state.selectedActor} />
        </SplitPane>
      </Section>
      <Section label="Model">
        <ModelDropdown value={state.model} onChange={v => dispatch({ type: 'SET_MODEL', model: v })} />
      </Section>
      <Section label="Extra Instructions">
        <TextArea value={state.addendum} onChange={v => dispatch({ type: 'SET_ADDENDUM', text: v })} />
      </Section>
      <Actions>
        <button onClick={() => vscode.postMessage({ type: 'close' })}>Cancel</button>
        <button disabled={state.phase !== 'preview'} onClick={handleApply}>Apply</button>
      </Actions>
    </div>
  );
}
```

## Key Data Types

```typescript
// --- Webview-side state ---

type PanelPhase = 'empty' | 'preview' | 'running' | 'complete' | 'error';

interface PanelState {
  actorTree: ActorTreeNode | null;
  targetTree: TargetTree;
  selectedActorId: string | null;
  selectedActor: ActorEntry | null;
  wholeTarget: boolean;
  model: string | null;        // null = use actor default
  workspacePath: string;
  addendum: string;
  phase: PanelPhase;
  progress: { step: number; total: number; currentPath: string } | null;
}

interface TargetTree {
  uris: Uri[];
  root: TargetTreeNode;
}

interface TargetTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TargetTreeNode[];
}

// --- Extension-host-side messages (postMessage contract) ---

type WebviewToHost =
  | { type: 'loadTree' }
  | { type: 'apply'; payload: ApplyRequest }
  | { type: 'close' };

type HostToWebview =
  | { type: 'tree'; tree: ActorTree }
  | { type: 'progress'; progress: { step: number; total: number; currentPath: string } }
  | { type: 'complete'; result: RunResult }
  | { type: 'error'; message: string };
```

## Exposed Interface

```typescript
interface CommandTrigger {
  /** Invoked by the Webview to start a run. The UI's only handle into the engine. */
  onApply(actorId: string, targetUris: Uri[], wholeTarget: boolean, opts?: ApplyOptions): void;
}

interface ApplyOptions {
  model?: Role;
  addendum?: string;
}
```

## To Be Refined

*(Nothing deferred — command surface, config (none needed), wireframe, and model override UX are all finalized.)*

## Relevant Acceptance Criteria

From **UX (Command Surface)**:

- Right-clicking a file or folder in the Explorer offers a single `"Apply Dust Actor…"` entry that opens a Dust panel (Webview) mirroring the actor tree as-is — folder structure is the presented structure, no mapping or normalization.
- The panel previews the chosen actor before running and exposes per-run tweaks (model, whole-target vs walk, and a free-text one-time addendum).
- Choosing an actor invokes `dust.apply` with the correct `{ actorId, targetUri }` (plus any per-run `overrideText`).

From **Human-in-the-Loop**:

- The chain never auto-advances across actor boundaries without the human initiating the next `dust.apply`; artifacts between steps remain plain, editable files.

From **Project Shape**:

- Delivered as a new standalone repo producing two installable artifacts (VS Code extension + `npm install -g` callback); no changes to `ash-vscode-syntax`, `ash-js`, `ashd`, or `ash-protocol`.
