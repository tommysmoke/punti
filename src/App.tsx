import { type FormEvent, useEffect, useMemo, useState } from 'react'
import './App.css'
import { createClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Role = 'store' | 'customer'

type Profile = {
  id: string
  role: Role
  store_id: string | null
  customer_id: number | null
}

type Customer = {
  id: number
  store_id: string
  name: string
  phone: string
  points: number
}

type Movement = {
  id: number
  customer_id: number
  kind: 'earn' | 'redeem'
  points: number
  note: string | null
  created_at: string
}

type Toast = {
  type: 'success' | 'error'
  message: string
}

type Reward = {
  id: number
  store_id: string
  name: string
  description: string | null
  points_cost: number
  active: boolean
}

function App() {
  const [sessionLoading, setSessionLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedStoreCustomerId, setSelectedStoreCustomerId] = useState<number | null>(
    null,
  )
  const [customerMovements, setCustomerMovements] = useState<Movement[]>([])
  const [loadingData, setLoadingData] = useState(false)

  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newCustomerBirthDayMonth, setNewCustomerBirthDayMonth] = useState('')
  const [newCustomerExtraWord, setNewCustomerExtraWord] = useState('')
  const [newCustomerSuccess, setNewCustomerSuccess] = useState('')
  const [newCustomerError, setNewCustomerError] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')

  const [showChangePassword, setShowChangePassword] = useState(false)
  const [changePasswordCurrent, setChangePasswordCurrent] = useState('')
  const [changePasswordNew, setChangePasswordNew] = useState('')
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState('')
  const [resetCustomerPassword, setResetCustomerPassword] = useState('')
  const [resetCustomerSuccess, setResetCustomerSuccess] = useState('')
  const [resetCustomerError, setResetCustomerError] = useState('')
  const [resetStoreUsername, setResetStoreUsername] = useState('')
  const [resetStorePassword, setResetStorePassword] = useState('')
  const [resetStoreConfirm, setResetStoreConfirm] = useState('')
  const [resetStoreError, setResetStoreError] = useState('')
  const [resetStoreSuccess, setResetStoreSuccess] = useState('')

  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [storePage, setStorePage] = useState<'operations' | 'new-customer' | 'rewards' | 'security'>('operations')
  const [rewards, setRewards] = useState<Reward[]>([])
  const [newRewardName, setNewRewardName] = useState('')
  const [newRewardDescription, setNewRewardDescription] = useState('')
  const [newRewardPoints, setNewRewardPoints] = useState('')
  const [rewardError, setRewardError] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [showAllMovements, setShowAllMovements] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // TODO: Feature #6 - Real-time sync: quando saldo cliente cambia da altro browser, aggiorna automaticamente
  // TODO: Feature #10 - Caricamento ottimizzato: mostrare skeleton/placeholder mentre carichi, non "Sincronizzazione..."

  // Modali di conferma per operazioni critiche
  const [confirmModal, setConfirmModal] = useState<{
    action: 'redeem' | 'reset-customer-pwd' | 'reset-store-pwd'
    message: string
  } | null>(null)

  const pointsPreview = useMemo(() => {
    const amount = Number(expenseAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0
    }

    return Math.floor(amount / 7)
  }, [expenseAmount])

  const selectedStoreCustomer = customers.find(
    (customer) => customer.id === selectedStoreCustomerId,
  )

  const filteredCustomers = customers.filter((customer) => {
    const needle = customerSearch.trim().toLowerCase()
    if (!needle) {
      return true
    }

    return (
      customer.name.toLowerCase().includes(needle) ||
      customer.phone.includes(needle)
    )
  })

  const pushToast = (type: Toast['type'], message: string) => {
    setToast({ type, message })
  }

  const customerView =
    role === 'customer'
      ? customers.find((customer) => customer.id === profile?.customer_id)
      : selectedStoreCustomer

  const displayName =
    role === 'store'
      ? 'Team Negozio'
      : customerView?.name.split(' ')[0] ?? 'Cliente'

  const loadCustomerMovements = async (customerId: number) => {
    if (!supabase) {
      return
    }

    const { data, error } = await supabase
      .from('point_transactions')
      .select('id, customer_id, kind, points, note, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    setCustomerMovements((data ?? []) as Movement[])
  }

  const loadRewards = async (storeId: string) => {
    if (!supabase) return
    const { data } = await supabase
      .from('rewards')
      .select('id, store_id, name, description, points_cost, active')
      .eq('store_id', storeId)
      .order('points_cost', { ascending: true })
    setRewards((data ?? []) as Reward[])
  }

  const loadCustomerRewards = async (storeId: string) => {
    if (!supabase) return
    const { data } = await supabase
      .from('rewards')
      .select('id, store_id, name, description, points_cost, active')
      .eq('store_id', storeId)
      .eq('active', true)
      .order('points_cost', { ascending: true })
    setRewards((data ?? []) as Reward[])
  }

  const addReward = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !profile?.store_id) return

    const name = newRewardName.trim()
    const cost = Number(newRewardPoints)
    if (!name || !cost || cost <= 0) {
      setRewardError('Inserisci nome e costo in punti valido')
      return
    }

    setRewardError('')
    const { error } = await supabase.from('rewards').insert({
      store_id: profile.store_id,
      name,
      description: newRewardDescription.trim() || null,
      points_cost: cost,
    })

    if (error) {
      setRewardError(error.message)
      return
    }

    setNewRewardName('')
    setNewRewardDescription('')
    setNewRewardPoints('')
    pushToast('success', `Premio "${name}" aggiunto`)
    await loadRewards(profile.store_id)
  }

  const toggleReward = async (reward: Reward) => {
    if (!supabase || !profile?.store_id) return
    await supabase.from('rewards').update({ active: !reward.active }).eq('id', reward.id)
    await loadRewards(profile.store_id)
  }

  const deleteReward = async (reward: Reward) => {
    if (!supabase || !profile?.store_id) return
    await supabase.from('rewards').delete().eq('id', reward.id)
    pushToast('success', `Premio "${reward.name}" eliminato`)
    await loadRewards(profile.store_id)
  }

  const loadStoreCustomers = async (storeId: string) => {
    if (!supabase) {
      return
    }

    const { data, error } = await supabase
      .from('customers')
      .select('id, store_id, name, phone, points')
      .eq('store_id', storeId)
      .order('name', { ascending: true })

    if (error) {
      throw error
    }

    const nextCustomers = (data ?? []) as Customer[]
    setCustomers(nextCustomers)

    if (nextCustomers.length === 0) {
      setSelectedStoreCustomerId(null)
      setCustomerMovements([])
      return
    }

    const keepCurrent =
      selectedStoreCustomerId !== null &&
      nextCustomers.some((c) => c.id === selectedStoreCustomerId)

    if (!keepCurrent) {
      setSelectedStoreCustomerId(null)
      setCustomerMovements([])
      return
    }

    await loadCustomerMovements(selectedStoreCustomerId)
  }

  const loadCustomerHome = async (customerId: number) => {
    if (!supabase) {
      return
    }

    const { data, error } = await supabase
      .from('customers')
      .select('id, store_id, name, phone, points')
      .eq('id', customerId)
      .single()

    if (error) {
      throw error
    }

    setCustomers(data ? [data as Customer] : [])
    await loadCustomerMovements(customerId)
  }

  const bootstrapFromProfile = async (nextProfile: Profile) => {
    setLoadingData(true)
    setActionError('')

    try {
      setProfile(nextProfile)
      setRole(nextProfile.role)

      if (nextProfile.role === 'store' && nextProfile.store_id) {
        await loadStoreCustomers(nextProfile.store_id)
        await loadRewards(nextProfile.store_id)
      }

      if (nextProfile.role === 'customer' && nextProfile.customer_id) {
        await loadCustomerHome(nextProfile.customer_id)
        // Carica premi: recupera store_id del cliente e poi i premi attivi
        const { data: custData } = await supabase!
          .from('customers')
          .select('store_id')
          .eq('id', nextProfile.customer_id)
          .single()
        if (custData?.store_id) {
          await loadCustomerRewards(custData.store_id)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore caricamento dati'
      setActionError(message)
    } finally {
      setLoadingData(false)
    }
  }

  const fetchProfile = async (userId: string) => {
    if (!supabase) {
      return null
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, store_id, customer_id')
      .eq('id', userId)
      .single()

    if (error) {
      throw error
    }

    return data as Profile
  }

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false)
      return
    }

    const client = supabase

    const initialize = async () => {
      const { data } = await client.auth.getSession()
      const user = data.session?.user

      if (user) {
        try {
          const nextProfile = await fetchProfile(user.id)
          if (nextProfile) {
            await bootstrapFromProfile(nextProfile)
          }
        } catch {
          await client.auth.signOut()
        }
      }

      setSessionLoading(false)
    }

    void initialize()

    const { data: authListener } = client.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setRole(null)
        setProfile(null)
        setCustomers([])
        setCustomerMovements([])
        setSelectedStoreCustomerId(null)
        setSessionLoading(false)
        return
      }

      try {
        const nextProfile = await fetchProfile(session.user.id)
        if (nextProfile) {
          await bootstrapFromProfile(nextProfile)
        }
      } catch {
        await client.auth.signOut()
      } finally {
        setSessionLoading(false)
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (role !== 'store' || !selectedStoreCustomerId) {
      return
    }

    void loadCustomerMovements(selectedStoreCustomerId)
  }, [role, selectedStoreCustomerId])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timeoutId = setTimeout(() => {
      setToast(null)
    }, 2600)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [toast])

  // Keyboard shortcuts: Ctrl/Cmd+Enter per registrare spesa, N per Nuovo cliente, S per Sicurezza, frecce per navigare clienti
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey

      // Shortcut: Ctrl/Cmd+Enter per registrare spesa (solo in store operations)
      if (isMeta && e.key === 'Enter' && role === 'store' && storePage === 'operations' && selectedStoreCustomer && pointsPreview > 0) {
        e.preventDefault()
        void addPoints({ preventDefault: () => {} } as FormEvent)
      }

      // Shortcut: N per andare su Nuovo cliente
      if (e.key === 'n' && !isMeta && role === 'store' && storePage !== 'new-customer' && !(e.target as HTMLElement).closest('input')) {
        setStorePage('new-customer')
      }

      // Shortcut: S per andare su Sicurezza
      if (e.key === 's' && !isMeta && role === 'store' && storePage !== 'security' && !(e.target as HTMLElement).closest('input')) {
        setStorePage('security')
      }

      // Shortcut: Freccia su/giù per navigare clienti
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && role === 'store' && storePage === 'operations' && !(e.target as HTMLElement).closest('input')) {
        e.preventDefault()
        const currentIndex = filteredCustomers.findIndex((c) => c.id === selectedStoreCustomerId)
        let nextIndex = currentIndex

        if (e.key === 'ArrowUp') {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredCustomers.length - 1
        } else {
          nextIndex = currentIndex < filteredCustomers.length - 1 ? currentIndex + 1 : 0
        }

        if (filteredCustomers[nextIndex]) {
          setSelectedStoreCustomerId(filteredCustomers[nextIndex].id)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [role, storePage, selectedStoreCustomerId, selectedStoreCustomer, pointsPreview, filteredCustomers])

  const login = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase) {
      setLoginError('Configura prima le variabili Supabase nel file .env')
      return
    }

    setLoginError('')
    setLoginLoading(true)
    const identifier = loginIdentifier.trim().toLowerCase()
    try {
      let emailForLogin: string | null = identifier

      if (!identifier.includes('@')) {
        const { data, error } = await supabase.rpc('resolve_login_email', {
          p_identifier: identifier,
        })

        if (error || !data) {
          setLoginError('Credenziali non valide')
          return
        }

        emailForLogin = data ?? null
      }

      if (!emailForLogin) {
        setLoginError('Credenziali non valide')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: emailForLogin,
        password: loginPassword,
      })

      if (error) {
        setLoginError('Credenziali non valide')
        return
      }

      setLoginPassword('')
      pushToast('success', 'Accesso effettuato')
    } finally {
      setLoginLoading(false)
    }
  }

  const logout = async () => {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase) {
      return
    }

    setChangePasswordError('')
    setChangePasswordSuccess('')

    if (!changePasswordCurrent) {
      setChangePasswordError('Inserisci la password attuale')
      return
    }

    if (changePasswordNew.length < 8) {
      setChangePasswordError('La nuova password deve essere almeno 8 caratteri')
      return
    }

    if (changePasswordNew !== changePasswordConfirm) {
      setChangePasswordError('Le password non coincidono')
      return
    }

    // Verifica la password attuale ri-autenticando prima di cambiare
    const { data: sessionData } = await supabase.auth.getSession()
    const currentEmail = sessionData.session?.user?.email
    if (!currentEmail) {
      setChangePasswordError('Sessione non valida, rieffettua il login')
      return
    }

    const { error: reAuthError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: changePasswordCurrent,
    })

    if (reAuthError) {
      setChangePasswordError('Password attuale non corretta')
      return
    }

    const { error } = await supabase.auth.updateUser({ password: changePasswordNew })

    if (error) {
      setChangePasswordError(error.message)
      pushToast('error', 'Password non aggiornata')
      return
    }

    setChangePasswordSuccess('Password aggiornata con successo')
    pushToast('success', 'Password aggiornata')
    setChangePasswordCurrent('')
    setChangePasswordNew('')
    setChangePasswordConfirm('')
  }

  const resetStoreUserPassword = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase) {
      return
    }

    setResetStoreError('')
    setResetStoreSuccess('')

    const username = resetStoreUsername.trim()
    if (!username) {
      setResetStoreError('Inserisci lo username del socio')
      return
    }

    if (resetStorePassword.length < 8) {
      setResetStoreError('La password deve essere almeno 8 caratteri')
      return
    }

    if (resetStorePassword !== resetStoreConfirm) {
      setResetStoreError('Le password non coincidono')
      return
    }

    // Apri modale di conferma
    setConfirmModal({
      action: 'reset-store-pwd',
      message: `Resettare password di ${username}? Usa la nuova password inserita.`,
    })
  }

  const confirmResetStorePassword = async () => {
    if (!supabase) {
      return
    }

    const username = resetStoreUsername.trim()
    setConfirmModal(null)
    setResetStoreError('')
    setResetStoreSuccess('')

    const { error } = await supabase.rpc('admin_reset_store_password', {
      p_username: username,
      p_new_password: resetStorePassword,
    })

    if (error) {
      setResetStoreError(error.message)
      pushToast('error', 'Reset password socio non riuscito')
      return
    }

    setResetStoreSuccess(`Password di ${username} aggiornata`)
    pushToast('success', `Password socio aggiornata: ${username}`)
    setResetStoreUsername('')
    setResetStorePassword('')
    setResetStoreConfirm('')
  }

  const resetCustomerPasswordFn = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !selectedStoreCustomer) {
      return
    }

    const newPwd = resetCustomerPassword.trim()
    if (newPwd.length < 8) {
      setResetCustomerError('La password deve essere almeno 8 caratteri')
      return
    }

    // Apri modale di conferma
    setConfirmModal({
      action: 'reset-customer-pwd',
      message: `Resettare password di ${selectedStoreCustomer.name}? Usa la nuova password inserita.`,
    })
  }

  const confirmResetCustomerPassword = async () => {
    if (!supabase || !selectedStoreCustomer) {
      return
    }

    const newPwd = resetCustomerPassword.trim()
    setConfirmModal(null)
    setResetCustomerError('')
    setResetCustomerSuccess('')

    const { error } = await supabase.rpc('admin_reset_customer_password', {
      p_customer_id: selectedStoreCustomer.id,
      p_new_password: newPwd,
    })

    if (error) {
      setResetCustomerError(error.message)
      pushToast('error', 'Reset password cliente non riuscito')
      return
    }

    setResetCustomerSuccess(`Password di ${selectedStoreCustomer.name} aggiornata`)
    pushToast('success', `Password cliente aggiornata: ${selectedStoreCustomer.name}`)
    setResetCustomerPassword('')
  }

  const buildUsername = (fullName: string, extraWord: string, birthDayMonth: string) => {
    const base = `${fullName}${extraWord}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase()
    const match = birthDayMonth.replace(/\s/g, '').match(/^(\d{2})\/(\d{2})$/)
    const day = match ? Number(match[1]) : 0
    const month = match ? Number(match[2]) : 0
    const valid = day >= 1 && day <= 31 && month >= 1 && month <= 12
    const suffix = valid && match ? `${match[1]}${match[2]}` : '0000'
    return `${base}${suffix}`
  }

  const addCustomer = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !profile?.store_id) {
      return
    }

    const name = newCustomerName.trim()
    const phone = newCustomerPhone.replace(/\D/g, '')
    const password = phone
    const birthDayMonth = newCustomerBirthDayMonth.trim()
    const username = buildUsername(newCustomerName.trim(), newCustomerExtraWord.trim(), birthDayMonth)

    setNewCustomerError('')
    setNewCustomerSuccess('')

    if (!name || !phone || !username) {
      setNewCustomerError('Compila tutti i campi')
      return
    }

    if (!/^\d{2}\/\d{2}$/.test(birthDayMonth)) {
      setNewCustomerError('Inserisci giorno/mese nel formato GG/MM')
      return
    }

    if (phone.length < 8) {
      setNewCustomerError('Numero di telefono non valido (minimo 8 cifre)')
      return
    }

    // Client temporaneo con storage separato per non sovrascrivere la sessione store
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { auth: { storageKey: 'sb-temp-reg', autoRefreshToken: false, persistSession: false } }
    )

    const email = `${username}@emailnonesiste.it`

    const { error } = await tempClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: 'customer',
          name,
          phone,
          username,
          store_id: profile.store_id,
        },
      },
    })

    await tempClient.auth.signOut()

    if (error) {
      setNewCustomerError(error.message)
      pushToast('error', 'Creazione cliente non riuscita')
      return
    }

    setNewCustomerSuccess(`Cliente creato! Username: ${username} - Password iniziale: numero di telefono`)
    pushToast('success', `Cliente creato: ${username}`)
    setNewCustomerName('')
    setNewCustomerPhone('')
    setNewCustomerBirthDayMonth('')
    setNewCustomerExtraWord('')
    await loadStoreCustomers(profile.store_id)
  }

  const addPoints = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !selectedStoreCustomer || pointsPreview <= 0) {
      return
    }

    const amount = Number(expenseAmount)
    setActionError('')

    const { error } = await supabase.rpc('record_earn', {
      p_customer_id: selectedStoreCustomer.id,
      p_amount_eur: amount,
      p_note: `Spesa ${amount.toFixed(2)} EUR`,
    })

    if (error) {
      setActionError(error.message)
      pushToast('error', 'Registrazione spesa non riuscita')
      return
    }

    setExpenseAmount('')
    pushToast('success', `${pointsPreview} punti aggiunti`)
    if (profile?.store_id) {
      await loadStoreCustomers(profile.store_id)
    }
  }

  const redeemPoints = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !selectedStoreCustomer) {
      return
    }

    const redeem = Number(redeemAmount)
    if (!Number.isFinite(redeem) || redeem <= 0) {
      return
    }

    // Apri modale di conferma
    setConfirmModal({
      action: 'redeem',
      message: `Redimere ${redeem} punti da ${selectedStoreCustomer.name}?`,
    })
  }

  const confirmRedeem = async () => {
    if (!supabase || !selectedStoreCustomer) {
      return
    }

    const redeem = Number(redeemAmount)
    if (!Number.isFinite(redeem) || redeem <= 0) {
      return
    }

    setConfirmModal(null)
    setActionError('')

    const { error } = await supabase.rpc('record_redeem', {
      p_customer_id: selectedStoreCustomer.id,
      p_points: redeem,
      p_note: 'Redemption manuale',
    })

    if (error) {
      setActionError(error.message)
      pushToast('error', 'Redenzione non riuscita')
      return
    }

    setRedeemAmount('')
    pushToast('success', `${redeem} punti redenti`)
    if (profile?.store_id) {
      await loadStoreCustomers(profile.store_id)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="app-shell auth-layout">
        <section className="card auth-card">
          <p className="eyebrow">PWA Loyalty</p>
          <h1>Punti Facili</h1>
          <p className="error">Mancano SUPABASE_URL e SUPABASE_ANON_KEY nel file .env</p>
        </section>
      </main>
    )
  }

  if (sessionLoading) {
    return (
      <main className="app-shell auth-layout">
        <section className="card auth-card">
          <h2>Caricamento...</h2>
        </section>
      </main>
    )
  }

  if (!role) {
    return (
      <main className="app-shell auth-layout">
        <section className="card auth-card auth-card-polished">
          <p className="eyebrow">PWA Loyalty</p>
          <p className="auth-icon" aria-hidden="true">
            PF
          </p>
          <h1>Punti Facili</h1>
          <p className="hint no-top">Accedi con username o telefono per continuare.</p>

          <form className="stack" onSubmit={login}>
            <label>
              Username o telefono
              <input
                type="text"
                value={loginIdentifier}
                onChange={(event) => setLoginIdentifier(event.target.value)}
                placeholder="es. MarioRossi80 oppure 3331112223"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Inserisci password"
              />
            </label>
            {loginError ? <p className="error">{loginError}</p> : null}
            <button className="cta" type="submit" disabled={loginLoading}>
              {loginLoading ? 'Accesso in corso...' : 'Accedi'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">PWA Loyalty</p>
          <h1>{role === 'store' ? `Ciao ${displayName}` : `Benvenuto ${displayName}`}</h1>
          <p className="hint no-top">
            {role === 'store'
              ? 'Gestisci clienti e punti in un unico posto.'
              : 'Controlla saldo punti e movimenti recenti.'}
          </p>
        </div>
        <div className="topbar-actions">
          {role === 'store' && profile?.store_id ? (
            <details className="store-code-box">
              <summary>Codice negozio</summary>
              <p>{profile.store_id}</p>
            </details>
          ) : null}
          {role !== 'store' ? (
            <button className="ghost small" type="button" onClick={() => setShowChangePassword(v => !v)}>
              {showChangePassword ? 'Chiudi sicurezza' : 'Sicurezza'}
            </button>
          ) : null}
          <button className="ghost small" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {toast ? <p className={`toast ${toast.type}`}>{toast.message}</p> : null}

      {confirmModal ? (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Conferma operazione</h3>
            <p>{confirmModal.message}</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirmModal(null)}>
                Annulla
              </button>
              <button
                className="cta"
                onClick={async () => {
                  if (confirmModal.action === 'redeem') await confirmRedeem()
                  else if (confirmModal.action === 'reset-customer-pwd') await confirmResetCustomerPassword()
                  else if (confirmModal.action === 'reset-store-pwd') await confirmResetStorePassword()
                }}
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {actionError ? <p className="error">{actionError}</p> : null}
      {loadingData ? <p className="hint">Sincronizzazione dati in corso...</p> : null}

      {role !== 'store' && showChangePassword ? (
        <article className="card" style={{marginBottom:'1rem'}}>
          <h2>Cambia password</h2>
          <form className="stack" onSubmit={changePassword}>
            <label>
              Password attuale
              <input
                type="password"
                value={changePasswordCurrent}
                onChange={(event) => setChangePasswordCurrent(event.target.value)}
                placeholder="Inserisci la password attuale"
              />
            </label>
            <label>
              Nuova password
              <input
                type="password"
                value={changePasswordNew}
                onChange={(event) => setChangePasswordNew(event.target.value)}
                placeholder="Almeno 8 caratteri"
              />
            </label>
            <label>
              Conferma nuova password
              <input
                type="password"
                value={changePasswordConfirm}
                onChange={(event) => setChangePasswordConfirm(event.target.value)}
                placeholder="Ripeti la nuova password"
              />
            </label>
            {changePasswordError ? <p className="error">{changePasswordError}</p> : null}
            {changePasswordSuccess ? <p className="success">{changePasswordSuccess}</p> : null}
            <button className="cta" type="submit">Aggiorna password</button>
          </form>
        </article>
      ) : null}

      {role === 'store' ? (
        <>
          <section className="store-nav">
            <button
              type="button"
              className={`ghost small ${storePage === 'operations' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('operations')}
            >
              Operazioni {customers.length > 0 ? <span className="tab-badge">{customers.length}</span> : null}
            </button>
            <button
              type="button"
              className={`ghost small ${storePage === 'new-customer' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('new-customer')}
            >
              Nuovo cliente
            </button>
            <button
              type="button"
              className={`ghost small ${storePage === 'rewards' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('rewards')}
            >
              Premi {rewards.length > 0 ? <span className="tab-badge">{rewards.length}</span> : null}
            </button>
            <button
              type="button"
              className={`ghost small ${storePage === 'security' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('security')}
            >
              Sicurezza
            </button>
          </section>

          {storePage === 'operations' ? (
        <section className="store-shell">
          <article className="card customers-sidebar">
            <h2>Clienti <span className="badge">{filteredCustomers.length}</span></h2>
            <label>
              Cerca cliente
              <input
                type="text"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Nome o telefono"
              />
            </label>
            <ul className="customer-list">
              {filteredCustomers.length ? (
                filteredCustomers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className={`customer-item ${selectedStoreCustomerId === customer.id ? 'active' : ''}`}
                      onClick={() => { setSelectedStoreCustomerId(customer.id); setShowAllMovements(false) }}
                    >
                      <span>{customer.name}</span>
                      <strong>{customer.points} pt</strong>
                    </button>
                  </li>
                ))
              ) : (
                <li className="hint no-top">Nessun cliente trovato</li>
              )}
            </ul>
          </article>

          <div className="grid store-main">
            <article className="card selected-customer-card">
              <h2>Cliente selezionato</h2>
              {selectedStoreCustomer ? (
                <>
                  <p className="customer-name">{selectedStoreCustomer.name}</p>
                  <p className="points-balance mini">{selectedStoreCustomer.points} punti</p>
                  <p className="hint no-top">Telefono: {selectedStoreCustomer.phone}</p>

                  <h3 className="subsection-title">
                    Movimenti cliente
                    {customerMovements.length > 7 ? (
                      <button
                        type="button"
                        className="badge badge-btn"
                        onClick={() => setShowAllMovements((v) => !v)}
                        title={showAllMovements ? 'Mostra solo ultimi 7' : 'Mostra tutti'}
                      >
                        {showAllMovements ? `tutti (${customerMovements.length})` : `+${customerMovements.length - 7} altri`}
                      </button>
                    ) : customerMovements.length > 0 ? (
                      <span className="badge">{customerMovements.length}</span>
                    ) : null}
                  </h3>
                  <ul className="movements">
                    {customerMovements.length ? (
                      (showAllMovements ? customerMovements : customerMovements.slice(0, 7)).map((movement) => (
                        <li key={movement.id} className={`movement-${movement.kind}`}>
                          <div>
                            <strong>
                              {movement.kind === 'earn' ? '+ ' : '- '}
                              {movement.points} pt
                            </strong>
                            <p>{movement.note ?? 'Movimento punti'}</p>
                          </div>
                          <time>{new Date(movement.created_at).toLocaleDateString('it-IT')}</time>
                        </li>
                      ))
                    ) : (
                      <li>Nessun movimento disponibile</li>
                    )}
                  </ul>
                </>
              ) : (
                <p className="hint no-top">Seleziona un cliente dalla lista.</p>
              )}
            </article>

            <article className="card">
              <h2>Gestione punti</h2>
              <form onSubmit={addPoints} className="stack split no-top-border">
                <label>
                  Spesa in EUR
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseAmount}
                    onChange={(event) => setExpenseAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <p className="preview">Punti da aggiungere: {pointsPreview}</p>
                <button className="cta" type="submit" disabled={!selectedStoreCustomer}>
                  Registra spesa
                </button>
              </form>

              <form onSubmit={redeemPoints} className="stack split">
                <label>
                  Punti da redimere
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={redeemAmount}
                    onChange={(event) => setRedeemAmount(event.target.value)}
                    placeholder="Es: 10"
                  />
                </label>
                <button className="ghost" type="submit" disabled={!selectedStoreCustomer}>
                  Redimi punti
                </button>
              </form>
            </article>
          </div>
        </section>
          ) : storePage === 'new-customer' ? (
            <section className="store-single-page">
              <article className="card">
                <h2>Nuovo cliente</h2>
                <form onSubmit={addCustomer} className="stack">
                  <label>
                    Nome e cognome
                    <input
                      value={newCustomerName}
                      onChange={(event) => setNewCustomerName(event.target.value)}
                      placeholder="Es: Luca Verdi"
                    />
                  </label>
                  <label>
                    Giorno/Mese di nascita
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      value={newCustomerBirthDayMonth}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '').slice(0, 4)
                        const formatted = digits.length > 2
                          ? `${digits.slice(0, 2)}/${digits.slice(2)}`
                          : digits
                        setNewCustomerBirthDayMonth(formatted)
                      }}
                      placeholder="Es: 23/07"
                    />
                  </label>
                  <label>
                    Parola extra (se username già usato)
                    <input
                      type="text"
                      value={newCustomerExtraWord}
                      onChange={(event) => setNewCustomerExtraWord(event.target.value)}
                      placeholder="Es: Milano"
                    />
                  </label>
                  {(newCustomerName || newCustomerBirthDayMonth) ? (
                    <p className="username-preview">
                      Username: <strong>{buildUsername(newCustomerName, newCustomerExtraWord, newCustomerBirthDayMonth)}</strong>
                    </p>
                  ) : null}
                  <label>
                    Telefono
                    <input
                      value={newCustomerPhone}
                      onChange={(event) => setNewCustomerPhone(event.target.value)}
                      placeholder="Es: 3401234567"
                    />
                  </label>
                  <p className="hint no-top">
                    Password iniziale cliente: numero di telefono inserito.
                  </p>
                  {newCustomerError ? <p className="error">{newCustomerError}</p> : null}
                  {newCustomerSuccess ? <p className="success">{newCustomerSuccess}</p> : null}
                  <button className="cta" type="submit">
                    Crea cliente
                  </button>
                </form>
              </article>
            </section>
          ) : storePage === 'rewards' ? (
            <section className="store-single-page">
              <article className="card">
                <h2>Gestione premi</h2>
                <p className="hint no-top" style={{marginBottom:'1rem'}}>I premi attivi sono visibili ai clienti nella loro home.</p>

                {rewards.length > 0 ? (
                  <ul className="rewards-list">
                    {rewards.map((reward) => (
                      <li key={reward.id} className={`reward-item ${reward.active ? '' : 'reward-inactive'}`}>
                        <div className="reward-info">
                          <strong>{reward.name}</strong>
                          <span className="reward-cost">{reward.points_cost} pt</span>
                          {reward.description ? <p className="reward-desc">{reward.description}</p> : null}
                        </div>
                        <div className="reward-actions">
                          <button
                            type="button"
                            className="ghost small"
                            onClick={() => toggleReward(reward)}
                          >
                            {reward.active ? 'Disattiva' : 'Attiva'}
                          </button>
                          <button
                            type="button"
                            className="ghost small danger"
                            onClick={() => deleteReward(reward)}
                          >
                            Elimina
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint no-top" style={{marginBottom:'1rem'}}>Nessun premio configurato. Aggiungine uno qui sotto.</p>
                )}

                <form onSubmit={addReward} className="stack split">
                  <h3 style={{margin:0, fontSize:'0.96rem'}}>Aggiungi premio</h3>
                  <label>
                    Nome premio
                    <input
                      value={newRewardName}
                      onChange={(e) => setNewRewardName(e.target.value)}
                      placeholder="Es: Caffè gratis"
                    />
                  </label>
                  <label>
                    Descrizione (opzionale)
                    <input
                      value={newRewardDescription}
                      onChange={(e) => setNewRewardDescription(e.target.value)}
                      placeholder="Es: Un caffè a scelta"
                    />
                  </label>
                  <label>
                    Costo in punti
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={newRewardPoints}
                      onChange={(e) => setNewRewardPoints(e.target.value)}
                      placeholder="Es: 50"
                    />
                  </label>
                  {rewardError ? <p className="error">{rewardError}</p> : null}
                  <button className="cta" type="submit">Aggiungi premio</button>
                </form>
              </article>
            </section>
          ) : (
            <section className="grid two-cols" style={{marginBottom:'1rem'}}>
              <article className="card">
                <h2>Cambia mia password</h2>
                <form className="stack" onSubmit={changePassword}>
                  <label>
                    Password attuale
                    <input
                      type="password"
                      value={changePasswordCurrent}
                      onChange={(event) => setChangePasswordCurrent(event.target.value)}
                      placeholder="Inserisci la password attuale"
                    />
                  </label>
                  <label>
                    Nuova password
                    <input
                      type="password"
                      value={changePasswordNew}
                      onChange={(event) => setChangePasswordNew(event.target.value)}
                      placeholder="Almeno 8 caratteri"
                    />
                  </label>
                  <label>
                    Conferma nuova password
                    <input
                      type="password"
                      value={changePasswordConfirm}
                      onChange={(event) => setChangePasswordConfirm(event.target.value)}
                      placeholder="Ripeti la nuova password"
                    />
                  </label>
                  {changePasswordError ? <p className="error">{changePasswordError}</p> : null}
                  {changePasswordSuccess ? <p className="success">{changePasswordSuccess}</p> : null}
                  <button className="cta" type="submit">Aggiorna password</button>
                </form>
              </article>

              <article className="card">
                <h2>Reset password socio</h2>
                <p className="hint" style={{marginBottom:'0.7rem'}}>Usa questa funzione se un socio ha dimenticato la password.</p>
                <form className="stack" onSubmit={resetStoreUserPassword}>
                  <label>
                    Username socio
                    <input
                      type="text"
                      value={resetStoreUsername}
                      onChange={(event) => setResetStoreUsername(event.target.value)}
                      placeholder="Es: TommySmoke01"
                    />
                  </label>
                  <label>
                    Nuova password
                    <input
                      type="password"
                      value={resetStorePassword}
                      onChange={(event) => setResetStorePassword(event.target.value)}
                      placeholder="Almeno 8 caratteri"
                    />
                  </label>
                  <label>
                    Conferma password
                    <input
                      type="password"
                      value={resetStoreConfirm}
                      onChange={(event) => setResetStoreConfirm(event.target.value)}
                      placeholder="Ripeti la password"
                    />
                  </label>
                  {resetStoreError ? <p className="error">{resetStoreError}</p> : null}
                  {resetStoreSuccess ? <p className="success">{resetStoreSuccess}</p> : null}
                  <button className="cta" type="submit">Reimposta password socio</button>
                </form>

                <form onSubmit={resetCustomerPasswordFn} className="stack split">
                  <label>
                    Reset password cliente
                    <input
                      type="password"
                      value={resetCustomerPassword}
                      onChange={(event) => setResetCustomerPassword(event.target.value)}
                      placeholder={
                        selectedStoreCustomer
                          ? `Nuova password per ${selectedStoreCustomer.name}`
                          : 'Seleziona un cliente dalla barra laterale'
                      }
                      disabled={!selectedStoreCustomer}
                    />
                  </label>
                  {resetCustomerError ? <p className="error">{resetCustomerError}</p> : null}
                  {resetCustomerSuccess ? <p className="success">{resetCustomerSuccess}</p> : null}
                  <button className="ghost" type="submit" disabled={!selectedStoreCustomer}>
                    Reimposta password cliente
                  </button>
                </form>
              </article>
            </section>
          )}
        </>
      ) : (
        <section className="grid customer-view">
          <article className="card hero-card">
            <h2>I tuoi punti</h2>
            {customerView ? (
              <p className="points-balance">{customerView.points} punti</p>
            ) : (
              <p className="hint no-top">Cliente non trovato</p>
            )}
          </article>

          <article className="card">
            <h2>
              Ultimi movimenti
              {customerMovements.length > 7 ? (
                <span className="badge" style={{marginLeft:'0.5rem'}} title={`${customerMovements.length} movimenti totali`}>
                  e molti altri...
                </span>
              ) : customerMovements.length > 0 ? (
                <span className="badge" style={{marginLeft:'0.5rem'}}>{customerMovements.length}</span>
              ) : null}
            </h2>
            <ul className="movements">
              {customerMovements.length ? (
                customerMovements.slice(0, 7).map((movement) => (
                  <li key={movement.id} className={`movement-${movement.kind}`}>
                    <div>
                      <strong>
                        {movement.kind === 'earn' ? '+ ' : '- '}
                        {movement.points} pt
                      </strong>
                      <p>{movement.note ?? 'Movimento punti'}</p>
                    </div>
                    <time>{new Date(movement.created_at).toLocaleDateString('it-IT')}</time>
                  </li>
                ))
              ) : (
                <li>Nessun movimento disponibile</li>
              )}
            </ul>
          </article>

          {rewards.length > 0 ? (
            <article className="card customer-rewards-card">
              <h2>Premi disponibili</h2>
              <p className="hint no-top" style={{marginBottom:'0.8rem'}}>
                Hai <strong>{customerView?.points ?? 0} punti</strong>. Mostra questo schermo in negozio per riscattare un premio.
              </p>
              <ul className="rewards-list">
                {rewards.map((reward) => {
                  const canRedeem = (customerView?.points ?? 0) >= reward.points_cost
                  return (
                    <li key={reward.id} className={`reward-item ${canRedeem ? 'reward-reachable' : 'reward-locked'}`}>
                      <div className="reward-info">
                        <strong>{reward.name}</strong>
                        <span className="reward-cost">{reward.points_cost} pt</span>
                        {reward.description ? <p className="reward-desc">{reward.description}</p> : null}
                      </div>
                      <span className="reward-status">
                        {canRedeem ? '✓ Riscattabile' : `Mancano ${reward.points_cost - (customerView?.points ?? 0)} pt`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </article>
          ) : null}
        </section>
      )}

    </main>
  )
}

export default App
