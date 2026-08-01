import * as fs from 'fs';
import * as path from 'path';
import type { Role } from '@dust/shared';
import { ActorSource } from '../actors/actorSource';
import { ActorEntry, ActorTree, ActorTreeNode } from '../actors/schema';
import { classifyFolder, orderStepFiles, parseActorFrontMatter } from '../actors/actorParser';

/**
 * Adapter: scans `<workspace>/.dust/actors/` and builds the actor tree using the
 * domain Parser. Uses Node's synchronous `fs` because the binding port
 * (`loadTree(): ActorTree`) is synchronous. Malformed front-matter fails fast
 * with the offending file path.
 */
export class ActorSourceAdapter implements ActorSource {
  constructor(private readonly root: string) {}

  loadTree(): ActorTree {
    const actorMap = new Map<string, ActorEntry>();
    if (!fs.existsSync(this.root)) {
      return { root: { name: path.basename(this.root), children: [] }, getActor: () => undefined };
    }
    const rootNode = this.scanNode(this.root, actorMap);
    return {
      root: rootNode,
      getActor: (id: string) => actorMap.get(id),
    };
  }

  private scanNode(nodePath: string, actorMap: Map<string, ActorEntry>): ActorTreeNode {
    const entries = fs.readdirSync(nodePath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    if (classifyFolder(files, dirs) === 'multi-step') {
      const stepPaths = orderStepFiles(files).map((name) => path.join(nodePath, name));
      const relPath = path.relative(this.root, nodePath);
      actorMap.set(relPath, { steps: stepPaths, model: this.parseModel(stepPaths[0]) });
      return { name: path.basename(nodePath), actorId: relPath, children: [] };
    }

    const children: ActorTreeNode[] = [];
    for (const file of files) {
      const filePath = path.join(nodePath, file);
      const relPath = path.relative(this.root, filePath);
      actorMap.set(relPath, { steps: [filePath], model: this.parseModel(filePath) });
      children.push({ name: file, actorId: relPath, children: [] });
    }
    for (const dir of dirs) {
      children.push(this.scanNode(path.join(nodePath, dir), actorMap));
    }
    return { name: path.basename(nodePath), children };
  }

  /** Reads a file and parses its front-matter, decorating failures with the path. */
  private parseModel(filePath: string): Role | undefined {
    try {
      return parseActorFrontMatter(fs.readFileSync(filePath, 'utf8')).model;
    } catch (error) {
      throw new Error(`${filePath}: ${(error as Error).message}`);
    }
  }
}

export function createActorSource(root: string): ActorSource {
  return new ActorSourceAdapter(root);
}
