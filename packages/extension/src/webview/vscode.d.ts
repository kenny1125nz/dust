/**
 * The VS Code Webview API is not declared by `@types/vscode` — it is provided
 * by the Webview host at runtime. This mirrors the official sample declaration.
 */
declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: T): void;
  getState(): T | undefined;
  setState(state: T): void;
};
