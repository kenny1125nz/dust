import { Section } from './components/Section';

export function App() {
  return (
    <div className="dust-panel">
      <h1 className="dust-title">dust</h1>
      <Section label="Scaffold">
        <p>
          Webview command surface scaffold. Actor tree, preview, and per-run tweaks
          land here with 07-command-surface-activation.
        </p>
      </Section>
    </div>
  );
}
