import type { ChatGateway, Role } from '@dust/shared';
import { CHAT_GATEWAYS, ROLES } from '@dust/shared';
import { useEffect, useReducer } from 'preact/hooks';
import type { ActorPreview, HostToWebview, WebviewToHost } from '../surface/webviewProtocol';
import { ActorTree } from './components/ActorTree';
import { Section } from './components/Section';
import { TargetTree } from './components/TargetTree';
import type { PanelState } from './state';
import { panelReducer } from './state';

const vscode = acquireVsCodeApi<WebviewToHost>();

export interface AppProps {
  initialState: PanelState;
}

export function App({ initialState }: AppProps) {
  const [state, dispatch] = useReducer(panelReducer, initialState);

  useEffect(() => {
    vscode.postMessage({ type: 'loadTree' });
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const message = event.data as HostToWebview;
      switch (message.type) {
        case 'tree':
          dispatch({ type: 'SET_TREE', root: message.root, actors: message.actors });
          break;
        case 'complete':
          dispatch({ type: 'SET_COMPLETE', result: message.result });
          break;
        case 'error':
          dispatch({ type: 'SET_ERROR', message: message.message });
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const running = state.phase === 'running';
  const selectedActor: ActorPreview | null = state.selectedActorId ? (state.actors[state.selectedActorId] ?? null) : null;
  const applyDisabled = state.selectedActorId === null || running;

  const handleApply = (): void => {
    if (state.selectedActorId === null) {
      return;
    }
    vscode.postMessage({
      type: 'apply',
      payload: {
        actorId: state.selectedActorId,
        targetPaths: state.targetPaths,
        wholeTarget: state.wholeTarget,
        workspacePath: state.workspacePath,
        model: state.model,
        gateway: state.gateway,
        addendum: state.addendum,
      },
    });
    dispatch({ type: 'SET_RUNNING' });
  };

  const handleCancel = (): void => {
    vscode.postMessage({ type: 'close' });
  };

  return (
    <div className="dust-panel">
      <header className="dust-header">dust</header>

      <Section label="Selected Target">
        <div className="dust-toggle" role="radiogroup" aria-label="Target mode">
          <label className="dust-radio">
            <input
              type="radio"
              name="target-mode"
              checked={!state.wholeTarget}
              disabled={running}
              onChange={() => dispatch({ type: 'SET_WHOLE_TARGET', wholeTarget: false })}
            />
            Each (iterate)
          </label>
          <label className="dust-radio">
            <input
              type="radio"
              name="target-mode"
              checked={state.wholeTarget}
              disabled={running}
              onChange={() => dispatch({ type: 'SET_WHOLE_TARGET', wholeTarget: true })}
            />
            Together (one run)
          </label>
        </div>
        <TargetTree nodes={state.targetTree} />
      </Section>

      <Section label="Actors">
        <div className="dust-split">
          <ActorTree
            root={state.actorTree}
            selected={state.selectedActorId}
            disabled={running}
            onSelect={(id) => dispatch({ type: 'SELECT_ACTOR', id })}
          />
          <ActorPreview actor={selectedActor} />
        </div>
      </Section>

      <Section label="Model">
        <select
          className="dust-select"
          value={state.model ?? ''}
          disabled={running}
          onChange={(event) => {
            const value = event.currentTarget.value;
            dispatch({ type: 'SET_MODEL', model: value === '' ? null : (value as Role) });
          }}
        >
          <option value="">(no override)</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </Section>

      <Section label="Chat Tool">
        <select
          className="dust-select"
          value={state.gateway ?? ''}
          disabled={running}
          onChange={(event) => {
            const value = event.currentTarget.value;
            dispatch({ type: 'SET_GATEWAY', gateway: value === '' ? null : (value as ChatGateway) });
          }}
        >
          <option value="">(actor default{actorDefaultGateway(selectedActor)})</option>
          {CHAT_GATEWAYS.map((gateway) => (
            <option key={gateway} value={gateway}>
              {gateway}
            </option>
          ))}
        </select>
      </Section>

      <Section label="Extra Instructions">
        <textarea
          className="dust-textarea"
          value={state.addendum}
          disabled={running}
          placeholder="Add a one-time instruction for this run…"
          onChange={(event) => dispatch({ type: 'SET_ADDENDUM', text: event.currentTarget.value })}
        />
      </Section>

      {state.phase === 'running' && (
        <div className="dust-status" role="status">
          <span>Running…</span>
          <div className="dust-progress" aria-hidden="true">
            <div className="dust-progress-bar" />
          </div>
        </div>
      )}
      {state.phase === 'complete' && state.result && (
        <div className="dust-status" role="status">
          Done — {state.result.itemCount} item(s) in {state.result.stepCount} step(s)
        </div>
      )}
      {state.phase === 'error' && (
        <div className="dust-status dust-status-error" role="alert">
          {state.error}
        </div>
      )}

      <footer className="dust-actions">
        <button type="button" onClick={handleCancel}>
          Cancel
        </button>
        <button type="button" className="dust-primary" onClick={handleApply} disabled={applyDisabled}>
          {running ? 'Running…' : 'Apply'}
        </button>
      </footer>
    </div>
  );
}

function ActorPreview({ actor }: { actor: ActorPreview | null }) {
  if (!actor) {
    return <div className="dust-preview">Select an actor from the tree.</div>;
  }
  if (actor.steps.length > 1) {
    return (
      <div className="dust-preview">
        <ol className="dust-preview-steps">
          {actor.steps.map((step) => (
            <li key={step}>{stepFileName(step)}</li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className="dust-preview">
      <pre className="dust-preview-body">{actor.body}</pre>
    </div>
  );
}

function stepFileName(step: string): string {
  return step.split(/[\\/]/).pop() ?? step;
}

/** Renders the actor's own chat-tool default as a hint in the override label. */
function actorDefaultGateway(actor: ActorPreview | null): string {
  return actor?.gateway ? `: ${actor.gateway}` : '';
}
