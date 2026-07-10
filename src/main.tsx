import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const PWA_UPDATE_PENDING_KEY = 'punti-pwa-update-pending'
const PWA_UPDATE_TEST_MARKER = '2026-07-10-update-test'
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
    updateSW(true)
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) {
      logPwa('service worker registration unavailable')
      return
    }
    logPwa('service worker registered, polling for updates every 60s')
    setInterval(() => {
      logPwa('triggering periodic registration.update()')
      registration.update()
    }, 60 * 1000)
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
  logPwa('calling updateSW(true)')
  updateSW(true)
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
