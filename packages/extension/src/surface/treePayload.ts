import type { Uri } from 'vscode';
import type { ActorEntry, ActorTreeNode } from '../actors/schema';
import type { ActorSource } from '../actors/actorSource';
import { parseActorFile } from '../engine/parseActorFile';
import type { FileSystem } from '../targets/fileSystem';
import type { TargetNode } from '../targets/types';
import type { ActorPreview, TargetNodePayload } from './webviewProtocol';

export interface ActorTreePayload {
  root: ActorTreeNode;
  actors: Record<string, ActorPreview>;
}

/**
 * Builds the serialized actor tree message. Reads each actor's step files and
 * joins their bodies (front-matter stripped) into a single preview string, so
 * the sandboxed Webview never needs filesystem access.
 */
export async function buildActorTreePayload(
  catalogue: ActorSource,
  fs: FileSystem,
  toFileUri: (path: string) => Uri
): Promise<ActorTreePayload> {
  const { root, getActor } = catalogue.loadTree();
  const actors: Record<string, ActorPreview> = {};
  for (const [id, entry] of collectActors(root, getActor)) {
    actors[id] = {
      model: entry.model,
      steps: entry.steps,
      body: await actorBody(entry.steps, fs, toFileUri),
    };
  }
  return { root, actors };
}

/** Converts the resolver's `TargetNode`s into JSON-safe payload nodes. */
export function buildTargetTreePayload(nodes: TargetNode[]): TargetNodePayload[] {
  return nodes.map((node) => ({
    name: node.name,
    path: node.uri.path,
    isDirectory: node.children.length > 0,
    children: buildTargetTreePayload(node.children),
  }));
}

function collectActors(node: ActorTreeNode, getActor: (id: string) => ActorEntry | undefined): Map<string, ActorEntry> {
  const actors = new Map<string, ActorEntry>();
  if (node.actorId !== undefined) {
    const entry = getActor(node.actorId);
    if (entry) {
      actors.set(node.actorId, entry);
    }
  }
  for (const child of node.children) {
    for (const [id, entry] of collectActors(child, getActor)) {
      actors.set(id, entry);
    }
  }
  return actors;
}

async function actorBody(steps: string[], fs: FileSystem, toFileUri: (path: string) => Uri): Promise<string> {
  const bodies: string[] = [];
  for (const step of steps) {
    try {
      const bytes = await fs.read(toFileUri(step));
      bodies.push(parseActorFile(Buffer.from(bytes).toString('utf8')).body);
    } catch (error) {
      bodies.push(`[unreadable: ${step}] ${(error as Error).message}`);
    }
  }
  return bodies.join('\n\n');
}
