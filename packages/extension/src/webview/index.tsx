import { render } from 'preact';
import { App } from './App';
import { createInitialState, parseInitialData } from './state';
import './styles.css';

interface DustWindow extends Window {
  __DUST_INITIAL__?: unknown;
}

const root = document.getElementById('root');
if (root) {
  const initial = parseInitialData((window as DustWindow).__DUST_INITIAL__);
  render(<App initialState={createInitialState(initial)} />, root);
}
