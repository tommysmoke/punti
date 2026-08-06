export interface InventoryEntry {
  id: number
  product_name: string
  barcode: string | null
  quantity_quarto: number
  quantity_castenaso: number
  quantity_bologna: number
  quantity_san_lazzaro: number
  category: string | null
  last_carico_quarto: string | null
  last_carico_castenaso: string | null
  last_carico_bologna: string | null
  last_carico_san_lazzaro: string | null
  last_scarico_quarto: string | null
  last_scarico_castenaso: string | null
  last_scarico_bologna: string | null
  last_scarico_san_lazzaro: string | null
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
  lastCarico: string | null
  lastScarico: string | null
}

export interface MatchResult {
  cartName: string
  matches: {
    entry: InventoryEntry
    score: number
    stocks: StoreStock[]
  }[]
}

const STORE_COLUMNS: { store: string; label: string; col: keyof InventoryEntry; caricoCol: keyof InventoryEntry; scaricoCol: keyof InventoryEntry }[] = [
  { store: 'quarto', label: 'Quarto', col: 'quantity_quarto', caricoCol: 'last_carico_quarto', scaricoCol: 'last_scarico_quarto' },
  { store: 'castenaso', label: 'Castenaso', col: 'quantity_castenaso', caricoCol: 'last_carico_castenaso', scaricoCol: 'last_scarico_castenaso' },
  { store: 'bologna', label: 'Bologna', col: 'quantity_bologna', caricoCol: 'last_carico_bologna', scaricoCol: 'last_scarico_bologna' },
  { store: 'san_lazzaro', label: 'San Lazzaro', col: 'quantity_san_lazzaro', caricoCol: 'last_carico_san_lazzaro', scaricoCol: 'last_scarico_san_lazzaro' },
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
    lastCarico: entry[s.caricoCol] as string | null,
    lastScarico: entry[s.scaricoCol] as string | null,
  }))
}

export function getStoreColumnName(storeName: string): string {
  const found = STORE_COLUMNS.find(
    (s) => s.store === storeName.toLowerCase() || s.label.toLowerCase() === storeName.toLowerCase(),
  )
  return found ? `quantity_${found.store}` : ''
}

const FILTER_START = new Date('2026-08-06T00:00:00+02:00')
const MAX_SCARICO_DAYS = 90
const MAX_CARICO_DAYS = 105

function parseDate(d: string | null): Date | null {
  if (!d) return null
  const parts = d.split('/')
  if (parts.length !== 3) return null
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
}

function getFilterDays(): { scaricoDays: number; caricoDays: number } {
  const now = new Date()
  const daysSinceStart = Math.floor((now.getTime() - FILTER_START.getTime()) / (1000 * 60 * 60 * 24))
  return {
    scaricoDays: Math.min(7 + daysSinceStart, MAX_SCARICO_DAYS),
    caricoDays: Math.min(14 + daysSinceStart, MAX_CARICO_DAYS),
  }
}

