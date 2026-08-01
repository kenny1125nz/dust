# Actor Catalogue

> **Phase:** Leaf component — no dependencies on sibling components, but the most-depended-on leaf (both Apply Engine and Command Surface read it). Refine its model first among leaf components, since its schema spreads to everything that consumes or composes an actor.

## Purpose

Turns actor files from `<workspace>/.dust/actors/` into an ordered, menu-ready model: discovery, parsing, folder-vs-multi-step classification. Owns the **actor model** the rest of the system reads.

## Dependencies

| Direction | Component | Why |
|-----------|-----------|-----|
| Depends on | *(none)* | No sibling dependencies. Internally depends on `FileSystem` port (to scan roots) and the Actor Parser/Schema (pure domain core). |
| Depended on by | **Command Surface & Activation** | Reads the actor tree to render the Webview panel. |
| | **Apply Engine** | Reads the actor definition to expand into turns (steps, model) for the dispatch loop. |

## Key Design Decisions

### Discovery

Actors live in one place: `<workspace>/.dust/actors/`. Recursed to any depth — folders become sub-menus, `.md` files become leaf actors. The file name is the actor name — no stripping, no mapping, no normalization.

### Actor Shapes

- **Single-file actor** — one `.md` file = one dispatch per target. Appears as a leaf node in the tree.
- **Multi-step actor** — a folder containing only numbered `.md` step files. The folder name is the actor name; individual step files are internal and never appear as tree nodes. The engine runs steps in numeric order over the same target.
- **Sub-menu** — a folder containing sub-folders or non-numbered `.md` files. Not an actor itself; its children are recursed.

### Folder Disambiguation Rule

| Contents | Classification |
|----------|---------------|
| Only numbered `.md` files, no sub-folders | **Multi-step actor** (leaf) |
| Contains sub-folders | **Sub-menu** (branch) |

### Actor File Format

Each actor file is markdown with optional YAML front-matter. The catalogue parses the front-matter and exposes the body text — it does not interpret interpolation slots (those belong to the engine).

```yaml
---
model: Reason    # abstract role
---
```

```
You are a solutioning architect. Read the target content and produce a Solution.md that …
```

### Front-Matter Schema

| Key | Type | Applies to | Meaning |
|-----|------|-----------|---------|
| `model` | `Reason` \| `Build` \| `Review` \| `Write` \| `Repair` | actor / step | Abstract model role. The only recognized key. |

Closed set — unknown keys are ignored (forward-compatible). No reads, no section selection. The file name is the actor name — no `title` front-matter key needed.

Malformed front-matter fails fast with a clear message — does not crash the extension.

### Composition

Because a multi-step actor is just an ordered set of step files, actors compose: existing single/multi-step actors can be concatenated into longer sequences (e.g. `implement/ = plan + code + assess + rework`), indistinguishable to the engine from any other actor.

### Architecture Fit (Ports & Adapters)

| Layer | Element | Details |
|-------|---------|---------|
| Domain core | Actor Schema | Vocabulary (`ActorDefinition`, `ActorStep`, front-matter types). Depends on nothing. |
| Domain core | Actor Parser | bytes → `ActorDefinition`; classifies folder as multi-step vs sub-menu. Depends on Schema only. |
| Port | `ActorSource` | `loadTree(): ActorTree` — hides roots/precedence/merge from orchestrator and UI. |
| Adapter | Actor Source Adapter | Scans `<workspace>/.dust/actors/`, builds tree using Parser. |
| Test substitute | In-memory `ActorSource` | Provide a tree directly, no filesystem scanning. |

### Self-Containedness

| Axis of change | Verdict |
|----------------|---------|
| Actor file format / front-matter keys | Contained: only parser and schema move. |
| Where actors come from (roots, precedence, merge) | Contained: orchestrator sees a tree, not roots. |
| Cohesion | High |

## Pseudo Code

```typescript
function loadTree(root: string): ActorTree {
  return {
    root: scanNode(root),
    getActor: (id: string) => actorMap.get(id),
  };
}

const actorMap = new Map<string, ActorEntry>();

function scanNode(nodePath: string): ActorTreeNode {
  const entries = fs.list(nodePath);
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
  const dirs = entries.filter(e => e.isDirectory());

  // Folder with only numbered .md files → multi-step actor (leaf).
  // Step files are internal — never appear as individual tree nodes.
  if (dirs.length === 0 && files.every(f => /^\d+[-.]/.test(f.name))) {
    const stepPaths = files
      .sort((a, b) => numericPrefix(a.name) - numericPrefix(b.name))
      .map(f => f.path);
    const relPath = path.relative(root, nodePath);
    actorMap.set(relPath, { steps: stepPaths, model: parseActorModel(stepPaths[0]) });
    return { name: path.basename(nodePath), actorId: relPath, children: [] };
  }

  // Branch node — sub-folders are recursed, standalone .md files are single-file actor leaves.
  const children: ActorTreeNode[] = [];
  for (const f of files) {
    const relPath = path.relative(root, f.path);
    const parsed = parseActorFrontMatter(fs.read(f.path));
    actorMap.set(relPath, { steps: [f.path], model: parsed.model });
    children.push({ name: f.name, actorId: relPath, children: [] });
  }
  for (const d of dirs) {
    children.push(scanNode(d.path));
  }
  return { name: path.basename(nodePath), children };
}

function parseActorFrontMatter(raw: string): { model?: Role } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split('\n').filter(Boolean);
  const fm: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    fm[key.trim()] = rest.join(':').trim();
  }
  return { model: fm['model'] as Role | undefined };
}

function parseActorModel(stepPath: string): Role | undefined {
  return parseActorFrontMatter(fs.read(stepPath)).model;
}

function numericPrefix(name: string): number {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
```

## Key Data Types

```typescript
interface ActorEntry {
  model?: Role;
  steps: string[];           // file paths to .md step files (single-file = 1 entry)
}

interface ActorTreeNode {
  name: string;              // file/folder name as-is (for UI display)
  actorId?: string;          // set on leaf nodes — the key for getActor()
  children: ActorTreeNode[];
}

interface ActorTree {
  root: ActorTreeNode;
  getActor(id: string): ActorEntry | undefined;
}
```

## Exposed Interface

```typescript
interface ActorSource {
  /** Scans `<workspace>/.dust/actors/`, returns the actor tree. */
  loadTree(): ActorTree;
}
```

## To Be Refined

*(Nothing deferred — `ActorEntry`, `ActorTree`, and `loadTree()` are all finalized.)*

## Relevant Acceptance Criteria

From **Actors & Discovery**:

- Actors are discovered from `<workspace>/.dust/actors/`.
- A single `.md` file loads as a single-file actor; a folder of numbered `.md` steps loads as a multi-step actor; a folder of sub-folders/non-step actors loads as a sub-menu — per the disambiguation rule.
- Front-matter is validated against the schema; malformed front-matter fails fast with a clear, actionable message and does not crash the extension.
