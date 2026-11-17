import { useState, type KeyboardEvent } from 'react'
import { barOrientation, chartPoints, chartText, dimensionLabels, type ChartSpec } from '../../lib/chart'
import { formatFull } from '../../lib/units'
import { useElementWidth } from '../../lib/use-element-width'
import type { Column } from '../../types/api'
import { Button } from '../Button'
import { HorizontalPlot } from './HorizontalPlot'
import { seriesColor } from './series'
import { VerticalPlot } from './VerticalPlot'

// Hand-built SVG chart (IMPLEMENTATION.md 15): line for dates and 3+ years, bars for text
// (horizontal for many or long labels). Hover or arrow keys show one point's values; a
// live region reads them out. The result table below holds every value.

interface ChartProps {
  spec: ChartSpec
  columns: Column[]
  rows: unknown[][]
  onHide: () => void
}

export function Chart({ spec, columns, rows, onHide }: ChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640)
  const [active, setActive] = useState<number | null>(null)
  const points = chartPoints(spec, rows)
  const labels = dimensionLabels(spec, points)
  const text = chartText(spec, columns, rows)
  const horizontal = spec.kind === 'bar' && barOrientation(labels, width - 72) === 'horizontal'
  const kindName = spec.kind === 'line' ? 'Line chart' : horizontal ? 'Horizontal bar chart' : 'Bar chart'
  const summary = `${kindName}: ${text.title}. ${points.length} ${points.length === 1 ? 'point' : 'points'}. Arrow keys read each value; the table below lists them all.`

  const hovered = active === null ? undefined : points[active]
  const announcement =
    hovered === undefined
      ? ''
      : `${labels[active ?? 0] ?? hovered.label}: ${hovered.values
          .map((v, s) => `${text.series[s] ?? ''} ${v === null ? 'no value' : formatFull(v, text.formats[s] ?? text.axisFormat)}`)
          .join(', ')}`

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const last = points.length - 1
    const current = active ?? -1
    let next: number | null | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(last, current + 1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = current < 0 ? 0 : Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else if (event.key === 'Escape') next = null
    if (next === undefined) return
    event.preventDefault()
    setActive(next)
  }

  const plot = { width, kind: spec.kind, points, labels, text, active, onActive: setActive }

  return (
    <figure className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <figcaption className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" title={text.title}>
          {text.title}
        </figcaption>
        <Button variant="ghost" size="sm" onClick={onHide}>
          Hide chart
        </Button>
      </div>
      {text.series.length > 1 && (
        <ul aria-label="Series" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {text.series.map((name, s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={spec.kind === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-sm'}
                style={{ backgroundColor: seriesColor(s) }}
              />
              {name}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={summary}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="qc-focus w-full rounded-md"
      >
        {horizontal ? <HorizontalPlot {...plot} /> : <VerticalPlot {...plot} />}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </figure>
  )
}
