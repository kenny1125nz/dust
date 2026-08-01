import { ActorSource } from './actorSource';
import { ActorEntry, ActorTree, ActorTreeNode } from './schema';

/**
 * Test substitute: provides an actor tree directly from a root node and an
 * id → entry map — no filesystem scanning.
 */
export class InMemoryActorSource implements ActorSource {
  constructor(
    private readonly root: ActorTreeNode,
    private readonly actors: Record<string, ActorEntry> = {}
  ) {}

  loadTree(): ActorTree {
    return {
      root: this.root,
      getActor: (id: string) => (Object.hasOwn(this.actors, id) ? this.actors[id] : undefined),
    };
  }
}
