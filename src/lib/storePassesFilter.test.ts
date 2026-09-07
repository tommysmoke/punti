import { describe, expect, it } from 'vitest'
import { storePassesFilter, getStoreStocks, type InventoryEntry } from './crossInventory'

const entry: InventoryEntry = {
  id: 1,
  product_name: 'GOO PLOSION - Aroma 10ml',
  barcode: '645760039435',
  quantity_quarto: 0,
  quantity_castenaso: 2,
  quantity_bologna: 0,
  quantity_san_lazzaro: 0,
  category: 'AROMI  –  Tnt',
  last_carico_quarto: null,
  last_carico_castenaso: '01/06/2026',
  last_carico_bologna: null,
  last_carico_san_lazzaro: null,
  last_scarico_quarto: null,
  last_scarico_castenaso: '02/09/2026',
  last_scarico_bologna: null,
  last_scarico_san_lazzaro: null,
  alias_1: null, alias_2: null, alias_3: null, alias_4: null, alias_5: null,
  alias_6: null, alias_7: null, alias_8: null, alias_9: null, alias_10: null,
}

describe('storePassesFilter GOO PLOSION', () => {
  it('esclude castenaso: carico vecchio + scarico recente (02/09) + giacenza 2 < 5', () => {
    const castenaso = getStoreStocks(entry).find((s) => s.store === 'castenaso')!
    expect(storePassesFilter(castenaso, 'filter1', 1, entry)).toBe(false)
  })

  it('esclude castenaso anche con requestedQty >= 3 (giacenza 2 non basta)', () => {
    const castenaso = getStoreStocks(entry).find((s) => s.store === 'castenaso')!
    expect(storePassesFilter(castenaso, 'filter1', 3, entry)).toBe(false)
  })
})
