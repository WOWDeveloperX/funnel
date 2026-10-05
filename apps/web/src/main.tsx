import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Fonts are self-hosted (bundled woff2 via @fontsource-variable) — no third-party font CDN at runtime.
import '@fontsource-variable/geologica/wght.css';
import '@fontsource-variable/onest/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
);
