import { formatFull } from '../../lib/units'
import type { ChartText } from '../../lib/chart'
import { seriesColor } from './series'

interface ChartTooltipProps {
  label: string
  values: (number | null)[]
  text: ChartText
  /** Position inside the chart container, in px. */
  left: number
  top: number
  /** 'start': left edge at `left`; 'end': right edge at `left`. */
  align: 'start' | 'end'
}

/** Category, series names and full values with units. Visual only: the chart's live
 *  region announces the same text, and the table holds every value. */
export function ChartTooltip({ label, values, text, left, top, align }: ChartTooltipProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left, top, transform: align === 'start' ? 'none' : 'translateX(-100%)' }}
    >
      <p className="font-medium break-words text-zinc-900 dark:text-zinc-100">{label}</p>
      {values.map((v, s) => (
        <p key={s} className="mt-1 flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-400">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: seriesColor(s) }} />
            <span className="truncate">{text.series[s]}</span>
          </span>
          <span className="text-zinc-900 tabular-nums dark:text-zinc-100">{v === null ? '—' : formatFull(v, text.formats[s] ?? text.axisFormat)}</span>
        </p>
      ))}
    </div>
  )
}
