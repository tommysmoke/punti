import { describe, expect, it } from 'vitest'
import {
  applyCrossRequestResponse,
  buildCrossRequestBody,
  buildCrossRequestAggregateBody,
  crossRequestTimeoutMs,
  parseCrossRequestBody,
  pickCrossResponse,
  planCrossRequestStep,
} from '../../supabase/functions/_shared/crossCascade'

describe('cross-request cascade helpers', () => {
  it('parses request and response lines with optional barcodes', () => {
    expect(buildCrossRequestBody(
      [{ name: 'Liquido Fresco', quantity: 3, barcode: '8012345678901' }],
      'Chiede',
    )).toBe('Chiede:\n3 Liquido Fresco (8012345678901)')
    expect(parseCrossRequestBody('Chiede:\n3 Liquido Fresco (8012345678901)')).toEqual([
      { name: 'Liquido Fresco', quantity: 3, barcode: '8012345678901' },
    ])
    expect(parseCrossRequestBody('Conferma invio:\n1 Liquido Fresco')).toEqual([
      { name: 'Liquido Fresco', quantity: 1, barcode: null },
    ])
  })

  it('caps confirmations to the remaining quantity and ignores unrelated items', () => {
    const result = applyCrossRequestResponse(
      [{ name: 'Liquido Fresco', quantity: 3, barcode: '8012345678901' }],
      'Conferma invio:\n2 Liquido Fresco (8012345678901)\n8 Altro prodotto',
    )

    expect(result).toEqual({
      confirmed: [{ name: 'Liquido Fresco', quantity: 2, barcode: '8012345678901' }],
      remaining: [{ name: 'Liquido Fresco', quantity: 1, barcode: '8012345678901' }],
    })
  })

  it('matches a response by barcode and removes fully supplied items', () => {
    const result = applyCrossRequestResponse(
      [{ name: 'Nome catalogo', quantity: 2, barcode: '8012345678901' }],
      'Conferma invio:\n2 Nome alternativo (8012345678901)',
    )

    expect(result).toEqual({
      confirmed: [{ name: 'Nome alternativo', quantity: 2, barcode: '8012345678901' }],
      remaining: [],
    })
  })

  it('builds the existing summary format and applies the store timeouts', () => {
    expect(buildCrossRequestAggregateBody(
      [
        { store: 'Quarto', items: [{ name: 'Liquido Fresco', quantity: 1, barcode: null }] },
        { store: 'Bologna', items: [], status: 'timeout' },
      ],
      [{ name: 'Coil X', quantity: 2, barcode: '123' }],
    )).toBe('Ricevuto da Quarto:\n1 Liquido Fresco\n\nBologna: non ha risposto in tempo\n\nNON CONFERMATI:\n2 Coil X (123)')

    expect(crossRequestTimeoutMs('Bologna')).toBe(35 * 60 * 1000)
    expect(crossRequestTimeoutMs('Castenaso')).toBe(65 * 60 * 1000)
  })

  it('reports catalog errors without treating them as normal unconfirmed items', () => {
    expect(buildCrossRequestAggregateBody([], [
      { name: 'Prodotto ambiguo', quantity: 1, barcode: '111', error: 'barcode 111 duplicato su 2 righe inventario' },
    ])).toBe('NON ELABORATI:\n1 Prodotto ambiguo (111): barcode 111 duplicato su 2 righe inventario')
  })

  it('waits for a response until the strict timeout boundary', () => {
    const state = {
      ranking: ['Quarto'],
      current_index: 0,
      timer_started: '2026-10-12T10:00:00.000Z',
      remaining: [{ name: 'Liquido', quantity: 1, barcode: null }],
      confirmed: [],
    }
    const startedAt = new Date(state.timer_started).getTime()

    expect(planCrossRequestStep(state, null, startedAt + 65 * 60 * 1000).event).toBe('waiting')
    expect(planCrossRequestStep(state, null, startedAt + 65 * 60 * 1000 + 1).event).toBe('timeout')
  })

  it('uses Bologna timeout before considering even a late response', () => {
    const state = {
      ranking: ['Bologna'],
      current_index: 0,
      timer_started: '2026-10-12T10:00:00.000Z',
      remaining: [{ name: 'Liquido', quantity: 1, barcode: null }],
      confirmed: [],
    }
    const startedAt = new Date(state.timer_started).getTime()
    const plan = planCrossRequestStep(state, 'Conferma invio:\n1 Liquido', startedAt + 35 * 60 * 1000 + 1)

    expect(plan.event).toBe('timeout')
    expect(plan.confirmed).toEqual([{ store: 'Bologna', items: [], status: 'timeout' }])
    expect(plan.remaining).toEqual(state.remaining)
  })

  it('models a multi-store cascade with partial, empty, and final responses', () => {
    const initial = {
      ranking: ['Quarto', 'Castenaso', 'San Lazzaro'],
      current_index: 0,
      timer_started: '2026-10-12T10:00:00.000Z',
      remaining: [
        { name: 'Liquido A', quantity: 3, barcode: 'A' },
        { name: 'Liquido B', quantity: 1, barcode: 'B' },
      ],
      confirmed: [],
    }
    const now = new Date(initial.timer_started).getTime()
    const first = planCrossRequestStep(
      initial,
      'Conferma invio:\n2 Liquido A (A)\n1 Liquido B (B)',
      now,
    )
    expect(first.event).toBe('response')
    expect(first.remaining).toEqual([{ name: 'Liquido A', quantity: 1, barcode: 'A' }])

    const second = planCrossRequestStep(
      { ...initial, current_index: 1, remaining: first.remaining, confirmed: first.confirmed },
      'Conferma invio:',
      now,
    )
    expect(second.event).toBe('response')
    expect(second.confirmed.at(-1)).toEqual({ store: 'Castenaso', items: [], status: 'empty' })
    expect(second.remaining).toEqual(first.remaining)

    const final = planCrossRequestStep(
      { ...initial, current_index: 2, remaining: second.remaining, confirmed: second.confirmed },
      'Conferma invio:\n5 Liquido A (A)',
      now,
    )
    expect(final.event).toBe('response')
    expect(final.remaining).toEqual([])
    expect(final.confirmed.at(-1)).toEqual({
      store: 'San Lazzaro',
      items: [{ name: 'Liquido A', quantity: 1, barcode: 'A' }],
      status: 'confirmed',
    })
    expect(buildCrossRequestAggregateBody(final.confirmed, final.remaining)).not.toContain('NON CONFERMATI')
  })

  it('completes malformed rankings safely and rejects malformed timers', () => {
    expect(planCrossRequestStep({
      ranking: [],
      current_index: 0,
      timer_started: 'invalid',
      remaining: [{ name: 'Liquido', quantity: 1, barcode: null }],
      confirmed: null,
    }, null, 0).event).toBe('complete')

    expect(() => planCrossRequestStep({
      ranking: ['Quarto'],
      current_index: 0,
      timer_started: 'invalid',
      remaining: [],
      confirmed: null,
    }, null, 0)).toThrow('timer_started non valido')
  })
})

