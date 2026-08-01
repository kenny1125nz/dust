import type { Uri } from 'vscode';

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
}

export interface FileSystemEntry {
  name: string;
  uri: Uri;
  isDirectory: boolean;
}

/**
 * The `FileSystem` port the Target Enumerator depends on — abstracted from
 * `vscode.workspace.fs` so it is testable with an in-memory implementation.
 * All methods are async to mirror `vscode.workspace.fs`.
 */
export interface FileSystem {
  /** Type of the entry at `uri`, or `FileType.Unknown` when it does not exist. */
  stat(uri: Uri): Promise<FileType>;
  /** Direct children of `uri`. Returns an empty array for files / missing URIs. */
  list(uri: Uri): Promise<FileSystemEntry[]>;
  read(uri: Uri): Promise<Uint8Array>;
  write(uri: Uri, contents: Uint8Array): Promise<void>;
}
