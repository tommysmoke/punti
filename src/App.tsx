import type { FormEvent} from 'react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { registerForPushNotifications, setupMessageListener } from './lib/notifications'
import { CUSTOMERS_PAGE_SIZE, DEBOUNCE_SEARCH_MS, MAX_CUSTOMER_MOVEMENTS_VISIBLE, MAX_VISIBLE_NOTIFICATIONS, NOTIFICATIONS_MAX_COUNT, NOTIFICATIONS_RECENT_HOURS, POINTS_DIVISOR, TOAST_DURATION_MS } from './lib/constants'
import { buildUsername } from './lib/username'
import { loadSoundPreference, playEarnSound, playRedeemSound, playSuccessSound, saveSoundPreference, setSoundEnabled } from './lib/sounds'
import { useAppState } from './hooks/useAppState'
import { useHashRoute } from './hooks/useHashRoute'
import type { Customer, Movement, Profile, Reward, Toast } from './hooks/useAppState'
import { Sparkline } from './components/Sparkline'

const StoreNotifications = lazy(() => import('./components/StoreNotifications').then(m => ({ default: m.StoreNotifications })))
import { LoginPage } from './components/LoginPage'
import { CustomerSidebar } from './components/CustomerSidebar'
import { ConfirmModal } from './components/ConfirmModal'

