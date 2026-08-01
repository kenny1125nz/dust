import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  // Composition root — instantiate adapters, wire components, register commands.
  // Specifics live in 07-command-surface-activation.md.

  context.subscriptions.push(
    vscode.commands.registerCommand('dust.open', (clickedUri: vscode.Uri, selectedUris: vscode.Uri[]) => {
      // Open Webview panel, pass selected URIs
    })
  );
}

export function deactivate(): void {
  // Close named pipe listener, flush metrics, etc.
}
