import type { CompletionFrame } from '@dust/shared';

export interface CompletionSource {
  /** Returns a promise that resolves when a callback frame matches the given correlation id. */
  await(correlationId: string): Promise<CompletionFrame>;
}
