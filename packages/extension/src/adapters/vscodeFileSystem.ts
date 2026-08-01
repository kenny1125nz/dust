import * as vscode from 'vscode';
import { FileSystem, FileSystemEntry, FileType } from '../targets';

export class VscodeFileSystem implements FileSystem {
  constructor(private readonly fs: vscode.FileSystem = vscode.workspace.fs) {}

  async stat(uri: vscode.Uri): Promise<FileType> {
    try {
      const stat = await this.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        return FileType.Directory;
      }
      if (stat.type === vscode.FileType.File) {
        return FileType.File;
      }
      return FileType.Unknown;
    } catch {
      return FileType.Unknown;
    }
  }

  async list(uri: vscode.Uri): Promise<FileSystemEntry[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await this.fs.readDirectory(uri);
    } catch {
      return [];
    }
    return entries.map(([name, type]) => ({
      name,
      uri: vscode.Uri.joinPath(uri, name),
      isDirectory: type === vscode.FileType.Directory,
    }));
  }

  async read(uri: vscode.Uri): Promise<Uint8Array> {
    return this.fs.readFile(uri);
  }

  async write(uri: vscode.Uri, contents: Uint8Array): Promise<void> {
    await this.fs.writeFile(uri, contents);
  }
}
