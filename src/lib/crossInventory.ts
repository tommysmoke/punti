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

export interface DuplicateGroup {
  barcode: string
  rows: InventoryEntry[]
}

const STORE_SUFFIXES = ['quarto', 'castenaso', 'bologna', 'san_lazzaro']

export function findDuplicates(inventory: InventoryEntry[]): DuplicateGroup[] {
  const byBarcode = new Map<string, InventoryEntry[]>()
  for (const entry of inventory) {
    if (!entry.barcode) continue
    const group = byBarcode.get(entry.barcode)
    if (group) {
      group.push(entry)
    } else {
      byBarcode.set(entry.barcode, [entry])
    }
  }
  const dupes: DuplicateGroup[] = []
  for (const [barcode, rows] of byBarcode) {
    if (rows.length > 1) {
      dupes.push({ barcode, rows })
    }
  }
  return dupes
}

function countAliases(entry: InventoryEntry): number {
  return ALIAS_COLUMNS.filter((col) => {
    const v = entry[col]
    return typeof v === 'string' && v.trim() !== ''
  }).length
}

function hasDates(entry: InventoryEntry): boolean {
  for (const suffix of STORE_SUFFIXES) {
    const caricoCol = `last_carico_${suffix}` as keyof InventoryEntry
    const scaricoCol = `last_scarico_${suffix}` as keyof InventoryEntry
    if (entry[caricoCol] || entry[scaricoCol]) return true
  }
  return false
}

function hasQuantity(entry: InventoryEntry): boolean {
  for (const suffix of STORE_SUFFIXES) {
    const qtyCol = `quantity_${suffix}` as keyof InventoryEntry
    if ((entry[qtyCol] as number) > 0) return true
  }
  return false
}

function infoScore(entry: InventoryEntry): number {
  let score = 0
  score += countAliases(entry) * 2
  if (entry.category) score += 1
  if (hasDates(entry)) score += 2
  if (hasQuantity(entry)) score += 1
  if (entry.barcode) score += 1
  return score
}

interface MergePayload {
  keepId: number
  removeIds: number[]
  updateFields: Record<string, string | number | null>
  lostNames: string[]
}

function totalQuantity(entry: InventoryEntry): number {
  let sum = 0
  for (const suffix of STORE_SUFFIXES) {
    const qtyCol = `quantity_${suffix}` as keyof InventoryEntry
    sum += (entry[qtyCol] as number) || 0
  }
  return sum
}

export function computeMerge(rows: InventoryEntry[]): MergePayload {
  const sorted = [...rows].sort((a, b) => {
    const scoreDiff = infoScore(b) - infoScore(a)
    if (scoreDiff !== 0) return scoreDiff
    return totalQuantity(b) - totalQuantity(a)
  })
  const keep = sorted[0]
  const toRemove = sorted.slice(1)

  const updateFields: Record<string, string | number | null> = {}
  const lostNames: string[] = []

  for (const suffix of STORE_SUFFIXES) {
    const qtyCol = `quantity_${suffix}` as keyof InventoryEntry
    const caricoCol = `last_carico_${suffix}` as keyof InventoryEntry
    const scaricoCol = `last_scarico_${suffix}` as keyof InventoryEntry

    let totalQty = (keep[qtyCol] as number) || 0
    let bestCarico: string | null = keep[caricoCol] as string | null
    let bestCaricoDate = parseDate(bestCarico)
    let bestScarico: string | null = keep[scaricoCol] as string | null
    let bestScaricoDate = parseDate(bestScarico)

    for (const r of toRemove) {
      totalQty += (r[qtyCol] as number) || 0
      const rCaricoDate = parseDate(r[caricoCol] as string | null)
      if (rCaricoDate && (!bestCaricoDate || rCaricoDate > bestCaricoDate)) {
        bestCarico = r[caricoCol] as string | null
        bestCaricoDate = rCaricoDate
      }
      const rScaricoDate = parseDate(r[scaricoCol] as string | null)
      if (rScaricoDate && (!bestScaricoDate || rScaricoDate > bestScaricoDate)) {
        bestScarico = r[scaricoCol] as string | null
        bestScaricoDate = rScaricoDate
      }
    }

    updateFields[qtyCol] = totalQty
    if (bestCarico) updateFields[caricoCol] = bestCarico
    if (bestScarico) updateFields[scaricoCol] = bestScarico
  }

  for (const r of toRemove) {
    const namesDiffer = r.product_name.toLowerCase().trim() !== keep.product_name.toLowerCase().trim()
    if (!namesDiffer) continue
    const alreadyAdded = lostNames.some((n) => n.toLowerCase().trim() === r.product_name.toLowerCase().trim())
    if (alreadyAdded) continue
    const emptyAliasCol = findEmptyAliasColumn(keep)
    if (!emptyAliasCol) break
    updateFields[emptyAliasCol] = r.product_name
    lostNames.push(r.product_name)
  }

  return {
    keepId: keep.id,
    removeIds: toRemove.map((r) => r.id),
    updateFields,
    lostNames,
  }
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
const FILTER2_IDLE_DAYS = 120

export function parseDate(d: string | null): Date | null {
  if (!d) return null

  const raw = d.trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const y = Number(isoMatch[1])
    const m = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && day >= 1 && day <= 31) {
      const date = new Date(y, m - 1, day)
      if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === day) {
        return date
      }
    }
  }

  const parts = raw.split(/[\/\.\-\s]+/)
  if (parts.length >= 3) {
    const a = Number(parts[0])
    const b = Number(parts[1])
    const c = Number(parts[2])

    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null

    if (a > 31 && b >= 1 && b <= 12 && c >= 1 && c <= 31) {
      const date = new Date(a, b - 1, c)
      if (date.getFullYear() === a) return date
    }

    if (a === 2 && b >= 1 && b <= 12 && c >= 1000) {
      return null
    }

    if (c >= 1000 && c <= 2100 && a >= 1 && a <= 31 && b >= 1 && b <= 12) {
      const date = new Date(c, b - 1, a)
      if (date.getFullYear() === c) return date
    }

    return null
  }

  return null
}

