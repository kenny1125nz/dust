import type { Role } from '@dust/shared';
import type { ActorTreeNode } from '../actors/schema';
import type { ActorPreview, DustInitialData, TargetNodePayload } from '../surface/webviewProtocol';

export type PanelPhase = 'empty' | 'preview' | 'running' | 'complete' | 'error';

export interface PanelState {
  actorTree: ActorTreeNode | null;
  actors: Record<string, ActorPreview>;
  selectedActorId: string | null;
  targetTree: TargetNodePayload[];
  targetPaths: string[];
  workspacePath: string;
  wholeTarget: boolean;
  model: Role | null;
  addendum: string;
  phase: PanelPhase;
  result: { itemCount: number; stepCount: number } | null;
  error: string | null;
}

export type PanelAction =
  | { type: 'SET_TREE'; root: ActorTreeNode; actors: Record<string, ActorPreview> }
  | { type: 'SELECT_ACTOR'; id: string }
  | { type: 'SET_WHOLE_TARGET'; wholeTarget: boolean }
  | { type: 'SET_MODEL'; model: Role | null }
  | { type: 'SET_ADDENDUM'; text: string }
  | { type: 'SET_RUNNING' }
  | { type: 'SET_COMPLETE'; result: { itemCount: number; stepCount: number } }
  | { type: 'SET_ERROR'; message: string };

/** Initial state from the data the host embeds in the panel HTML. */
export function createInitialState(data: DustInitialData): PanelState {
  return {
    actorTree: null,
    actors: {},
    selectedActorId: null,
    targetTree: data.targetTree,
    targetPaths: data.targetPaths,
    workspacePath: data.workspacePath,
    wholeTarget: false,
    model: null,
    addendum: '',
    phase: 'empty',
    result: null,
    error: null,
  };
}

/** Tolerates a missing or malformed `window.__DUST_INITIAL__`. */
export function parseInitialData(raw: unknown): DustInitialData {
  if (!raw || typeof raw !== 'object') {
    return { targetTree: [], targetPaths: [], workspacePath: '' };
  }
  const data = raw as DustInitialData;
  return {
    targetTree: Array.isArray(data.targetTree) ? data.targetTree : [],
    targetPaths: Array.isArray(data.targetPaths) ? data.targetPaths : [],
    workspacePath: typeof data.workspacePath === 'string' ? data.workspacePath : '',
  };
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'SET_TREE':
      return { ...state, actorTree: action.root, actors: action.actors };
    case 'SELECT_ACTOR':
      if (state.phase === 'running') {
        return state;
      }
      if (!state.actors[action.id]) {
        return state;
      }
      return { ...state, selectedActorId: action.id, phase: 'preview', error: null };
    case 'SET_WHOLE_TARGET':
      return { ...state, wholeTarget: action.wholeTarget };
    case 'SET_MODEL':
      return { ...state, model: action.model };
    case 'SET_ADDENDUM':
      return { ...state, addendum: action.text };
    case 'SET_RUNNING':
      return { ...state, phase: 'running', error: null };
    case 'SET_COMPLETE':
      return { ...state, phase: 'complete', result: action.result, error: null };
    case 'SET_ERROR':
      return { ...state, phase: 'error', error: action.message };
  }
}
