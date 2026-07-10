import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const PWA_UPDATE_PENDING_KEY = 'punti-pwa-update-pending'
const PWA_UPDATE_TEST_MARKER = '2026-07-10-update-test-4'
const FORCE_STORE_AUTO_UPDATE =
  import.meta.env.VITE_FORCE_STORE_AUTO_UPDATE === '1' ||
  import.meta.env.VITE_FORCE_STORE_AUTO_UPDATE === 'true'

const logPwa = (message: string, details?: unknown) => {
  if (details === undefined) {
    console.log(`[PWA] ${message}`)
    return
  }
  console.log(`[PWA] ${message}`, details)
}

logPwa('boot', { forceStoreAutoUpdate: FORCE_STORE_AUTO_UPDATE })

const applyUpdateNow = () => {
  logPwa('calling updateSW(true)')
  void updateSW(true).catch((error) => {
    logPwa('updateSW(true) failed', error)
  })
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    logPwa('onNeedRefresh fired')
    try {
      void PWA_UPDATE_TEST_MARKER
      window.sessionStorage.setItem(PWA_UPDATE_PENDING_KEY, '1')
      logPwa('pending update flag set in sessionStorage')
    } catch {
      logPwa('failed to set pending update flag in sessionStorage')
    }

    if (!FORCE_STORE_AUTO_UPDATE) {
      try {
        logPwa('dispatching punti:pwa-update-available')
        window.dispatchEvent(new CustomEvent('punti:pwa-update-available'))
      } catch {
        logPwa('failed to dispatch punti:pwa-update-available')
      }
      return
    }

    logPwa('force mode enabled: applying update immediately for everyone')
    applyUpdateNow()
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) {
      logPwa('service worker registration unavailable')
      return
    }
    logPwa('service worker registered, performing one safe update check')

    const pollForUpdates = async () => {
      if (document.visibilityState === 'hidden') {
        return
      }

      try {
        logPwa('triggering periodic registration.update()')
        await registration.update()
      } catch (error) {
        logPwa('registration.update() failed', error)
      }
    }

    void pollForUpdates()

    // Emergency-safe mode: avoid aggressive polling that can trigger
    // InvalidStateError loops on some mobile browsers.
  },
  onRegisterError(error) {
    logPwa('registerSW error', error)
  },
})

window.addEventListener('punti:pwa-apply-update', () => {
  logPwa('received punti:pwa-apply-update event')
  try {
    window.sessionStorage.removeItem(PWA_UPDATE_PENDING_KEY)
    logPwa('pending update flag removed from sessionStorage')
  } catch {
    logPwa('failed to remove pending update flag from sessionStorage')
  }
  applyUpdateNow()
})

if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    logPwa('controllerchange detected, reloading page')
    window.location.reload()
  })
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message =
    typeof reason === 'string'
      ? reason
      : reason instanceof Error
        ? reason.message
        : ''

  const isInvalidSwState =
    message.includes('Failed to update a ServiceWorker') &&
    message.includes('invalid state')

  if (!isInvalidSwState) return

  logPwa('suppressed known ServiceWorker InvalidStateError', reason)
  event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
