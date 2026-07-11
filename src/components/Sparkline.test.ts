import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeCumulative, computeGraphSeries, computeHybridXPositions, computeVisualBounds, formatYAxisLabel, mapValueToY } from './Sparkline'
import type { Movement } from '../hooks/useAppState'

describe('computeCumulative', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('anchors the series to the current customer balance', () => {
    const movements: Movement[] = [
      {
        id: 1,
        customer_id: 10,
        kind: 'earn',
        points: 4,
        note: 'Spesa 28.00 EUR',
        created_at: '2026-07-09T10:44:00.000Z',
      },
      {
        id: 2,
        customer_id: 10,
        kind: 'redeem',
        points: 10,
        note: 'Redemption manuale',
        created_at: '2026-07-09T10:45:00.000Z',
      },
    ]

    expect(computeCumulative(movements, 1, null)).toEqual([11, 1])
  })

  it('uses only the selected range while still ending at the current balance', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'))

    const movements: Movement[] = [
      {
        id: 1,
        customer_id: 10,
        kind: 'earn',
        points: 5,
        note: null,
        created_at: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 2,
        customer_id: 10,
        kind: 'earn',
        points: 4,
        note: null,
        created_at: '2026-07-08T10:00:00.000Z',
      },
      {
        id: 3,
        customer_id: 10,
        kind: 'redeem',
        points: 2,
        note: null,
        created_at: '2026-07-09T10:00:00.000Z',
      },
    ]

    expect(computeCumulative(movements, 7, 7)).toEqual([9, 7])
  })
})

describe('computeGraphSeries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a synthetic point one hour before the first movement in the selected range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'))

    const movements: Movement[] = [
      {
        id: 1,
        customer_id: 10,
        kind: 'earn',
        points: 1,
        note: 'Spesa 11.00 EUR',
        created_at: '2026-07-11T11:29:00.000Z',
      },
    ]

    const series = computeGraphSeries(movements, 2, null)

    expect(series).toHaveLength(2)
    expect(series[0]).toEqual({
      timestamp: new Date('2026-07-11T10:29:00.000Z').getTime(),
      value: 1,
    })
    expect(series[1]).toEqual({
      timestamp: new Date('2026-07-11T11:29:00.000Z').getTime(),
      value: 2,
    })
  })
})

describe('computeHybridXPositions', () => {
  it('keeps consecutive points within a bounded, deterministic spacing range', () => {
    const geometry = { width: 600, height: 80, padding: 4 }
    const points = [
      { timestamp: 0, value: 10 },
      { timestamp: 10, value: 11 },
      { timestamp: 20, value: 12 },
      { timestamp: 220, value: 13 },
    ]

    const xPositions = computeHybridXPositions(points, geometry)
    const gaps = [
      xPositions[1] - xPositions[0],
      xPositions[2] - xPositions[1],
      xPositions[3] - xPositions[2],
    ]
    const idealStep = (geometry.width - geometry.padding * 2) / (points.length - 1)

    expect(xPositions[0]).toBe(geometry.padding)
    expect(xPositions[xPositions.length - 1]).toBe(geometry.width - geometry.padding)
    gaps.forEach((gap) => {
      expect(gap).toBeGreaterThanOrEqual(idealStep * 0.5)
      expect(gap).toBeLessThanOrEqual(idealStep * 1.6)
    })
  })
})

describe('computeVisualBounds', () => {
  it('adds a subtle margin without forcing zero for positive-only data far from the floor', () => {
    const bounds = computeVisualBounds([11, 1])

    expect(bounds.min).toBeGreaterThan(0)
    expect(bounds.min).toBeLessThan(1)
    expect(bounds.max).toBeGreaterThan(11)
    expect(bounds.max).toBeLessThan(12)
  })

  it('never lets the visual minimum go below the zero floor', () => {
    const bounds = computeVisualBounds([1, 0])

    expect(bounds.min).toBe(0)
    expect(bounds.max).toBeGreaterThan(1)
  })

  it('adds margin even when all values are identical', () => {
    const bounds = computeVisualBounds([4, 4])

    expect(bounds.min).toBeLessThan(4)
    expect(bounds.max).toBeGreaterThan(4)
  })

  it('maps Y positions using the same visual scale for every chart element', () => {
    const bounds = computeVisualBounds([11, 1])
    const geometry = { width: 600, height: 80, padding: 4 }

    const higherValueY = mapValueToY(11, bounds, geometry)
    const lowerValueY = mapValueToY(1, bounds, geometry)

    expect(higherValueY).toBeGreaterThanOrEqual(geometry.padding)
    expect(lowerValueY).toBeLessThanOrEqual(geometry.height - geometry.padding)
    expect(higherValueY).toBeLessThan(lowerValueY)
  })

  it('keeps decimals only in the 0 to 6 segment', () => {
    const bounds = { min: 0, max: 10 }

    expect(formatYAxisLabel(5.4, bounds)).toBe('5.4')
    expect(formatYAxisLabel(6, bounds)).toBe('6')
    expect(formatYAxisLabel(6.2, bounds)).toBe('6')
    expect(formatYAxisLabel(8.4, bounds)).toBe('8')
  })
})