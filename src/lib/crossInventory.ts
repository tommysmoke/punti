export interface InventoryEntry {
  id: number
  store_name: string
  product_name: string
  barcode: string | null
  quantity: number
  category: string | null
}

export interface MatchResult {
  cartName: string
  matches: {
    entry: InventoryEntry
    score: number
  }[]
}

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
  currentStoreName: string,
): MatchResult[] {
  const otherInventory = allInventory.filter(
    (entry) => entry.store_name !== currentStoreName,
  )

  return cartItems.map((cartName) => {
    const cartTokens = tokenize(cartName)

    const scored = otherInventory
      .map((entry) => {
        const entryTokens = tokenize(entry.product_name)
        const tokenScore = jaccardSimilarity(cartTokens, entryTokens)
        const substringScore = substringBonus(normalize(cartName), normalize(entry.product_name))
        const score = Math.max(tokenScore, substringScore * 0.85, tokenScore * 0.7 + substringScore * 0.3)

        return { entry, score }
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
