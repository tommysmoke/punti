export interface CartItem {
  name: string
  raw: string
}

interface PriceLine {
  kind: 'price'
  original: number
  discounted: number | null
}

const PRICE_LINE_RE = /^(\d+[.,]\d{2})\s*€\s*(\d+[.,]\d{2})\s*€\s*$/m
const SINGLE_PRICE_RE = /^(\d+[.,]\d{2})\s*€\s*$/m
const OPTION_RE = /^(SCEGLI|ml:|OHM:|COLORE:|Opzione)/i
const NICOTINA_EXTRACT = /nicotina:\s*(\d+mg)/i
const ML_EXTRACT = /^ml:\s*(\d{2,3}ml)/i
const OHM_EXTRACT = /^ohm:\s*([\d.]+)\s*ohm/i
const QUANTITY_LINE_RE = /^\d+$/
const LINE_TOTAL_RE = /^\d+[.,]\d{2}\s*€\s*$/

function parseEuro(value: string): number {
  return Number.parseFloat(value.replace(',', '.'))
}

function isPricePair(line: string): PriceLine | null {
  const pairMatch = line.match(PRICE_LINE_RE)
  if (pairMatch) {
    return {
      kind: 'price',
      original: parseEuro(pairMatch[1]),
      discounted: parseEuro(pairMatch[2]),
    }
  }

  const lines = line.trim().split(/\s{2,}/)
  if (lines.length >= 2) {
    const a = lines[0].match(SINGLE_PRICE_RE)
    const b = lines[1].match(SINGLE_PRICE_RE)
    if (a && b) {
      return {
        kind: 'price',
        original: parseEuro(b[1]),
        discounted: parseEuro(a[1]),
      }
    }
  }

  const singleMatch = line.match(SINGLE_PRICE_RE)
  if (singleMatch) {
    return {
      kind: 'price',
      original: parseEuro(singleMatch[1]),
      discounted: null,
    }
  }

  return null
}

export function parseCart(raw: string): CartItem[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const items: CartItem[] = []
  let currentName: string | null = null
  let nameBuffer: string[] = []
  let pendingOptions: string[] = []
  let lastSeenPrice = false
  let lineAfterPrice = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    if (QUANTITY_LINE_RE.test(line)) {
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : ''
      const nextNext = i + 2 < lines.length ? lines[i + 2].trim() : ''
      const isRealQty =
        LINE_TOTAL_RE.test(nextLine) ||
        LINE_TOTAL_RE.test(nextNext) ||
        lines[i - 1]?.trim() === '' ||
        (i > 1 && isPricePair(lines[i - 1]?.trim() ?? '') !== null)

      if (isRealQty && currentName) {
        const options = pendingOptions.length > 0 ? ` ${pendingOptions.join(' ')}` : ''
        items.push({ name: currentName + options, raw: nameBuffer.join('\n') })
        currentName = null
        nameBuffer = []
        pendingOptions = []
        lastSeenPrice = false
        lineAfterPrice = false
      }
      continue
    }

    if (optionLike(line)) {
      const nicMatch = line.match(NICOTINA_EXTRACT)
      const mlMatch = line.match(ML_EXTRACT)
      const ohmMatch = line.match(OHM_EXTRACT)
      if (nicMatch) pendingOptions.push(nicMatch[1])
      if (mlMatch) pendingOptions.push(mlMatch[1])
      if (ohmMatch) pendingOptions.push(`${ohmMatch[1]}ohm`)
      lastSeenPrice = false
      lineAfterPrice = false
      continue
    }

    if (LINE_TOTAL_RE.test(line)) {
      lastSeenPrice = false
      lineAfterPrice = false
      continue
    }

    const priceResult = isPricePair(line)
    if (priceResult) {
      lastSeenPrice = true
      lineAfterPrice = false
      continue
    }

    if (TAX_LINE_RE.test(line)) {
      continue
    }

    if (line.startsWith('(') && line.endsWith(')')) {
      continue
    }

    // If we just saw a price line, this is NOT a product name
    if (lastSeenPrice && !lineAfterPrice) {
      lineAfterPrice = true
      continue
    }

    if (lastSeenPrice && lineAfterPrice) {
      lastSeenPrice = false
      lineAfterPrice = false
      continue
    }

    // This is likely a product name line
    if (!currentName) {
      currentName = cleanName(line)
      nameBuffer = [line]
    } else {
      // Consecutive name lines - append
      if (
        !isPricePair(line) &&
        !PRICE_LINE_RE.test(line) &&
        !LINE_TOTAL_RE.test(line) &&
        !QUANTITY_LINE_RE.test(line) &&
        !optionLike(line)
      ) {
        currentName = cleanName(line)
        nameBuffer.push(line)
      }
    }
  }

  // Flush last item if exists
  if (currentName) {
    const options = pendingOptions.length > 0 ? ` ${pendingOptions.join(' ')}` : ''
    items.push({ name: currentName + options, raw: nameBuffer.join('\n') })
  }

  return deduplicate(items)
}

const TAX_LINE_RE = /escl\.\s*imp|escl\.\s*iva|imposta\s+di\s+consumo/i

function optionLike(line: string): boolean {
  return OPTION_RE.test(line)
}

function cleanName(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
}

function deduplicate(items: CartItem[]): CartItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
