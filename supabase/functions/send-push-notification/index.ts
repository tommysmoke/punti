// @ts-ignore - Deno types not available in VS Code (but works on Supabase)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.6'

interface PushRequest {
  customer_id: number
  title?: string
  body?: string
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
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { customer_id, title, body } = (await req.json()) as PushRequest

    if (!customer_id) {
      return new Response(
        JSON.stringify({ error: 'Missing customer_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // @ts-ignore - Deno types not available in VS Code (but works on Supabase)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    // @ts-ignore - Deno types not available in VS Code (but works on Supabase)
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    // @ts-ignore - Deno types not available in VS Code (but works on Supabase)
    const firebaseServiceAccountKeyStr = Deno.env.get(
      'FIREBASE_SERVICE_ACCOUNT_KEY'
    )

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          error: 'Missing Supabase environment variables',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get FCM token from database
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: subscription, error } = await supabase
      .from('push_subscriptions')
      .select('fcm_token')
      .eq('customer_id', customer_id)
      .single()

    if (error) {
      console.error('Error fetching subscription:', error)
      return new Response(
        JSON.stringify({
          error: 'Push subscription not found',
          details: error.message,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!subscription) {
      return new Response(
        JSON.stringify({ error: 'No subscription data' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // For now, log the push that would be sent
    console.log('Push notification would be sent:', {
      customer_id,
      fcm_token: subscription.fcm_token,
      title: title || 'Notifica da Punti Facili',
      body: body || 'Hai nuovi punti!',
    })

    // Return success (full FCM integration requires Firebase Admin SDK)
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Push notification registered',
        token: subscription.fcm_token,
        note: 'Full FCM integration requires Firebase Admin SDK setup',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Edge function error:', errorMessage)
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})
