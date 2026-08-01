import type { Role } from '@dust/shared';
import { ROLES, isRole } from '@dust/shared';

/** A parsed actor step file: the body text plus its optional abstract role. */
export interface ParsedStep {
  body: string;
  model?: Role;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)/;

/**
 * Parses an actor step file: optional YAML front-matter plus the markdown body.
 * Unknown front-matter keys are ignored; the `model` value must be one of the
 * closed role set. A file without a front-matter block is treated as body-only.
 */
export function parseActorFile(raw: string): ParsedStep {
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    return { body: raw };
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }

  const model = fields['model'];
  if (model !== undefined && !isRole(model)) {
    throw new Error(`actor step front-matter 'model' must be one of: ${ROLES.join(', ')} (got '${model}')`);
  }

  return { body: match[2].trim(), model };
}
