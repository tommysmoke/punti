export interface InventoryEntry {
  id: number
  product_name: string
  barcode: string | null
  quantity_quarto: number
  quantity_castenaso: number
  quantity_bologna: number
  quantity_san_lazzaro: number
  category: string | null
}

export interface StoreStock {
  store: string
  label: string
  quantity: number
}

export interface MatchResult {
  cartName: string
  matches: {
    entry: InventoryEntry
    score: number
    stocks: StoreStock[]
  }[]
}

const STORE_COLUMNS: { store: string; label: string; col: keyof InventoryEntry }[] = [
  { store: 'quarto', label: 'Quarto', col: 'quantity_quarto' },
  { store: 'castenaso', label: 'Castenaso', col: 'quantity_castenaso' },
  { store: 'bologna', label: 'Bologna', col: 'quantity_bologna' },
  { store: 'san_lazzaro', label: 'San Lazzaro', col: 'quantity_san_lazzaro' },
]

export function getStoreStocks(entry: InventoryEntry): StoreStock[] {
  return STORE_COLUMNS.map((s) => ({
    store: s.store,
    label: s.label,
    quantity: entry[s.col] as number,
  }))
}

export function getStoreColumnName(storeName: string): string {
  const found = STORE_COLUMNS.find(
    (s) => s.store === storeName.toLowerCase() || s.label.toLowerCase() === storeName.toLowerCase(),
  )
  return found ? `quantity_${found.store}` : ''
}

export const STORE_NAMES = STORE_COLUMNS.map((s) => s.label)

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 0

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)

  let intersection = 0
  for (const t of setA) {
    if (setB.has(t)) intersection++
  }

  const union = setA.size + setB.size - intersection
  if (union === 0) return 0

  return intersection / union
}

export function matchCartAgainstInventory(
  cartItems: string[],
  allInventory: InventoryEntry[],
): MatchResult[] {
  const validInventory = allInventory.filter(
    (entry) => entry.category && entry.category.trim() !== '',
  )
  return cartItems.map((cartName) => {
    const cartTokens = tokenize(cartName)

    const scored = validInventory
      .map((entry) => {
        const entryTokens = tokenize(entry.product_name)
        const tokenScore = jaccardSimilarity(cartTokens, entryTokens)
        const substringScore = substringBonus(normalize(cartName), normalize(entry.product_name))
        const score = Math.max(tokenScore, substringScore * 0.85, tokenScore * 0.7 + substringScore * 0.3)

        return { entry, score, stocks: getStoreStocks(entry) }
      })
      .filter((m) => m.score >= 0.27)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return { cartName, matches: scored }
  })
}

function substringBonus(a: string, b: string): number {
  if (!a || !b) return 0

  if (b.includes(a)) return 1.0
  if (a.includes(b)) return 0.95

  const tokensB = b.split(/\s+/)
  const tokensA = a.split(/\s+/)

  let matched = 0
  for (const ta of tokensA) {
    if (ta.length < 3) continue
    for (const tb of tokensB) {
      if (tb.length < 3) continue
      if (tb.includes(ta) || ta.includes(tb)) {
        matched++
        break
      }
    }
  }

  const max = Math.max(tokensA.filter((t) => t.length >= 3).length, tokensB.filter((t) => t.length >= 3).length)
  if (max === 0) return 0

  return matched / max
}
