import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseEasyfattCSV } from '../lib/csvParser'
import { parseCart } from '../lib/cartParser'
import {
  matchCartAgainstInventory,
  getStoreColumnName,
  getStoreStocks,
  findEmptyAliasColumn,
  storePassesFilter,
  getFilterRejection,
  filterDebugSuffix,
  STORE_NAMES,
  findDuplicates,
  computeMerge,
  getAliases,
  getFilterDays,
  parseDate,
  isProductAbsentFromStore,
  type InventoryEntry,
  type MatchResult,
  type DuplicateGroup,
  type StoreStock,
} from '../lib/crossInventory'
import type { Profile, Toast } from '../hooks/useAppState'

type Status = 'idle' | 'loading' | 'success' | 'error'

const STORE_KEY = 'punti-cross-identified-store'
const STORE_IDENTIFIED_KEY = 'punti-cross-identified'
const FULFILLED_KEY = 'punti-cross-fulfilled-ids'

interface ReceivedRequest {
  id: number
  title: string
  body: string
  created_at: string
  target_store: string
}

function getFulfilledIds(): Set<number> {
  try {
    const raw = localStorage.getItem(FULFILLED_KEY)
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set()
  } catch {
    return new Set()
  }
}

function setFulfilledIds(ids: Set<number>) {
  try {
    localStorage.setItem(FULFILLED_KEY, JSON.stringify([...ids]))
  } catch { /* ignore */ }
}

function parseRequestBody(body: string): { productName: string; barcode: string | null; quantity: number }[] {
  const lines = body.split('\n').filter((l) => l.trim())
  const items: { productName: string; barcode: string | null; quantity: number }[] = []
  for (const line of lines) {
    if (line.startsWith('Chiede:') || line.startsWith('Conferma')) continue
    const match = line.match(/^(\d+)\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/)
    if (match) {
      items.push({
        quantity: parseInt(match[1], 10) || 1,
        productName: match[2].trim(),
        barcode: match[3]?.trim() ?? null,
      })
    }
  }
  return items
}

function extractSender(title: string): string | null {
  const match = title.match(/^Richiesta da (.+)$/)
  return match ? match[1] : null
}

function renderExcludedStores(
  stocks: { store: string; label: string; quantity: number; lastCarico: string | null; lastScarico: string | null }[],
  currentStore: string,
  filterName: string,
): { store: string; label: string; reason: string }[] {
  if (filterName === 'nofiltro') return []
  const seen = new Set<string>()
  const excluded: { store: string; label: string; reason: string }[] = []
  for (const s of stocks) {
    if (s.quantity <= 0) continue
    if (s.label.toLowerCase() === currentStore.toLowerCase()) continue
    if (seen.has(s.store)) continue
    seen.add(s.store)
    const reason = getFilterRejection(s, filterName)
    if (reason) {
      excluded.push({ store: s.store, label: s.label, reason })
    }
  }
  return excluded
}

