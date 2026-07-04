import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const updateSW = registerSW({
  onNeedRefresh() {
    if (window.confirm('Nuova versione disponibile. Aggiornare?')) {
      updateSW()
    }
  },
  onOfflineReady() {
    console.log('App pronta per uso offline')
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
