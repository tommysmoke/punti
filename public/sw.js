// Firebase Cloud Messaging per notifiche push
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: "AIzaSyDs94zp6XpOE_coyFNgFC-R49cnXoecBWI",
  projectId: "tommy-smoke",
  messagingSenderId: "734298221292",
  appId: "1:734298221292:web:5b7dd556d48c3ceb3c53c9"
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  console.log('[sw.js] Background message:', payload)
  const title = payload.notification?.title || 'Notifica'
  const options = {
    body: payload.notification?.body || '',
    icon: '/punti/favicon.svg',
    badge: '/punti/favicon.svg',
    data: payload.data || {},
  }
  self.registration.showNotification(title, options)
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/punti/') && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/punti/')
      }
    })
  )
})

// Workbox precaching — __WB_MANIFEST viene iniettato da vite-plugin-pwa al build
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js')

if (workbox) {
  workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || [])
}
