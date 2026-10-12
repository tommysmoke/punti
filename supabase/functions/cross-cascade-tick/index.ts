// @ts-ignore - Deno types are supplied by Supabase when deployed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.6'
import {
  buildCrossRequestAggregateBody,
  buildCrossRequestBody,
  pickCrossResponse,
  planCrossRequestStep,
  type CrossRequestItem,
  type CrossRequestResult,
  type CrossResponseCandidate,
} from '../_shared/crossCascade.ts'

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
  event: 'response' | 'timeout' | 'complete',
  confirmed: CrossRequestResult[],
  remaining: CrossRequestItem[],
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
    p_next_request_body: buildCrossRequestBody(remaining, 'Chiede'),
  })

  if (error) throw error
  return data === true
}

async function processRequest(client: ReturnType<typeof createClient>, request: ActiveCrossRequest): Promise<boolean> {
  const now = Date.now()
  const currentStore = request.ranking?.[request.current_index] ?? null
  const response = currentStore ? await findResponse(client, request, currentStore) : null
  const plan = planCrossRequestStep(request, response?.body ?? null, now, response ? Date.parse(response.created_at) : undefined)
  if (plan.event === 'waiting') return false

  return transitionRequest(client, request, plan.event, plan.confirmed, plan.remaining)
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