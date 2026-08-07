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
const OPTION_RE = /^(SCEGLI|ml:|OHM:|COLORE:|Opzione|Nic\s*\(|Nicotina:|Millilitri:)/i
const NICOTINA_EXTRACT = /nicotina:\s*([\d.]+)/i
const NIC2_EXTRACT = /nic\s*\(mg\/ml\)\s*([\d,.]+)/i
const ML_EXTRACT = /^ml:\s*(\d{2,3})ml/i
const ML2_EXTRACT = /millilitri:\s*(\d{2,3})/i
const OHM_EXTRACT = /^ohm:\s*(.+)$/i
const COLOR_EXTRACT = /colore:\s*(.+)/i
const QUANTITY_LINE_RE = /^\d+$/
const PERCENT_RE = /^\d{1,3}%$/
const LINE_TOTAL_RE = /^\d+[.,]\d{2}\s*€/

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

  const parts = line.trim().split(/\s{2,}/)
  for (const part of parts) {
    const m = part.match(SINGLE_PRICE_RE)
    if (m) {
      return { kind: 'price', original: parseEuro(m[1]), discounted: null }
    }
  }

  return null
}

export function parseCart(raw: string): CartItem[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '  ')
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

    if (UI_NOISE_RE.test(line)) continue

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
      const nic2Match = line.match(NIC2_EXTRACT)
      const mlMatch = line.match(ML_EXTRACT)
      const ml2Match = line.match(ML2_EXTRACT)
      const ohmMatch = line.match(OHM_EXTRACT)
      const colorMatch = line.match(COLOR_EXTRACT)
      const isAroma = /aroma|concentrato|shot|mix\s*&\s*vape|mix\s*10\+10/i.test(currentName ?? '')
      if (nicMatch && !isAroma) pendingOptions.push(`${nicMatch[1]}mg`)
      if (nic2Match && !isAroma) pendingOptions.push(`${nic2Match[1]}mg`)
      if (mlMatch) pendingOptions.push(mlMatch[1])
      if (ml2Match) pendingOptions.push(`${ml2Match[1]}ml`)
      if (ohmMatch) {
        const val = ohmMatch[1].replace(/\s*ohm\b/gi, '').trim()
        pendingOptions.push(`${val}ohm`)
      }
      if (colorMatch) pendingOptions.push(colorMatch[1].trim())
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

    if (PERCENT_RE.test(line)) {
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
      if (optionLike(line)) {
        const nicMatch2 = line.match(NICOTINA_EXTRACT)
        const nic2Match2 = line.match(NIC2_EXTRACT)
        const mlMatch2 = line.match(ML_EXTRACT)
        const ml2Match2 = line.match(ML2_EXTRACT)
        const ohmMatch2 = line.match(OHM_EXTRACT)
        const colorMatch2 = line.match(COLOR_EXTRACT)
        const isAroma2 = /aroma|concentrato|shot|mix\s*&\s*vape|mix\s*10\+10/i.test(currentName ?? '')
        if (nicMatch2 && !isAroma2) pendingOptions.push(`${nicMatch2[1]}mg`)
        if (nic2Match2 && !isAroma2) pendingOptions.push(`${nic2Match2[1]}mg`)
        if (mlMatch2) pendingOptions.push(mlMatch2[1])
        if (ml2Match2) pendingOptions.push(`${ml2Match2[1]}ml`)
        if (ohmMatch2) {
          const val2 = ohmMatch2[1].replace(/\s*ohm\b/gi, '').trim()
          pendingOptions.push(`${val2}ohm`)
        }
        if (colorMatch2) pendingOptions.push(colorMatch2[1].trim())
      }
      continue
    }

    // This is likely a product name line
    if (!currentName) {
      currentName = cleanName(line)
      nameBuffer = [line]
    } else if (line.length <= 50 && line.split(/\s+/).length <= 3) {
      pendingOptions.push(line)
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
const UI_NOISE_RE = /^(Modifica|Rimuovi\s|Continua\s|Aggiorna\s|Ci sono\s|Il tuo carrello|Carrello$|Totale|Subtotale|IVA|Spedizione|Sconto|Coupon|Codice\s|Buono|Pagamento|Checkout|Guadagna)/i

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
