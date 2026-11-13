import { ChatGroq } from '@langchain/groq'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { getEnv } from '../config/env.js'
import { llmCostMicroUsd } from '../lib/cost.js'
import { AppError } from '../lib/errors.js'
import type { Logger } from '../lib/logger.js'
import { withRateLimitRetry, type RateLimitSignal, type Sleep } from '../lib/provider-retry.js'
import type { RequestSource } from '../services/audit.service.js'
import { assertWithinBudget, recordUsage } from '../services/usage.service.js'

// The only module that calls a chat model (IMPLEMENTATION.md 9.3 rule 3).
// Every call: budget check → provider call (429 handling) → usage recorded.
// M2 builds plain chat for kb:describe; M3 adds structured output for the agent.
// Provider SDK types never leave this file.

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/** `main` = LLM_MODEL; `answer` = LLM_ANSWER_MODEL when set, else LLM_MODEL (IMPLEMENTATION.md 17). */
export type ModelRole = 'main' | 'answer'

export interface ChatOptions {
  source: RequestSource
  model: ModelRole
}

export interface ChatResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
}

export interface LlmClient {
  chat(messages: readonly ChatMessage[], options: ChatOptions): Promise<ChatResult>
}

/** One provider request. Real (Groq) and mock implementations. */
export interface ChatProvider {
  complete(
    messages: readonly ChatMessage[],
    model: string,
  ): Promise<{ text: unknown; inputTokens: number; outputTokens: number }>
  classifyRateLimit(err: unknown): RateLimitSignal | undefined
}

export interface LlmClientOptions {
  logger?: Logger | undefined
  sleep?: Sleep | undefined
}

export function createLlmClient(provider: ChatProvider, options: LlmClientOptions = {}): LlmClient {
  const env = getEnv()
  return {
    async chat(messages, chatOptions) {
      const model = chatOptions.model === 'answer' ? (env.LLM_ANSWER_MODEL ?? env.LLM_MODEL) : env.LLM_MODEL
      await assertWithinBudget(chatOptions.source)
      let response: { text: unknown; inputTokens: number; outputTokens: number }
      try {
        response = await withRateLimitRetry(() => provider.complete(messages, model), {
          provider: 'groq',
          classify: (err) => provider.classifyRateLimit(err),
          settings: { maxRetries: env.PROVIDER_MAX_RETRIES, maxWaitMs: env.PROVIDER_MAX_WAIT_MS },
          sleep: options.sleep,
          logger: options.logger,
        })
      } catch (err) {
        if (err instanceof AppError) throw err
        throw new AppError('INTERNAL_ERROR', 'Language model request failed', { cause: err })
      }
      // Tokens were spent even if the text turns out unusable, so record first.
      const { inputTokens, outputTokens } = response
      await recordUsage({
        source: chatOptions.source,
        llmTokens: inputTokens + outputTokens,
        llmRequests: 1,
        costMicroUsd: llmCostMicroUsd(inputTokens, outputTokens, {
          inputPer1MUsd: env.LLM_INPUT_PRICE_PER_1M_USD,
          outputPer1MUsd: env.LLM_OUTPUT_PRICE_PER_1M_USD,
        }),
      })
      if (typeof response.text !== 'string' || response.text.trim() === '') {
        throw new AppError('INTERNAL_ERROR', 'Language model returned no text')
      }
      return { text: response.text, model, inputTokens, outputTokens }
    },
  }
}

// --- Groq -------------------------------------------------------------------

// groq-sdk errors reach us unwrapped (LangChain's caller only marks them), with
// `status` and the response `headers`. Groq sends `retry-after` in seconds.
const groqRateLimitError = z.object({
  status: z.literal(429),
  headers: z.custom<Headers>((h) => h instanceof Headers).optional(),
})

export function classifyGroqRateLimit(err: unknown): RateLimitSignal | undefined {
  const parsed = groqRateLimitError.safeParse(err)
  if (!parsed.success) return undefined
  const header = parsed.data.headers?.get('retry-after') ?? ''
  const seconds = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : undefined
  return { retryAfterMs: seconds === undefined ? undefined : Math.ceil(seconds * 1000) }
}

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
})

export function groqChatProvider(apiKey: string): ChatProvider {
  const models = new Map<string, ChatGroq>()
  function modelFor(name: string): ChatGroq {
    let model = models.get(name)
    if (model === undefined) {
      // maxRetries 0: LangChain's own retries off; withRateLimitRetry handles 429s.
      model = new ChatGroq({ apiKey, model: name, temperature: 0, maxRetries: 0 })
      models.set(name, model)
    }
    return model
  }
  return {
    classifyRateLimit: classifyGroqRateLimit,
    async complete(messages, modelName) {
      const reply = await modelFor(modelName).invoke(
        messages.map((m) => (m.role === 'system' ? new SystemMessage(m.content) : new HumanMessage(m.content))),
      )
      const usage = usageSchema.safeParse(reply instanceof AIMessage ? reply.usage_metadata : undefined)
      return {
        text: reply.content,
        inputTokens: usage.success ? usage.data.input_tokens : 0,
        outputTokens: usage.success ? usage.data.output_tokens : 0,
      }
    },
  }
}

/** The real chat client, configured from the environment. */
export function createGroqLlmClient(options: LlmClientOptions = {}): LlmClient {
  return createLlmClient(groqChatProvider(getEnv().GROQ_API_KEY), options)
}
