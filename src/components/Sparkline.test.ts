import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeCumulative } from './Sparkline'
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