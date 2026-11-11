import * as vscode from 'vscode';

export const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

/** The subset of Cline's exported extension API dust consumes. */
export interface ClineAPI {
  /** Starts a new task with an optional initial message and images. */
  startNewTask(task?: string, images?: string[]): Promise<void>;
}

/** Resolves the live Cline API object, or `undefined` when unavailable. */
export type ClineApiResolver = () => Promise<ClineAPI | undefined>;

/**
 * Resolves Cline's extension API the documented way: activate the extension
 * (its `activate()` returns the API surface) and fall back to its `exports`.
 * Cline ships an A/B loader, so probing `exports` first is fragile; the
 * activate return is the stable surface across both bundles.
 */
export function resolveClineApi(): Promise<ClineAPI | undefined> {
  const extension = vscode.extensions.getExtension(CLINE_EXTENSION_ID);
  if (!extension) {
    return Promise.resolve(undefined);
  }
  return Promise.resolve(extension.activate()).then(
    (api) => {
      if (api && typeof (api as ClineAPI).startNewTask === 'function') {
        return api as ClineAPI;
      }
      const exports = extension.exports as ClineAPI | undefined;
      return exports && typeof exports.startNewTask === 'function' ? exports : undefined;
    },
    (error: unknown) => {
      console.error('dust: failed to activate Cline extension', error);
      return undefined;
    }
  );
}
