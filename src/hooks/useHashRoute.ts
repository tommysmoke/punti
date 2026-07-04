import { useEffect, useState } from 'react'

const STORE_PAGE_VALUES = ['operations', 'new-customer', 'rewards', 'communications'] as const
type StorePage = (typeof STORE_PAGE_VALUES)[number]

function isValidStorePage(value: string): value is StorePage {
  return STORE_PAGE_VALUES.includes(value as StorePage)
}

function getHashValue(): StorePage | null {
  try {
    const hash = window.location.hash.replace(/^#/, '')
    if (isValidStorePage(hash)) return hash
  } catch {
    // SSR / test environment fallback
  }
  return null
}

export function useHashRoute(defaultRoute: StorePage) {
  const [route, setRoute] = useState<StorePage>(() => {
    return getHashValue() ?? defaultRoute
  })

  useEffect(() => {
    const handleHashChange = () => {
      const fromHash = getHashValue()
      if (fromHash) {
        setRoute(fromHash)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (next: StorePage) => {
    setRoute(next)
    try {
      if (`#${next}` !== window.location.hash) {
        window.location.hash = next
      }
    } catch {
      // hash writing not available — state is still correct
    }
  }

  return { route, navigate } as const
}

export type { StorePage }
