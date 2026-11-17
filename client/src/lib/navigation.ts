import { useAskStore } from '../stores/askStore'
import { NEW_CONVERSATION_HASH, routeFromHash } from './hash-route'

/** Starts a new conversation: route to #/, or reset in place when already there. */
export function startNewConversation(): void {
  const route = routeFromHash(window.location.hash)
  if (route.view === 'chat' && route.conversationId === null) useAskStore.getState().newConversation()
  else window.location.hash = NEW_CONVERSATION_HASH
}
