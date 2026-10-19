import { describe, expect, it } from 'vitest'
import { buildCrossRequestVisibility, rankStoresForBasket, STORE_NAMES, type InventoryEntry } from './crossInventory'
import { buildCrossRequestBody, getCrossRequestItemsForStore } from '../../supabase/functions/_shared/crossCascade'

const entry: InventoryEntry = {
  id: 1,
  product_name: 'Liquido Test',
  barcode: '111',
  quantity_quarto: 5,
  quantity_castenaso: 5,
  quantity_bologna: 5,
  quantity_san_lazzaro: 5,
  category: 'LIQUIDI',
  last_carico_quarto: null,
  last_carico_castenaso: null,
  last_carico_bologna: null,
  last_carico_san_lazzaro: null,
  last_scarico_quarto: null,
  last_scarico_castenaso: null,
  last_scarico_bologna: null,
  last_scarico_san_lazzaro: null,
  alias_1: null, alias_2: null, alias_3: null, alias_4: null, alias_5: null,
  alias_6: null, alias_7: null, alias_8: null, alias_9: null, alias_10: null,
}

describe('rankStoresForBasket', () => {
  const basket = [{ name: 'Liquido Test', barcode: '111', quantity: 1 }]

  it.each(STORE_NAMES)('esclude la sede richiedente %s dalla classifica', (requestingStore) => {
    const ranking = rankStoresForBasket(basket, [entry], requestingStore, 'nofiltro')

    expect(ranking).not.toContain(requestingStore)
    expect([...ranking].sort()).toEqual(STORE_NAMES.filter((name) => name !== requestingStore).sort())
  })

  it('calcola la visibilità per sede senza modificare la quantità globale', () => {
    const visibility = buildCrossRequestVisibility(basket, [entry], 'Quarto', 'nofiltro')
    const items = [{
      ...basket[0],
      visibleQuantities: visibility[basket[0].name],
    }]

    expect(getCrossRequestItemsForStore(items, 'Castenaso')).toEqual([{ ...items[0], quantity: 1 }])
    expect(getCrossRequestItemsForStore(items, 'San Lazzaro')).toEqual([{ ...items[0], quantity: 1 }])
    expect(buildCrossRequestBody(items, 'Chiede', 'Castenaso')).toBe('Chiede:\n1 Liquido Test (111)')
    expect(items[0].quantity).toBe(1)
  })

  it('nasconde un articolo solo per una sede e lo mostra alla sede successiva', () => {
    const items = [{
      name: 'Liquido Test',
      barcode: '111',
      quantity: 2,
      visibleQuantities: { Castenaso: 0, 'San Lazzaro': 2 },
    }]

    expect(getCrossRequestItemsForStore(items, 'Castenaso')).toEqual([])
    expect(getCrossRequestItemsForStore(items, 'San Lazzaro')).toEqual(items)
    expect(items[0].quantity).toBe(2)
  })
})
