
// Fonts ship with the bundle: the game is single-player and must not depend on a CDN.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import NotificationHost from './components/NotificationHost';
import ErrorBoundary from './components/ErrorBoundary';
import { LocalizationProvider } from './context/LocalizationContext';
import { SpeechProvider } from './context/SpeechContext';
import { markCrashDetected, requestStartupLoad } from './utils/fileManager';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const reloadForStartupLoad = (request: 'crashRecovery' | 'autosave'): boolean => {
  requestStartupLoad(request);
  window.location.reload();
  return true;
};

const handleRootCrashRecovery = (): boolean => reloadForStartupLoad('crashRecovery');
const handleRootAutosaveLoad = (): boolean => reloadForStartupLoad('autosave');

root.render(
  <React.StrictMode>
    <ErrorBoundary
      name="Application Root"
      onError={(error, errorInfo) => markCrashDetected('Application Root', error, errorInfo.componentStack)}
      onLoadRecovery={handleRootCrashRecovery}
      onLoadAutosave={handleRootAutosaveLoad}
    >
      <LocalizationProvider>
        <SpeechProvider>
          <App />
          <NotificationHost />
        </SpeechProvider>
      </LocalizationProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