describe('cross-request response deadline', () => {
  const state = {
    ranking: ['Bologna'],
    current_index: 0,
    timer_started: '2026-10-12T10:00:00.000Z',
    remaining: [{ name: 'Liquido', quantity: 1, barcode: null }],
    confirmed: [],
  }
  const startedAt = new Date(state.timer_started).getTime()
  const deadline = startedAt + 35 * 60 * 1000

  it('keeps a response sent before the deadline even when processed after it', () => {
    const plan = planCrossRequestStep(state, 'Conferma invio:\n1 Liquido', deadline + 30_000, deadline - 20_000)

    expect(plan.event).toBe('response')
    expect(plan.remaining).toEqual([])
  })

  it('times out a response sent after the deadline', () => {
    const plan = planCrossRequestStep(state, 'Conferma invio:\n1 Liquido', deadline + 30_000, deadline + 1)

    expect(plan.event).toBe('timeout')
    expect(plan.remaining).toEqual(state.remaining)
  })

  it('accepts a response sent exactly at the deadline', () => {
    expect(planCrossRequestStep(state, 'Conferma invio:\n1 Liquido', deadline + 1, deadline).event).toBe('response')
  })
})

describe('pickCrossResponse', () => {
  const row = (id: number, linked: number | null, createdAt: string, title = 'Risposta da Castenaso') => ({
    id,
    title,
    body: `Conferma invio:\n${id} Liquido`,
    created_at: createdAt,
    response_to_request_id: linked,
  })

  it('prefers a response linked to the current request notification', () => {
    const picked = pickCrossResponse(101, 'Castenaso', [
      row(200, null, '2026-10-12T10:01:00Z'),
      row(201, 101, '2026-10-12T10:02:00Z'),
    ])

    expect(picked?.id).toBe(201)
  })

  it('ignores responses linked to a different request, including late replies', () => {
    expect(pickCrossResponse(101, 'Castenaso', [row(200, 100, '2026-10-12T10:01:00Z')])).toBeNull()
    expect(pickCrossResponse(null, 'Castenaso', [row(200, 100, '2026-10-12T10:01:00Z')])).toBeNull()
  })

  it('falls back to the title only for responses without a link', () => {
    expect(pickCrossResponse(101, 'Castenaso', [row(200, null, '2026-10-12T10:01:00Z')])?.id).toBe(200)
    expect(pickCrossResponse(101, 'Castenaso', [row(200, null, '2026-10-12T10:01:00Z', 'Risposta da Quarto')])).toBeNull()
    expect(pickCrossResponse(101, 'Castenaso', [row(200, null, '2026-10-12T10:01:00Z', 'Da consegnare a Quarto')])).toBeNull()
  })

  it('uses the first response when several are linked to the same request', () => {
    const picked = pickCrossResponse(101, 'Castenaso', [
      row(202, 101, '2026-10-12T10:03:00Z'),
      row(201, 101, '2026-10-12T10:02:00Z'),
    ])

    expect(picked?.id).toBe(201)
  })

  it('returns null when there is no candidate', () => {
    expect(pickCrossResponse(101, 'Castenaso', [])).toBeNull()
  })
})

