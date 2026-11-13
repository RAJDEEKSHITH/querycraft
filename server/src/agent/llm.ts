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
// `chat` returns text; `structured` asks for JSON that matches a Zod schema
// (Groq strict JSON-schema mode) and validates the reply with that same schema.
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

/** A structured reply's schema. The root must be an object (Groq strict mode). */
export interface StructuredOutput<T> {
  name: string
  schema: z.ZodType<T>
}

interface Usage {
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * `ok: false` when the reply is not JSON or does not match the schema; the tokens
 * were still spent, and `issue` is a short description safe to show the model.
 */
export type StructuredResult<T> = (Usage & { ok: true; value: T }) | (Usage & { ok: false; issue: string })

export interface LlmClient {
  chat(messages: readonly ChatMessage[], options: ChatOptions): Promise<ChatResult>
  structured<T>(
    messages: readonly ChatMessage[],
    output: StructuredOutput<T>,
    options: ChatOptions,
  ): Promise<StructuredResult<T>>
}

/** JSON-schema response format sent to the provider (strict mode). */
export interface JsonResponseFormat {
  name: string
  schema: Record<string, unknown>
}

/** One provider request. Real (Groq) and mock implementations. */
export interface ChatProvider {
  complete(
    messages: readonly ChatMessage[],
    model: string,
    format?: JsonResponseFormat,
  ): Promise<{ text: unknown; inputTokens: number; outputTokens: number }>
  classifyRateLimit(err: unknown): RateLimitSignal | undefined
}

// Keywords Groq's strict mode documents: object, array, string, number, integer,
// boolean, enum, anyOf, $ref/$defs. Zod's schema is converted to that subset
// (oneOf → anyOf, const → one-value enum); length and size limits are dropped
// here and enforced by validating the reply with the same Zod schema.
const DROPPED_KEYWORDS = new Set(['$schema', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format'])

function toStrictSubset(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSubset)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  const entries: [string, unknown][] = Object.entries(node)
  for (const [key, value] of entries) {
    if (DROPPED_KEYWORDS.has(key)) continue
    if (key === 'oneOf') out['anyOf'] = toStrictSubset(value)
    else if (key === 'const') out['enum'] = [value]
    else out[key] = toStrictSubset(value)
  }
  return out
}

const rootObject = z.looseObject({ type: z.literal('object') })

/** The provider JSON schema for a Zod schema; throws unless the root is an object. */
export function providerJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = toStrictSubset(z.toJSONSchema(schema))
  const root = rootObject.safeParse(converted)
  if (!root.success) {
    throw new Error('Structured output schema must have an object root (Groq strict mode)')
  }
  return root.data
}

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  return `The reply did not match the required JSON format (${issues.join('; ')})`
}

export interface LlmClientOptions {
  logger?: Logger | undefined
  sleep?: Sleep | undefined
}

export function createLlmClient(provider: ChatProvider, options: LlmClientOptions = {}): LlmClient {
  const env = getEnv()

  async function call(
    messages: readonly ChatMessage[],
    chatOptions: ChatOptions,
    format?: JsonResponseFormat,
  ): Promise<Usage & { text: unknown }> {
    const model = chatOptions.model === 'answer' ? (env.LLM_ANSWER_MODEL ?? env.LLM_MODEL) : env.LLM_MODEL
    await assertWithinBudget(chatOptions.source)
    let response: { text: unknown; inputTokens: number; outputTokens: number }
    try {
      response = await withRateLimitRetry(() => provider.complete(messages, model, format), {
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
    // Tokens were spent even if the reply turns out unusable, so record first.
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
    return { text: response.text, model, inputTokens, outputTokens }
  }

  return {
    async chat(messages, chatOptions) {
      const { text, ...usage } = await call(messages, chatOptions)
      if (typeof text !== 'string' || text.trim() === '') {
        throw new AppError('INTERNAL_ERROR', 'Language model returned no text')
      }
      return { text, ...usage }
    },

    async structured(messages, output, chatOptions) {
      const format = { name: output.name, schema: providerJsonSchema(output.schema) }
      const { text, ...usage } = await call(messages, chatOptions, format)
      if (typeof text !== 'string' || text.trim() === '') {
        return { ...usage, ok: false, issue: 'The reply was empty' }
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        return { ...usage, ok: false, issue: 'The reply was not valid JSON' }
      }
      const parsed = output.schema.safeParse(json)
      return parsed.success
        ? { ...usage, ok: true, value: parsed.data }
        : { ...usage, ok: false, issue: describeIssues(parsed.error) }
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
    async complete(messages, modelName, format) {
      const reply = await modelFor(modelName).invoke(
        messages.map((m) => (m.role === 'system' ? new SystemMessage(m.content) : new HumanMessage(m.content))),
        format === undefined
          ? {}
          : {
              response_format: {
                type: 'json_schema',
                json_schema: { name: format.name, strict: true, schema: format.schema },
              },
            },
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