function capitalizeWords(str: string): string {
  return str.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function App() {
  const state = useAppState()
  const {
    sessionLoading, setSessionLoading,
    role, setRole,
    profile, setProfile,
    initError, setInitError,
    customers, setCustomers,
    selectedStoreCustomerId, setSelectedStoreCustomerId,
    customerMovements, setCustomerMovements,
    rewards, setRewards,
    recentNotifications, setRecentNotifications,
    loadingData, setLoadingData,
    notificationPermissionRequested, setNotificationPermissionRequested,
    pushStatus, setPushStatus,
    dismissedNotificationIds, setDismissedNotificationIds,
    loginIdentifier, setLoginIdentifier,
    loginPassword, setLoginPassword,
    loginError, setLoginError,
    loginLoading, setLoginLoading,
    visiblePasswords, setVisiblePasswords,
    actionError, setActionError,
    toast, setToast,
    confirmModal, setConfirmModal,
    isOnline, setIsOnline,
    showOverride, setShowOverride,
    newCustomerName, setNewCustomerName,
    newCustomerPhone, setNewCustomerPhone,
    newCustomerBirthDayMonth, setNewCustomerBirthDayMonth,
    newCustomerNote, setNewCustomerNote,
    newCustomerSuccess, setNewCustomerSuccess,
    newCustomerError, setNewCustomerError,
    expenseAmount, setExpenseAmount,
    redeemAmount, setRedeemAmount,
    overrideAmount, setOverrideAmount,
    newRewardName, setNewRewardName,
    newRewardDescription, setNewRewardDescription,
    newRewardPoints, setNewRewardPoints,
    rewardError, setRewardError,
    editingCustomerId, setEditingCustomerId,
    editCustomerName, setEditCustomerName,
    editCustomerPhone, setEditCustomerPhone,
    editCustomerBirthDayMonth, setEditCustomerBirthDayMonth,
    editCustomerOriginalPhone, setEditCustomerOriginalPhone,
    editCustomerError, setEditCustomerError,
    savingCustomerEdit, setSavingCustomerEdit,
    addingPoints, setAddingPoints,
    redeemingPoints, setRedeemingPoints,
    overridingPoints, setOverridingPoints,
    creatingCustomer, setCreatingCustomer,
    addingReward, setAddingReward,
    customerSearch, setCustomerSearch,
    debouncedSearch, setDebouncedSearch,
  } = state

  const { route: storePage, navigate: setStorePage } = useHashRoute()

  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    setIsEditingNotes(false)
    setNotesDraft('')
  }, [selectedStoreCustomerId])

  useEffect(() => {
    if (!role) {
      setStorePage(null)
    } else if (role === 'customer') {
      setStorePage('cliente')
    } else if (role === 'store' && !storePage) {
      setStorePage('operations')
    }
  }, [role, storePage, setStorePage])

  const tab = storePage ?? 'operations'

  const selectedStoreCustomerIdRef = useRef(selectedStoreCustomerId)
  selectedStoreCustomerIdRef.current = selectedStoreCustomerId
  const initialBootstrapDone = useRef(false)

  const [soundEnabled, setSoundEnabledState] = useState(() => loadSoundPreference())
  const [floatingPoints, setFloatingPoints] = useState<{ id: number; delta: number; kind: string }[]>([])
  const floatIdRef = useRef(0)
  const [balancePop, setBalancePop] = useState(false)

  const triggerFloatingPoints = (delta: number, kind: string) => {
    const id = ++floatIdRef.current
    setFloatingPoints((prev) => [...prev, { id, delta, kind }])
    setTimeout(() => {
      setFloatingPoints((prev) => prev.filter((f) => f.id !== id))
    }, 1500)
  }

  const triggerBalancePop = () => {
    setBalancePop(true)
    setTimeout(() => setBalancePop(false), 400)
  }

  const toggleSound = () => {
    const next = !soundEnabled
    setSoundEnabledState(next)
    setSoundEnabled(next)
    saveSoundPreference(next)
  }

  const visibleNotifications = useMemo(() => {
    return recentNotifications
      .filter((n) => !dismissedNotificationIds.includes(n.id))
      .slice(0, MAX_VISIBLE_NOTIFICATIONS)
  }, [recentNotifications, dismissedNotificationIds])

  const handleDismissNotification = (id: number) => {
    setDismissedNotificationIds((prev) => {
      const next = [...prev, id]
      localStorage.setItem('comms_dismissed', JSON.stringify(next))
      return next
    })
  }

  const pointsPreview = useMemo(() => {
    const amount = Number(expenseAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0
    }

    return Math.floor(amount / POINTS_DIVISOR)
  }, [expenseAmount])

  const selectedStoreCustomer = customers.find(
    (customer) => customer.id === selectedStoreCustomerId,
  )

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(customerSearch), DEBOUNCE_SEARCH_MS)
    return () => clearTimeout(timer)
  }, [customerSearch])

  const filteredCustomers = customers.filter((customer) => {
    const needle = debouncedSearch.trim().toLowerCase()
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

  const safeAsync = (fn: () => Promise<unknown>, errorCtx?: string) => {
    fn().catch((err: unknown) => {
      console.error(errorCtx ?? 'safeAsync error', err)
      if (errorCtx) pushToast('error', errorCtx)
    })
  }

  const togglePasswordVisibility = (field: string) => {
    setVisiblePasswords((current) => ({
      ...current,
      [field]: !current[field],
    }))
  }

  const customerView =
    role === 'customer'
      ? customers.find((customer) => customer.id === profile?.customer_id)
      : selectedStoreCustomer

  const displayName =
    role === 'store'
      ? 'Team Negozio'
      : customerView?.name.split(' ')[0] ?? 'Cliente'

  useEffect(() => {
    if (role === 'store') {
      document.title = 'Tommy Smoke - Punti - Pannello di Controllo'
      return
    }

    if (role === 'customer') {
      document.title = 'Tommy Smoke - Punti - Profilo Cliente'
      return
    }

    document.title = 'Tommy Smoke - Punti - Login'
  }, [role])

  const activeRewards = useMemo(
    () => rewards.filter((reward) => reward.active),
    [rewards],
  )

  const selectedCustomerReachableRewards = useMemo(() => {
    if (!selectedStoreCustomer) {
      return []
    }

    return activeRewards.filter((reward) => reward.points_cost <= selectedStoreCustomer.points)
  }, [activeRewards, selectedStoreCustomer])

  const selectedCustomerNextReward = useMemo(() => {
    if (!selectedStoreCustomer) {
      return null
    }

    return activeRewards.find((reward) => reward.points_cost > selectedStoreCustomer.points) ?? null
  }, [activeRewards, selectedStoreCustomer])

  const customerVisibleMovements = useMemo(
    () => customerMovements.filter((movement) => !(movement.kind === 'adjust' && /sovrascrittura/i.test(movement.note ?? ''))),
    [customerMovements],
  )

  const customerStoreId = useMemo(() => {
    if (role !== 'customer' || !profile?.customer_id) {
      return null
    }

    return customers.find((customer) => customer.id === profile.customer_id)?.store_id ?? null
  }, [customers, profile?.customer_id, role])

  const previewDisplayName = newCustomerNote.trim()
    ? `${capitalizeWords(newCustomerName.trim())} (${newCustomerNote.trim()})`
    : capitalizeWords(newCustomerName.trim())

  const previewUsername = buildUsername(newCustomerName, newCustomerBirthDayMonth)

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

  const loadRecentNotifications = async (storeId: string) => {
    if (!supabase) return
    const oneDayAgo = new Date(Date.now() - NOTIFICATIONS_RECENT_HOURS * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('store_notifications')
      .select('id, title, body, created_at')
      .eq('store_id', storeId)
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(NOTIFICATIONS_MAX_COUNT)
    setRecentNotifications((data ?? []) as { id: number; title: string; body: string; created_at: string }[])
  }

  const addReward = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !profile?.store_id || addingReward) return

    const name = newRewardName.trim()
    const cost = Number(newRewardPoints)
    if (!name || !cost || cost <= 0) {
      setRewardError('Inserisci nome e costo in punti valido')
      return
    }

    setRewardError('')
    setAddingReward(true)
    try {
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
      playSuccessSound()
      pushToast('success', `Premio "${name}" aggiunto`)
      await loadRewards(profile.store_id)
    } finally {
      setAddingReward(false)
    }
  }

  const toggleReward = async (reward: Reward) => {
    if (!supabase || !profile?.store_id) return
    await supabase.from('rewards').update({ active: !reward.active }).eq('id', reward.id)
    await loadRewards(profile.store_id)
  }

  const askDeleteReward = (reward: Reward) => {
    setConfirmModal({
      action: 'delete-reward',
      message: `Eliminare il premio "${reward.name}"? Non sarà più disponibile per i clienti.`,
      rewardId: reward.id,
    })
  }

  const confirmDeleteReward = async () => {
    if (!supabase || !profile?.store_id || !confirmModal?.rewardId) return

    const rewardId = confirmModal.rewardId
    setConfirmModal(null)

    const { error } = await supabase.from('rewards').delete().eq('id', rewardId)
    if (error) {
      pushToast('error', 'Eliminazione premio non riuscita')
      return
    }
    pushToast('success', 'Premio eliminato')
    await loadRewards(profile.store_id)
  }

  const loadStoreCustomers = async (storeId: string) => {
    if (!supabase) {
      return
    }

    const all: Customer[] = []
    let page = 0
    const pageSize = CUSTOMERS_PAGE_SIZE

    while (true) {
      const { data, error } = await supabase
        .from('customers')
        .select('id, store_id, name, phone, points, birth_day_month, notes')
        .eq('store_id', storeId)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(page * pageSize, page * pageSize + pageSize - 1)

      if (error) {
        throw error
      }

      const chunk = (data ?? []) as Customer[]
      all.push(...chunk)

      if (chunk.length < pageSize) break
      page++
    }

    // Fetch all usernames for these customers via RPC (bypasses RLS)
    if (all.length > 0) {
      const customerIds = all.map((c) => c.id)
      const usernameMap = new Map<number, string>()
      let p = 0
      while (true) {
        const chunk = customerIds.slice(p * 1000, p * 1000 + 1000)
        if (chunk.length === 0) break
        const { data: profiles, error: profErr } = await supabase
          .rpc('get_customer_usernames', { p_customer_ids: chunk })
        console.log('1) batch', p, 'err:', profErr, 'rows:', profiles?.length)
        if (!profErr && profiles) {
          for (const prof of profiles as { customer_id: number; username: string }[]) {
            if (prof.customer_id && prof.username) {
              usernameMap.set(prof.customer_id, prof.username)
            }
          }
        }
        p++
      }
      console.log('2) usernameMap size:', usernameMap.size, 'of', customerIds.length, 'customers')
      for (let i = 0; i < all.length; i++) {
        all[i] = { ...all[i], username: usernameMap.get(all[i].id) ?? null }
      }
      console.log('3) first all item:', all[0]?.id, all[0]?.username, 'last:', all[all.length-1]?.username)
    }

    // Deduplicate in case of pagination drift
    const unique = new Map<number, Customer>()
    for (const c of all) {
      if (!unique.has(c.id)) unique.set(c.id, c)
    }
    const nextCustomers = Array.from(unique.values())
    console.log('4) nextCustomers[0]:', nextCustomers[0]?.id, nextCustomers[0]?.username)
    setCustomers(nextCustomers)
    console.log('5) setCustomers called')

    if (nextCustomers.length === 0) {      setSelectedStoreCustomerId(null)
      setCustomerMovements([])
      return
    }

    const currentSelectedId = selectedStoreCustomerIdRef.current

    const keepCurrent =
      currentSelectedId !== null &&
      nextCustomers.some((c) => c.id === currentSelectedId)

    if (!keepCurrent) {
      setSelectedStoreCustomerId(null)
      setCustomerMovements([])
      return
    }

    await loadCustomerMovements(currentSelectedId)
  }

  useEffect(() => {
    console.log('6) customers state updated:', customers.length, 'items')
    if (customers.length > 0) {
      console.log('6a) first:', customers[0].id, customers[0].username)
      const sel = customers.find(c => c.id === selectedStoreCustomerId)
      if (sel) console.log('6b) selected:', sel.id, sel.username, 'name:', sel.name)
      else console.log('6b) no selected customer (selectedStoreCustomerId:', selectedStoreCustomerId, ')')
    }
  }, [customers, selectedStoreCustomerId])

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
        await Promise.all([
          loadStoreCustomers(nextProfile.store_id),
          loadRewards(nextProfile.store_id),
          loadRecentNotifications(nextProfile.store_id),
        ])
      }

      if (nextProfile.role === 'customer' && nextProfile.customer_id) {
        await loadCustomerHome(nextProfile.customer_id)
        if (!supabase) return
        const { data: custData } = await supabase
          .from('customers')
          .select('store_id')
          .eq('id', nextProfile.customer_id)
          .single()
        if (custData?.store_id) {
          await loadCustomerRewards(custData.store_id)
          await loadRecentNotifications(custData.store_id)
        }

        // Register for push notifications
        if (!notificationPermissionRequested) {
          setPushStatus('Registrazione notifiche in corso...')
          const token = await registerForPushNotifications(nextProfile.customer_id)
          if (token) {
            setPushStatus('Notifiche push attive')
          } else {
            setPushStatus('Notifiche push non disponibili su questo dispositivo')
          }
          await setupMessageListener()
          setNotificationPermissionRequested(true)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Non sono riuscito a caricare i dati del profilo'
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
      try {
        const { data } = await client.auth.getSession()
        const user = data.session?.user

        if (user) {
          try {
            const nextProfile = await fetchProfile(user.id)
            if (nextProfile) {
              await bootstrapFromProfile(nextProfile)
              initialBootstrapDone.current = true
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Errore nel caricamento del profilo'
            setInitError(message)
          }
        }
      } finally {
        setSessionLoading(false)
      }
    }

    safeAsync(initialize)

    const { data: authListener } = client.auth.onAuthStateChange(async (event, session) => {
      if (!session?.user) {
        setRole(null)
        setProfile(null)
        setCustomers([])
        setCustomerMovements([])
        setSelectedStoreCustomerId(null)
        setSessionLoading(false)
        return
      }

      if (event === 'INITIAL_SESSION' && initialBootstrapDone.current) {
        return
      }

      try {
        const nextProfile = await fetchProfile(session.user.id)
        if (nextProfile) {
          await bootstrapFromProfile(nextProfile)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Errore nel caricamento del profilo'
        setInitError(message)
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

    safeAsync(() => loadCustomerMovements(selectedStoreCustomerId))
  }, [role, selectedStoreCustomerId])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timeoutId = setTimeout(() => {
      setToast(null)
    }, TOAST_DURATION_MS)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [toast])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!supabase || !profile || !role || !isOnline) {
      return
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (role === 'store' && profile.store_id) {
          safeAsync(() => Promise.all([
            loadStoreCustomers(profile.store_id!),
            loadRewards(profile.store_id!),
            loadRecentNotifications(profile.store_id!),
          ]), 'Sincronizzazione dati fallita')
        }
        if (role === 'customer' && profile.customer_id) {
          safeAsync(async () => {
            await loadCustomerHome(profile.customer_id!)
            const { data: custData } = await supabase!
              .from('customers')
              .select('store_id')
              .eq('id', profile.customer_id!)
              .single()
            if (custData?.store_id) {
              await Promise.all([
                loadCustomerRewards(custData.store_id),
                loadRecentNotifications(custData.store_id),
              ])
            }
          }, 'Sincronizzazione dati fallita')
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isOnline, profile, role])

  useEffect(() => {
    if (!supabase || !profile) {
      return
    }

    const client = supabase
    const channels: ReturnType<typeof client.channel>[] = []

    if (role === 'store' && profile.store_id) {
      const customerChannel = client
        .channel(`store-customers-${profile.store_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'customers',
            filter: `store_id=eq.${profile.store_id}`,
          },
          () => {
            const storeId = profile?.store_id
            if (!storeId) return
            safeAsync(() => loadStoreCustomers(storeId))
          },
        )
        .subscribe()

      const rewardsChannel = client
        .channel(`store-rewards-${profile.store_id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rewards', filter: `store_id=eq.${profile.store_id}` },
          () => {
            const storeId = profile?.store_id
            if (!storeId) return
            safeAsync(() => loadRewards(storeId))
          },
        )
        .subscribe()

      const notificationsChannel = client
        .channel(`store-notifications-${profile.store_id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'store_notifications', filter: `store_id=eq.${profile.store_id}` },
          () => {
            const storeId = profile?.store_id
            if (!storeId) return
            safeAsync(() => loadRecentNotifications(storeId))
          },
        )
        .subscribe()

      channels.push(customerChannel, rewardsChannel, notificationsChannel)
    }

    if (role === 'customer' && profile.customer_id) {
      const customerChannel = client
        .channel(`customer-home-${profile.customer_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'customers',
            filter: `id=eq.${profile.customer_id}`,
          },
          () => {
            const cid = profile?.customer_id
            if (!cid) return
            safeAsync(() => loadCustomerHome(cid))
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'point_transactions',
            filter: `customer_id=eq.${profile.customer_id}`,
          },
          () => {
            const cid = profile?.customer_id
            if (!cid) return
            safeAsync(() => loadCustomerHome(cid))
          },
        )
        .subscribe()

      channels.push(customerChannel)
    }

    return () => {
      channels.forEach((channel) => {
        safeAsync(() => client.removeChannel(channel))
      })
    }
  }, [profile, role])

  useEffect(() => {
    if (!supabase || role !== 'customer') return
    if (!customerStoreId) return

    const client = supabase
    const channels: ReturnType<typeof client.channel>[] = []

    const rewardsChannel = client
      .channel(`customer-rewards-${customerStoreId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rewards', filter: `store_id=eq.${customerStoreId}` },
        () => { safeAsync(() => loadCustomerRewards(customerStoreId)) },
      )
      .subscribe()

    const notificationsChannel = client
      .channel(`customer-notifications-${customerStoreId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'store_notifications', filter: `store_id=eq.${customerStoreId}` },
        () => { safeAsync(() => loadRecentNotifications(customerStoreId)) },
      )
      .subscribe()

    channels.push(rewardsChannel, notificationsChannel)

    return () => {
      channels.forEach((channel) => {
        safeAsync(() => client.removeChannel(channel))
      })
    }
  }, [supabase, role, customerStoreId])

  useEffect(() => {
    if (!supabase || role !== 'store' || !selectedStoreCustomerId || !profile?.store_id) {
      return
    }

    const client = supabase
    const movementChannel = client
      .channel(`store-customer-tx-${selectedStoreCustomerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'point_transactions',
          filter: `customer_id=eq.${selectedStoreCustomerId}`,
        },
        () => {
          const storeId = profile?.store_id
          if (!storeId) return
          safeAsync(() => loadStoreCustomers(storeId))
        },
      )
      .subscribe()

    return () => {
      safeAsync(() => client.removeChannel(movementChannel))
    }
  }, [profile?.store_id, role, selectedStoreCustomerId])


  const login = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase) {
      setLoginError('Configura prima le variabili Supabase nel file .env')
      return
    }

    if (loginLoading) return

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
          setLoginError('Username non trovato. Controlla e riprova.')
          return
        }

        emailForLogin = data ?? null
      }

      if (!emailForLogin) {
        setLoginError('Username non trovato. Controlla e riprova.')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: emailForLogin,
        password: loginPassword,
      })

      if (error) {
        setLoginError('Password errata. Riprova.')
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

  const askDeleteTransaction = (movement: Movement) => {
    setConfirmModal({
      action: 'delete-transaction',
      message: `Eliminare il movimento di ${Math.abs(movement.points)} punti del ${new Date(movement.created_at).toLocaleDateString('it-IT')}? Il saldo del cliente verrà aggiornato.`,
      transactionId: movement.id,
    })
  }

  const confirmDeleteTransaction = async () => {
    if (!supabase || !confirmModal?.transactionId) {
      return
    }

    const transactionId = confirmModal.transactionId
    setConfirmModal(null)
    setActionError('')

    const { error } = await supabase.rpc('delete_point_transaction', {
      p_transaction_id: transactionId,
    })

    if (error) {
      setActionError(error.message)
      pushToast('error', 'Eliminazione movimento non riuscita')
      return
    }

    pushToast('success', 'Movimento eliminato')
    if (profile?.store_id) {
      await loadStoreCustomers(profile.store_id)
    }
  }

  const askDeleteCustomer = () => {
    if (!selectedStoreCustomer) {
      return
    }

    setConfirmModal({
      action: 'delete-customer',
      message: `Eliminare definitivamente ${selectedStoreCustomer.name}? Verranno rimossi anagrafica, accesso e movimenti.`,
      customerId: selectedStoreCustomer.id,
    })
  }

  const confirmDeleteCustomer = async () => {
    if (!supabase || !confirmModal?.customerId) {
      return
    }

    const customerId = confirmModal.customerId
    const deletedCustomerName = selectedStoreCustomer?.name ?? 'Cliente'
    setConfirmModal(null)
    setActionError('')

    const { error } = await supabase.rpc('delete_customer_account', {
      p_customer_id: customerId,
    })

    if (error) {
      setActionError(error.message)
      pushToast('error', 'Eliminazione cliente non riuscita')
      return
    }

    setSelectedStoreCustomerId(null)
    setCustomerMovements([])
    pushToast('success', `Cliente eliminato: ${deletedCustomerName}`)
    if (profile?.store_id) {
      await loadStoreCustomers(profile.store_id)
    }
  }

  const startEditCustomer = () => {
    if (!selectedStoreCustomer) return
    setEditCustomerName(selectedStoreCustomer.name)
    setEditCustomerPhone(selectedStoreCustomer.phone)
    setEditCustomerBirthDayMonth(selectedStoreCustomer.birth_day_month ?? '')
    setEditCustomerOriginalPhone(selectedStoreCustomer.phone)
    setEditCustomerError('')
    setEditingCustomerId(selectedStoreCustomer.id)
  }

  const cancelEditCustomer = () => {
    setEditingCustomerId(null)
    setEditCustomerName('')
    setEditCustomerPhone('')
    setEditCustomerBirthDayMonth('')
    setEditCustomerOriginalPhone('')
    setEditCustomerError('')
  }

  const saveCustomerEdit = async () => {
    if (!supabase || !editingCustomerId || savingCustomerEdit) return

    const name = capitalizeWords(editCustomerName.trim())
    const phone = editCustomerPhone.replace(/\D/g, '')
    const birthDayMonth = editCustomerBirthDayMonth.trim()

    setEditCustomerError('')

    if (!name) {
      setEditCustomerError('Il nome non può essere vuoto')
      return
    }

    if (phone.length < 8) {
      setEditCustomerError('Numero di telefono non valido (minimo 8 cifre)')
      return
    }

    if (birthDayMonth && !/^\d{2}\/\d{2}$/.test(birthDayMonth)) {
      setEditCustomerError('Formato giorno/mese non valido (usa GG/MM)')
      return
    }

    setSavingCustomerEdit(true)
    try {
      const { error } = await supabase.rpc('update_customer_profile_credentials', {
        p_customer_id: editingCustomerId,
        p_name: name,
        p_phone: phone,
        p_birth_day_month: birthDayMonth || null,
        p_old_phone: editCustomerOriginalPhone,
        p_notes: selectedStoreCustomer?.notes ?? null,
      })

      if (error) {
        setEditCustomerError(error.message)
        pushToast('error', 'Modifica anagrafica non riuscita')
        return
      }

      playSuccessSound()
      pushToast('success', 'Anagrafica aggiornata')
      cancelEditCustomer()
      if (profile?.store_id) {
        await loadStoreCustomers(profile.store_id)
      }
    } catch {
      setEditCustomerError('Errore di rete. Riprova.')
      pushToast('error', 'Modifica anagrafica non riuscita')
    } finally {
      setSavingCustomerEdit(false)
    }
  }

  const startEditNotes = () => {
    if (!selectedStoreCustomer) return
    setNotesDraft(selectedStoreCustomer.notes ?? '')
    setIsEditingNotes(true)
  }

  const cancelEditNotes = () => {
    setIsEditingNotes(false)
    setNotesDraft('')
  }

  const saveNotes = async () => {
    if (!supabase || !selectedStoreCustomer || !profile?.store_id || savingNotes) return
    setSavingNotes(true)
    try {
      const { error } = await supabase
        .from('customers')
        .update({ notes: notesDraft.trim() || null })
        .eq('id', selectedStoreCustomer.id)
      if (error) throw error
      setIsEditingNotes(false)
      pushToast('success', 'Note salvate')
      await loadStoreCustomers(profile.store_id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore nel salvataggio note'
      pushToast('error', message)
    } finally {
      setSavingNotes(false)
    }
  }

  const addCustomer = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !profile?.store_id || creatingCustomer) {
      return
    }

    const name = capitalizeWords(newCustomerName.trim())
    const note = newCustomerNote.trim()
    const phone = newCustomerPhone.replace(/\D/g, '')
    const password = phone
    const birthDayMonth = newCustomerBirthDayMonth.trim()
    const username = buildUsername(name, birthDayMonth)
    const displayName = note ? `${name} (${note})` : name

    setNewCustomerError('')
    setNewCustomerSuccess('')

    if (!name || !phone || !username) {
      setNewCustomerError('Compila nome, giorno/mese e telefono del cliente')
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

    const { data: isAvailable, error: availabilityError } = await supabase.rpc('is_username_available', {
      p_username: username,
    })

    if (availabilityError) {
      setNewCustomerError('Impossibile verificare lo username, riprova')
      return
    }

    if (!isAvailable) {
      setNewCustomerError(
        `Username già in uso: "${username}". Differenzia il nome del cliente ` +
        `aggiungendo un soprannome (es. "${displayName} Bologna" o "${displayName} del centro")`,
      )
      return
    }

    // Client temporaneo con storage separato per non sovrascrivere la sessione store
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { auth: { storageKey: 'sb-temp-reg', autoRefreshToken: false, persistSession: false } }
    )

    const email = `${username}@emailnonesiste.it`

    setCreatingCustomer(true)
    try {
      const { error } = await tempClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: 'customer',
            name: displayName,
            phone,
            username,
            store_id: profile.store_id,
          },
        },
      })

      await tempClient.auth.signOut()

      if (error) {
        setNewCustomerError('Non sono riuscito a creare il cliente. Riprova tra qualche secondo.')
        pushToast('error', 'Creazione cliente non riuscita')
        return
      }

      setNewCustomerSuccess(`Cliente creato! Username: ${username} - Password iniziale: numero di telefono`)
      playSuccessSound()
      pushToast('success', `Cliente creato: ${username}`)
      setNewCustomerName('')
      setNewCustomerNote('')
      setNewCustomerPhone('')
      setNewCustomerBirthDayMonth('')
      await loadStoreCustomers(profile.store_id)
    } finally {
      setCreatingCustomer(false)
    }
  }

  const addPoints = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !selectedStoreCustomer || pointsPreview <= 0 || addingPoints) {
      return
    }

    const amount = Number(expenseAmount)
    setActionError('')
    setAddingPoints(true)

    try {
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
      playEarnSound()
      triggerFloatingPoints(pointsPreview, 'earn')
      triggerBalancePop()
      pushToast('success', `${pointsPreview} punti aggiunti`)
      if (profile?.store_id) {
        await loadStoreCustomers(profile.store_id)
      }
    } finally {
      setAddingPoints(false)
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
    if (!supabase || !selectedStoreCustomer || redeemingPoints) {
      return
    }

    const redeem = Number(redeemAmount)
    if (!Number.isFinite(redeem) || redeem <= 0) {
      return
    }

    setConfirmModal(null)
    setActionError('')
    setRedeemingPoints(true)

    try {
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
      playRedeemSound()
      triggerFloatingPoints(-redeem, 'redeem')
      triggerBalancePop()
      pushToast('success', `${redeem} punti redenti`)
      if (profile?.store_id) {
        await loadStoreCustomers(profile.store_id)
      }
    } finally {
      setRedeemingPoints(false)
    }
  }

  const overridePoints = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase || !selectedStoreCustomer) {
      return
    }

    const points = Number(overrideAmount)
    if (!Number.isFinite(points) || points < 0) {
      return
    }

    setConfirmModal({
      action: 'override',
      message: `Sovrascrivere i punti di ${selectedStoreCustomer.name} da ${selectedStoreCustomer.points} a ${points}?`,
    })
  }

  const confirmOverride = async () => {
    if (!supabase || !selectedStoreCustomer || overridingPoints) {
      return
    }

    const points = Number(overrideAmount)
    if (!Number.isFinite(points) || points < 0) {
      return
    }

    setConfirmModal(null)
    setActionError('')
    setOverridingPoints(true)

    try {
      const { error } = await supabase.rpc('set_customer_points', {
        p_customer_id: selectedStoreCustomer.id,
        p_new_points: points,
      })

      if (error) {
        setActionError(error.message)
        pushToast('error', 'Sovrascrittura punti non riuscita')
        return
      }

      setOverrideAmount('')
      const delta = points - selectedStoreCustomer.points
      if (delta > 0) {
        playEarnSound()
        triggerFloatingPoints(delta, 'earn')
      } else if (delta < 0) {
        playRedeemSound()
        triggerFloatingPoints(delta, 'redeem')
      }
      triggerBalancePop()
      pushToast('success', `Punti sovrascritti a ${points}`)
      if (profile?.store_id) {
        await loadStoreCustomers(profile.store_id)
      }
    } finally {
      setOverridingPoints(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="app-shell auth-layout">
        <section className="card auth-card">
          <p className="eyebrow">Tommy Smoke</p>
          <h1 className="auth-hero-title" aria-label="Tommy Smoke Raccolta Punti">
            <span className="auth-hero-word auth-hero-fill">Tommy</span>
            <span className="auth-hero-word auth-hero-fill">Smoke</span>
            <span className="auth-hero-word">Raccolta</span>
            <span className="auth-hero-word">Punti</span>
          </h1>
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
      <LoginPage
        loginIdentifier={loginIdentifier}
        onLoginIdentifierChange={setLoginIdentifier}
        loginPassword={loginPassword}
        onLoginPasswordChange={setLoginPassword}
        loginError={loginError}
        loginLoading={loginLoading}
        visiblePasswords={visiblePasswords}
        onTogglePasswordVisibility={togglePasswordVisibility}
        onLogin={login}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">Tommy Smoke's Punti</p>
          <h1 className="topbar-hero-title">Ciao {displayName}</h1>
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
          {import.meta.env.VITE_GIT_SHA ? (
            <details className="store-code-box">
              <summary>Versione</summary>
              <p>{import.meta.env.VITE_GIT_SHA.slice(0, 7)}</p>
            </details>
          ) : null}
          <span
            className={`sound-toggle${soundEnabled ? ' on' : ''}`}
            onClick={toggleSound}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') toggleSound() }}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </span>
          <button className="ghost small" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {toast ? <p className={`toast ${toast.type}`}>{toast.message}</p> : null}

      {!isOnline ? (
        <p className="error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
          <span>Connessione assente. I dati si aggiorneranno al ripristino della connessione.</span>
        </p>
      ) : null}

      {initError ? (
        <p className="error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
          <span>{initError}</span>
          <button className="ghost small" type="button" onClick={async () => {
            setInitError(null)
            setSessionLoading(true)
            try {
              if (!supabase) return
              const { data } = await supabase.auth.getSession()
              if (data.session?.user) {
                const nextProfile = await fetchProfile(data.session.user.id)
                if (nextProfile) await bootstrapFromProfile(nextProfile)
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Errore nel caricamento del profilo'
              setInitError(message)
            } finally {
              setSessionLoading(false)
            }
          }}>
            Riprova
          </button>
        </p>
      ) : null}

      {confirmModal ? (
        <ConfirmModal
          modal={confirmModal}
          isProcessing={addingPoints || redeemingPoints || overridingPoints || creatingCustomer || addingReward}
          onClose={() => setConfirmModal(null)}
          onConfirm={async (action) => {
            if (action === 'redeem') await confirmRedeem()
            else if (action === 'override') await confirmOverride()
            else if (action === 'delete-transaction') await confirmDeleteTransaction()
            else if (action === 'delete-customer') await confirmDeleteCustomer()
            else if (action === 'delete-reward') await confirmDeleteReward()
          }}
        />
      ) : null}

      {actionError ? <p className="error">{actionError}</p> : null}

      {role === 'store' ? (
        <>
          <section className="store-nav">
            <button
              type="button"
              className={`ghost small ${tab === 'operations' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('operations')}
            >
              Operazioni
            </button>
            <button
              type="button"
              className={`ghost small ${tab === 'new-customer' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('new-customer')}
            >
              Nuovo cliente
            </button>
            <button
              type="button"
              className={`ghost small ${tab === 'rewards' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('rewards')}
            >
              Premi
            </button>
            <button
              type="button"
              className={`ghost small ${tab === 'communications' ? 'active-tab' : ''}`}
              onClick={() => setStorePage('communications')}
            >
              <span aria-hidden="true">📢</span> Comunicazioni
            </button>
          </section>

          {tab === 'operations' ? (
        <>
          {visibleNotifications.length > 0 ? (
          <div className="comms-banner" onClick={() => setStorePage('communications')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setStorePage('communications') }}>
            <span className="comms-banner-dot" aria-hidden="true"></span>
            <div className="comms-banner-text">
              <span className="comms-banner-title">{visibleNotifications[0].title}</span>
              <span className="comms-banner-body">{visibleNotifications[0].body}</span>
            </div>
            <span className="comms-banner-arrow" aria-hidden="true">→</span>
            <button
              className="comms-banner-dismiss"
              onClick={(e) => { e.stopPropagation(); handleDismissNotification(visibleNotifications[0].id) }}
              aria-label="Nascondi notifica"
            >&#10005;</button>
          </div>
        ) : null}
        <section className="store-shell">
          <CustomerSidebar
            customers={filteredCustomers}
            customerSearch={customerSearch}
            onCustomerSearchChange={setCustomerSearch}
            selectedStoreCustomerId={selectedStoreCustomerId}
            onSelectCustomer={setSelectedStoreCustomerId}
            loadingData={loadingData}
          />

          <article className="card selected-customer-card">
              <h2>Cliente selezionato</h2>
              {loadingData ? (
                <div className="skeleton-stack" aria-hidden="true">
                  <div className="skeleton-line skeleton-title"></div>
                  <div className="skeleton-line skeleton-pill"></div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line skeleton-subtitle"></div>
                  <div className="skeleton-box skeleton-movement"></div>
                  <div className="skeleton-box skeleton-movement"></div>
                  <div className="skeleton-box skeleton-movement"></div>
                </div>
              ) : selectedStoreCustomer ? (
                <>
                  <div className="customer-header-row">
                    {editingCustomerId === selectedStoreCustomer.id ? (
                      <div className="customer-edit-fields">
                        <input
                          className="customer-edit-input"
                          style={{ textTransform: 'capitalize' }}
                          value={editCustomerName}
                          onChange={(e) => setEditCustomerName(e.target.value)}
                          placeholder="Nome e cognome"
                        />
                        <input
                          className="customer-edit-input"
                          value={editCustomerPhone}
                          onChange={(e) => setEditCustomerPhone(e.target.value)}
                          placeholder="Telefono"
                          inputMode="tel"
                        />
                        <input
                          className="customer-edit-input"
                          value={editCustomerBirthDayMonth}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                            const formatted = digits.length > 2
                              ? `${digits.slice(0, 2)}/${digits.slice(2)}`
                              : digits
                            setEditCustomerBirthDayMonth(formatted)
                          }}
                          placeholder="Giorno/Mese (GG/MM)"
                          inputMode="numeric"
                          maxLength={5}
                        />
                        {editCustomerError ? <p className="error">{editCustomerError}</p> : null}
                        <div className="customer-edit-actions">
                          <button className="ghost small" type="button" onClick={saveCustomerEdit} disabled={savingCustomerEdit}>
                            Salva
                          </button>
                          <button className="ghost small danger" type="button" onClick={cancelEditCustomer}>
                            Annulla
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="customer-name">{selectedStoreCustomer.name}</p>
                        <p className="hint no-top">Telefono: {selectedStoreCustomer.phone}</p>
                        {selectedStoreCustomer.birth_day_month ? (
                          <p className="hint no-top">Nato il: {selectedStoreCustomer.birth_day_month}</p>
                        ) : null}

                        {selectedStoreCustomer.username ? (
                          <p className="hint no-top">Username: {selectedStoreCustomer.username}</p>
                        ) : null}
                      </div>
                    )}
                    {editingCustomerId !== selectedStoreCustomer.id ? (
                      <div className="customer-header-actions">
                        <button className="ghost small" type="button" onClick={startEditCustomer}>
                          Modifica
                        </button>
                        <button className="ghost small danger" type="button" onClick={askDeleteCustomer}>
                          Elimina cliente
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="punti-zone">
                    <p className={`points-balance mini${balancePop ? ' pop' : ''}`}>{selectedStoreCustomer.points} punti</p>
                    {floatingPoints.map((f) => (
                      <span key={f.id} className={`float-points ${f.kind}`}>
                        {f.delta > 0 ? '+' : ''}{f.delta} pt
                      </span>
                    ))}
                  </div>

                  <div className="selected-customer-separator" aria-hidden="true"></div>

                  <div className="stack split no-top-border selected-customer-rewards">
                    <h3>Premi raggiungibili
                    {selectedCustomerReachableRewards.length > 0 ? (
                      <span className="badge">{selectedCustomerReachableRewards.length}</span>
                    ) : null}
                    </h3>
                    {selectedCustomerReachableRewards.length > 0 ? (
                      <ul className="rewards-list rewards-list-compact">
                        {selectedCustomerReachableRewards.map((reward) => (
                          <li key={reward.id} className="reward-item reward-reachable">
                            <div className="reward-info">
                              <strong>{reward.name}</strong>
                              {reward.description ? <p className="reward-desc">{reward.description}</p> : null}
                            </div>
                            <span className="reward-cost">{reward.points_cost} pt</span>
                          </li>
                        ))}
                      </ul>
                    ) : selectedCustomerNextReward ? (
                      <p className="hint no-top">
                        Nessun premio riscattabile ora. Prossimo premio: <strong>{selectedCustomerNextReward.name}</strong> a {selectedCustomerNextReward.points_cost} punti.
                      </p>
                    ) : (
                      <p className="hint no-top">Nessun premio attivo configurato per questo negozio.</p>
                    )}
                  </div>

                  <div className="stack split">
                    <h3>Movimenti cliente
                    {customerMovements.length > 0 ? (
                      <span className="badge">{customerMovements.length}</span>
                    ) : null}
                    </h3>
                    <ul className="movements">
                      {customerMovements.length ? (
                        customerMovements.map((movement) => (
                          <li key={movement.id} className={`movement-${movement.kind}`}>
                            <div className="movement-content">
                              <div>
                                <strong>
                                  {(movement.kind === 'earn' || (movement.kind === 'adjust' && movement.points > 0)) ? '+ ' : movement.kind === 'adjust' && movement.points < 0 ? '- ' : '  '}
                                  {Math.abs(movement.points)} pt
                                </strong>
                                <p>{movement.note ?? 'Movimento registrato'}</p>
                              </div>
                              <div className="movement-actions">
                                <time>{new Date(movement.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                                <button
                                  className="ghost small danger"
                                  type="button"
                                  onClick={() => askDeleteTransaction(movement)}
                                >
                                  Elimina
                                </button>
                              </div>
                            </div>
                          </li>
                        ))
                      ) : (
                        <li>Nessun movimento registrato per questo cliente</li>
                      )}
                    </ul>
                    <Sparkline movements={customerMovements} />
                  </div>
                </>
              ) : (
                <p className="hint no-top">Seleziona un cliente dalla lista.</p>
              )}
            </article>

            <article className="card notes-card">
              <div className="notes-header">
                <h2>Note</h2>
                {selectedStoreCustomer && !isEditingNotes ? (
                  <button className="ghost small" type="button" onClick={startEditNotes}>
                    Modifica
                  </button>
                ) : null}
              </div>
              {isEditingNotes ? (
                <>
                  <textarea
                    className="notes-edit-textarea"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Note sul cliente..."
                  />
                  <div className="notes-actions">
                    <button className="ghost small" type="button" onClick={saveNotes} disabled={savingNotes}>
                      Salva
                    </button>
                    <button className="ghost small danger" type="button" onClick={cancelEditNotes}>
                      Annulla
                    </button>
                  </div>
                </>
              ) : selectedStoreCustomer?.notes ? (
                <div className="notes-area">{selectedStoreCustomer.notes}</div>
              ) : (
                <div className="notes-empty">NESSUNA NOTA</div>
              )}
            </article>

            <article className="card">
              <h2>Gestione punti</h2>
              {loadingData ? (
                <div className="skeleton-stack" aria-hidden="true">
                  <div className="skeleton-box" style={{height:'6rem'}}></div>
                  <div className="skeleton-box" style={{height:'5rem'}}></div>
                </div>
              ) : (
                <>
              <form onSubmit={addPoints} className="stack split no-top-border">
                <h3>Carica Punti</h3>
                <label>
                  <small>Inserisci la spesa in €</small>
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
                <button className="cta" type="submit" disabled={!selectedStoreCustomer || addingPoints}>
                  {addingPoints ? 'Aggiunta punti...' : 'Aggiungi punti'}
                </button>
              </form>

              <form onSubmit={redeemPoints} className="stack split">
                <h3>Scarica Punti</h3>
                <label>
                  <small>Inserisci la quantità di punti da redimere</small>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={redeemAmount}
                    onChange={(event) => setRedeemAmount(event.target.value)}
                    placeholder="Es: 10"
                  />
                </label>
                <button className="ghost" type="submit" disabled={!selectedStoreCustomer || redeemingPoints}>
                  {redeemingPoints ? 'Redenzione in corso...' : 'Scarica punti'}
                </button>
              </form>

              <div className="stack split">
                <h3
                  role="button"
                  tabIndex={0}
                  className="collapse-header"
                  onClick={() => setShowOverride(v => !v)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setShowOverride(v => !v) }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  Rettifica Punti {showOverride ? '▾' : '▸'}
                </h3>
                {showOverride ? (
                  <form onSubmit={overridePoints} className="stack" style={{ marginTop: 0 }}>
                    <label>
                      <small>Inserisci il nuovo valore punti desiderato finale</small>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={overrideAmount}
                        onChange={(event) => setOverrideAmount(event.target.value)}
                        placeholder={selectedStoreCustomer ? `Nuovo valore (attuali: ${selectedStoreCustomer.points})` : 'Seleziona un cliente'}
                        disabled={!selectedStoreCustomer}
                      />
                    </label>
                    <button className="ghost small" type="submit" disabled={!selectedStoreCustomer || overridingPoints}>
                      {overridingPoints ? 'Rettifica in corso...' : 'Rettifica punti'}
                    </button>
                  </form>
                ) : null}
              </div>
                </>
              )}
            </article>
        </section>
        </>

          ) : tab === 'new-customer' ? (
            <section className="store-single-page">
              <article className="card">
                <h2>Nuovo cliente</h2>
                <form onSubmit={addCustomer} className="stack">
                  <label>
                    Nome e cognome
                    <input
                      style={{ textTransform: 'capitalize' }}
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
                    Note
                    <input
                      type="text"
                      value={newCustomerNote}
                      onChange={(event) => setNewCustomerNote(event.target.value)}
                      placeholder="Es: Napoleone"
                    />
                  </label>
                  {(newCustomerName || newCustomerBirthDayMonth) ? (
                    <p className="username-preview">
                      Username: <strong>{buildUsername(newCustomerName, newCustomerBirthDayMonth)}</strong>
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
                  {(newCustomerName || newCustomerBirthDayMonth || newCustomerPhone || newCustomerNote) ? (
                    <div className="creation-summary">
                      <h3>Riepilogo accesso</h3>
                      <p><strong>Nominativo visibile:</strong> {previewDisplayName || 'Da completare'}</p>
                      <p><strong>Codice utente:</strong> {previewUsername}</p>
                      <p><strong>Password iniziale:</strong> {newCustomerPhone.trim() || 'Numero di telefono inserito'}</p>
                      <p><strong>Telefono:</strong> {newCustomerPhone.trim() || 'Da completare'}</p>
                    </div>
                  ) : null}
                  {newCustomerError ? <p className="error">{newCustomerError}</p> : null}
                  {newCustomerSuccess ? <p className="success">{newCustomerSuccess}</p> : null}
                  <button className="cta" type="submit" disabled={creatingCustomer}>
                    {creatingCustomer ? 'Creazione cliente...' : 'Crea cliente'}
                  </button>
                </form>
              </article>
            </section>
          ) : tab === 'communications' ? (
            <Suspense fallback={null}>
              <StoreNotifications />
            </Suspense>
          ) : tab === 'rewards' ? (
            <section className="store-single-page">
              <article className="card">
                <h2>Gestione premi</h2>
                <p className="hint no-top" style={{marginBottom:'1rem'}}>I premi attivi sono visibili ai clienti nella loro home.</p>

                {loadingData ? (
                  <div className="skeleton-stack" aria-hidden="true">
                    <div className="skeleton-box" style={{height:'3.4rem'}}></div>
                    <div className="skeleton-box" style={{height:'3.4rem'}}></div>
                    <div className="skeleton-box" style={{height:'3.4rem'}}></div>
                  </div>
                ) : rewards.length > 0 ? (
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
                            onClick={() => askDeleteReward(reward)}
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
                  <button className="cta" type="submit" disabled={addingReward}>{addingReward ? 'Aggiunta premio...' : 'Aggiungi premio'}</button>
                </form>
              </article>
            </section>
          ) : null}
        </>
      ) : (
        <>
        {visibleNotifications.length > 0 ? (
          <div className="comms-hero">
            <div className="comms-hero-head">
              <div className="comms-hero-icon">📢</div>
              <div className="comms-hero-head-text">
                <span className="comms-hero-head-label">Comunicazioni dal negozio</span>
              </div>
              <span className="comms-hero-head-badge">{visibleNotifications.length} nuove</span>
            </div>
            <div className="comms-hero-list">
              {visibleNotifications.map((n) => (
                <div key={n.id} className="comms-hero-item">
                  <div className="comms-hero-item-text">
                    <span className="comms-hero-item-title">{n.title}</span>
                    <span className="comms-hero-item-body">{n.body}</span>
                  </div>
                  <div className="comms-item-right">
                    <span className="comms-hero-item-time">
                      {new Date(n.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      className="comms-item-dismiss"
                      onClick={(e) => { e.stopPropagation(); handleDismissNotification(n.id) }}
                      aria-label="Nascondi notifica"
                    >&#10005;</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <section className="grid customer-view">
          <article className="card hero-card">
            <h2>I tuoi punti</h2>
            {pushStatus ? (
              <p className={`hint no-top ${pushStatus.includes('attive') ? 'success' : pushStatus.includes('non disponibili') ? 'error' : ''}`} style={{marginBottom:'0.5rem',fontSize:'0.78rem'}}>
                {pushStatus.includes('attive') ? '🔔 ' : pushStatus.includes('corso') ? '⏳ ' : '⚠️ '}
                {pushStatus}
              </p>
            ) : null}
            {loadingData ? (
              <div className="skeleton-stack" aria-hidden="true">
                <div className="skeleton-line skeleton-balance"></div>
                <div className="skeleton-line skeleton-subtitle"></div>
              </div>
            ) : customerView ? (
              <p className="points-balance">{customerView.points} punti</p>
            ) : (
              <p className="hint no-top">Scheda cliente non disponibile</p>
            )}
          </article>

          <article className="card">
            <h2>
              Ultimi movimenti
              {customerVisibleMovements.length > MAX_CUSTOMER_MOVEMENTS_VISIBLE ? (
                <span className="badge" style={{marginLeft:'0.5rem'}} title={`${customerVisibleMovements.length} movimenti visibili`}>
                  e molti altri...
                </span>
              ) : customerVisibleMovements.length > 0 ? (
                <span className="badge" style={{marginLeft:'0.5rem'}}>{customerVisibleMovements.length}</span>
              ) : null}
            </h2>
            {loadingData ? (
              <div className="skeleton-stack" aria-hidden="true">
                <div className="skeleton-box skeleton-movement"></div>
                <div className="skeleton-box skeleton-movement"></div>
                <div className="skeleton-box skeleton-movement"></div>
              </div>
            ) : (
            <>
            <ul className="movements">
              {customerVisibleMovements.length ? (
                customerVisibleMovements.slice(0, MAX_CUSTOMER_MOVEMENTS_VISIBLE).map((movement) => (
                  <li key={movement.id} className={`movement-${movement.kind}`}>
                    <div>
                      <strong>
                        {(movement.kind === 'earn' || (movement.kind === 'adjust' && movement.points > 0)) ? '+ ' : movement.kind === 'adjust' && movement.points < 0 ? '- ' : '  '}
                        {Math.abs(movement.points)} pt
                      </strong>
                      <p>{movement.note ?? 'Movimento registrato'}</p>
                    </div>
                    <time>{new Date(movement.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                  </li>
                ))
              ) : (
                <li>Nessun movimento registrato per ora</li>
              )}
            </ul>
            <Sparkline movements={customerMovements} />
            </>
            )}
          </article>

          {loadingData ? (
            <article className="card customer-rewards-card">
              <h2>Premi disponibili</h2>
              <div className="skeleton-stack" aria-hidden="true">
                <div className="skeleton-box" style={{height:'3.4rem'}}></div>
                <div className="skeleton-box" style={{height:'3.4rem'}}></div>
                <div className="skeleton-box" style={{height:'3.4rem'}}></div>
              </div>
            </article>
          ) : rewards.length > 0 ? (
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

          <p className="privacy-note" style={{gridColumn:'1 / -1'}}>
            <span className="privacy-note-icon" aria-hidden="true">🛡️</span>
            I tuoi dati personali non vengono condivisi con nessuno. Utilizziamo i tuoi dati solo per la raccolta punti. Non raccogliamo cookies.
          </p>
        </section>
      </>
      )}

    </main>
  )
}

export default App
