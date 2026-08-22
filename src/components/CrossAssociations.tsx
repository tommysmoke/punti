import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  findEmptyAliasColumn,
  getAliases,
  type InventoryEntry,
} from '../lib/crossInventory'

type Props = {
  onBack: () => void
}

const PAGE_SIZE = 1000

export default function CrossAssociations({ onBack }: Props) {
  const [entries, setEntries] = useState<InventoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [correcting, setCorrecting] = useState<{ entryId: number; alias: string } | null>(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadEntries = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      setLoadError('Supabase non configurato')
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      const all: InventoryEntry[] = []
      let page = 0
      while (true) {
        const { data, error } = await supabase
          .from('shared_inventory')
          .select('id, product_name, barcode, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10')
          .order('id')
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

        if (error) {
          setLoadError(error.message)
          return
        }
        if (!data || data.length === 0) break
        all.push(...(data as InventoryEntry[]))
        if (data.length < PAGE_SIZE) break
        page++
      }

      setEntries(all.filter((entry) => getAliases(entry).length > 0))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Errore nel caricamento inventario')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const startCorrect = (entry: InventoryEntry, alias: string) => {
    setCorrecting({ entryId: entry.id, alias })
    setBarcodeInput('')
    setBarcodeError('')
  }

  const cancelCorrect = () => {
    setCorrecting(null)
    setBarcodeInput('')
    setBarcodeError('')
  }

  const confirmCorrect = async () => {
    if (!supabase || !correcting || !barcodeInput.trim() || saving) return

    const { entryId, alias } = correcting
    const source = entries.find((e) => e.id === entryId)
    if (!source) return

    setBarcodeError('')
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('shared_inventory')
        .select('id, product_name, barcode, alias_1, alias_2, alias_3, alias_4, alias_5, alias_6, alias_7, alias_8, alias_9, alias_10')
        .eq('barcode', barcodeInput.trim())
        .not('category', 'is', null)
        .neq('category', '')
        .limit(1)

      if (error) {
        setBarcodeError(error.message)
        return
      }

      const target = (data ?? [])[0] as InventoryEntry | undefined
      if (!target) {
        setBarcodeError('Nessun prodotto trovato con questo barcode')
        return
      }

      if (target.id === source.id) {
        setBarcodeError('Questo alias è già associato a questo prodotto')
        return
      }

      const aliasNorm = alias.toLowerCase().trim()

      for (let i = 1; i <= 10; i++) {
        const col = `alias_${i}` as keyof InventoryEntry
        const val = source[col]
        if (typeof val === 'string' && val.toLowerCase().trim() === aliasNorm) {
          const { error: removeErr } = await supabase
            .from('shared_inventory')
            .update({ [col]: null })
            .eq('id', source.id)
          if (removeErr) {
            setBarcodeError(removeErr.message)
            return
          }
          break
        }
      }

      const targetAliases = getAliases(target)
      const alreadyHasAlias = targetAliases.some((a) => a.toLowerCase().trim() === aliasNorm)
      if (!alreadyHasAlias) {
        const col = findEmptyAliasColumn(target)
        if (col) {
          const { error: addErr } = await supabase
            .from('shared_inventory')
            .update({ [col]: alias })
            .eq('id', target.id)
          if (addErr) {
            setBarcodeError(addErr.message)
            return
          }
        } else {
          const shift: Record<string, string | null> = {}
          shift['alias_1'] = alias
          for (let i = 2; i <= 10; i++) {
            shift[`alias_${i}`] = target[`alias_${i - 1}` as keyof InventoryEntry] as string | null
          }
          const { error: shiftErr } = await supabase
            .from('shared_inventory')
            .update(shift)
            .eq('id', target.id)
          if (shiftErr) {
            setBarcodeError(shiftErr.message)
            return
          }
        }
      }

      setCorrecting(null)
      setBarcodeInput('')
      await loadEntries()
    } catch (err) {
      setBarcodeError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="store-single-page">
      <article className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Correzioni associazioni</h2>
          <button className="ghost small" type="button" onClick={onBack}>
            Torna a Cross-Inventory
          </button>
        </div>
        <p className="hint no-top" style={{ marginBottom: '1rem' }}>
          Mostra i prodotti con alias salvati. Correggi un alias cercando il prodotto corretto tramite barcode.
        </p>

        {loading ? (
          <div className="skeleton-stack" aria-hidden="true">
            <div className="skeleton-box" style={{ height: '3rem' }}></div>
            <div className="skeleton-box" style={{ height: '3rem' }}></div>
            <div className="skeleton-box" style={{ height: '3rem' }}></div>
          </div>
        ) : loadError ? (
          <p className="error">{loadError}</p>
        ) : entries.length === 0 ? (
          <p className="hint no-top">Nessun prodotto con alias trovato.</p>
        ) : (
          <>
            <div className="cross-print-header">
              <span className="hint">{entries.length} prodotti</span>
            </div>
            {entries.map((entry) => {
              const aliases = getAliases(entry)
              return (
                <div key={entry.id} className="cross-match-item">
                  <div className="cross-match-header">
                    <span className="cross-match-cart-name">{entry.product_name}</span>
                    {entry.barcode ? <span className="hint" style={{ fontSize: '0.72rem' }}>{entry.barcode}</span> : null}
                  </div>
                  <ul className="cross-assoc-list">
                    {aliases.map((alias) => {
                      const isCorrecting = correcting?.entryId === entry.id && correcting?.alias === alias
                      return (
                        <li key={alias} className="cross-assoc-row">
                          <span className="cross-assoc-alias">{alias}</span>
                          {isCorrecting ? (
                            <div className="cross-match-barcode-search">
                              <input
                                className="cross-barcode-input"
                                value={barcodeInput}
                                onChange={(e) => setBarcodeInput(e.target.value)}
                                placeholder="Incolla barcode da Easyfatt..."
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') confirmCorrect() }}
                              />
                              <div className="cross-match-actions">
                                <button className="ghost small" type="button" onClick={confirmCorrect} disabled={saving || !barcodeInput.trim()}>
                                  {saving ? 'Salvo...' : 'Cerca'}
                                </button>
                                <button className="ghost small" type="button" onClick={cancelCorrect}>
                                  Annulla
                                </button>
                              </div>
                              {barcodeError ? <p className="error">{barcodeError}</p> : null}
                            </div>
                          ) : (
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => startCorrect(entry, alias)}
                              title="Correggi associazione"
                            >
                              Correggi
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </>
        )}
      </article>
    </section>
  )
}
