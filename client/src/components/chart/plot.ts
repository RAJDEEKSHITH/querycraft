import type { ChartPoint, ChartText } from '../../lib/chart'

export interface PlotProps {
  /** Container width in px. */
  width: number
  kind: 'line' | 'bar'
  points: ChartPoint[]
  /** Display labels of the dimension values (dates already readable). */
  labels: string[]
  text: ChartText
  active: number | null
  onActive: (index: number | null) => void
}