describe('cross-request parsing hardening', () => {
  it('ignores lines with zero quantity instead of counting them as one', () => {
    expect(parseCrossRequestBody('Conferma invio:\n0 Liquido\n2 Coil (123)')).toEqual([
      { name: 'Coil', quantity: 2, barcode: '123' },
    ])
  })

  it('keeps parentheses that belong to the product name', () => {
    expect(parseCrossRequestBody('2 APP ICE (mela fresh)\n1 Aegis Solo 2 Mod (S100) - Classic Black (6974622800833)')).toEqual([
      { name: 'APP ICE (mela fresh)', quantity: 2, barcode: null },
      { name: 'Aegis Solo 2 Mod (S100) - Classic Black', quantity: 1, barcode: '6974622800833' },
    ])
  })

  it('parses oversized whitespace lines in linear time', () => {
    const hostile = `1 a${' '.repeat(40_000)}b`
    const startedAt = performance.now()

    expect(parseCrossRequestBody(`${hostile}\n2 Liquido`)).toEqual([
      { name: 'Liquido', quantity: 2, barcode: null },
    ])
    expect(parseCrossRequestBody(`2 Liquido\n1 a${' '.repeat(200_000)}b`)).toEqual([
      { name: 'Liquido', quantity: 2, barcode: null },
    ])
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('matches the barcode before the name when names are duplicated', () => {
    const result = applyCrossRequestResponse(
      [
        { name: 'Liquido X', quantity: 1, barcode: '111' },
        { name: 'Liquido X', quantity: 2, barcode: '222' },
      ],
      'Conferma invio:\n2 Liquido X (222)',
    )

    expect(result.confirmed).toEqual([{ name: 'Liquido X', quantity: 2, barcode: '222' }])
    expect(result.remaining).toEqual([{ name: 'Liquido X', quantity: 1, barcode: '111' }])
  })

  it('round-trips a barcode-less name that ends with parentheses', () => {
    const requested = [{ name: 'Aroma Limone (10ml)', quantity: 3, barcode: null }]
    const response = buildCrossRequestBody([{ name: 'Aroma Limone (10ml)', quantity: 2, barcode: null }], 'Conferma invio')

    const result = applyCrossRequestResponse(requested, response)

    expect(result.remaining).toEqual([{ name: 'Aroma Limone (10ml)', quantity: 1, barcode: null }])
    expect(buildCrossRequestAggregateBody([{ store: 'Quarto', items: result.confirmed }], []))
      .toBe('Ricevuto da Quarto:\n2 Aroma Limone (10ml)\n')
  })
})