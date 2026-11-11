import type { Uri } from 'vscode';
import type { ActorSource } from '../actors/actorSource';
import type { FileSystem } from '../targets/fileSystem';
import { CommandTrigger } from './commandTrigger';
import { buildActorTreePayload } from './treePayload';
import { HostToWebview, WebviewApplyRequest, WebviewToHost } from './webviewProtocol';

/** Minimal panel handle the surface needs; satisfied by `vscode.WebviewPanel`. */
export interface DustPanel {
  readonly webview: {
    postMessage(message: HostToWebview): void;
    onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
  };
  onDidDispose(listener: () => void): { dispose(): void };
  dispose(): void;
}

export interface CommandSurfaceDeps {
  catalogue: ActorSource;
  trigger: CommandTrigger;
  fs: FileSystem;
  toFileUri: (path: string) => Uri;
}

/**
 * Webview Surface Adapter: owns the host side of the panel. It consumes the
 * read-only `ActorTree` (rendered as a `tree` message), forwards `apply`
 * payloads to the `CommandTrigger` port, and posts `complete`/`error` back.
 * Depends on nothing but the read-model and the trigger, so it is swappable
 * for a QuickPick or static menu UI with zero engine impact.
 */
export class DustCommandSurface {
  private readonly disposables: { dispose(): void }[] = [];
  private disposed = false;

  constructor(
    private readonly panel: DustPanel,
    private readonly deps: CommandSurfaceDeps
  ) {
    this.disposables.push(panel.webview.onDidReceiveMessage((message) => void this.handleMessage(message)));
    this.disposables.push(panel.onDidDispose(() => this.dispose()));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private post(message: HostToWebview): void {
    if (this.disposed) {
      return;
    }
    this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const typed = message as WebviewToHost;
    switch (typed.type) {
      case 'loadTree': {
        const { root, actors } = await buildActorTreePayload(this.deps.catalogue, this.deps.fs, this.deps.toFileUri);
        this.post({ type: 'tree', root, actors });
        return;
      }
      case 'apply':
        await this.run(typed.payload);
        return;
      case 'close':
        this.panel.dispose();
    }
  }

  private async run(payload: WebviewApplyRequest): Promise<void> {
    try {
      const result = await this.deps.trigger.onApply(
        payload.actorId,
        (payload.targetPaths ?? []).map((path) => this.deps.toFileUri(path)),
        payload.wholeTarget ?? false,
        {
          model: payload.model ?? undefined,
          gateway: payload.gateway ?? undefined,
          addendum: payload.addendum ?? undefined,
        }
      );
      this.post({ type: 'complete', result });
    } catch (error) {
      this.post({ type: 'error', message: (error as Error).message });
    }
  }
}
