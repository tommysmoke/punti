import { useState } from 'react'
import type { ConfirmModalState } from '../components/ConfirmModal'

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
  birth_day_month: string | null
  username: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

type Movement = {
  id: number
  customer_id: number
  kind: 'earn' | 'redeem' | 'adjust'
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

type RecentNotification = {
  id: number
  title: string
  body: string
  created_at: string
}

type StorePage = 'operations' | 'new-customer' | 'rewards' | 'communications'

export function useAppState() {
  // Session / auth
  const [sessionLoading, setSessionLoading] = useState(true)
  const [role, setRole] = useState<Role | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  // Store data
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedStoreCustomerId, setSelectedStoreCustomerId] = useState<number | null>(null)
  const [customerMovements, setCustomerMovements] = useState<Movement[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [recentNotifications, setRecentNotifications] = useState<RecentNotification[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // Notifications
  const [notificationPermissionRequested, setNotificationPermissionRequested] = useState(false)
  const [pushStatus, setPushStatus] = useState<string | null>(null)
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem('comms_dismissed')
      return raw ? (JSON.parse(raw) as number[]) : []
    } catch {
      return []
    }
  })

  // Login form
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({})

  // UI
  const [actionError, setActionError] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showOverride, setShowOverride] = useState(false)

  // Customer creation
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [newCustomerBirthDayMonth, setNewCustomerBirthDayMonth] = useState('')
  const [newCustomerNote, setNewCustomerNote] = useState('')
  const [newCustomerSuccess, setNewCustomerSuccess] = useState('')
  const [newCustomerError, setNewCustomerError] = useState('')

  // Point management
  const [expenseAmount, setExpenseAmount] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')
  const [overrideAmount, setOverrideAmount] = useState('')

  // Rewards form
  const [newRewardName, setNewRewardName] = useState('')
  const [newRewardDescription, setNewRewardDescription] = useState('')
  const [newRewardPoints, setNewRewardPoints] = useState('')
  const [rewardError, setRewardError] = useState('')

  // Customer edit
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editCustomerPhone, setEditCustomerPhone] = useState('')
  const [editCustomerBirthDayMonth, setEditCustomerBirthDayMonth] = useState('')
  const [editCustomerOriginalPhone, setEditCustomerOriginalPhone] = useState('')
  const [editCustomerError, setEditCustomerError] = useState('')
  const [savingCustomerEdit, setSavingCustomerEdit] = useState(false)

  // Async operation guards
  const [addingPoints, setAddingPoints] = useState(false)
  const [redeemingPoints, setRedeemingPoints] = useState(false)
  const [overridingPoints, setOverridingPoints] = useState(false)
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [addingReward, setAddingReward] = useState(false)

  // Search
  const [customerSearch, setCustomerSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  return {
    // Session
    sessionLoading, setSessionLoading,
    role, setRole,
    profile, setProfile,
    initError, setInitError,
    // Store data
    customers, setCustomers,
    selectedStoreCustomerId, setSelectedStoreCustomerId,
    customerMovements, setCustomerMovements,
    rewards, setRewards,
    recentNotifications, setRecentNotifications,
    loadingData, setLoadingData,
    // Notifications
    notificationPermissionRequested, setNotificationPermissionRequested,
    pushStatus, setPushStatus,
    dismissedNotificationIds, setDismissedNotificationIds,
    // Login
    loginIdentifier, setLoginIdentifier,
    loginPassword, setLoginPassword,
    loginError, setLoginError,
    loginLoading, setLoginLoading,
    visiblePasswords, setVisiblePasswords,
    // UI
    actionError, setActionError,
    toast, setToast,
    confirmModal, setConfirmModal,
    isOnline, setIsOnline,
    showOverride, setShowOverride,
    // Customer creation
    newCustomerName, setNewCustomerName,
    newCustomerPhone, setNewCustomerPhone,
    newCustomerBirthDayMonth, setNewCustomerBirthDayMonth,
    newCustomerNote, setNewCustomerNote,
    newCustomerSuccess, setNewCustomerSuccess,
    newCustomerError, setNewCustomerError,
    // Point management
    expenseAmount, setExpenseAmount,
    redeemAmount, setRedeemAmount,
    overrideAmount, setOverrideAmount,
    // Rewards form
    newRewardName, setNewRewardName,
    newRewardDescription, setNewRewardDescription,
    newRewardPoints, setNewRewardPoints,
    rewardError, setRewardError,
    // Customer edit
    editingCustomerId, setEditingCustomerId,
    editCustomerName, setEditCustomerName,
    editCustomerPhone, setEditCustomerPhone,
    editCustomerBirthDayMonth, setEditCustomerBirthDayMonth,
    editCustomerOriginalPhone, setEditCustomerOriginalPhone,
    editCustomerError, setEditCustomerError,
    savingCustomerEdit, setSavingCustomerEdit,
    // Async guards
    addingPoints, setAddingPoints,
    redeemingPoints, setRedeemingPoints,
    overridingPoints, setOverridingPoints,
    creatingCustomer, setCreatingCustomer,
    addingReward, setAddingReward,
    // Search
    customerSearch, setCustomerSearch,
    debouncedSearch, setDebouncedSearch,
  }
}

export type { Customer, Movement, Profile, RecentNotification, Reward, Role, StorePage, Toast }
