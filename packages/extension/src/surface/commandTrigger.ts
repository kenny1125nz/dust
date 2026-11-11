import type { Uri } from 'vscode';
import type { ChatGateway, Role } from '@dust/shared';
import type { ApplyEngine, ApplyRequest, RunResult } from '../engine';

export interface ApplyOptions {
  model?: Role;
  gateway?: ChatGateway;
  addendum?: string;
}

/**
 * Port: the UI's only handle into the Apply Engine. The Webview Surface
 * Adapter depends on this single call — nothing else — so it is swappable for
 * a QuickPick or static menu UI with zero engine impact. Resolves with the run
 * result so the panel can surface the complete/error states.
 */
export interface CommandTrigger {
  onApply(actorId: string, targetUris: Uri[], wholeTarget: boolean, opts?: ApplyOptions): Promise<RunResult>;
}

/** Adapter: adapts a `CommandTrigger` call to the engine's `ApplyRequest` shape. */
export class ApplyEngineTrigger implements CommandTrigger {
  constructor(
    private readonly engine: ApplyEngine,
    private readonly workspacePath: string
  ) {}

  onApply(actorId: string, targetUris: Uri[], wholeTarget: boolean, opts?: ApplyOptions): Promise<RunResult> {
    const request: ApplyRequest = {
      actorId,
      targetUris,
      wholeTarget,
      workspacePath: this.workspacePath,
      model: opts?.model,
      gateway: opts?.gateway,
      addendum: opts?.addendum,
    };
    return this.engine.apply(request);
  }
}
