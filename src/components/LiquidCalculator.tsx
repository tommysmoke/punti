import { useMemo, useState } from 'react'

const ROWS = 9

interface LiquidRow {
  des: string
  qta: string
  vgl: string
  prg: string
  alt: string
  nic: string
}

const EMPTY_ROW: LiquidRow = { des: '', qta: '0', vgl: '0', prg: '0', alt: '0', nic: '0' }

function parseNum(value: string): number {
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(value * f) / f
}

export default function LiquidCalculator() {
  const [rows, setRows] = useState<LiquidRow[]>(() =>
    Array.from({ length: ROWS }, () => ({ ...EMPTY_ROW })),
  )

  const updateRow = (index: number, field: keyof LiquidRow, value: string) => {
    setRows((prev) => {
      const next = prev.map((r) => ({ ...r }))
      next[index][field] = value
      return next
    })
  }

  const resetAll = () => {
    setRows(Array.from({ length: ROWS }, () => ({ ...EMPTY_ROW })))
  }

  const result = useMemo(() => {
    let totLiq = 0
    let totVgl = 0
    let totPrg = 0
    let totAlt = 0
    let totNic = 0
    for (const r of rows) {
      const qta = parseNum(r.qta)
      if (qta > 0) {
        totLiq += qta
        totVgl += (qta / 100) * parseNum(r.vgl)
        totPrg += (qta / 100) * parseNum(r.prg)
        totAlt += (qta / 100) * parseNum(r.alt)
        totNic += qta * parseNum(r.nic)
      }
    }
    const gradNic = totLiq > 0 ? totNic / totLiq : 0
    return { totLiq, totVgl, totPrg, totAlt, gradNic }
  }, [rows])

  const nicColor = result.gradNic > 20 ? 'red' : result.gradNic > 10 ? 'brown' : result.gradNic > 5 ? 'darkorange' : 'green'

  return (
    <section className="store-single-page">
      <article className="card">
        <h2>Calcolatore liquidi fai da te</h2>
        <p className="hint no-top" style={{ marginBottom: '1rem' }}>
          Calcola la quantità di nicotina e la composizione ottenuta mescolando basi diverse.
        </p>

        <div className="liquid-calc-wrap">
          <table className="liquid-calc-table">
            <thead>
              <tr>
                <th className="liquid-calc-desc">Descrizione</th>
                <th>qta<br />ml</th>
                <th>VG<br />%</th>
                <th>PG<br />%</th>
                <th>altro<br />%</th>
                <th>nicotina<br />mg/ml</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td className="liquid-calc-desc">
                    <input
                      type="text"
                      value={row.des}
                      onChange={(e) => updateRow(index, 'des', e.target.value)}
                      placeholder="descrizione"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.qta}
                      onChange={(e) => updateRow(index, 'qta', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.vgl}
                      onChange={(e) => updateRow(index, 'vgl', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.prg}
                      onChange={(e) => updateRow(index, 'prg', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.alt}
                      onChange={(e) => updateRow(index, 'alt', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.nic}
                      onChange={(e) => updateRow(index, 'nic', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="liquid-calc-toolbar">
          <button className="ghost small" type="button" onClick={resetAll}>
            Reset
          </button>
        </div>

        <div className="stack split" style={{ marginTop: '1rem' }}>
          <h3 style={{ margin: 0 }}>Risultato</h3>
          {result.totLiq > 0 ? (
            <table className="liquid-calc-result">
              <tbody>
                <tr>
                  <td>Glicerina</td>
                  <td className="right">{round(result.totVgl, 2)} ml</td>
                  <td className="right">{round((100 / result.totLiq) * result.totVgl, 1)} %</td>
                </tr>
                <tr>
                  <td>Glicole prop.</td>
                  <td className="right">{round(result.totPrg, 2)} ml</td>
                  <td className="right">{round((100 / result.totLiq) * result.totPrg, 1)} %</td>
                </tr>
                <tr>
                  <td>Altro</td>
                  <td className="right">{round(result.totAlt, 2)} ml</td>
                  <td className="right">{round((100 / result.totLiq) * result.totAlt, 1)} %</td>
                </tr>
                <tr>
                  <td>Totale liquido</td>
                  <td className="right">{round(result.totLiq, 0)} ml</td>
                  <td className="right">
                    {result.gradNic > 0 ? (
                      <span style={{ color: nicColor }}>
                        con <strong>{round(result.gradNic, 1)}</strong> mg/ml di Nicotina
                      </span>
                    ) : (
                      <span style={{ color: 'green' }}><strong>senza nicotina</strong></span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="hint no-top">Inserisci quantità e composizione per vedere il risultato.</p>
          )}
        </div>
      </article>
    </section>
  )
}
