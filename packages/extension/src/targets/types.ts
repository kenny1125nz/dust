import type { Uri } from 'vscode';

export interface WorkItem {
  /** The target to dispatch over.
   *  - `wholeTarget: true` → the original input (`vscode.Uri | vscode.Uri[]`).
   *  - `wholeTarget: false` → always a single `vscode.Uri` (one file). */
  target: Uri | Uri[];
}

export interface TargetNode {
  name: string; // file or folder name (no path transformation)
  uri: Uri;
  children: TargetNode[]; // empty for files; populated for folders (only .md files + sub-folders)
}
