import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/tokens.css';
import './ui/global.css';
import { RemProvider } from './app/RemProvider';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RemProvider>
      <App />
    </RemProvider>
  </StrictMode>,
);
