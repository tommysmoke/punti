import { useMemo, useState } from 'react'
import type { Movement } from '../hooks/useAppState'

type Props = {
  movements: Movement[]
  currentPoints: number
  embedded?: boolean
}

type VisualBounds = {
  min: number
  max: number
}

type ChartGeometry = {
  width: number
  height: number
  padding: number
}

type GraphPoint = {
  timestamp: number
  value: number
}

function getMovementDelta(movement: Movement): number {
  if (movement.kind === 'redeem') {
    return -movement.points
  }

  return movement.points
}

function sortMovements(movements: Movement[]): Movement[] {
  return [...movements].sort((a, b) => {
    const dateA = new Date(a.created_at)
    const dateB = new Date(b.created_at)
    const stampA = new Date(
      dateA.getFullYear(),
      dateA.getMonth(),
      dateA.getDate(),
      dateA.getHours(),
      dateA.getMinutes(),
    ).getTime()
    const stampB = new Date(
      dateB.getFullYear(),
      dateB.getMonth(),
      dateB.getDate(),
      dateB.getHours(),
      dateB.getMinutes(),
    ).getTime()

    if (stampA !== stampB) return stampA - stampB

    const kindOrder: Record<string, number> = { earn: 0, redeem: 1, adjust: 2 }
    const kindA = kindOrder[a.kind] ?? 9
    const kindB = kindOrder[b.kind] ?? 9

    if (kindA !== kindB) return kindA - kindB
    return a.id - b.id
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function computeHybridXPositions(
  points: GraphPoint[],
  geometry: ChartGeometry,
): number[] {
  if (points.length === 0) return []
  if (points.length === 1) return [geometry.padding]

  const availableWidth = geometry.width - geometry.padding * 2
  const gapCount = points.length - 1
  const idealStep = availableWidth / gapCount
  const minStep = Math.min(Math.max(6, idealStep * 0.5), idealStep)
  const maxStep = Math.max(idealStep, idealStep * 1.6)

  const timestamps = points.map((point) => point.timestamp)
  const rawGaps = timestamps.slice(1).map((timestamp, index) => Math.max(0, timestamp - timestamps[index]))
  const rawTotal = rawGaps.reduce((sum, gap) => sum + gap, 0)

  const gaps = rawTotal > 0
    ? rawGaps.map((gap) => (gap / rawTotal) * availableWidth)
    : Array.from({ length: gapCount }, () => idealStep)

  for (let index = 0; index < gaps.length; index++) {
    gaps[index] = clamp(gaps[index], minStep, maxStep)
  }

  const epsilon = 0.0001
  let remaining = availableWidth - gaps.reduce((sum, gap) => sum + gap, 0)

  for (let pass = 0; pass < gapCount * 8 && Math.abs(remaining) > epsilon; pass++) {
    const candidates = gaps
      .map((gap, index) => ({
        index,
        room: remaining > 0 ? maxStep - gap : gap - minStep,
      }))
      .filter((candidate) => candidate.room > epsilon)

    if (candidates.length === 0) break

    const share = remaining / candidates.length
    let applied = 0

    for (const candidate of candidates) {
      const delta = remaining > 0
        ? Math.min(share, candidate.room)
        : -Math.min(-share, candidate.room)

      gaps[candidate.index] += delta
      applied += delta
    }

    if (Math.abs(applied) < epsilon) break
    remaining -= applied
  }

  if (Math.abs(remaining) > epsilon) {
    const fallbackIndex = remaining > 0 ? gaps.findIndex((gap) => gap < maxStep - epsilon) : gaps.findIndex((gap) => gap > minStep + epsilon)

    if (fallbackIndex >= 0) {
      gaps[fallbackIndex] += remaining
    }
  }

  const positions: number[] = [geometry.padding]
  let x = geometry.padding

  for (const gap of gaps) {
    x += gap
    positions.push(x)
  }

  positions[0] = geometry.padding
  positions[positions.length - 1] = geometry.width - geometry.padding

  return positions
}

export function computeGraphSeries(
  movements: Movement[],
  currentPoints: number,
  limitDays: number | null,
): GraphPoint[] {
  const now = Date.now()
  const cutoff = limitDays ? now - limitDays * 24 * 60 * 60 * 1000 : 0

  const filtered = sortMovements(
    movements.filter((movement) => {
      if (!limitDays) return true
      return new Date(movement.created_at).getTime() >= cutoff
    }),
  )

  if (filtered.length === 0) {
    return []
  }

  const totalDelta = filtered.reduce((sum, movement) => sum + getMovementDelta(movement), 0)
  const initialBalance = currentPoints - totalDelta
  const firstMovementTime = new Date(filtered[0].created_at).getTime()

  const points: GraphPoint[] = [
    {
      timestamp: firstMovementTime - 60 * 60 * 1000,
      value: initialBalance,
    },
  ]

  let cumulative = initialBalance
  for (const movement of filtered) {
    cumulative += getMovementDelta(movement)
    points.push({
      timestamp: new Date(movement.created_at).getTime(),
      value: cumulative,
    })
  }

  return points
}

export function computeCumulative(
  movements: Movement[],
  currentPoints: number,
  limitDays: number | null,
): number[] {
  return computeGraphSeries(movements, currentPoints, limitDays)
    .slice(1)
    .map((point) => point.value)
}

export function computeVisualBounds(data: number[]): VisualBounds {
  const rawMin = Math.min(...data)
  const rawMax = Math.max(...data)
  const rawRange = rawMax - rawMin
  const margin = rawRange > 0
    ? Math.max(rawRange * 0.06, 0.2)
    : Math.max(Math.abs(rawMax) * 0.06, 0.2)
  const min = Math.max(0, rawMin - margin)

  return {
    min,
    max: rawMax + margin,
  }
}

export function mapValueToY(
  value: number,
  bounds: VisualBounds,
  geometry: ChartGeometry,
): number {
  const range = bounds.max - bounds.min || 1
  const drawableHeight = geometry.height - geometry.padding * 2

  return geometry.height - geometry.padding - ((value - bounds.min) / range) * drawableHeight
}

export function formatYAxisLabel(value: number, bounds: VisualBounds): string {
  const canUseDecimals = bounds.max - bounds.min <= 10 && value >= 0 && value <= 6
  const labelValue = canUseDecimals ? value : Math.round(value)

  return labelValue.toFixed(canUseDecimals ? 1 : 0).replace(/\.0+$/, '')
}

export function Sparkline({ movements, currentPoints, embedded }: Props) {
  const [range, setRange] = useState<'7' | '30' | 'all'>('all')

  const limitDays = range === '7' ? 7 : range === '30' ? 30 : null
  const data = useMemo(
    () => computeGraphSeries(movements, currentPoints, limitDays),
    [movements, currentPoints, limitDays],
  )

  if (movements.length === 0) return null
  if (data.length < 2) return null

  const geometry = { width: 600, height: 80, padding: 4 }
  const visualBounds = useMemo(() => computeVisualBounds(data.map((point) => point.value)), [data])
  const xPositions = useMemo(() => computeHybridXPositions(data, geometry), [data])

  const points = data
    .map((point, index) => {
      const x = xPositions[index]
      const y = mapValueToY(point.value, visualBounds, geometry)
      return `${x},${y}`
    })
    .join(' ')

  const startX = xPositions[0]
  const lastX = xPositions[xPositions.length - 1]
  const areaPath = `M${points} L${lastX},${geometry.height - geometry.padding} L${startX},${geometry.height - geometry.padding} Z`
  const linePath = `M${points}`
  const lastY = mapValueToY(data[data.length - 1].value, visualBounds, geometry)

  const header = (
    <div className="sparkline-header">
      {!embedded ? <h3>Andamento punti</h3> : null}
      <div className="sparkline-range">
        <button
          type="button"
          className={range === '7' ? 'active' : ''}
          onClick={() => setRange('7')}
        >
          7gg
        </button>
        <button
          type="button"
          className={range === '30' ? 'active' : ''}
          onClick={() => setRange('30')}
        >
          30gg
        </button>
        <button
          type="button"
          className={range === 'all' ? 'active' : ''}
          onClick={() => setRange('all')}
        >
          Tutto
        </button>
      </div>
    </div>
  )

  const yLabels = useMemo(() => {
    const steps = 6
    const result: { label: string; topPct: number }[] = []

    for (let index = 0; index < steps; index++) {
      const value = visualBounds.min + ((visualBounds.max - visualBounds.min) / (steps - 1)) * index
      result.push({
        label: formatYAxisLabel(value, visualBounds),
        topPct: 100 - (index / (steps - 1)) * 100,
      })
    }

    return result
  }, [visualBounds])

  const chartContent = (
    <div className="sparkline-chart">
      <div className="sparkline-y-axis">
        {yLabels.map((label, index) => (
          <span
            key={index}
            className="sparkline-y-label"
            style={{ top: `${label.topPct}%` }}
          >
            {label.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="sparkline-canvas"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(15,76,92,0.18)" />
            <stop offset="100%" stopColor="rgba(15,76,92,0.0)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkline-grad)" />
        <path
          d={linePath}
          fill="none"
          stroke="#0f4c5c"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={lastX} cy={lastY} r="3.5" fill="#0f4c5c" stroke="#fff" strokeWidth="1.5" />
      </svg>
    </div>
  )

  if (embedded) {
    return (
      <div className="sparkline-section" style={{ borderTop: 'none', marginTop: 0, paddingTop: '0.35rem' }}>
        {header}
        {chartContent}
      </div>
    )
  }

  return (
    <div className="sparkline-section">
      {header}
      {chartContent}
    </div>
  )
}
