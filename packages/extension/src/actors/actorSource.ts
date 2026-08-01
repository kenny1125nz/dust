import type { ActorTree } from './schema';

export interface ActorSource {
  /** Scans `<workspace>/.dust/actors/`, returns the actor tree. */
  loadTree(): ActorTree;
}
