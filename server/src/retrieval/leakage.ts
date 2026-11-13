import { and, asc, cosineDistance, eq, isNotNull, sql } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { examples } from '../db/schema.js'
import type { RequestSource } from '../services/audit.service.js'
import type { EmbeddingsClient } from './embeddings.js'

// Leakage check (IMPLEMENTATION.md 20.2): an evaluation question must not match a
// verified example by normalized text or by cosine similarity ≥ 0.95. The M4
// runner refuses to start when this returns any match.

export const LEAKAGE_SIMILARITY_THRESHOLD = 0.95

/** Lower case, punctuation removed, whitespace collapsed. */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface LeakageMatch {
  question: string
  exampleId: string
  exampleQuestion: string
  reason: 'text' | 'similarity'
  similarity: number
}

/**
 * Checks evaluation questions against verified examples. Questions that match by
 * text need no embedding; the rest are embedded in one batch, as documents like the
 * stored examples, so an identical question has similarity 1.
 */
export async function findLeakage(
  questions: readonly string[],
  embeddings: EmbeddingsClient,
  source: RequestSource,
  threshold = LEAKAGE_SIMILARITY_THRESHOLD,
): Promise<LeakageMatch[]> {
  const db = getAppDb()
  const verified = await db
    .select({ id: examples.id, question: examples.question })
    .from(examples)
    .where(eq(examples.status, 'verified'))
  const byText = new Map(verified.map((e) => [normalizeQuestion(e.question), e]))

  const matches: LeakageMatch[] = []
  const toEmbed: string[] = []
  for (const question of questions) {
    const example = byText.get(normalizeQuestion(question))
    if (example === undefined) {
      toEmbed.push(question)
    } else {
      matches.push({ question, exampleId: example.id, exampleQuestion: example.question, reason: 'text', similarity: 1 })
    }
  }
  if (toEmbed.length === 0 || verified.length === 0) {
    return matches
  }

  const vectors = await embeddings.embed(toEmbed, { task: 'document', source })
  for (const [i, question] of toEmbed.entries()) {
    const vector = vectors[i]
    if (vector === undefined) continue
    const distance = cosineDistance(examples.embedding, vector)
    const [nearest] = await db
      .select({ id: examples.id, question: examples.question, similarity: sql<number>`1 - (${distance})` })
      .from(examples)
      .where(and(eq(examples.status, 'verified'), isNotNull(examples.embedding)))
      .orderBy(asc(distance))
      .limit(1)
    if (nearest !== undefined && Number(nearest.similarity) >= threshold) {
      matches.push({
        question,
        exampleId: nearest.id,
        exampleQuestion: nearest.question,
        reason: 'similarity',
        similarity: Number(nearest.similarity),
      })
    }
  }
  return matches
}
