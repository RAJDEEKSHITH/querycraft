import { useSyncExternalStore } from 'react'

// Hash-based view switch (IMPLEMENTATION.md 15): #/ (Ask), #/history, #/admin.

export type View = 'ask' | 'history' | 'admin'

export function viewFromHash(hash: string): View {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '')
  if (path === '/history') return 'history'
  if (path === '/admin') return 'admin'
  return 'ask'
}

export const VIEW_HASH: Record<View, string> = { ask: '#/', history: '#/history', admin: '#/admin' }

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
  }
}

export function useHashView(): View {
  return useSyncExternalStore(subscribe, () => viewFromHash(window.location.hash))
}
