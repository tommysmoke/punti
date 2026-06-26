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
    const messaging = await initializeFirebase()
    if (!messaging) {
      console.warn('Firebase messaging not available')
      return null
    }

    const permission = await requestNotificationPermission()
    if (permission !== 'granted') {
      console.log('Notification permission:', permission)
      return null
    }

    // Get FCM token
    const token = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    })

    if (!token) {
      console.warn('Failed to get FCM token')
      return null
    }

    // Save subscription to Supabase
    if (supabase) {
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          customer_id: customerId,
          fcm_token: token,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_id' }
      )

      if (error) {
        console.error('Failed to save push subscription:', error)
        return null
      }

      console.log('Push subscription registered successfully')
    }

    return token
  } catch (error) {
    console.error('Error registering for push notifications:', error)
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
