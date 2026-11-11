import type { ChatGateway, Role } from '@dust/shared';
import { CHAT_GATEWAYS, ROLES, isChatGateway, isRole } from '@dust/shared';

/** A parsed actor step file: the body text plus its optional metadata. */
export interface ParsedStep {
  body: string;
  model?: Role;
  gateway?: ChatGateway;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)/;

/**
 * Parses an actor step file: optional YAML front-matter plus the markdown body.
 * Unknown front-matter keys are ignored; the `model` value must be one of the
 * closed role set and `gateway` one of the closed chat-tool set. A file
 * without a front-matter block is treated as body-only.
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

  const result: ParsedStep = { body: match[2].trim() };
  const model = fields['model'];
  if (model !== undefined) {
    if (!isRole(model)) {
      throw new Error(`actor step front-matter 'model' must be one of: ${ROLES.join(', ')} (got '${model}')`);
    }
    result.model = model;
  }
  const gateway = fields['gateway'];
  if (gateway !== undefined) {
    if (!isChatGateway(gateway)) {
      throw new Error(
        `actor step front-matter 'gateway' must be one of: ${CHAT_GATEWAYS.join(', ')} (got '${gateway}')`
      );
    }
    result.gateway = gateway;
  }
  return result;
}
