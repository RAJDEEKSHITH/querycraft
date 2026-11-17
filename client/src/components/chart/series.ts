// Series colours (CSS variables in index.css, validated for both themes with the dataviz
// palette validator) and the bar shape: 4 px rounded data end, square at the baseline.

export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']

export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? 'var(--chart-1)'
}

/** Vertical bar from the baseline y0 to the value's y. */
export function columnPath(x: number, width: number, y0: number, y: number): string {
  const h = Math.abs(y0 - y)
  const r = Math.min(4, width / 2, h)
  const s = y < y0 ? 1 : -1
  return `M${x},${y0}V${y + s * r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + s * r}V${y0}Z`
}

/** Horizontal bar from the baseline x0 to the value's x. */
export function rowBarPath(y: number, height: number, x0: number, x: number): string {
  const w = Math.abs(x - x0)
  const r = Math.min(4, height / 2, w)
  const s = x > x0 ? -1 : 1
  return `M${x0},${y}H${x + s * r}Q${x},${y} ${x},${y + r}V${y + height - r}Q${x},${y + height} ${x + s * r},${y + height}H${x0}Z`
}

/** Bar thickness and offsets inside one band: at most 24 px, 2 px gap between series. */
export function barSlots(band: number, series: number, fill = 0.72): { thickness: number; offsets: number[] } {
  const gap = 2
  const thickness = Math.max(2, Math.min(24, (band * fill - gap * (series - 1)) / series))
  const group = thickness * series + gap * (series - 1)
  const offsets = Array.from({ length: series }, (_, s) => (band - group) / 2 + s * (thickness + gap))
  return { thickness, offsets }
}
