import type { RateLimitSignal } from '../lib/provider-retry.js'
import type { ChatMessage, ChatProvider } from './llm.js'

// Mock chat provider for tests and `eval:run --dry-run` (no provider calls).
// Replies come from a responder function; an Error reply is thrown instead.

export type MockReply = string | Error

export interface MockChatProvider extends ChatProvider {
  /** Every request made: the model name and the messages sent. */
  readonly requests: readonly { model: string; messages: readonly ChatMessage[] }[]
}

/** Rough token count for mock usage: words and punctuation runs. */
function mockTokens(text: string): number {
  return text.match(/\w+|[^\s\w]+/g)?.length ?? 0
}

export function createMockChatProvider(
  responder: (messages: readonly ChatMessage[], model: string) => MockReply,
  classify?: (err: unknown) => RateLimitSignal | undefined,
): MockChatProvider {
  const requests: { model: string; messages: readonly ChatMessage[] }[] = []
  return {
    requests,
    classifyRateLimit: (err) => classify?.(err),
    complete(messages, model) {
      requests.push({ model, messages })
      const reply = responder(messages, model)
      if (reply instanceof Error) {
        return Promise.reject(reply)
      }
      return Promise.resolve({
        text: reply,
        inputTokens: messages.reduce((sum, m) => sum + mockTokens(m.content), 0),
        outputTokens: mockTokens(reply),
      })
    },
  }
}
