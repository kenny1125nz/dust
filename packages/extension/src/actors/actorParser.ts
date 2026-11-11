import type { ChatGateway, Role } from '@dust/shared';
import { CHAT_GATEWAYS, ROLES, isChatGateway, isRole } from '@dust/shared';

export interface ParsedFrontMatter {
  model?: Role;
  gateway?: ChatGateway;
}

export type FolderKind = 'multi-step' | 'sub-menu';

const STEP_FILE_RE = /^\d+[-.]/;
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** True when the file name starts with a numeric step prefix, e.g. `01-plan.md`. */
export function isStepFile(name: string): boolean {
  return STEP_FILE_RE.test(name);
}

/** The leading numeric prefix of a file name, `0` when absent. */
export function numericPrefix(name: string): number {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Orders step files by their numeric prefix, name as a deterministic tie-break. */
export function orderStepFiles(files: string[]): string[] {
  return [...files].sort(
    (a, b) => numericPrefix(a) - numericPrefix(b) || a.localeCompare(b, 'en')
  );
}

/**
 * The folder disambiguation rule:
 * - Only numbered `.md` files, no sub-folders → multi-step actor (leaf).
 * - Sub-folders present (or non-step files) → sub-menu (branch).
 */
export function classifyFolder(files: string[], directories: string[]): FolderKind {
  if (directories.length === 0 && files.length > 0 && files.every(isStepFile)) {
    return 'multi-step';
  }
  return 'sub-menu';
}

/**
 * Parses the optional YAML front-matter at the top of an actor file. Only the
 * `model` and `gateway` keys are recognized; unknown keys are ignored
 * (forward-compatible). Malformed or invalid front-matter fails fast with a
 * clear, actionable message.
 */
export function parseActorFrontMatter(raw: string): ParsedFrontMatter {
  if (!raw.startsWith('---')) {
    return {};
  }
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    throw new Error(
      'malformed actor front-matter: expected a "---" ... "---" block at the top of the file'
    );
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const result: ParsedFrontMatter = {};
  const model = fields['model'];
  if (model !== undefined) {
    if (!isRole(model)) {
      throw new Error(`actor front-matter 'model' must be one of: ${ROLES.join(', ')} (got '${model}')`);
    }
    result.model = model;
  }
  const gateway = fields['gateway'];
  if (gateway !== undefined) {
    if (!isChatGateway(gateway)) {
      throw new Error(
        `actor front-matter 'gateway' must be one of: ${CHAT_GATEWAYS.join(', ')} (got '${gateway}')`
      );
    }
    result.gateway = gateway;
  }
  return result;
}
