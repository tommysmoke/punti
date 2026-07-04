import { describe, expect, it } from 'vitest'
import { buildUsername } from './username'

describe('buildUsername', () => {
  it('generates username from name and birth date', () => {
    expect(buildUsername('Mario Rossi', '23/07')).toBe('mariorossi2307')
  })

  it('removes accented characters', () => {
    expect(buildUsername('André Müller', '01/01')).toBe('andremuller0101')
  })

  it('removes content in parentheses', () => {
    expect(buildUsername('Luca (Napoleone) Verdi', '15/03')).toBe('lucaverdi1503')
  })

  it('removes special characters', () => {
    expect(buildUsername("Franco D'Angelo", '31/12')).toBe('francodangelo3112')
  })

  it('handles invalid birth date format by using 0000', () => {
    expect(buildUsername('Test User', 'abc')).toBe('testuser0000')
  })

  it('handles empty birth date', () => {
    expect(buildUsername('Test User', '')).toBe('testuser0000')
  })

  it('handles empty name', () => {
    expect(buildUsername('', '12/05')).toBe('1205')
  })

  it('handles multiple spaces in name', () => {
    expect(buildUsername('Mario   Rossi', '05/05')).toBe('mariorossi0505')
  })

  it('preserves numbers already in name', () => {
    expect(buildUsername('Test123 User', '10/10')).toBe('test123user1010')
  })

  it('rejects invalid day/month like 99/99', () => {
    expect(buildUsername('Test User', '99/99')).toBe('testuser0000')
  })

  it('handles names with only special characters', () => {
    expect(buildUsername('!@#$%', '01/01')).toBe('0101')
  })
})
