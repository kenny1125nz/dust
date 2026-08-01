# Target Resolution

> **Phase:** Leaf component — no dependencies on sibling components. Refine first or early; Apply Engine needs its work-item shape to proceed.

## Purpose

Turns an Explorer selection (one or more files and/or folders) into an ordered list of work items. A boolean flag `wholeTarget` drives the strategy: `true` = wrap the input as-is into one item; `false` = walk folders to individual files, sorted by name.

## Dependencies

| Direction      | Component        | Why                                                                                                                                      |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Depends on     | *(none)*         | No sibling dependencies. Internally depends on a `FileSystem` port (abstracted from `vscode.fs`) so it is testable with an in-memory FS. |
| Depended on by | **Apply Engine** | The engine asks for the ordered work items to iterate over (expand → iterate → dispatch → await → advance loop). |
|                | **Command Surface & Activation** | The webview asks for the target tree to render the "Selected Target" section. |

## Key Design Decisions

### The `wholeTarget` Flag

| `wholeTarget` | Selection | Result |
|---------------|-----------|--------|
| `true` | anything | **1 item** — `target` is the original input, passed through unchanged |
| `false` | file(s) | N items — one per file, each `target` is a single `vscode.Uri`. Only `.md` files are yielded. |
| `false` | folder(s) | N items — walked `.md` files (everything else ignored), each `target` is a single `vscode.Uri`. |

When `wholeTarget: false`, folders are walked recursively. Files are sorted by name. Duplicates are deduplicated (first occurrence wins). Only `.md` files are yielded — sub-directories are recursed but non-markdown files are silently skipped.

### No Mapping

The resolver does zero transformation. The file name or folder name **is** the label — the consumer derives it directly from `target`. There are no derived labels, no `kind` discriminants, no metadata computed here.

### Architecture Fit (Ports & Adapters)

Target Enumerator is a **domain-core** element: `(uri: vscode.Uri | vscode.Uri[], wholeTarget: boolean) → WorkItem[]`. Depends on the `FileSystem` port (`list` / `read` / `write`) — not on `vscode.fs` directly.

### Self-Containedness

| Axis of change | Verdict |
|----------------|---------|
| Target traversal / ordering | Contained: yields work items; nobody else walks the FS. |
| Cohesion | High |
| Single reason to change | Yes (how to walk + dedup) |
| Verdict | Solid |

## Pseudo Code

```typescript
function resolve(uri: vscode.Uri | vscode.Uri[], wholeTarget: boolean): WorkItem[] {
  if (wholeTarget) {
    return [{ target: uri }];
  }

  const uris = Array.isArray(uri) ? uri : [uri];
  const seen = new Set<string>();
  const items: WorkItem[] = [];

  for (const u of uris) {
    if (isFile(u)) {
      addUnique(seen, items, u);
    } else if (isDirectory(u)) {
      for (const child of walk(u)) {
        if (child.uri.path.endsWith('.md')) {
          addUnique(seen, items, child.uri);
        }
      }
    }
  }

  return items.sort((a, b) => name(a.target as vscode.Uri).localeCompare(name(b.target as vscode.Uri)));
}

function addUnique(seen: Set<string>, items: WorkItem[], uri: vscode.Uri): void {
  if (!seen.has(uri.path)) {
    seen.add(uri.path);
    items.push({ target: uri });
  }
}
```

### Target Tree (for Webview Display)

```typescript
function resolveTree(uri: vscode.Uri | vscode.Uri[]): TargetNode[] {
  const uris = Array.isArray(uri) ? uri : [uri];
  return uris.map(u => (isFile(u) ? leafNode(u) : folderNode(u)));

  function leafNode(u: vscode.Uri): TargetNode {
    return { name: path.basename(u.path), uri: u, children: [] };
  }

  function folderNode(u: vscode.Uri): TargetNode {
    const ignored = new Set(['.git', 'node_modules', '.vscode']);
    const children = fs.list(u)
      .filter(c => c.isDirectory() ? !ignored.has(c.name) : c.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => c.isDirectory() ? folderNode(c.uri) : leafNode(c.uri));
    return { name: path.basename(u.path), uri: u, children };
  }
}
```

## Key Data Types

```typescript
interface WorkItem {
  /** The target to dispatch over.
   *  - `wholeTarget: true` → the original input (`vscode.Uri | vscode.Uri[]`).
   *  - `wholeTarget: false` → always a single `vscode.Uri` (one file). */
  target: vscode.Uri | vscode.Uri[];
}

interface TargetNode {
  name: string;            // file or folder name (no path transformation)
  uri: vscode.Uri;
  children: TargetNode[];  // empty for files; populated for folders (only .md files + sub-folders)
}
```

## Exposed Interface

```typescript
interface TargetResolver {
  /**
   * Resolves an Explorer selection into work items.
   *
   * @param uri          A single clicked URI or multi-selection array.
   * @param wholeTarget  `true` = wrap as-is into one item; `false` = walk and flatten to files sorted by name.
   */
  resolve(uri: vscode.Uri | vscode.Uri[], wholeTarget: boolean): WorkItem[];

  /**
   * Returns a tree representation of the selection for Webview display.
   * `.md` files and directories are included; `.git`, `node_modules`, `.vscode` are excluded
   * to prevent explosions. Sorted by name.
   */
  resolveTree(uri: vscode.Uri | vscode.Uri[]): TargetNode[];
}
```

## To Be Refined

*(Nothing deferred — the resolution logic is fully specified.)*

## Relevant Acceptance Criteria

From **Engine (Apply)**:

- When `wholeTarget: true`, the input is returned as a single `WorkItem` — no walking, no transformation.
- When `wholeTarget: false`, folders are walked recursively, files are sorted by name, and duplicates are deduplicated.
- Multi-selection (files + folders) with `wholeTarget: false` flattens all into one sorted, deduplicated list.
- `resolveTree()` returns the selection as a `TargetNode` tree — one root node per selected URI, with nested folders and `.md` files. `.git`, `node_modules`, and `.vscode` directories are excluded to prevent app explosions.
