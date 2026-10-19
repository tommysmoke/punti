// GENERATO da scripts/build-dashboard-function.mjs (npm run build:dashboard-function): non modificare a mano.
// @ts-ignore - Deno types are supplied by Supabase when deployed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.6'

interface CrossRequestItem {
  name: string
  quantity: number
  barcode: string | null
  visibleQuantities?: Record<string, number>
  error?: string
}

interface CrossRequestResult {
  store: string
  items: CrossRequestItem[]
  status?: 'confirmed' | 'empty' | 'timeout'
}

interface CrossRequestStepState {
  ranking: string[] | null
  current_index: number
  timer_started: string
  remaining: CrossRequestItem[] | null
  confirmed: CrossRequestResult[] | null
}

interface CrossRequestStepPlan {
  event: 'waiting' | 'complete' | 'timeout' | 'response'
  currentStore: string | null
  confirmed: CrossRequestResult[]
  remaining: CrossRequestItem[]
}

function getCrossRequestItemsForStore(items: CrossRequestItem[], store: string): CrossRequestItem[] {
  return items.flatMap((item) => {
    if (item.error) return []
    if (!item.visibleQuantities) return [{ ...item }]

    const visibleQuantity = item.visibleQuantities[store] ?? 0
    if (visibleQuantity <= 0) return []

    return [{ ...item, quantity: Math.min(item.quantity, visibleQuantity) }]
  })
}

function buildCrossRequestBody(items: CrossRequestItem[], heading: string, store?: string): string {
  const visibleItems = store ? getCrossRequestItemsForStore(items, store) : items
  const lines = visibleItems.map((item) => `${item.quantity} ${item.name}${item.barcode ? ` (${item.barcode})` : ''}`)
  return `${heading}:\n${lines.join('\n')}`
}

const MAX_BODY_LENGTH = 50_000
const MAX_LINE_LENGTH = 1_000

