import { describe, expect, it } from 'vitest'
import { GENERATE_SYSTEM_PROMPT } from '../../src/agent/prompts/generate.js'

// Generate prompt rules that came from real-run findings (NOTES.md D101): a home card
// option "two specific calendar years (e.g., 2023 vs 2024)" led to a second question.

describe('generate prompt', () => {
  it('asks for concrete clarify options that need no second question', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('Each clarify option is one complete interpretation the user can pick without being asked again')
    expect(GENERATE_SYSTEM_PROMPT).toContain('"2023 vs 2024", "First half vs second half of 2024"')
    expect(GENERATE_SYSTEM_PROMPT).toContain('never a placeholder such as "two years you choose"')
  })

  it('keeps the existing clarify and refusal rules', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('clarify only when reasonable interpretations would materially change the result')
    expect(GENERATE_SYSTEM_PROMPT).toContain('cannot_answer when the data in the context does not contain what is asked.')
  })
})
