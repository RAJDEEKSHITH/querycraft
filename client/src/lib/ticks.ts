// "Nice" axis ticks: steps of 1, 2 or 5 × 10^k, at most 6 ticks (4–6 in practice).

export interface NiceScale {
  min: number
  max: number
  step: number
  ticks: number[]
}

const MAX_TICKS = 6

function roundTo(n: number, decimals: number): number {
  return Number(n.toFixed(decimals))
}

/** Ticks covering [lo, hi]; `includeZero` extends the range to 0 (bar charts). */
export function niceScale(lo: number, hi: number, includeZero: boolean): NiceScale {
  let a = Math.min(lo, hi)
  let b = Math.max(lo, hi)
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    a = 0
    b = 1
  }
  if (includeZero) {
    a = Math.min(a, 0)
    b = Math.max(b, 0)
  }
  // a === b only when all values are equal (and 0 is not included unless they are 0).
  if (a === b && a === 0) b = 1
  else if (a === b) {
    const pad = Math.abs(a) * 0.1
    a -= pad
    b += pad
  }
  const span = b - a
  let step = 10 ** Math.floor(Math.log10(span / 5))
  const multipliers = [1, 2, 5]
  for (let k = 0; ; k = (k + 1) % multipliers.length) {
    const candidate = step * (multipliers[k] ?? 1)
    const first = Math.floor(a / candidate + 1e-9)
    const last = Math.ceil(b / candidate - 1e-9)
    if (last - first + 1 <= MAX_TICKS) {
      const decimals = Math.max(0, -Math.floor(Math.log10(candidate) + 1e-9))
      const ticks = Array.from({ length: last - first + 1 }, (_, i) => roundTo((first + i) * candidate, decimals))
      return { min: ticks[0] ?? a, max: ticks.at(-1) ?? b, step: roundTo(candidate, decimals), ticks }
    }
    if (k === multipliers.length - 1) step *= 10
  }
}
