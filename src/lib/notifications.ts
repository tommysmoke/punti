import { getToken, onMessage } from 'firebase/messaging'
import { initializeFirebase } from './firebase'
import { supabase } from './supabase'

export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported by browser')
    return null
  }

  if (Notification.permission === 'granted') {
    return 'granted'
  }

  if (Notification.permission === 'denied') {
    return 'denied'
  }

  // Permission is 'default', ask user
  const permission = await Notification.requestPermission()
  return permission
}

export async function registerForPushNotifications(customerId: number) {
  try {
    console.log('🔔 [PUSH] Step 1: Inizializzando Firebase...')
    const messaging = await initializeFirebase()
    if (!messaging) {
      console.warn('❌ [PUSH] Firebase messaging non disponibile (browser non supportato?)')
      return null
    }
    console.log('✅ [PUSH] Firebase inizializzato')

    console.log('🔔 [PUSH] Step 2: Richiedendo permesso notifiche...')
    const permission = await requestNotificationPermission()
    console.log('   Permesso ricevuto:', permission)
    
    if (permission !== 'granted') {
      console.warn('⚠️ [PUSH] Permesso non concesso:', permission)
      return null
    }
    console.log('✅ [PUSH] Permesso concesso')

    console.log('🔔 [PUSH] Step 3: Ottenendo FCM token...')
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
    console.log('   VAPID Key disponibile:', !!vapidKey)
    
    // Registra il service worker con scope corretto per GitHub Pages
    let swRegistration: ServiceWorkerRegistration | undefined = undefined
    try {
      if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.register(
          '/punti/firebase-messaging-sw.js',
          { scope: '/punti/' }
        )
        console.log('✅ [PUSH] Service Worker registrato:', swRegistration.scope)
      }
    } catch (swError) {
      console.warn('⚠️ [PUSH] Errore nella registrazione del service worker:', swError instanceof Error ? swError.message : String(swError))
    }
    
    let token: string | null = null
    try {
      token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: swRegistration,
      })
      console.log('✅ [PUSH] FCM Token ottenuto:', token.substring(0, 50) + '...')
    } catch (tokenError) {
      console.warn('⚠️ [PUSH] Errore nell\'ottenimento del token (potrebbe essere normale se service worker non è registrato):')
      console.warn('   ', tokenError instanceof Error ? tokenError.message : String(tokenError))
      
      // Se il problema è il service worker, prova con fallback
      if (tokenError instanceof Error && tokenError.message.includes('service worker')) {
        console.log('🔄 [PUSH] Cercando service worker alternativo...')
        
        // Questo non è ideale, ma almeno registra il cliente
        // In caso di notifiche real-time, useremo il fallback di Supabase
        if (!supabase) {
          throw new Error('Supabase non configurato per fallback')
        }
        
        // Salva il cliente senza FCM token - userà il fallback
        console.log('📝 [PUSH] Registrando senza FCM token (usa fallback real-time)')
        const { error: fallbackError } = await supabase
          .from('push_subscriptions')
          .upsert(
            {
              customer_id: customerId,
              fcm_token: null, // Null token - userà polling o real-time
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'customer_id' }
          )
          .select()

        if (fallbackError) {
          console.error('❌ [PUSH] Errore nel fallback:', fallbackError)
          throw fallbackError
        }

        console.log('✅ [PUSH] Fallback registrato (faremo polling per notifiche)')
        return null
      }
      
      throw tokenError
    }

    if (!token) {
      console.error('❌ [PUSH] Impossibile ottenere FCM token')
      return null
    }

    console.log('🔔 [PUSH] Step 4: Salvando subscription nel database...')
    console.log('   Customer ID:', customerId)
    
    if (!supabase) {
      console.error('❌ [PUSH] Supabase non configurato')
      return null
    }

    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          customer_id: customerId,
          fcm_token: token,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_id' }
      )
      .select()

    if (error) {
      console.error('❌ [PUSH] Errore nel salvare subscription:', error)
      console.error('   Codice errore:', error.code)
      console.error('   Messaggio:', error.message)
      console.error('   Hint:', error.hint)
      console.error('   Details:', error.details)
      return null
    }

    console.log('✅ [PUSH] Subscription salvata nel database!')
    console.log('   Data:', data)
    console.log('🎉 [PUSH] Registrazione completata con successo!')

    return token
  } catch (error) {
    console.error('❌ [PUSH] Errore generale:', error)
    if (error instanceof Error) {
      console.error('   Stack:', error.stack)
      console.error('   Messaggio:', error.message)
    }
    return null
  }
}

export async function setupMessageListener() {
  try {
    const messaging = await initializeFirebase()
    if (!messaging) return

    // Handle messages when app is in foreground
    onMessage(messaging, (payload) => {
      console.log('Message received in foreground:', payload)

      const notificationTitle = payload.notification?.title || 'Notifica'
      const notificationOptions: NotificationOptions = {
        body: payload.notification?.body,
        icon: '/punti/favicon.svg',
        badge: '/punti/favicon.svg',
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification(notificationTitle, notificationOptions)
        })
      }
    })
  } catch (error) {
    console.error('Error setting up message listener:', error)
  }
}

export function getNotificationPermission() {
  if (!('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission
}
