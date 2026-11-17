import { CHAR_WIDTH, truncateLabel } from '../../lib/chart'
import { niceScale } from '../../lib/ticks'
import { formatTick } from '../../lib/units'
import { ChartTooltip } from './ChartTooltip'
import { barSlots, rowBarPath, seriesColor } from './series'
import type { PlotProps } from './plot'

// Horizontal bars for many categories or long labels: labels on the left (truncated, the
// full text in the tooltip), the value axis at the bottom, no gridlines, a zero baseline.

export function HorizontalPlot({ width, points, labels, text, active, onActive }: PlotProps) {
  const values = points.flatMap((p) => p.values.filter((v): v is number => v !== null))
  const scale = niceScale(Math.min(...values), Math.max(...values), true)
  const maxAbs = Math.max(Math.abs(scale.min), Math.abs(scale.max))
  const tickText = scale.ticks.map((t) => formatTick(t, text.axisFormat, scale.step, maxAbs))
  const series = points[0]?.values.length ?? 1

  const longest = Math.max(...labels.map((l) => l.length))
  const labelChars = Math.max(6, Math.min(longest, 28, Math.floor((width * 0.45 - 16) / CHAR_WIDTH)))
  const left = labelChars * CHAR_WIDTH + 16
  const right = Math.ceil(((tickText.at(-1)?.length ?? 1) * CHAR_WIDTH) / 2) + 4
  const top = 24
  const band = series === 1 ? 28 : series * 12 + (series - 1) * 2 + 12
  const plotW = Math.max(40, width - left - right)
  const plotH = band * points.length
  const height = top + plotH + 48
  const x = (v: number): number => left + ((v - scale.min) / (scale.max - scale.min || 1)) * plotW
  const baseline = x(Math.min(Math.max(0, scale.min), scale.max))
  const slots = barSlots(band, series, series === 1 ? 0.6 : 0.8)

  // Thin the value labels if neighbours would touch.
  const spacing = plotW / Math.max(1, scale.ticks.length - 1)
  const tickEvery = Math.max(...tickText.map((t) => t.length)) * CHAR_WIDTH + 8 > spacing ? 2 : 1

  const hovered = active === null ? undefined : points[active]

  return (
    <div className="relative">
      <svg width={width} height={height} aria-hidden="true" className="block overflow-visible text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        <text x={0} y={12} className="fill-current">
          {text.dimensionTitle}
        </text>

        {active !== null && <rect x={0} y={top + band * active} width={width} height={band} rx={4} className="fill-zinc-100 dark:fill-zinc-800/50" />}

        {points.map((p, i) => (
          <g key={i}>
            <text x={left - 10} y={top + band * i + band / 2} textAnchor="end" dominantBaseline="middle" className="fill-zinc-700 dark:fill-zinc-300">
              {truncateLabel(labels[i] ?? p.label, labelChars)}
            </text>
            {p.values.map((v, s) =>
              v === null || v === 0 ? null : (
                <path
                  key={s}
                  d={rowBarPath(top + band * i + (slots.offsets[s] ?? 0), slots.thickness, baseline, x(v))}
                  style={{ fill: seriesColor(s) }}
                />
              ),
            )}
          </g>
        ))}
        <line x1={baseline} x2={baseline} y1={top} y2={top + plotH} className="stroke-zinc-300 dark:stroke-zinc-700" />

        {scale.ticks.map((t, i) =>
          i % tickEvery === 0 ? (
            <text key={t} x={x(t)} y={top + plotH + 18} textAnchor="middle" className="fill-current">
              {tickText[i]}
            </text>
          ) : null,
        )}
        {text.valueTitle !== null && (
          <text x={left + plotW / 2} y={height - 6} textAnchor="middle" className="fill-current">
            {text.valueTitle}
          </text>
        )}

        {points.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={0}
            y={top + band * i}
            width={width}
            height={band}
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
          left={width}
          top={top + band * (active + 1) + 2}
          align="end"
        />
      )}
    </div>
  )
}
