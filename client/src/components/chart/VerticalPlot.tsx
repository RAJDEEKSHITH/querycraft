import { CHAR_WIDTH, truncateLabel } from '../../lib/chart'
import { niceScale } from '../../lib/ticks'
import { formatTick } from '../../lib/units'
import { ChartTooltip } from './ChartTooltip'
import { barSlots, columnPath, seriesColor } from './series'
import type { PlotProps } from './plot'

// Columns or lines over a category / time axis: horizontal gridlines only, the value axis
// title above the tick labels, the dimension title under the category labels.

export function VerticalPlot({ width, kind, points, labels, text, active, onActive }: PlotProps) {
  const values = points.flatMap((p) => p.values.filter((v): v is number => v !== null))
  const scale = niceScale(Math.min(...values), Math.max(...values), kind === 'bar')
  const maxAbs = Math.max(Math.abs(scale.min), Math.abs(scale.max))
  const tickText = scale.ticks.map((t) => formatTick(t, text.axisFormat, scale.step, maxAbs))
  const left = Math.max(...tickText.map((t) => t.length)) * CHAR_WIDTH + 12
  const top = text.valueTitle === null ? 12 : 32
  const bottom = 48
  const right = 12
  const plotW = Math.max(40, width - left - right)
  const plotH = width < 480 ? 180 : 220
  const height = top + plotH + bottom
  const band = plotW / Math.max(1, points.length)
  const x = (i: number): number => left + band * i + band / 2
  const y = (v: number): number => top + ((scale.max - v) / (scale.max - scale.min || 1)) * plotH
  const baseline = y(Math.min(Math.max(0, scale.min), scale.max))

  // Category labels: every bar keeps its label (truncated to its band); a time axis
  // thins its labels so they never overlap, always keeping the latest one.
  const longest = Math.max(...labels.map((l) => l.length))
  const every = kind === 'bar' ? 1 : Math.max(1, Math.ceil((longest * CHAR_WIDTH + 12) / band))
  const maxChars = kind === 'bar' ? Math.max(3, Math.floor((band - 6) / CHAR_WIDTH)) : longest
  const slots = barSlots(band, points[0]?.values.length ?? 1)
  const series = points[0]?.values.length ?? 0
  const markers = points.length <= 16

  const hovered = active === null ? undefined : points[active]
  // The tooltip sits beside the hovered point or bar group (towards the wider side), never on it.
  const reach = kind === 'line' ? 12 : (slots.thickness * series + 2 * (series - 1)) / 2 + 8
  const tipRight = active !== null && x(active) < width / 2

  return (
    <div className="relative">
      <svg width={width} height={height} aria-hidden="true" className="block overflow-visible text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        {text.valueTitle !== null && (
          <text x={0} y={12} className="fill-current">
            {text.valueTitle}
          </text>
        )}
        {scale.ticks.map((t, i) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? 'stroke-zinc-300 dark:stroke-zinc-700' : 'stroke-zinc-100 dark:stroke-zinc-800/80'}
            />
            <text x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-current">
              {tickText[i]}
            </text>
          </g>
        ))}

        {active !== null && kind === 'bar' && (
          <rect x={left + band * active} y={top} width={band} height={plotH} className="fill-zinc-100 dark:fill-zinc-800/50" />
        )}
        {active !== null && kind === 'line' && (
          <line x1={x(active)} x2={x(active)} y1={top} y2={top + plotH} className="stroke-zinc-300 dark:stroke-zinc-600" />
        )}

        {kind === 'bar'
          ? points.map((p, i) =>
              p.values.map((v, s) =>
                v === null || v === 0 ? null : (
                  <path
                    key={`${i}-${s}`}
                    d={columnPath(left + band * i + (slots.offsets[s] ?? 0), slots.thickness, baseline, y(v))}
                    style={{ fill: seriesColor(s) }}
                  />
                ),
              ),
            )
          : Array.from({ length: series }, (_, s) => {
              // A NULL value breaks the line; each run of values is its own segment.
              const d = points
                .map((p, i) => {
                  const v = p.values[s]
                  if (v === null || v === undefined) return ''
                  const prev = points[i - 1]?.values[s]
                  return `${i === 0 || prev === null || prev === undefined ? 'M' : 'L'}${x(i)},${y(v)}`
                })
                .join('')
              return (
                <g key={s} style={{ stroke: seriesColor(s), fill: seriesColor(s) }}>
                  <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {points.map((p, i) => {
                    const v = p.values[s]
                    if (v === null || v === undefined || (!markers && i !== active)) return null
                    return <circle key={i} cx={x(i)} cy={y(v)} r={i === active ? 5 : 4} strokeWidth={2} style={{ stroke: 'var(--chart-surface)' }} />
                  })}
                </g>
              )
            })}

        {labels.map((l, i) =>
          (points.length - 1 - i) % every === 0 ? (
            <text key={i} x={x(i)} y={top + plotH + 18} textAnchor="middle" className="fill-current">
              {truncateLabel(l, maxChars)}
            </text>
          ) : null,
        )}
        <text x={left + plotW / 2} y={height - 6} textAnchor="middle" className="fill-current">
          {text.dimensionTitle}
        </text>

        {points.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={left + band * i}
            y={top}
            width={band}
            height={plotH + 24}
            fill="transparent"
            onMouseEnter={() => onActive(i)}
            onClick={() => onActive(i)}
          />
        ))}
      </svg>
      {active !== null && hovered !== undefined && (
        <ChartTooltip
          label={labels[active] ?? hovered.label}
          values={hovered.values}
          text={text}
          left={tipRight ? x(active) + reach : x(active) - reach}
          top={top}
          align={tipRight ? 'start' : 'end'}
        />
      )}
    </div>
  )
}
