import type { Role } from '@dust/shared';
import { AgentGateway } from './agentGateway';

export interface DispatchedTurn {
  instruction: string;
  model?: Role;
}

/** Test substitute: records dispatched turns in memory, no chat window needed. */
export class EchoAgentGateway implements AgentGateway {
  private readonly turns: DispatchedTurn[] = [];

  get dispatched(): readonly DispatchedTurn[] {
    return [...this.turns];
  }

  dispatch(instruction: string, model?: Role): void {
    this.turns.push(model === undefined ? { instruction } : { instruction, model });
  }
}
