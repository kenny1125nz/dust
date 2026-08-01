import type { Uri } from 'vscode';
import { FileSystem, FileSystemEntry, FileType } from './fileSystem';

interface InMemoryNode {
  type: FileType.File | FileType.Directory;
  children?: Map<string, InMemoryNode>;
  contents?: Uint8Array;
}

function makeUri(path: string): Uri {
  return { scheme: 'file', path } as unknown as Uri;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** In-memory `FileSystem` implementation for testing the Target Enumerator. */
export class InMemoryFileSystem implements FileSystem {
  private readonly root: InMemoryNode = { type: FileType.Directory, children: new Map() };

  createDirectory(uri: Uri): void {
    const segments = segmentsOf(uri.path);
    if (segments.length === 0) {
      return;
    }
    const parent = this.ensureDirectories(segments.slice(0, -1));
    const name = segments[segments.length - 1];
    const existing = parent.children?.get(name);
    if (existing) {
      if (existing.type !== FileType.Directory) {
        throw new Error(`Cannot create directory: ${uri.path} already exists as a file`);
      }
      return;
    }
    parent.children?.set(name, { type: FileType.Directory, children: new Map() });
  }

  createFile(uri: Uri, contents: Uint8Array = new Uint8Array()): void {
    const segments = segmentsOf(uri.path);
    if (segments.length === 0) {
      return;
    }
    const parent = this.ensureDirectories(segments.slice(0, -1));
    const name = segments[segments.length - 1];
    parent.children?.set(name, { type: FileType.File, contents });
  }

  async stat(uri: Uri): Promise<FileType> {
    const node = this.lookup(uri.path);
    return node ? node.type : FileType.Unknown;
  }

  async list(uri: Uri): Promise<FileSystemEntry[]> {
    const node = this.lookup(uri.path);
    if (!node || node.type !== FileType.Directory) {
      return [];
    }
    const entries: FileSystemEntry[] = [];
    for (const [name, child] of node.children ?? new Map()) {
      entries.push({
        name,
        uri: this.childUri(uri, name),
        isDirectory: child.type === FileType.Directory,
      });
    }
    return entries;
  }

  async read(uri: Uri): Promise<Uint8Array> {
    const node = this.lookup(uri.path);
    if (!node || node.type !== FileType.File) {
      throw new Error(`ENOENT: ${uri.path}`);
    }
    return node.contents ?? new Uint8Array();
  }

  async write(uri: Uri, contents: Uint8Array): Promise<void> {
    this.createFile(uri, contents);
  }

  private ensureDirectories(segments: string[]): InMemoryNode {
    let node: InMemoryNode = this.root;
    for (const segment of segments) {
      let child = node.children?.get(segment);
      if (!child) {
        child = { type: FileType.Directory, children: new Map() };
        node.children ??= new Map();
        node.children.set(segment, child);
      }
      node = child;
    }
    return node;
  }

  private lookup(uriPath: string): InMemoryNode | undefined {
    let node: InMemoryNode | undefined = this.root;
    for (const segment of segmentsOf(uriPath)) {
      node = node?.children?.get(segment);
      if (!node) {
        return undefined;
      }
    }
    return node;
  }

  private childUri(parent: Uri, name: string): Uri {
    const base = parent.path === '/' ? '' : parent.path;
    return makeUri(`${base}/${name}`);
  }
}
