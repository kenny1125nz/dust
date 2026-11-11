import type { ChatGateway, Role } from '@dust/shared';
import type { ActorTreeNode } from '../actors/schema';

/**
 * The serialized message contract between the extension host and the Webview.
 * Everything here is plain JSON-safe data — it crosses the `postMessage`
 * boundary, so no functions, class instances, or `vscode.Uri` objects.
 */

/** The actor content the panel needs to render its preview. */
export interface ActorPreview {
  model?: Role;
  gateway?: ChatGateway;
  steps: string[];
  body: string;
}

/** A display node of the Explorer selection, mirroring `TargetNode` without `Uri`. */
export interface TargetNodePayload {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TargetNodePayload[];
}

/** Initial panel data embedded in the Webview HTML at open time. */
export interface DustInitialData {
  targetTree: TargetNodePayload[];
  targetPaths: string[];
  workspacePath: string;
}

export interface WebviewApplyRequest {
  actorId: string;
  /** File-system paths of the selected targets; the host converts them back to `Uri`s. */
  targetPaths: string[];
  wholeTarget: boolean;
  workspacePath: string;
  model?: Role | null;
  /** The chat tool to dispatch to; overrides the actor/step default. */
  gateway?: ChatGateway | null;
  addendum?: string;
}

export type WebviewToHost =
  | { type: 'loadTree' }
  | { type: 'apply'; payload: WebviewApplyRequest }
  | { type: 'close' };

export type HostToWebview =
  | { type: 'tree'; root: ActorTreeNode; actors: Record<string, ActorPreview> }
  | { type: 'complete'; result: { itemCount: number; stepCount: number } }
  | { type: 'error'; message: string };
