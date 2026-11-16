import { describe, expect, it } from 'vitest'
import { ANSWER_MAX_ROWS, ANSWER_SYSTEM_PROMPT, buildAnswerMessages } from '../../src/agent/prompts/answer.js'

// Answer step prompt (NOTES.md D83): only facts present in the rows, no cross-row
// calculations or superlatives (the moment 3 answer claimed a wrong "only decline").

describe('answer prompt', () => {
  it('states the facts-only rule', () => {
    expect(ANSWER_SYSTEM_PROMPT).toContain('State only facts present in the rows')
    expect(ANSWER_SYSTEM_PROMPT).toContain('Do not compute totals, averages, differences or rankings across rows')
    expect(ANSWER_SYSTEM_PROMPT).toContain('largest, only, all, most or none')
    expect(ANSWER_SYSTEM_PROMPT).toContain('If there are no rows, say that nothing matched.')
  })

  // Re-check flaws (D88): all 10 rows listed; "covers only the rows shown" with nothing cut off.
  it('limits long results to a few rows, rounds decimals and ties truncation to the flag', () => {
    expect(ANSWER_SYSTEM_PROMPT).toContain('If there are more than 5 rows, describe at most three notable rows')
    expect(ANSWER_SYSTEM_PROMPT).toContain('do not list every row')
    expect(ANSWER_SYSTEM_PROMPT).toContain('Round decimal numbers to 2 decimals')
    expect(ANSWER_SYSTEM_PROMPT).toContain('only when the message says "truncated: yes"')
    expect(ANSWER_SYSTEM_PROMPT).not.toContain('more rows exist than shown')
  })

  it('marks the truncated flag as yes or no', () => {
    const base = { question: 'q', sql: 'SELECT 1', columns: ['a'], rows: [[1]], rowCount: 1 }
    expect(buildAnswerMessages({ ...base, truncated: true })[1]?.content).toContain('Rows returned: 1; shown: 1; truncated: yes')
    expect(buildAnswerMessages({ ...base, truncated: false })[1]?.content).toContain('Rows returned: 1; shown: 1; truncated: no')
  })

  it('sends the question, SQL, columns, counts and at most 20 rows', () => {
    const rows = Array.from({ length: 25 }, (_, i) => [`t${i}`, i])
    const [system, user] = buildAnswerMessages({
      question: 'Compare sales by territory, 2023 vs 2024.',
      sql: 'SELECT 1',
      columns: ['territory', 'revenue'],
      rows,
      rowCount: 25,
      truncated: false,
    })
    expect(system).toEqual({ role: 'system', content: ANSWER_SYSTEM_PROMPT })
    expect(user?.content).toContain('Rows returned: 25; shown: 20; truncated: no')
    expect(user?.content).toContain(JSON.stringify(rows.slice(0, ANSWER_MAX_ROWS)))
    expect(user?.content).not.toContain('"t20"')
  })
})
