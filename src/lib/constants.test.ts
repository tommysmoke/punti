import { describe, expect, it } from 'vitest'
import { POINTS_DIVISOR } from './constants'

describe('POINTS_DIVISOR', () => {
  it('is 7', () => {
    expect(POINTS_DIVISOR).toBe(7)
  })
})

describe('points calculation', () => {
  const calcPoints = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return 0
    return Math.floor(amount / POINTS_DIVISOR)
  }

  it('returns 0 for amounts less than 7 EUR', () => {
    expect(calcPoints(6.99)).toBe(0)
    expect(calcPoints(1)).toBe(0)
    expect(calcPoints(0)).toBe(0)
  })

  it('returns 1 for 7 EUR', () => {
    expect(calcPoints(7)).toBe(1)
  })

  it('returns 2 for 14 EUR', () => {
    expect(calcPoints(14)).toBe(2)
  })

  it('returns 14 for 100 EUR', () => {
    expect(calcPoints(100)).toBe(14)
  })

  it('floors fractional points', () => {
    expect(calcPoints(13.99)).toBe(1)
    expect(calcPoints(20.5)).toBe(2)
  })

  it('returns 0 for negative or NaN amounts', () => {
    expect(calcPoints(-5)).toBe(0)
    expect(calcPoints(NaN)).toBe(0)
    expect(calcPoints(Infinity)).toBe(0)
  })
})
