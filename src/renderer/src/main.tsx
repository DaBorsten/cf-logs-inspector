import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/globals.css';
import { App } from './App';

async function bootstrap(): Promise<void> {
  if (!('api' in window)) {
    // Running in a plain browser (no preload): use the in-memory mock backend for UI development.
    const { installMockApi } = await import('./api/mock/mock-api');
    installMockApi();
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
