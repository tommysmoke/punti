import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseEasyfattCSV } from '../lib/csvParser'
import { parseCart } from '../lib/cartParser'
import {
  matchCartAgainstInventory,
  getStoreColumnName,
  getStoreStocks,
  findEmptyAliasColumn,
  STORE_NAMES,
  type InventoryEntry,
  type MatchResult,
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
  const [cartError, setCartError] = useState('')

  const [matches, setMatches] = useState<MatchResult[]>([])
  const [matching, setMatching] = useState(false)
  const [matchError, setMatchError] = useState('')

  const [uploading, setUploading] = useState(false)

  const [manualMatches, setManualMatches] = useState<Map<string, { entry: InventoryEntry; stores: ReturnType<typeof getStoreStocks> }>>(new Map())
  const [searchingBarcode, setSearchingBarcode] = useState<string | null>(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')

  const [receivedRequests, setReceivedRequests] = useState<ReceivedRequest[]>([])
  const [showSvuotaConfirm, setShowSvuotaConfirm] = useState(false)

  const [requestBasket, setRequestBasket] = useState<Map<string, { productName: string; barcode: string | null; quantity: number }[]>>(new Map())
  const [basketMinimized, setBasketMinimized] = useState(false)

  const addToBasket = (toStore: string, productName: string, barcode: string | null) => {
    setRequestBasket((prev) => {
      const next = new Map(prev)
      const items = next.get(toStore) ?? []
      items.push({ productName, barcode, quantity: 1 })
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

  const [replyRequest, setReplyRequest] = useState<ReceivedRequest | null>(null)
  const [replyItems, setReplyItems] = useState<{ productName: string; barcode: string | null; quantity: number }[]>([])

  const openReply = (req: ReceivedRequest) => {
    const items = parseRequestBody(req.body)
    setReplyItems(items)
    setReplyRequest(req)
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
    if (!supabase || !profile?.store_id || !replyRequest) return
    const fromStore = extractSender(replyRequest.title)
    const items = replyItems.filter((item) => item.quantity > 0)
    if (!fromStore || items.length === 0) return
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
        pushToast('error', 'Invio risposta non riuscito')
        return
      }
      pushToast('success', `Risposta inviata a ${fromStore}`)
      setReplyRequest(null)
      setReplyItems([])
    } catch {
      pushToast('error', 'Invio risposta non riuscito')
    }
  }

  const closeReply = () => {
    setReplyRequest(null)
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

      const { data: existing, error: fetchErr } = await supabase
        .from('shared_inventory')
        .select('id, product_name, barcode')
      if (fetchErr) {
        setCsvStatus('error')
        setCsvMessage(`Errore lettura inventario: ${fetchErr.message}`)
        return
      }

      const existingProducts = (existing ?? []) as { id: number; product_name: string; barcode: string | null }[]

      const updates: { id: number; [key: string]: number }[] = []
      const inserts: {
        product_name: string
        barcode: string
        category: string
        [key: string]: string | number
      }[] = []

      const matchedIds = new Set<number>()

      for (const row of rows) {
        let matched = false

        if (row.barcode) {
          const barcodeMatch = existingProducts.find(
            (p) => p.barcode && p.barcode === row.barcode,
          )
          if (barcodeMatch && !matchedIds.has(barcodeMatch.id)) {
            updates.push({ id: barcodeMatch.id, [columnName]: row.quantity })
            matchedIds.add(barcodeMatch.id)
            matched = true
          }
        }

        if (matched) continue

        const nameMatch = existingProducts.find(
          (p) => p.product_name.toLowerCase() === row.name.toLowerCase() && !matchedIds.has(p.id),
        )
        if (nameMatch) {
          updates.push({ id: nameMatch.id, [columnName]: row.quantity })
          matchedIds.add(nameMatch.id)
          matched = true
        }

        if (matched) continue

        inserts.push({
          product_name: row.name,
          barcode: row.barcode,
          category: row.category,
          [columnName]: row.quantity,
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

    const names =
      cartItems.length > 0 ? cartItems : (() => {
        try {
          const parsed = parseCart(cartText)
          if (parsed.length > 0) return parsed.map((i) => i.name)
          return cartText.split('\n').map((l) => l.trim()).filter(Boolean)
        } catch {
          return cartText.split('\n').map((l) => l.trim()).filter(Boolean)
        }
      })()

    if (names.length === 0) {
      setMatchError('Nessun prodotto da confrontare. Parsa prima il carrello.')
      return
    }

    setMatching(true)
    setMatchError('')

    try {
      const { data, error } = await supabase
        .from('shared_inventory')
        .select('id, product_name, barcode, quantity_quarto, quantity_castenaso, quantity_bologna, quantity_san_lazzaro, category, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10')

      if (error) {
        setMatchError(`Errore nel recupero inventario: ${error.message}`)
        return
      }

      const inventory = (data ?? []) as InventoryEntry[]
      const results = matchCartAgainstInventory(names, inventory)
      setCartItems(names)
      setMatches(results)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante il confronto'
      setMatchError(message)
    } finally {
      setMatching(false)
    }
  }

  const doMatch = () => {
    if (!cartText.trim()) {
      setMatchError('Incolla il testo del carrello')
      return
    }
    handleMatch()
  }

  const startBarcodeSearch = (cartName: string) => {
    setSearchingBarcode(cartName)
    setBarcodeInput('')
    setBarcodeError('')
  }

  const lookupBarcode = async (cartName: string) => {
    if (!supabase || !barcodeInput.trim()) return
    setBarcodeError('')
    try {
      const { data, error } = await supabase
        .from('shared_inventory')
        .select('id, product_name, barcode, quantity_quarto, quantity_castenaso, quantity_bologna, quantity_san_lazzaro, category, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10')
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
      setBarcodeInput('')

      const col = findEmptyAliasColumn(entry)
      if (col) {
        await supabase.from('shared_inventory').update({ [col]: cartName }).eq('id', entry.id)
      } else {
        const clearPayload: Record<string, null> = {}
        for (let i = 1; i <= 10; i++) {
          clearPayload[`alias_${i}`] = null
        }
        await supabase.from('shared_inventory').update({ ...clearPayload, alias_1: cartName }).eq('id', entry.id)
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
                  disabled={matching || !cartText.trim()}
                >
                  {matching ? 'Confronto...' : 'Confronta con inventario'}
                </button>
              </div>

              {matchError ? <p className="error">{matchError}</p> : null}
            </div>
          </article>
        </div>

        <div className="cross-main">
          {matches.length > 0 ? (
            <article className="card">
              <h2>Risultati ricerca</h2>

              {cartItemsMapToMatches(cartItems, matches)
                .filter((item) => {
                  if (item.matches.length === 0) return true
                  if (testMode) return true
                  return collectStoreButtons(item.matches, selectedStore).length > 0
                })
                .map((item) => {
                  const storeButtons = collectStoreButtons(item.matches, testMode ? '' : selectedStore)
                  const hasNoMatch = item.matches.length === 0
                  return (
                    <div key={item.name} className="cross-match-item">
                      <div className="cross-match-header">
                        <span className="cross-match-cart-name">{item.name}</span>
                        <span className={`cross-match-score${hasNoMatch ? ' none' : item.bestMatch!.score >= 0.7 ? ' high' : item.bestMatch!.score >= 0.4 ? ' medium' : ' low'}`}>
                          {hasNoMatch ? 'nessun match' : `${Math.round(item.bestMatch!.score * 100)}%`}
                        </span>
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
                                .filter((s) => s.quantity > 0 && (testMode || s.label.toLowerCase() !== selectedStore.toLowerCase()))
                              return manualButtons.length > 0 ? (
                                <>
                                  <p className="cross-match-product">{manual.entry.product_name}</p>
                                  <div className="cross-match-actions">
                                    {manualButtons.map((s) => (
                                      <button key={s.store} className="ghost small" type="button" onClick={() => addToBasket(s.label, manual.entry.product_name, manual.entry.barcode)}>
                                        CHIEDI A {s.label.toUpperCase()}
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
                          <p className="cross-match-product">{item.bestMatch!.entry.product_name}</p>
                            <div className="cross-match-actions">
                            {storeButtons.map((s) => (
                              <button
                                key={s.store}
                                className="ghost small"
                                type="button"
                                onClick={() => addToBasket(s.label, item.bestMatch!.entry.product_name, item.bestMatch!.entry.barcode)}
                              >
                                CHIEDI A {s.label.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
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
                      <li key={req.id} className="cross-received-item">
                        <div className="cross-received-item-main">
                          <strong>{req.title}</strong>
                          <p style={{ whiteSpace: 'pre-wrap' }}>{req.body}</p>
                          <time>{new Date(req.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                        </div>
                        <button className="ghost small" type="button" onClick={() => openReply(req)} title="Rispondi">
                          &#8630;
                        </button>
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
                    <li key={req.id} className="cross-received-item">
                      <div className="cross-received-item-main">
                        <strong>{req.title}</strong>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{req.body}</p>
                        <time>{new Date(req.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                      </div>
                      <button className="ghost small" type="button" onClick={() => openReply(req)} title="Rispondi">
                        &#8630;
                      </button>
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

      {replyRequest ? (
        <div className="modal-overlay" onClick={closeReply}>
          <div className="modal-content cross-reply-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Rispondi a {extractSender(replyRequest.title)}</h3>
            <p className="hint" style={{ marginBottom: '1rem' }}>
              Modifica le quantità che puoi inviare. Imposta a 0 o usa <strong>&minus;</strong> per rimuovere un prodotto.
            </p>
            <ul className="cross-reply-items">
              {replyItems.map((item, i) => (
                <li key={i} className="cross-reply-li">
                  <button
                    className="ghost small danger"
                    type="button"
                    onClick={() => removeReplyItem(i)}
                    title="Rimuovi"
                  >
                    &minus;
                  </button>
                  <input
                    className="cross-basket-qty"
                    type="number"
                    min="0"
                    value={item.quantity}
                    onChange={(e) => updateReplyQuantity(i, parseInt(e.target.value, 10) || 0)}
                  />
                  <span className="cross-reply-name">{item.productName}</span>
                  {item.barcode ? <span className="cross-reply-barcode">{item.barcode}</span> : null}
                </li>
              ))}
            </ul>
            {replyItems.length === 0 ? (
              <p className="error">Nessun prodotto da confermare.</p>
            ) : null}
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={closeReply}>
                Annulla
              </button>
              <button
                className="cta"
                type="button"
                onClick={confirmReply}
                disabled={replyItems.length === 0}
              >
                Conferma invio
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <label className="test-mode-float" title="Abilita test cross-inventory (invio a sé stessi)">
        <input
          type="checkbox"
          checked={testMode}
          onChange={onRequestToggleTest}
        />
        <span>Test cross</span>
      </label>
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
): StoreButton[] {
  const seen = new Set<string>()
  const buttons: StoreButton[] = []

  for (const m of matches) {
    for (const s of m.stocks) {
      if (s.quantity <= 0) continue
      if (s.label.toLowerCase() === currentStore.toLowerCase()) continue
      if (seen.has(s.store)) continue
      seen.add(s.store)
      buttons.push(s)
    }
  }

  return buttons
}
