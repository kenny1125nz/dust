import type { ChatGateway } from '@dust/shared';
import { AgentGateway } from './agentGateway';

export const DEFAULT_GATEWAY: ChatGateway = 'copilot';

/**
 * Port: resolves the `AgentGateway` for a chat-tool name. The engine depends on
 * this single call instead of one fixed gateway, so dispatch targets can be
 * chosen per request, per step, or per actor. The composition root supplies the
 * concrete registry.
 */
export interface GatewaySelector {
  select(name?: ChatGateway): AgentGateway;
}

/**
 * Adapter: a fixed-name registry over an explicit mapping. Unknown names fall
 * back to `DEFAULT_GATEWAY` so a bad front-matter value can never take a turn
 * hostage.
 */
export class GatewayRegistry implements GatewaySelector {
  constructor(
    private readonly gateways: Partial<Record<ChatGateway, AgentGateway>>,
    private readonly fallback: AgentGateway
  ) {}

  select(name?: ChatGateway): AgentGateway {
    const gateway = name !== undefined ? this.gateways[name] : undefined;
    return gateway ?? this.fallback;
  }
}

export function createGatewayRegistry(gateways: {
  copilot: AgentGateway;
  cline: AgentGateway;
}): GatewayRegistry {
  return new GatewayRegistry(gateways, gateways[DEFAULT_GATEWAY]);
}
