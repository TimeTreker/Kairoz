// Minimal hash router: #/features/ft_123 -> ['features', 'ft_123']. Works from any static host.

import { useSyncExternalStore } from 'react';

function current(): string {
  return window.location.hash.replace(/^#\/?/, '');
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, current);
  return hash.split('/').filter(Boolean).map(decodeURIComponent);
}

export function navigate(path: string): void {
  window.location.hash = `#/${path.replace(/^\//, '')}`;
}
