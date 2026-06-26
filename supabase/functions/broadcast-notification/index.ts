// @ts-ignore - Deno types not available in VS Code (but works on Supabase)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.6'

interface BroadcastRequest {
  store_id: string
  title: string
  body: string
}

// @ts-ignore - Deno types not available in VS Code (but works on Supabase)
Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json() as BroadcastRequest
    const { store_id, title, body: message_body } = body

    if (!store_id || !title || !message_body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: store_id, title, body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // @ts-ignore
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    // @ts-ignore
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          error: 'Missing Supabase environment variables',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get all push subscriptions
    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from('push_subscriptions')
      .select('customer_id, fcm_token')
      .not('fcm_token', 'is', null)

    if (subscriptionsError) {
      console.error('Error fetching subscriptions:', subscriptionsError)
      return new Response(
        JSON.stringify({
          error: 'Failed to fetch subscriptions',
          details: subscriptionsError.message,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // For now, log that we would send to all customers
    const count = subscriptions?.length || 0
    console.log(
      `[BROADCAST] Sending "${title}" to ${count} customers. Body: "${message_body}"`
    )

    // TODO: Implement actual FCM broadcast sending here
    // This would involve:
    // 1. Parsing Firebase Service Account Key
    // 2. Getting Google OAuth access token
    // 3. For each FCM token, send via FCM API

    // Save notification record
    const { data: notification, error: insertError } = await supabase
      .from('store_notifications')
      .insert({
        store_id,
        title,
        body: message_body,
        created_by: req.headers.get('x-user-id'),
        sent_count: count,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error saving notification record:', insertError)
      return new Response(
        JSON.stringify({
          error: 'Failed to save notification record',
          details: insertError.message,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Notification broadcast queued for ${count} customers`,
        notification_id: notification.id,
        sent_count: count,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Broadcast error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
