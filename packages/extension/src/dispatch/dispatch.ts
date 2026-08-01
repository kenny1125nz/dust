import type { Role } from '@dust/shared';

export const CHAT_OPEN_COMMAND = 'workbench.action.chat.open';

export interface ChatOpenArgs {
  query: string;
  /** The VS Code chat mode name (a `Role` value), omitted for the user's configured default. */
  mode?: string;
}

/** Minimal executor surface used by `sendToCopilot`; satisfied by `vscode.commands`. */
export interface ChatCommandExecutor {
  executeCommand(command: string, ...rest: unknown[]): PromiseLike<unknown>;
}

/**
 * Resolves an abstract role to a chat mode. No-op by design: the role name IS
 * the chat mode name (`Reason`, `Build`, `Review`, `Write`, `Repair`). No
 * mapping table, no config — users create VS Code chat modes with the same
 * names as the role values. If no model is given, no mode is passed and VS
 * Code falls back to whatever chat mode the user has configured as default.
 */
export function resolveChatMode(model: Role | undefined): string | undefined {
  return model;
}

/** Builds the `workbench.action.chat.open` payload for a composed turn. */
export function chatOpenArgs(instruction: string, model?: Role): ChatOpenArgs {
  const args: ChatOpenArgs = { query: instruction };
  const mode = resolveChatMode(model);
  if (mode !== undefined) {
    args.mode = mode;
  }
  return args;
}

/**
 * Fire-and-forget dispatch of a composed turn to Copilot Chat via
 * `workbench.action.chat.open`. Thin wrapper ported from `copilot-bridge.js`'s
 * `sendToCopilot`. Dispatch is fire-and-forget — `dispatched ≠ done`;
 * completion arrives out-of-band through Completion Signalling.
 */
export function sendToCopilot(executor: ChatCommandExecutor, instruction: string, model?: Role): void {
  void executor
    .executeCommand(CHAT_OPEN_COMMAND, chatOpenArgs(instruction, model))
    .then(undefined, (error: unknown) => {
      console.error('dust: failed to dispatch to Copilot Chat', error);
    });
}
