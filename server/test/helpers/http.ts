import { MemorySaver } from '@langchain/langgraph'
import { createLlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider } from '../../src/agent/mock-llm.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import type { QuestionDeps } from '../../src/services/question.service.js'

/** Question deps that never reach a provider or the database (for tests without question runs). */
export function offlineQuestionDeps(): QuestionDeps {
  return {
    llm: createLlmClient(createMockChatProvider(() => new Error('no LLM in this test'))),
    embeddings: createEmbeddingsClient(createMockEmbeddingProvider()),
    checkpointer: new MemorySaver(),
  }
}


export interface SseEvent {
  event: string
  data: unknown
}

/** Parses an SSE body into events (comment lines such as heartbeats are skipped). */
export function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame !== '' && !frame.startsWith(':'))
    .map((frame) => {
      const lines = frame.split('\n')
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? 'message'
      const data = lines.find((l) => l.startsWith('data: '))?.slice(6) ?? 'null'
      return { event, data: JSON.parse(data) as unknown }
    })
}

/** The contract error body of a response (IMPLEMENTATION.md 14). */
export function errorOf(res: { body: unknown }): { code: string; message: string; details: Record<string, unknown> } {
  return (res.body as { error: { code: string; message: string; details: Record<string, unknown> } }).error
}
