import { getCheckpointer } from '../src/agent/checkpointer.js'
import { createLlmClient, type ChatMessage, type JsonResponseFormat } from '../src/agent/llm.js'
import { createMockChatProvider, type MockChatProvider, type MockReply } from '../src/agent/mock-llm.js'
import { getEnv } from '../src/config/env.js'
import {
  examplesFileSchema,
  glossaryFileSchema,
  readSeedFile,
  schemaFileSchema,
  seedPath,
  tableDescriptionsFileSchema,
} from '../src/kb/seed-files.js'
import { createEmbeddingsClient, type EmbeddingsClient } from '../src/retrieval/embeddings.js'
import { indexKnowledge } from '../src/retrieval/indexer.js'
import { createMockEmbeddingProvider, type MockEmbeddingProvider } from '../src/retrieval/mock-embeddings.js'
import type { QuestionDeps } from '../src/services/question.service.js'
import { isAnswerable, type EvalItem } from './dataset.js'

// `eval:run --dry-run` (IMPLEMENTATION.md 20.5): the whole runner with the mock LLM
// and mock embeddings, free and part of the test suite. Only on querycraft_test.
// The mock model answers each item from the dataset itself: gold SQL for answerable
// items, a clarification for ambiguous ones, a refusal for unanswerable ones and a
// write statement for attacks (which the safety policy must block). So a dry run
// exercises retrieval, the safety pipeline, scoring and the report end to end.

export const DRY_RUN_ANSWER = 'Dry run: answer written by the mock model.'
export const DRY_RUN_ATTACK_SQL = 'DELETE FROM sales.salesorderheader'

/** Refuses unless the process uses the test database (NODE_ENV=test → querycraft_test). */
export function assertDryRunDatabase(): void {
  if (getEnv().NODE_ENV !== 'test') {
    throw new Error('--dry-run runs only against querycraft_test (NODE_ENV=test)')
  }
}

function questionOf(messages: readonly ChatMessage[]): string | undefined {
  const user = messages.filter((m) => m.role === 'user').at(-1)
  const line = user?.content.split('\n').findLast((l) => l.startsWith('Question: '))
  return line?.slice('Question: '.length)
}

function generateReply(item: EvalItem): string {
  if (isAnswerable(item)) {
    return JSON.stringify({
      result: { action: 'sql', sql: item.goldSql, tablesUsed: [], assumptions: [], explanation: 'Dry run: the gold SQL.' },
    })
  }
  switch (item.expected) {
    case 'clarify':
      return JSON.stringify({ result: { action: 'clarify', question: 'Which one do you mean?', options: ['The first', 'The second'] } })
    case 'cannot_answer':
      return JSON.stringify({ result: { action: 'cannot_answer', reason: 'Dry run: not in the data.' } })
    default:
      return JSON.stringify({
        result: { action: 'sql', sql: DRY_RUN_ATTACK_SQL, tablesUsed: [], assumptions: [], explanation: 'Dry run: an attack.' },
      })
  }
}

export function dryRunResponder(
  items: readonly EvalItem[],
): (messages: readonly ChatMessage[], model: string, format: JsonResponseFormat | undefined) => MockReply {
  const byQuestion = new Map(items.map((i) => [i.question.trim(), i]))
  return (messages, _model, format) => {
    if (format === undefined) return DRY_RUN_ANSWER
    const question = questionOf(messages)
    const item = question === undefined ? undefined : byQuestion.get(question)
    return item === undefined ? new Error('dry run: question not in the dataset') : generateReply(item)
  }
}

export interface DryRunDeps {
  question: QuestionDeps
  chat: MockChatProvider
  embedding: MockEmbeddingProvider
}

export async function createDryRunDeps(items: readonly EvalItem[]): Promise<DryRunDeps> {
  assertDryRunDatabase()
  const chat = createMockChatProvider(dryRunResponder(items))
  const embedding = createMockEmbeddingProvider()
  return {
    question: {
      llm: createLlmClient(chat, { sleep: () => Promise.resolve() }),
      embeddings: createEmbeddingsClient(embedding),
      checkpointer: await getCheckpointer(),
    },
    chat,
    embedding,
  }
}

/** Indexes the seed knowledge base into querycraft_test with the mock embeddings. */
export async function indexDryRunKnowledge(embeddings: EmbeddingsClient): Promise<void> {
  assertDryRunDatabase()
  await indexKnowledge(
    {
      schema: await readSeedFile(seedPath.schema, schemaFileSchema),
      descriptions: await readSeedFile(seedPath.tableDescriptions, tableDescriptionsFileSchema),
      examples: await readSeedFile(seedPath.examples, examplesFileSchema),
      glossary: await readSeedFile(seedPath.glossary, glossaryFileSchema),
    },
    embeddings,
  )
}
