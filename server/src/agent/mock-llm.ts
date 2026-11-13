import type { RateLimitSignal } from '../lib/provider-retry.js'
import type { ChatMessage, ChatProvider, JsonResponseFormat } from './llm.js'

// Mock chat provider for tests and `eval:run --dry-run` (no provider calls).
// Replies come from a responder function; an Error reply is thrown instead.
// Structured calls receive the response format, so a responder can reply JSON.

export type MockReply = string | Error

export interface MockRequest {
  model: string
  messages: readonly ChatMessage[]
  format: JsonResponseFormat | undefined
}

export interface MockChatProvider extends ChatProvider {
  /** Every request made: the model name, the messages and the response format, if any. */
  readonly requests: readonly MockRequest[]
}

/** Rough token count for mock usage: words and punctuation runs. */
function mockTokens(text: string): number {
  return text.match(/\w+|[^\s\w]+/g)?.length ?? 0
}

export function createMockChatProvider(
  responder: (messages: readonly ChatMessage[], model: string, format: JsonResponseFormat | undefined) => MockReply,
  classify?: (err: unknown) => RateLimitSignal | undefined,
): MockChatProvider {
  const requests: MockRequest[] = []
  return {
    requests,
    classifyRateLimit: (err) => classify?.(err),
    complete(messages, model, format) {
      requests.push({ model, messages, format })
      const reply = responder(messages, model, format)
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
