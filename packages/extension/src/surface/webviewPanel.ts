import * as fs from 'fs';
import * as vscode from 'vscode';
import type { ActorSource } from '../actors/actorSource';
import type { ApplyEngine } from '../engine';
import type { FileSystem, TargetResolver } from '../targets';
import { ApplyEngineTrigger } from './commandTrigger';
import { CommandSurfaceDeps, DustCommandSurface, DustPanel } from './commandSurface';
import { escapeInitialData, newNonce, renderWebviewHtml } from './htmlTemplate';
import { buildTargetTreePayload } from './treePayload';
import { DustInitialData } from './webviewProtocol';

export interface OpenDustSurfaceParams {
  panel: vscode.WebviewPanel;
  extensionUri: vscode.Uri;
  workspacePath: string;
  uris: vscode.Uri[];
  catalogue: ActorSource;
  targets: TargetResolver;
  engine: ApplyEngine;
  fs: FileSystem;
  toFileUri: (path: string) => vscode.Uri;
}

/**
 * Host-side wiring for the `dust.open` command: resolves the Explorer
 * selection into a display tree, builds the panel HTML (with the initial data
 * embedded and a CSP nonce), and attaches a `DustCommandSurface`.
 */
export async function openDustSurface(params: OpenDustSurfaceParams): Promise<void> {
  const targetNodes = await params.targets.resolveTree(params.uris);
  const initialData: DustInitialData = {
    targetTree: buildTargetTreePayload(targetNodes),
    targetPaths: params.uris.map((uri) => uri.fsPath),
    workspacePath: params.workspacePath,
  };

  const webview = params.panel.webview;
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(params.extensionUri, 'dist', 'webview', 'index.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(params.extensionUri, 'dist', 'webview', 'index.css'));
  const template = fs.readFileSync(vscode.Uri.joinPath(params.extensionUri, 'assets', 'webview.html').fsPath, 'utf8');

  params.panel.webview.html = renderWebviewHtml(template, {
    cspSource: webview.cspSource,
    nonce: newNonce(),
    scriptUri: scriptUri.toString(),
    styleUri: styleUri.toString(),
    initialData: escapeInitialData(initialData),
  });

  const deps: CommandSurfaceDeps = {
    catalogue: params.catalogue,
    trigger: new ApplyEngineTrigger(params.engine, params.workspacePath),
    fs: params.fs,
    toFileUri: params.toFileUri,
  };
  new DustCommandSurface(adaptPanel(params.panel), deps);
}

function adaptPanel(panel: vscode.WebviewPanel): DustPanel {
  return {
    webview: {
      postMessage: (message) => {
        void panel.webview.postMessage(message).then(undefined, () => undefined);
      },
      onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
    },
    onDidDispose: (listener) => panel.onDidDispose(listener),
    dispose: () => panel.dispose(),
  };
}
