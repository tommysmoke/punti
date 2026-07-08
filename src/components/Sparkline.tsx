import { useMemo, useState } from 'react'
import type { Movement } from '../hooks/useAppState'

type Props = {
  movements: Movement[]
}

function computeCumulative(movements: Movement[], limitDays: number | null): number[] {
  const now = Date.now()
  const cutoff = limitDays ? now - limitDays * 24 * 60 * 60 * 1000 : 0

  const filtered = movements
    .filter((m) => {
      if (!limitDays) return true
      return new Date(m.created_at).getTime() >= cutoff
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  let cum = 0
  return filtered.map((m) => {
    const delta = m.kind === 'earn' ? m.points : -m.points
    cum += delta
    return cum
  })
}

export function Sparkline({ movements }: Props) {
  const [range, setRange] = useState<'7' | '30' | 'all'>('7')

  const limitDays = range === '7' ? 7 : range === '30' ? 30 : null
  const data = useMemo(() => computeCumulative(movements, limitDays), [movements, limitDays])

  if (movements.length === 0) return null
  if (data.length < 2) return null

  const width = 600
  const height = 80
  const padding = 4
  const min = Math.min(...data, 0)
  const max = Math.max(...data)
  const rangeVal = max - min || 1

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2)
      const y = height - padding - ((val - min) / rangeVal) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')

  const areaPath = `M${points} L${padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2)},${height - padding} L${padding},${height - padding} Z`

  const linePath = `M${points}`

  const lastX = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2)
  const lastY = height - padding - ((data[data.length - 1] - min) / rangeVal) * (height - padding * 2)

  return (
    <div className="sparkline-section">
      <div className="sparkline-header">
        <h3>Andamento punti</h3>
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
      <svg
        viewBox={`0 0 ${width} ${height}`}
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
}
