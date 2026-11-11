import type { Role } from '@dust/shared';
import { AgentGateway } from '../dispatch';
import type { ClineApiResolver } from './clineApi';

/**
 * Resolves Cline's API lazily via the dedicated module so this class stays
 * importable under plain Node (the `vscode` import lives in `clineApi`).
 */
function defaultResolver(): ReturnType<ClineApiResolver> {
  return import('./clineApi').then((module) => module.resolveClineApi());
}

/**
 * Adapter: hands a composed turn to Cline via its exported extension API.
 * Fire-and-forget, matching Copilot dispatch — completion arrives out-of-band
 * through Completion Signalling, never from the chat tool itself.
 */
export class ClineChatAgent implements AgentGateway {
  constructor(private readonly resolveApi: ClineApiResolver = defaultResolver) {}

  dispatch(instruction: string, _model?: Role): void {
    void this.resolveApi().then(
      (api) => {
        if (!api) {
          console.error('dust: cline gateway requested but the Cline extension API is unavailable');
          return;
        }
        void api.startNewTask(instruction).catch((error: unknown) => {
          console.error('dust: failed to dispatch to Cline', error);
        });
      },
      (error: unknown) => {
        console.error('dust: failed to resolve Cline API', error);
      }
    );
  }
}
