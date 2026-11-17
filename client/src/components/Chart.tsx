import { useState } from 'react'
import { chartPoints, type ChartSpec } from '../lib/chart'
import { formatCompact, formatNumber } from '../lib/format'
import type { Column } from '../types/api'

// Hand-built SVG chart (IMPLEMENTATION.md 15): line for a date dimension, bars for text.
// Theme colours (accent first; never the status colours); hovering a point shows a tooltip
// with every series at that point. The result table below holds the same data for keyboards
// and screen readers.

const WIDTH = 640
const HEIGHT = 280
const M = { top: 16, right: 16, bottom: 56, left: 64 }
const SERIES = [
  { stroke: 'stroke-indigo-600 dark:stroke-indigo-400', fill: 'fill-indigo-600 dark:fill-indigo-400', swatch: 'bg-indigo-600 dark:bg-indigo-400' },
  { stroke: 'stroke-cyan-600 dark:stroke-cyan-400', fill: 'fill-cyan-600 dark:fill-cyan-400', swatch: 'bg-cyan-600 dark:bg-cyan-400' },
  { stroke: 'stroke-violet-500 dark:stroke-violet-300', fill: 'fill-violet-500 dark:fill-violet-300', swatch: 'bg-violet-500 dark:bg-violet-300' },
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
  const [hover, setHover] = useState<number | null>(null)
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
  const hovered = hover === null ? undefined : points[hover]

  return (
    <figure className="space-y-2">
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className="h-auto w-full text-zinc-500 dark:text-zinc-400">
          <title>{summary}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={WIDTH - M.right} y1={y(t)} y2={y(t)} className="stroke-zinc-200 dark:stroke-zinc-800" />
              <text x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-current font-mono text-[11px]">
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
          {hover !== null && (
            <rect x={M.left + band * hover} y={M.top} width={band} height={plotH} className="fill-zinc-100 dark:fill-zinc-800/60" />
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
                      rx={1.5}
                      className={SERIES[s]?.fill}
                    />
                  ),
                )
              })
            : spec.measures.map((_, s) => {
                const coords = points.flatMap((p, i) => {
                  const v = p.values[s]
                  return v === null || v === undefined ? [] : [{ x: xCenter(i), y: y(v), i }]
                })
                return (
                  <g key={s}>
                    <polyline points={coords.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" strokeWidth={2} className={SERIES[s]?.stroke} />
                    {coords.map((c) => (
                      <circle key={c.i} cx={c.x} cy={c.y} r={c.i === hover ? 4.5 : 3} className={SERIES[s]?.fill} />
                    ))}
                  </g>
                )
              })}
          <line x1={M.left} x2={WIDTH - M.right} y1={y(0)} y2={y(0)} className="stroke-zinc-400 dark:stroke-zinc-600" />
          {/* Invisible hover bands, one per point (mouse only; the table serves keyboards). */}
          {points.map((_, i) => (
            <rect
              key={`hit-${i}`}
              aria-hidden="true"
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        {hover !== null && hovered !== undefined && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: `${Math.min(85, Math.max(15, (xCenter(hover) / WIDTH) * 100))}%` }}
          >
            <p className="font-medium text-zinc-900 dark:text-zinc-100">{hovered.label}</p>
            {hovered.values.map((v, s) => (
              <p key={s} className="mt-0.5 flex items-center justify-between gap-3 text-zinc-600 dark:text-zinc-300">
                <span className="flex items-center gap-1.5">
                  <span className={`size-2 rounded-sm ${SERIES[s]?.swatch ?? ''}`} />
                  {names[s]}
                </span>
                <span className="font-mono tabular-nums">{v === null ? '—' : formatNumber(v)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
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
