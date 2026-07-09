import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeCumulative, computeVisualBounds, mapValueToY } from './Sparkline'
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
})