export function storePassesFilter(stock: StoreStock, filterName: string): boolean {
  if (filterName === 'nofiltro') return true
  const now = new Date()
  const { scaricoDays, caricoDays } = getFilterDays()

  const caricoDate = parseDate(stock.lastCarico)
  if (caricoDate) {
    const daysSinceCarico = Math.floor((now.getTime() - caricoDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysSinceCarico < caricoDays) return false
  }

  const scaricoDate = parseDate(stock.lastScarico)
  if (scaricoDate) {
    const daysSinceScarico = Math.floor((now.getTime() - scaricoDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysSinceScarico < scaricoDays) return false
  }

  return true
}

export function getFilterRejection(stock: StoreStock, filterName: string): string | null {
  if (filterName === 'nofiltro') return null
  const now = new Date()
  const { scaricoDays, caricoDays } = getFilterDays()

  const caricoDate = parseDate(stock.lastCarico)
  if (caricoDate) {
    const days = Math.floor((now.getTime() - caricoDate.getTime()) / (1000 * 60 * 60 * 24))
    if (days < caricoDays) return `🕐 Ultimo carico: ${days}gg fa (min ${caricoDays}gg)`
  }

  const scaricoDate = parseDate(stock.lastScarico)
  if (scaricoDate) {
    const days = Math.floor((now.getTime() - scaricoDate.getTime()) / (1000 * 60 * 60 * 24))
    if (days < scaricoDays) return `🕐 Ultimo scarico: ${days}gg fa (min ${scaricoDays}gg)`
  }

  return null
}

export function filterDebugSuffix(stock: StoreStock, filterName: string, quantity: number): string {
  const qty = `${quantity} disp.`
  if (filterName === 'nofiltro') return qty

  const passes = storePassesFilter(stock, filterName)
  const label = passes ? 'pass' : 'not pass'

  const caricoDate = parseDate(stock.lastCarico)
  const scaricoDate = parseDate(stock.lastScarico)

  const bestDate = scaricoDate || caricoDate
  if (bestDate) {
    const d = String(bestDate.getDate()).padStart(2, '0')
    const m = String(bestDate.getMonth() + 1).padStart(2, '0')
    return `${qty}, ${d}/${m} ${label}`
  }

  return `${qty}, no date ${label}`
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

const KNOWN_BRANDS: { name: string; normalized: string }[] = [
  'Vaporart', 'Vaporice', 'Tnt', 'Suprem-e', 'Dea', 'Dreamods',
  'Elfliq', 'ElfBar', 'Eliquid France', 'Fruizee', 'Cyber Flavour',
  'Vaporesso', 'Geekvape', 'Voopoo', 'Aspire', 'Innokin', 'Justfog',
  'Kiwi', 'Samsung', 'SvapoNext', 'Super Flavor', 'Seven Wonders',
  'Royal Blend', 'Ripe Vapes', 'Reload Vape', 'King Liquid', 'Flavourart',
  'Blendfeel', 'Azhad', 'Tabaccheria', 'Tob', 'TommySmoke',
  'BARRIQUE LINE', 'Vaporice',
].map((name) => ({ name, normalized: normalize(name) }))

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenize(s: string): string[] {
  const raw = normalize(s)
    .split(/\s+/)
    .filter((t) => t.length >= 2)

  // Merge "10 ml" → "10ml", "60 ml" → "60ml" etc.
  const merged: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (i + 1 < raw.length && /^\d{2,3}$/.test(raw[i]) && raw[i + 1] === 'ml') {
      merged.push(raw[i] + 'ml')
      i++
    } else {
      merged.push(raw[i])
    }
  }

  return merged.map((t) => {
    if (t === '20ml' || t === '30ml' || t === '60ml') return 'vol_ml'
    return t
  })
}

function tokenWeight(token: string): number {
  // Molto basso: filler words che appaiono in quasi tutti i prodotti
  if (token === 'nicotina' || token === 'concentrato') return 0.3

  // Basso: mg/ml standalone (senza numero davanti)
  if (token === 'mg' || token === 'ml') return 0.5

  // Medio: aroma
  if (token === 'aroma') return 1.5

  // Medio-alto: dosi di nicotina con numero
  if (/^\d{1,2}mg$/.test(token)) {
    const n = parseInt(token, 10)
    if (n >= 0 && n <= 20) return 2.0
  }

  // Medio-alto: formati ml con numero
  if (/^\d{2,3}ml$/.test(token)) return 2.0

  // Medio-alto: volumi sinonimizzati (20/30/60ml)
  if (token === 'vol_ml') return 2.0

  // Medio: 10+10
  if (token === '10+10') return 1.5

  // Medio: termini descrittivi che appaiono in molti prodotti
  if (token === 'shot' || token === 'extra' || token === 'dry' || token === 'line' || token === 'mixture') return 1.5

  // Token di esattamente 2 caratteri: spesso codici interni, meno distintivi
  if (token.length === 2) return 1.5

  // Alto (default): parole distintive del prodotto
  return 3.0
}

function jaccardSimilarity(tokensA: string[], tokensB: string[]): { score: number; hasHighWeight: boolean } {
  if (tokensA.length === 0 && tokensB.length === 0) return { score: 0, hasHighWeight: false }

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)

  const allTokens = new Set([...setA, ...setB])

  let weightedIntersection = 0
  let weightedUnion = 0
  let hasHighWeight = false

  for (const t of allTokens) {
    const weight = tokenWeight(t)
    const inA = setA.has(t)
    const inB = setB.has(t)

    if (inA && inB) {
      weightedIntersection += weight
      weightedUnion += weight
      if (weight >= 3.0) hasHighWeight = true
    } else if (inA || inB) {
      weightedUnion += weight
    }
  }

  if (weightedUnion === 0) return { score: 0, hasHighWeight: false }
  return { score: weightedIntersection / weightedUnion, hasHighWeight }
}

function brandBoost(cartName: string, entry: InventoryEntry): number {
  if (!entry.category) return 0
  const catNorm = normalize(entry.category)
  for (const brand of KNOWN_BRANDS) {
    if (catNorm.includes(brand.normalized) && normalize(cartName).includes(brand.normalized)) {
      return 0.10
    }
  }
  return 0
}

function prefixBonus(cartName: string, entryName: string): number {
  const cartWords = normalize(cartName).split(/\s+/).filter((t) => t.length >= 2)
  const entryWords = normalize(entryName).split(/\s+/).filter((t) => t.length >= 2)

  let matchCount = 0
  const max = Math.min(cartWords.length, entryWords.length, 3)
  for (let i = 0; i < max; i++) {
    if (cartWords[i] === entryWords[i]) {
      matchCount++
    } else {
      break
    }
  }

  if (matchCount >= 3) return 0.03
  if (matchCount >= 2) return 0.02
  return 0
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
        const js = jaccardSimilarity(cartTokens, entryTokens)
        let tokenScore = js.score
        const hasHighWeight = js.hasHighWeight
        const substringScore = substringBonus(normalize(cartName), normalize(entry.product_name))

        // Check aliases: exact match on alias gives a high score
        const aliases = getAliases(entry)
        for (const alias of aliases) {
          if (normalize(alias) === normalize(cartName)) {
            tokenScore = Math.max(tokenScore, 0.95)
            break
          }
          const aliasTokens = tokenize(alias)
          const aliasJs = jaccardSimilarity(cartTokens, aliasTokens)
          if (aliasJs.score > 0.5) {
            tokenScore = Math.max(tokenScore, aliasJs.score * 0.9)
          }
        }

        let score = Math.max(tokenScore, substringScore * 0.85, tokenScore * 0.7 + substringScore * 0.3)
          + brandBoost(cartName, entry)
          + prefixBonus(cartName, entry.product_name)

        // Penalty: no high-weight token in common → mostly generic match
        if (!hasHighWeight) score *= 0.5

        return { entry, score, stocks: getStoreStocks(entry) }
      })
      .filter((m) => m.score >= adaptiveThreshold(cartTokens))
      .filter((m) => lcsRatio(cartTokens, tokenize(m.entry.product_name)) >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return { cartName, matches: scored }
  })
}

function adaptiveThreshold(tokens: string[]): number {
  if (tokens.length === 0) return 0.27
  const avgWeight = tokens.reduce((sum, t) => sum + tokenWeight(t), 0) / tokens.length
  return 0.27 + (3.0 - avgWeight) * 0.01
}

function lcsRatio(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  const m = tokensA.length
  const n = tokensB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (tokensA[i - 1] === tokensB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  const lcs = dp[m][n]
  return lcs / Math.min(m, n)
}

function substringBonus(a: string, b: string): number {
  if (!a || !b) return 0

  if (b.includes(a)) return 1.0
  if (a.includes(b)) return 0.95

  const tokensB = b.split(/\s+/)
  const tokensA = a.split(/\s+/)

  let matched = 0
  for (const ta of tokensA) {
    if (ta.length < 4) continue
    for (const tb of tokensB) {
      if (tb.length < 4) continue
      if (tb.includes(ta) || ta.includes(tb)) {
        matched++
        break
      }
    }
  }

  const max = Math.max(tokensA.filter((t) => t.length >= 4).length, tokensB.filter((t) => t.length >= 4).length)
  if (max === 0) return 0

  return matched / max
}
