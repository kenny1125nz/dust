import * as net from 'net';
import { CompletionFrame, completionPipeName } from '@dust/shared';
import { CompletionSource } from '../completion/completionSource';
import { validateFrame } from '../completion/validateFrame';

interface Waiter {
  resolve: (frame: CompletionFrame) => void;
  reject: (error: Error) => void;
}

/**
 * Adapter (extension side): listens on the workspace-keyed named pipe and
 * resolves the waiter for the matching `correlationId` when a frame arrives.
 * One-way channel — CLI writes, extension reads; no acknowledgment.
 */
export class PipeCompletionSource implements CompletionSource {
  private readonly waiters = new Map<string, Waiter>();
  private readonly server: net.Server;

  private constructor(private readonly pipeName: string) {
    this.server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          this.handleLine(line.trim());
        }
      });
      socket.on('error', (error: Error) => {
        console.error('dust: completion pipe socket error', error);
      });
    });
    this.server.on('error', (error: Error) => {
      console.error('dust: completion pipe error', error);
    });
  }

  static forWorkspace(workspacePath: string): PipeCompletionSource {
    return new PipeCompletionSource(completionPipeName(workspacePath));
  }

  get endpoint(): string {
    return this.pipeName;
  }

  /** Opens the pipe. Resolves once the listener is bound. */
  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.removeListener('error', onError);
        this.rejectWaiters(error);
        reject(error);
      };
      this.server.once('error', onError);
      this.server.listen(this.pipeName, () => {
        this.server.removeListener('error', onError);
        resolve();
      });
    });
  }

  /** Closes the pipe and rejects any still-pending waiters. */
  dispose(): void {
    if (this.server.listening) {
      this.server.close();
    }
    this.rejectWaiters(new Error('completion pipe closed before the callback arrived'));
  }

  await(correlationId: string): Promise<CompletionFrame> {
    return new Promise<CompletionFrame>((resolve, reject) => {
      this.waiters.set(correlationId, { resolve, reject });
    });
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.values()) {
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private handleLine(line: string): void {
    if (line.length === 0) {
      return;
    }
    let frame: CompletionFrame;
    try {
      frame = validateFrame(JSON.parse(line));
    } catch (error) {
      console.error('dust: ignoring invalid completion frame', error);
      return;
    }
    const waiter = this.waiters.get(frame.correlationId);
    if (waiter) {
      this.waiters.delete(frame.correlationId);
      waiter.resolve(frame);
    }
  }
}
