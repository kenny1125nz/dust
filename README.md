# Dust

A standalone VS Code extension that applies an **actor** over a selected file or folder (recursively) from the Explorer context menu.

Actors are markdown files arranged in a folder tree. The extension is deliberately ignorant of what an actor means: it walks the selected target, dispatches each item to Copilot Chat framed by the actor's instructions, and reports progress.

## What it does

- Right-click a file or folder, choose an actor, and run it over the target.
- Recursively processes folder targets.
- Keeps orchestration in VS Code while agents do the work.
- Ships two artifacts from one codebase:
  - the **VS Code extension**
  - a global **`dust-callback` CLI** invoked by the agent

## Repository layout

```
packages/
  shared/      # shared types and endpoints
  callback/    # dust-callback CLI
  extension/   # VS Code extension + webview
```

## Getting started

```bash
npm install
npm run compile
npm run build       # compiles packages and builds the webview
npm test
```

Package the extension:

```bash
npm run package
```

The resulting VSIX can be installed from VS Code.

## Documentation

See `goal/` for the vision, design, and component map.

## Status

Early-stage extension and CLI.