export function getFilterDays(): { scaricoDays: number; caricoDays: number } {
  const now = new Date()
  const daysSinceStart = Math.floor((now.getTime() - FILTER_START.getTime()) / (1000 * 60 * 60 * 24))
  return {
    scaricoDays: Math.min(7 + daysSinceStart, MAX_SCARICO_DAYS),
    caricoDays: Math.min(14 + daysSinceStart, MAX_CARICO_DAYS),
  }
}

export function storePassesFilter(stock: StoreStock, filterName: string, requestedQty?: number): boolean {
  if (filterName === 'nofiltro') return true
  const now = new Date()
  const { scaricoDays, caricoDays } = getFilterDays()

  const caricoDate = parseDate(stock.lastCarico)
  const caricoRecent = caricoDate
    ? Math.floor((now.getTime() - caricoDate.getTime()) / (1000 * 60 * 60 * 24)) < caricoDays
    : false

  const scaricoDate = parseDate(stock.lastScarico)
  const scaricoRecent = scaricoDate
    ? Math.floor((now.getTime() - scaricoDate.getTime()) / (1000 * 60 * 60 * 24)) < scaricoDays
    : false

  if (caricoRecent) return false

  if (scaricoRecent && !caricoRecent) {
    if (stock.quantity >= 4) return true
    if (requestedQty !== undefined && requestedQty >= 3 && stock.quantity >= requestedQty * 2) return true
    return false
  }

  return true
}

export function isProductAbsentFromStore(entry: InventoryEntry, storeKey: string): boolean {
  const col = STORE_COLUMNS.find(
    (s) => s.store === storeKey || s.label.toLowerCase() === storeKey.toLowerCase(),
  )
  if (!col) return true

  const caricoDate = parseDate(entry[col.caricoCol] as string | null)
  const scaricoDate = parseDate(entry[col.scaricoCol] as string | null)

  if (!caricoDate && !scaricoDate) return true

  const now = new Date()
  const cutoff = new Date(now.getTime() - FILTER2_IDLE_DAYS * 24 * 60 * 60 * 1000)

  if (caricoDate && caricoDate >= cutoff) return false
  if (scaricoDate && scaricoDate >= cutoff) return false

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
    if (days < scaricoDays && !caricoDate) return `🕐 Ultimo scarico: ${days}gg fa (min ${scaricoDays}gg)`
    if (days < scaricoDays && caricoDate && (Math.floor((now.getTime() - caricoDate.getTime()) / (1000 * 60 * 60 * 24)) >= caricoDays)) {
      if (stock.quantity < 4) return `🕐 Giacenza bassa per smaltimento (${stock.quantity} disp.)`
    }
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
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\b(\d+)\.(\d+)\b/g, '$1.$2')
    .trim()
}

function tokenize(s: string): string[] {
  const raw = normalize(s)
    .split(/\s+/)
    .filter((t) => t.length >= 1)

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
    t = t.replace(/^(\d+)\.0(mg|ohm)$/i, '$1$2')
    return t
  })
}

