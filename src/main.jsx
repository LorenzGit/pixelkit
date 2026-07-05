import '@fontsource-variable/inter';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import './styles.css';

if (import.meta.env.DEV) {
  window.addEventListener('error', e => console.error('[PixelKit runtime]', e.message, e.error));
  window.addEventListener('unhandledrejection', e => console.error('[PixelKit promise]', e.reason));
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>,
);
