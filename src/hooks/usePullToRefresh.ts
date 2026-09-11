import { useEffect, useRef, useState } from 'react'

const PULL_THRESHOLD = 70

export function usePullToRefresh(onRefresh: () => void | Promise<void>, enabled = true) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pull = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!enabled) return

    const start = (e: TouchEvent) => {
      if (refreshingRef.current) return
      if (window.scrollY <= 0 && e.touches.length === 1) {
        startY.current = e.touches[0].clientY
        pull.current = 0
      } else {
        startY.current = null
      }
    }

    const move = (e: TouchEvent) => {
      if (startY.current === null || refreshingRef.current) return
      const delta = e.touches[0].clientY - startY.current
      if (delta > 0) {
        const resisted = Math.min(delta * 0.45, 130)
        pull.current = resisted
        setPullDistance(resisted)
        if (delta > 8) e.preventDefault()
      } else {
        pull.current = 0
        setPullDistance(0)
      }
    }

    const end = () => {
      if (startY.current === null || refreshingRef.current) return
      if (pull.current >= PULL_THRESHOLD) {
        refreshingRef.current = true
        setRefreshing(true)
        setPullDistance(0)
        Promise.resolve(onRefreshRef.current()).finally(() => {
          refreshingRef.current = false
          setRefreshing(false)
        })
      } else {
        setPullDistance(0)
      }
      startY.current = null
      pull.current = 0
    }

    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', end, { passive: true })
    document.addEventListener('touchcancel', end, { passive: true })

    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', end)
    }
  }, [enabled])

  return { pullDistance, refreshing }
}
