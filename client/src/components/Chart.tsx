import { chartPoints, type ChartSpec } from '../lib/chart'
import { formatCompact, formatNumber } from '../lib/format'
import type { Column } from '../types/api'

// Hand-built SVG chart (IMPLEMENTATION.md 15): line for a date dimension, bars for text.

const WIDTH = 640
const HEIGHT = 280
const M = { top: 16, right: 16, bottom: 56, left: 64 }
const SERIES = [
  { stroke: 'stroke-sky-600 dark:stroke-sky-400', fill: 'fill-sky-600 dark:fill-sky-400', swatch: 'bg-sky-600 dark:bg-sky-400' },
  { stroke: 'stroke-amber-500 dark:stroke-amber-400', fill: 'fill-amber-500 dark:fill-amber-400', swatch: 'bg-amber-500 dark:bg-amber-400' },
  { stroke: 'stroke-emerald-600 dark:stroke-emerald-400', fill: 'fill-emerald-600 dark:fill-emerald-400', swatch: 'bg-emerald-600 dark:bg-emerald-400' },
]

function niceMax(n: number): number {
  if (n <= 0) return 0
  const step = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / step) * step
}

function shortLabel(label: string): string {
  const date = /^(\d{4}-\d{2}-\d{2})[ T]00:00:00/.exec(label)
  const text = date?.[1] ?? label
  return text.length > 14 ? `${text.slice(0, 13)}…` : text
}

export function Chart({ spec, columns, rows }: { spec: ChartSpec; columns: Column[]; rows: unknown[][] }) {
  const points = chartPoints(spec, rows)
  const values = points.flatMap((p) => p.values.filter((v): v is number => v !== null))
  const top = niceMax(Math.max(0, ...values))
  const bottom = -niceMax(-Math.min(0, ...values))
  const span = top - bottom || 1
  const plotW = WIDTH - M.left - M.right
  const plotH = HEIGHT - M.top - M.bottom
  const y = (v: number): number => M.top + ((top - v) / span) * plotH
  const band = plotW / Math.max(1, points.length)
  const xCenter = (i: number): number => M.left + band * i + band / 2
  const ticks = [0, 1, 2, 3, 4].map((k) => bottom + (span * k) / 4)
  const labelEvery = Math.max(1, Math.ceil(points.length / 10))
  const names = spec.measures.map((m) => columns[m]?.name ?? '')
  const dimensionName = columns[spec.dimension]?.name ?? ''
  const summary = `${spec.kind === 'line' ? 'Line' : 'Bar'} chart of ${names.join(', ')} by ${dimensionName}, ${points.length} points`

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className="h-auto w-full text-zinc-500 dark:text-zinc-400">
        <title>{summary}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={WIDTH - M.right} y1={y(t)} y2={y(t)} className="stroke-zinc-200 dark:stroke-zinc-800" />
            <text x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-current text-[11px]">
              {formatCompact(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text
              key={i}
              x={xCenter(i)}
              y={HEIGHT - M.bottom + 14}
              textAnchor="end"
              transform={`rotate(-30 ${xCenter(i)} ${HEIGHT - M.bottom + 14})`}
              className="fill-current text-[11px]"
            >
              {shortLabel(p.label)}
            </text>
          ) : null,
        )}
        {spec.kind === 'bar'
          ? points.map((p, i) => {
              const inner = (band * 0.8) / spec.measures.length
              return p.values.map((v, s) =>
                v === null ? null : (
                  <rect
                    key={`${i}-${s}`}
                    x={M.left + band * i + band * 0.1 + inner * s}
                    y={Math.min(y(v), y(0))}
                    width={Math.max(1, inner - 1)}
                    height={Math.abs(y(0) - y(v))}
                    className={SERIES[s]?.fill}
                  >
                    <title>{`${p.label} · ${names[s] ?? ''}: ${formatNumber(v)}`}</title>
                  </rect>
                ),
              )
            })
          : spec.measures.map((_, s) => {
              const coords = points.flatMap((p, i) => {
                const v = p.values[s]
                return v === null || v === undefined ? [] : [{ x: xCenter(i), y: y(v), label: p.label, v }]
              })
              return (
                <g key={s}>
                  <polyline
                    points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
                    fill="none"
                    strokeWidth={2}
                    className={SERIES[s]?.stroke}
                  />
                  {coords.map((c, i) => (
                    <circle key={i} cx={c.x} cy={c.y} r={3} className={SERIES[s]?.fill}>
                      <title>{`${c.label} · ${names[s] ?? ''}: ${formatNumber(c.v)}`}</title>
                    </circle>
                  ))}
                </g>
              )
            })}
        <line x1={M.left} x2={WIDTH - M.right} y1={y(0)} y2={y(0)} className="stroke-zinc-400 dark:stroke-zinc-600" />
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        {names.map((n, s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2.5 rounded-sm ${SERIES[s]?.swatch ?? ''}`} />
            {n}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
