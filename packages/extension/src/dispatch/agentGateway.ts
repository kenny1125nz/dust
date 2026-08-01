import type { Role } from '@dust/shared';

export interface AgentGateway {
  /**
   * Sends a composed instruction to the coding agent.
   * @param instruction  Free-text prompt to open in the chat.
   * @param model        Optional role name, passed directly as the VS Code chat mode.
   */
  dispatch(instruction: string, model?: Role): void;
}
