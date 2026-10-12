import { describe, expect, it } from 'vitest'
import { rankStoresForBasket, STORE_NAMES, type InventoryEntry } from './crossInventory'

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
})
