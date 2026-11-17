import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
  }
}

// Chat-style routes (IMPLEMENTATION.md 15, approved 2026-11-17): #/ (new conversation),
// #/c/<conversationId>, #/admin; #/history (the old History view) redirects to #/.

export type Route = { view: 'chat'; conversationId: string | null } | { view: 'admin' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const NEW_CONVERSATION_HASH = '#/'
export const ADMIN_HASH = '#/admin'

export function conversationHash(conversationId: string): string {
  return `#/c/${conversationId}`
}

function pathOf(hash: string): string {
  return hash.replace(/^#/, '').replace(/\/+$/, '')
}

/** Parses a hash; anything unknown (or a malformed id) is a new conversation. */
export function routeFromHash(hash: string): Route {
  const path = pathOf(hash)
  if (path === '/admin') return { view: 'admin' }
  const match = /^\/c\/([^/]+)$/.exec(path)
  const id = match?.[1]
  if (id !== undefined && UUID.test(id)) return { view: 'chat', conversationId: id.toLowerCase() }
  return { view: 'chat', conversationId: null }
}

/** True for the old History view's hash, which the app replaces with #/. */
export function isLegacyHistoryHash(hash: string): boolean {
  return pathOf(hash) === '/history'
}

/** The current hash (a string, so the snapshot is stable); parse it with routeFromHash. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => '')
}
