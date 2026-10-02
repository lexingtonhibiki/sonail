import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Workbench } from './components/Workbench';
import './index.css';
const App = lazy(() => import('./App').then(module => ({ default: module.App })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<p style={{ padding: 32 }}>正在打开…</p>}>
        {window.location.pathname === '/' || window.location.pathname.startsWith('/workbench') ? <Workbench /> : <App />}
      </Suspense>
    </ErrorBoundary>
  </StrictMode>
);
