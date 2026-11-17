import { describe, expect, it } from 'vitest'
import { barSlots, columnPath } from './series'

// Slim bars (user preference, 2026-11-17): at most 24 px each, centred in the band.

describe('barSlots', () => {
  it('a bar takes up to 72% of a narrow band', () => {
    const { thickness, offsets } = barSlots(30, 1)
    expect(thickness).toBeCloseTo(21.6)
    expect(offsets[0]).toBeCloseTo(4.2)
  })

  it('each bar is at most 24 px wide, centred in a wide band', () => {
    const { thickness, offsets } = barSlots(300, 1)
    expect(thickness).toBe(24)
    expect(offsets).toEqual([138])
  })

  it('a group of two keeps a 2 px gap between its bars', () => {
    const { thickness, offsets } = barSlots(100, 2)
    expect(thickness).toBe(24)
    expect(offsets).toEqual([25, 51])
  })
})

describe('columnPath', () => {
  it('rounds the data end by 4 px and keeps the baseline square', () => {
    expect(columnPath(0, 20, 100, 40)).toBe('M0,100V44Q0,40 4,40H16Q20,40 20,44V100Z')
  })
})
