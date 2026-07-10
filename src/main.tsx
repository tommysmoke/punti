import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const ACTIVE_ROLE_KEY = 'punti-active-role'
const PWA_UPDATE_PENDING_KEY = 'punti-pwa-update-pending'
const FORCE_STORE_AUTO_UPDATE =
  import.meta.env.VITE_FORCE_STORE_AUTO_UPDATE === '1' ||
  import.meta.env.VITE_FORCE_STORE_AUTO_UPDATE === 'true'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    let activeRole = ''
    try {
      activeRole = window.sessionStorage.getItem(ACTIVE_ROLE_KEY) ?? ''
    } catch {
      activeRole = ''
    }

    if (activeRole === 'store' && !FORCE_STORE_AUTO_UPDATE) {
      try {
        window.sessionStorage.setItem(PWA_UPDATE_PENDING_KEY, '1')
      } catch {
        // Ignore storage issues and still show in-session prompt event.
      }
      window.dispatchEvent(new CustomEvent('punti:pwa-update-available'))
      return
    }

    // Guest/customer paths can refresh automatically.
    updateSW(true)
  },
  onRegisteredSW(_swUrl, registration) {
    // Check for updates periodically while app stays open.
    if (!registration) return
    setInterval(() => {
      registration.update()
    }, 60 * 1000)
  },
})

window.addEventListener('punti:pwa-apply-update', () => {
  try {
    window.sessionStorage.removeItem(PWA_UPDATE_PENDING_KEY)
  } catch {
    // No-op
  }
  updateSW(true)
})

if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
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
