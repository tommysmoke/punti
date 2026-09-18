import type { FormEvent } from 'react'
import type { Reward } from '../hooks/useAppState'

type RedeemSummaryRow = { points_cost: number; total_count: number; month_count: number; year_count: number; year_projection: number }

type Props = {
  loadingData: boolean
  rewards: Reward[]
  redeemSummary: RedeemSummaryRow[]
  newRewardName: string
  newRewardDescription: string
  newRewardPoints: string
  rewardError: string
  addingReward: boolean
  onToggleReward: (reward: Reward) => void
  onAskDeleteReward: (reward: Reward) => void
  onRewardNameChange: (value: string) => void
  onRewardDescriptionChange: (value: string) => void
  onRewardPointsChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function StoreRewardsPage({
  loadingData,
  rewards,
  redeemSummary,
  newRewardName,
  newRewardDescription,
  newRewardPoints,
  rewardError,
  addingReward,
  onToggleReward,
  onAskDeleteReward,
  onRewardNameChange,
  onRewardDescriptionChange,
  onRewardPointsChange,
  onSubmit,
}: Props) {
  const summaryByCost = new Map(redeemSummary.map((s) => [s.points_cost, s]))

  return (
    <section className="store-single-page">
      <article className="card">
        <h2>Gestione premi</h2>
        <p className="hint no-top" style={{ marginBottom: '1rem' }}>I premi attivi sono visibili ai clienti nella loro home.</p>

        {loadingData ? (
          <div className="skeleton-stack" aria-hidden="true">
            <div className="skeleton-box" style={{ height: '3.4rem' }}></div>
            <div className="skeleton-box" style={{ height: '3.4rem' }}></div>
            <div className="skeleton-box" style={{ height: '3.4rem' }}></div>
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
                    onClick={() => onToggleReward(reward)}
                  >
                    {reward.active ? 'Disattiva' : 'Attiva'}
                  </button>
                  <button
                    type="button"
                    className="ghost small danger"
                    onClick={() => onAskDeleteReward(reward)}
                  >
                    Elimina
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint no-top" style={{ marginBottom: '1rem' }}>Nessun premio configurato. Aggiungine uno qui sotto.</p>
        )}

        <form onSubmit={onSubmit} className="stack split">
          <h3 style={{ margin: 0, fontSize: '0.96rem' }}>Aggiungi premio</h3>
          <label>
            Nome premio
            <input
              value={newRewardName}
              onChange={(e) => onRewardNameChange(e.target.value)}
              placeholder="Es: Caffè gratis"
            />
          </label>
          <label>
            Descrizione (opzionale)
            <input
              value={newRewardDescription}
              onChange={(e) => onRewardDescriptionChange(e.target.value)}
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
              onChange={(e) => onRewardPointsChange(e.target.value)}
              placeholder="Es: 50"
            />
          </label>
          {rewardError ? <p className="error">{rewardError}</p> : null}
          <button className="cta" type="submit" disabled={addingReward}>
            {addingReward ? 'Aggiunta premio...' : 'Aggiungi premio'}
          </button>
        </form>
      </article>

      <article className="card">
        <h2>Riepilogo utilizzi premi</h2>
        <div className="redeem-summary">
          <div className="redeem-summary-col">
            <h3>Totale</h3>
            {rewards.length > 0 ? (
              rewards.map((reward) => {
                const s = summaryByCost.get(reward.points_cost)
                return (
                  <p key={reward.id} className="redeem-summary-row">
                    <span className="redeem-summary-name">{reward.points_cost} punti</span>
                    <span className="redeem-summary-count">{s?.total_count ?? 0} volte</span>
                  </p>
                )
              })
            ) : (
              <p className="hint">Nessun premio configurato</p>
            )}
          </div>
          <div className="redeem-summary-col">
            <h3>Questo mese</h3>
            {rewards.length > 0 ? (
              rewards.map((reward) => {
                const s = summaryByCost.get(reward.points_cost)
                return (
                  <p key={reward.id} className="redeem-summary-row">
                    <span className="redeem-summary-name">{reward.points_cost} punti</span>
                    <span className="redeem-summary-count">{s?.month_count ?? 0} volte</span>
                  </p>
                )
              })
            ) : (
              <p className="hint">Nessun premio configurato</p>
            )}
          </div>
          <div className="redeem-summary-col">
            <h3>Prospettiva annuale</h3>
            {rewards.length > 0 ? (
              rewards.map((reward) => {
                const s = summaryByCost.get(reward.points_cost)
                return (
                  <p key={reward.id} className="redeem-summary-row">
                    <span className="redeem-summary-name">{reward.points_cost} punti</span>
                    <span className="redeem-summary-count">{s?.year_projection ?? 0}/anno</span>
                  </p>
                )
              })
            ) : (
              <p className="hint">Nessun premio configurato</p>
            )}
          </div>
        </div>
      </article>
    </section>
  )
}

export default StoreRewardsPage
