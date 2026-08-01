# Project Setup

> **Scope:** Codebase root, folder structure, and toolchain. No component logic — this is the scaffold every component lives inside.

## Repository Root

```
dust/                         ← git root
├── .vscode/
│   ├── launch.json           # extension host debug config
│   └── tasks.json            # compile + watch
├── package.json              # root workspace (npm workspaces)
├── tsconfig.base.json        # shared TS compiler options
├── packages/
│   ├── extension/            # VS Code extension
│   ├── callback/             # npm global CLI (`dust-callback`)
│   └── shared/               # types + endpointIdentity shared kernel
└── .dust/                    # workspace-local data (metrics, actors)
    ├── actors/                # user-authored actor files
    └── metrics.db            # run-metrics SQLite store
```

## packages/extension

Standard VS Code extension scaffold, Preact for the webview UI.

```
packages/extension/
├── package.json              # "activationEvents", "contributes", "main"
├── tsconfig.json             # extends ../../tsconfig.base.json
├── src/
│   ├── extension.ts          # activate() — composition root
│   ├── webview/              # Preact app (bundled separately)
│   │   ├── index.tsx          # render(<App />, root)
│   │   ├── App.tsx            # top-level layout
│   │   └── components/        # tree, dropdown, textarea, etc.
│   └── adapters/             # port implementations (chat, pipe, fs, metrics)
└── assets/
    └── webview.html           # bare HTML shell for the Webview panel
```

### package.json essentials

```jsonc
{
  "name": "dust",
  "displayName": "dust",
  "version": "0.1.0",
  "engines": { "vscode": "^1.90.0" },
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "dust.open",
        "title": "Apply Dust Actor…"
      }
    ],
    "menus": {
      "explorer/context": [
        {
          "command": "dust.open",
          "when": "resourceScheme == file",
          "group": "navigation"
        }
      ]
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "build:webview": "esbuild src/webview/index.tsx --bundle --outdir=dist/webview --external:vscode",
    "package": "vsce package"
  },
  "dependencies": {
    "@dust/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/vscode": "^1.90.0",
    "typescript": "^5.x",
    "preact": "^10.x",
    "esbuild": "^0.x",
    "@vscode/vsce": "^3.x"
  }
}
```

### tsconfig.json

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "lib": ["ES2022"]
  },
  "include": ["src"]
}
```

### src/extension.ts (skeleton)

```typescript
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
```

## packages/callback

Standalone Node.js CLI, installable via `npm install -g @dust/callback`.

```
packages/callback/
├── package.json              # "bin": { "dust-callback": "./bin/dust-callback.js" }
├── tsconfig.json
├── bin/
│   └── dust-callback.js       # entry point (shebang + require)
└── src/
    ├── cli.ts                 # parse args, validate, connect pipe, send frame
    └── endpoint.ts            # endpointIdentity (re-exports from shared)
```

### package.json essentials

```jsonc
{
  "name": "@dust/callback",
  "version": "0.1.0",
  "bin": {
    "dust-callback": "./bin/dust-callback.js"
  },
  "preferGlobal": true,
  "scripts": {
    "compile": "tsc -p ./",
    "prepublishOnly": "npm run compile"
  },
  "dependencies": {
    "@dust/shared": "workspace:*"
  }
}
```

### bin/dust-callback.js

```javascript
#!/usr/bin/env node
require('../dist/cli.js');
```

Executable placed on `PATH` by npm global install. The agent invokes `dust-callback --status ... --id ... --summary_file ... --workspace ...` from any directory.

## packages/shared

Types and the `endpointIdentity` kernel shared by extension + callback.

```
packages/shared/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # barrel export
    ├── types.ts              # Role, shared contracts
    └── endpoint.ts           # endpointIdentity(workspacePath) → pipe name
```

## Toolchain

| Tool | Purpose |
|------|---------|
| TypeScript 5.x | All packages |
| esbuild | Bundle the Preact webview (fast, tiny output) |
| @vscode/vsce | Package the extension into `.vsix` |
| npm workspaces | Monorepo — `npm install` at root links all packages |

## Build Output

```
packages/extension/dist/
├── extension.js              # compiled extension host code
└── webview/
    └── index.js              # bundled Preact app

packages/callback/dist/
├── cli.js                    # compiled CLI
└── endpoint.js               # shared kernel
```
