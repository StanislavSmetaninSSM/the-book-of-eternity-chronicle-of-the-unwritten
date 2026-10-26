
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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
        </SpeechProvider>
      </LocalizationProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
