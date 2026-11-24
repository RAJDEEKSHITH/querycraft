import { describe, expect, it } from 'vitest'
import samples from '../../../../server/test/fixtures/sample-questions.json'
import { SALES_DATA_HINT, STARTER_CARDS } from './suggestions'

// The home page cards and the composer hint must match the server fixture whose
// database test checks that each card still shows what its label promises
// (server/test/agent/sample-questions.test.ts).

describe('home page sample questions', () => {
  it('the cards match the server fixture (question and label, same order)', () => {
    expect(STARTER_CARDS.map((c) => ({ question: c.question, shows: c.shows }))).toEqual(
      samples.cards.map((c) => ({ question: c.question, shows: c.shows })),
    )
  })

  it('the hint matches the date range the server test checks against the database', () => {
    expect(SALES_DATA_HINT).toBe(samples.dataRange.hint)
  })
})
