// @ts-ignore - Deno types not available in VS Code (but works on Supabase)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.6'

interface BroadcastRequest {
  store_id: string
  title: string
  body: string
}

// Helper: decode base64 string to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // @ts-ignore - Deno global
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer as ArrayBuffer
}

// Helper: encode ArrayBuffer or Uint8Array to base64url string
function arrayBufferToBase64url(source: Uint8Array | ArrayBuffer): string {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  // @ts-ignore - Deno global
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Helper to create JWT for Firebase
// @ts-ignore
async function getFirebaseAccessToken(serviceAccountKey: string): Promise<string> {
  const key = JSON.parse(serviceAccountKey)
  const encoder = new TextEncoder()

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const headerB64 = arrayBufferToBase64url(encoder.encode(JSON.stringify(header)))
  const payloadB64 = arrayBufferToBase64url(encoder.encode(JSON.stringify(payload)))
  const message = `${headerB64}.${payloadB64}`

  // Extract base64 content from PEM private key and decode to binary (DER)
  const pemContent = key.private_key
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '')

  const keyBinary = base64ToArrayBuffer(pemContent)

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBinary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(message),
  )

  const jwt = `${message}.${arrayBufferToBase64url(signature)}`

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  })

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text()
    throw new Error(`OAuth2 token exchange failed (${tokenResponse.status}): ${errBody}`)
  }

  const tokenData = await tokenResponse.json()
  if (!tokenData.access_token) {
    throw new Error(`No access_token in OAuth2 response: ${JSON.stringify(tokenData)}`)
  }

  return tokenData.access_token
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
            webpush: {
              notification: {
                title,
                body,
                icon: 'https://tommysmoke.github.io/punti/favicon-192x192.png',
              },
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

// Helper: verify the caller is an authenticated store user
async function verifyStoreAuth(req: Request): Promise<{ userId: string; storeId: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.replace('Bearer ', '')
  // @ts-ignore
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // @ts-ignore
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return null

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, store_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || profile.role !== 'store' || !profile.store_id) {
      return null
    }

    return { userId: user.id, storeId: profile.store_id }
  } catch {
    return null
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

    // Verify auth
    const auth = await verifyStoreAuth(req)
    if (!auth) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders() }
      )
    }

    if (auth.storeId !== store_id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: store_id mismatch' }),
        { status: 403, headers: corsHeaders() }
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

    const actuallySent = accessToken ? successCount : 0
    const subscribersCount = count

    // Save notification record
    const { data: notification, error: insertError } = await supabase
      .from('store_notifications')
      .insert({
        store_id,
        title,
        body: message_body,
        created_by: req.headers.get('x-user-id'),
        sent_count: actuallySent,
        sent_at: actuallySent > 0 ? new Date().toISOString() : null,
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

    let message: string
    if (actuallySent > 0) {
      message = `Notifica inviata a ${actuallySent} clienti su ${subscribersCount} registrati`
    } else if (subscribersCount > 0) {
      message = `Notifica registrata ma NON inviata: ${subscribersCount} clienti registrati ma FCM non configurato. Aggiungi FIREBASE_SERVICE_ACCOUNT_KEY nei secrets della Edge Function.`
    } else {
      message = 'Nessun cliente con notifiche push attive'
    }

    return new Response(
      JSON.stringify({
        success: true,
        message,
        notification_id: notification.id,
        sent_count: actuallySent,
        subscribers_count: subscribersCount,
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

