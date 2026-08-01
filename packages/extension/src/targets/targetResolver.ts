import * as path from 'path';
import type { Uri } from 'vscode';
import { FileSystem, FileSystemEntry, FileType } from './fileSystem';
import { TargetNode, WorkItem } from './types';

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.vscode']);

export interface TargetResolver {
  /**
   * Resolves an Explorer selection into work items.
   *
   * @param uri          A single clicked URI or multi-selection array.
   * @param wholeTarget  `true` = wrap as-is into one item; `false` = walk and flatten to files sorted by name.
   */
  resolve(uri: Uri | Uri[], wholeTarget: boolean): Promise<WorkItem[]>;

  /**
   * Returns a tree representation of the selection for Webview display.
   * `.md` files and directories are included; `.git`, `node_modules`, `.vscode` are excluded
   * to prevent explosions. Sorted by name.
   */
  resolveTree(uri: Uri | Uri[]): Promise<TargetNode[]>;
}

export class TargetEnumerator implements TargetResolver {
  constructor(private readonly fs: FileSystem) {}

  async resolve(uri: Uri | Uri[], wholeTarget: boolean): Promise<WorkItem[]> {
    if (wholeTarget) {
      return [{ target: uri }];
    }

    const uris = Array.isArray(uri) ? uri : [uri];
    const seen = new Set<string>();
    const items: WorkItem[] = [];

    for (const u of uris) {
      const type = await this.fs.stat(u);
      if (type === FileType.File) {
        if (u.path.endsWith('.md')) {
          this.addUnique(seen, items, u);
        }
      } else if (type === FileType.Directory) {
        for await (const child of this.walk(u)) {
          if (child.uri.path.endsWith('.md')) {
            this.addUnique(seen, items, child.uri);
          }
        }
      }
    }

    return items.sort((a, b) =>
      name(a.target as Uri).localeCompare(name(b.target as Uri), 'en', { numeric: true })
    );
  }

  async resolveTree(uri: Uri | Uri[]): Promise<TargetNode[]> {
    const uris = Array.isArray(uri) ? uri : [uri];
    const nodes: TargetNode[] = [];
    for (const u of uris) {
      const type = await this.fs.stat(u);
      if (type === FileType.File) {
        nodes.push(this.leafNode(u));
      } else {
        nodes.push(await this.folderNode(u));
      }
    }
    return nodes;
  }

  private addUnique(seen: Set<string>, items: WorkItem[], uri: Uri): void {
    if (!seen.has(uriKey(uri))) {
      seen.add(uriKey(uri));
      items.push({ target: uri });
    }
  }

  private async *walk(uri: Uri): AsyncGenerator<FileSystemEntry, void, void> {
    for (const entry of await this.fs.list(uri)) {
      if (entry.isDirectory) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          yield* this.walk(entry.uri);
        }
      } else {
        yield entry;
      }
    }
  }

  private leafNode(uri: Uri): TargetNode {
    return { name: path.basename(uri.path), uri, children: [] };
  }

  private async folderNode(uri: Uri): Promise<TargetNode> {
    const entries = await this.fs.list(uri);
    const children: TargetNode[] = [];
    const ordered = entries
      .filter((entry) =>
        entry.isDirectory ? !IGNORED_DIRECTORIES.has(entry.name) : entry.name.endsWith('.md')
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    for (const entry of ordered) {
      if (entry.isDirectory) {
        children.push(await this.folderNode(entry.uri));
      } else {
        children.push(this.leafNode(entry.uri));
      }
    }
    return { name: path.basename(uri.path), uri, children };
  }
}

function name(uri: Uri): string {
  return path.basename(uri.path);
}

function uriKey(uri: Uri): string {
  return `${uri.scheme}://${uri.authority ?? ''}${uri.path}`;
}

export function createTargetResolver(fs: FileSystem): TargetResolver {
  return new TargetEnumerator(fs);
}