export function CrossInventory({ profile, pushToast, testMode, onRequestToggleTest }: { profile: Profile | null; pushToast: (type: Toast['type'], message: string) => void; testMode: boolean; onRequestToggleTest: () => void }) {
  const [selectedStore, setSelectedStore] = useState(() => {
    try {
      return localStorage.getItem(STORE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [identified, setIdentified] = useState(() => {
    try {
      return localStorage.getItem(STORE_IDENTIFIED_KEY) === '1'
    } catch {
      return false
    }
  })
  const [showIdentifier, setShowIdentifier] = useState(!identified)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvStatus, setCsvStatus] = useState<Status>('idle')
  const [csvMessage, setCsvMessage] = useState('')
  const [inventoryCount, setInventoryCount] = useState(0)

  const [cartText, setCartText] = useState('')
  const [cartItems, setCartItems] = useState<string[]>([])
  const [cartQtys, setCartQtys] = useState<Map<string, number>>(new Map())
  const [cartError, setCartError] = useState('')

  const [matches, setMatches] = useState<MatchResult[]>([])
  const [allInventory, setAllInventory] = useState<InventoryEntry[]>([])
  const [matching, setMatching] = useState(false)
  const [matchError, setMatchError] = useState('')

  const [uploading, setUploading] = useState(false)

  const [manualMatches, setManualMatches] = useState<Map<string, { entry: InventoryEntry; stores: ReturnType<typeof getStoreStocks> }>>(new Map())
  const [searchingBarcode, setSearchingBarcode] = useState<string | null>(null)
  const [correctingOldEntryId, setCorrectingOldEntryId] = useState<number | null>(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')

  const [dedupResults, setDedupResults] = useState<DuplicateGroup[]>([])
  const [deduping, setDeduping] = useState(false)
  const [dedupError, setDedupError] = useState('')
  const [mergingId, setMergingId] = useState<string | null>(null)

  const [autoDedupResults, setAutoDedupResults] = useState<DuplicateGroup[]>([])
  const [autoDeduping, setAutoDeduping] = useState(false)
  const [autoDedupError, setAutoDedupError] = useState('')

  const [receivedRequests, setReceivedRequests] = useState<ReceivedRequest[]>([])
  const [showSvuotaConfirm, setShowSvuotaConfirm] = useState(false)

  const [requestBasket, setRequestBasket] = useState<Map<string, { productName: string; barcode: string | null; quantity: number }[]>>(new Map())
  const [basketMinimized, setBasketMinimized] = useState(false)

  const addToBasket = (toStore: string, productName: string, barcode: string | null, qty = 1, stock: StoreStock) => {
    let allowed = stock.quantity
    if (storePassesFilter(stock, 'filter1')) {
      const caricoDate = parseDate(stock.lastCarico)
      const scaricoDate = parseDate(stock.lastScarico)
      const now = new Date()
      const { caricoDays, scaricoDays } = getFilterDays()
      const caricoOld = !caricoDate || Math.floor((now.getTime() - caricoDate.getTime()) / 86400000) >= caricoDays
      const scaricoRecent = scaricoDate && Math.floor((now.getTime() - scaricoDate.getTime()) / 86400000) < scaricoDays
      if (caricoOld && scaricoRecent) {
        if (qty < 3) allowed = Math.min(allowed, 4)
        else allowed = Math.min(allowed, qty * 2)
      }
    }
    const capped = Math.min(qty, allowed)
    setRequestBasket((prev) => {
      const next = new Map(prev)
      const items = next.get(toStore) ?? []
      items.push({ productName, barcode, quantity: capped })
      next.set(toStore, items)
      return next
    })
  }

  const updateBasketQuantity = (toStore: string, index: number, quantity: number) => {
    if (quantity < 1) return
    setRequestBasket((prev) => {
      const next = new Map(prev)
      const items = [...(next.get(toStore) ?? [])]
      if (index >= 0 && index < items.length) {
        items[index] = { ...items[index], quantity }
      }
      next.set(toStore, items)
      return next
    })
  }

  const removeFromBasket = (toStore: string, index: number) => {
    setRequestBasket((prev) => {
      const next = new Map(prev)
      const items = (next.get(toStore) ?? []).filter((_, i) => i !== index)
      if (items.length === 0) {
        next.delete(toStore)
      } else {
        next.set(toStore, items)
      }
      return next
    })
  }

  const sendBasketRequest = async (toStore: string) => {
    if (!supabase || !profile?.store_id) return
    const items = requestBasket.get(toStore)
    if (!items || items.length === 0) return
    const fromStore = selectedStore
    const bodyLines = items.map((item) => `${item.quantity} ${item.productName}${item.barcode ? ` (${item.barcode})` : ''}`)
    const body = `Chiede:\n${bodyLines.join('\n')}`
    try {
      const { error } = await supabase.from('store_notifications').insert({
        store_id: profile.store_id,
        kind: 'cross_request',
        target_store: toStore,
        title: `Richiesta da ${fromStore}`,
        body,
        created_by: profile.id,
      })
      if (error) {
        pushToast('error', 'Invio richiesta non riuscito')
        return
      }
      setRequestBasket((prev) => {
        const next = new Map(prev)
        next.delete(toStore)
        return next
      })
      pushToast('success', `Richiesta inviata a ${toStore} (${items.length} prodotti)`)
      setActiveFilter('filter1')
    } catch {
      pushToast('error', 'Invio richiesta non riuscito')
    }
  }

  const loadReceivedRequests = useCallback(async () => {
    if (!supabase || !selectedStore) return
    const { data } = await supabase
      .from('store_notifications')
      .select('id, title, body, created_at, target_store')
      .eq('kind', 'cross_request')
      .eq('target_store', selectedStore)
      .order('created_at', { ascending: false })
      .limit(50)
    setReceivedRequests((data ?? []) as ReceivedRequest[])
  }, [selectedStore])

  useEffect(() => {
    loadReceivedRequests()
  }, [loadReceivedRequests])

  const cartUniqueCount = useMemo(() => {
    if (!cartText.trim()) return 0
    try {
      return parseCart(cartText).length
    } catch {
      return cartText.split('\n').filter((l) => l.trim()).length
    }
  }, [cartText])

  const handleConfirmStore = () => {
    if (!selectedStore) return
    try {
      localStorage.setItem(STORE_KEY, selectedStore)
      localStorage.setItem(STORE_IDENTIFIED_KEY, '1')
    } catch { /* ignore */ }
    setIdentified(true)
    setShowIdentifier(false)
  }

  const handleChangeStore = () => {
    setShowIdentifier(true)
  }

  const handleSvuota = () => {
    const fulfilledIds = getFulfilledIds()
    for (const req of receivedRequests) {
      fulfilledIds.add(req.id)
    }
    setFulfilledIds(fulfilledIds)
    setReceivedRequests([])
    setShowSvuotaConfirm(false)
    pushToast('success', 'Richieste svuotate')
  }

  const visibleReceived = receivedRequests.filter((r) => !getFulfilledIds().has(r.id))

  const [expandedReplyId, setExpandedReplyId] = useState<number | null>(null)
  const [replyItems, setReplyItems] = useState<{ productName: string; barcode: string | null; quantity: number }[]>([])

  const [activeFilter, setActiveFilter] = useState('filter1')

  const openReply = (req: ReceivedRequest) => {
    const items = parseRequestBody(req.body)
    setReplyItems(items)
    setExpandedReplyId(req.id)
  }

  const updateReplyQuantity = (index: number, qty: number) => {
    setReplyItems((prev) => {
      const next = [...prev]
      if (index >= 0 && index < next.length) {
        if (qty <= 0) {
          return next.filter((_, i) => i !== index)
        }
        next[index] = { ...next[index], quantity: qty }
      }
      return next
    })
  }

  const removeReplyItem = (index: number) => {
    setReplyItems((prev) => prev.filter((_, i) => i !== index))
  }

  const confirmReply = async () => {
    const fromStore = expandedReplyId ? extractSender(visibleReceived.find((r) => r.id === expandedReplyId)?.title ?? '') : ''
    const items = replyItems.filter((item) => item.quantity > 0)
    if (!supabase || !profile?.store_id || !fromStore || items.length === 0) return
    const bodyLines = items.map((item) => `${item.quantity} ${item.productName}${item.barcode ? ` (${item.barcode})` : ''}`)
    const body = `Conferma invio:\n${bodyLines.join('\n')}`
    try {
      const { error } = await supabase.from('store_notifications').insert({
        store_id: profile.store_id,
        kind: 'cross_request',
        target_store: fromStore,
        title: `Risposta da ${selectedStore}`,
        body,
        created_by: profile.id,
      })
      if (error) {
        pushToast('error', `Invio risposta a ${fromStore} non riuscito`)
        return
      }
      pushToast('success', `Risposta inviata a ${fromStore}`)
      closeReply()
    } catch {
      pushToast('error', `Invio risposta a ${fromStore} non riuscito`)
    }
  }

  const closeReply = () => {
    setExpandedReplyId(null)
    setReplyItems([])
  }

  useEffect(() => {
    setCartItems([])
    setCartError('')
    setMatches([])
  }, [cartText])

  const handleUploadCSV = async (event: FormEvent) => {
    event.preventDefault()

    if (!supabase) {
      setCsvMessage('Supabase non configurato')
      setCsvStatus('error')
      return
    }

    if (!selectedStore) {
      setCsvMessage('Seleziona il negozio')
      setCsvStatus('error')
      return
    }

    if (!csvFile) {
      setCsvMessage('Seleziona un file CSV')
      setCsvStatus('error')
      return
    }

    const columnName = getStoreColumnName(selectedStore)
    if (!columnName) {
      setCsvMessage('Nome negozio non riconosciuto')
      setCsvStatus('error')
      return
    }
    const storeSuffix = columnName.replace('quantity_', '')
    const caricoCol = `last_carico_${storeSuffix}`
    const scaricoCol = `last_scarico_${storeSuffix}`

    setUploading(true)
    setCsvStatus('loading')
    setCsvMessage('')

    try {
      const text = await csvFile.text()
      const rows = parseEasyfattCSV(text)

      if (rows.length === 0) {
        setCsvStatus('error')
        setCsvMessage('Nessun prodotto valido trovato nel CSV. Verifica il formato.')
        return
      }

      const { error: resetErr } = await supabase.rpc('reset_inventory_for_store', {
        p_column: columnName,
      })
      if (resetErr) {
        setCsvStatus('error')
        setCsvMessage(`Errore reset: ${resetErr.message}`)
        return
      }

      const allExisting: { id: number; product_name: string; barcode: string | null; alias_1: string | null; alias_2: string | null; alias_3: string | null; alias_4: string | null; alias_5: string | null; alias_6: string | null; alias_7: string | null; alias_8: string | null; alias_9: string | null; alias_10: string | null }[] = []
      let page = 0
      const pageSize = 1000
      while (true) {
        const { data, error: fetchErr } = await supabase
          .from('shared_inventory')
          .select('id, product_name, barcode, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10')
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order('id')
        if (fetchErr) {
          setCsvStatus('error')
          setCsvMessage(`Errore lettura inventario: ${fetchErr.message}`)
          return
        }
        if (!data || data.length === 0) break
        allExisting.push(...data as typeof allExisting)
        if (data.length < pageSize) break
        page++
      }

      const existingProducts = allExisting

      const updates: { id: number; [key: string]: number | string | null }[] = []
      const inserts: {
        product_name: string
        barcode: string
        category: string
        [key: string]: string | number | null
      }[] = []

      const matchedIds = new Set<number>()

      for (const row of rows) {
        let matched = false

        if (row.barcode) {
          const barcodeMatch = existingProducts.find(
            (p) => p.barcode && p.barcode === row.barcode,
          )
          if (barcodeMatch) {
            if (!matchedIds.has(barcodeMatch.id)) {
              updates.push({ id: barcodeMatch.id, [columnName]: row.quantity, [caricoCol]: row.lastCarico || null, [scaricoCol]: row.lastScarico || null })
              matchedIds.add(barcodeMatch.id)
            } else {
              const existingUpdate = updates.find((u) => u.id === barcodeMatch.id)
              if (existingUpdate) {
                existingUpdate[columnName] = ((existingUpdate[columnName] as number) || 0) + row.quantity
              }
            }
            matched = true
          }
        }

        if (matched) continue

        const nameMatch = existingProducts.find(
          (p) => p.product_name.toLowerCase() === row.name.toLowerCase() && !matchedIds.has(p.id),
        )
        if (nameMatch) {
          updates.push({ id: nameMatch.id, [columnName]: row.quantity, [caricoCol]: row.lastCarico || null, [scaricoCol]: row.lastScarico || null })
          matchedIds.add(nameMatch.id)
          matched = true
        }
        if (matched) continue

        const rowNameLower = row.name.toLowerCase()
        const aliasMatch = existingProducts.find(
          (p) => {
            if (matchedIds.has(p.id)) return false
            for (let i = 1; i <= 10; i++) {
              const aliasVal = p[`alias_${i}` as keyof typeof p]
              if (typeof aliasVal === 'string' && aliasVal.toLowerCase() === rowNameLower) return true
            }
            return false
          },
        )
        if (aliasMatch) {
          updates.push({ id: aliasMatch.id, [columnName]: row.quantity, [caricoCol]: row.lastCarico || null, [scaricoCol]: row.lastScarico || null })
          matchedIds.add(aliasMatch.id)
          matched = true
        }
        if (matched) continue

        const barcodeAlreadyMatched = row.barcode && existingProducts.find(
          (p) => p.barcode && p.barcode === row.barcode && matchedIds.has(p.id),
        )
        const nameAlreadyMatched = existingProducts.find(
          (p) => p.product_name.toLowerCase() === row.name.toLowerCase() && matchedIds.has(p.id),
        )
        const aliasAlreadyMatched = existingProducts.find(
          (p) => {
            if (!matchedIds.has(p.id)) return false
            for (let i = 1; i <= 10; i++) {
              const aliasVal = p[`alias_${i}` as keyof typeof p]
              if (typeof aliasVal === 'string' && aliasVal.toLowerCase() === rowNameLower) return true
            }
            return false
          },
        )
        const alreadyMatchedRow = barcodeAlreadyMatched ?? nameAlreadyMatched ?? aliasAlreadyMatched
        if (alreadyMatchedRow) {
          const existingUpdate = updates.find((u) => u.id === alreadyMatchedRow.id)
          if (existingUpdate) {
            existingUpdate[columnName] = ((existingUpdate[columnName] as number) || 0) + row.quantity
          }
          matched = true
        }

        if (matched) continue

        inserts.push({
          product_name: row.name,
          barcode: row.barcode,
          category: row.category,
          [columnName]: row.quantity,
          [caricoCol]: row.lastCarico || null,
          [scaricoCol]: row.lastScarico || null,
        })
      }

      if (updates.length > 0) {
        const payload = updates.map((u) => ({ id: u.id, q: u[columnName] }))
        const { error } = await supabase.rpc('batch_update_store_quantities', {
          p_column: columnName,
          p_updates: payload,
        })
        if (error) {
          setCsvStatus('error')
          setCsvMessage(`Errore aggiornamento: ${error.message}`)
          return
        }

        const datePayload = updates
          .filter((u) => u[caricoCol] || u[scaricoCol])
          .map((u) => ({ id: u.id, c: u[caricoCol] || null, s: u[scaricoCol] || null }))
        if (datePayload.length > 0) {
          const { error: dateErr } = await supabase.rpc('batch_update_store_dates', {
            p_carico_col: caricoCol,
            p_scarico_col: scaricoCol,
            p_updates: datePayload,
          })
          if (dateErr) {
            console.error('Errore aggiornamento date:', dateErr.message)
          }
        }
      }

      if (inserts.length > 0) {
        const batchSize = 500
        for (let i = 0; i < inserts.length; i += batchSize) {
          const batch = inserts.slice(i, i + batchSize)
          const { error } = await supabase.from('shared_inventory').insert(batch)
          if (error) {
            setCsvStatus('error')
            setCsvMessage(`Errore inserimento: ${error.message}`)
            return
          }
        }
      }

      setInventoryCount(rows.length)
      setCsvStatus('success')
      setCsvMessage(`Caricati ${rows.length} prodotti (${updates.length} aggiornati, ${inserts.length} nuovi)`)
      setCsvFile(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore sconosciuto'
      setCsvStatus('error')
      setCsvMessage(message)
    } finally {
      setUploading(false)
    }
  }

  const handleMatch = async () => {
    if (!supabase) {
      setMatchError('Supabase non configurato')
      return
    }

    const names = activeFilter === 'filter2'
      ? ['__filter2__']
      : (() => {
          const parsed = parseCart(cartText)
          const qtyMap = new Map<string, number>()
          for (const item of parsed) {
            qtyMap.set(item.name, item.qty)
          }
          setCartQtys(qtyMap)
          if (parsed.length > 0) return parsed.map((i) => i.name)
          return cartText.split('\n').map((l) => l.trim()).filter(Boolean)
        })()

    if (names.length === 0) {
      setMatchError('Nessun prodotto da confrontare. Parsa prima il carrello.')
      return
    }

      setMatching(true)
    setMatchError('')
    setDedupResults([])
    setAutoDedupResults([])

    try {
      const allInventory: InventoryEntry[] = []
      let page = 0
      const pageSize = 1000
      while (true) {
        const { data, error } = await supabase
          .from('shared_inventory')
          .select('id, product_name, barcode, quantity_quarto, quantity_castenaso, quantity_bologna, quantity_san_lazzaro, category, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10, last_carico_quarto, last_carico_castenaso, last_carico_bologna, last_carico_san_lazzaro, last_scarico_quarto, last_scarico_castenaso, last_scarico_bologna, last_scarico_san_lazzaro')
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order('id')

        if (error) {
          setMatchError(`Errore nel recupero inventario: ${error.message}`)
          return
        }
        if (!data || data.length === 0) break
        allInventory.push(...(data as InventoryEntry[]))
        if (data.length < pageSize) break
        page++
      }

      const results = names[0] === '__filter2__'
        ? []
        : matchCartAgainstInventory(names, allInventory)
      setCartItems(names[0] === '__filter2__' ? [] : names)
      setMatches(results)
      setAllInventory(allInventory)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante il confronto'
      setMatchError(message)
    } finally {
      setMatching(false)
    }
  }

  const handleDeduplicate = async () => {
    if (!supabase) {
      setDedupError('Supabase non configurato')
      return
    }
    setDeduping(true)
    setDedupError('')
    setMatches([])
    try {
      const { data, error } = await supabase
        .rpc('find_duplicate_rows')

      if (error) {
        setDedupError(`Errore lettura inventario: ${error.message}`)
        return
      }

      const inventory = (data ?? []) as InventoryEntry[]
      const dupes = findDuplicates(inventory)
      setDedupResults(dupes)
      if (dupes.length === 0) {
        pushToast('success', 'Nessun duplicato trovato')
      }
    } catch (err) {
      setDedupError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setDeduping(false)
    }
  }

  const handleMerge = async (group: DuplicateGroup, keepIdx: number) => {
    if (!supabase) return
    const key = `${group.barcode}|${keepIdx}`
    setMergingId(key)
    try {
      const merge = computeMerge(group.rows)
      const { error: updateErr } = await supabase
        .from('shared_inventory')
        .update(merge.updateFields)
        .eq('id', merge.keepId)
      if (updateErr) {
        pushToast('error', `Erorre merge: ${updateErr.message}`)
        return
      }
      for (const rid of merge.removeIds) {
        const { error: deleteErr } = await supabase
          .from('shared_inventory')
          .delete()
          .eq('id', rid)
        if (deleteErr) {
          pushToast('error', `Errore rimozione duplicato: ${deleteErr.message}`)
          return
        }
      }
      setDedupResults((prev) =>
        prev
          .map((g) => {
            if (g.barcode !== group.barcode) return g
            const removeIdSet = new Set(merge.removeIds)
            return { barcode: g.barcode, rows: g.rows.filter((r) => !removeIdSet.has(r.id)) }
          })
          .filter((g) => g.rows.length > 1),
      )
      pushToast('success', `Merge completato: ${merge.removeIds.length} righe → ${group.rows.find((r) => r.id === merge.keepId)?.product_name}`)
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Errore merge')
    } finally {
      setMergingId(null)
    }
  }

  const handleAutoDeduplicate = async () => {
    if (!supabase) {
      setAutoDedupError('Supabase non configurato')
      return
    }
    setAutoDeduping(true)
    setAutoDedupError('')
    setMatches([])
    setDedupResults([])
    try {
      const { data, error } = await supabase
        .rpc('find_duplicate_rows')

      if (error) {
        setAutoDedupError(`Errore lettura inventario: ${error.message}`)
        return
      }

      const inventory = (data ?? []) as InventoryEntry[]
      const allDupes = findDuplicates(inventory)

      const sameNameDupes = allDupes.filter((group) => {
        const firstName = group.rows[0].product_name.toLowerCase().trim()
        return group.rows.every((r) => r.product_name.toLowerCase().trim() === firstName)
      })

      if (sameNameDupes.length === 0) {
        setAutoDedupResults([])
        pushToast('success', 'Nessun duplicato automatico trovato')
        return
      }

      let mergedCount = 0
      const results: DuplicateGroup[] = []
      for (const group of sameNameDupes) {
        try {
          const merge = computeMerge(group.rows)
          const { error: updateErr } = await supabase
            .from('shared_inventory')
            .update(merge.updateFields)
            .eq('id', merge.keepId)
          if (updateErr) {
            pushToast('error', `Errore merge auto: ${updateErr.message}`)
            continue
          }
          let deleteFailed = false
          for (const rid of merge.removeIds) {
            const { error: deleteErr } = await supabase
              .from('shared_inventory')
              .delete()
              .eq('id', rid)
            if (deleteErr) {
              pushToast('error', `Errore rimozione auto: ${deleteErr.message}`)
              deleteFailed = true
              break
            }
          }
          if (deleteFailed) continue
          mergedCount++
          const removeIdSet = new Set(merge.removeIds)
          results.push({ barcode: group.barcode, rows: group.rows.filter((r) => !removeIdSet.has(r.id)) })
        } catch (err) {
          pushToast('error', err instanceof Error ? err.message : 'Errore merge auto')
        }
      }
      setAutoDedupResults(results)
      if (mergedCount > 0) {
        pushToast('success', `Auto-merge completato: ${mergedCount} duplicati risolti`)
      }
    } catch (err) {
      setAutoDedupError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setAutoDeduping(false)
    }
  }

  const doMatch = () => {
    if (activeFilter !== 'filter2' && !cartText.trim()) {
      setMatchError('Incolla il testo del carrello')
      return
    }
    handleMatch()
  }

  const startBarcodeSearch = (cartName: string, oldEntryId?: number) => {
    setSearchingBarcode(cartName)
    setCorrectingOldEntryId(oldEntryId ?? null)
    setBarcodeInput('')
    setBarcodeError('')
  }

  const lookupBarcode = async (cartName: string) => {
    if (!supabase || !barcodeInput.trim()) return
    setBarcodeError('')
    try {
      const { data, error } = await supabase
        .from('shared_inventory')
        .select('id, product_name, barcode, quantity_quarto, quantity_castenaso, quantity_bologna, quantity_san_lazzaro, category, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10, last_carico_quarto, last_carico_castenaso, last_carico_bologna, last_carico_san_lazzaro, last_scarico_quarto, last_scarico_castenaso, last_scarico_bologna, last_scarico_san_lazzaro')
        .eq('barcode', barcodeInput.trim())
        .not('category', 'is', null)
        .neq('category', '')
        .limit(1)

      if (error) {
        setBarcodeError(error.message)
        return
      }

      const entry = (data ?? [])[0] as InventoryEntry | undefined
      if (!entry) {
        setBarcodeError('Nessun prodotto trovato con questo barcode')
        return
      }

      const next = new Map(manualMatches)
      next.set(cartName, { entry, stores: getStoreStocks(entry) })
      setManualMatches(next)
      setSearchingBarcode(null)
      setCorrectingOldEntryId(null)
      setBarcodeInput('')

      const existingAliases = getAliases(entry)
      const alreadyHasAlias = existingAliases.some((a) => a.toLowerCase().trim() === cartName.toLowerCase().trim())

      if (!alreadyHasAlias) {
        const col = findEmptyAliasColumn(entry)
        if (col) {
          await supabase.from('shared_inventory').update({ [col]: cartName }).eq('id', entry.id)
        } else {
          const shiftPayload: Record<string, string | null> = {}
          shiftPayload['alias_1'] = cartName
          for (let i = 2; i <= 10; i++) {
            const prev = entry[`alias_${i - 1}` as keyof InventoryEntry] as string | null
            shiftPayload[`alias_${i}`] = prev
          }
          await supabase.from('shared_inventory').update(shiftPayload).eq('id', entry.id)
        }
      }

      if (correctingOldEntryId && correctingOldEntryId !== entry.id) {
        const { data: oldData } = await supabase
          .from('shared_inventory')
          .select('alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10')
          .eq('id', correctingOldEntryId)
          .limit(1)

        const oldEntry = (oldData ?? [])[0] as Record<string, string | null> | undefined
        if (oldEntry) {
          const cartNorm = cartName.toLowerCase().trim()
          for (let i = 1; i <= 10; i++) {
            const col = `alias_${i}` as const
            if (oldEntry[col]?.toLowerCase().trim() === cartNorm) {
              await supabase.from('shared_inventory').update({ [col]: null }).eq('id', correctingOldEntryId)
              break
            }
          }
        }
      }
    } catch (err) {
      setBarcodeError(err instanceof Error ? err.message : 'Errore')
    }
  }

  return (
    <>
      {showIdentifier ? (
        <div className="modal-overlay">
          <div className="modal-content cross-identifier-modal">
            <h3>Identifica il tuo negozio</h3>
            <p>
              Seleziona la tua sede. Verrà ricordata su questo computer.
            </p>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
            >
              <option value="">Seleziona negozio...</option>
              {STORE_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <div className="modal-actions">
              <button className="cta" type="button" onClick={handleConfirmStore} disabled={!selectedStore}>
                Conferma
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSvuotaConfirm ? (
        <div className="modal-overlay" onClick={() => setShowSvuotaConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Svuota richieste ricevute</h3>
            <p>Confermi di aver recepito tutte le richieste? Verranno rimosse dalla lista.</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setShowSvuotaConfirm(false)}>
                Annulla
              </button>
              <button className="cta" style={{ background: '#d9534f', borderColor: '#d9534f' }} onClick={handleSvuota}>
                Svuota
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="cross-layout">
        <div className="cross-main">
          <article className="card">
            <h2>Carica inventario</h2>

            <form onSubmit={handleUploadCSV} className="stack split">



               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                   <span className="cross-identified-store">
                     Negozio: <strong>{selectedStore}</strong>
                   </span>
                   <button className="ghost small" type="button" onClick={handleChangeStore}>
                     Cambia
                   </button>
                 </div>
                 <button
                   className="ghost small"
                   type="button"
                   style={testMode ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : undefined}
                   onClick={onRequestToggleTest}
                   title={testMode ? 'Disattiva modalità test' : 'Attiva modalità test (mostra anche il proprio negozio)'}
                 >
                   {testMode ? 'TEST ON' : 'TEST OFF'}
                 </button>
               </div>

              <label>
                File CSV (export Easyfatt)
                <div className="cross-file-input">
                  <label className="ghost small cross-file-button">
                    Scegli file
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <span className="cross-file-name">{csvFile ? csvFile.name : 'Nessun file selezionato'}</span>
                </div>
              </label>

              {csvMessage ? (
                <p className={csvStatus === 'error' ? 'error' : 'success'}>{csvMessage}</p>
              ) : null}

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="cta" type="submit" disabled={uploading || !csvFile || !selectedStore}>
                  {uploading ? 'Caricamento...' : 'Carica inventario'}
                </button>
                {inventoryCount > 0 ? (
                  <span className="badge">{inventoryCount} prodotti a database</span>
                ) : null}
              </div>
            </form>
          </article>
          <article className="card cross-filter-card">
            <h2>Filtri</h2>
            <div className="stack split">
              <div className="cross-filter-bar">
                {(() => {
                  const { caricoDays, scaricoDays } = getFilterDays()
                  return (
                    <>
                      <label className={`cross-filter-bar-opt${activeFilter === 'filter1' ? ' active' : ''}`}>
                        <input type="radio" name="cross-filter" checked={activeFilter === 'filter1'} onChange={() => setActiveFilter('filter1')} />
                        <span>Filtro 1 ({caricoDays}g. carica, {scaricoDays}g. scarica)</span>
                      </label>
                      <label className={`cross-filter-bar-opt${activeFilter === 'filter2' ? ' active' : ''}`}>
                        <input type="radio" name="cross-filter" checked={activeFilter === 'filter2'} onChange={() => setActiveFilter('filter2')} />
                        <span>Filtro 2 (assente o +120g. inattivo)</span>
                      </label>
                    </>
                  )
                })()}
                <label className={`cross-filter-bar-opt${activeFilter === 'nofiltro' ? ' active' : ''}`}>
                  <input type="radio" name="cross-filter" checked={activeFilter === 'nofiltro'} onChange={() => setActiveFilter('nofiltro')} />
                  <span>No filtro</span>
                </label>
              </div>
            </div>
          </article>
          <article className="card cross-dedup-card">
            <h2>Deduplica</h2>
            <div className="stack split">
              <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                <button className="cta" type="button" onClick={handleAutoDeduplicate} disabled={autoDeduping}>
                  {autoDeduping ? 'Merge in corso...' : 'Dedup. Auto.'}
                </button>
                {autoDedupError ? <p className="error">{autoDedupError}</p> : null}
                {autoDedupResults.length > 0 ? (
                  <span className="badge">{autoDedupResults.length} mergiati</span>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                <button className="cta" type="button" onClick={handleDeduplicate} disabled={deduping || autoDeduping}>
                  {deduping ? 'Cerco duplicati...' : 'Dedup. Man.'}
                </button>
                {dedupError ? <p className="error">{dedupError}</p> : null}
                {dedupResults.length > 0 ? (
                  <span className="badge">{dedupResults.length} duplicati trovati</span>
                ) : null}
              </div>
            </div>
          </article>
        </div>

        <div className="cross-main">
          <article className="card">
            <h2>Carrello fornitore{cartUniqueCount > 0 ? <span className="badge">{cartUniqueCount}</span> : null}</h2>
            <div className="stack split">

              <label>
                Incolla qui il testo del carrello
                <textarea
                  className="cross-inventory-textarea"
                  value={cartText}
                  onChange={(e) => setCartText(e.target.value)}
                  placeholder="Incolla il contenuto del carrello del fornitore..."
                  rows={12}
                />
              </label>

              {cartError ? <p className="error">{cartError}</p> : null}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="cta"
                  type="button"
                  onClick={doMatch}
                   disabled={matching || (activeFilter !== 'filter2' && !cartText.trim())}
                >
                  {matching ? 'Confronto...' : 'Confronta con inventario'}
                </button>
              </div>

              {matchError ? <p className="error">{matchError}</p> : null}
            </div>
          </article>
        </div>

        <div className="cross-main">
          {matches.length > 0 || dedupResults.length > 0 || autoDedupResults.length > 0 || allInventory.length > 0 ? (
            <article className="card">
              <h2>Risultati ricerca</h2>

              {autoDedupResults.length > 0 ? (
                autoDedupResults.map((group) => (
                  <div key={group.barcode} className="cross-match-item cross-dedup-item cross-dedup-auto">
                    <div className="cross-match-header">
                      <span className="cross-match-cart-name">Barcode: {group.barcode}</span>
                      <span className="cross-match-score high">Mergiato</span>
                    </div>
                    <div className="cross-dedup-rows">
                      {group.rows.map((row) => {
                        const stocks = getStoreStocks(row)
                        const totalQty = stocks.reduce((s, st) => s + st.quantity, 0)
                        return (
                          <div key={row.id} className="cross-dedup-row">
                            <div className="cross-dedup-row-info">
                              <strong>{row.product_name}</strong>
                              <span className="hint">ID: {row.id} — Giacenza tot: {totalQty}</span>
                            </div>
                            <span className="badge" style={{ background: '#5cb85c' }}>OK</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              ) : dedupResults.length > 0 ? (
                dedupResults.map((group) => (
                  <div key={group.barcode} className="cross-match-item cross-dedup-item">
                    <div className="cross-match-header">
                      <span className="cross-match-cart-name">Barcode: {group.barcode}</span>
                      <span className="cross-match-score none">{group.rows.length} duplicati</span>
                    </div>
                    <div className="cross-dedup-rows">
                      {group.rows.map((row, idx) => {
                        const stocks = getStoreStocks(row)
                        const totalQty = stocks.reduce((s, st) => s + st.quantity, 0)
                        return (
                          <div key={row.id} className="cross-dedup-row">
                            <div className="cross-dedup-row-info">
                              <strong>{row.product_name}</strong>
                              <span className="hint">ID: {row.id} — Giacenza tot: {totalQty}</span>
                            </div>
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => handleMerge(group, idx)}
                              disabled={mergingId !== null}
                            >
                              {mergingId === `${group.barcode}|${idx}` ? 'Merging...' : 'Unisci'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div id="cross-print-area">
                  {(() => {
                    const baseItems =
                      activeFilter === 'filter2' && allInventory.length > 0
                        ? allInventory
                            .filter((entry) => isProductAbsentFromStore(entry, selectedStore))
                            .map((entry): CartItemMatch => ({
                              name: entry.product_name,
                              matches: [{ entry, score: 1, stocks: getStoreStocks(entry) }],
                              bestMatch: { entry, score: 1, stocks: getStoreStocks(entry) },
                            }))
                        : cartItemsMapToMatches(cartItems, matches)
                    const filtered = baseItems
                      .filter((item) => {
                        if (item.matches.length === 0) return true
                        if (testMode) return true
                        const buttons = collectStoreButtons(item.matches, selectedStore, activeFilter, cartQtys.get(item.name))
                        return buttons.length > 0
                      })
                    return (
                      <>
                        <div className="cross-print-header">
                          <span className="hint">{filtered.length} risultati</span>
                          <button className="cta print-hide" type="button" onClick={() => window.print()}>Stampa</button>
                        </div>
                        {filtered.map((item) => {
                  const storeButtons = collectStoreButtons(item.matches, testMode ? '' : selectedStore, activeFilter, cartQtys.get(item.name))
                  const hasNoMatch = item.matches.length === 0
                  return (
                    <div key={item.name} className="cross-match-item">
                      <div className="cross-match-header">
                        <span className="cross-match-cart-name">{item.name}</span>
                        {activeFilter === 'filter2' && item.bestMatch ? (() => {
                          const e = item.bestMatch.entry
                          const storeMap: Record<string, {c: keyof InventoryEntry; s: keyof InventoryEntry; q: keyof InventoryEntry}> = {
                            quarto: {c:'last_carico_quarto',s:'last_scarico_quarto',q:'quantity_quarto'},
                            castenaso: {c:'last_carico_castenaso',s:'last_scarico_castenaso',q:'quantity_castenaso'},
                            bologna: {c:'last_carico_bologna',s:'last_scarico_bologna',q:'quantity_bologna'},
                            'san lazzaro': {c:'last_carico_san_lazzaro',s:'last_scarico_san_lazzaro',q:'quantity_san_lazzaro'},
                          }
                          const keys = storeMap[selectedStore.toLowerCase()]
                          if (!keys) return null
                          const c = (e[keys.c] as string | null) || '-'
                          const s = (e[keys.s] as string | null) || '-'
                          const q = e[keys.q] as number
                          const absent = isProductAbsentFromStore(e, selectedStore)
                          return (
                            <span className="hint" style={{marginLeft:'0.5rem',fontSize:'0.7rem'}}>
                              c:{c} s:{s} q:{q} | {absent ? 'ASSENTE' : 'presente'}
                            </span>
                          )
                        })() : null}
                        {hasNoMatch ? (
                          <span className="cross-match-score none">nessun match</span>
                        ) : (
                          <button
                            className={`cross-match-score-btn cross-match-score${item.bestMatch!.score >= 0.7 ? ' high' : item.bestMatch!.score >= 0.4 ? ' medium' : ' low'}`}
                            type="button"
                             onClick={() => startBarcodeSearch(item.name, item.bestMatch?.entry.id)}
                            title="Cerca per barcode manuale"
                           >
                             {Math.min(Math.round(item.bestMatch!.score * 100), 100)}%
                          </button>
                        )}
                      </div>
                      {hasNoMatch ? (
                        <div className="cross-match-no-match">
                          {searchingBarcode === item.name ? (
                            <div className="cross-match-barcode-search">
                              <input
                                className="cross-barcode-input"
                                value={barcodeInput}
                                onChange={(e) => setBarcodeInput(e.target.value)}
                                placeholder="Incolla barcode da Easyfatt..."
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') lookupBarcode(item.name) }}
                              />
                              <div className="cross-match-actions">
                                <button className="ghost small" type="button" onClick={() => lookupBarcode(item.name)}>
                                  Cerca
                                </button>
                                <button className="ghost small" type="button" onClick={() => setSearchingBarcode(null)}>
                                  Annulla
                                </button>
                              </div>
                              {barcodeError ? <p className="error">{barcodeError}</p> : null}
                            </div>
                          ) : manualMatches.has(item.name) ? (
                            (() => {
                              const manual = manualMatches.get(item.name)!
                              const manualButtons = manual.stores
                                .filter((s) => s.quantity > 0 && (testMode || s.label.toLowerCase() !== selectedStore.toLowerCase()) && storePassesFilter(s, activeFilter))
                              return manualButtons.length > 0 ? (
                                <>
                                  <p className="cross-match-product">{manual.entry.product_name}</p>
                                  <div className="cross-match-actions">
                                    {manualButtons.map((s) => (
                                      <button key={s.store} className="ghost small" type="button" onClick={() => addToBasket(s.label, manual.entry.product_name, manual.entry.barcode, cartQtys.get(item.name) ?? 1, s)}>
CHIEDI A {s.label.toUpperCase()} ({testMode ? filterDebugSuffix(s, activeFilter, s.quantity) : `${s.quantity} disp.`})
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <p className="hint">Trovato "{manual.entry.product_name}" ma nessun altro store ha giacenza</p>
                              )
                            })()
                          ) : (
                            <div className="cross-match-actions">
                              <button className="ghost small" type="button" onClick={() => startBarcodeSearch(item.name)}>
                                Cerca per barcode
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          {searchingBarcode === item.name ? (
                            <div className="cross-match-barcode-search">
                              <input
                                className="cross-barcode-input"
                                value={barcodeInput}
                                onChange={(e) => setBarcodeInput(e.target.value)}
                                placeholder="Incolla barcode da Easyfatt..."
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') lookupBarcode(item.name) }}
                              />
                              <div className="cross-match-actions">
                                <button className="ghost small" type="button" onClick={() => lookupBarcode(item.name)}>
                                  Cerca
                                </button>
                                <button className="ghost small" type="button" onClick={() => setSearchingBarcode(null)}>
                                  Annulla
                                </button>
                              </div>
                              {barcodeError ? <p className="error">{barcodeError}</p> : null}
                            </div>
                          ) : manualMatches.has(item.name) ? (
                            (() => {
                              const manual = manualMatches.get(item.name)!
                              const manualButtons = manual.stores
                                .filter((s) => s.quantity > 0 && (testMode || s.label.toLowerCase() !== selectedStore.toLowerCase()) && storePassesFilter(s, activeFilter))
                              return manualButtons.length > 0 ? (
                                <>
                                  <p className="cross-match-product">{manual.entry.product_name}</p>
                                  <div className="cross-match-actions">
                                    {manualButtons.map((s) => (
                                       <button key={s.store} className="ghost small" type="button" onClick={() => addToBasket(s.label, manual.entry.product_name, manual.entry.barcode, cartQtys.get(item.name) ?? 1, s)}>
CHIEDI A {s.label.toUpperCase()} ({testMode ? filterDebugSuffix(s, activeFilter, s.quantity) : `${s.quantity} disp.`})
                                      </button>
                                    ))}
                                    <button className="ghost small" type="button" onClick={() => startBarcodeSearch(item.name, manual.entry.id)} title="Correggi associazione">
                                      Correggi
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <p className="hint">Trovato "{manual.entry.product_name}" ma nessun altro store ha giacenza</p>
                              )
                            })()
                          ) : (
                            <>
                              <p className="cross-match-product">{item.bestMatch!.entry.product_name}</p>
                              <div className="cross-match-actions">
                                {storeButtons.map((s) => (
                                  <button
                                    key={s.store}
                                    className="ghost small"
                                    type="button"
                                    onClick={() => addToBasket(s.label, item.bestMatch!.entry.product_name, item.bestMatch!.entry.barcode, cartQtys.get(item.name) ?? 1, s)}
                                  >
                                    CHIEDI A {s.label.toUpperCase()} ({testMode ? filterDebugSuffix(s, activeFilter, s.quantity) : `${s.quantity} disp.`})
                                  </button>
                                ))}
                                <button className="ghost small" type="button" onClick={() => startBarcodeSearch(item.name, item.bestMatch!.entry.id)} title="Correggi associazione">
                                  Correggi
                                </button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                      {testMode && activeFilter !== 'nofiltro' && item.matches.length > 0 ? (
                        (() => {
                          const excluded = renderExcludedStores(
                            item.matches.flatMap((m) => m.stocks),
                            testMode ? '' : selectedStore,
                            activeFilter,
                          )
                          return excluded.length > 0 ? (
                            <div className="cross-excluded-debug">
                              <p className="cross-excluded-title">Esclusi dal filtro:</p>
                              {excluded.map((e) => (
                                <div key={e.store} className="cross-excluded-item">
                                  <span className="cross-excluded-store">{e.label}</span>
                                  <span className="cross-excluded-reason">{e.reason}</span>
                                </div>
                              ))}
                            </div>
                          ) : null
                        })()
                      ) : null}
                    </div>
                  )
                })}
                      </>
                    )
                  })()}
              </div>
              )}
            </article>
          ) : (
            <article className="card cross-results-placeholder">
              <h2>Risultati ricerca</h2>
              <p className="hint no-top">Carica l'inventario e incolla il carrello fornitore, poi clicca "Confronta con inventario".</p>
            </article>
          )}
        </div>

        <div className="cross-divider" aria-hidden="true"></div>

        <aside className="cross-sidebar">
          {requestBasket.size > 0 ? (
            <article className="card cross-basket-card">
              <div className="cross-basket-header">
                <h2>
                  Carrello richieste
                  {!basketMinimized ? null : (
                    <span className="badge" style={{ marginLeft: '0.4rem' }}>
                      {[...requestBasket].reduce((sum, [, items]) => sum + items.length, 0)}
                    </span>
                  )}
                </h2>
                <button
                  className="ghost small"
                  type="button"
                  onClick={() => setBasketMinimized((v) => !v)}
                  title={basketMinimized ? 'Espandi' : 'Minimizza'}
                >
                  {basketMinimized ? 'Espandi' : 'Minimizza'}
                </button>
              </div>
              {!basketMinimized ? (
                <>
                  {[...requestBasket].map(([store, items]) => (
                    <div key={store} className="cross-basket-store">
                      <div className="cross-basket-store-header">
                        <span>
                          Per <strong>{store}</strong> ({items.length})
                        </span>
                        <button className="cta" type="button" onClick={() => sendBasketRequest(store)}>
                          Invia
                        </button>
                      </div>
                      <ul className="cross-basket-items">
                        {items.map((item, i) => (
                          <li key={i} className="cross-basket-li">
                            <input
                              className="cross-basket-qty"
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateBasketQuantity(store, i, parseInt(e.target.value, 10) || 1)}
                            />
                            <span className="cross-basket-name">{item.productName}</span>
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => removeFromBasket(store, i)}
                              title="Rimuovi"
                            >
                              &#10005;
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              ) : null}
              {visibleReceived.length > 0 ? (
                <div className="cross-received-mini">
                  <div className="cross-received-header">
                    <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Ricevute</h3>
                    {basketMinimized ? (
                      <button className="ghost small danger" type="button" onClick={() => setShowSvuotaConfirm(true)}>
                        SVUOTA
                      </button>
                    ) : null}
                  </div>
                   <ul className="cross-received-list">
                     {visibleReceived.map((req) => (
                       <li key={req.id}>
                         <div className="cross-received-item">
                           <div className="cross-received-item-main">
                             <strong>{req.title}</strong>
                             <p style={{ whiteSpace: 'pre-wrap' }}>{req.body}</p>
                             <time>{new Date(req.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                            </div>
                            {!req.title.startsWith('Risposta') ? (
                              <button className="ghost small" type="button" onClick={() => openReply(req)} title="Rispondi">
                                &#8630;
                              </button>
                            ) : null}
                          </div>
                          {expandedReplyId === req.id ? (
                            <div className="cross-reply-inline">
                              <ul className="cross-reply-items">
                                {replyItems.map((item, i) => (
                                  <li key={i} className="cross-reply-li">
                                    <button className="ghost small danger" type="button" onClick={() => removeReplyItem(i)} title="Rimuovi">&minus;</button>
                                    <input className="cross-basket-qty" type="number" min="0" value={item.quantity} onChange={(e) => updateReplyQuantity(i, parseInt(e.target.value, 10) || 0)} />
                                    <span className="cross-reply-name">{item.productName}</span>
                                  </li>
                                ))}
                              </ul>
                              {replyItems.length === 0 ? <p className="error">Nessun prodotto da confermare.</p> : null}
                              <div className="modal-actions">
                                <button className="ghost" type="button" onClick={closeReply}>Annulla</button>
                                <button className="cta" type="button" onClick={confirmReply} disabled={replyItems.length === 0}>Conferma invio</button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : basketMinimized ? (
                 <p className="hint">Nessuna richiesta ricevuta.</p>
               ) : null}
            </article>
          ) : (
            <article className="card">
              <div className="cross-received-header">
                <h2>Richieste ricevute</h2>
                {visibleReceived.length > 0 ? (
                  <button className="ghost small danger" type="button" onClick={() => setShowSvuotaConfirm(true)}>
                    SVUOTA
                  </button>
                ) : null}
              </div>
               {visibleReceived.length > 0 ? (
                 <ul className="cross-received-list">
                   {visibleReceived.map((req) => (
                     <li key={req.id}>
                       <div className="cross-received-item">
                         <div className="cross-received-item-main">
                           <strong>{req.title}</strong>
                           <p style={{ whiteSpace: 'pre-wrap' }}>{req.body}</p>
                           <time>{new Date(req.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                          </div>
                          {!req.title.startsWith('Risposta') ? (
                            <button className="ghost small" type="button" onClick={() => openReply(req)} title="Rispondi">
                              &#8630;
                            </button>
                          ) : null}
                        </div>
                        {expandedReplyId === req.id ? (
                          <div className="cross-reply-inline">
                            <ul className="cross-reply-items">
                              {replyItems.map((item, i) => (
                                <li key={i} className="cross-reply-li">
                                  <button className="ghost small danger" type="button" onClick={() => removeReplyItem(i)} title="Rimuovi">&minus;</button>
                                  <input className="cross-basket-qty" type="number" min="0" value={item.quantity} onChange={(e) => updateReplyQuantity(i, parseInt(e.target.value, 10) || 0)} />
                                  <span className="cross-reply-name">{item.productName}</span>
                                </li>
                              ))}
                            </ul>
                            {replyItems.length === 0 ? <p className="error">Nessun prodotto da confermare.</p> : null}
                            <div className="modal-actions">
                              <button className="ghost" type="button" onClick={closeReply}>Annulla</button>
                              <button className="cta" type="button" onClick={confirmReply} disabled={replyItems.length === 0}>Conferma invio</button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint no-top">Nessuna richiesta ricevuta.</p>
                )}
            </article>
          )}
        </aside>
        {requestBasket.size > 0 ? null : null}
      </div>
    </>
  )

}

interface CartItemMatch {
  name: string
  matches: MatchResult['matches']
  bestMatch: MatchResult['matches'][number] | null
}

interface StoreButton {
  store: string
  label: string
  quantity: number
  lastCarico: string | null
  lastScarico: string | null
}

function cartItemsMapToMatches(
  cartItems: string[],
  results: MatchResult[],
): CartItemMatch[] {
  const map = new Map<string, MatchResult>()
  for (const r of results) {
    map.set(r.cartName, r)
  }

  return cartItems.map((name) => {
    const result = map.get(name)
    const matches = result?.matches ?? []
    return {
      name,
      matches,
      bestMatch: matches.length > 0 ? matches[0] : null,
    }
  })
}

function collectStoreButtons(
  matches: MatchResult['matches'],
  currentStore: string,
  filterName: string,
  cartQty?: number,
): StoreButton[] {
  const seen = new Set<string>()
  const buttons: StoreButton[] = []

  for (const m of matches) {
    for (const s of m.stocks) {
      if (s.quantity <= 0) continue
      if (s.label.toLowerCase() === currentStore.toLowerCase()) continue
      if (seen.has(s.store)) continue
      if (!storePassesFilter(s, filterName, cartQty)) continue
      seen.add(s.store)
      buttons.push(s)
    }
  }

    return buttons
  }
