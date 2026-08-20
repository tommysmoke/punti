import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
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

const GEOMETRY: ChartGeometry = { width: 600, height: 80, padding: 4 }

export function Sparkline({ movements, currentPoints, embedded }: Props) {
  const [range, setRange] = useState<30 | 365 | 1095>(1095)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const limitDays = range
  const data = useMemo(
    () => computeGraphSeries(movements, currentPoints, limitDays),
    [movements, currentPoints, limitDays],
  )

  const visualBounds = useMemo(() => computeVisualBounds(data.map((point) => point.value)), [data])
  const xPositions = useMemo(() => computeHybridXPositions(data, GEOMETRY), [data])
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

  const gridY = useMemo(() => {
    const steps = 6
    const ys: number[] = []
    for (let index = 0; index < steps; index++) {
      const value = visualBounds.min + ((visualBounds.max - visualBounds.min) / (steps - 1)) * index
      ys.push(mapValueToY(value, visualBounds, GEOMETRY))
    }
    return ys
  }, [visualBounds])

  useEffect(() => {
    setHoverIndex(null)
  }, [limitDays])

  if (movements.length === 0) return null
  if (data.length < 2) return null

  const chartPoints = data.map((point, index) => ({
    x: xPositions[index],
    y: mapValueToY(point.value, visualBounds, GEOMETRY),
    value: point.value,
    timestamp: point.timestamp,
  }))

  const polylinePoints = chartPoints.map((p) => `${p.x},${p.y}`).join(' ')
  const startX = chartPoints[0].x
  const lastPoint = chartPoints[chartPoints.length - 1]
  const lastX = lastPoint.x
  const lastY = lastPoint.y
  const areaPath = `M${polylinePoints} L${lastX},${GEOMETRY.height - GEOMETRY.padding} L${startX},${GEOMETRY.height - GEOMETRY.padding} Z`

  const segments = chartPoints.slice(1).map((p, index) => {
    const prev = chartPoints[index]
    const up = p.value >= prev.value
    return {
      x1: prev.x,
      y1: prev.y,
      x2: p.x,
      y2: p.y,
      color: up ? '#2e9e5b' : '#d9534f',
      length: Math.hypot(p.x - prev.x, p.y - prev.y),
      delay: 0.15 + index * 0.05,
    }
  })

  const badgeLabel = `${currentPoints} pt`
  const badgeW = badgeLabel.length * 7 + 16
  const badgeX = GEOMETRY.width - GEOMETRY.padding - badgeW

  const hovered = hoverIndex !== null ? chartPoints[hoverIndex] : null
  const hoverDate = hovered
    ? new Date(hovered.timestamp).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : ''

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return
    const x = ((event.clientX - rect.left) / rect.width) * GEOMETRY.width
    let nearest = 0
    let best = Infinity
    xPositions.forEach((xp, index) => {
      const distance = Math.abs(xp - x)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    setHoverIndex(nearest)
  }

  const header = (
    <div className="sparkline-header">
      {!embedded ? <h3>Andamento punti</h3> : null}
      <div className="sparkline-range">
        <button
          type="button"
          className={range === 30 ? 'active' : ''}
          onClick={() => setRange(30)}
        >
          30gg
        </button>
        <button
          type="button"
          className={range === 365 ? 'active' : ''}
          onClick={() => setRange(365)}
        >
          1 anno
        </button>
        <button
          type="button"
          className={range === 1095 ? 'active' : ''}
          onClick={() => setRange(1095)}
        >
          3 anni
        </button>
      </div>
    </div>
  )

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
        ref={svgRef}
        viewBox={`0 0 ${GEOMETRY.width} ${GEOMETRY.height}`}
        className="sparkline-canvas"
        preserveAspectRatio="none"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(15,76,92,0.18)" />
            <stop offset="100%" stopColor="rgba(15,76,92,0.0)" />
          </linearGradient>
        </defs>

        {gridY.map((y, index) => (
          <line
            key={`grid-${index}`}
            className="spark-grid"
            x1={GEOMETRY.padding}
            y1={y}
            x2={GEOMETRY.width - GEOMETRY.padding}
            y2={y}
            strokeWidth="1"
          />
        ))}

        <g key={range}>
          <path className="spark-area" d={areaPath} fill="url(#sparkline-grad)" />
          {segments.map((segment, index) => (
            <line
              key={index}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke={segment.color}
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                strokeDasharray: `${segment.length} ${segment.length}`,
                strokeDashoffset: segment.length,
                animation: `spark-draw 0.55s ease ${segment.delay}s forwards`,
              }}
            />
          ))}
        </g>

        <circle cx={lastX} cy={lastY} r="3.5" fill="#0f4c5c" stroke="#fff" strokeWidth="1.5" />

        {hovered ? (
          <g pointerEvents="none">
            <line
              className="spark-crosshair"
              x1={hovered.x}
              y1={GEOMETRY.padding}
              x2={hovered.x}
              y2={GEOMETRY.height - GEOMETRY.padding}
              strokeWidth="1"
            />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill="#0f4c5c" stroke="#fff" strokeWidth="1.5" />
            <g
              transform={`translate(${Math.min(Math.max(hovered.x + 8, GEOMETRY.padding), GEOMETRY.width - GEOMETRY.padding - 76)}, ${hovered.y - 38 < GEOMETRY.padding ? hovered.y + 10 : hovered.y - 38})`}
            >
              <rect className="spark-tip-rect" width="76" height="30" rx="5" />
              <text x="8" y="13" className="spark-tip-value">{hovered.value} pt</text>
              <text x="8" y="25" className="spark-tip-date">{hoverDate}</text>
            </g>
          </g>
        ) : null}

        <g pointerEvents="none">
          <rect className="spark-tip-rect" x={badgeX} y={GEOMETRY.padding - 2} width={badgeW} height={18} rx={9} />
          <text x={badgeX + badgeW / 2} y={GEOMETRY.padding + 9} textAnchor="middle" className="spark-tip-value">{badgeLabel}</text>
        </g>
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