function tokenWeight(token: string): number {
  if (token === 'nicotina' || token === 'concentrato') return 0.3

  if (token === 'mg' || token === 'ml') return 0.5

  if (token === 'aroma') return 1.5

  if (/^\d{1,2}mg$/.test(token)) {
    const n = parseInt(token, 10)
    if (n >= 0 && n <= 20) return 2.0
  }

  if (/^\d{2,3}ml$/.test(token)) return 2.0

  if (token === 'vol_ml') return 2.0

  if (token === '10+10') return 1.5

  if (/^\d{1,2}[,.]?\d*ohm$/i.test(token)) return 3.0

  if (token === 'shot' || token === 'extra' || token === 'dry' || token === 'line' || token === 'mixture') return 1.5

  if (token.length === 1) return 1.5

  if (/^[a-z]\d+$/i.test(token)) return 2.0

  if (token.length === 2) return 1.5

  if (/^(di|da|su|in|con|per|tra|fra|del|dal|nel|col|sul|al|il|lo|la|i|gli|le|un|una|pezzi|ricambio|pz|pezzo|kit|mod|pod)$/i.test(token)) return 0.3

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

function extractOhm(s: string): string | null {
  const m = s.match(/(\d{1,2}[,.]?\d*)\s*ohm/i)
  return m ? m[1].replace(',', '.') : null
}

function ohmBonus(cartName: string, entryName: string): number {
  const cartOhm = extractOhm(cartName)
  const entryOhm = extractOhm(entryName)
  if (!cartOhm) return 0
  if (!entryOhm) return -0.04
  if (cartOhm !== entryOhm) return -0.04
  return 0.05
}

const COLOR_SUFFIX_RE = /design\s*(\S+(?:\s+\S+)?)\s*$/i

function colorBonus(cartName: string, entryName: string): number {
  const m = cartName.match(COLOR_SUFFIX_RE)
  if (!m) return 0
  const colorWords = normalize(m[1]).split(/\s+/).filter(Boolean)
  if (colorWords.length === 0) return 0
  const entryNorm = normalize(entryName)
  const allMatch = colorWords.every((w) => entryNorm.includes(w))
  return allMatch ? 0.06 : 0
}

function categoryBoost(cartName: string, entry: InventoryEntry): number {
  if (!entry.category) return 0
  const catNorm = normalize(entry.category)
  const cartNorm = normalize(cartName)
  if (/\bmah\b/i.test(cartNorm) && /\bhardware\b/i.test(catNorm)) return 0.03
  if (/\bohm\b/i.test(cartNorm) && /\b(hardware|accessori)\b/i.test(catNorm)) return 0.03
  return 0
}

function coverageBonus(cartTokens: Set<string>, entryTokens: string[]): number {
  if (entryTokens.length === 0) return 0
  const covered = entryTokens.filter((t) => cartTokens.has(t)).length
  return covered / entryTokens.length >= 0.8 ? 0.02 : 0
}

function missingDistinctivePenalty(cartTokens: string[], entryTokens: Set<string>): number {
  const distinctive = cartTokens.filter((t) => t.length === 1 || /^\d{1,2}[,.]?\d*ohm$/i.test(t))
  if (distinctive.length === 0) return 0
  const missing = distinctive.filter((t) => !entryTokens.has(t)).length
  return missing > 0 ? -0.02 : 0
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
    const cartNorm = normalize(cartName)

    const exactAliasMatches: { entry: InventoryEntry; score: number; stocks: StoreStock[] }[] = []
    for (const entry of validInventory) {
      const aliases = getAliases(entry)
      for (const alias of aliases) {
        if (normalize(alias) === cartNorm) {
          exactAliasMatches.push({ entry, score: 1.0, stocks: getStoreStocks(entry) })
          break
        }
      }
    }

    const scored = validInventory
      .filter((entry) => !exactAliasMatches.some((m) => m.entry.id === entry.id))
      .map((entry) => {
        const entryTokens = tokenize(entry.product_name)
        const js = jaccardSimilarity(cartTokens, entryTokens)
        let tokenScore = js.score
        const hasHighWeight = js.hasHighWeight
        const substringScore = substringBonus(cartNorm, normalize(entry.product_name))

        const aliases = getAliases(entry)
        for (const alias of aliases) {
          if (normalize(alias) === cartNorm) {
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
          + ohmBonus(cartName, entry.product_name)
          + colorBonus(cartName, entry.product_name)
          + categoryBoost(cartName, entry)
          + coverageBonus(new Set(cartTokens), entryTokens)
          + missingDistinctivePenalty(cartTokens, new Set(entryTokens))

        if (!hasHighWeight) score *= 0.5

        return { entry, score, stocks: getStoreStocks(entry) }
      })
      .filter((m) => m.score >= adaptiveThreshold(cartTokens))
      .filter((m) => lcsRatio(cartTokens, tokenize(m.entry.product_name)) >= 0.25)

    const allMatches = [...exactAliasMatches, ...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return { cartName, matches: allMatches }
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
  if (a.includes(b)) return 0.95 * Math.min(b.length / a.length, 1.0)

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
