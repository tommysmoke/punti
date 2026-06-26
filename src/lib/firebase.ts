import { initializeApp } from 'firebase/app'
import { getMessaging, isSupported } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

let app: ReturnType<typeof initializeApp> | null = null
let messaging: ReturnType<typeof getMessaging> | null = null

const isConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
)

async function initializeFirebase() {
  if (!isConfigured) {
    console.warn('Firebase not configured. Set VITE_FIREBASE_* env vars.')
    return null
  }

  try {
    const supported = await isSupported()
    if (!supported) {
      console.warn('Firebase Messaging not supported in this browser.')
      return null
    }

    if (!app) {
      app = initializeApp(firebaseConfig)
    }

    if (!messaging) {
      messaging = getMessaging(app)
    }

    return messaging
  } catch (error) {
    console.error('Failed to initialize Firebase:', error)
    return null
  }
}

export { isConfigured, initializeFirebase, messaging as fbMessaging }
