import { type FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseEasyfattCSV, buildInventoryUpsertPayload } from '../lib/csvParser'
import { parseCart } from '../lib/cartParser'
import { matchCartAgainstInventory, type InventoryEntry, type MatchResult } from '../lib/crossInventory'

type Status = 'idle' | 'loading' | 'success' | 'error'

export function CrossInventory() {
  const [storeName, setStoreName] = useState(() => {
    try {
      return sessionStorage.getItem('punti-cross-store-name') ?? ''
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
  const [cartParsing, setCartParsing] = useState(false)
  const [cartError, setCartError] = useState('')

  const [matches, setMatches] = useState<MatchResult[]>([])
  const [matching, setMatching] = useState(false)
  const [matchError, setMatchError] = useState('')

  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem('punti-cross-store-name', storeName)
    } catch {
      // ignore
    }
  }, [storeName])

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

    if (!storeName.trim()) {
      setCsvMessage('Inserisci il nome del negozio prima di caricare')
      setCsvStatus('error')
      return
    }

    if (!csvFile) {
      setCsvMessage('Seleziona un file CSV')
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

      const { error: clearErr } = await supabase.rpc('clear_store_inventory', {
        p_store_name: storeName.trim(),
      })
      if (clearErr) {
        setCsvStatus('error')
        setCsvMessage(`Errore durante la pulizia dei dati: ${clearErr.message}`)
        return
      }

      const payload = buildInventoryUpsertPayload(rows, storeName.trim())
      const batchSize = 500

      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize)
        const { error } = await supabase.from('shared_inventory').insert(batch)
        if (error) {
          setCsvStatus('error')
          setCsvMessage(`Errore durante il caricamento: ${error.message}`)
          return
        }
      }

      setInventoryCount(payload.length)
      setCsvStatus('success')
      setCsvMessage(`Caricati ${payload.length} prodotti`)
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

    setCartParsing(true)
    setCartError('')
    setMatches([])

    try {
      const items = parseCart(cartText)
      if (items.length === 0) {
        setCartError('Nessun prodotto trovato nel testo incollato. Verifica il formato.')
        setCartParsing(false)
        return
      }
      setCartItems(items.map((i) => i.name))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante il parsing'
      setCartError(message)
    } finally {
      setCartParsing(false)
    }
  }

  const handleMatch = async () => {
    if (!supabase) {
      setMatchError('Supabase non configurato')
      return
    }

    if (!storeName.trim()) {
      setMatchError('Inserisci il nome del negozio')
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
        .select('id, store_name, product_name, barcode, quantity, category')

      if (error) {
        setMatchError(`Errore nel recupero inventario: ${error.message}`)
        return
      }

      const inventory = (data ?? []) as InventoryEntry[]
      const results = matchCartAgainstInventory(names, inventory, storeName.trim())

      setCartItems(names)
      setMatches(results)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante il confronto'
      setMatchError(message)
    } finally {
      setMatching(false)
    }
  }

  const handleFetchAndMatch = async () => {
    handleParseCart()

    // Wait for state update
    window.requestAnimationFrame(async () => {
      await handleMatch()
    })
  }

  return (
    <section className="store-single-page">
      <article className="card">
        <h2>Cross-Inventory</h2>
        <p className="hint no-top" style={{ marginBottom: '1.2rem' }}>
          Confronta il carrello fornitore con l'inventario degli altri negozi per evitare acquisti doppi.
        </p>

        <form onSubmit={handleUploadCSV} className="stack split">
          <h3 style={{ margin: 0, fontSize: '0.96rem' }}>1. Dati negozio e inventario</h3>

          <label>
            Nome negozio
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Es: Napoli Centro"
            />
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
            <button className="cta" type="submit" disabled={uploading || !csvFile}>
              {uploading ? 'Caricamento...' : 'Carica inventario'}
            </button>
            {inventoryCount > 0 ? (
              <span className="badge">{inventoryCount} prodotti a database</span>
            ) : null}
          </div>
        </form>
      </article>

      <article className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault()
          }}
          className="stack split"
        >
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
              disabled={cartParsing || !cartText.trim()}
            >
              {cartParsing ? 'Analisi...' : 'Analizza carrello'}
            </button>
            <button
              className="cta"
              type="button"
              onClick={handleFetchAndMatch}
              disabled={matching || !cartText.trim()}
            >
              {matching ? 'Confronto...' : 'Analizza e confronta'}
            </button>
          </div>

          {matchError ? <p className="error">{matchError}</p> : null}
        </form>
      </article>

      {matches.length > 0 ? (
        <article className="card">
          <h2>Risultati confronto</h2>
          <p className="hint no-top" style={{ marginBottom: '1rem' }}>
            Prodotti del carrello trovati nell'inventario di altri negozi.
          </p>

          {cartItemsMapToMatches(cartItems, matches).map((item) => (
            <div key={item.name} className="cross-match-item">
              <div className="cross-match-header">
                <span className="cross-match-cart-name">{item.name}</span>
                {item.bestMatch ? (
                  <span
                    className={`cross-match-score${
                      item.bestMatch.score >= 0.7
                        ? ' high'
                        : item.bestMatch.score >= 0.4
                          ? ' medium'
                          : ' low'
                    }`}
                  >
                    {Math.round(item.bestMatch.score * 100)}%
                  </span>
                ) : (
                  <span className="cross-match-score none">nessun match</span>
                )}
              </div>

              {item.matches.length > 0 ? (
                <ul className="cross-match-details">
                  {item.matches.map((m) => (
                    <li key={m.entry.id} className="cross-match-detail-item">
                      <div className="cross-match-detail-info">
                        <strong>{m.entry.product_name}</strong>
                        <span className="cross-match-store">{m.entry.store_name}</span>
                      </div>
                      <span className={`cross-match-inline-score${m.score >= 0.7 ? ' high' : m.score >= 0.4 ? ' medium' : ' low'}`}>
                        {m.score >= 0.7 ? '✓' : '~'} {Math.round(m.score * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint no-top" style={{ paddingLeft: '0.5rem' }}>
                  Nessuna corrispondenza trovata negli altri negozi.
                </p>
              )}
            </div>
          ))}
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
