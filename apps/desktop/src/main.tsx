import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import './styles/app.css';
import { applyStoredTheme } from './theme/theme.js';

// Before the first paint, not in an effect: otherwise a dark-theme user sees a
// white window for a frame every single launch.
applyStoredTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
