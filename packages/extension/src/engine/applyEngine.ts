import { randomUUID } from 'crypto';
import * as path from 'path';
import type { Uri } from 'vscode';
import type { Role } from '@dust/shared';
import type { ActorSource } from '../actors/actorSource';
import type { TargetResolver } from '../targets/targetResolver';
import type { FileSystem } from '../targets/fileSystem';
import { FileType } from '../targets/fileSystem';
import type { AgentGateway } from '../dispatch/agentGateway';
import type { CompletionSource } from '../completion/completionSource';
import type { MetricsSink } from '../metrics/metricsSink';
import { compose, feedbackSection, importantNote, targetLabel } from './compose';
import { ParsedStep, parseActorFile } from './parseActorFile';

export interface ApplyRequest {
  actorId: string;
  targetUris: Uri[];
  wholeTarget: boolean;
  /** Workspace root path, used to derive the `--workspace` value. */
  workspacePath: string;
  model?: Role;
  /** Extra instructions from the Webview's "Extra Instructions" textarea. */
  addendum?: string;
}

export interface RunResult {
  itemCount: number;
  stepCount: number;
}

export interface ApplyEngine {
  /** Run the full apply loop: expand → enumerate → compose → dispatch → await → advance. */
  apply(request: ApplyRequest): Promise<RunResult>;
}

/**
 * The ports the orchestrator depends on — never adapters or host APIs. The
 * `toFileUri` seam converts the actor catalogue's plain step-file paths into
 * the `vscode.Uri` shape the `FileSystem` port expects (a host concern: the
 * composition root supplies `vscode.Uri.file`).
 */
export interface ApplyEngineDeps {
  catalogue: ActorSource;
  targets: TargetResolver;
  gateway: AgentGateway;
  completion: CompletionSource;
  fs: FileSystem;
  metrics: MetricsSink;
  /** The extension version, recorded on each run. */
  version: string;
  toFileUri: (path: string) => Uri;
}

/**
 * The DIP hub and the only place sequencing lives: expand an actor into turns,
 * iterate targets, compose each turn, dispatch, await completion, advance.
 */
export class ApplyOrchestrator implements ApplyEngine {
  constructor(private readonly deps: ApplyEngineDeps) {}

  async apply(request: ApplyRequest): Promise<RunResult> {
    const { catalogue, targets, gateway, completion, metrics } = this.deps;

    const actor = catalogue.loadTree().getActor(request.actorId);
    if (!actor) {
      throw new Error(`unknown actor: ${request.actorId}`);
    }

    const items = await targets.resolve(request.targetUris, request.wholeTarget);
    const workspaceName = path.basename(request.workspacePath);
    const runId = randomUUID();
    const startedAt = Date.now();

    let stepIndex = 0;
    let runStartEmitted = false;
    const fallbackRole = request.model ?? actor.model;

    // The run-level role resolves lazily from the first dispatched step so a
    // broken first step can never suppress the run-start sentinel.
    const emitRunStart = (role: string | undefined): void => {
      if (runStartEmitted) {
        return;
      }
      runStartEmitted = true;
      this.emit(() =>
        metrics.recordRunStart({
          runId,
          actorId: request.actorId,
          actorKind: actor.steps.length > 1 ? 'multi-step' : 'single-file',
          wholeTarget: request.wholeTarget,
          itemCount: items.length,
          role: role ?? '',
          chatMode: role ?? '',
          startedAt,
          dustVersion: this.deps.version,
        })
      );
    };

    try {
      for (const item of items) {
        const uris = Array.isArray(item.target) ? item.target : [item.target];
        for (const stepPath of actor.steps) {
          const step = await this.readStep(stepPath).catch((error: Error) => {
            emitRunStart(fallbackRole);
            throw error;
          });
          emitRunStart(request.model ?? step.model ?? actor.model);
          const context = await this.targetContext(uris);
          stepIndex++;
          const cid = randomUUID();
          const instruction = this.composeInstruction(step, context.target, context.content, cid, workspaceName, request);
          const dispatchedAt = Date.now();
          gateway.dispatch(instruction, request.model ?? step.model ?? actor.model);
          const frame = await completion.await(cid);
          this.emit(() =>
            metrics.recordStep({
              runId,
              index: stepIndex,
              correlationId: cid,
              itemPath: uris[0].path,
              dispatchedAt,
              completedAt: Date.now(),
              status: frame.status,
              summary: frame.summary,
            })
          );
        }
      }
      emitRunStart(fallbackRole);
      return { itemCount: items.length, stepCount: stepIndex };
    } finally {
      this.emit(() => metrics.recordRunEnd(runId));
    }
  }

  /** Reads and parses a step file, decorating parse failures with its path. */
  private async readStep(stepPath: string): Promise<ParsedStep> {
    try {
      const bytes = await this.deps.fs.read(this.deps.toFileUri(stepPath));
      return parseActorFile(Buffer.from(bytes).toString('utf8'));
    } catch (error) {
      throw new Error(`${stepPath}: ${(error as Error).message}`);
    }
  }

  /** Resolves the target label and, for a single file, its whole content. */
  private async targetContext(uris: Uri[]): Promise<{ target: string; content: string }> {
    const singleFile = uris.length === 1 && (await this.deps.fs.stat(uris[0])) === FileType.File;
    const content = singleFile ? Buffer.from(await this.deps.fs.read(uris[0])).toString('utf8') : '';
    return { target: targetLabel(uris), content };
  }

  private composeInstruction(
    step: ParsedStep,
    target: string,
    content: string,
    cid: string,
    workspaceName: string,
    request: ApplyRequest
  ): string {
    return [
      compose(step.body, target, content),
      request.addendum ? importantNote(request.addendum) : '',
      feedbackSection(cid, workspaceName),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Best-effort metrics: a sink failure never disrupts the apply run. */
  private emit(record: () => void): void {
    try {
      record();
    } catch {
      // Silently dropped — metrics are observation only.
    }
  }
}

export function createApplyEngine(deps: ApplyEngineDeps): ApplyEngine {
  return new ApplyOrchestrator(deps);
}
