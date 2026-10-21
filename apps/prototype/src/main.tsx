import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/Root.tsx';
import './styles.css';

// Ant Design forms reject `validateFields()` when a field is invalid and already show the error
// inline; that rejection is expected, so keep it out of the console. Anything else still surfaces.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && typeof e.reason === 'object' && 'errorFields' in e.reason) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
