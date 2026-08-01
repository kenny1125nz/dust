import * as path from 'path';
import type { Uri } from 'vscode';

/**
 * The display label for a dispatch target: the single file/folder name, or a
 * comma-separated list of names for a multi-select (`wholeTarget: true`).
 */
export function targetLabel(uris: Uri[]): string {
  return uris.length === 1
    ? path.basename(uris[0].path)
    : uris.map((u) => path.basename(u.path)).join(', ');
}

/**
 * Pure slot interpolation for a step body:
 * - `${target}`        → the target label
 * - `${targetContent}` → the single file's content (empty for folders/multi-select)
 * Unknown slots are left as-is.
 */
export function compose(stepBody: string, target: string, content: string): string {
  return stepBody
    .replace(/\$\{target\}/g, target)
    .replace(/\$\{targetContent\}/g, content);
}

/** Wraps the Webview "Extra Instructions" addendum under a distinct heading. */
export function importantNote(addendum: string): string {
  return `## Important Note\n${addendum}`;
}

/**
 * The `## Feedback` section appended to every instruction. The agent is the
 * caller of `dust-callback`, so the block starts with `--help` (its flag
 * contract), then the exact invocation with the correlation id and workspace,
 * then the summary file schema.
 */
export function feedbackSection(correlationId: string, workspaceName: string): string {
  return `## Feedback
To signal completion, use the dust-callback command. Run dust-callback --help first to verify the flag interface.

When done, invoke:
  dust-callback --status done --id ${correlationId} --summary_file <path/to/summary.json> --workspace ${workspaceName}

The summary file must be valid JSON matching:
  { "confidence": <number 0-100>, "actions": ["<string>", ...], "notes": "<string>" }`;
}
