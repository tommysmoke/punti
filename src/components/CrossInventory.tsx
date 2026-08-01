import { type FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseEasyfattCSV } from '../lib/csvParser'
import { parseCart } from '../lib/cartParser'
import {
  matchCartAgainstInventory,
  getStoreColumnName,
  STORE_NAMES,
  type InventoryEntry,
  type MatchResult,
} from '../lib/crossInventory'

type Status = 'idle' | 'loading' | 'success' | 'error'

export function CrossInventory() {
  const [selectedStore, setSelectedStore] = useState(() => {
    try {
      return sessionStorage.getItem('punti-cross-store') ?? ''
    } catch {
      return ''
    }
  })
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

  useEffect(() => {
    try {
      sessionStorage.setItem('punti-cross-store', selectedStore)
    } catch {
      // ignore
    }
  }, [selectedStore])

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

      // Reset all quantities for this store
      const { error: resetErr } = await supabase.rpc('reset_inventory_for_store', {
        p_column: columnName,
      })
      if (resetErr) {
        setCsvStatus('error')
        setCsvMessage(`Errore reset: ${resetErr.message}`)
        return
      }

      // Fetch all existing products for matching
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

        // Try barcode match first
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

        // Try exact name match
        const nameMatch = existingProducts.find(
          (p) => p.product_name.toLowerCase() === row.name.toLowerCase() && !matchedIds.has(p.id),
        )
        if (nameMatch) {
          updates.push({ id: nameMatch.id, [columnName]: row.quantity })
          matchedIds.add(nameMatch.id)
          matched = true
        }

        if (matched) continue

        // No match: insert new row
        inserts.push({
          product_name: row.name,
          barcode: row.barcode,
          category: row.category,
          [columnName]: row.quantity,
        })
      }

      // Batch updates via RPC
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

      // Batch inserts
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

  const handleParseCart = () => {
    if (!cartText.trim()) {
      setCartError('Incolla il testo del carrello')
      return
    }

    setCartError('')
    setMatches([])

    try {
      const items = parseCart(cartText)
      if (items.length === 0) {
        setCartError('Nessun prodotto trovato nel testo incollato. Verifica il formato.')
        return
      }
      setCartItems(items.map((i) => i.name))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante il parsing'
      setCartError(message)
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
          return parseCart(cartText).map((i) => i.name)
        } catch {
          return []
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
        .select('id, product_name, barcode, quantity_quarto, quantity_castenaso, quantity_bologna, quantity_san_lazzaro, category')

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

  return (
    <section className="store-single-page">
      <article className="card">
        <h2>Cross-Inventory</h2>
        <p className="hint no-top" style={{ marginBottom: '1.2rem' }}>
          Confronta il carrello fornitore con l'inventario degli altri negozi per evitare acquisti doppi.
        </p>

        <form onSubmit={handleUploadCSV} className="stack split">
          <h3 style={{ margin: 0, fontSize: '0.96rem' }}>1. Carica inventario</h3>

          <label>
            Negozio
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
            >
              <option value="">Seleziona negozio...</option>
              {STORE_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          <label>
            File CSV (export Easyfatt)
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            />
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

      <article className="card">
        <div className="stack split">
          <h3 style={{ margin: 0, fontSize: '0.96rem' }}>2. Carrello fornitore</h3>

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
          {cartItems.length > 0 ? (
            <p className="hint no-top">
              {cartItems.length} prodotti trovati nel carrello
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="ghost"
              type="button"
              onClick={handleParseCart}
              disabled={!cartText.trim()}
            >
              Analizza carrello
            </button>
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

      {matches.length > 0 ? (
        <article className="card">
          <h2>Risultati confronto</h2>
          <p className="hint no-top" style={{ marginBottom: '1rem' }}>
            Prodotti del carrello trovati nell'inventario condiviso.
          </p>

          {cartItemsMapToMatches(cartItems, matches)
            .filter((item) => item.matches.length === 0 || collectStoreButtons(item.matches, selectedStore).length > 0)
            .map((item) => {
              const storeButtons = collectStoreButtons(item.matches, selectedStore)
              const hasNoMatch = item.matches.length === 0
              return (
                <div key={item.name} className="cross-match-item">
                  <div className="cross-match-header">
                    <span className="cross-match-cart-name">{item.name}</span>
                    <span className={`cross-match-score${hasNoMatch ? ' none' : item.bestMatch!.score >= 0.7 ? ' high' : item.bestMatch!.score >= 0.4 ? ' medium' : ' low'}`}>
                      {hasNoMatch ? 'nessun match' : `${Math.round(item.bestMatch!.score * 100)}%`}
                    </span>
                  </div>
                  {hasNoMatch ? null : (
                    <>
                      <p className="cross-match-product">{item.bestMatch!.entry.product_name}</p>
                      <div className="cross-match-actions">
                        {storeButtons.map((s) => (
                          <button
                            key={s.store}
                            className="ghost small"
                            type="button"
                            onClick={() => { /* TODO: implementare richiesta */ }}
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
      ) : null}
    </section>
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
