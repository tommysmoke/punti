// @ts-ignore - Deno types not available in VS Code (but works on Supabase)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.6'

interface BroadcastRequest {
  store_id: string
  title: string
  body: string
}

// Helper to create JWT for Firebase
// @ts-ignore
async function getFirebaseAccessToken(serviceAccountKey: string): Promise<string> {
  try {
    const key = JSON.parse(serviceAccountKey)
    
    // Create JWT header and payload
    const now = Math.floor(Date.now() / 1000)
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    }
    
    const payload = {
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }

    // Encode header and payload
    const headerStr = JSON.stringify(header)
    const payloadStr = JSON.stringify(payload)
    
    // @ts-ignore
    const headerB64 = btoa(headerStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    // @ts-ignore
    const payloadB64 = btoa(payloadStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    
    const message = `${headerB64}.${payloadB64}`
    
    // Sign with private key using Web Crypto (Deno supports this)
    // @ts-ignore
    const encoder = new TextEncoder()
    const keyData = key.private_key.replace(/\\n/g, '\n')
    
    // Use Deno's crypto for signing
    // @ts-ignore
    const sign = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      // @ts-ignore
      await crypto.subtle.importKey(
        'pkcs8',
        // @ts-ignore
        Deno.core.encode(keyData.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '').split('').slice(0, -1).join('')),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      ),
      encoder.encode(message)
    )
    
    // @ts-ignore
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(sign))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const jwt = `${message}.${signatureB64}`

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    })

    const tokenData = await tokenResponse.json()
    return tokenData.access_token
  } catch (error) {
    throw new Error(`Failed to get Firebase access token: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Send notification via FCM API
// @ts-ignore
async function sendViaFCM(fcmToken: string, title: string, body: string, accessToken: string, projectId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: {
              title,
              body,
            },
            webpush: {
              fcmOptions: {
                link: 'https://tommysmoke.github.io/punti/',
              },
            },
          },
        }),
      }
    )

    return response.ok
  } catch (error) {
    console.error(`FCM send error: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

// Helper function to add CORS headers to all responses
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id',
    'Content-Type': 'application/json',
  }
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders(),
    })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: corsHeaders() }
      )
    }

    const body = await req.json() as BroadcastRequest
    const { store_id, title, body: message_body } = body

    if (!store_id || !title || !message_body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: store_id, title, body' }),
        { status: 400, headers: corsHeaders() }
      )
    }

    // @ts-ignore
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    // @ts-ignore
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    // @ts-ignore
    const firebaseServiceAccountKeyStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          error: 'Missing Supabase environment variables',
        }),
        { status: 500, headers: corsHeaders() }
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
        { status: 500, headers: corsHeaders() }
      )
    }

    const count = subscriptions?.length || 0
    let successCount = 0
    let accessToken: string | null = null

    // Get Firebase access token if we have service account key
    if (firebaseServiceAccountKeyStr) {
      try {
        accessToken = await getFirebaseAccessToken(firebaseServiceAccountKeyStr)
      } catch (error) {
        console.error('Failed to get Firebase access token:', error)
        // Continue without sending via FCM, just save the record
      }
    }

    // Send notifications
    if (accessToken && subscriptions && subscriptions.length > 0) {
      // @ts-ignore
      const projectId = Deno.env.get('FIREBASE_PROJECT_ID') || 'tommy-smoke'
      
      for (const sub of subscriptions) {
        try {
          const sent = await sendViaFCM(sub.fcm_token, title, message_body, accessToken, projectId)
          if (sent) {
            successCount++
          }
        } catch (error) {
          console.error(`Failed to send to ${sub.customer_id}:`, error)
        }
      }
      
      console.log(`[BROADCAST] Successfully sent ${successCount}/${count} notifications`)
    } else {
      console.log(`[BROADCAST] Would send to ${count} customers (FCM not available)`)
    }

    // Save notification record
    const { data: notification, error: insertError } = await supabase
      .from('store_notifications')
      .insert({
        store_id,
        title,
        body: message_body,
        created_by: req.headers.get('x-user-id'),
        sent_count: successCount || count,
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
        { status: 500, headers: corsHeaders() }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Notification sent to ${successCount || count} customers`,
        notification_id: notification.id,
        sent_count: successCount || count,
      }),
      {
        status: 200,
        headers: corsHeaders(),
      }
    )
  } catch (error) {
    console.error('Broadcast error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: corsHeaders() }
    )
  }
})

