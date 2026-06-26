import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import styles from './StoreNotifications.module.css'

interface Notification {
  id: number
  title: string
  body: string
  created_at: string
  sent_count: number
  sent_at: string | null
}

export function StoreNotifications() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Get current user's store
  const [storeId, setStoreId] = useState<string | null>(null)

  useEffect(() => {
    if (isSupabaseConfigured && supabase) {
      loadStoreInfo()
      loadNotifications()
    }
  }, [])

  async function loadStoreInfo() {
    try {
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('store_id')
        .eq('id', user.id)
        .single()

      if (profile?.store_id) {
        setStoreId(profile.store_id)
      }
    } catch (err) {
      console.error('Error loading store info:', err)
    }
  }

  async function loadNotifications() {
    try {
      setLoading(true)
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('store_id')
        .eq('id', user.id)
        .single()

      if (!profile?.store_id) return

      const { data } = await supabase
        .from('store_notifications')
        .select('*')
        .eq('store_id', profile.store_id)
        .order('created_at', { ascending: false })
        .limit(50)

      setNotifications(data || [])
    } catch (err) {
      console.error('Error loading notifications:', err)
      setError('Errore nel caricamento della cronologia')
    } finally {
      setLoading(false)
    }
  }

  async function handleSendNotification() {
    if (!title.trim() || !message.trim()) {
      setError('Titolo e messaggio sono obbligatori')
      return
    }

    if (!storeId) {
      setError('Store ID non trovato')
      return
    }

    if (!supabase) {
      setError('Supabase non configurato')
      return
    }

    try {
      setSending(true)
      setError(null)
      setSuccess(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token

      if (!token) throw new Error('Token di autenticazione non trovato')

      // Call the broadcast-notification edge function
      const baseUrl = import.meta.env.VITE_SUPABASE_URL
      if (!baseUrl) {
        throw new Error('VITE_SUPABASE_URL non configurato')
      }

      const functionUrl = `${baseUrl}/functions/v1/broadcast-notification`
      console.log('Calling edge function:', functionUrl)

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          store_id: storeId,
          title: title.trim(),
          body: message.trim(),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Errore nell\'invio della notifica')
      }

      setSuccess(
        `Notifica inviata a ${result.sent_count} clienti!`
      )
      setTitle('')
      setMessage('')

      // Reload notifications
      setTimeout(() => loadNotifications(), 1000)
    } catch (err) {
      console.error('Error sending notification:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Errore nell\'invio della notifica'
      )
    } finally {
      setSending(false)
    }
  }

  if (!isSupabaseConfigured || !supabase) {
    return (
      <div className={styles.container}>
        <h2>📢 Comunicazioni Clienti</h2>
        <p className="error">Supabase non configurato. Controlla le variabili d'ambiente.</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <h2>📢 Comunicazioni Clienti</h2>

      {/* Form */}
      <div className={styles.form}>
        <div className={styles.formGroup}>
          <label htmlFor="title">Titolo</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="es: Attenzione, Promozione, Auguri..."
            maxLength={50}
            disabled={sending}
          />
          <small>{title.length}/50</small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="message">Messaggio</label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="es: Oggi Tommy Smoke Castenaso sarà chiuso tutto il giorno. Puoi trovarci regolarmente a Quarto, Bologna..."
            rows={5}
            maxLength={500}
            disabled={sending}
          />
          <small>{message.length}/500</small>
        </div>

        {/* Preview */}
        <div className={styles.preview}>
          <h3>📋 Anteprima Notifica:</h3>
          <div className={styles.phoneFrame}>
            <div className={styles.notification}>
              <div className={styles.notificationTitle}>
                🔔 {title || 'Titolo notifica'}
              </div>
              <div className={styles.notificationBody}>
                {message || 'Il testo apparirà qui...'}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        {/* Send Button */}
        <button
          onClick={handleSendNotification}
          disabled={sending || !title.trim() || !message.trim()}
          className={styles.sendButton}
        >
          {sending ? 'Invio in corso...' : 'Invia a tutti i clienti'}
        </button>
      </div>

      {/* History */}
      <div className={styles.history}>
        <h3>📬 Cronologia Invii ({notifications.length})</h3>
        {loading ? (
          <p>Caricamento...</p>
        ) : notifications.length === 0 ? (
          <p className={styles.empty}>Nessuna comunicazione ancora</p>
        ) : (
          <div className={styles.notificationsList}>
            {notifications.map((notif) => (
              <div key={notif.id} className={styles.historyItem}>
                <div className={styles.historyHeader}>
                  <strong>{notif.title}</strong>
                  <span className={styles.date}>
                    {new Date(notif.created_at).toLocaleDateString('it-IT', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className={styles.historyBody}>{notif.body}</div>
                <div className={styles.historyFooter}>
                  {notif.sent_at ? (
                    <span>✓ Inviata a {notif.sent_count} clienti</span>
                  ) : (
                    <span>⏳ In coda...</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
