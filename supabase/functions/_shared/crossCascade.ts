export interface CrossRequestItem {
  name: string
  quantity: number
  barcode: string | null
  visibleQuantities?: Record<string, number>
  error?: string
}

export interface CrossRequestResult {
  store: string
  items: CrossRequestItem[]
  status?: 'confirmed' | 'empty' | 'timeout'
}

export interface CrossRequestStepState {
  ranking: string[] | null
  current_index: number
  timer_started: string
  remaining: CrossRequestItem[] | null
  confirmed: CrossRequestResult[] | null
}

export interface CrossRequestStepPlan {
  event: 'waiting' | 'complete' | 'timeout' | 'response'
  currentStore: string | null
  confirmed: CrossRequestResult[]
  remaining: CrossRequestItem[]
}

export function getCrossRequestItemsForStore(items: CrossRequestItem[], store: string): CrossRequestItem[] {
  return items.flatMap((item) => {
    if (item.error) return []
    if (!item.visibleQuantities) return [{ ...item }]

    const visibleQuantity = item.visibleQuantities[store] ?? 0
    if (visibleQuantity <= 0) return []

    return [{ ...item, quantity: Math.min(item.quantity, visibleQuantity) }]
  })
}

export function buildCrossRequestBody(items: CrossRequestItem[], heading: string, store?: string): string {
  const visibleItems = store ? getCrossRequestItemsForStore(items, store) : items
  const lines = visibleItems.map((item) => `${item.quantity} ${item.name}${item.barcode ? ` (${item.barcode})` : ''}`)
  return `${heading}:\n${lines.join('\n')}`
}

const MAX_BODY_LENGTH = 50_000
const MAX_LINE_LENGTH = 1_000

// Parsing lineare: i corpi arrivano da altri client e non devono poter bloccare il worker.
export function parseCrossRequestBody(body: string): CrossRequestItem[] {
  const items: CrossRequestItem[] = []
  // Oltre il limite si leggono solo le righe complete: una riga troncata darebbe un articolo falso.
  const text = body.length > MAX_BODY_LENGTH ? body.slice(0, Math.max(body.lastIndexOf('\n', MAX_BODY_LENGTH), 0)) : body

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.length > MAX_LINE_LENGTH) continue

    const match = /^(\d+)\s+(\S.*)$/.exec(line)
    if (!match) continue

    const quantity = Number.parseInt(match[1], 10)
    if (!Number.isSafeInteger(quantity) || quantity < 1) continue

    let name = match[2]
    let barcode: string | null = null
    if (name.endsWith(')')) {
      const open = name.lastIndexOf('(')
      const candidate = open > 0 ? name.slice(open + 1, -1).trim() : ''
      if (candidate && !/[\s()]/.test(candidate)) {
        barcode = candidate
        name = name.slice(0, open).trim()
      }
    }

    items.push({ quantity, name, barcode })
  }

  return items
}

function findRequestedItemIndex(requested: CrossRequestItem[], responseItem: CrossRequestItem): number {
  const matchers: ((item: CrossRequestItem) => boolean)[] = [
    (item) => responseItem.barcode !== null && item.barcode === responseItem.barcode,
    (item) => item.name === responseItem.name && (!item.barcode || responseItem.barcode === null),
    (item) => item.name === responseItem.name,
    // Nomi che terminano con "(...)" e senza barcode vengono riletti come nome + barcode.
    (item) => !item.barcode && responseItem.barcode !== null
      && item.name === `${responseItem.name} (${responseItem.barcode})`,
  ]

  for (const matches of matchers) {
    const index = requested.findIndex(matches)
    if (index >= 0) return index
  }
  return -1
}

export function applyCrossRequestResponse(
  requested: CrossRequestItem[],
  responseBody: string,
): { remaining: CrossRequestItem[]; confirmed: CrossRequestItem[] } {
  const remaining = requested.map((item) => ({ ...item }))
  const confirmed: CrossRequestItem[] = []

  for (const responseItem of parseCrossRequestBody(responseBody)) {
    const remainingIndex = findRequestedItemIndex(remaining, responseItem)
    if (remainingIndex < 0) continue

    const acceptedQuantity = Math.min(responseItem.quantity, remaining[remainingIndex].quantity)
    if (acceptedQuantity <= 0) continue

    confirmed.push({
      name: responseItem.name,
      quantity: acceptedQuantity,
      barcode: responseItem.barcode,
    })
    remaining[remainingIndex].quantity -= acceptedQuantity
    if (remaining[remainingIndex].quantity <= 0) remaining.splice(remainingIndex, 1)
  }

  return { remaining, confirmed }
}

