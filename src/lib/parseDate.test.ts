import { describe, expect, it } from 'vitest'
import { parseDate } from './crossInventory'

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day)
}

describe('parseDate', () => {
  it('parses dd/mm/yyyy (day 2 of month)', () => {
    expect(parseDate('02/09/2026')?.getTime()).toBe(d(2026, 9, 2).getTime())
  })

  it('parses dd/mm/yyyy (day 1 of month)', () => {
    expect(parseDate('01/08/2026')?.getTime()).toBe(d(2026, 8, 1).getTime())
  })

  it('parses dd/mm/yyyy (day 13, unambiguous)', () => {
    expect(parseDate('13/09/2026')?.getTime()).toBe(d(2026, 9, 13).getTime())
  })

  it('parses dd/mm/yyyy (day 31)', () => {
    expect(parseDate('31/12/2026')?.getTime()).toBe(d(2026, 12, 31).getTime())
  })

  it('parses dd/mm/yyyy without leading zeros', () => {
    expect(parseDate('2/9/2026')?.getTime()).toBe(d(2026, 9, 2).getTime())
  })

  it('parses dd-mm-yyyy', () => {
    expect(parseDate('02-09-2026')?.getTime()).toBe(d(2026, 9, 2).getTime())
  })

  it('parses dd.mm.yyyy', () => {
    expect(parseDate('02.09.2026')?.getTime()).toBe(d(2026, 9, 2).getTime())
  })

  it('parses yyyy-mm-dd ISO', () => {
    expect(parseDate('2026-08-06')?.getTime()).toBe(d(2026, 8, 6).getTime())
  })

  it('parses yyyy/mm/dd', () => {
    expect(parseDate('2026/08/06')?.getTime()).toBe(d(2026, 8, 6).getTime())
  })

  it('parses ISO date with time suffix', () => {
    expect(parseDate('2026-08-06T00:00:00+02:00')?.getTime()).toBe(d(2026, 8, 6).getTime())
  })

  it('rejects day 32', () => {
    expect(parseDate('32/01/2026')).toBeNull()
  })

  it('rejects month 13', () => {
    expect(parseDate('02/13/2026')).toBeNull()
  })

  it('rejects month 0', () => {
    expect(parseDate('02/00/2026')).toBeNull()
  })

  it('rejects day 0', () => {
    expect(parseDate('00/09/2026')).toBeNull()
  })

  it('rejects invalid February date (31 Feb)', () => {
    expect(parseDate('31/02/2026')).toBeNull()
  })

  it('accepts leap year February 29', () => {
    expect(parseDate('29/02/2024')?.getTime()).toBe(d(2024, 2, 29).getTime())
  })

  it('rejects non-leap February 29', () => {
    expect(parseDate('29/02/2026')).toBeNull()
  })

  it('rejects April 31', () => {
    expect(parseDate('31/04/2026')).toBeNull()
  })

  it('rejects empty and null', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate(null)).toBeNull()
    expect(parseDate('   ')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(parseDate('abc')).toBeNull()
    expect(parseDate('not-a-date')).toBeNull()
  })

  it('rejects two-digit year', () => {
    expect(parseDate('02/09/26')).toBeNull()
  })

  it('rejects out-of-range year', () => {
    expect(parseDate('02/09/1800')).toBeNull()
    expect(parseDate('02/09/9999')).toBeNull()
  })
})