// Parsing lineare: i corpi arrivano da altri client e non devono poter bloccare il worker.
function parseCrossRequestBody(body: string): CrossRequestItem[] {
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

function applyCrossRequestResponse(
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

function buildCrossRequestAggregateBody(
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

function crossRequestTimeoutMs(storeName: string): number {
  return storeName === 'Bologna' ? 35 * 60 * 1000 : 65 * 60 * 1000
}

interface CrossResponseCandidate {
  id: number
  title: string
  body: string
  created_at: string
  response_to_request_id: number | null
}

// Prima risposta collegata alla notifica corrente; il titolo vale solo per risposte senza collegamento.
function pickCrossResponse(
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
function planCrossRequestStep(
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

interface ActiveCrossRequest {
  id: number
  requesting_store: string
  requesting_store_id: string
  created_by: string
  remaining: CrossRequestItem[]
  confirmed: CrossRequestResult[] | null
  ranking: string[]
  current_index: number
  timer_started: string
  status: string
  aggregate_notification_id: number | null
  current_request_notification_id: number | null
}

function constantTimeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  if (leftBytes.length !== rightBytes.length) return false

  let difference = 0
  for (let index = 0; index < leftBytes.length; index++) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
}

async function findResponse(
  client: ReturnType<typeof createClient>,
  request: ActiveCrossRequest,
  currentStore: string,
): Promise<CrossResponseCandidate | null> {
  const { data, error } = await client
    .from('store_notifications')
    .select('id, title, body, created_at, response_to_request_id')
    .eq('kind', 'cross_request')
    .eq('target_store', request.requesting_store)
    .gte('created_at', request.timer_started)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) throw error
  return pickCrossResponse(request.current_request_notification_id, currentStore, (data ?? []) as CrossResponseCandidate[])
}

async function transitionRequest(
  client: ReturnType<typeof createClient>,
  request: ActiveCrossRequest,
  event: 'response' | 'timeout' | 'complete' | 'skip',
  confirmed: CrossRequestResult[],
  remaining: CrossRequestItem[],
  nextRequestBody: string | null,
): Promise<boolean> {
  const aggregateBody = buildCrossRequestAggregateBody(confirmed, remaining)
  const { data, error } = await client.rpc('transition_cross_request_server', {
    p_request_id: request.id,
    p_expected_current_index: request.current_index,
    p_expected_notification_id: request.current_request_notification_id,
    p_event: event,
    p_confirmed: confirmed,
    p_remaining: remaining,
    p_aggregate_body: aggregateBody,
    p_next_request_body: nextRequestBody,
  })

  if (error) throw error
  return data === true
}

async function processRequest(client: ReturnType<typeof createClient>, request: ActiveCrossRequest): Promise<boolean> {
  const now = Date.now()
  const currentStore = request.ranking?.[request.current_index] ?? null
  if (!currentStore) return transitionRequest(client, request, 'complete', request.confirmed ?? [], request.remaining ?? [], null)

  const visibleItems = getCrossRequestItemsForStore(request.remaining ?? [], currentStore)
  if (visibleItems.length === 0) {
    const nextStore = request.ranking?.[request.current_index + 1] ?? null
    const nextItems = nextStore ? getCrossRequestItemsForStore(request.remaining ?? [], nextStore) : []
    const nextRequestBody = nextStore && nextItems.length > 0
      ? buildCrossRequestBody(request.remaining ?? [], 'Chiede', nextStore)
      : null
    return transitionRequest(client, request, 'skip', request.confirmed ?? [], request.remaining ?? [], nextRequestBody)
  }

  const response = await findResponse(client, request, currentStore)
  const plan = planCrossRequestStep(request, response?.body ?? null, now, response ? Date.parse(response.created_at) : undefined)
  if (plan.event === 'waiting') return false

  const nextStore = request.ranking?.[request.current_index + 1] ?? null
  const nextItems = nextStore ? getCrossRequestItemsForStore(plan.remaining, nextStore) : []
  const nextRequestBody = nextStore && nextItems.length > 0
    ? buildCrossRequestBody(plan.remaining, 'Chiede', nextStore)
    : null
  return transitionRequest(client, request, plan.event, plan.confirmed, plan.remaining, nextRequestBody)
}

async function recordRequestError(client: ReturnType<typeof createClient>, requestId: number, cause: unknown): Promise<void> {
  try {
    const message = cause instanceof Error ? cause.message : JSON.stringify(cause)
    const { error } = await client.rpc('record_cross_request_error', { p_request_id: requestId, p_error: message })
    if (error) console.error(`Registrazione errore richiesta ${requestId} fallita`, error)
  } catch (recordError) {
    console.error(`Registrazione errore richiesta ${requestId} fallita`, recordError)
  }
}

// @ts-ignore - Deno global is provided by the Supabase Edge Runtime.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // @ts-ignore - Deno global is provided by the Supabase Edge Runtime.
  const expectedSecret = Deno.env.get('CROSS_CASCADE_CRON_SECRET')
  const suppliedSecret = request.headers.get('x-cron-secret') ?? ''
  if (!expectedSecret || !constantTimeEquals(suppliedSecret, expectedSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // @ts-ignore - Deno global is provided by the Supabase Edge Runtime.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // @ts-ignore - Deno global is provided by the Supabase Edge Runtime.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Supabase Edge Function environment is incomplete')
    return new Response('Server configuration error', { status: 500 })
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let processed = 0
  let failed = 0
  let lastId = 0

  try {
    while (true) {
      const { data, error } = await client
        .from('active_cross_requests')
        .select('id, requesting_store, requesting_store_id, created_by, remaining, confirmed, ranking, current_index, timer_started, status, aggregate_notification_id, current_request_notification_id')
        .eq('status', 'active')
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(100)

      if (error) throw error
      const batch = (data ?? []) as ActiveCrossRequest[]
      if (batch.length === 0) break

      for (const activeRequest of batch) {
        lastId = activeRequest.id
        try {
          if (await processRequest(client, activeRequest)) processed++
        } catch (error) {
          failed++
          console.error(`Cascade richiesta ${activeRequest.id} fallito`, error)
          await recordRequestError(client, activeRequest.id, error)
        }
      }

      if (batch.length < 100) break
    }
  } catch (error) {
    console.error('Lettura richieste attive fallita', error)
    return new Response(JSON.stringify({ error: 'Errore lettura richieste attive' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.info('Cascade tick completato', { processed, failed })
  // Un codice non 2xx rende visibili i fallimenti in net._http_response e nei log delle funzioni.
  return new Response(JSON.stringify({ processed, failed }), {
    status: failed > 0 ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