export function buildCrossRequestAggregateBody(
  confirmed: CrossRequestResult[],
  unconfirmed: CrossRequestItem[],
): string {
  const sections: string[] = []

  for (const result of confirmed) {
    if (result.status === 'timeout') {
      sections.push(`${result.store}: non ha risposto in tempo`)
    } else if (result.status === 'empty') {
      sections.push(`${result.store}: non invia nulla`)
    } else if (result.items.length > 0) {
      sections.push(`Ricevuto da ${result.store}:`)
      for (const item of result.items) {
        sections.push(`${item.quantity} ${item.name}${item.barcode ? ` (${item.barcode})` : ''}`)
      }
    } else {
      continue
    }
    sections.push('')
  }

  const unresolved = unconfirmed.filter((item) => !item.error)
  const invalid = unconfirmed.filter((item) => item.error)

  if (unresolved.length > 0) {
    sections.push('NON CONFERMATI:')
    for (const item of unresolved) {
      sections.push(`${item.quantity} ${item.name}${item.barcode ? ` (${item.barcode})` : ''}`)
    }
  }

  if (invalid.length > 0) {
    if (sections.length > 0) sections.push('')
    sections.push('NON ELABORATI:')
    for (const item of invalid) {
      sections.push(`${item.quantity} ${item.name}${item.barcode ? ` (${item.barcode})` : ''}: ${item.error}`)
    }
  }

  return sections.join('\n')
}

export function crossRequestTimeoutMs(storeName: string): number {
  return storeName === 'Bologna' ? 35 * 60 * 1000 : 65 * 60 * 1000
}

export interface CrossResponseCandidate {
  id: number
  title: string
  body: string
  created_at: string
  response_to_request_id: number | null
}

// Prima risposta collegata alla notifica corrente; il titolo vale solo per risposte senza collegamento.
export function pickCrossResponse(
  currentNotificationId: number | null,
  currentStore: string,
  rows: CrossResponseCandidate[],
): CrossResponseCandidate | null {
  const linked = currentNotificationId === null
    ? []
    : rows.filter((row) => row.response_to_request_id === currentNotificationId)
  const pool = linked.length > 0
    ? linked
    : rows.filter((row) => row.response_to_request_id === null && row.title === `Risposta da ${currentStore}`)

  let first: CrossResponseCandidate | null = null
  for (const row of pool) {
    if (first === null) {
      first = row
      continue
    }
    const rowMs = Date.parse(row.created_at)
    const firstMs = Date.parse(first.created_at)
    if (rowMs < firstMs || (rowMs === firstMs && row.id < first.id)) first = row
  }
  return first
}

// respondedAtMs: istante della risposta; una risposta inviata entro la scadenza resta valida anche se elaborata dopo.
export function planCrossRequestStep(
  state: CrossRequestStepState,
  responseBody: string | null,
  nowMs: number,
  respondedAtMs?: number,
): CrossRequestStepPlan {
  const currentStore = state.ranking?.[state.current_index] ?? null
  const remaining = (state.remaining ?? []).map((item) => ({ ...item }))
  const confirmed = [...(state.confirmed ?? [])]

  if (!currentStore) return { event: 'complete', currentStore: null, confirmed, remaining }

  const timerStartedAt = new Date(state.timer_started).getTime()
  if (!Number.isFinite(timerStartedAt)) throw new Error('timer_started non valido')

  const deadlineMs = timerStartedAt + crossRequestTimeoutMs(currentStore)
  const answeredAtMs = respondedAtMs !== undefined && Number.isFinite(respondedAtMs) ? respondedAtMs : nowMs
  const answeredInTime = responseBody !== null && answeredAtMs <= deadlineMs

  if (!answeredInTime) {
    if (nowMs <= deadlineMs) return { event: 'waiting', currentStore, confirmed, remaining }
    return {
      event: 'timeout',
      currentStore,
      confirmed: [...confirmed, { store: currentStore, items: [], status: 'timeout' }],
      remaining,
    }
  }

  const response = applyCrossRequestResponse(remaining, responseBody)
  return {
    event: 'response',
    currentStore,
    confirmed: [
      ...confirmed,
      {
        store: currentStore,
        items: response.confirmed,
        status: response.confirmed.length === 0 ? 'empty' : 'confirmed',
      },
    ],
    remaining: response.remaining,
  }
}