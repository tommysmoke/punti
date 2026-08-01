export interface InventoryEntry {
  id: number
  product_name: string
  barcode: string | null
  quantity_quarto: number
  quantity_castenaso: number
  quantity_bologna: number
  quantity_san_lazzaro: number
  category: string | null
  alias_1: string | null
  alias_2: string | null
  alias_3: string | null
  alias_4: string | null
  alias_5: string | null
  alias_6: string | null
  alias_7: string | null
  alias_8: string | null
  alias_9: string | null
  alias_10: string | null
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

const ALIAS_COLUMNS: (keyof InventoryEntry)[] = [
  'alias_1', 'alias_2', 'alias_3', 'alias_4', 'alias_5',
  'alias_6', 'alias_7', 'alias_8', 'alias_9', 'alias_10',
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

export function getAliases(entry: InventoryEntry): string[] {
  return ALIAS_COLUMNS
    .map((col) => entry[col])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}

export function findEmptyAliasColumn(entry: InventoryEntry): keyof InventoryEntry | null {
  for (const col of ALIAS_COLUMNS) {
    const val = entry[col]
    if (typeof val !== 'string' || val.trim() === '') return col
  }
  return null
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
        let tokenScore = jaccardSimilarity(cartTokens, entryTokens)
        const substringScore = substringBonus(normalize(cartName), normalize(entry.product_name))

        // Check aliases: exact match on alias gives a high score
        const aliases = getAliases(entry)
        for (const alias of aliases) {
          if (normalize(alias) === normalize(cartName)) {
            tokenScore = Math.max(tokenScore, 0.95)
            break
          }
          const aliasTokens = tokenize(alias)
          const aliasScore = jaccardSimilarity(cartTokens, aliasTokens)
          if (aliasScore > 0.5) {
            tokenScore = Math.max(tokenScore, aliasScore * 0.9)
          }
        }

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
