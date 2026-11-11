import * as path from 'path';
import * as vscode from 'vscode';
import {
  ActorSourceAdapter,
  ClineChatAgent,
  PipeCompletionSource,
  SqliteMetricsSink,
  VscodeChatAgent,
  VscodeFileSystem,
} from './adapters';
import { createGatewayRegistry } from './dispatch';
import { createApplyEngine } from './engine';
import { createTargetResolver } from './targets';
import { openDustSurface } from './surface/webviewPanel';

const ACTORS_RELATIVE = path.join('.dust', 'actors');
const METRICS_RELATIVE = path.join('.dust', 'metrics.db');

/**
 * Composition root — the only place that instantiates concretions. It wires
 * the adapters into the Apply Engine and injects the catalogue, target
 * resolver, engine, and fs into the Webview surface. Everything else depends
 * only on ports.
 */
export function activate(context: vscode.ExtensionContext): void {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const toFileUri = (filePath: string): vscode.Uri => vscode.Uri.file(filePath);

  const catalogue = new ActorSourceAdapter(path.join(workspacePath, ACTORS_RELATIVE));
  const fs = new VscodeFileSystem();
  const targets = createTargetResolver(fs);
  const gateways = createGatewayRegistry({
    copilot: new VscodeChatAgent(),
    cline: new ClineChatAgent(),
  });
  const completion = PipeCompletionSource.forWorkspace(workspacePath);
  const metrics = new SqliteMetricsSink(path.join(workspacePath, METRICS_RELATIVE));
  const engine = createApplyEngine({
    catalogue,
    targets,
    gateways,
    completion,
    fs,
    metrics,
    version: (context.extension.packageJSON.version as string | undefined) ?? '0.0.0',
    toFileUri,
  });

  void completion.start().catch((error: Error) => {
    console.error('dust: completion pipe failed to start', error);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('dust.open', (clickedUri: vscode.Uri, selectedUris: vscode.Uri[] | undefined) => {
      const uris = selectedUris && selectedUris.length > 0 ? selectedUris : [clickedUri];
      const panel = vscode.window.createWebviewPanel(
        'dust',
        'Apply Dust Actor',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      void openDustSurface({
        panel,
        extensionUri: context.extensionUri,
        workspacePath,
        uris,
        catalogue,
        targets,
        engine,
        fs,
        toFileUri,
      }).catch((error: Error) => {
        console.error('dust: failed to open command surface', error);
        panel.dispose();
      });
    }),
    new vscode.Disposable(() => {
      completion.dispose();
    })
  );
}

export function deactivate(): void {
  // VS Code disposes context.subscriptions on deactivate, which closes the
  // completion pipe; the metrics sink degrades to a no-op if never opened.
}
