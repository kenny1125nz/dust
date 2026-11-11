import type { ChatGateway, Role } from '@dust/shared';

/** A resolved actor definition: its ordered step files and abstract role. */
export interface ActorEntry {
  /** Abstract model role (`Reason | Build | Review | Write | Repair`), optional. */
  model?: Role;
  /** The chat tool this actor dispatches to (`copilot | cline`), optional. */
  gateway?: ChatGateway;
  /** File paths to `.md` step files; single-file actors have exactly one entry. */
  steps: string[];
}

/** A node in the actor menu tree. Leaf nodes carry an `actorId`. */
export interface ActorTreeNode {
  /** File or folder name as-is, for UI display. */
  name: string;
  /** Set on leaf nodes — the key for `ActorTree.getActor()`. */
  actorId?: string;
  children: ActorTreeNode[];
}

/** Read-model of the actors root: the menu tree plus id → actor lookup. */
export interface ActorTree {
  root: ActorTreeNode;
  getActor(id: string): ActorEntry | undefined;
}
