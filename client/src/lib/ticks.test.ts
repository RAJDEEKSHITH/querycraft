import { describe, expect, it } from 'vitest'
import { niceScale } from './ticks'

const isNiceStep = (step: number): boolean => {
  const k = 10 ** Math.floor(Math.log10(step) + 1e-9)
  return [1, 2, 5].some((m) => Math.abs(step / k - m) < 1e-9)
}

describe('niceScale', () => {
  it('bar ranges start at zero with 1-2-5 steps', () => {
    expect(niceScale(0, 2_217_564.76, true)).toEqual({ min: 0, max: 2_500_000, step: 500_000, ticks: [0, 500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000] })
    expect(niceScale(12, 95, true).ticks).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('negative values extend below zero', () => {
    expect(niceScale(-30, 70, true).ticks).toEqual([-50, 0, 50, 100])
  })

  it('line ranges need not include zero', () => {
    expect(niceScale(0.1, 0.43, false).ticks).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
  })

  it('no floating-point noise in the ticks', () => {
    for (const t of niceScale(0, 0.7, true).ticks) expect(String(t)).toMatch(/^\d+(\.\d)?$/)
  })

  it('all zeros or a single value still give a usable range', () => {
    expect(niceScale(0, 0, true).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    const single = niceScale(5, 5, false)
    expect(single.min).toBeLessThan(5)
    expect(single.max).toBeGreaterThan(5)
    expect(niceScale(5, 5, true).ticks[0]).toBe(0)
  })

  it('4–6 ticks covering the data for many ranges', () => {
    for (const [lo, hi] of [
      [0, 1],
      [0, 7],
      [0, 13],
      [0, 19_820],
      [0, 43_671_889.5037],
      [3, 3_000],
      [-1, 1],
      [0, 0.031],
    ] as const) {
      const s = niceScale(lo, hi, true)
      expect(s.ticks.length, `${lo}..${hi}`).toBeGreaterThanOrEqual(4)
      expect(s.ticks.length, `${lo}..${hi}`).toBeLessThanOrEqual(6)
      expect(s.min).toBeLessThanOrEqual(Math.min(lo, 0))
      expect(s.max).toBeGreaterThanOrEqual(hi)
      expect(isNiceStep(s.step), `${lo}..${hi} step ${s.step}`).toBe(true)
    }
  })
})
