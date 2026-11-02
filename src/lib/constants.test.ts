import { describe, expect, it } from 'vitest'
import { POINTS_DIVISOR } from './constants'

describe('POINTS_DIVISOR', () => {
  it('is 1', () => {
    expect(POINTS_DIVISOR).toBe(1)
  })
})

describe('points calculation', () => {
  const calcPoints = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return 0
    return Math.floor(amount / POINTS_DIVISOR)
  }

  it('returns one point for 1 EUR and floors fractional amounts', () => {
    expect(calcPoints(6.99)).toBe(6)
    expect(calcPoints(1)).toBe(1)
    expect(calcPoints(0)).toBe(0)
  })

  it('returns 7 points for 7 EUR', () => {
    expect(calcPoints(7)).toBe(7)
  })

  it('returns 14 points for 14 EUR', () => {
    expect(calcPoints(14)).toBe(14)
  })

  it('returns 100 points for 100 EUR', () => {
    expect(calcPoints(100)).toBe(100)
  })

  it('floors fractional points', () => {
    expect(calcPoints(13.99)).toBe(13)
    expect(calcPoints(20.5)).toBe(20)
  })

  it('returns 0 for negative or NaN amounts', () => {
    expect(calcPoints(-5)).toBe(0)
    expect(calcPoints(NaN)).toBe(0)
    expect(calcPoints(Infinity)).toBe(0)
  })
})
