export interface EasyfattRow {
  barcode: string
  name: string
  quantity: number
  category: string
}

interface ColumnMap {
  barcode: number
  name: number
  quantity: number
  category: number
}

function detectDelimiter(header: string): string {
  const semiCount = (header.match(/;/g) ?? []).length
  const commaCount = (header.match(/,/g) ?? []).length
  const tabCount = (header.match(/\t/g) ?? []).length

  if (tabCount > semiCount && tabCount > commaCount) return '\t'
  if (semiCount > commaCount) return ';'
  if (commaCount > 0) return ','
  return ';'
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

const HEADER_COLUMN_NAMES = new Map<string, string>([
  ['cod', 'barcode'],
  ['codice', 'barcode'],
  ['barcode', 'barcode'],
  ['ean', 'barcode'],
  ['descrizione', 'name'],
  ['desc', 'name'],
  ['prodotto', 'name'],
  ['nome', 'name'],
  ['articolo', 'name'],
  ['giacenza', 'quantity'],
  ['qtà', 'quantity'],
  ['q.tà', 'quantity'],
  ['quantità', 'quantity'],
  ['qta', 'quantity'],
  ['categoria', 'category'],
  ['cat', 'category'],
])

const CATEGORY_SEPARATOR_RE = /^-\s*;.*Categoria\s*:/i
const EMPTY_END_RE = /^;+$/

function detectColumns(headerFields: string[]): ColumnMap {
  const map: ColumnMap = { barcode: -1, name: -1, quantity: -1, category: -1 }

  for (let i = 0; i < headerFields.length; i++) {
    const cleaned = headerFields[i]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()

    if (!cleaned) continue

    for (const [keyword, field] of HEADER_COLUMN_NAMES) {
      if (cleaned.includes(keyword) && map[field as keyof ColumnMap] === -1) {
        map[field as keyof ColumnMap] = i
        break
      }
    }
  }

  return map
}

export function parseEasyfattCSV(raw: string): EasyfattRow[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((l) => l.trim() !== '')

  if (lines.length === 0) return []

  const delimiter = detectDelimiter(lines[0])
  const headerFields = parseCSVLine(lines[0], delimiter)
  const columns = detectColumns(headerFields)

  if (columns.name === -1) {
    throw new Error(
      'Colonna "Descrizione" non trovata. Verifica l\'intestazione del CSV e riprova.',
    )
  }

  if (columns.quantity === -1) {
    throw new Error(
      'Colonna "Giacenza" non trovata. Verifica l\'intestazione del CSV e riprova.',
    )
  }

  const rows: EasyfattRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]

    if (CATEGORY_SEPARATOR_RE.test(line)) continue
    if (EMPTY_END_RE.test(line.trim())) continue

    const fields = parseCSVLine(line, delimiter)

    if (fields.length <= Math.max(columns.name, columns.quantity)) continue

    const name = fields[columns.name]?.trim()
    if (!name || isCategoryHeader(name)) continue

    const quantityRaw = fields[columns.quantity]?.replace(/[^\d.-]/g, '').trim()
    const quantity = Number(quantityRaw)
    if (!Number.isFinite(quantity)) continue

    const barcode = columns.barcode >= 0 ? (fields[columns.barcode]?.trim() ?? '') : ''
    const category = columns.category >= 0 ? (fields[columns.category]?.trim() ?? '') : ''

    if (!category) continue

    rows.push({
      barcode,
      name: cleanName(name),
      quantity: Math.round(quantity),
      category,
    })
  }

  return rows
}

function isCategoryHeader(value: string): boolean {
  return /^Categoria\s*:/i.test(value) || /^-\s*;/.test(value)
}

function cleanName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
}
