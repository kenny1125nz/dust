import * as vscode from 'vscode';
import type { Role } from '@dust/shared';
import { AgentGateway, sendToCopilot } from '../dispatch';

/** Adapter: hands a composed turn to Copilot Chat inside the extension host. */
export class VscodeChatAgent implements AgentGateway {
  constructor(private readonly commands: typeof vscode.commands = vscode.commands) {}

  dispatch(instruction: string, model?: Role): void {
    sendToCopilot(this.commands, instruction, model);
  }
}
